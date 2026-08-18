import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const CONTRACT_DOC = new URL("../docs/canonical-memory-object-contract.md", import.meta.url);

function readContract() {
  return readFileSync(CONTRACT_DOC, "utf8");
}

test("Phase 2.5-A canonical contract exists and is design-only", () => {
  assert.equal(existsSync(CONTRACT_DOC), true);
  const doc = readContract();
  assert.match(doc, /Phase 2\.5-A — Canonical Memory Object Contract/);
  assert.match(doc, /not another database/i);
  assert.match(doc, /does not authorize runtime mutation/i);
  assert.match(doc, /does not:\n\n- create a canonical-memory table/i);
  assert.match(doc, /no runtime canary by default/i);
});

test("contract freezes the four semantic ownership classes", () => {
  const doc = readContract();
  for (const token of [
    "source_fact",
    "lifecycle_state",
    "derived_projection",
    "runtime_only_evidence",
  ]) {
    assert.match(doc, new RegExp(token));
  }
  assert.match(doc, /Every field exposed by the Canonical Memory Object belongs to exactly one semantic class/i);
});

test("canonical identity is Core-chunk based and independent of projection versions", () => {
  const doc = readContract();
  assert.match(doc, /memory_id\s*= exact Core chunk id/i);
  assert.match(doc, /canonical_id = "cmem:core:" \+ memory_id/i);
  assert.match(doc, /same Core chunk id \+ new canonical schema version => same canonical_id/i);
  assert.match(doc, /same canonical_id \+ new card\/recall\/vector projection version => same canonical_id/i);
  assert.match(doc, /does not invent a logical lineage id/i);
});

test("Core source mapping preserves exact authority and excludes index metadata", () => {
  const doc = readContract();
  for (const [coreField, canonicalField] of [
    ["Core.start_line", "canonical source.line_start"],
    ["Core.end_line", "canonical source.line_end"],
    ["Core.source", "canonical source.core_source"],
    ["Core.hash", "canonical source.core_hash"],
    ["Core.updated_at", "canonical source.updated_at"],
  ]) {
    assert.match(doc, new RegExp(`${coreField.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+->\\s+${canonicalField.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
  assert.match(doc, /source_fact.*authority and ownership/i);
  assert.match(doc, /does not convert it to ISO/i);
  assert.match(doc, /Core\.model.*excluded.*semantic payload/i);
  assert.match(doc, /Core\.embedding.*excluded.*semantic payload/i);
});

test("canonical identity rejects P4 truncation and fallback identity synthesis", () => {
  const doc = readContract();
  assert.match(doc, /stableObjectId\(\)/);
  assert.match(doc, /exact-id path truncates.*32 characters/i);
  assert.match(doc, /id-less fallback identity mixes `?projectionVersion`|id-less fallback identity mixes `projectionVersion`/i);
  assert.match(doc, /memoryId\(\).*synthesize fallback identity/i);
  assert.match(doc, /requires the exact Core chunk id and fails closed/i);
});

test("Core, Engine, Lance, card, and runtime ownership stay distinct", () => {
  const doc = readContract();
  assert.match(doc, /Core source facts are read-only/i);
  assert.match(doc, /Engine owns mutable lifecycle\/confidence state/i);
  assert.match(doc, /Lance is a derived vector projection only/i);
  assert.match(doc, /Runtime retrieval evidence is never canonical state/i);
  assert.match(doc, /Memory Card is:/i);
  assert.match(doc, /P4 MemoryObject is a projection, not the canonical object/i);
});

test("canonical content authority is full Core text rather than bounded previews", () => {
  const doc = readContract();
  assert.match(doc, /`text` is the full Core chunk text/i);
  assert.match(doc, /not the 600-character retrieval preview/i);
  assert.match(doc, /not the 2000-character Lance projection text/i);
  assert.match(doc, /exact Core chunk text/i);
});

test("managed and external memories cannot blur Engine ownership", () => {
  const doc = readContract();
  assert.match(doc, /lifecycle\.management = managed/i);
  assert.match(doc, /lifecycle\.management = external/i);
  assert.match(doc, /`lifecycle\.category` is `null`/i);
  assert.match(doc, /classification\.category.*derived_projection/i);
  assert.match(doc, /lifecycle\.category.*lifecycle_state/i);
  assert.match(doc, /confidence fields are `null`/i);
  assert.match(doc, /must not fabricate Engine confidence/i);
  assert.match(doc, /fallback inference does not convert an external Core item into an Engine-managed item/i);
});

test("category authority and kind mappings are frozen for Canonical v1", () => {
  const doc = readContract();
  for (const token of [
    "matching Engine `memory_confidence.category` -> `authority=engine`",
    "explicit supported `Category:` metadata in source text -> `authority=source_metadata`",
    "supported deterministic path mapping from `category-inference.js` -> `authority=path_inference`",
    "otherwise `category=unknown` -> `authority=unknown`",
    "`autoRouteCategory()` is forbidden for Canonical v1",
    "text_inference",
    "2.5-B v1 MUST NOT emit it",
    "`preference` / `user_identity`",
    "`project` | `project_state`",
    "`episodic` | `episode`",
    "`raw_log` | `diagnostic`",
    "`workflow` / `workflow_rule`",
    "`stats` | `quality_signal`",
    "otherwise | `fact`",
    "must not call an LLM",
  ]) {
    assert.equal(doc.includes(token), true, `missing contract token: ${token}`);
  }
});

test("temporal and eligibility boundaries are explicit", () => {
  const doc = readContract();
  assert.match(doc, /memory\/episodes\/YYYY-MM-DD\.md/);
  assert.match(doc, /natural-language dates found in text are not promoted/i);
  assert.match(doc, /ELIGIBILITY_CONTRACT=/);
  assert.match(doc, /frozen fields: none/i);
  assert.match(doc, /deferred fields: eligibility\.retrieval\.\*, eligibility\.vector\.\*, eligibility\.disclosure\.\*/i);
  assert.match(doc, /no unique canonical baseline rule exists/i);
  assert.match(doc, /cross_agent_scope.*runtime context rather than canonical baseline risk/i);
  assert.match(doc, /query threshold.*RRF score.*vector-skip decision/i);
});

test("runtime query evidence is excluded from canonical payload", () => {
  const doc = readContract();
  for (const token of [
    "retrieval rank",
    "FTS/vector/KG score",
    "RRF/final score",
    "trace id",
    "query-specific salience reason",
    "AutoRecall injection decision",
  ]) {
    assert.match(doc, new RegExp(token, "i"));
  }
  assert.match(doc, /These values are forbidden from the canonical semantic payload/i);
});

test("Phase 2.5-B stays read-only and isolated while 2.5-D owns later reconciliation writes", () => {
  const doc = readContract();
  assert.match(doc, /Phase 2\.5-B is read-only/i);
  assert.match(doc, /Core: readonly handle/i);
  assert.match(doc, /Engine: readonly handle during 2\.5-B/i);
  assert.match(doc, /no generic combined Core\+Engine SQL required/i);
  assert.match(doc, /2\.5-D — Reconciliation Integration/i);
  assert.match(doc, /separate higher-risk persistent-write change/i);
  assert.match(doc, /exact Core id lookup only/i);
  assert.match(doc, /no Engine row => valid external object/i);
  assert.match(doc, /must not synthesize identity from path\/span\/text/i);
});
