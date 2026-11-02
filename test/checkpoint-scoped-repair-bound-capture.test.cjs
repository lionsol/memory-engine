"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");
const repair = require("../lib/checkpoint/summary-scoped-repair.cjs");
const archive = require("../lib/checkpoint/summary-memory-archive.cjs");
const { readDerivedSummary } = require("../lib/checkpoint/derived-summary");
test("captured native host-bound review uses exact schema constants and replays without modifying the frozen base", {
  skip: process.env.MEMORY_ENGINE_TEST_BOUND_REVIEW_DIRECTORY ? false : "set MEMORY_ENGINE_TEST_BOUND_REVIEW_DIRECTORY for native capture"
}, async () => {
  const directory = process.env.MEMORY_ENGINE_TEST_BOUND_REVIEW_DIRECTORY;
  const load = name => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
  const sha = bytes => createHash("sha256").update(bytes).digest("hex");
  const plan = load("plan.json"), result = load("result.json"), request = load("request.json");
  const invocation = load("invocation.json"), schema = load("bound-output-schema.json");
  const input = load("fact-input.json"), inventory = load("inventory.json"), base = load("base-summary.json");
  const raw = fs.readFileSync(path.join(directory, "model-output.json"), "utf8");
  const wire = JSON.parse(raw), response = load("response.json"), saved = load("outcome.json");
  assert.equal(plan.maximum_new_model_generations, 1); assert.equal(result.actual_model_generations, 1);
  assert.equal(plan.manual_item_or_source_scopes, false); assert.equal(plan.manual_reference_as_input, false);
  assert.equal(plan.previous_repair_response_as_input, false);
  assert.equal(plan.identical_system_and_prompt_to_prior_failed_review, true);
  assert.equal(sha(fs.readFileSync(path.join(directory, "source.md"))), plan.source_sha256);
  assert.equal(sha(JSON.stringify(base)), plan.frozen_base_sha256);
  const previous = JSON.parse(fs.readFileSync(path.join(plan.previous_directory, "review-request.json")));
  assert.equal(request.system, previous.system); assert.equal(request.prompt, previous.prompt);
  const built = repair.buildScopedRepairPrompt(input, inventory, base, plan.limits);
  assert.equal(built.system, request.system); assert.equal(built.prompt, request.prompt);
  assert.deepEqual(request.output_bindings, { version: repair.VERSION, target_date: input.target_date,
    binding: built.binding, summary_sha256: built.summarySha256 });
  for (const [key, value] of Object.entries(request.output_bindings)) {
    assert.deepEqual(schema.properties[key].enum, [value]);
    assert.equal(wire[key], value);
  }
  const schemaHash = sha(fs.readFileSync(path.join(directory, "bound-output-schema.json")));
  assert.equal(invocation.schema_sha256, schemaHash); assert.equal(response.generator.schema_sha256, schemaHash);
  assert.equal(invocation.private_schema_mode, 0o600); assert.equal(invocation.private_directory_mode, 0o700);
  assert.deepEqual(response.generator.schema_binding_fields, Object.keys(request.output_bindings));
  assert.equal(response.generator.tool_events, 0); assert.deepEqual(response.summary, wire);
  const stdout = fs.readFileSync(path.join(directory, "stdout.jsonl"), "utf8");
  assert.equal(sha(stdout), response.generator.stdout_sha256);
  const finals = stdout.trim().split("\n").map(JSON.parse)
    .filter(x => x.type === "item.completed" && x.item?.type === "agent_message");
  assert.equal(finals.length, 1); assert.equal(finals[0].item.text, raw);
  const before = JSON.stringify(base);
  let calls = 0;
  const replay = await repair.runScopedRepair(input, inventory, base, async req => {
    calls++; assert.equal(req.system, request.system); assert.equal(req.prompt, request.prompt); return raw;
  }, plan.limits);
  assert.equal(calls, 1); assert.equal(JSON.stringify(base), before);
  assert.equal(replay.status, "READY_FOR_REVIEW"); assert.equal(saved.status, replay.status);
  assert.deepEqual(replay.scopedResponse, saved.scopedResponse); assert.deepEqual(replay.response, saved.response);
  assert.equal(replay.body, saved.body); assert.equal(replay.record.raw_response, raw);
  assert.equal(replay.semantic_correctness, "NOT_CERTIFIED"); assert.equal(replay.publisherCalls, 0);
  const records = load("input-records.json"), meta = result.reviewed;
  const archiveDirectory = path.join(directory, "reviewed-archives");
  const stored = archive.loadArchive(archiveDirectory, meta.archive_id);
  assert.deepEqual(stored.payload.raw_records, records); assert.deepEqual(stored.payload.summary, replay.response);
  const originals = new Map(records.map(r => [sha(r.text), r.text]));
  let refs = 0;
  for (const item of readDerivedSummary(meta.archive_id, { directory: archiveDirectory, purpose: "acceptance" }).items)
    for (const ref of item.sources) {
      assert.equal(originals.get(ref.source_hash).slice(ref.locator.start, ref.locator.end), ref.quote); refs++;
    }
  assert.equal(refs, meta.verified_literal_references);
  assert.equal(replay.bodyChars, meta.body_chars);
});
