"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");
const compose = require("../lib/checkpoint/summary-claim-compose.cjs");
const lab = require("../lib/checkpoint/summary-adjacent-lab.cjs");
const claims = require("../lib/checkpoint/summary-claim-ledger.cjs");
const archive = require("../lib/checkpoint/summary-memory-archive.cjs");
const { readDerivedSummary } = require("../lib/checkpoint/derived-summary");
test("paired native composition changes only evidence presentation and preserves both raw outcomes and full backtraces", {
  skip: process.env.MEMORY_ENGINE_TEST_ADJACENT_COMPOSE_DIRECTORY ? false : "set MEMORY_ENGINE_TEST_ADJACENT_COMPOSE_DIRECTORY"
}, async () => {
  const directory = process.env.MEMORY_ENGINE_TEST_ADJACENT_COMPOSE_DIRECTORY;
  const load = name => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  const plan = load("plan.json"), result = load("result.json");
  const input = load("fact-input.json"), inventory = load("inventory.json"), records = load("input-records.json");
  const originalBytes = fs.readFileSync(path.join(directory, "original-inventory-output.json"));
  assert.equal(hash(originalBytes), plan.raw_inventory_sha256);
  assert.deepEqual(JSON.parse(originalBytes).claims, inventory.claims);
  assert.equal(plan.historical_inventory_as_input, true); assert.equal(plan.all_original_claims_retained, true);
  assert.equal(plan.new_inventory_generations, 0); assert.equal(plan.prior_summary_or_repair_as_input, false);
  assert.equal(plan.manual_reference_as_input, false); assert.equal(plan.manual_scopes, false);
  assert.equal(result.actual_model_generations, 2); assert.equal(plan.maximum_new_model_generations, 2);
  assert.equal(hash(fs.readFileSync(path.join(directory, "source.md"))), plan.source_sha256);
  assert.equal(hash(JSON.stringify(inventory)), plan.inventory_sha256);
  const idsPacket = JSON.parse(load("ids-request.json").prompt);
  const adjacentRequest = load("adjacent-request.json"), adjacentPacket = JSON.parse(adjacentRequest.prompt);
  assert.equal(adjacentRequest.system, load("ids-request.json").system + "\n" + lab.SOURCE_EVIDENCE_RULE);
  assert.deepEqual(adjacentPacket.SOURCE, idsPacket.SOURCE);
  assert.equal(adjacentPacket.claim_inventory.object_sha256, idsPacket.claim_inventory.object_sha256);
  const checked = claims.validateClaimLedger(input, inventory, { referenceMode: "fragment_ids" });
  adjacentPacket.claim_inventory.claims.forEach((c, n) => {
    const refs = checked.claims[n].sources, contexts = new Map(checked.source_context.map(c => [c.id, c]));
    assert.deepEqual(c.source_evidence, refs.map(f => [f.id, f.unit_id, f.role, f.quote]));
    assert.deepEqual(c.source_context, [...new Set(refs.flatMap(f => f.context_ids))].map(id => {
      const context = contexts.get(id); return [context.unit_id, context.role, context.kind, context.quote];
    }));
    assert.ok(Object.keys(c).indexOf("source_evidence") < Object.keys(c).indexOf("text"));
    delete c.source_evidence; delete c.source_context;
  });
  delete adjacentPacket.claim_inventory.evidence_presentation;
  assert.deepEqual(adjacentPacket, idsPacket);
  const originals = new Map(records.map(r => [hash(r.text), r.text]));
  for (const arm of plan.arms) {
    const prefix = name => arm.name + "-" + name;
    const request = load(prefix("request.json")), saved = load(prefix("outcome.json"));
    const responsePath = path.join(directory, prefix("response.json")), hasResponse = fs.existsSync(responsePath);
    const rawPath = path.join(directory, prefix("model-output.json"));
    const raw = fs.existsSync(rawPath) ? fs.readFileSync(rawPath, "utf8") : null;
    const schemaBytes = fs.readFileSync(path.join(directory, prefix("bound-output-schema.json")));
    const schema = JSON.parse(schemaBytes), invocation = load(prefix("invocation.json"));
    assert.equal(request.inputChars, arm.input_chars); assert.equal(hash(schemaBytes), invocation.schema_sha256);
    for (const [key, value] of Object.entries(request.output_bindings)) assert.deepEqual(schema.properties[key].enum, [value]);
    if (hasResponse) {
      const response = load(prefix("response.json"));
      assert.deepEqual(response.summary, JSON.parse(raw)); assert.equal(hash(schemaBytes), response.generator.schema_sha256);
      assert.equal(response.generator.tool_events, 0);
      for (const [key, value] of Object.entries(request.output_bindings)) assert.equal(response.summary[key], value);
      assert.equal(hash(fs.readFileSync(path.join(directory, prefix("stdout.jsonl")))), response.generator.stdout_sha256);
    }
    const run = arm.evidenceMode === "adjacent_fragments" ? lab.runAdjacentClaimSummary : compose.runClaimSummary;
    let calls = 0;
    const replay = await run(input, inventory, async req => {
      calls++; assert.equal(req.system, request.system); assert.equal(req.prompt, request.prompt);
      if (!hasResponse) throw Object.assign(new Error("captured transport failure"), { code: saved.error });
      return raw;
    }, plan.settings);
    assert.equal(calls, 1); assert.equal(replay.status, saved.status); assert.equal(replay.error, saved.error);
    assert.equal(replay.record.raw_response, hasResponse ? raw : null);
    assert.equal(replay.semantic_correctness, "NOT_CERTIFIED"); assert.equal(replay.publisherCalls, 0);
    assert.deepEqual(replay.record.inventory, inventory);
    if (replay.status !== "READY_FOR_REVIEW") continue;
    assert.deepEqual(replay.scopedResponse, saved.scopedResponse); assert.equal(replay.body, saved.body);
    const meta = result.arms[arm.name].candidate, archiveDirectory = path.join(directory, arm.name + "-archives");
    const stored = archive.loadArchive(archiveDirectory, meta.archive_id);
    assert.deepEqual(stored.payload.raw_records, records); assert.deepEqual(stored.payload.summary, replay.response);
    let refs = 0;
    for (const item of readDerivedSummary(meta.archive_id, { directory: archiveDirectory, purpose: "acceptance" }).items)
      for (const ref of item.sources) {
        assert.equal(originals.get(ref.source_hash).slice(ref.locator.start, ref.locator.end), ref.quote); refs++;
      }
    assert.equal(refs, meta.literal_references); assert.equal(replay.bodyChars, meta.body_chars);
  }
});

