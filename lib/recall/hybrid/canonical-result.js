const BOUNDED_MEMORY_ID_LENGTH = 16;

function canonicalProjectionError(message) {
  return new TypeError(`canonical Hybrid result projection requires ${message}`);
}

function canonicalFields(canonicalMemory = {}) {
  if (!canonicalMemory || typeof canonicalMemory !== "object" || Array.isArray(canonicalMemory)) {
    throw canonicalProjectionError("a canonical memory object");
  }
  if (typeof canonicalMemory.memory_id !== "string" || canonicalMemory.memory_id.trim().length === 0) {
    throw canonicalProjectionError("an exact memory_id");
  }
  if (typeof canonicalMemory.canonical_id !== "string" || canonicalMemory.canonical_id.trim().length === 0) {
    throw canonicalProjectionError("an exact canonical_id");
  }
  if (!canonicalMemory.source || typeof canonicalMemory.source !== "object") {
    throw canonicalProjectionError("source authority");
  }
  if (!canonicalMemory.classification || typeof canonicalMemory.classification !== "object") {
    throw canonicalProjectionError("classification authority");
  }
  if (!canonicalMemory.lifecycle || typeof canonicalMemory.lifecycle !== "object") {
    throw canonicalProjectionError("lifecycle authority");
  }
  return canonicalMemory;
}

export function projectHybridResultFromCanonical(item = {}, canonicalMemory = {}) {
  const canonical = canonicalFields(canonicalMemory);
  const source = canonical.source;
  const classification = canonical.classification;
  const lifecycle = canonical.lifecycle;
  const managed = lifecycle.management === "managed";

  return {
    id: String(item.id || "").slice(0, BOUNDED_MEMORY_ID_LENGTH),
    memory_id: canonical.memory_id,
    canonical_id: canonical.canonical_id,
    text: String(item.text || "").slice(0, 240),
    path: source.path || "",
    category: classification.category,
    kind: classification.kind,
    category_authority: classification.category_authority,
    confidence_mode: managed ? "managed" : "external",
    source_type: managed ? "memory-engine-managed" : "openclaw-core",
    external_badge: !managed,
    decay_eligible: item.decay_eligible,
    archive_eligible: item.archive_eligible,
    semantic_score: item.semanticScore,
    rrf_score: item.rrfScore,
    recency_boost: item.recencyBoost,
    category_boost: item.categoryBoost,
    confidence_boost: item.confidenceBoost,
    external_boost: item.externalBoost,
    final_score: item.finalScore,
    sources: item.sources,
    similarity: item.similarity,
    confidence: item.confidence,
    hits: managed ? lifecycle.hit_count : 0,
    created_at: item.created_at || 0,
  };
}
