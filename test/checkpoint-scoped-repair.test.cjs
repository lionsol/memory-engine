"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const repair = require("../lib/checkpoint/summary-scoped-repair.cjs");
const compose = require("../lib/checkpoint/summary-claim-compose.cjs");
const claims = require("../lib/checkpoint/summary-claim-ledger.cjs");
const { buildFactInput } = require("../lib/checkpoint/ordinary-summary-facts");
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fixture() {
  const input = buildFactInput([
    { text: "用户要求核查 requested_field；未来成功也不能单凭结果证明修复。", role: "user", source: "conversation" },
    { text: "助手报告 observed_field=true；某次采样正常。原行消失不计成功。", role: "assistant", source: "conversation" }
  ], "2026-10-20");
  const p = JSON.parse(claims.buildClaimPrompt(input, { referenceMode: "fragment_ids" }).prompt);
  const ids = input.sources.flatMap(s => s.units.map(u => u.id));
  const inventory = { version: p.version, target_date: p.target_date, binding: p.binding,
    claims: [{ id: "c1", scope: "观测", kind: "report", text: "报告 observed_field=true",
      conditions: [], corrects: [], evidence: [p.SOURCE.sources[1].fragments[0][0]] }], dispositions: [] };
  const request = JSON.parse(compose.buildClaimSummaryPrompt(input, inventory).prompt);
  const part = (scope, text, evidence = [ids[1]]) => ({ scope, text, evidence });
  const current = { version: request.version, target_date: request.target_date, binding: request.binding, items: [
    { scope: "当前观测", conclusion: "报告观测结果", conditions: [part("字段", "requested_field=true"), part("保留条件", "原行消失不计成功")],
      unresolved: [part("现场采样", "某次采样正常"), part("归因", "运行证据不足")], evidence: [ids[1]], corrects: [] },
    { scope: "另一独立事项", conclusion: "原有结果保持", conditions: [], unresolved: [], evidence: [ids[1]], corrects: [] }
  ] };
  const patch = { version: repair.LEGACY_VERSION, target_date: current.target_date, binding: current.binding, summary_sha256: hash(current),
    replacements: [], appends: [], moves: [], additions: [], findings: [] };
  return { input, inventory, current, ids, part, patch,
    replacement: { item_index: 0, field: "conditions", index: 0, expected_sha256: hash(current.items[0].conditions[0]),
      part: part("字段", "报告 observed_field=true"), reason: "请求字段不等于已报告字段", evidence: ids } };
}
test("field-name hints compare assignment identifiers with each part's own citations, not unrelated user requests", () => {
  const f = fixture(), before = structuredClone(f.current);
  const hints = repair.identifierReviewHints(f.input, f.current);
  assert.deepEqual(hints, [{ kind: "ASSIGNMENT_IDENTIFIER_NOT_IN_CITED_TEXT", status: "NONBLOCKING_REVIEW_HINT",
    item_index: 0, field: "conditions", index: 0, identifier: "requested_field", evidence: [f.ids[1]] }]);
  const packet = JSON.parse(repair.buildScopedRepairPrompt(f.input, f.inventory, f.current).prompt);
  assert.deepEqual(packet.identifier_review_hints, [{ kind: hints[0].kind, status: hints[0].status, identifier: "requested_field",
    evidence: [f.ids[1]], item_id: "i001", part_id: "p001" }]);
  assert.deepEqual(f.current, before);
  f.current.items[0].conditions[0].text = "observed_field=true";
  assert.deepEqual(repair.identifierReviewHints(f.input, f.current), []);
  f.current.items[0].conditions[0].text = "只讨论 unknown_field 字段";
  assert.deepEqual(repair.identifierReviewHints(f.input, f.current), []);
});
test("identifier hints are bounded and cannot certify values, infer aliases or reject a no-op review", () => {
  const f = fixture();
  f.current.items[0].conditions[0].text = "observed_field=false";
  assert.deepEqual(repair.identifierReviewHints(f.input, f.current), [], "a name match is not a value check");
  f.patch.summary_sha256 = hash(f.current);
  const unchanged = repair.applyScopedRepair(f.input, f.current, f.patch);
  assert.equal(unchanged.semantic_correctness, "NOT_CERTIFIED");
  f.current.items[0].conditions = Array.from({ length: 128 }, (_, n) => f.part("字段", "missing_field_" + n + "=true and another_field_" + n + "=false"));
  assert.equal(repair.identifierReviewHints(f.input, f.current).length, 128);
});
test("repair receives identical original source, role-separated inventory and frozen current summary with original-address hashes", () => {
  const f = fixture(), request = repair.buildScopedRepairPrompt(f.input, f.inventory, f.current);
  const p = JSON.parse(request.prompt), base = JSON.parse(compose.buildClaimSummaryPrompt(f.input, f.inventory, { outputMode: "scoped_fields" }).prompt);
  assert.deepEqual(p.SOURCE, base.SOURCE); assert.deepEqual(p.claim_inventory, base.claim_inventory);
  const unlabelled = structuredClone(p.CURRENT_SUMMARY);
  for (const row of unlabelled.items) { delete row.item_id; for (const field of ["conditions", "unresolved"]) for (const part of row[field]) delete part.part_id; }
  assert.deepEqual(unlabelled, f.current); assert.equal(p.summary_sha256, hash(f.current));
  assert.equal(p.repair_version, repair.VERSION); assert.equal(p.summary_max_chars, 20000);
  assert.equal(p.CURRENT_SUMMARY.items[0].item_id, "i001");
  assert.equal(p.CURRENT_SUMMARY.items[0].conditions[0].part_id, "p001");
  assert.equal(p.CURRENT_SUMMARY.items[0].unresolved[0].part_id, "p003");
  assert.ok(!Object.hasOwn(p, "part_addresses")); assert.ok(!Object.hasOwn(p, "part_hashes"));
  assert.equal(p.SOURCE.sources[0].units[0][1], "user"); assert.equal(p.SOURCE.sources[1].units[0][1], "assistant");
  assert.ok(!Object.hasOwn(p, "summary_target_chars"));
});
test("a source-grounded local replacement and appended causal guard leave every other field untouched", () => {
  const f = fixture(), before = structuredClone(f.current);
  f.patch.replacements.push(f.replacement);
  const guard = f.part("未来结果", "未来成功也不能单凭结果证明修复", [f.ids[0]]);
  f.patch.appends.push({ item_index: 0, field: "conditions", part: guard, reason: "遗漏用户判定规则", evidence: [f.ids[0]] });
  const r = repair.applyScopedRepair(f.input, f.current, f.patch);
  assert.deepEqual(f.current, before); assert.equal(r.repairAudit.length, 2);
  assert.deepEqual(r.scopedResponse.items[0].conditions, [f.replacement.part, before.items[0].conditions[1], guard]);
  assert.deepEqual(r.scopedResponse.items[0].unresolved, before.items[0].unresolved);
  assert.equal(r.scopedResponse.items[0].conclusion, before.items[0].conclusion);
  assert.deepEqual(r.scopedResponse.items[1], before.items[1]);
  assert.deepEqual(r.repairAudit[0].before, before.items[0].conditions[0]);
  assert.equal(r.validation.untargeted_fields_preserved, true);
  assert.equal(r.validation.repair_validity, "MODEL_DECLARED_NOT_CERTIFIED");
  assert.match(r.body, /observed_field=true/); assert.match(r.body, /未来成功也不能单凭结果证明修复/);
});
test("moves copy the exact original part; simultaneous targets use original indices rather than shifted positions", () => {
  const f = fixture(), row = f.current.items[0], before = structuredClone(row);
  f.patch.moves.push({ item_index: 0, from: "unresolved", index: 0, to: "conditions",
    expected_sha256: hash(row.unresolved[0]), reason: "已报告的观测不是未决", evidence: [f.ids[1]] });
  f.patch.replacements.push({ ...f.replacement, field: "unresolved", index: 1,
    expected_sha256: hash(row.unresolved[1]), part: f.part("归因", "未来结果不能单独归因", [f.ids[0]]) });
  const r = repair.applyScopedRepair(f.input, f.current, f.patch);
  assert.deepEqual(r.scopedResponse.items[0].conditions, [...before.conditions, before.unresolved[0]]);
  assert.deepEqual(r.scopedResponse.items[0].unresolved, [f.patch.replacements[0].part]);
  assert.deepEqual(r.repairAudit.find(x => x.action === "move").before, before.unresolved[0]);
});
test("whole-summary and per-target hashes reject stale edits without mutating the base", () => {
  for (const mode of ["version", "date", "binding", "summary", "part"]) {
    const f = fixture(), before = structuredClone(f.current); f.patch.replacements.push(f.replacement);
    if (mode === "version") f.patch.version = "other";
    if (mode === "date") f.patch.target_date = "2026-10-19";
    if (mode === "binding") f.patch.binding = "wrong";
    if (mode === "summary") f.patch.summary_sha256 = "wrong";
    if (mode === "part") f.patch.replacements[0].expected_sha256 = "wrong";
    assert.throws(() => repair.applyScopedRepair(f.input, f.current, f.patch),
      { code: mode === "part" ? "scoped_repair_stale" : "scoped_repair_binding" });
    assert.deepEqual(f.current, before);
  }
});
test("deletion, conclusion changes, unknown fields, bad addresses and overlapping targets are not allowed", () => {
  for (const mode of ["delete", "conclusion", "unknown", "index", "item", "overlap", "same_move"]) {
    const f = fixture(); f.patch.replacements.push(f.replacement);
    if (mode === "delete") f.patch.deletions = [{ item_index: 1 }];
    if (mode === "conclusion") f.patch.replacements[0].field = "conclusion";
    if (mode === "unknown") f.patch.replacements[0].extra = true;
    if (mode === "index") f.patch.replacements[0].index = 999;
    if (mode === "item") f.patch.replacements[0].item_index = -1;
    if (mode === "overlap") f.patch.moves.push({ item_index: 0, from: "conditions", index: 0, to: "unresolved",
      expected_sha256: f.replacement.expected_sha256, reason: "overlap", evidence: [f.ids[1]] });
    if (mode === "same_move") { f.patch.replacements = []; f.patch.moves.push({ item_index: 0, from: "conditions", index: 0, to: "conditions",
      expected_sha256: f.replacement.expected_sha256, reason: "same", evidence: [f.ids[1]] }); }
    assert.throws(() => repair.applyScopedRepair(f.input, f.current, f.patch));
  }
});
test("reasons, replacement parts, appends and findings must all use actual original unit citations", () => {
  for (const mode of ["reason", "part", "append", "finding", "empty_scope"]) {
    const f = fixture(); f.patch.replacements.push(f.replacement);
    if (mode === "reason") f.patch.replacements[0].evidence = ["c1"];
    if (mode === "part") f.patch.replacements[0].part.evidence = ["s0.t0.p0.l0"];
    if (mode === "append") f.patch.appends.push({ item_index: 0, field: "conditions", part: f.part("s", "t", []), reason: "r", evidence: [f.ids[0]] });
    if (mode === "finding") f.patch.findings.push(f.part("s", "t", ["missing"]));
    if (mode === "empty_scope") f.patch.replacements[0].part.scope = "";
    assert.throws(() => repair.applyScopedRepair(f.input, f.current, f.patch));
  }
});
test("independent missing items can be appended while original rows remain intact and final body budget stays hard", () => {
  const f = fixture(), row = { scope: "清理结果", conclusion: "报告已清理", conditions: [], unresolved: [], evidence: [f.ids[1]], corrects: [] };
  f.patch.additions.push(row);
  const r = repair.applyScopedRepair(f.input, f.current, f.patch);
  assert.deepEqual(r.scopedResponse.items.slice(0, 2), f.current.items); assert.deepEqual(r.scopedResponse.items[2], row);
  f.patch.additions[0].conclusion = "很长".repeat(1000);
  assert.throws(() => repair.applyScopedRepair(f.input, f.current, f.patch, { summaryMaxChars: 1000 }), { code: "comparison_summary_budget" });
  f.patch.additions[0].conclusion = "报告已清理"; f.patch.additions[0].evidence = ["missing"];
  assert.throws(() => repair.applyScopedRepair(f.input, f.current, f.patch), { code: "comparison_reference" });
});
test("zero edits and even semantically incorrect model suggestions remain explicitly uncertified", () => {
  const f = fixture();
  const r = repair.applyScopedRepair(f.input, f.current, f.patch);
  assert.deepEqual(r.scopedResponse, f.current); assert.equal(r.repairAudit.length, 0);
  f.patch.replacements.push({ ...f.replacement, part: f.part("错误作用域", "此处模型意见可能错") });
  f.patch.findings.push(f.part("未决", "不能认证已彻底修复"));
  const bad = repair.applyScopedRepair(f.input, f.current, f.patch);
  assert.equal(bad.semantic_correctness, "NOT_CERTIFIED"); assert.equal(bad.validation.semantic_correctness, "NOT_EVALUATED");
  assert.equal(bad.validation.publishable, false); assert.equal(bad.findings.length, 1);
});
test("opaque item and part labels resolve replacement, move and append addresses without model-supplied indices", () => {
  const f = fixture(), before = structuredClone(f.current), packet = JSON.parse(repair.buildScopedRepairPrompt(f.input, f.inventory, f.current).prompt);
  const patch = { ...f.patch, version: repair.VERSION, replacements: [{
    part_id: packet.CURRENT_SUMMARY.items[0].conditions[0].part_id, part: f.replacement.part,
    reason: f.replacement.reason, evidence: f.replacement.evidence }],
    moves: [{ part_id: packet.CURRENT_SUMMARY.items[0].unresolved[0].part_id, to: "conditions",
      reason: "观测重新归组", evidence: [f.ids[1]] }],
    appends: [{ item_id: packet.CURRENT_SUMMARY.items[1].item_id, field: "conditions",
      part: f.part("补充规则", "未来结果不能单独归因", [f.ids[0]]), reason: "补条件", evidence: [f.ids[0]] }] };
  const r = repair.applyScopedRepair(f.input, f.current, patch);
  assert.deepEqual(f.current, before); assert.equal(r.validation.opaque_targets_resolved, true);
  assert.deepEqual(r.scopedResponse.items[0].conditions, [f.replacement.part, before.items[0].conditions[1], before.items[0].unresolved[0]]);
  assert.deepEqual(r.scopedResponse.items[0].unresolved, [before.items[0].unresolved[1]]);
  assert.equal(r.scopedResponse.items[1].conclusion, before.items[1].conclusion);
  assert.equal(r.scopedResponse.items[1].conditions.length, 1);
  assert.deepEqual(r.resolvedTargets.map(x => [x.operation, x.item_index, x.field, x.index]), [
    ["replace", 0, "conditions", 0], ["move", 0, "unresolved", 0], ["append", 1, "conditions", undefined] ]);
  assert.equal(r.repairAudit[0].before_sha256, hash(before.items[0].conditions[0]));
});
test("opaque targets reject unknown IDs, padding aliases, guessed numeric addresses and target IDs used as source citations", () => {
  for (const mode of ["unknown", "padding", "numeric", "citation", "wrong_namespace"]) {
    const f = fixture(), patch = { ...f.patch, version: repair.VERSION, replacements: [{
      part_id: "p001", part: structuredClone(f.replacement.part), reason: "r", evidence: [f.ids[1]] }] };
    if (mode === "unknown") patch.replacements[0].part_id = "p999";
    if (mode === "padding") patch.replacements[0].part_id = "p1";
    if (mode === "numeric") patch.replacements[0].item_index = 0;
    if (mode === "citation") patch.replacements[0].part.evidence = ["p001"];
    if (mode === "wrong_namespace") patch.replacements[0].part_id = "i001";
    assert.throws(() => repair.applyScopedRepair(f.input, f.current, patch));
  }
});
test("opaque labels cannot bypass whole-base binding or conceal two operations on the same original field", () => {
  const f = fixture(), patch = { ...f.patch, version: repair.VERSION, replacements: [{
    part_id: "p001", part: f.replacement.part, reason: "r", evidence: [f.ids[1]] }] };
  const changed = structuredClone(f.current); changed.items[0].conditions.unshift(f.part("new", "new"));
  assert.throws(() => repair.applyScopedRepair(f.input, changed, patch), { code: "scoped_repair_binding" });
  patch.moves.push({ part_id: "p001", to: "unresolved", reason: "overlap", evidence: [f.ids[1]] });
  assert.throws(() => repair.applyScopedRepair(f.input, f.current, patch), { code: "scoped_repair_conflict" });
});
test("valid opaque labels are mechanical addresses and cannot certify semantic choice or lift the final budget", () => {
  const f = fixture(), patch = { ...f.patch, version: repair.VERSION, replacements: [{
    part_id: "p001", part: f.part("模型归属可能错", "模型仍可能误改已有事实"), reason: "模型意见", evidence: [f.ids[1]] }] };
  const r = repair.applyScopedRepair(f.input, f.current, patch);
  assert.equal(r.semantic_correctness, "NOT_CERTIFIED"); assert.equal(r.validation.repair_validity, "MODEL_DECLARED_NOT_CERTIFIED");
  assert.equal(r.validation.publishable, false);
  patch.replacements[0].part.text = "很长".repeat(1000);
  assert.throws(() => repair.applyScopedRepair(f.input, f.current, patch, { summaryMaxChars: 1000 }), { code: "comparison_summary_budget" });
});
test("caller-selected review scope preserves unrelated items and forbids cross-scope edits or additions", () => {
  const f = fixture(), reviewScope = { item_ids: ["i001"], question: "复核分类动作，不改其他事项" };
  const request = JSON.parse(repair.buildScopedRepairPrompt(f.input, f.inventory, f.current, { reviewScope }).prompt);
  assert.deepEqual(request.review_scope, reviewScope);
  const patch = { ...f.patch, version: repair.VERSION, appends: [{
    item_id: "i001", field: "conditions", part: f.part("规则", "原行消失不计成功"), reason: "补规则", evidence: [f.ids[1]] }] };
  const r = repair.applyScopedRepair(f.input, f.current, patch, { reviewScope });
  assert.deepEqual(r.scopedResponse.items[1], f.current.items[1]);
  patch.appends[0].item_id = "i002";
  assert.throws(() => repair.applyScopedRepair(f.input, f.current, patch, { reviewScope }), { code: "scoped_repair_scope" });
  patch.appends = []; patch.additions.push(structuredClone(f.current.items[1]));
  assert.throws(() => repair.applyScopedRepair(f.input, f.current, patch, { reviewScope }), { code: "scoped_repair_scope" });
});
test("invalid scope stops before generation and a returned proposal cannot expand the host's scope", async () => {
  for (const reviewScope of [
    { item_ids: ["i999"], question: "q" }, { item_ids: [], question: "q" },
    { item_ids: ["i001", "i001"], question: "q" }, { item_ids: ["i001"], question: "" }
  ]) {
    const f = fixture(); let calls = 0;
    const r = await repair.runScopedRepair(f.input, f.inventory, f.current, async () => { calls++; }, { reviewScope });
    assert.equal(calls, 0); assert.equal(r.status, "REJECTED");
  }
  const f = fixture(), patch = { ...f.patch, version: repair.VERSION, appends: [{
    item_id: "i002", field: "conditions", part: f.part("other", "越出复核范围"), reason: "r", evidence: [f.ids[1]] }] };
  let calls = 0; const raw = JSON.stringify(patch);
  const r = await repair.runScopedRepair(f.input, f.inventory, f.current, async () => { calls++; return raw; },
    { reviewScope: { item_ids: ["i001"], question: "只改这一项" } });
  assert.equal(calls, 1); assert.equal(r.error, "scoped_repair_scope"); assert.equal(r.record.raw_response, raw);
  assert.equal(r.publisherCalls, 0); assert.deepEqual(r.record.base_summary, f.current);
});
test("addition-only scope freezes every existing row and transmits the selected source IDs without changing the source", () => {
  const f = fixture(), additionScope = { source_unit_ids: [f.ids[1]], question: "补独立核对结果，保留阶段" };
  const packet = JSON.parse(repair.buildScopedRepairPrompt(f.input, f.inventory, f.current, { additionScope }).prompt);
  assert.deepEqual(packet.addition_scope, additionScope); assert.ok(!Object.hasOwn(packet, "review_scope"));
  const row = { scope: "独立核对", conclusion: "助手报告本次采样正常", conditions: [
    f.part("本次核对", "这是助手报告，不推断整个工作时段") ], unresolved: [], evidence: [f.ids[1]], corrects: [] };
  const patch = { ...f.patch, version: repair.VERSION, additions: [row] };
  const r = repair.applyScopedRepair(f.input, f.current, patch, { additionScope });
  assert.deepEqual(r.scopedResponse.items.slice(0, f.current.items.length), f.current.items);
  assert.deepEqual(r.scopedResponse.items.at(-1), row); assert.equal(r.semantic_correctness, "NOT_CERTIFIED");
});
test("addition-only scope rejects existing-row edits and source citations outside its allowlist at every new field", () => {
  const f = fixture(), additionScope = { source_unit_ids: [f.ids[1]], question: "只补这一来源" };
  for (const operation of ["replacements", "appends", "moves"]) {
    const patch = { ...structuredClone(f.patch), version: repair.VERSION };
    if (operation === "replacements") patch.replacements = [{ part_id: "p001", part: f.replacement.part, reason: "r", evidence: [f.ids[1]] }];
    if (operation === "appends") patch.appends = [{ item_id: "i001", field: "conditions", part: f.replacement.part, reason: "r", evidence: [f.ids[1]] }];
    if (operation === "moves") patch.moves = [{ part_id: "p003", to: "conditions", reason: "r", evidence: [f.ids[1]] }];
    assert.throws(() => repair.applyScopedRepair(f.input, f.current, patch, { additionScope }), { code: "scoped_repair_scope" });
  }
  for (const location of ["evidence", "conditions", "unresolved", "corrects"]) {
    const row = { scope: "新增", conclusion: "本次核对", conditions: [], unresolved: [], evidence: [f.ids[1]], corrects: [] };
    if (location === "evidence") row.evidence = [f.ids[0]];
    if (location === "corrects") row.corrects = [f.ids[0]];
    if (location === "conditions" || location === "unresolved") row[location] = [f.part("范围外", "不能借用", [f.ids[0]])];
    assert.throws(() => repair.applyScopedRepair(f.input, f.current,
      { ...f.patch, version: repair.VERSION, additions: [row] }, { additionScope }), { code: "scoped_repair_scope" });
  }
});
test("invalid or conflicting addition scopes stop before generation and cannot be expanded by a proposal", async () => {
  const f = fixture();
  for (const additionScope of [
    { source_unit_ids: [], question: "q" }, { source_unit_ids: [f.ids[1], f.ids[1]], question: "q" },
    { source_unit_ids: ["missing"], question: "q" }, { source_unit_ids: [f.ids[1]], question: "" }
  ]) {
    let calls = 0;
    const r = await repair.runScopedRepair(f.input, f.inventory, f.current, async () => { calls++; }, { additionScope });
    assert.equal(calls, 0); assert.equal(r.status, "REJECTED");
  }
  assert.throws(() => repair.buildScopedRepairPrompt(f.input, f.inventory, f.current, {
    additionScope: { source_unit_ids: [f.ids[1]], question: "q" },
    reviewScope: { item_ids: ["i001"], question: "q" }
  }), { code: "scoped_repair_options" });
  const patch = { ...f.patch, version: repair.VERSION, additions: [{
    scope: "不能扩大", conclusion: "越出来源", conditions: [], unresolved: [], evidence: [f.ids[0]], corrects: [] }] };
  const raw = JSON.stringify(patch); let calls = 0;
  const r = await repair.runScopedRepair(f.input, f.inventory, f.current, async () => { calls++; return raw; },
    { additionScope: { source_unit_ids: [f.ids[1]], question: "q" } });
  assert.equal(calls, 1); assert.equal(r.error, "scoped_repair_scope"); assert.equal(r.record.raw_response, raw);
  assert.deepEqual(r.record.base_summary, f.current); assert.equal(r.publisherCalls, 0);
});
test("v2 binds all target addresses to the complete base and computes per-part hashes in the host", () => {
  const f = fixture(); f.patch.version = repair.NUMERIC_VERSION;
  const change = structuredClone(f.replacement); delete change.expected_sha256; f.patch.replacements.push(change);
  const r = repair.applyScopedRepair(f.input, f.current, f.patch);
  assert.equal(r.repairAudit[0].before_sha256, hash(f.current.items[0].conditions[0]));
  assert.deepEqual(r.scopedResponse.items[0].conditions[0], change.part);
  const altered = structuredClone(f.current); altered.items[1].conclusion += "concurrent";
  assert.throws(() => repair.applyScopedRepair(f.input, altered, f.patch), { code: "scoped_repair_binding" });
  f.patch.replacements[0].expected_sha256 = "model must not send this";
  assert.throws(() => repair.applyScopedRepair(f.input, f.current, f.patch), { code: "scoped_repair_schema" });
});
test("legacy hash-copy failure stays rejected until an explicit whole-base-bound offline conversion", () => {
  const f = fixture(); f.patch.replacements.push({ ...f.replacement, expected_sha256: "0".repeat(64) });
  const before = structuredClone({ patch: f.patch, current: f.current });
  assert.throws(() => repair.applyScopedRepair(f.input, f.current, f.patch), { code: "scoped_repair_stale" });
  const rebound = repair.rebindLegacyRepair(f.input, f.current, f.patch);
  assert.deepEqual(f.patch, before.patch); assert.deepEqual(f.current, before.current);
  assert.equal(rebound.migratedPatch.version, repair.NUMERIC_VERSION);
  assert.ok(!Object.hasOwn(rebound.migratedPatch.replacements[0], "expected_sha256"));
  assert.deepEqual(rebound.migratedPatch.replacements[0].part, f.replacement.part);
  assert.equal(rebound.migration.kind, "EXPLICIT_OFFLINE_HOST_REBIND");
  assert.equal(rebound.migration.text_or_addresses_changed, false); assert.equal(rebound.migration.model_generations, 0);
  assert.equal(rebound.migration.target_hash_comparisons[0].matched, false);
  assert.equal(rebound.migration.target_hash_comparisons[0].host_sha256, hash(f.current.items[0].conditions[0]));
  assert.equal(rebound.semantic_correctness, "NOT_CERTIFIED");
});
test("offline rebinding cannot change bases, fabricate targets, drop unknown fields or bypass source checks", () => {
  for (const mode of ["base", "address", "extra", "source"]) {
    const f = fixture(); f.patch.replacements.push(f.replacement);
    if (mode === "base") f.current.items[1].conclusion += "changed";
    if (mode === "address") f.patch.replacements[0].index = 999;
    if (mode === "extra") f.patch.replacements[0].delete = true;
    if (mode === "source") f.patch.replacements[0].part.evidence = ["missing"];
    assert.throws(() => repair.rebindLegacyRepair(f.input, f.current, f.patch));
  }
});
test("one review invocation preserves raw patch, snapshots and non-publication on success or rejection", async () => {
  for (const invalid of [false, true]) {
    const f = fixture(); f.patch.replacements.push(f.replacement);
    if (invalid) f.patch.replacements[0].expected_sha256 = "stale";
    const raw = JSON.stringify(f.patch, null, 2); let calls = 0;
    const r = await repair.runScopedRepair(f.input, f.inventory, f.current, async request => {
      calls++; assert.equal(request.stage, "scoped_repair"); return raw;
    });
    assert.equal(calls, 1); assert.equal(r.status, invalid ? "REJECTED" : "READY_FOR_REVIEW");
    assert.equal(r.record.raw_response, raw); assert.deepEqual(r.record.base_summary, f.current);
    assert.equal(r.publisherCalls, 0); assert.equal(r.semantic_correctness, "NOT_CERTIFIED");
  }
});
test("concurrent changes to original source, inventory or current summary reject and retain original snapshots", async () => {
  for (const mode of ["source", "inventory", "current"]) {
    const f = fixture(), before = structuredClone({ source: f.input, inventory: f.inventory, current: f.current });
    const raw = JSON.stringify(f.patch);
    const r = await repair.runScopedRepair(f.input, f.inventory, f.current, async () => {
      if (mode === "source") { f.input.sources[0].units[0].text += "!"; f.input.sources[0].units[0].end++; }
      if (mode === "inventory") f.inventory.claims[0].text += "!";
      if (mode === "current") f.current.items[0].conclusion += "!";
      return raw;
    });
    assert.equal(r.error, "scoped_repair_source_changed"); assert.equal(r.record.raw_response, raw);
    assert.deepEqual(r.record.source, before.source); assert.deepEqual(r.record.inventory, before.inventory);
    assert.deepEqual(r.record.base_summary, before.current);
  }
});
test("invalid inventory/options and pre-cancellation stop before generation; post-cancel retains raw reply", async () => {
  for (const mode of ["inventory", "input_budget", "cancel"]) {
    const f = fixture(); let calls = 0;
    if (mode === "inventory") f.inventory.binding = "wrong";
    const settings = mode === "input_budget" ? { maxInputChars: 1 } : mode === "cancel" ? { signal: AbortSignal.abort() } : {};
    const r = await repair.runScopedRepair(f.input, f.inventory, f.current, async () => { calls++; }, settings);
    assert.equal(calls, 0); assert.equal(r.status, "REJECTED");
  }
  const f = fixture(), controller = new AbortController(), raw = JSON.stringify(f.patch);
  const post = await repair.runScopedRepair(f.input, f.inventory, f.current, async () => { controller.abort(); return raw; }, { signal: controller.signal });
  assert.equal(post.error, "scoped_repair_cancelled"); assert.equal(post.record.raw_response, raw);
});
test("bad JSON, oversized wire and provider errors have no retry, repair or diagnostic leakage", async () => {
  const f = fixture();
  for (const raw of ["not JSON", " ".repeat(1048577), null]) {
    let calls = 0;
    const r = await repair.runScopedRepair(f.input, f.inventory, f.current, async () => { calls++; return raw; });
    assert.equal(calls, 1); assert.equal(r.status, "REJECTED");
  }
  const r = await repair.runScopedRepair(f.input, f.inventory, f.current, async () => { throw Error("private endpoint details"); });
  assert.equal(r.error, "scoped_repair_failed"); assert.ok(!JSON.stringify(r).includes("private endpoint"));
  f.patch.appends = Array(65).fill({ item_index: 0, field: "conditions", part: f.part("s", "t"), reason: "r", evidence: [f.ids[0]] });
  assert.throws(() => repair.applyScopedRepair(f.input, f.current, f.patch), { code: "scoped_repair_schema" });
});
