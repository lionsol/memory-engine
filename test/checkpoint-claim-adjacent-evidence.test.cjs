"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const claims = require("../lib/checkpoint/summary-claim-ledger.cjs");
const compose = require("../lib/checkpoint/summary-claim-compose.cjs");
const lab = require("../lib/checkpoint/summary-adjacent-lab.cjs");
const repair = require("../lib/checkpoint/summary-scoped-repair.cjs");
const { buildFactInput } = require("../lib/checkpoint/ordinary-summary-facts");
function fixture() {
  const input = buildFactInput([
    { source: "conversation", role: "assistant", text: "上午已经重跑任务，生成正常输出。" },
    { source: "conversation", role: "assistant", text: "**报告修订阶段**\n\n本轮未运行任务。唯一动过的文件是报告。😀\n\n| 指标 | 值 |\n|---|---|\n| 核对条数 | 3 |" }
  ], "2026-10-20");
  const q = JSON.parse(claims.buildClaimPrompt(input, { referenceMode: "fragment_ids" }).prompt);
  const rows = q.SOURCE.sources.flatMap(s => s.fragments);
  const fragment = rows.find(r => r[4].includes("唯一动过")), table = rows.find(r => r[4].includes("核对条数"));
  const inventory = { version: q.version, target_date: q.target_date, binding: q.binding, dispositions: [],
    claims: [
      { id: "c1", scope: "当天操作", kind: "report", text: "助手报告未运行任务", evidence: [fragment[0]], conditions: [], corrects: [] },
      { id: "c2", scope: "报告核对", kind: "report", text: "报告核对条数为3", evidence: [table[0]], conditions: [], corrects: [] }
    ] };
  const p = JSON.parse(compose.buildClaimSummaryPrompt(input, inventory, { outputMode: "scoped_fields" }).prompt);
  const current = { version: p.version, target_date: p.target_date, binding: p.binding,
    items: [{ scope: "报告阶段", conclusion: "助手报告本轮未运行任务", conditions: [], unresolved: [],
      evidence: [fragment[1]], corrects: [] }] };
  return { input, inventory, fragment, current };
}
test("adjacent evidence copies complete source fragments beside a lossy draft without replacing source or claiming completeness", () => {
  const f = fixture(), before = JSON.stringify([f.input, f.inventory]);
  const ids = compose.buildClaimSummaryPrompt(f.input, f.inventory, { outputMode: "scoped_fields" });
  const adjacent = lab.buildAdjacentClaimSummaryPrompt(f.input, f.inventory, { outputMode: "scoped_fields" });
  const a = JSON.parse(adjacent.prompt), b = JSON.parse(ids.prompt);
  assert.deepEqual(a.SOURCE, b.SOURCE); assert.equal(a.claim_inventory.object_sha256, b.claim_inventory.object_sha256);
  assert.equal(a.claim_inventory.evidence_presentation.semantic_correctness, "NOT_CERTIFIED");
  assert.equal(a.summary_max_chars, b.summary_max_chars); assert.equal(a.summary_target_chars, b.summary_target_chars);
  assert.equal(JSON.stringify([f.input, f.inventory]), before);
  const c = a.claim_inventory.claims[0];
  assert.equal(c.text, "助手报告未运行任务", "the model draft itself is not silently repaired");
  assert.equal(c.source_evidence[0][3], f.fragment[4]); assert.match(c.source_evidence[0][3], /唯一动过的文件是报告/);
  assert.equal(c.source_evidence[0][2], "assistant");
  assert.ok(adjacent.inputChars > ids.inputChars); assert.match(adjacent.system, /草稿不能替代原文/);
  const old = { ...c }; delete old.source_evidence; delete old.source_context;
  assert.deepEqual(old, b.claim_inventory.claims[0]);
});
test("adjacent literal evidence and title/table context remain byte-exact and precede draft prose", () => {
  const f = fixture(), validated = claims.validateClaimLedger(f.input, f.inventory, { referenceMode: "fragment_ids" });
  const p = JSON.parse(lab.buildAdjacentClaimSummaryPrompt(f.input, f.inventory).prompt);
  const allContexts = new Map(validated.source_context.map(c => [c.unit_id + "\0" + c.kind + "\0" + c.quote, c]));
  assert.ok(allContexts.size > 0);
  p.claim_inventory.claims.forEach((claim, i) => {
    assert.deepEqual(claim.source_evidence, validated.claims[i].sources.map(f => [f.id, f.unit_id, f.role, f.quote]));
    for (const [unit, role, kind, quote] of claim.source_context)
      assert.equal(allContexts.get(unit + "\0" + kind + "\0" + quote).role, role);
    assert.ok(Object.keys(claim).indexOf("source_evidence") < Object.keys(claim).indexOf("text"));
  });
  assert.ok(p.claim_inventory.claims[1].source_context.some(c => c[3].includes("指标")));
});
test("the laboratory changes only its own request and leaves default composition and reviewers intact", async () => {
  const f = fixture(), before = [compose.buildClaimSummaryPrompt(f.input, f.inventory),
    repair.buildScopedRepairPrompt(f.input, f.inventory, f.current),
    repair.buildClaimAuditPrompt(f.input, f.inventory, f.current)];
  let actualChars;
  const result = await lab.runAdjacentClaimSummary(f.input, f.inventory, async request => {
    actualChars = request.inputChars;
    assert.equal(JSON.parse(request.prompt).claim_inventory.evidence_presentation.mode, "adjacent_fragments");
    return JSON.stringify(f.current);
  }, { outputMode: "scoped_fields" });
  assert.equal(result.status, "READY_FOR_REVIEW"); assert.equal(result.publisherCalls, 0);
  assert.equal(result.semantic_correctness, "NOT_CERTIFIED"); assert.equal(result.requests[0].inputChars, actualChars);
  assert.deepEqual([compose.buildClaimSummaryPrompt(f.input, f.inventory),
    repair.buildScopedRepairPrompt(f.input, f.inventory, f.current),
    repair.buildClaimAuditPrompt(f.input, f.inventory, f.current)], before);
});
test("literal adjacency cannot bypass evidence validation or input budgets and never silently truncates source", async () => {
  const f = fixture(), req = compose.buildClaimSummaryPrompt(f.input, f.inventory, { outputMode: "scoped_fields" });
  let calls = 0;
  const result = await lab.runAdjacentClaimSummary(f.input, f.inventory, async () => { calls++; },
    { outputMode: "scoped_fields", maxInputChars: req.inputChars + 1 });
  assert.equal(result.status, "REJECTED"); assert.equal(result.error, "claim_compose_input_budget"); assert.equal(calls, 0);
  const bad = structuredClone(f.inventory); bad.claims[0].evidence = ["nonexistent"];
  assert.throws(() => lab.buildAdjacentClaimSummaryPrompt(f.input, bad), { code: "claim_reference" });
  assert.throws(() => lab.buildAdjacentClaimSummaryPrompt(f.input, f.inventory, { outputMode: "unknown" }), { code: "adjacent_options" });
  assert.throws(() => lab.buildAdjacentClaimSummaryPrompt(f.input, f.inventory, { reviewScope: {} }), { code: "adjacent_options" });
});
