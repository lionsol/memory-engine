"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs");
const lab = require("../lib/checkpoint/summary-claim-ledger.cjs");
const { buildFactInput } = require("../lib/checkpoint/ordinary-summary-facts");
const mode = { referenceMode: "fragment_ids" }, DATE = "2026-10-20";
function fixture(text = "- 01:00 / 02:00 / 03:00 健康检查 — **正常**\n- 其他结果正常") {
  const input = buildFactInput([{ text, source: "conversation", role: "assistant" }], DATE);
  const request = lab.buildClaimPrompt(input, mode);
  const rows = JSON.parse(request.prompt).SOURCE.sources[0].fragments;
  const claim = (id, row, text) => ({ id, scope: "本次报告", kind: "report", text,
    evidence: [row[0]], conditions: [], corrects: [] });
  const wire = claims => ({ version: lab.FRAGMENT_VERSION, target_date: DATE,
    binding: request.binding, claims, dispositions: [] });
  return { input, request, rows, claim, wire };
}
test("fragment IDs resolve to the entire exact original without model-copied quotes or fuzzy matching", () => {
  const f = fixture(), w = f.wire([f.claim("c1", f.rows[0], "01:00检查正常"), f.claim("c2", f.rows[0], "02:00检查正常")]);
  const r = lab.projectClaimLedger(f.input, w, mode);
  assert.equal(r.claims.length, 2);
  for (const c of r.claims) assert.equal(c.sources[0].quote, f.rows[0][4]);
  assert.equal(r.evidence_origin, "PROGRAM_COPIED_FULL_FRAGMENTS");
  assert.equal(r.reference_mode, "fragment_ids");
  assert.equal(r.semantic_correctness, "NOT_CERTIFIED");
  assert.ok(!Object.hasOwn(r.ledger.claims[0], "quotes"));
});
test("repeated table values and Markdown escapes need no ambiguous text localization", () => {
  const f = fixture("| **FTS** | **不可得** | **不可得** |\nopts.entryId \\|\\| fingerprint");
  const r = lab.projectClaimLedger(f.input, f.wire(f.rows.map((row, i) => f.claim("c" + (i + 1), row, "记录"))), mode);
  assert.equal(r.claims[0].sources[0].quote, f.rows[0][4]);
  assert.equal(r.claims[1].sources[0].quote, f.rows[1][4]);
  const record = "| **FTS** | **不可得** | **不可得** |\nopts.entryId \\|\\| fingerprint";
  for (const c of r.claims) for (const q of c.sources) assert.equal(record.slice(q.start, q.end), q.quote);
});
test("unknown, duplicate and empty fragment references reject; model quote fields cannot override originals", () => {
  const f = fixture();
  for (const mutate of [
    c => c.evidence = ["unknown"], c => c.evidence = [], c => c.evidence.push(c.evidence[0]),
    c => c.quotes = [{ fragment: f.rows[0][0], quote: "forged" }]
  ]) {
    const w = f.wire([f.claim("c1", f.rows[0], "观测")]); mutate(w.claims[0]);
    assert.throws(() => lab.validateClaimLedger(f.input, w, mode));
  }
});
test("repeated full-fragment references have a separate expansion budget and are never truncated", () => {
  const f = fixture("x".repeat(160000));
  const w = f.wire(Array.from({ length: 7 }, (_, i) => f.claim("c" + (i + 1), f.rows[0], "报告")));
  assert.throws(() => lab.projectClaimLedger(f.input, w, mode), { code: "claim_evidence_budget" });
  assert.equal(w.claims.length, 7); assert.equal(f.rows[0][4].length, 160000);
});
test("literal and fragment-only protocols have distinct bindings and require explicit selection", () => {
  const f = fixture(), old = lab.buildClaimPrompt(f.input);
  assert.notEqual(old.binding, f.request.binding);
  const a = JSON.parse(old.prompt), b = JSON.parse(f.request.prompt);
  assert.deepEqual(a.SOURCE, b.SOURCE); assert.equal(b.version, lab.FRAGMENT_VERSION);
  assert.throws(() => lab.validateClaimLedger(f.input, f.wire([f.claim("c1", f.rows[0], "观测")])), { code: "claim_binding" });
  assert.throws(() => lab.buildClaimPrompt(f.input, { referenceMode: "unknown" }), { code: "claim_options" });
});
test("old literal-quote validation still rejects rewritten strings that ID-only evidence avoids", () => {
  const f = fixture(), old = lab.buildClaimPrompt(f.input);
  const w = { version: lab.VERSION, target_date: DATE, binding: old.binding, dispositions: [],
    claims: [{ id: "c1", scope: "本次检查", kind: "report", text: "01:00检查正常",
      quotes: [{ fragment: f.rows[0][0], quote: "01:00 健康检查 — **正常**" }], conditions: [], corrects: [] }] };
  assert.throws(() => lab.validateClaimLedger(f.input, w), { code: "claim_quote" });
});
test("full-fragment evidence does not make unsupported claim text semantically correct", () => {
  const f = fixture("检查失败");
  const r = lab.projectClaimLedger(f.input, f.wire([f.claim("c1", f.rows[0], "检查成功")]), mode);
  assert.equal(r.claims[0].sources[0].quote, "检查失败");
  assert.equal(r.semantic_correctness, "NOT_CERTIFIED"); assert.equal(r.publishable, false);
});
test("ID-only execution preserves all claims with no second model request", async () => {
  const f = fixture(); let calls = 0;
  const r = await lab.runClaimInventory(f.input, async request => {
    calls++; assert.equal(request.binding, f.request.binding);
    return JSON.stringify(f.wire(f.rows.map((row, i) => f.claim("c" + (i + 1), row, "原文报告"))));
  }, mode);
  assert.equal(calls, 1); assert.equal(r.status, "READY_FOR_REVIEW");
  assert.equal(r.claims.length, 2); assert.equal(r.publisherCalls, 0);
});
test("source headings and table columns survive even if the model classifies them as context", () => {
  const f = fixture("**验收 — PASS（受限）**\n\n| 分段 | n | p50 |\n|---|---|---|\n| 端到端 | 15 | 1908 |");
  const row = f.rows.find(r => r[4].startsWith("| 端到端"));
  const w = f.wire([f.claim("c001", row, "报告p50为1908")]);
  for (const r of f.rows.filter(r => r !== row))
    w.dispositions.push({ fragment: r[0], reason: "context", claim_ids: [] });
  const result = lab.projectClaimLedger(f.input, w, mode);
  assert.deepEqual(result.source_context.map(c => c.kind).sort(), ["heading", "table_header"]);
  assert.match(result.body, /PASS（受限）/);
  assert.match(result.body, /分段 \| n \| p50/);
  assert.equal(result.claims[0].sources[0].context_ids.length, 2);
  for (const c of result.source_context) {
    const unit = f.input.sources[0].units.find(u => u.id === c.unit_id);
    assert.equal(unit.text.slice(c.start - unit.start, c.end - unit.start), c.quote);
  }
  assert.deepEqual(result.ledger, w);
  assert.equal(result.semantic_correctness, "NOT_CERTIFIED");
});
test("source context is deduplicated and does not cross turn or source boundaries", () => {
  const f = fixture("**Assistant:** **旧任务 — FAIL**\n\n旧结果。\n\n**Assistant:** 新任务结果。");
  const r = lab.projectClaimLedger(f.input, f.wire([f.claim("c001", f.rows.at(-1), "新任务结果")]), mode);
  assert.deepEqual(r.source_context, []); assert.ok(!r.body.includes("FAIL"));
  const a = fixture("**标题**\n\n同次结果。"), row = a.rows.at(-1);
  const d = lab.projectClaimLedger(a.input, a.wire([a.claim("c001", row, "结果1"), a.claim("c002", row, "结果2")]), mode);
  assert.equal(d.source_context.length, 1);
  assert.deepEqual(d.claims[0].sources[0].context_ids, d.claims[1].sources[0].context_ids);
  const cross = buildFactInput([{ text: "本来源结果", source: "conversation", role: "assistant" },
    { text: "**另一来源标题**", source: "conversation", role: "assistant" }], DATE);
  cross.sources[0].units[0].context_ref = cross.sources[1].units[0].id;
  const packet = JSON.parse(lab.buildClaimPrompt(cross, mode).prompt);
  const wire = { version: lab.FRAGMENT_VERSION, target_date: DATE, binding: packet.binding,
    claims: [{ id: "c001", scope: "本来源", kind: "report", text: "结果",
      evidence: [packet.SOURCE.sources[0].fragments[0][0]], conditions: [], corrects: [] }], dispositions: [] };
  assert.throws(() => lab.validateClaimLedger(cross, wire, mode), { code: "claim_context_reference" });
});
test("zero-padded claim IDs stay opaque and correction links do not alias numeric equivalents", () => {
  const f = fixture();
  const w = f.wire([
    f.claim("c1", f.rows[0], "独立观察"),
    f.claim("c001", f.rows[0], "旧判断"),
    { ...f.claim("c002", f.rows[1], "更正旧判断"), kind: "correction", corrects: ["c001"] }
  ]);
  const r = lab.projectClaimLedger(f.input, w, mode);
  assert.deepEqual(r.claims.map(c => c.id), ["c1", "c001", "c002"]);
  assert.deepEqual(r.claims[0].corrected_by, []);
  assert.deepEqual(r.claims[1].corrected_by, ["c002"]);
  assert.deepEqual(r.ledger, w);
  const wrong = structuredClone(w); wrong.claims[2].corrects = ["c01"];
  assert.throws(() => lab.validateClaimLedger(f.input, wrong, mode), { code: "claim_correction_target" });
});
test("accepting padded IDs does not accept duplicate, unbounded or path-like IDs", () => {
  const f = fixture();
  for (const id of ["c0000001", "../c001", "c001/x"]) {
    assert.throws(() => lab.validateClaimLedger(f.input, f.wire([f.claim(id, f.rows[0], "报告")]), mode),
      { code: "claim_schema" });
  }
  assert.throws(() => lab.validateClaimLedger(f.input,
    f.wire([f.claim("c001", f.rows[0], "甲"), f.claim("c001", f.rows[1], "乙")]), mode), { code: "claim_schema" });
});
test("captured native v2 model output replays unchanged with original-record evidence", {
  skip: process.env.MEMORY_ENGINE_TEST_FRAGMENT_RESPONSE ? false : "set MEMORY_ENGINE_TEST_FRAGMENT_RESPONSE for native v2 capture"
}, () => {
  const responsePath = process.env.MEMORY_ENGINE_TEST_FRAGMENT_RESPONSE;
  const directory = require("node:path").dirname(responsePath);
  const bytes = fs.readFileSync(responsePath), wire = JSON.parse(bytes);
  const input = JSON.parse(fs.readFileSync(require("node:path").join(directory, "fact-input.json"), "utf8"));
  const records = JSON.parse(fs.readFileSync(require("node:path").join(directory, "input-records.json"), "utf8"));
  const hash = text => require("node:crypto").createHash("sha256").update(text).digest("hex");
  const originals = new Map(records.map(record => [hash(record.text), record.text]));
  const r = lab.projectClaimLedger(input, wire, mode);
  assert.deepEqual(r.ledger, wire); assert.equal(r.claims.length, wire.claims.length);
  assert.equal(r.reference_mode, "fragment_ids");
  assert.equal(r.evidence_origin, "PROGRAM_COPIED_FULL_FRAGMENTS");
  assert.ok(r.source_context.some(context => context.quote === "**1. 自然样本身份 — PASS**"));
  assert.ok(r.source_context.some(context => context.quote === "**2. 延迟 — PASS（受限）**"));
  for (const context of r.source_context)
    assert.equal(originals.get(context.source_hash).slice(context.start, context.end), context.quote);
  for (const claim of r.claims) for (const ref of claim.sources)
    assert.equal(originals.get(ref.source_hash).slice(ref.start, ref.end), ref.quote);
  assert.deepEqual(fs.readFileSync(responsePath), bytes);
  assert.equal(r.semantic_correctness, "NOT_CERTIFIED");
});
test("captured v1 output may be explicitly rebound as a derived fragment view without editing the model bytes", {
  skip: process.env.MEMORY_ENGINE_TEST_CLAIM_RESPONSE && process.env.MEMORY_ENGINE_TEST_CLAIM_INPUT
    ? false : "set captured claim input/response paths for offline derivation test"
}, () => {
  const responsePath = process.env.MEMORY_ENGINE_TEST_CLAIM_RESPONSE;
  const bytes = fs.readFileSync(responsePath), original = JSON.parse(bytes);
  const input = JSON.parse(fs.readFileSync(process.env.MEMORY_ENGINE_TEST_CLAIM_INPUT, "utf8"));
  assert.throws(() => lab.validateClaimLedger(input, original), { code: "claim_quote" });
  const derived = { ...structuredClone(original), version: lab.FRAGMENT_VERSION,
    binding: lab.buildClaimPrompt(input, mode).binding,
    claims: original.claims.map(({ quotes, ...c }) => ({ ...structuredClone(c), evidence: [...new Set(quotes.map(q => q.fragment))] })) };
  const r = lab.projectClaimLedger(input, derived, mode);
  assert.equal(r.claims.length, original.claims.length);
  for (let i = 0; i < original.claims.length; i++) {
    for (const field of ["id", "scope", "kind", "text", "conditions", "corrects"])
      assert.deepEqual(r.claims[i][field], original.claims[i][field]);
  }
  assert.deepEqual(fs.readFileSync(responsePath), bytes);
  assert.equal(r.evidence_origin, "PROGRAM_COPIED_FULL_FRAGMENTS");
});
