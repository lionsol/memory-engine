"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");
const audit = require("../lib/checkpoint/summary-claim-audit.cjs");
const archive = require("../lib/checkpoint/summary-memory-archive.cjs");
const { readDerivedSummary } = require("../lib/checkpoint/derived-summary");
test("native claim audit preserves the frozen input, raw per-claim declarations and literal source backtraces", {
  skip: process.env.MEMORY_ENGINE_TEST_CLAIM_AUDIT_REVIEW_DIRECTORY ? false : "set MEMORY_ENGINE_TEST_CLAIM_AUDIT_REVIEW_DIRECTORY"
}, async () => {
  const directory = process.env.MEMORY_ENGINE_TEST_CLAIM_AUDIT_REVIEW_DIRECTORY;
  const load = name => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
  const sha = bytes => createHash("sha256").update(bytes).digest("hex");
  const input = load("fact-input.json"), inventory = load("inventory.json"), base = load("base-summary.json");
  const plan = load("plan.json"), result = load("result.json"), saved = load("outcome.json");
  const request = load("request.json"), response = load("response.json"), invocation = load("invocation.json");
  const raw = fs.readFileSync(path.join(directory, "model-output.json"), "utf8"), wire = JSON.parse(raw);
  assert.equal(result.actual_model_generations, 1); assert.equal(plan.maximum_new_model_generations, 1);
  assert.equal(plan.manual_item_or_source_scopes, false); assert.equal(plan.manual_reference_as_input, false);
  assert.equal(plan.previous_repair_response_as_input, false); assert.equal(plan.frozen_base_identical_to_prior_reviews, true);
  assert.equal(sha(JSON.stringify(base)), plan.frozen_base_sha256);
  assert.equal(sha(fs.readFileSync(path.join(directory, "source.md"))), plan.source_sha256);
  const schemaBytes = fs.readFileSync(path.join(directory, "bound-output-schema.json"));
  const schema = JSON.parse(schemaBytes);
  for (const [key, value] of Object.entries(request.output_bindings)) {
    assert.deepEqual(schema.properties[key].enum, [value]); assert.equal(wire[key], value);
  }
  assert.equal(request.output_bindings.version, audit.VERSION);
  assert.equal(sha(schemaBytes), invocation.schema_sha256); assert.equal(sha(schemaBytes), response.generator.schema_sha256);
  assert.equal(invocation.private_schema_mode, 0o600); assert.equal(invocation.private_directory_mode, 0o700);
  const packet = JSON.parse(request.prompt);
  assert.deepEqual(packet.claim_audit.claim_ids, inventory.claims.map(c => c.id));
  assert.ok(!Object.hasOwn(packet, "review_scope")); assert.ok(!Object.hasOwn(packet, "addition_scope"));
  assert.equal(response.generator.tool_events, 0); assert.deepEqual(response.summary, wire);
  let calls = 0;
  const before = JSON.stringify([input, inventory, base]);
  const replay = await audit.runClaimAuditReview(input, inventory, base, async req => {
    calls++; assert.equal(req.system, request.system); assert.equal(req.prompt, request.prompt);
    assert.deepEqual(req.outputBindings, request.output_bindings); return raw;
  }, plan.limits);
  assert.equal(calls, 1); assert.equal(JSON.stringify([input, inventory, base]), before);
  assert.equal(replay.status, saved.status); assert.equal(replay.error, saved.error);
  assert.equal(replay.record.raw_response, raw); assert.deepEqual(replay.claimAudit, saved.claimAudit);
  assert.deepEqual(replay.claimAudit.raw_checks, wire.claim_checks);
  assert.equal(replay.semantic_correctness, "NOT_CERTIFIED"); assert.equal(replay.semantic_improvement, "NOT_EVALUATED");
  assert.equal(replay.publisherCalls, 0); assert.equal(replay.publishable, false);
  if (replay.status === "REJECTED") {
    assert.ok(!Object.hasOwn(replay, "response")); return;
  }
  assert.deepEqual(replay.scopedResponse, saved.scopedResponse); assert.equal(replay.body, saved.body);
  const records = load("input-records.json"), meta = result.reviewed, archiveDirectory = path.join(directory, "reviewed-archives");
  const stored = archive.loadArchive(archiveDirectory, meta.archive_id);
  assert.deepEqual(stored.payload.raw_records, records); assert.deepEqual(stored.payload.summary, replay.response);
  const originals = new Map(records.map(r => [sha(r.text), r.text]));
  let refs = 0;
  for (const item of readDerivedSummary(meta.archive_id, { directory: archiveDirectory, purpose: "acceptance" }).items)
    for (const ref of item.sources) {
      assert.equal(originals.get(ref.source_hash).slice(ref.locator.start, ref.locator.end), ref.quote); refs++;
    }
  assert.equal(refs, meta.verified_literal_references); assert.equal(replay.bodyChars, meta.body_chars);
});
