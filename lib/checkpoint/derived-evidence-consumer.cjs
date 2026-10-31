"use strict";
// Final-executor evidence boundary. Policies come from host-owned closures,
// never from tool arguments. Each declared use rereads immutable raw archives.
const { createHash } = require("node:crypto");
const path = require("node:path");
const archive = require("./summary-memory-archive.cjs");
const { readDerivedSummary } = require("./derived-summary");
const PURPOSES = ["execution", "exact_parameters", "acceptance", "disputed_claims"];
const ID = /^[a-f0-9]{64}$/;
class DerivedEvidenceBoundaryError extends Error {
  constructor(reason) { super(reason); this.name = "DerivedEvidenceBoundaryError"; this.code = "MEMORY_DERIVED_EVIDENCE_REQUIRED"; this.reason = reason; }
}
const fail = reason => { throw new DerivedEvidenceBoundaryError(reason); };
function snapshot(value) {
  let nodes = 0, bytes = 0;
  function visit(current, depth) {
    if (++nodes > 20000 || depth > 32) fail("derived_use_budget");
    if (current === null || typeof current === "boolean") return current;
    if (typeof current === "number" && Number.isFinite(current)) return current;
    if (typeof current === "string" && current.isWellFormed()) {
      bytes += current.length; if (bytes > 1000000) fail("derived_use_budget");
      return current;
    }
    if (Array.isArray(current)) {
      if (current.length > 20000) fail("derived_use_budget");
      if (Reflect.ownKeys(current).length !== current.length + 1) fail("derived_use_json");
      const descriptors = Object.getOwnPropertyDescriptors(current), copy = [];
      for (let i = 0; i < current.length; i++) {
        if (!descriptors[i]?.enumerable || !Object.hasOwn(descriptors[i], "value")) fail("derived_use_json");
        copy.push(visit(descriptors[i].value, depth + 1));
      }
      return Object.freeze(copy);
    }
    if (!current || typeof current !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(current))) {
      fail("derived_use_json");
    }
    const descriptors = Object.getOwnPropertyDescriptors(current), copy = Object.create(null);
    if (Reflect.ownKeys(current).length !== Object.keys(descriptors).length) fail("derived_use_json");
    for (const key of Object.keys(descriptors).sort()) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail("derived_use_json");
      bytes += key.length; if (bytes > 1000000) fail("derived_use_budget");
      copy[key] = visit(descriptor.value, depth + 1);
    }
    return Object.freeze(copy);
  }
  return visit(value, 0);
}
function operationDigest({ toolName, toolCallId, params }) {
  return createHash("sha256").update(JSON.stringify(snapshot({
    tool_name: toolName, tool_call_id: toolCallId, params,
  }))).digest("hex");
}
function declarationFor(value, expectedDigest) {
  const declaration = snapshot(value);
  if (!declaration || Array.isArray(declaration) || typeof declaration !== "object"
    || Object.keys(declaration).sort().join(",") !== "operation_sha256,purpose,references"
    || declaration.operation_sha256 !== expectedDigest) fail("derived_use_binding");
  if (!PURPOSES.includes(declaration.purpose)) fail("derived_use_purpose");
  if (!Array.isArray(declaration.references) || declaration.references.length < 1 || declaration.references.length > 16) {
    fail("derived_use_references");
  }
  const seen = new Set(), references = [];
  for (const reference of declaration.references) {
    if (!reference || typeof reference !== "object" || Array.isArray(reference)
      || Object.keys(reference).some(key => !["archive_id", "item_index"].includes(key))
      || !ID.test(reference.archive_id || "")
      || (Object.hasOwn(reference, "item_index") && (!Number.isSafeInteger(reference.item_index)
        || reference.item_index < 0 || reference.item_index > 255))) fail("derived_use_reference");
    const key = reference.archive_id + ":" + (reference.item_index ?? "all");
    if (!seen.has(key)) { seen.add(key); references.push(reference); }
  }
  return { purpose: declaration.purpose, references };
}
function wrapDerivedEvidenceConsumer({ memoryDir, toolName, resolveDeclaration, execute }) {
  if (typeof toolName !== "string" || !toolName.trim() || typeof resolveDeclaration !== "function"
    || typeof execute !== "function") throw new TypeError("invalid derived evidence boundary configuration");
  return async function executeWithDerivedEvidence(toolCallId, params, trustedContext = {}) {
    const signal = trustedContext.signal;
    const active = () => { if (signal?.aborted) fail("derived_use_cancelled"); };
    active();
    if (typeof toolCallId !== "string" || !toolCallId.trim()) fail("derived_use_call_id");
    const frozenParams = snapshot(params);
    const digest = operationDigest({ toolName, toolCallId, params: frozenParams });
    const invocation = Object.freeze({ toolName, toolCallId, params: frozenParams, operation_sha256: digest });
    let proposed;
    try { proposed = await resolveDeclaration(invocation, trustedContext); }
    catch { fail("derived_use_policy_failed"); }
    active();
    // Only an explicit host null declares this operation outside the guard's
    // scope. Strings/objects inside tool params cannot enable or satisfy it.
    if (proposed === null) return execute(toolCallId, frozenParams, null, trustedContext);
    if (proposed === undefined) fail("derived_use_policy_missing");
    const declaration = declarationFor(proposed, digest);
    if (typeof memoryDir !== "string" || !path.isAbsolute(memoryDir)) fail("derived_use_directory");
    const directory = path.join(memoryDir, "checkpoint-archives"), evidence = [];
    for (const reference of declaration.references) {
      active();
      let read;
      try {
        read = readDerivedSummary(reference.archive_id, { directory, purpose: declaration.purpose,
          itemIndex: reference.item_index });
      } catch { fail("derived_use_archive_invalid"); }
      if (read.archive_id !== reference.archive_id || !read.items.length || !read.original_records.length) {
        fail("derived_use_original_missing");
      }
      evidence.push(read);
    }
    // A later read must not allow corruption/removal of an earlier source to
    // escape the final check. These are immutable IDs; no revision substitution.
    for (const id of new Set(declaration.references.map(reference => reference.archive_id))) {
      active();
      try { archive.loadArchive(directory, id); } catch { fail("derived_use_archive_invalid"); }
    }
    active();
    const context = snapshot({ kind: "verified_derived_evidence_context", operation_sha256: digest,
      purpose: declaration.purpose, references: declaration.references,
      evidence: JSON.parse(JSON.stringify(evidence)),
      semantic_correctness: "NOT_CERTIFIED",
      scope: "archived_collected_records_only; dialogue_is_not_independent_tool_verification" });
    return execute(toolCallId, frozenParams, context, trustedContext);
  };
}
module.exports = { DerivedEvidenceBoundaryError, operationDigest, wrapDerivedEvidenceConsumer };
