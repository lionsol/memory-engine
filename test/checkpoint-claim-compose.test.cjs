"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const compose = require("../lib/checkpoint/summary-claim-compose.cjs");
const claims = require("../lib/checkpoint/summary-claim-ledger.cjs");
const summaries = require("../lib/checkpoint/summary-comparison-lab.cjs");
const { buildFactInput } = require("../lib/checkpoint/ordinary-summary-facts");
function fixture() {
  const input = buildFactInput([{ text: "维护报告正常。\n独立统计任务正常写入。", role: "assistant", source: "conversation" }], "2026-10-20");
  const p = JSON.parse(claims.buildClaimPrompt(input, { referenceMode: "fragment_ids" }).prompt);
  const row = p.SOURCE.sources[0].fragments[0];
  const inventory = { version: claims.FRAGMENT_VERSION, target_date: p.target_date, binding: p.binding,
    claims: [{ id: "c001", scope: "当次维护", kind: "report", text: "维护正常", evidence: [row[0]],
      conditions: ["这是报告，不是独立核验"], corrects: [] }], dispositions: [] };
  const reply = request => {
    const packet = JSON.parse(request.prompt);
    return { version: summaries.VERSION, target_date: packet.target_date, binding: packet.binding,
      items: [{ topic: "维护", text: "报告称维护正常", evidence: [input.sources[0].units[0].id], corrects: [] }] };
  };
  return { input, inventory, row, reply };
}
test("composition sees identical complete source plus a bound untrusted inventory and program-mapped unit IDs", () => {
  const f = fixture(), before = { input: structuredClone(f.input), inventory: structuredClone(f.inventory) };
  const r = compose.buildClaimSummaryPrompt(f.input, f.inventory);
  const a = JSON.parse(r.prompt), b = JSON.parse(summaries.buildPrompt(f.input, "direct", { summaryMaxChars: 20000 }).prompt);
  assert.deepEqual(a.SOURCE, b.SOURCE); assert.equal(a.binding, b.binding);
  assert.equal(a.summary_max_chars, 20000);
  assert.equal(a.claim_inventory.status, "UNTRUSTED_MODEL_DRAFT");
  assert.deepEqual(a.claim_inventory.claims[0].evidence_units, [f.input.sources[0].units[0].id]);
  assert.deepEqual(a.claim_inventory.claims[0].conditions, f.inventory.claims[0].conditions);
  assert.equal(a.claim_inventory.coverage.status, "GAPS_REMAIN");
  assert.equal(a.claim_inventory.correction_validity, "MODEL_DECLARED_NOT_CERTIFIED");
  assert.equal(r.inventoryObjectSha256, a.claim_inventory.object_sha256);
  assert.deepEqual(f.input, before.input); assert.deepEqual(f.inventory, before.inventory);
});
test("one final synthesis request cannot regenerate the inventory or certify its own summary", async () => {
  const f = fixture(); let calls = 0;
  const r = await compose.runClaimSummary(f.input, f.inventory, async request => {
    calls++; assert.equal(request.stage, "claim_compose"); return JSON.stringify(f.reply(request));
  });
  assert.equal(calls, 1); assert.equal(r.status, "READY_FOR_REVIEW");
  assert.equal(r.publisherCalls, 0); assert.equal(r.semantic_correctness, "NOT_CERTIFIED");
  assert.equal(r.validation.coverage, "NOT_EVALUATED"); assert.deepEqual(r.record.inventory, f.inventory);
  assert.equal(r.response.items[0].text, "报告称维护正常");
});
test("wrong inventory binding, references and input budget stop before provider invocation", async () => {
  for (const mode of ["binding", "reference", "budget"]) {
    const f = fixture(); let calls = 0;
    if (mode === "binding") f.inventory.binding = "wrong";
    if (mode === "reference") f.inventory.claims[0].evidence = ["unknown"];
    const r = await compose.runClaimSummary(f.input, f.inventory, async () => { calls++; }, mode === "budget" ? { maxInputChars: 1 } : {});
    assert.equal(calls, 0); assert.equal(r.status, "REJECTED");
  }
});
test("source and draft mutations reject without losing the returned model text or changing snapshots", async () => {
  for (const mode of ["source", "inventory"]) {
    const f = fixture(), source = structuredClone(f.input), inventory = structuredClone(f.inventory);
    let returned;
    const r = await compose.runClaimSummary(f.input, f.inventory, async request => {
      returned = JSON.stringify(f.reply(request));
      if (mode === "source") { f.input.sources[0].units[0].text += "!"; f.input.sources[0].units[0].end++; }
      else f.inventory.claims[0].text = "concurrent change";
      return returned;
    });
    assert.equal(r.error, "claim_compose_source_changed"); assert.equal(r.record.raw_response, returned);
    assert.deepEqual(r.record.source, source); assert.deepEqual(r.record.inventory, inventory);
  }
});
test("bad JSON, output binding, fragment/claim citations and budget overflow never retry or truncate", async () => {
  for (const mode of ["json", "binding", "fragment", "claim", "budget"]) {
    const f = fixture(); let calls = 0;
    const r = await compose.runClaimSummary(f.input, f.inventory, async request => {
      calls++;
      if (mode === "json") return "not JSON";
      const reply = f.reply(request);
      if (mode === "binding") reply.binding = "wrong";
      if (mode === "fragment") reply.items[0].evidence = [f.row[0]];
      if (mode === "claim") reply.items[0].evidence = ["c001"];
      return JSON.stringify(reply);
    }, mode === "budget" ? { summaryMaxChars: 1 } : {});
    assert.equal(calls, 1); assert.equal(r.status, "REJECTED");
    assert.equal(typeof r.record.raw_response, "string");
  }
});
test("duplicate valid citations remain unchanged and semantic errors cannot acquire certification", async () => {
  const f = fixture();
  const r = await compose.runClaimSummary(f.input, f.inventory, async request => {
    const reply = f.reply(request); reply.items[0].evidence.push(reply.items[0].evidence[0]);
    reply.items[0].text = "没有任何独立任务，这个错误不会被结构验证认证";
    return JSON.stringify(reply);
  });
  assert.equal(r.status, "READY_FOR_REVIEW"); assert.equal(r.response.items[0].evidence.length, 2);
  assert.equal(r.semantic_correctness, "NOT_CERTIFIED"); assert.equal(r.validation.publishable, false);
});
test("pre- and post-generation cancellation cannot return successful composition", async () => {
  const f = fixture(); let calls = 0;
  const pre = await compose.runClaimSummary(f.input, f.inventory, async () => { calls++; }, { signal: AbortSignal.abort() });
  assert.equal(calls, 0); assert.equal(pre.error, "claim_compose_cancelled");
  const controller = new AbortController();
  const post = await compose.runClaimSummary(f.input, f.inventory, async request => {
    controller.abort(); return JSON.stringify(f.reply(request));
  }, { signal: controller.signal });
  assert.equal(post.error, "claim_compose_cancelled"); assert.equal(typeof post.record.raw_response, "string");
});
test("invalid configuration and provider failures preserve records without raw diagnostics", async () => {
  const f = fixture();
  assert.throws(() => compose.buildClaimSummaryPrompt(f.input, f.inventory, { summaryMaxChars: 0 }), { code: "claim_compose_options" });
  const r = await compose.runClaimSummary(f.input, f.inventory, async () => { throw Error("private network diagnostics"); });
  assert.equal(r.error, "claim_compose_failed"); assert.deepEqual(r.record.inventory, f.inventory);
  assert.ok(!JSON.stringify(r).includes("private network diagnostics"));
});
