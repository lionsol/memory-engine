"use strict";
// Explicit experimental pipeline: one inventory, one composition, one review.
// No production writer, transport selection, retry loop or semantic acceptance gate.
const { createHash } = require("node:crypto");
const inventory = require("./summary-claim-ledger.cjs");
const compose = require("./summary-claim-compose.cjs");
const repair = require("./summary-scoped-repair.cjs");
const claimAudit = require("./summary-claim-audit.cjs");
const { VERSION: SUMMARY_VERSION } = require("./summary-comparison-lab.cjs");
const VERSION = "checkpoint-summary-pipeline-v1";
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = code => { throw Object.assign(new Error(code), { code }); };
const CONTRACTS = Object.freeze({
  inventory: "claim_ledger_fragments", compose: "scoped_summary", review: "scoped_summary_repair"
});
function options(settings) {
  const allowed = new Set(["maxInputChars", "inventoryMaxChars", "summaryMaxChars", "reviewMode", "signal", "onStage"]);
  if (!settings || typeof settings !== "object" || Object.keys(settings).some(key => !allowed.has(key))) fail("pipeline_options");
  const { maxInputChars = 200000, inventoryMaxChars = 200000, summaryMaxChars = 20000, reviewMode = "local", signal, onStage } = settings;
  if (![maxInputChars, inventoryMaxChars, summaryMaxChars].every(n => Number.isSafeInteger(n) && n > 0 && n <= 200000)
    || !["local", "claim_audit"].includes(reviewMode)
    || (onStage !== undefined && typeof onStage !== "function")) fail("pipeline_options");
  return { maxInputChars, inventoryMaxChars, summaryMaxChars, reviewMode, signal, onStage };
}
async function runSummaryPipeline(input, invoke, settings = {}) {
  if (typeof invoke !== "function") fail("pipeline_invoke");
  const source = structuredClone(input), stages = {}, requests = [];
  let cfg, lastValidCandidate = null, stage = "inventory";
  const before = hash(input);
  const active = () => {
    if (cfg?.signal?.aborted) fail("pipeline_cancelled");
    if (hash(input) !== before || hash(source) !== before) fail("pipeline_source_changed");
  };
  const call = name => async request => {
    active();
    const auditReview = name === "review" && cfg.reviewMode === "claim_audit";
    const outputContract = auditReview ? "claim_audit_review" : CONTRACTS[name];
    const entry = { stage: name, output_contract: outputContract, input_chars: request.inputChars, raw_response: null };
    requests.push(entry);
    const outputBindings = Object.freeze({ version: name === "inventory" ? inventory.FRAGMENT_VERSION
      : name === "compose" ? SUMMARY_VERSION : auditReview ? claimAudit.VERSION : repair.VERSION, target_date: source.target_date, binding: request.binding,
      ...(name === "review" ? { summary_sha256: request.summarySha256 } : {}) });
    const reply = await invoke(Object.freeze({ ...request, pipelineStage: name, outputContract, outputBindings }));
    if (typeof reply === "string") entry.raw_response = reply;
    active();
    return reply;
  };
  const checkpoint = async (name, outcome) => {
    stages[name] = outcome;
    if (cfg.onStage) {
      try { await cfg.onStage({ stage: name, outcome: structuredClone(outcome) }); }
      catch (_) { fail("pipeline_checkpoint_failed"); }
    }
    active();
    if (outcome.status !== "READY_FOR_REVIEW") fail(outcome.error || "pipeline_stage_rejected");
  };
  const envelope = () => ({ version: VERSION, generation_count: requests.length, requests, stages,
    record: { source }, lastValidCandidate, semantic_correctness: "NOT_CERTIFIED",
    semantic_improvement: "NOT_EVALUATED", publishable: false, publisherCalls: 0 });
  try {
    cfg = options(settings); active();
    const claims = await inventory.runClaimInventory(source, call("inventory"), {
      maxInputChars: cfg.maxInputChars, bodyMaxChars: cfg.inventoryMaxChars, referenceMode: "fragment_ids",
      dispositionPolicy: "quality_findings", signal: cfg.signal
    });
    await checkpoint("inventory", claims);
    stage = "compose";
    // Only invalid non-claim accounting entries are excluded in this explicit view.
    // Original model bytes, all claims and the ignored entries remain in stages.inventory.
    const effectiveInventory = claims.effective_ledger ?? claims.ledger;
    const summary = await compose.runClaimSummary(source, effectiveInventory, call("compose"), {
      maxInputChars: cfg.maxInputChars, summaryMaxChars: cfg.summaryMaxChars, outputMode: "scoped_fields", signal: cfg.signal
    });
    if (summary.status === "READY_FOR_REVIEW") lastValidCandidate = {
      stage: "compose", response: structuredClone(summary.response), scopedResponse: structuredClone(summary.scopedResponse),
      body: summary.body, bodyChars: summary.bodyChars, semantic_correctness: "NOT_CERTIFIED"
    };
    await checkpoint("compose", summary);
    stage = "review";
    // No human-selected item/source scope, previous repaired answer or manual reference.
    const review = cfg.reviewMode === "claim_audit" ? claimAudit.runClaimAuditReview : repair.runScopedRepair;
    const reviewed = await review(source, effectiveInventory, summary.scopedResponse, call("review"), {
      maxInputChars: cfg.maxInputChars, summaryMaxChars: cfg.summaryMaxChars, signal: cfg.signal
    });
    await checkpoint("review", reviewed);
    return { status: "READY_FOR_REVIEW", ...envelope(), response: reviewed.response, scopedResponse: reviewed.scopedResponse,
      body: reviewed.body, bodyChars: reviewed.bodyChars, validation: reviewed.validation,
      candidate_origin: cfg.reviewMode === "claim_audit" ? "SINGLE_CLAIM_AUDIT_MODEL_REVIEW" : "SINGLE_UNRESTRICTED_MODEL_REVIEW" };
  } catch (cause) {
    return { status: "REJECTED", ...envelope(), failed_stage: stage, error: cause.code || "pipeline_failed",
      candidate_origin: null };
  }
}
module.exports = { VERSION, runSummaryPipeline };
