"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");
const claims = require("../lib/checkpoint/summary-claim-ledger.cjs");
test("native fragment vocabulary is the exact frozen source set; earlier invented references remain rejected", {
  skip: process.env.MEMORY_ENGINE_TEST_REFERENCE_BOUND_INVENTORY_DIRECTORY ? false
    : "set MEMORY_ENGINE_TEST_REFERENCE_BOUND_INVENTORY_DIRECTORY"
}, async () => {
  const directory = process.env.MEMORY_ENGINE_TEST_REFERENCE_BOUND_INVENTORY_DIRECTORY;
  const load = name => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
  const hash = value => createHash("sha256").update(value).digest("hex");
  const plan = load("plan.json"), request = load("request.json"), result = load("result.json");
  const input = load("fact-input.json"), records = load("input-records.json");
  const rawPath = path.join(directory, "model-output.json"), responsePath = path.join(directory, "response.json");
  const raw = fs.existsSync(rawPath) ? fs.readFileSync(rawPath, "utf8") : null, wire = raw && JSON.parse(raw);
  const response = fs.existsSync(responsePath) ? load("response.json") : null;
  const saved = load("outcome.json"), invocation = load("invocation.json");
  assert.equal(plan.maximum_new_model_generations, 1); assert.equal(result.actual_model_generations, 1);
  assert.equal(plan.historical_model_responses_as_input, false); assert.equal(plan.manual_reference_as_input, false);
  assert.equal(plan.manual_scopes, false); assert.equal(plan.identical_system_and_prompt, true);
  assert.equal(hash(fs.readFileSync(path.join(directory, "source.md"))), plan.source_sha256);
  const oldRequest = JSON.parse(fs.readFileSync(path.join(plan.previous_failed_directory, "inventory-request.json")));
  assert.equal(request.system, oldRequest.system); assert.equal(request.prompt, oldRequest.prompt);
  const packet = JSON.parse(request.prompt), ids = packet.SOURCE.sources.flatMap(s => s.fragments.map(f => f[0]));
  assert.deepEqual(request.evidence_ids, ids); assert.deepEqual(plan.evidence_ids, ids);
  const schemaBytes = fs.readFileSync(path.join(directory, "bound-output-schema.json")), schema = JSON.parse(schemaBytes);
  assert.deepEqual(schema.properties.claims.items.properties.evidence.items.enum, ids);
  assert.ok(!Object.hasOwn(schema.properties.dispositions.items.properties.fragment, "enum"));
  for (const [key, value] of Object.entries(request.output_bindings)) {
    assert.deepEqual(schema.properties[key].enum, [value]); if (wire) assert.equal(wire[key], value);
  }
  if (response) {
    assert.equal(response.generator.schema_evidence_id_count, ids.length);
    assert.equal(hash(schemaBytes), response.generator.schema_sha256);
    assert.deepEqual(response.summary, wire);
  }
  assert.equal(hash(schemaBytes), invocation.schema_sha256);
  assert.equal(invocation.private_schema_mode, 0o600); assert.equal(invocation.private_directory_mode, 0o700);
  const allowed = new Set(ids);
  if (wire) assert.ok(wire.claims.every(c => c.evidence.every(id => allowed.has(id))));
  let calls = 0;
  const replay = await claims.runClaimInventory(input, async req => {
    calls++; assert.equal(req.system, request.system); assert.equal(req.prompt, request.prompt);
    assert.deepEqual(req.evidenceIds, ids);
    if (!response) throw Object.assign(new Error("captured transport failure"), { code: saved.error });
    return raw;
  }, plan.settings);
  assert.equal(calls, 1); assert.equal(replay.status, saved.status); assert.equal(replay.error, saved.error);
  assert.equal(replay.record.raw_response, response ? raw : null);
  assert.equal(replay.semantic_correctness, "NOT_CERTIFIED");
  if (!response) {
    assert.equal(saved.status, "REJECTED"); assert.equal(saved.error, "derived_cli_timeout");
    assert.equal(raw, null, "a timeout without a final answer is not relabelled as successful evidence");
    assert.ok(!Object.hasOwn(replay, "ledger"));
  }
  assert.equal(replay.publisherCalls, 0); assert.equal(replay.publishable, false);
  if (saved.status === "READY_FOR_REVIEW") {
    assert.deepEqual(replay.ledger, saved.ledger); assert.deepEqual(replay.effective_ledger, saved.effective_ledger);
    const originals = new Map(records.map(r => [hash(r.text), r.text]));
    let refs = 0;
    for (const claim of replay.claims) for (const ref of claim.sources) {
      assert.equal(originals.get(ref.source_hash).slice(ref.start, ref.end), ref.quote); refs++;
    }
    for (const ref of replay.source_context)
      assert.equal(originals.get(ref.source_hash).slice(ref.start, ref.end), ref.quote);
    assert.equal(refs, result.literal_references);
  }
  const previousRaw = fs.readFileSync(path.join(plan.previous_failed_directory, "inventory-model-output.json"), "utf8");
  const rejected = await claims.runClaimInventory(input, async () => previousRaw, plan.settings);
  assert.equal(rejected.status, "REJECTED"); assert.equal(rejected.error, "claim_reference");
  assert.equal(rejected.record.raw_response, previousRaw, "the original invalid reference was never normalized");
});

test("native 435-ID schema contract succeeds without treating a JSON key-order harness finding as a model failure", {
  skip: process.env.MEMORY_ENGINE_TEST_REFERENCE_ENUM_CONTRACT_DIRECTORY ? false
    : "set MEMORY_ENGINE_TEST_REFERENCE_ENUM_CONTRACT_DIRECTORY"
}, () => {
  const directory = process.env.MEMORY_ENGINE_TEST_REFERENCE_ENUM_CONTRACT_DIRECTORY;
  const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  const plan = read("plan.json"), request = read("request.json"), response = read("response.json");
  const original = read("result.json"), offline = read("offline-verification.json");
  assert.equal(plan.maximum_model_generations, 1); assert.equal(original.actual_model_generations, 1);
  assert.equal(original.semantic_quality_evaluation, false); assert.equal(original.full_inventory_success, false);
  assert.equal(original.status, "REJECTED"); assert.equal(original.error, "contract_smoke_failed");
  assert.equal(offline.status, "VERIFIED_CONTRACT_ONLY"); assert.equal(offline.new_model_generations, 0);
  assert.equal(offline.raw_summary_changed, false); assert.equal(offline.full_inventory_success, false);
  assert.deepEqual(response.summary, JSON.parse(request.prompt));
  assert.notEqual(JSON.stringify(response.summary), request.prompt, "only serialization key order differs");
  const schemaBytes = fs.readFileSync(path.join(directory, "bound-output-schema.json")), schema = JSON.parse(schemaBytes);
  assert.deepEqual(schema.properties.claims.items.properties.evidence.items.enum, plan.evidence_ids);
  assert.equal(plan.evidence_ids.length, 435); assert.equal(response.generator.schema_evidence_id_count, 435);
  assert.equal(hash(schemaBytes), response.generator.schema_sha256); assert.equal(response.generator.process_exit_code, 0);
  assert.equal(response.generator.tool_events, 0);
  const stdout = fs.readFileSync(path.join(directory, "stdout.jsonl"));
  assert.equal(hash(stdout), response.generator.stdout_sha256);
  const final = stdout.toString("utf8").trim().split("\n").map(JSON.parse)
    .filter(x => x.type === "item.completed" && x.item?.type === "agent_message");
  assert.equal(final.length, 1); assert.deepEqual(JSON.parse(final[0].item.text), response.summary);
});