test("model-only composition control keeps baseline prompt and schema identical while recording the requested model or timeout", {
  skip: process.env.MEMORY_ENGINE_TEST_COMPOSITION_MODEL_CONTROL_DIRECTORY ? false
    : "set MEMORY_ENGINE_TEST_COMPOSITION_MODEL_CONTROL_DIRECTORY"
}, async () => {
  const directory = process.env.MEMORY_ENGINE_TEST_COMPOSITION_MODEL_CONTROL_DIRECTORY;
  const load = name => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  const plan = load("plan.json"), result = load("result.json"), request = load("sol-request.json");
  const saved = load("sol-outcome.json"), input = load("fact-input.json"), inventory = load("inventory.json");
  const baselineRequest = JSON.parse(fs.readFileSync(path.join(plan.comparison_directory, "ids-request.json")));
  assert.equal(plan.identical_system_and_prompt_to_baseline, true); assert.equal(result.actual_model_generations, 1);
  assert.equal(plan.maximum_new_model_generations, 1); assert.equal(plan.model, "gpt-6.1-sol");
  assert.equal(plan.prior_summary_or_repair_as_input, false); assert.equal(plan.manual_reference_as_input, false);
  assert.equal(plan.manual_scopes, false); assert.equal(plan.new_inventory_generations, 0);
  assert.equal(request.system, baselineRequest.system); assert.equal(request.prompt, baselineRequest.prompt);
  const schemaBytes = fs.readFileSync(path.join(directory, "sol-bound-output-schema.json"));
  assert.deepEqual(schemaBytes, fs.readFileSync(path.join(plan.comparison_directory, "ids-bound-output-schema.json")));
  const invocation = load("sol-invocation.json");
  assert.equal(invocation.args[invocation.args.indexOf("--model") + 1], "gpt-6.1-sol");
  const responseFile = path.join(directory, "sol-response.json"), hasResponse = fs.existsSync(responseFile);
  const rawFile = path.join(directory, "sol-model-output.json");
  const raw = fs.existsSync(rawFile) ? fs.readFileSync(rawFile, "utf8") : null;
  if (hasResponse) {
    const response = load("sol-response.json");
    const baseline = JSON.parse(fs.readFileSync(path.join(plan.comparison_directory, "ids-response.json")));
    assert.equal(response.generator.model, "gpt-6.1-sol"); assert.equal(response.generator.reasoning_effort, "xhigh");
    assert.equal(response.generator.model_identity, "requested_not_provider_verified");
    assert.equal(response.generator.stdin_sha256, baseline.generator.stdin_sha256);
    assert.equal(response.generator.schema_sha256, hash(schemaBytes)); assert.deepEqual(response.summary, JSON.parse(raw));
  }
  let calls = 0;
  const replay = await compose.runClaimSummary(input, inventory, async req => {
    calls++; assert.equal(req.system, request.system); assert.equal(req.prompt, request.prompt);
    if (!hasResponse) throw Object.assign(new Error("captured transport failure"), { code: saved.error });
    return raw;
  }, plan.settings);
  assert.equal(calls, 1); assert.equal(replay.status, saved.status); assert.equal(replay.error, saved.error);
  assert.equal(replay.semantic_correctness, "NOT_CERTIFIED"); assert.equal(replay.publisherCalls, 0);
  if (replay.status !== "READY_FOR_REVIEW") return;
  assert.deepEqual(replay.scopedResponse, saved.scopedResponse); assert.equal(replay.body, saved.body);
  const meta = result.arms.sol.candidate, archiveDirectory = path.join(directory, "sol-archives"), records = load("input-records.json");
  const stored = archive.loadArchive(archiveDirectory, meta.archive_id);
  assert.deepEqual(stored.payload.raw_records, records); assert.deepEqual(stored.payload.summary, replay.response);
  const originals = new Map(records.map(r => [hash(r.text), r.text]));
  let refs = 0;
  for (const item of readDerivedSummary(meta.archive_id, { directory: archiveDirectory, purpose: "acceptance" }).items)
    for (const ref of item.sources) {
      assert.equal(originals.get(ref.source_hash).slice(ref.locator.start, ref.locator.end), ref.quote); refs++;
    }
  assert.equal(refs, meta.literal_references); assert.equal(replay.bodyChars, meta.body_chars);
});
