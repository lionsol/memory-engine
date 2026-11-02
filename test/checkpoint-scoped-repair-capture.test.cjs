"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");
const repair = require("../lib/checkpoint/summary-scoped-repair.cjs");
const archive = require("../lib/checkpoint/summary-memory-archive.cjs");
const { readDerivedSummary } = require("../lib/checkpoint/derived-summary");
for (const [label, variable] of [
  ["first local repair", "MEMORY_ENGINE_TEST_SCOPED_REPAIR_V1_RESPONSE"],
  ["identifier-hinted local repair", "MEMORY_ENGINE_TEST_SCOPED_REPAIR_RESPONSE"],
  ["native numeric v2 local repair", "MEMORY_ENGINE_TEST_NATIVE_SCOPED_REPAIR_RESPONSE"],
  ["native labelled v3 local repair", "MEMORY_ENGINE_TEST_NATIVE_LABELLED_REPAIR_RESPONSE"],
  ["scoped native labelled repair", "MEMORY_ENGINE_TEST_FOCUSED_LABELLED_REPAIR_RESPONSE"],
  ["source-bounded additive repair", "MEMORY_ENGINE_TEST_ADDITIVE_LABELLED_REPAIR_RESPONSE"]
]) test(label + " replays immutable proposal and base, preserves untargeted fields and keeps full original-record backtrace", {
  skip: process.env[variable] ? false : "set " + variable + " for the private proposal"
}, async () => {
  const responsePath = process.env[variable], directory = path.dirname(responsePath), bytes = fs.readFileSync(responsePath);
  const load = name => JSON.parse(fs.readFileSync(path.join(directory, name)));
  const input = load("fact-input.json"), inventory = load("inventory-model-output.json"), current = load("base-model-output.json");
  const request = load("request.json"), result = load("result.json"), plan = load("plan.json"), wire = JSON.parse(bytes);
  const hash = x => createHash("sha256").update(x).digest("hex");
  const originalBytes = fs.readFileSync(path.join(directory, "source.md"));
  const baseBytes = fs.readFileSync(path.join(directory, "base-model-output.json"));
  const inventoryBytes = fs.readFileSync(path.join(directory, "inventory-model-output.json"));
  assert.equal(hash(originalBytes), plan.source_sha256); assert.equal(hash(baseBytes), plan.base_response_sha256);
  assert.equal(hash(inventoryBytes), plan.inventory_response_sha256);
  const settings = plan.review_scope ? { reviewScope: plan.review_scope }
    : plan.addition_scope ? { additionScope: plan.addition_scope } : {};
  const codePath = "lib/checkpoint/summary-scoped-repair.cjs";
  assert.equal(hash(fs.readFileSync(path.join(directory, "repair-code.cjs"))), plan.code_hashes[codePath]);
  // Historical v1 prompts are not relabelled as current hinted prompts.
  if (hash(fs.readFileSync(path.join(__dirname, "..", codePath))) === plan.code_hashes[codePath])
    assert.deepEqual(repair.buildScopedRepairPrompt(input, inventory, current, settings), request);
  let calls = 0;
  const replay = await repair.runScopedRepair(input, inventory, current, async () => { calls++; return bytes.toString("utf8"); },
    settings);
  assert.equal(calls, 1);
  if (variable === "MEMORY_ENGINE_TEST_NATIVE_SCOPED_REPAIR_RESPONSE") {
    assert.equal(wire.version, repair.NUMERIC_VERSION);
    assert.equal(plan.repair_protocol, repair.NUMERIC_VERSION); assert.equal(result.generator_invocations, 1);
    assert.equal(result.generator.tool_events, 0);
    for (const change of [...wire.replacements, ...wire.moves])
      assert.ok(!Object.hasOwn(change, "expected_sha256"), "no model-copied per-part hash");
    for (const change of (replay.repairAudit ?? []).filter(x => x.action === "replace" || x.action === "move"))
      assert.equal(change.before_sha256, hash(JSON.stringify(change.before)));
  }
  if (["MEMORY_ENGINE_TEST_NATIVE_LABELLED_REPAIR_RESPONSE", "MEMORY_ENGINE_TEST_FOCUSED_LABELLED_REPAIR_RESPONSE",
    "MEMORY_ENGINE_TEST_ADDITIVE_LABELLED_REPAIR_RESPONSE"].includes(variable)) {
    assert.equal(result.status, "READY_FOR_REVIEW"); assert.equal(wire.version, repair.VERSION);
    assert.equal(plan.repair_protocol, repair.VERSION); assert.equal(result.generator_invocations, 1);
    assert.equal(result.generator.tool_events, 0); assert.equal(replay.validation.opaque_targets_resolved, true);
    for (const change of [...wire.replacements, ...wire.moves]) {
      assert.equal(typeof change.part_id, "string");
      for (const key of ["item_index", "index", "from", "expected_sha256"]) assert.ok(!Object.hasOwn(change, key));
    }
    for (const change of replay.repairAudit.filter(x => x.action === "replace" || x.action === "move"))
      assert.equal(change.before_sha256, hash(JSON.stringify(change.before)));
  }
  if (variable === "MEMORY_ENGINE_TEST_FOCUSED_LABELLED_REPAIR_RESPONSE") {
    const packet = JSON.parse(request.prompt), allowed = new Set(plan.review_scope.item_ids);
    assert.equal(wire.additions.length, 0);
    for (const change of replay.resolvedTargets) {
      const id = packet.CURRENT_SUMMARY.items[change.item_index].item_id;
      assert.ok(allowed.has(id));
    }
    current.items.forEach((row, index) => {
      if (!allowed.has(packet.CURRENT_SUMMARY.items[index].item_id)) assert.deepEqual(replay.scopedResponse.items[index], row);
    });
  }
  if (variable === "MEMORY_ENGINE_TEST_ADDITIVE_LABELLED_REPAIR_RESPONSE") {
    assert.deepEqual(wire.replacements, []); assert.deepEqual(wire.appends, []); assert.deepEqual(wire.moves, []);
    assert.ok(wire.additions.length > 0);
    assert.deepEqual(replay.scopedResponse.items.slice(0, current.items.length), current.items);
    const allowed = new Set(plan.addition_scope.source_unit_ids);
    for (const row of wire.additions) {
      const ids = [...row.evidence, ...row.corrects, ...row.conditions.flatMap(x => x.evidence), ...row.unresolved.flatMap(x => x.evidence)];
      assert.ok(ids.every(id => allowed.has(id)));
    }
  }
  if (result.status === "REJECTED") {
    assert.equal(replay.status, "REJECTED"); assert.equal(replay.error, result.error);
    assert.equal(replay.record.raw_response, bytes.toString("utf8")); assert.deepEqual(replay.record.base_summary, current);
    assert.equal(replay.publisherCalls, 0); assert.equal(replay.semantic_correctness, "NOT_CERTIFIED");
    assert.deepEqual(fs.readFileSync(responsePath), bytes);
    assert.deepEqual(fs.readFileSync(path.join(directory, "base-model-output.json")), baseBytes);
    return;
  }
  assert.equal(replay.status, "READY_FOR_REVIEW");
  assert.deepEqual(replay.patch, wire); assert.deepEqual(replay.scopedResponse, load("scoped-response.json"));
  assert.deepEqual(replay.response, load("projected-summary.json")); assert.deepEqual(replay.repairAudit, load("repair-audit.json"));
  assert.equal(replay.semantic_correctness, "NOT_CERTIFIED"); assert.equal(replay.validation.coverage, "NOT_EVALUATED");
  assert.equal(replay.validation.untargeted_fields_preserved, true); assert.equal(replay.validation.repair_validity, "MODEL_DECLARED_NOT_CERTIFIED");
  assert.equal(replay.validation.publishable, false); assert.equal(replay.bodyChars, result.body_chars); assert.ok(replay.bodyChars <= 20000);
  const targeted = new Set(replay.resolvedTargets ? replay.resolvedTargets.filter(x => x.operation !== "append")
    .map(x => [x.item_index, x.field, x.index].join(":")) : [...wire.replacements.map(x => [x.item_index, x.field, x.index].join(":")),
      ...wire.moves.map(x => [x.item_index, x.from, x.index].join(":"))]);
  current.items.forEach((row, item) => {
    const next = replay.scopedResponse.items[item];
    for (const field of ["scope", "conclusion", "evidence", "corrects"]) assert.deepEqual(next[field], row[field]);
    for (const field of ["conditions", "unresolved"]) {
      let cursor = 0;
      row[field].forEach((part, index) => {
        if (targeted.has([item, field, index].join(":"))) return;
        const found = next[field].findIndex((candidate, n) => n >= cursor && JSON.stringify(candidate) === JSON.stringify(part));
        assert.ok(found >= cursor); cursor = found + 1;
      });
    }
  });
  const records = load("input-records.json"), archivePath = path.join(directory, "archives");
  const stored = archive.loadArchive(archivePath, result.archive_id);
  assert.deepEqual(stored.payload.raw_records, records); assert.deepEqual(stored.payload.summary, replay.response);
  const resolved = readDerivedSummary(result.archive_id, { directory: archivePath, purpose: "acceptance" });
  const originals = new Map(records.map(r => [hash(r.text), r.text])); let references = 0;
  for (const item of resolved.items) for (const ref of item.sources) {
    assert.equal(originals.get(ref.source_hash).slice(ref.locator.start, ref.locator.end), ref.quote); references++;
  }
  assert.equal(references, result.verified_literal_references); assert.equal(replay.record.raw_response, bytes.toString("utf8"));
  assert.deepEqual(fs.readFileSync(responsePath), bytes);
  assert.deepEqual(fs.readFileSync(path.join(directory, "source.md")), originalBytes);
  assert.deepEqual(fs.readFileSync(path.join(directory, "base-model-output.json")), baseBytes);
  assert.deepEqual(fs.readFileSync(path.join(directory, "inventory-model-output.json")), inventoryBytes);
});

