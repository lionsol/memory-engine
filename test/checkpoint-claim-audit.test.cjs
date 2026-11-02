"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const audit = require("../lib/checkpoint/summary-claim-audit.cjs");
const repair = require("../lib/checkpoint/summary-scoped-repair.cjs");
const claims = require("../lib/checkpoint/summary-claim-ledger.cjs");
const cli = require("../lib/checkpoint/codex-summary.cjs");
const { buildFactInput } = require("../lib/checkpoint/ordinary-summary-facts");
function fixture() {
  const input = buildFactInput([{ source: "conversation", role: "assistant",
    text: "助手报告 Gateway 健康。报告修订阶段仅修改了报告，未重启。" }], "2026-10-20");
  const p = JSON.parse(claims.buildClaimPrompt(input, { referenceMode: "fragment_ids" }).prompt);
  const fragment = p.SOURCE.sources[0].fragments[0][0], unit = input.sources[0].units[0].id;
  const inventory = { version: p.version, target_date: p.target_date, binding: p.binding, dispositions: [],
    claims: [
      { id: "c1", scope: "Gateway", kind: "report", text: "报告 Gateway 健康", conditions: [], corrects: [], evidence: [fragment] },
      { id: "c2", scope: "报告修订阶段", kind: "report", text: "仅修改报告，未重启", conditions: [], corrects: [], evidence: [fragment] }
    ] };
  const composed = JSON.parse(require("../lib/checkpoint/summary-claim-compose.cjs").buildClaimSummaryPrompt(input, inventory).prompt);
  const req = JSON.parse(repair.buildClaimAuditPrompt(input, inventory, {
    version: composed.version, target_date: composed.target_date, binding: composed.binding,
    items: [{ scope: "Gateway 核对", conclusion: "助手报告 Gateway 健康", conditions: [], unresolved: [], evidence: [unit], corrects: [] }]
  }).prompt);
  const base = req.CURRENT_SUMMARY; delete base.items[0].item_id;
  const respond = request => ({ ...request.outputBindings, replacements: [], appends: [], moves: [], additions: [], findings: [],
    claim_checks: [
      { claim_id: "c1", status: "represented", item_ids: ["i001"], note: "仅Gateway结果已呈现" },
      { claim_id: "c2", status: "omitted", item_ids: [], note: "引用同段不代表报告修订结果已呈现" }
    ] });
  return { input, inventory, base, unit, respond };
}
test("audit prompt requests every claim separately even when independent facts share one cited source unit", () => {
  const f = fixture(), request = repair.buildClaimAuditPrompt(f.input, f.inventory, f.base);
  const p = JSON.parse(request.prompt);
  assert.equal(p.repair_version, audit.VERSION); assert.deepEqual(p.claim_audit.claim_ids, ["c1", "c2"]);
  assert.equal(p.claim_audit.compare_to, "FROZEN_BASE_SUMMARY");
  assert.ok(!Object.hasOwn(p, "review_scope")); assert.ok(!Object.hasOwn(p, "addition_scope"));
  assert.match(request.system, /findings,claim_checks。/);
  assert.match(request.system, /同一原文段落可含多个独立命题/);
  const old = repair.buildScopedRepairPrompt(f.input, f.inventory, f.base);
  assert.equal(JSON.parse(old.prompt).repair_version, repair.VERSION);
  assert.ok(!old.system.includes("findings,claim_checks。"));
  const args = cli.cliArgs({ model: "fixture", effort: "xhigh" }, "claim_audit_review");
  const schema = JSON.parse(fs.readFileSync(args[args.indexOf("--output-schema") + 1]));
  assert.deepEqual(schema.properties.version.enum, [audit.VERSION]); assert.ok(schema.required.includes("claim_checks"));
});
test("a same-unit omitted fact may be added while audit remains about the frozen base and unrelated fields stay intact", async () => {
  const f = fixture(), frozen = JSON.stringify(f.base);
  const result = await audit.runClaimAuditReview(f.input, f.inventory, f.base, async request => {
    assert.equal(request.outputContract, "claim_audit_review"); assert.ok(Object.isFrozen(request.outputBindings));
    const wire = f.respond(request);
    wire.additions.push({ scope: "报告修订阶段", conclusion: "助手报告该阶段仅修改报告，未重启",
      conditions: [], unresolved: [], evidence: [f.unit], corrects: [] });
    return JSON.stringify(wire);
  });
  assert.equal(result.status, "READY_FOR_REVIEW"); assert.equal(result.response.items.length, 2);
  assert.deepEqual(result.scopedResponse.items[0], f.base.items[0]); assert.equal(JSON.stringify(f.base), frozen);
  assert.equal(result.claimAudit.status_counts.omitted, 1);
  assert.equal(result.claimAudit.valid_checks[1].status, "omitted", "newly proposed content was not in the frozen base");
  assert.equal(result.repairAudit[0].action, "add_item");
  assert.equal(result.semantic_correctness, "NOT_CERTIFIED"); assert.equal(result.semantic_improvement, "NOT_EVALUATED");
  assert.equal(result.publishable, false); assert.equal(result.publisherCalls, 0);
});
test("omissions, exclusions, uncertain and missing or unusable claim accounting are nonblocking quality findings", async () => {
  const f = fixture();
  const result = await audit.runClaimAuditReview(f.input, f.inventory, f.base, async request => {
    const wire = f.respond(request);
    wire.claim_checks = [
      { claim_id: "c1", status: "excluded", item_ids: [], note: "模型主动压缩" },
      { claim_id: "c1", status: "represented", item_ids: ["i001"], note: "重复声明" },
      { claim_id: "unknown", status: "uncertain", item_ids: [], note: "不存在的ID" },
      { claim_id: "c2", status: "represented", item_ids: ["i999"], note: "不存在的事项" }
    ];
    return JSON.stringify(wire);
  });
  assert.equal(result.status, "READY_FOR_REVIEW"); assert.equal(result.claimAudit.invalid_checks.length, 3);
  assert.deepEqual(result.claimAudit.unreviewed_claim_ids, ["c2"]);
  assert.equal(result.claimAudit.status_counts.excluded, 1);
  assert.deepEqual(result.scopedResponse, f.base); assert.equal(result.claimAudit.raw_checks.length, 4);
  const empty = await audit.runClaimAuditReview(f.input, f.inventory, f.base,
    async r => JSON.stringify({ ...f.respond(r), claim_checks: [] }));
  assert.equal(empty.status, "READY_FOR_REVIEW"); assert.deepEqual(empty.claimAudit.unreviewed_claim_ids, ["c1", "c2"]);
});
test("audit sidecar cannot relax source hashes, patch targets or evidence validation", async () => {
  const f = fixture();
  for (const mutate of [
    w => { w.summary_sha256 = "0".repeat(64); },
    w => { w.version = repair.VERSION; },
    w => { w.appends.push({ item_id: "i999", field: "conditions", part: { scope: "阶段", text: "限制", evidence: [f.unit] },
      reason: "错误目标", evidence: [f.unit] }); },
    w => { w.additions.push({ scope: "新项", conclusion: "无证据", conditions: [], unresolved: [], evidence: ["unknown"], corrects: [] }); }
  ]) {
    let raw;
    const result = await audit.runClaimAuditReview(f.input, f.inventory, f.base, async r => {
      const wire = f.respond(r); mutate(wire); raw = JSON.stringify(wire); return raw;
    });
    assert.equal(result.status, "REJECTED"); assert.equal(result.record.raw_response, raw);
    assert.ok(!Object.hasOwn(result, "response")); assert.equal(result.publisherCalls, 0);
  }
});
test("manual scopes, extra stages and invalid budgets are rejected before invoking a model", async () => {
  const f = fixture();
  for (const settings of [{ reviewScope: {} }, { additionScope: {} }, { retry: 1 }, { summaryMaxChars: 0 },
    { signal: AbortSignal.abort() }]) {
    let calls = 0;
    const result = await audit.runClaimAuditReview(f.input, f.inventory, f.base, async () => { calls++; }, settings);
    assert.equal(result.status, "REJECTED"); assert.equal(calls, 0);
  }
});
test("cancellation or concurrent mutation preserves the raw response without applying a patch", async () => {
  for (const mode of ["cancel", "mutate"]) {
    const f = fixture(), controller = new AbortController(); let raw;
    const result = await audit.runClaimAuditReview(f.input, f.inventory, f.base, async r => {
      raw = JSON.stringify(f.respond(r));
      if (mode === "cancel") controller.abort(); else f.inventory.claims[0].text += "changed";
      return raw;
    }, { signal: controller.signal });
    assert.equal(result.status, "REJECTED"); assert.equal(result.record.raw_response, raw);
    assert.equal(result.error, mode === "cancel" ? "claim_audit_cancelled" : "claim_audit_source_changed");
    assert.ok(!Object.hasOwn(result, "response"));
  }
});
test("malformed audit shape is rejected while unsupported semantic conclusions remain untrusted", async () => {
  const f = fixture();
  const result = await audit.runClaimAuditReview(f.input, f.inventory, f.base, async r => {
    const wire = f.respond(r); wire.claim_checks[0].status = "CERTIFIED_COMPLETE"; return JSON.stringify(wire);
  });
  assert.equal(result.status, "REJECTED"); assert.equal(result.error, "claim_audit_schema");
  const claimedComplete = await audit.runClaimAuditReview(f.input, f.inventory, f.base, async r => {
    const wire = f.respond(r);
    wire.claim_checks[1] = { claim_id: "c2", status: "represented", item_ids: ["i001"], note: "模型声称已覆盖" };
    return JSON.stringify(wire);
  });
  assert.equal(claimedComplete.status, "READY_FOR_REVIEW");
  assert.equal(claimedComplete.claimAudit.status_counts.represented, 2);
  assert.equal(claimedComplete.semantic_correctness, "NOT_CERTIFIED", "complete model accounting is still not semantic proof");
  assert.equal(claimedComplete.publishable, false);
});
