"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const pipeline = require("../lib/checkpoint/summary-pipeline.cjs");
const { buildFactInput } = require("../lib/checkpoint/ordinary-summary-facts");
function fixture() {
  const input = buildFactInput([{ source: "conversation", role: "assistant",
    text: "维护报告正常。\n后续验证仍需要运行证据。" }], "2026-10-20");
  const respond = request => {
    const p = JSON.parse(request.prompt);
    if (request.pipelineStage === "inventory") return { version: p.version, target_date: p.target_date, binding: p.binding,
      claims: [{ id: "c1", scope: "当次维护", kind: "report", text: "维护报告正常", conditions: [],
        corrects: [], evidence: [p.SOURCE.sources[0].fragments[0][0]] }], dispositions: [] };
    const unit = p.SOURCE.sources[0].units[0][0];
    if (request.pipelineStage === "compose") return { version: p.version, target_date: p.target_date, binding: p.binding,
      items: [{ scope: "当次维护", conclusion: "报告称维护正常", conditions: [], unresolved: [], evidence: [unit], corrects: [] }] };
    return { version: p.repair_version, target_date: p.target_date, binding: p.binding, summary_sha256: p.summary_sha256,
      replacements: [], appends: [{ item_id: p.CURRENT_SUMMARY.items[0].item_id, field: "unresolved",
        part: { scope: "后续验证", text: "仍需要运行证据", evidence: [unit] }, reason: "补回未决条件", evidence: [unit] }],
      moves: [], additions: [], findings: [] };
  };
  return { input, respond };
}
test("automatic pipeline performs exactly three fixed-schema serial generations with no human-selected repair scope", async () => {
  const f = fixture(), calls = [], saved = [];
  const result = await pipeline.runSummaryPipeline(f.input, async request => {
    const p = JSON.parse(request.prompt);
    calls.push([request.pipelineStage, request.outputContract]);
    const wire = f.respond(request);
    assert.equal(Object.isFrozen(request.outputBindings), true);
    assert.deepEqual(request.outputBindings, { version: wire.version, target_date: wire.target_date, binding: wire.binding,
      ...(request.pipelineStage === "review" ? { summary_sha256: wire.summary_sha256 } : {}) });
    assert.equal(Object.isFrozen(request), true); assert.ok(!Object.hasOwn(p, "review_scope")); assert.ok(!Object.hasOwn(p, "addition_scope"));
    assert.equal(saved.length, calls.length - 1, "each stage is checkpointed before the next request");
    return JSON.stringify(f.respond(request));
  }, { onStage: async event => { saved.push(event); } });
  assert.deepEqual(calls, [["inventory", "claim_ledger_fragments"], ["compose", "scoped_summary"], ["review", "scoped_summary_repair"]]);
  assert.equal(result.status, "READY_FOR_REVIEW"); assert.equal(result.generation_count, 3);
  assert.equal(result.semantic_correctness, "NOT_CERTIFIED"); assert.equal(result.semantic_improvement, "NOT_EVALUATED");
  assert.equal(result.publisherCalls, 0); assert.equal(result.publishable, false);
  assert.match(result.body, /需要运行证据/);
  assert.ok(!result.lastValidCandidate.body.includes("仍需要运行证据"));
  assert.equal(result.candidate_origin, "SINGLE_UNRESTRICTED_MODEL_REVIEW");
  assert.equal(saved[1].outcome.status, "READY_FOR_REVIEW");
  assert.ok(result.requests.every(x => typeof x.raw_response === "string"));
});
test("structural failure at any stage stops without retries and keeps prior stage outcomes", async () => {
  for (const [broken, expectedCalls] of [["inventory", 1], ["compose", 2], ["review", 3]]) {
    const f = fixture(); let calls = 0;
    const r = await pipeline.runSummaryPipeline(f.input, async request => {
      calls++; return request.pipelineStage === broken ? "invalid JSON" : JSON.stringify(f.respond(request));
    });
    assert.equal(r.status, "REJECTED"); assert.equal(r.failed_stage, broken); assert.equal(calls, expectedCalls);
    assert.equal(r.generation_count, expectedCalls); assert.equal(r.requests.at(-1).raw_response, "invalid JSON");
    assert.equal(r.publisherCalls, 0);
    assert.equal(Boolean(r.lastValidCandidate), broken === "review");
    assert.ok(!Object.hasOwn(r, "response"), "a prior candidate is not relabelled as a successful reviewed result");
  }
});
test("invalid review target preserves the valid composed candidate but cannot silently apply or fall back", async () => {
  const f = fixture();
  const r = await pipeline.runSummaryPipeline(f.input, async request => {
    const wire = f.respond(request);
    if (request.pipelineStage === "review") wire.appends[0].item_id = "i999";
    return JSON.stringify(wire);
  });
  assert.equal(r.status, "REJECTED"); assert.equal(r.error, "scoped_repair_target");
  assert.equal(r.failed_stage, "review"); assert.equal(r.stages.compose.status, "READY_FOR_REVIEW");
  assert.equal(r.lastValidCandidate.stage, "compose"); assert.equal(r.stages.review.status, "REJECTED");
  assert.equal(r.candidate_origin, null); assert.equal(r.generation_count, 3);
});
test("manual scopes, unknown options and pre-cancel are rejected before generation", async () => {
  for (const settings of [{ reviewScope: { item_ids: ["i001"], question: "manual" } },
    { additionScope: { source_unit_ids: ["s0"], question: "manual" } }, { retry: 1 }, { summaryMaxChars: 0 },
    { signal: AbortSignal.abort() }]) {
    const f = fixture(); let calls = 0;
    const r = await pipeline.runSummaryPipeline(f.input, async () => { calls++; }, settings);
    assert.equal(r.status, "REJECTED"); assert.equal(calls, 0); assert.equal(r.generation_count, 0);
  }
});
test("cancellation after response retains raw output even when a child stage rejects before recording it", async () => {
  for (const cancelAt of ["inventory", "compose", "review"]) {
    const f = fixture(), controller = new AbortController(); let raw;
    const r = await pipeline.runSummaryPipeline(f.input, async request => {
      raw = JSON.stringify(f.respond(request)); if (request.pipelineStage === cancelAt) controller.abort(); return raw;
    }, { signal: controller.signal });
    assert.equal(r.status, "REJECTED"); assert.equal(r.failed_stage, cancelAt);
    assert.equal(r.requests.at(-1).raw_response, raw); assert.equal(r.publisherCalls, 0);
  }
});
test("stage checkpoint failure stops subsequent generations and cannot leak checkpoint diagnostics", async () => {
  const f = fixture(); let calls = 0;
  const r = await pipeline.runSummaryPipeline(f.input, async request => { calls++; return JSON.stringify(f.respond(request)); },
    { onStage: async () => { throw Error("private checkpoint path and diagnostic"); } });
  assert.equal(calls, 1); assert.equal(r.error, "pipeline_checkpoint_failed");
  assert.equal(r.stages.inventory.status, "READY_FOR_REVIEW");
  assert.ok(!JSON.stringify(r).includes("private checkpoint"));
});
test("source changes abort the pipeline while checkpoint consumers cannot mutate its internal outcomes", async () => {
  const f = fixture(), original = structuredClone(f.input);
  const r = await pipeline.runSummaryPipeline(f.input, async request => JSON.stringify(f.respond(request)), {
    onStage: async event => {
      event.outcome.status = "changed externally";
      if (event.stage === "compose") { f.input.sources[0].units[0].text += "!"; f.input.sources[0].units[0].end++; }
    }
  });
  assert.equal(r.status, "REJECTED"); assert.equal(r.error, "pipeline_source_changed"); assert.equal(r.generation_count, 2);
  assert.equal(r.stages.inventory.status, "READY_FOR_REVIEW"); assert.equal(r.stages.compose.status, "READY_FOR_REVIEW");
  assert.deepEqual(r.record.source, original);
});
