export const CANONICAL_VECTOR_PROJECTION_VERSION = 1;
export const CANONICAL_VECTOR_TEXT_MAX_CHARS = 2000;

function projectionFailure(message) {
  return new TypeError(`canonical vector projection requires ${message}`);
}

function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw projectionFailure(`a non-empty ${field}`);
  }
  return value;
}

function requireCanonicalMemory(canonicalMemory = {}) {
  if (!canonicalMemory || typeof canonicalMemory !== "object" || Array.isArray(canonicalMemory)) {
    throw projectionFailure("a canonical memory object");
  }
  requireNonEmptyString(canonicalMemory.memory_id, "memory_id");
  requireNonEmptyString(canonicalMemory.canonical_id, "canonical_id");
  if (!canonicalMemory.source || typeof canonicalMemory.source !== "object" || Array.isArray(canonicalMemory.source)) {
    throw projectionFailure("source authority");
  }
  if (typeof canonicalMemory.source.text !== "string") {
    throw projectionFailure("an exact source.text string");
  }
  if (!canonicalMemory.content_ref || typeof canonicalMemory.content_ref !== "object" || Array.isArray(canonicalMemory.content_ref)) {
    throw projectionFailure("content_ref authority");
  }
  requireNonEmptyString(canonicalMemory.content_ref.content_hash, "content_ref.content_hash");
  return canonicalMemory;
}

function requireVector(vector) {
  const isArray = Array.isArray(vector);
  const isTypedArray = ArrayBuffer.isView(vector) && !(vector instanceof DataView);
  if ((!isArray && !isTypedArray) || vector.length === 0) {
    throw projectionFailure("a non-empty finite vector");
  }
  const copied = Array.from(vector);
  if (!copied.every(value => Number.isFinite(value))) {
    throw projectionFailure("a non-empty finite vector");
  }
  return copied;
}

function validateVectorProjection(vectorProjection = {}) {
  if (!vectorProjection || typeof vectorProjection !== "object" || Array.isArray(vectorProjection)) {
    throw projectionFailure("a vector projection");
  }
  requireNonEmptyString(vectorProjection.memory_id, "vector projection memory_id");
  requireNonEmptyString(vectorProjection.canonical_id, "vector projection canonical_id");
  requireNonEmptyString(vectorProjection.source_content_hash, "vector projection source_content_hash");
  if (vectorProjection.projection_version !== CANONICAL_VECTOR_PROJECTION_VERSION) {
    throw projectionFailure(`projection_version ${CANONICAL_VECTOR_PROJECTION_VERSION}`);
  }
  if (typeof vectorProjection.text !== "string" || vectorProjection.embedding_input !== vectorProjection.text) {
    throw projectionFailure("embedding_input equal to text");
  }
  return vectorProjection;
}

export function projectCanonicalMemoryToVectorProjection(canonicalMemory) {
  const canonical = requireCanonicalMemory(canonicalMemory);
  const sourceText = canonical.source.text;
  const text = sourceText.slice(0, CANONICAL_VECTOR_TEXT_MAX_CHARS);

  return {
    projection_version: CANONICAL_VECTOR_PROJECTION_VERSION,
    memory_id: canonical.memory_id,
    canonical_id: canonical.canonical_id,
    source_content_hash: canonical.content_ref.content_hash,
    text,
    embedding_input: text,
    text_truncated: sourceText.length > CANONICAL_VECTOR_TEXT_MAX_CHARS,
    source_text_length: sourceText.length,
  };
}

export function materializeCanonicalLanceRow(vectorProjection, { vector, timestamp } = {}) {
  const projection = validateVectorProjection(vectorProjection);
  if (!Number.isFinite(timestamp)) throw projectionFailure("a finite numeric timestamp");

  return {
    id: projection.memory_id,
    text: projection.text,
    vector: requireVector(vector),
    timestamp,
  };
}
