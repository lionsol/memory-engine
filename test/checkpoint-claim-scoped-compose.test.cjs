"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const compose = require("../lib/checkpoint/summary-claim-compose.cjs");
const claims = require("../lib/checkpoint/summary-claim-ledger.cjs");
const summaries = require("../lib/checkpoint/summary-comparison-lab.cjs");
const { buildFactInput } = require("../lib/checkpoint/ordinary-summary-facts");
function fixture() {
  const input = buildFactInput([{ text: "A路径：记录消失不能计成功。\nB路径：无需恢复时计数为0正常。\n调查阶段没有写库。", role: "user", source: "conversation" }], "2026-10-20");
  const packet = JSON.parse(claims.buildClaimPrompt(input, { referenceMode: "fragment_ids" }).prompt);
  const fragment = packet.SOURCE.sources[0].fragments[0], units = input.sources[0].units;
  const inventory = { version: packet.version, target_date: packet.target_date, binding: packet.binding,
    claims: [{ id: "c1", scope: "验收", kind: "decision", text: "A与B按各自条件验收", evidence: [fragment[0]], conditions: [], corrects: [] }],
    dispositions: [] };
  const request = compose.buildClaimSummaryPrompt(input, inventory, { outputMode: "scoped_fields" });
  const p = JSON.parse(request.prompt), unit = units[0].id;
  const wire = { version: p.version, target_date: p.target_date, binding: p.binding,
    items: [{ scope: "后续验收", conclusion: "用户决定分别核验两个路径",
      conditions: [{ scope: "A路径", text: "记录消失不能计成功。", evidence: [unit] },
        { scope: "B路径", text: "无需恢复时计数为0正常。", evidence: [unit] }],
      unresolved: [{ scope: "运行归因", text: "尚待自然运行后核验😀", evidence: [unit] }],
      evidence: [unit], corrects: [] }] };
  return { input, inventory, request, wire, unit };
}
test("scoped experiment keeps original source and inventory while requesting explicit condition ownership", () => {
  const f = fixture(), scoped = JSON.parse(f.request.prompt);
  const proseRequest = compose.buildClaimSummaryPrompt(f.input, f.inventory), prose = JSON.parse(proseRequest.prompt);
  assert.deepEqual(scoped.SOURCE, prose.SOURCE); assert.deepEqual(scoped.claim_inventory, prose.claim_inventory);
  assert.equal(scoped.binding, prose.binding); assert.equal(scoped.summary_max_chars, 20000);
  assert.equal(scoped.summary_target_chars, 14000); assert.equal(scoped.stage, "claim_compose_scoped");
  assert.match(f.request.system, /每一条件\/未决的scope与text/);
  assert.ok(!f.request.system.includes("每项通常1至2句"));
  assert.ok(!f.request.system.includes('items每项为{"topic"'));
  assert.ok(proseRequest.system.includes("每项通常1至2句"));
  assert.throws(() => compose.buildClaimSummaryPrompt(f.input, f.inventory, { outputMode: "unknown" }), { code: "claim_compose_options" });
});
test("all accepted conclusion, condition scopes/text and unresolved fields survive deterministic presentation in order", () => {
  const f = fixture(), before = structuredClone(f.wire);
  const result = compose.projectScopedSummary(f.input, f.wire);
  assert.deepEqual(f.wire, before); assert.deepEqual(result.scopedResponse, before);
  const row = f.wire.items[0], text = result.response.items[0].text;
  assert.ok(text.startsWith(row.conclusion));
  let position = row.conclusion.length;
  for (const field of ["conditions", "unresolved"]) for (const part of row[field]) {
    const next = text.indexOf("（" + part.scope + "）：" + part.text, position);
    assert.ok(next >= position); position = next + part.scope.length + part.text.length;
  }
  assert.match(result.body, /条件（A路径）：记录消失不能计成功/);
  assert.match(result.body, /条件（B路径）：无需恢复时计数为0正常/);
  assert.equal(result.validation.scoped_fields_preserved, true);
  assert.equal(result.validation.scope_association, "MODEL_DECLARED_NOT_CERTIFIED");
  assert.equal(result.validation.semantic_correctness, "NOT_EVALUATED");
  assert.equal(result.validation.publishable, false);
});
test("condition and unresolved citations are included in final backtrace even when absent from conclusion references", () => {
  const f = fixture();
  const source = buildFactInput([{ text: "第一项", role: "user", source: "conversation" }, { text: "第二项", role: "assistant", source: "conversation" }], "2026-10-20");
  const ids = source.sources.flatMap(s => s.units.map(u => u.id));
  f.wire.binding = JSON.parse(summaries.buildPrompt(source, "direct").prompt).binding;
  f.wire.items[0].evidence = [ids[0]];
  f.wire.items[0].conditions.forEach(p => { p.evidence = [ids[1], ids[1]]; });
  f.wire.items[0].unresolved[0].evidence = [ids[1]];
  const r = compose.projectScopedSummary(source, f.wire);
  assert.deepEqual(r.response.items[0].evidence, ids);
  assert.deepEqual(r.evidence.map(e => e.id), ids);
});
test("missing scopes, evidence, nested text and unexpected fields are rejected rather than repaired or omitted", () => {
  const changes = [
    w => { delete w.items[0].conditions[0].scope; },
    w => { w.items[0].conditions[0].scope = ""; },
    w => { w.items[0].unresolved[0].evidence = []; },
    w => { w.items[0].conditions[0].text = 42; },
    w => { w.items[0].conditions[0].extra = "ignored?"; },
    w => { w.items[0].conditions = null; },
    w => { w.items[0].conditions = Array(129).fill(w.items[0].conditions[0]); },
    w => { w.items[0].evidence = []; },
  ];
  for (const change of changes) {
    const f = fixture(); change(f.wire);
    assert.throws(() => compose.projectScopedSummary(f.input, f.wire), { code: "claim_compose_scoped_schema" });
  }
});
test("every scoped citation is checked against source binding and the entire rendered body is budgeted", () => {
  for (const field of ["conditions", "unresolved"]) {
    const f = fixture(); f.wire.items[0][field][0].evidence = ["c1"];
    assert.throws(() => compose.projectScopedSummary(f.input, f.wire), { code: "comparison_reference" });
  }
  const f = fixture();
  assert.throws(() => compose.projectScopedSummary(f.input, f.wire, { summaryMaxChars: 10 }), { code: "comparison_summary_budget" });
  f.wire.binding = "wrong";
  assert.throws(() => compose.projectScopedSummary(f.input, f.wire), { code: "comparison_binding" });
});
test("scoped run makes one call, retains exact model wire and returns an ordinary archive-compatible summary", async () => {
  const f = fixture(), raw = JSON.stringify(f.wire, null, 2); let calls = 0;
  const r = await compose.runClaimSummary(f.input, f.inventory, async request => {
    calls++; assert.equal(request.stage, "claim_compose_scoped"); return raw;
  }, { outputMode: "scoped_fields" });
  assert.equal(calls, 1); assert.equal(r.status, "READY_FOR_REVIEW");
  assert.equal(r.semantic_correctness, "NOT_CERTIFIED"); assert.equal(r.record.raw_response, raw);
  assert.deepEqual(r.scopedResponse, f.wire);
  assert.ok(!Object.hasOwn(r.response.items[0], "conditions"));
  assert.equal(summaries.validateSummary(f.input, r.response, 20000).validation.source_binding_valid, true);
});
test("invalid scoped response is retained and rejected once with no prose fallback", async () => {
  const f = fixture(); f.wire.items[0].conditions[0].evidence = ["missing"];
  const raw = JSON.stringify(f.wire); let calls = 0;
  const r = await compose.runClaimSummary(f.input, f.inventory, async () => { calls++; return raw; }, { outputMode: "scoped_fields" });
  assert.equal(calls, 1); assert.equal(r.status, "REJECTED"); assert.equal(r.error, "comparison_reference");
  assert.equal(r.record.raw_response, raw);
});
test("incorrect model scope is preserved but cannot be mistaken for certified ownership", () => {
  const f = fixture(); f.wire.items[0].conditions[0].scope = "B路径（模型归属错误）";
  const r = compose.projectScopedSummary(f.input, f.wire);
  assert.ok(r.body.includes("B路径（模型归属错误）"));
  assert.equal(r.validation.scope_association, "MODEL_DECLARED_NOT_CERTIFIED");
  assert.equal(r.validation.coverage, "NOT_EVALUATED");
});