test("explicit offline conversion preserves rejected v1 bytes and operation intent while applying host-computed v2 targets", {
  skip: process.env.MEMORY_ENGINE_TEST_SCOPED_REPAIR_REBOUND_RESPONSE ? false : "set MEMORY_ENGINE_TEST_SCOPED_REPAIR_REBOUND_RESPONSE for the offline conversion"
}, () => {
  const responsePath = process.env.MEMORY_ENGINE_TEST_SCOPED_REPAIR_REBOUND_RESPONSE, directory = path.dirname(responsePath);
  const load = name => JSON.parse(fs.readFileSync(path.join(directory, name)));
  const bytes = fs.readFileSync(responsePath), patch = JSON.parse(bytes), current = load("base-model-output.json"), input = load("fact-input.json");
  const result = load("result.json"), migration = load("migration.json"), rebound = repair.rebindLegacyRepair(input, current, patch);
  assert.throws(() => repair.applyScopedRepair(input, current, patch), { code: "scoped_repair_stale" });
  assert.deepEqual(rebound.migration, migration); assert.deepEqual(rebound.migratedPatch, load("migrated-proposal.json"));
  assert.deepEqual(rebound.scopedResponse, load("scoped-response.json")); assert.deepEqual(rebound.response, load("projected-summary.json"));
  assert.equal(migration.text_or_addresses_changed, false); assert.equal(migration.model_generations, 0);
  assert.equal(migration.target_hash_comparisons.filter(x => !x.matched).length, 1);
  for (const name of ["replacements", "moves"]) {
    patch[name].forEach((old, index) => {
      const intended = structuredClone(old); delete intended.expected_sha256;
      assert.deepEqual(rebound.migratedPatch[name][index], intended);
    });
  }
  for (const name of ["appends", "additions", "findings"]) assert.deepEqual(rebound.migratedPatch[name], patch[name]);
  assert.equal(result.model_generations, 0); assert.equal(rebound.semantic_correctness, "NOT_CERTIFIED");
  assert.equal(rebound.validation.untargeted_fields_preserved, true); assert.equal(rebound.bodyChars, result.body_chars);
  const records = load("input-records.json"), archivePath = path.join(directory, "archives");
  const stored = archive.loadArchive(archivePath, result.archive_id);
  assert.deepEqual(stored.payload.raw_records, records); assert.deepEqual(stored.payload.summary, rebound.response);
  const hash = x => createHash("sha256").update(x).digest("hex");
  assert.equal(hash(bytes), result.original_model_patch_sha256);
  const originals = new Map(records.map(r => [hash(r.text), r.text])); let references = 0;
  for (const item of readDerivedSummary(result.archive_id, { directory: archivePath, purpose: "acceptance" }).items)
    for (const ref of item.sources) {
      assert.equal(originals.get(ref.source_hash).slice(ref.locator.start, ref.locator.end), ref.quote); references++;
    }
  assert.equal(references, result.verified_literal_references); assert.deepEqual(fs.readFileSync(responsePath), bytes);
});
