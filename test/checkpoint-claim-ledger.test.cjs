"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const lab = require("../lib/checkpoint/summary-claim-ledger.cjs");
const { buildFactInput } = require("../lib/checkpoint/ordinary-summary-facts");
const DATE = "2026-10-20";
function fixture(text = "维护正常。\nDaily Stats已写入。", role = "assistant") {
  const input = buildFactInput([{ text, role, source: "conversation" }], DATE);
  const request = lab.buildClaimPrompt(input), packet = JSON.parse(request.prompt);
  const rows = packet.SOURCE.sources.flatMap(s => s.fragments);
  const claim = (id, row, extra = {}) => ({ id, scope: "当次任务", kind: "report",
    text: row[4].trim(), quotes: [{ fragment: row[0], quote: row[4].trim() }],
    conditions: [], corrects: [], ...extra });
  const wire = claims => ({ version: lab.VERSION, target_date: DATE, binding: request.binding,
    claims, dispositions: [] });
  return { input, request, packet, rows, claim, wire };
}
test("fragment transport preserves each unit verbatim with CRLF, indentation, roles and Unicode", () => {
  const f = fixture("**Assistant:** a\r\n  b😀  \r\nc");
  const fragments = f.packet.SOURCE.sources[0].fragments;
  assert.deepEqual(fragments.map(r => r[4]), ["a\r\n", "  b😀  \r\n", "c"]);
  assert.equal(fragments.map(r => r[4]).join(""), f.input.sources[0].units[0].text);
  assert.ok(fragments.every(r => r[2] === "assistant"));
  assert.equal(f.packet.SOURCE.sources[0].source_hash, f.input.sources[0].source_hash);
});
test("independent outcomes in one paragraph retain distinct IDs and identical scopes are never deduplicated", () => {
  const f = fixture(), wire = f.wire(f.rows.map((r, i) => f.claim("c" + (i + 1), r)));
  const result = lab.projectClaimLedger(f.input, wire);
  assert.equal(result.claims.length, 2);
  assert.match(result.body, /维护正常/); assert.match(result.body, /Daily Stats已写入/);
  assert.equal(result.coverage.status, "FRAGMENTS_ACCOUNTED_ONLY");
  assert.equal(result.coverage.semantic_coverage, "NOT_EVALUATED");
});
test("partial correction points to one claim without withdrawing another claim from the same fragment", () => {
  const f = fixture("**Assistant:** mtime为10:51所以当时部署；查库最后更新03:30。\n\n**User:** 撤回mtime部署推断，加载时刻未知，查询结果保留。");
  const old = f.rows[0], correction = f.rows[1];
  const wire = f.wire([
    f.claim("c1", old, { text: "mtime证明10:51部署", quotes: [{ fragment: old[0], quote: "mtime为10:51所以当时部署" }] }),
    f.claim("c2", old, { text: "查询报告最后更新03:30", quotes: [{ fragment: old[0], quote: "查库最后更新03:30。" }],
      conditions: ["固定时刻之后未更新不证明部署归属"] }),
    f.claim("c3", correction, { kind: "correction", corrects: ["c1"], text: "部署时刻未知；撤回mtime推断" })
  ]);
  const result = lab.projectClaimLedger(f.input, wire);
  assert.deepEqual(result.claims[0].corrected_by, ["c3"]);
  assert.deepEqual(result.claims[1].corrected_by, []);
  assert.equal(result.claims.length, 3);
  assert.match(result.body, /查询报告最后更新03:30/);
  assert.match(result.body, /固定时刻之后未更新不证明部署归属/);
  assert.match(result.body, /保留历史原述/);
  assert.equal(result.correction_validity, "MODEL_DECLARED_NOT_CERTIFIED");
});
test("literal quotes resolve to the original unit range and retain source role and hash", () => {
  const f = fixture("**User:** 请核对。\n\n**Assistant:**   b😀 done。");
  const r = f.rows[1], wire = f.wire([f.claim("c1", r, { quotes: [{ fragment: r[0], quote: "b😀" }] })]);
  const result = lab.validateClaimLedger(f.input, wire), ref = result.claims[0].sources[0];
  assert.equal(f.input.sources[0].units[1].text.slice(ref.start - f.input.sources[0].units[1].start,
    ref.end - f.input.sources[0].units[1].start), "b😀");
  assert.equal(ref.role, "assistant"); assert.equal(ref.source_hash, f.input.sources[0].source_hash);
});
test("a quote cannot be stitched across fragments or resolve ambiguously", () => {
  for (const quote of ["维护正常。\nDaily Stats已写入。", "不存在的文字"]) {
    const f = fixture(), wire = f.wire([f.claim("c1", f.rows[0], {
      quotes: [{ fragment: f.rows[0][0], quote }] })]);
    assert.throws(() => lab.validateClaimLedger(f.input, wire), { code: "claim_quote" });
  }
  const f = fixture("0 与 0");
  assert.throws(() => lab.validateClaimLedger(f.input, f.wire([f.claim("c1", f.rows[0], {
    quotes: [{ fragment: f.rows[0][0], quote: "0" }] })])), { code: "claim_quote" });
});
test("unknown fragments, altered source, wrong protocol and wrong date reject", () => {
  const f = fixture(), w = f.wire([f.claim("c1", f.rows[0])]);
  const unknown = structuredClone(w); unknown.claims[0].quotes[0].fragment = "external:path";
  assert.throws(() => lab.validateClaimLedger(f.input, unknown), { code: "claim_reference" });
  for (const change of [x => x.binding = "other", x => x.version = "other", x => x.target_date = "2026-10-21"]) {
    const copy = structuredClone(w); change(copy);
    assert.throws(() => lab.validateClaimLedger(f.input, copy), { code: "claim_binding" });
  }
  f.input.sources[0].units[0].text += "changed"; f.input.sources[0].units[0].end += 7;
  assert.throws(() => lab.validateClaimLedger(f.input, w), { code: "claim_binding" });
});
test("corrections reject paragraph targets, unknown/self targets, cycles and non-correction kinds", () => {
  for (const target of ["s0.t0.p0", "c99", "c1"]) {
    const f = fixture(), w = f.wire([f.claim("c1", f.rows[0], { kind: "correction", corrects: [target] })]);
    assert.throws(() => lab.validateClaimLedger(f.input, w), { code: "claim_correction_target" });
  }
  const f = fixture(), w = f.wire([
    f.claim("c1", f.rows[0], { kind: "correction", corrects: ["c2"] }),
    f.claim("c2", f.rows[1], { kind: "correction", corrects: ["c1"] })
  ]);
  assert.throws(() => lab.validateClaimLedger(f.input, w), { code: "claim_correction_cycle" });
  w.claims[0].kind = "report";
  assert.throws(() => lab.validateClaimLedger(f.input, w), { code: "claim_schema" });
});
test("dispositions account for fragments without becoming fact coverage or suppression authority", () => {
  const f = fixture(), w = f.wire([f.claim("c1", f.rows[0])]);
  w.dispositions = [{ fragment: f.rows[1][0], reason: "context", claim_ids: [] }];
  const r = lab.projectClaimLedger(f.input, w);
  assert.equal(r.coverage.status, "FRAGMENTS_ACCOUNTED_ONLY");
  assert.equal(r.coverage.semantic_coverage, "NOT_EVALUATED");
  assert.equal(r.publishable, false);
  assert.equal(r.ledger.dispositions[0].reason, "context");
});
test("missing and unresolved fragments remain visible nonblocking quality findings", () => {
  const f = fixture("A。\nB。\nC。"), w = f.wire([f.claim("c1", f.rows[0])]);
  w.dispositions = [{ fragment: f.rows[1][0], reason: "unresolved", claim_ids: [] }];
  const r = lab.projectClaimLedger(f.input, w);
  assert.deepEqual(r.coverage.unaccounted_fragment_ids, [f.rows[2][0]]);
  assert.deepEqual(r.coverage.unresolved_fragment_ids, [f.rows[1][0]]);
  assert.equal(r.quality_findings.length, 2); assert.equal(r.coverage.status, "GAPS_REMAIN");
});
test("invalid disposition accounting rejects unknown, repeated, quoted and dangling duplicate targets", () => {
  for (const disposition of [
    { fragment: "missing", reason: "context", claim_ids: [] },
    { fragment: "quoted", reason: "context", claim_ids: [] },
    { fragment: "pending", reason: "duplicate", claim_ids: [] },
    { fragment: "pending", reason: "duplicate", claim_ids: ["c99"] },
    { fragment: "pending", reason: "context", claim_ids: ["c1"] },
    { fragment: "pending", reason: "context", claim_ids: [], injected: true }
  ]) {
    const f = fixture(), w = f.wire([f.claim("c1", f.rows[0])]);
    w.dispositions = [{ ...disposition, fragment: disposition.fragment === "quoted" ? f.rows[0][0]
      : disposition.fragment === "pending" ? f.rows[1][0] : disposition.fragment }];
    assert.throws(() => lab.validateClaimLedger(f.input, w));
  }
  const f = fixture(), w = f.wire([f.claim("c1", f.rows[0])]);
  const d = { fragment: f.rows[1][0], reason: "duplicate", claim_ids: ["c1"] };
  w.dispositions = [d, d];
  assert.throws(() => lab.validateClaimLedger(f.input, w), { code: "claim_disposition" });
});
test("a false paraphrase and an incorrectly composite claim cannot acquire semantic certification", () => {
  const f = fixture("维护正常；统计写入失败。");
  const w = f.wire([f.claim("c1", f.rows[0], { text: "维护和统计全部成功" })]);
  const r = lab.projectClaimLedger(f.input, w);
  assert.equal(r.coverage.status, "FRAGMENTS_ACCOUNTED_ONLY");
  assert.equal(r.semantic_correctness, "NOT_CERTIFIED");
  assert.equal(r.coverage.semantic_coverage, "NOT_EVALUATED");
});
test("returned evidence and ledger cannot mutate the input or caller's wire", () => {
  const f = fixture(), w = f.wire([f.claim("c1", f.rows[0])]), before = structuredClone(w);
  const r = lab.projectClaimLedger(f.input, w);
  r.ledger.claims[0].text = "mutated"; r.claims[0].sources[0].text = "mutated";
  assert.deepEqual(w, before); assert.notEqual(f.input.sources[0].units[0].text, "mutated");
});
test("input, fragments, claims and full rendered body have explicit non-truncating limits", () => {
  const f = fixture(), w = f.wire(f.rows.map((r, i) => f.claim("c" + (i + 1), r)));
  assert.throws(() => lab.buildClaimPrompt(f.input, { maxInputChars: 10 }), { code: "claim_input_budget" });
  assert.throws(() => lab.buildClaimPrompt(f.input, { maxFragments: 1 }), { code: "claim_fragment_budget" });
  assert.throws(() => lab.validateClaimLedger(f.input, w, { maxClaims: 1 }), { code: "claim_schema" });
  const body = lab.projectClaimLedger(f.input, w).body;
  assert.equal(lab.projectClaimLedger(f.input, w, { bodyMaxChars: body.length }).body, body);
  assert.throws(() => lab.projectClaimLedger(f.input, w, { bodyMaxChars: body.length - 1 }), { code: "claim_body_budget" });
});
test("invalid budget values reject rather than alter limits", () => {
  for (const settings of [{ bodyMaxChars: 0 }, { maxInputChars: NaN }, { maxFragments: 4097 }, { maxClaims: -1 }])
    assert.throws(() => lab.buildClaimPrompt(fixture().input, settings), { code: "claim_options" });
});
test("one inventory request renders every supplied claim with full source and no second model compression", async () => {
  const f = fixture(), seen = [];
  const r = await lab.runClaimInventory(f.input, async request => {
    seen.push(request); return JSON.stringify(f.wire(f.rows.map((row, i) => f.claim("c" + (i + 1), row))));
  });
  assert.equal(seen.length, 1); assert.equal(seen[0].stage, "claim_inventory");
  assert.equal(r.status, "READY_FOR_REVIEW"); assert.equal(r.claims.length, 2);
  assert.equal(r.publisherCalls, 0); assert.deepEqual(r.record.source, f.input);
});
test("transport, JSON, binding, quote and body failures retain evidence without retries", async () => {
  for (const mode of ["transport", "json", "binding", "quote", "body", "size"]) {
    const f = fixture(); let calls = 0;
    const r = await lab.runClaimInventory(f.input, async () => {
      calls++;
      if (mode === "transport") throw Error("sensitive transport details");
      if (mode === "json") return "not JSON";
      if (mode === "size") return "x".repeat(1048577);
      const w = f.wire([f.claim("c1", f.rows[0])]);
      if (mode === "binding") w.binding = "other";
      if (mode === "quote") w.claims[0].quotes[0].quote = "missing";
      return JSON.stringify(w);
    }, mode === "body" ? { bodyMaxChars: 1 } : {});
    assert.equal(calls, 1); assert.equal(r.status, "REJECTED");
    assert.equal(r.publisherCalls, 0); assert.deepEqual(r.record.source, f.input);
    assert.ok(!JSON.stringify(r).includes("sensitive transport details"));
    if (mode !== "transport") assert.equal(typeof r.record.raw_response, "string");
  }
});
test("input-budget failures and pre-cancellation never invoke a provider", async () => {
  for (const settings of [{ maxInputChars: 1 }, { signal: AbortSignal.abort() }]) {
    let calls = 0;
    const r = await lab.runClaimInventory(fixture().input, async () => { calls++; }, settings);
    assert.equal(calls, 0); assert.equal(r.status, "REJECTED");
  }
});
test("optional captured records survive full-input fragmentation without losing any visible unit", {
  skip: process.env.MEMORY_ENGINE_TEST_CHECKPOINT_RECORDS ? false : "set MEMORY_ENGINE_TEST_CHECKPOINT_RECORDS for private captured records"
}, () => {
  const records = JSON.parse(require("node:fs").readFileSync(process.env.MEMORY_ENGINE_TEST_CHECKPOINT_RECORDS, "utf8"));
  const input = buildFactInput(records, DATE), request = lab.buildClaimPrompt(input);
  const packet = JSON.parse(request.prompt), rows = packet.SOURCE.sources.flatMap(s => s.fragments);
  let visible = 0;
  for (const source of input.sources) for (const unit of source.units) {
    if (/^(HEARTBEAT_OK|\[OpenClaw heartbeat poll\])$/.test(unit.text.trim())) continue;
    visible++;
    assert.equal(rows.filter(row => row[1] === unit.id).map(row => row[4]).join(""), unit.text);
  }
  assert.equal(request.fragmentCount, rows.length); assert.ok(visible > 0);
  assert.equal(packet.body_max_chars, 20000);
});
test("source mutation or cancellation during generation prevents success", async () => {
  for (const mode of ["source", "cancel"]) {
    const f = fixture(), controller = new AbortController();
    const r = await lab.runClaimInventory(f.input, async () => {
      if (mode === "source") { f.input.sources[0].units[0].text += "!"; f.input.sources[0].units[0].end++; }
      else controller.abort();
      return JSON.stringify(f.wire([f.claim("c1", f.rows[0])]));
    }, { signal: controller.signal });
    assert.equal(r.status, "REJECTED");
    assert.equal(r.error, mode === "source" ? "claim_source_changed" : "claim_cancelled");
  }
});
