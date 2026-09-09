/**
 * Pure projection from resolved canonical memory objects to rerank text.
 *
 * This module deliberately has no database, disclosure, permission, or
 * provider responsibilities. Code-point budgets are explicit caller inputs.
 */

export const CANONICAL_RERANK_MAX_CANDIDATES = 50;
export const CANONICAL_RERANK_MAX_CODE_POINTS_PER_CANDIDATE = 8_000;
export const CANONICAL_RERANK_MAX_TOTAL_CODE_POINTS = 400_000;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidInput(reason) {
  throw new TypeError(`canonical_rerank_text_${reason}`);
}

function validateBudget(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(`canonical_rerank_text_${name}_must_be_positive_safe_integer_at_most_${maximum}`);
  }
}

function codePoints(text) {
  return Array.from(text);
}

function validateMemories(memories) {
  if (!Array.isArray(memories)) invalidInput("memories_must_be_array");
  if (memories.length > CANONICAL_RERANK_MAX_CANDIDATES) {
    throw new RangeError("canonical_rerank_text_candidate_count_exceeds_50");
  }

  const ids = new Set();
  return memories.map((memory, index) => {
    if (!isRecord(memory)) invalidInput(`memory_${index}_must_be_record`);
    if (typeof memory.memory_id !== "string" || memory.memory_id.trim().length === 0) {
      invalidInput(`memory_${index}_memory_id_must_be_nonempty_string`);
    }
    if (ids.has(memory.memory_id)) invalidInput("memory_ids_must_be_unique");
    ids.add(memory.memory_id);

    if (!isRecord(memory.source)) invalidInput(`memory_${index}_source_must_be_record`);
    if (memory.source.record_type !== "chunk") {
      invalidInput(`memory_${index}_source_record_type_must_be_chunk`);
    }
    if (memory.source.record_id !== memory.memory_id) {
      invalidInput(`memory_${index}_source_record_id_must_match_memory_id`);
    }
    if (typeof memory.source.text !== "string") {
      invalidInput(`memory_${index}_source_text_must_be_string`);
    }

    return {
      id: memory.memory_id,
      sourceText: memory.source.text,
    };
  });
}

/**
 * @param {{memories: Array<object>, maxCodePointsPerCandidate: number, maxTotalCodePoints: number}} input
 * @returns {{candidates: Array<{id: string, text: string}>, metadata: Array<{id: string, originalCodePoints: number, outputCodePoints: number, truncated: boolean}>, totalCodePoints: number}}
 */
export function projectCanonicalRerankTexts({
  memories,
  maxCodePointsPerCandidate,
  maxTotalCodePoints,
} = {}) {
  validateBudget(
    maxCodePointsPerCandidate,
    "max_code_points_per_candidate",
    CANONICAL_RERANK_MAX_CODE_POINTS_PER_CANDIDATE,
  );
  validateBudget(
    maxTotalCodePoints,
    "max_total_code_points",
    CANONICAL_RERANK_MAX_TOTAL_CODE_POINTS,
  );
  const validMemories = validateMemories(memories);

  const projected = validMemories.map(memory => {
    const originalCodePoints = codePoints(memory.sourceText);
    const truncated = originalCodePoints.length > maxCodePointsPerCandidate;
    const text = truncated
      ? originalCodePoints.slice(0, maxCodePointsPerCandidate).join("")
      : memory.sourceText;
    return {
      candidate: { id: memory.id, text },
      metadata: {
        id: memory.id,
        originalCodePoints: originalCodePoints.length,
        outputCodePoints: Array.from(text).length,
        truncated,
      },
    };
  });

  const totalCodePoints = projected.reduce(
    (total, item) => total + item.metadata.outputCodePoints,
    0,
  );
  if (totalCodePoints > maxTotalCodePoints) {
    throw new RangeError("canonical_rerank_text_total_code_points_exceeds_budget");
  }

  return {
    candidates: projected.map(item => item.candidate),
    metadata: projected.map(item => item.metadata),
    totalCodePoints,
  };
}
