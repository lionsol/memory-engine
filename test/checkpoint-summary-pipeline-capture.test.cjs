"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");
const { runSummaryPipeline } = require("../lib/checkpoint/summary-pipeline.cjs");
const archive = require("../lib/checkpoint/summary-memory-archive.cjs");
const { readDerivedSummary } = require("../lib/checkpoint/derived-summary");
for (const [label, variable] of [["legacy explicit resume", "MEMORY_ENGINE_TEST_SUMMARY_PIPELINE_DIRECTORY"],
  ["fresh claim-audit pipeline", "MEMORY_ENGINE_TEST_CLAIM_AUDIT_PIPELINE_DIRECTORY"]]) {
test("captured " + label + " preserves stage outputs without human scopes or answer substitution", {
  skip: process.env[variable] ? false : "set " + variable + " for the complete experiment"
}, async () => {
  const directory = process.env[variable];
  const load = name => JSON.parse(fs.readFileSync(path.join(directory, name)));
  const plan = load("plan.json"), result = load("result.json"), saved = load("pipeline-result.json");
  const input = load("fact-input.json"), records = load("input-records.json"), bytes = fs.readFileSync(path.join(directory, "source.md"));
  const hash = value => createHash("sha256").update(value).digest("hex");
  assert.equal(hash(bytes), plan.source_sha256);
  assert.equal(plan.manual_item_or_source_scopes, false);
  if (plan.explicit_inventory_resume) {
    assert.equal(plan.explicit_inventory_resume.kind, "SAME_ATTEMPT_RAW_RESPONSE");
    assert.equal(plan.manual_repaired_answers_as_input, false);
    const from = plan.explicit_inventory_resume.from;
    const original = fs.readFileSync(path.join(from, "inventory-model-output.json"));
    assert.equal(hash(original), plan.explicit_inventory_resume.response_sha256);
    assert.deepEqual(fs.readFileSync(path.join(directory, "inventory-model-output.json")), original);
    const originalRequest = JSON.parse(fs.readFileSync(path.join(from, "inventory-request.json")));
    const resumedRequest = load("inventory-request.json");
    assert.equal(resumedRequest.system, originalRequest.system); assert.equal(resumedRequest.prompt, originalRequest.prompt);
  } else assert.equal(plan.historical_model_outputs_as_input, false);
  assert.equal(plan.manual_reference_as_input, false); assert.equal(plan.maximum_logical_generations, 3);
  assert.equal(hash(fs.readFileSync(path.join(directory, "pipeline-code.cjs"))), plan.code_hashes["lib/checkpoint/summary-pipeline.cjs"]);
  let calls = 0;
  const replay = await runSummaryPipeline(input, async request => {
    calls++;
    const stage = request.pipelineStage, expected = load(stage + "-request.json"), p = JSON.parse(request.prompt);
    assert.equal(request.system, expected.system); assert.equal(request.prompt, expected.prompt);
    assert.equal(request.inputChars, expected.inputChars); assert.equal(request.outputContract, expected.output_contract);
    assert.ok(!Object.hasOwn(p, "review_scope")); assert.ok(!Object.hasOwn(p, "addition_scope"));
    const rawPath = path.join(directory, stage + "-model-output.json");
    if (fs.existsSync(rawPath)) {
      const raw = fs.readFileSync(rawPath, "utf8");
      if (expected.output_bindings) {
        assert.deepEqual(request.outputBindings, expected.output_bindings);
        const schemaBytes = fs.readFileSync(path.join(directory, stage + "-bound-output-schema.json"));
        const schema = JSON.parse(schemaBytes), invocation = load(stage + "-invocation.json"), response = load(stage + "-response.json");
        const wire = JSON.parse(raw);
        for (const [key, value] of Object.entries(expected.output_bindings)) {
          assert.deepEqual(schema.properties[key].enum, [value]); assert.equal(wire[key], value);
        }
        assert.equal(hash(schemaBytes), invocation.schema_sha256);
        assert.equal(hash(schemaBytes), response.generator.schema_sha256);
        assert.equal(invocation.private_schema_mode, 0o600); assert.equal(invocation.private_directory_mode, 0o700);
        assert.equal(response.generator.tool_events, 0); assert.deepEqual(response.summary, wire);
        assert.equal(hash(fs.readFileSync(path.join(directory, stage + "-stdout.jsonl"))), response.generator.stdout_sha256);
      }
      return raw;
    }
    const failed = load(stage + "-outcome.json");
    throw Object.assign(new Error("captured transport failure"), { code: failed.error });
  }, plan.limits);
  assert.equal(replay.status, saved.status); assert.equal(replay.generation_count, saved.generation_count);
  assert.equal(calls, saved.generation_count); assert.ok(calls <= 3);
  assert.equal(replay.semantic_correctness, "NOT_CERTIFIED"); assert.equal(replay.semantic_improvement, "NOT_EVALUATED");
  assert.equal(replay.publishable, false); assert.equal(replay.publisherCalls, 0);
  assert.deepEqual(replay.record.source, input);
  for (const stage of ["inventory", "compose", "review"]) if (saved.stages[stage]) {
    assert.equal(replay.stages[stage].status, saved.stages[stage].status);
    assert.equal(replay.stages[stage].record.raw_response, saved.stages[stage].record.raw_response);
  }
  if (saved.stages.compose?.status === "READY_FOR_REVIEW") {
    assert.deepEqual(replay.stages.compose.record.inventory, replay.stages.inventory.effective_ledger ?? replay.stages.inventory.ledger);
    assert.deepEqual(replay.lastValidCandidate.scopedResponse, replay.stages.compose.scopedResponse);
  }
  if (saved.stages.review) assert.deepEqual(replay.stages.review.record.base_summary, replay.stages.compose.scopedResponse);
  if (replay.status === "READY_FOR_REVIEW") {
    assert.deepEqual(replay.response, saved.response); assert.deepEqual(replay.scopedResponse, saved.scopedResponse);
    assert.equal(replay.body, saved.body); assert.ok(replay.bodyChars <= plan.limits.summaryMaxChars);
    assert.equal(replay.candidate_origin, plan.limits.reviewMode === "claim_audit"
      ? "SINGLE_CLAIM_AUDIT_MODEL_REVIEW" : "SINGLE_UNRESTRICTED_MODEL_REVIEW");
    if (plan.limits.reviewMode === "claim_audit") {
      assert.equal(calls, 3);
      assert.deepEqual(replay.stages.review.claimAudit, saved.stages.review.claimAudit);
      assert.deepEqual(replay.stages.review.claimAudit.raw_checks, load("review-model-output.json").claim_checks);
    }
  } else {
    assert.equal(replay.error, saved.error); assert.equal(replay.failed_stage, saved.failed_stage);
    assert.ok(!Object.hasOwn(replay, "response"));
  }
  const originals = new Map(records.map(r => [hash(r.text), r.text]));
  for (const [label, candidate] of [["composed", replay.lastValidCandidate],
    ["reviewed", replay.status === "READY_FOR_REVIEW" ? replay : null]]) {
    if (!result[label]) continue;
    const meta = result[label], archivePath = path.join(directory, label + "-archives");
    const stored = archive.loadArchive(archivePath, meta.archive_id);
    assert.deepEqual(stored.payload.raw_records, records); assert.deepEqual(stored.payload.summary, candidate.response);
    let refs = 0;
    for (const item of readDerivedSummary(meta.archive_id, { directory: archivePath, purpose: "acceptance" }).items)
      for (const ref of item.sources) {
        assert.equal(originals.get(ref.source_hash).slice(ref.locator.start, ref.locator.end), ref.quote); refs++;
      }
    assert.equal(refs, meta.verified_literal_references);
    assert.equal(candidate.bodyChars, meta.body_chars);
  }
  assert.deepEqual(fs.readFileSync(path.join(directory, "source.md")), bytes);
});
}
