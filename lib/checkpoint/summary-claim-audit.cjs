"use strict";
// Experimental claim-by-claim review. Model coverage declarations are quality
// observations, never proof of semantic completeness or permission to publish.
const { createHash } = require("node:crypto");
const repair = require("./summary-scoped-repair.cjs");
const VERSION = repair.AUDIT_VERSION;
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = code => { throw Object.assign(new Error(code), { code }); };
const text = x => typeof x === "string" && x.trim().length > 0;
const keys = ["version", "target_date", "binding", "summary_sha256", "replacements", "appends", "moves", "additions", "findings", "claim_checks"];
const statuses = ["represented", "omitted", "excluded", "uncertain"];
function exact(value, names) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\0") !== [...names].sort().join("\0")) fail("claim_audit_schema");
}
function options(settings) {
  if (!settings || typeof settings !== "object"
    || Object.keys(settings).some(k => !["maxInputChars", "summaryMaxChars", "signal"].includes(k))) fail("claim_audit_options");
  const { maxInputChars = 200000, summaryMaxChars = 20000, signal } = settings;
  if (![maxInputChars, summaryMaxChars].every(n => Number.isSafeInteger(n) && n > 0 && n <= 200000)) fail("claim_audit_options");
  return { maxInputChars, summaryMaxChars, signal };
}
function claimChecks(inventory, current, checks) {
  if (!Array.isArray(checks) || checks.length > 4096) fail("claim_audit_schema");
  const claims = new Set(inventory.claims.map(c => c.id));
  const items = new Set(current.items.map((_, n) => "i" + String(n + 1).padStart(3, "0")));
  const seen = new Set(), valid = [], invalid = [];
  for (const [index, check] of checks.entries()) {
    exact(check, ["claim_id", "status", "item_ids", "note"]);
    if (!text(check.claim_id) || !statuses.includes(check.status) || !text(check.note)
      || !Array.isArray(check.item_ids) || check.item_ids.length > 256 || !check.item_ids.every(text)) fail("claim_audit_schema");
    const problems = [];
    if (!claims.has(check.claim_id)) problems.push("unknown_claim");
    if (seen.has(check.claim_id)) problems.push("duplicate_claim");
    if (new Set(check.item_ids).size !== check.item_ids.length) problems.push("duplicate_item");
    if (check.item_ids.some(id => !items.has(id))) problems.push("unknown_item");
    if (check.status === "represented" && !check.item_ids.length) problems.push("represented_without_item");
    if (["omitted", "excluded"].includes(check.status) && check.item_ids.length) problems.push("unexpected_items");
    seen.add(check.claim_id);
    if (problems.length) invalid.push({ index, check: structuredClone(check), problems });
    else valid.push(structuredClone(check));
  }
  const reviewed = new Set(valid.map(c => c.claim_id));
  return { compare_to: "FROZEN_BASE_SUMMARY", semantic_correctness: "NOT_CERTIFIED",
    raw_checks: structuredClone(checks), valid_checks: valid, invalid_checks: invalid,
    unreviewed_claim_ids: [...claims].filter(id => !reviewed.has(id)),
    status_counts: Object.fromEntries(statuses.map(s => [s, valid.filter(c => c.status === s).length])) };
}
async function runClaimAuditReview(input, inventory, current, invoke, settings = {}) {
  if (typeof invoke !== "function") fail("claim_audit_invoke");
  const source = structuredClone(input), ledger = structuredClone(inventory), base = structuredClone(current);
  let raw = null, wire = null, audit = null, request = null;
  const before = hash([input, inventory, current]);
  const active = () => {
    if (settings.signal?.aborted) fail("claim_audit_cancelled");
    if (hash([input, inventory, current]) !== before) fail("claim_audit_source_changed");
  };
  const record = () => ({ source, inventory: ledger, base_summary: base, raw_response: raw });
  try {
    const cfg = options(settings); active();
    request = repair.buildClaimAuditPrompt(source, ledger, base, cfg);
    const outputBindings = Object.freeze({ version: VERSION, target_date: source.target_date,
      binding: request.binding, summary_sha256: request.summarySha256 });
    const reply = await invoke(Object.freeze({ ...request, outputContract: "claim_audit_review", outputBindings, signal: cfg.signal }));
    if (typeof reply === "string") raw = reply;
    active();
    if (raw === null || Buffer.byteLength(raw, "utf8") > 1048576) fail("claim_audit_response");
    try { wire = JSON.parse(raw); } catch (_) { fail("claim_audit_json"); }
    exact(wire, keys);
    if (wire.version !== VERSION || wire.target_date !== base.target_date || wire.binding !== base.binding
      || wire.summary_sha256 !== hash(base)) fail("claim_audit_binding");
    audit = claimChecks(ledger, base, wire.claim_checks);
    // Explicit wire conversion: only the audit protocol tag and sidecar are
    // removed. The model's hashes, edits and citations are never repaired.
    const patch = structuredClone(wire);
    delete patch.claim_checks; patch.version = repair.VERSION;
    const result = repair.applyScopedRepair(source, base, patch, cfg);
    const notes = [];
    if (audit.invalid_checks.length) notes.push("Invalid claim review records: " + audit.invalid_checks.length);
    if (audit.unreviewed_claim_ids.length) notes.push("Claims without a usable review record: " + audit.unreviewed_claim_ids.length);
    for (const name of ["omitted", "excluded", "uncertain"])
      if (audit.status_counts[name]) notes.push("Model-declared " + name + " in frozen base: " + audit.status_counts[name]);
    return { status: "READY_FOR_REVIEW", ...result, version: VERSION, claimAudit: audit, quality_findings: notes,
      modelResponse: wire, record: record(), request: { inputChars: request.inputChars, binding: request.binding,
        summary_sha256: request.summarySha256 }, semantic_improvement: "NOT_EVALUATED", publishable: false, publisherCalls: 0 };
  } catch (cause) {
    return { status: "REJECTED", version: VERSION, error: cause.code || "claim_audit_failed", claimAudit: audit,
      modelResponse: wire, record: record(), request: request && { inputChars: request.inputChars, binding: request.binding,
        summary_sha256: request.summarySha256 }, semantic_correctness: "NOT_CERTIFIED",
      semantic_improvement: "NOT_EVALUATED", publishable: false, publisherCalls: 0 };
  }
}
module.exports = { VERSION, runClaimAuditReview };
