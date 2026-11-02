"use strict";
// Evidence presentation laboratory only. Not selected by the summary pipeline.
// The paired native observation did not support enabling adjacency by default.
const claims = require("./summary-claim-ledger.cjs");
const compose = require("./summary-claim-compose.cjs");
const SOURCE_EVIDENCE_RULE = "source_evidence与source_context是程序从冻结SOURCE逐字复制的原片段及标题/表头上下文，不是模型改写。逐条先核对这些原文，再判断claim草稿的scope/text/conditions有无遗漏或扩大；草稿不能替代原文。按原文保留对应事实的时间、执行阶段、否定范围和例外，不从同主题其他事项借用限定。原文也可能只是请求、报告或建议，不因此认证真实执行；最终evidence仍只用原unit.id，勿把整段引用当作全部事实已保留。";
const fail = code => { throw Object.assign(new Error(code), { code }); };
function options(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)
    || Object.keys(settings).some(k => !["maxInputChars", "summaryMaxChars", "outputMode", "signal"].includes(k))) fail("adjacent_options");
  const { maxInputChars = 200000, summaryMaxChars = 20000, outputMode = "prose", signal } = settings;
  if (![maxInputChars, summaryMaxChars].every(n => Number.isSafeInteger(n) && n > 0 && n <= 200000)
    || !["prose", "scoped_fields"].includes(outputMode)) fail("adjacent_options");
  return { maxInputChars, summaryMaxChars, outputMode, signal };
}
function augment(input, inventory, base, cfg) {
  const checked = claims.validateClaimLedger(input, inventory, { referenceMode: "fragment_ids" });
  const packet = JSON.parse(base.prompt), contexts = new Map(checked.source_context.map(c => [c.id, c]));
  packet.claim_inventory.evidence_presentation = { mode: "adjacent_fragments",
    source_evidence_columns: ["fragment_id", "unit_id", "role", "text"],
    source_context_columns: ["unit_id", "role", "kind", "text"], semantic_correctness: "NOT_CERTIFIED" };
  packet.claim_inventory.claims = checked.ledger.claims.map((claim, index) => {
    const refs = checked.claims[index].sources;
    return { id: claim.id,
      source_evidence: refs.map(f => [f.id, f.unit_id, f.role, f.quote]),
      source_context: [...new Set(refs.flatMap(f => f.context_ids))].map(id => {
        const c = contexts.get(id); return [c.unit_id, c.role, c.kind, c.quote];
      }),
      ...structuredClone(claim), evidence_units: [...new Set(refs.map(f => f.unit_id))] };
  });
  const system = base.system + "\n" + SOURCE_EVIDENCE_RULE, prompt = JSON.stringify(packet);
  const inputChars = system.length + prompt.length;
  if (inputChars > cfg.maxInputChars) fail("claim_compose_input_budget");
  return { ...base, system, prompt, inputChars };
}
function buildAdjacentClaimSummaryPrompt(input, inventory, settings = {}) {
  const cfg = options(settings);
  return augment(input, inventory, compose.buildClaimSummaryPrompt(input, inventory, cfg), cfg);
}
async function runAdjacentClaimSummary(input, inventory, invoke, settings = {}) {
  if (typeof invoke !== "function") fail("claim_compose_invoke");
  const cfg = options(settings), source = structuredClone(input), ledger = structuredClone(inventory);
  let actualRequest = null;
  // Reuse source mutation/cancellation guards, response validation and scoped
  // projection. Only the actual model input is changed; no output is repaired.
  const outcome = await compose.runClaimSummary(input, inventory, async base => {
    actualRequest = augment(source, ledger, base, cfg);
    return invoke(actualRequest);
  }, cfg);
  if (actualRequest && outcome.requests.length) outcome.requests[0].inputChars = actualRequest.inputChars;
  return { ...outcome, experiment: { evidence_presentation: "adjacent_fragments", semantic_improvement: "NOT_ESTABLISHED" } };
}
module.exports = { SOURCE_EVIDENCE_RULE, buildAdjacentClaimSummaryPrompt, runAdjacentClaimSummary };
