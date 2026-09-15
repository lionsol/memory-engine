export const LOCOMO_CHUNK_EVIDENCE_SCORE_SCHEMA = "q3_locomo_chunk_evidence_score_v1";
export const LOCOMO_CHUNK_EVIDENCE_BUDGET = 3;
export const LOCOMO_CHUNK_METRICS = Object.freeze([
  "recall_any@3",
  "recall_all@3",
  "ndcg@3",
  "evidence_coverage@3",
]);

const METRIC_KEYS = LOCOMO_CHUNK_METRICS;
const OFFICIAL_EVIDENCE_ID = /^D([1-9]\d*):([1-9]\d*)$/;
const NDCG_UNAVAILABLE_REASON = "formal_idcg_contract_pending_cross_chunk_dependencies";
const BUDGET_FEASIBILITY_UNKNOWN_REASON = "formal_minimum_chunk_cover_not_computed";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  if (!isRecord(value)) throw new Error(`${label}_must_be_object`);
  return value;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}_must_be_nonempty_string`);
  }
  return value;
}

function requireCaseIdentity({ sampleId, qaIndex }) {
  const normalizedSampleId = requireNonEmptyString(sampleId, "sample_id");
  if (!Number.isSafeInteger(qaIndex) || qaIndex < 0) {
    throw new Error("qa_index_must_be_nonnegative_integer");
  }
  return {
    sampleId: normalizedSampleId,
    qaIndex,
    questionId: `${normalizedSampleId}:qa:${qaIndex}`,
  };
}

function caseKey(sampleId, qaIndex) {
  return `${sampleId}\u0000${qaIndex}`;
}

function sourceKey(sampleId, sessionId) {
  return `${sampleId}\u0000${sessionId}`;
}

function turnKey(sampleId, diaId) {
  return `${sampleId}\u0000${diaId}`;
}

function nonEmptyArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label}_must_be_nonempty_array`);
  }
  return value;
}

function intervalOverlaps(left, right) {
  return left.startUtf16 < right.endUtf16 && right.startUtf16 < left.endUtf16;
}

function validRange(range) {
  return isRecord(range)
    && Number.isSafeInteger(range.startUtf16)
    && Number.isSafeInteger(range.endUtf16)
    && range.startUtf16 >= 0
    && range.endUtf16 > range.startUtf16;
}

function indexMaterial(material) {
  requireRecord(material, "chunk_material");
  if (!Array.isArray(material.sources)) throw new Error("chunk_material_sources_must_be_array");
  const chunksById = new Map();
  const turnsById = new Map();
  const sourcesByKey = new Map();
  for (const source of material.sources) {
    requireRecord(source, "chunk_material_source");
    const sourceId = sourceKey(
      requireNonEmptyString(source.sampleId, "source_sample_id"),
      requireNonEmptyString(source.sessionId, "source_session_id"),
    );
    if (sourcesByKey.has(sourceId)) throw new Error(`duplicate_source:${sourceId}`);
    sourcesByKey.set(sourceId, source);
    if (!Array.isArray(source.chunks)) throw new Error(`source_chunks_must_be_array:${sourceId}`);
    for (const chunk of source.chunks) {
      requireRecord(chunk, "chunk_material_chunk");
      const memoryId = requireNonEmptyString(chunk.memoryId, "chunk_memory_id");
      if (chunksById.has(memoryId)) throw new Error(`duplicate_chunk_memory_id:${memoryId}`);
      chunksById.set(memoryId, { ...chunk, source });
    }
    if (!Array.isArray(source.turnRanges)) throw new Error(`source_turn_ranges_must_be_array:${sourceId}`);
    for (const turn of source.turnRanges) {
      requireRecord(turn, "chunk_material_turn");
      const diaId = requireNonEmptyString(turn.diaId, "turn_dia_id");
      const key = turnKey(source.sampleId, diaId);
      if (turnsById.has(key)) throw new Error(`duplicate_turn_id:${key}`);
      turnsById.set(key, { ...turn, source });
    }
  }
  return { chunksById, turnsById, sourcesByKey };
}

function unknownMetrics() {
  return Object.fromEntries(METRIC_KEYS.map(key => [key, null]));
}

function countByReason(rows) {
  const counts = {};
  for (const row of rows) counts[row.reason] = (counts[row.reason] ?? 0) + 1;
  return counts;
}

function dcg(values) {
  return values.reduce((sum, value, index) => (
    sum + value / Math.log2(index + 2)
  ), 0);
}

function coverageForEvidence({ target, selectedChunks }) {
  if (!validRange(target.range)) {
    return {
      evidenceId: target.diaId,
      status: "unknown",
      reason: "evidence_source_offset_invalid",
      unknownScope: "material",
      chunkIds: [],
      unknownChunkIds: [],
    };
  }
  const targetRange = target.range;
  const exactOverlaps = [];
  const unknownOverlaps = [];
  for (const chunk of selectedChunks) {
    if (chunk.source !== target.source) continue;
    const position = chunk.position;
    if (position?.status === "exact" && validRange(position.range)) {
      if (intervalOverlaps(position.range, targetRange)) exactOverlaps.push(chunk);
      continue;
    }
    const lineStart = chunk.startLine;
    const lineEnd = chunk.endLine;
    if (Number.isSafeInteger(lineStart) && Number.isSafeInteger(lineEnd)
      && lineStart <= targetRange.endLine && lineEnd >= targetRange.startLine) {
      unknownOverlaps.push(chunk);
    }
  }
  if (unknownOverlaps.length > 0) {
    return {
      evidenceId: target.diaId,
      status: "unknown",
      reason: "selected_chunk_source_offset_unknown",
      unknownScope: "selection",
      chunkIds: exactOverlaps.map(chunk => chunk.memoryId),
      unknownChunkIds: unknownOverlaps.map(chunk => chunk.memoryId),
      targetRange,
    };
  }

  const intervals = exactOverlaps.map(chunk => ({
    startUtf16: Math.max(chunk.position.range.startUtf16, targetRange.startUtf16),
    endUtf16: Math.min(chunk.position.range.endUtf16, targetRange.endUtf16),
  })).filter(interval => interval.endUtf16 > interval.startUtf16)
    .toSorted((left, right) => left.startUtf16 - right.startUtf16 || left.endUtf16 - right.endUtf16);
  let coveredLength = 0;
  let cursor = null;
  for (const interval of intervals) {
    if (cursor === null) {
      cursor = { ...interval };
      continue;
    }
    if (interval.startUtf16 > cursor.endUtf16) {
      coveredLength += cursor.endUtf16 - cursor.startUtf16;
      cursor = { ...interval };
    } else if (interval.endUtf16 > cursor.endUtf16) {
      cursor.endUtf16 = interval.endUtf16;
    }
  }
  if (cursor !== null) coveredLength += cursor.endUtf16 - cursor.startUtf16;
  const targetLength = targetRange.endUtf16 - targetRange.startUtf16;
  const status = coveredLength >= targetLength
    ? "full"
    : (coveredLength > 0 ? "partial" : "miss");
  return {
    evidenceId: target.diaId,
    status,
    reason: status === "full" ? null : (status === "partial" ? "coverage_gap" : "no_selected_chunk_overlap"),
    chunkIds: exactOverlaps.map(chunk => chunk.memoryId),
    unknownChunkIds: [],
    targetRange,
    coveredUtf16: coveredLength,
    targetUtf16: targetLength,
    coverageRatio: coveredLength / targetLength,
  };
}

function materialUnknownForEvidence(target) {
  if (!validRange(target.range)) {
    return {
      reason: "evidence_source_offset_invalid",
      unknownScope: "material",
      unknownChunkIds: [],
    };
  }
  if (target.chunkCoverage?.status === "unknown") {
    const overlappingUnknownChunkIds = (target.source.chunks ?? []).filter(chunk => (
      chunk.position?.status !== "exact"
        && Number.isSafeInteger(chunk.startLine)
        && Number.isSafeInteger(chunk.endLine)
        && chunk.startLine <= target.range.endLine
        && chunk.endLine >= target.range.startLine
    )).map(chunk => chunk.memoryId);
    return {
      reason: "material_turn_coverage_unknown",
      unknownScope: "material",
      unknownChunkIds: [...new Set([
        ...(target.chunkCoverage.chunkIds ?? []),
        ...overlappingUnknownChunkIds,
      ])],
    };
  }
  const unknownChunks = (target.source.chunks ?? []).filter(chunk => {
    if (chunk.position?.status === "exact") return false;
    return Number.isSafeInteger(chunk.startLine)
      && Number.isSafeInteger(chunk.endLine)
      && chunk.startLine <= target.range.endLine
      && chunk.endLine >= target.range.startLine;
  });
  return unknownChunks.length === 0
    ? null
    : {
      reason: "material_source_offset_unknown",
      unknownScope: "material",
      unknownChunkIds: unknownChunks.map(chunk => chunk.memoryId),
    };
}

function frozenEvidenceRows({ index, identity, evidenceIds }) {
  return evidenceIds.map(evidenceId => {
    if (typeof evidenceId !== "string" || !OFFICIAL_EVIDENCE_ID.test(evidenceId)) {
      return {
        evidenceId,
        status: "unknown",
        reason: "evidence_id_invalid",
        unknownScope: "evidence_mapping",
        chunkIds: [],
        unknownChunkIds: [],
      };
    }
    const target = index.turnsById.get(turnKey(identity.sampleId, evidenceId));
    if (!target) {
      return {
        evidenceId,
        status: "unknown",
        reason: "evidence_turn_not_found",
        unknownScope: "evidence_mapping",
        chunkIds: [],
        unknownChunkIds: [],
      };
    }
    const materialUnknown = materialUnknownForEvidence(target);
    if (materialUnknown) {
      return {
        evidenceId,
        status: "unknown",
        ...materialUnknown,
        chunkIds: [],
        target,
      };
    }
    return { evidenceId, status: "known", target };
  });
}

/**
 * Determine the frozen material population without selecting chunks or
 * constructing retrieval scores. Empty/malformed evidence is unknown.
 */
export function classifyLocomoChunkMaterialPopulation({ material, evidenceCases }) {
  if (!Array.isArray(evidenceCases)) throw new Error("evidence_cases_must_be_array");
  const index = indexMaterial(material);
  return evidenceCases.map(item => {
    const identity = requireCaseIdentity({ sampleId: item.sampleId, qaIndex: item.qaIndex });
    const evidenceIds = Array.isArray(item.evidence)
      ? item.evidence.map(entry => entry.evidenceId)
      : item.evidence_ids;
    if (!Array.isArray(evidenceIds)) {
      return {
        question_id: identity.questionId,
        sample_id: identity.sampleId,
        qa_index: identity.qaIndex,
        category: item.category ?? null,
        evidence_count: 0,
        frozen_material_scoreable: false,
        frozen_unknown_evidence_ids: [],
        unknown_reasons: { evidence_ids_missing: 1 },
        unknown_evidence: [{ evidenceId: null, reason: "evidence_ids_missing", unknownScope: "evidence_mapping" }],
      };
    }
    const distinctEvidenceIds = evidenceIdsFromInput(evidenceIds);
    const frozenRows = frozenEvidenceRows({
      index,
      identity,
      evidenceIds: distinctEvidenceIds,
    });
    const unknownRows = frozenRows.filter(row => row.status === "unknown");
    return {
      question_id: identity.questionId,
      sample_id: identity.sampleId,
      qa_index: identity.qaIndex,
      category: item.category ?? null,
      evidence_count: distinctEvidenceIds.length,
      frozen_material_scoreable: frozenMaterialScoreable(
        distinctEvidenceIds,
        unknownRows.map(row => row.evidenceId),
      ),
      frozen_unknown_evidence_ids: unknownRows.map(row => row.evidenceId),
      unknown_reasons: countByReason(unknownRows.length > 0
        ? unknownRows
        : (distinctEvidenceIds.length === 0
          ? [{ reason: "evidence_ids_empty" }]
          : [])),
      unknown_evidence: unknownRows.map(row => ({
        evidenceId: row.evidenceId,
        reason: row.reason,
        unknownScope: row.unknownScope,
        unknownChunkIds: row.unknownChunkIds ?? [],
      })),
    };
  });
}

function selectedChunkIdsFromInput(selectedChunkIds) {
  if (!Array.isArray(selectedChunkIds)) throw new Error("selected_chunk_ids_must_be_array");
  const ids = selectedChunkIds.map((id, index) => requireNonEmptyString(id, `selected_chunk_id:${index}`));
  if (new Set(ids).size !== ids.length) throw new Error("selected_chunk_ids_must_be_unique");
  return ids;
}

function evidenceIdsFromInput(evidenceIds) {
  if (!Array.isArray(evidenceIds)) throw new Error("evidence_ids_must_be_array");
  return [...new Set(evidenceIds)];
}

function frozenMaterialScoreable(evidenceIds, frozenUnknownEvidenceIds) {
  return evidenceIds.length > 0 && frozenUnknownEvidenceIds.length === 0;
}

function scoreUnknownCase(identity, reason, extra = {}) {
  return {
    schema: LOCOMO_CHUNK_EVIDENCE_SCORE_SCHEMA,
    profile: "locomo_canonical_chunk_evidence_v1",
    question_id: identity.questionId,
    sample_id: identity.sampleId,
    qa_index: identity.qaIndex,
    scoreable: false,
    unknown: true,
    unknown_reasons: [reason],
    metrics: unknownMetrics(),
    diagnostics: {
      "completion_gains@3": null,
      "completion_dcg@3": null,
      ndcg_reason: NDCG_UNAVAILABLE_REASON,
    },
    budget: {
      k: LOCOMO_CHUNK_EVIDENCE_BUDGET,
      unit: "complete_chunk_id",
      status: "unknown",
      status_semantics: "observed_selected_top3_coverage",
      feasibility: "unknown",
      feasibility_reason: BUDGET_FEASIBILITY_UNKNOWN_REASON,
      basis: "selected_top3_source_offset_union",
    },
    ...extra,
  };
}

function resolveSelection(selectionMap, identity) {
  if (selectionMap instanceof Map) {
    if (selectionMap.has(identity.questionId)) return selectionMap.get(identity.questionId);
    if (selectionMap.has(caseKey(identity.sampleId, identity.qaIndex))) return selectionMap.get(caseKey(identity.sampleId, identity.qaIndex));
    return undefined;
  }
  if (!isRecord(selectionMap)) return undefined;
  if (Object.prototype.hasOwnProperty.call(selectionMap, identity.questionId)) return selectionMap[identity.questionId];
  const key = caseKey(identity.sampleId, identity.qaIndex);
  return Object.prototype.hasOwnProperty.call(selectionMap, key) ? selectionMap[key] : undefined;
}

export function evaluateLocomoChunkEvidenceCoverage({
  material,
  sampleId,
  qaIndex,
  evidenceIds,
  selectedChunkIds,
}) {
  const identity = requireCaseIdentity({ sampleId, qaIndex });
  const index = indexMaterial(material);
  const ids = evidenceIdsFromInput(evidenceIds);
  const selectedIds = selectedChunkIdsFromInput(selectedChunkIds);
  const frozenRows = frozenEvidenceRows({ index, identity, evidenceIds: ids });
  const selectedChunks = selectedIds.map(id => index.chunksById.get(id) ?? null);
  const missingChunkIds = selectedIds.filter((id, position) => selectedChunks[position] === null);
  if (ids.length === 0 || missingChunkIds.length > 0) {
    return {
      question_id: identity.questionId,
      scoreable: false,
      unknown: true,
      reason: ids.length === 0 ? "evidence_ids_empty" : "selected_chunk_id_not_found",
      selected_chunk_ids: selectedIds,
      missing_chunk_ids: missingChunkIds,
      evidence_count: ids.length,
      full_evidence_count: null,
      recall_any: null,
      recall_all: null,
      evidence_coverage: null,
    };
  }
  const evidenceRows = frozenRows.map(row => {
    if (row.status === "unknown") {
      const { target, ...publicRow } = row;
      return publicRow;
    }
    return coverageForEvidence({ target: row.target, selectedChunks });
  });
  const unknownRows = evidenceRows.filter(row => row.status === "unknown");
  const fullRows = evidenceRows.filter(row => row.status === "full");
  const scoreable = unknownRows.length === 0;
  return {
    question_id: identity.questionId,
    scoreable,
    unknown: !scoreable,
    reason: scoreable ? null : "evidence_coverage_unknown",
    selected_chunk_ids: selectedIds,
    missing_chunk_ids: [],
    evidence_count: evidenceRows.length,
    full_evidence_count: scoreable ? fullRows.length : null,
    recall_any: scoreable ? Number(fullRows.length > 0) : null,
    recall_all: scoreable ? Number(fullRows.length === evidenceRows.length) : null,
    evidence_coverage: scoreable ? fullRows.length / evidenceRows.length : null,
    evidence: evidenceRows,
  };
}

/**
 * Score one LoCoMo case at a chunk budget of three.
 *
 * A selected chunk contributes its exact source interval. Evidence is full
 * only when the union of selected intervals covers the complete official
 * turn body. Overlap is merged before coverage is measured. The four metric
 * fields are null whenever any evidence remains unknown; unknown is never a
 * miss or a zero.
 */
export function scoreLocomoChunkCase({
  material,
  sampleId,
  qaIndex,
  evidenceIds,
  selectedChunkIds,
  category = null,
}) {
  const identity = requireCaseIdentity({ sampleId, qaIndex });
  const index = indexMaterial(material);
  const ids = evidenceIdsFromInput(evidenceIds);
  const selectedIds = selectedChunkIdsFromInput(selectedChunkIds);
  const frozenRows = frozenEvidenceRows({ index, identity, evidenceIds: ids });
  const frozenUnknownRows = frozenRows.filter(row => row.status === "unknown");
  const frozenUnknownEvidenceIds = frozenUnknownRows.map(row => row.evidenceId);
  const isFrozenMaterialScoreable = frozenMaterialScoreable(ids, frozenUnknownEvidenceIds);
  const selectedChunks = selectedIds.map(id => index.chunksById.get(id) ?? null);
  const missingChunkIds = selectedIds.filter((id, position) => selectedChunks[position] === null);
  if (missingChunkIds.length > 0) {
    return scoreUnknownCase(identity, "selected_chunk_id_not_found", {
      category,
      evidence_ids: ids,
      ranked_selected_chunk_ids: selectedIds,
      selected_top3_chunk_ids: selectedIds.slice(0, LOCOMO_CHUNK_EVIDENCE_BUDGET),
      frozen_unknown_evidence_ids: frozenUnknownEvidenceIds,
      frozen_material_scoreable: isFrozenMaterialScoreable,
      selection_unknown_chunk_ids: missingChunkIds,
    });
  }
  const top3Chunks = selectedChunks.slice(0, LOCOMO_CHUNK_EVIDENCE_BUDGET);
  const selectionUnknownChunkIds = top3Chunks
    .filter(chunk => chunk.position?.status !== "exact")
    .map(chunk => chunk.memoryId);
  const distinctEvidenceIds = ids;
  if (distinctEvidenceIds.length === 0) {
    return scoreUnknownCase(identity, "evidence_ids_empty", {
      category,
      evidence_ids: distinctEvidenceIds,
      ranked_selected_chunk_ids: selectedIds,
      selected_top3_chunk_ids: selectedIds.slice(0, LOCOMO_CHUNK_EVIDENCE_BUDGET),
      frozen_unknown_evidence_ids: frozenUnknownEvidenceIds,
      frozen_material_scoreable: isFrozenMaterialScoreable,
    });
  }

  const evidenceRows = frozenRows.map(row => {
    if (row.status === "unknown") {
      const { target, ...publicRow } = row;
      return publicRow;
    }
    return coverageForEvidence({ target: row.target, selectedChunks: top3Chunks });
  });
  const unknownRows = evidenceRows.filter(row => row.status === "unknown");
  const fullRows = evidenceRows.filter(row => row.status === "full");
  const partialRows = evidenceRows.filter(row => row.status === "partial");
  const missRows = evidenceRows.filter(row => row.status === "miss");
  const scoreable = unknownRows.length === 0;
  const gains = [];
  if (scoreable) {
    let previousFull = new Set();
    for (let rank = 0; rank < top3Chunks.length; rank += 1) {
      const prefix = top3Chunks.slice(0, rank + 1);
      const currentFull = new Set(evidenceRows.map(row => row.evidenceId).filter(evidenceId => {
        const target = index.turnsById.get(turnKey(identity.sampleId, evidenceId));
        return target && coverageForEvidence({ target, selectedChunks: prefix }).status === "full";
      }));
      gains.push([...currentFull].filter(evidenceId => !previousFull.has(evidenceId)).length);
      previousFull = currentFull;
    }
  }
  const completionDcg = scoreable ? dcg(gains) : null;
  const metrics = scoreable
    ? {
      "recall_any@3": Number(fullRows.length > 0),
      "recall_all@3": Number(fullRows.length === evidenceRows.length),
      "ndcg@3": null,
      "evidence_coverage@3": fullRows.length / evidenceRows.length,
    }
    : unknownMetrics();
  const budgetStatus = !scoreable
    ? "unknown"
    : (metrics["recall_all@3"] === 1 ? "satisfied" : "not_satisfied");
  return {
    schema: LOCOMO_CHUNK_EVIDENCE_SCORE_SCHEMA,
    profile: "locomo_canonical_chunk_evidence_v1",
    question_id: identity.questionId,
    sample_id: identity.sampleId,
    qa_index: identity.qaIndex,
    category,
    scoreable,
    unknown: !scoreable,
    evidence_ids: distinctEvidenceIds,
    ranked_selected_chunk_ids: selectedIds,
    selected_top3_chunk_ids: selectedIds.slice(0, LOCOMO_CHUNK_EVIDENCE_BUDGET),
    evidence: evidenceRows,
    full_evidence_ids: fullRows.map(row => row.evidenceId),
    partial_evidence_ids: partialRows.map(row => row.evidenceId),
    miss_evidence_ids: missRows.map(row => row.evidenceId),
    unknown_evidence_ids: unknownRows.map(row => row.evidenceId),
    unknown_reasons: countByReason(unknownRows),
    metrics,
    budget: {
      k: LOCOMO_CHUNK_EVIDENCE_BUDGET,
      unit: "complete_chunk_id",
      selected_count: top3Chunks.length,
      evidence_count: evidenceRows.length,
      status: budgetStatus,
      status_semantics: "observed_selected_top3_coverage",
      feasibility: "unknown",
      feasibility_reason: BUDGET_FEASIBILITY_UNKNOWN_REASON,
      basis: "selected_top3_source_offset_union",
    },
    frozen_unknown_evidence_ids: frozenUnknownEvidenceIds,
    frozen_material_scoreable: isFrozenMaterialScoreable,
    selection_unknown_evidence_ids: evidenceRows
      .filter(row => row.unknownScope === "selection")
      .map(row => row.evidenceId),
    selection_unknown_chunk_ids: selectionUnknownChunkIds,
    diagnostics: {
      "completion_gains@3": scoreable ? gains : null,
      "completion_dcg@3": completionDcg,
      ndcg_reason: NDCG_UNAVAILABLE_REASON,
    },
  };
}

function legacyMetricView(row) {
  const score = row?.q1 ?? row?.score ?? row;
  const metrics = isRecord(score) ? score.metrics ?? score : {};
  const rawScoreable = score?.scoreable ?? row?.scoreable;
  return {
    scoreable: rawScoreable === true ? true : (rawScoreable === false ? false : null),
    unknown: score?.unknown === true || score?.unknown_or_unscoreable === true || rawScoreable === false,
    metrics: Object.fromEntries(METRIC_KEYS.map(key => [key, metrics[key] ?? null])),
  };
}

function rowIdentity(row) {
  if (!isRecord(row)) return null;
  if (typeof row.question_id === "string" && row.question_id.length > 0) return row.question_id;
  if (typeof row.sample_id === "string" && Number.isSafeInteger(row.qa_index)) {
    return `${row.sample_id}:qa:${row.qa_index}`;
  }
  return null;
}

/** Align old session-level rows and new chunk-level rows without pooling metrics. */
export function alignLocomoChunkScoreRows({ oldRows = [], chunkRows = [] }) {
  if (!Array.isArray(oldRows) || !Array.isArray(chunkRows)) throw new Error("alignment_rows_must_be_arrays");
  const oldById = new Map();
  const chunkById = new Map();
  for (const row of oldRows) {
    const id = rowIdentity(row);
    if (!id) throw new Error("old_alignment_row_identity_missing");
    if (oldById.has(id)) throw new Error(`duplicate_old_alignment_row:${id}`);
    oldById.set(id, row);
  }
  for (const row of chunkRows) {
    const id = rowIdentity(row);
    if (!id) throw new Error("chunk_alignment_row_identity_missing");
    if (chunkById.has(id)) throw new Error(`duplicate_chunk_alignment_row:${id}`);
    chunkById.set(id, row);
  }
  const ids = [...new Set([...oldById.keys(), ...chunkById.keys()])];
  const rows = ids.map(questionId => {
    const old = oldById.get(questionId) ?? null;
    const chunk = chunkById.get(questionId) ?? null;
    return {
      question_id: questionId,
      sample_id: chunk?.sample_id ?? old?.sample_id ?? null,
      qa_index: chunk?.qa_index ?? old?.qa_index ?? null,
      category: chunk?.category ?? old?.category ?? null,
      alignment_status: old && chunk ? "aligned" : (old ? "old_only" : "chunk_only"),
      old_session_score: old ? legacyMetricView(old) : null,
      chunk_score: chunk ? {
        scoreable: chunk.scoreable === true ? true : (chunk.scoreable === false ? false : null),
        unknown: chunk.unknown === true,
        frozen_material_scoreable: chunk.frozen_material_scoreable ?? null,
        frozen_unknown_evidence_ids: chunk.frozen_unknown_evidence_ids ?? [],
        selection_unknown_evidence_ids: chunk.selection_unknown_evidence_ids ?? [],
        selection_unknown_chunk_ids: chunk.selection_unknown_chunk_ids ?? [],
        metrics: chunk.metrics ?? unknownMetrics(),
        budget: chunk.budget ?? null,
      } : null,
    };
  });
  const oldScoreable = oldRows.filter(row => legacyMetricView(row).scoreable === true).length;
  const oldUnknown = oldRows.filter(row => legacyMetricView(row).scoreable === false).length;
  const oldUnclassified = oldRows.length - oldScoreable - oldUnknown;
  const chunkScoreable = chunkRows.filter(row => row.scoreable === true).length;
  const chunkUnknown = chunkRows.filter(row => row.scoreable === false).length;
  const chunkUnclassified = chunkRows.length - chunkScoreable - chunkUnknown;
  return {
    schema: "q3_locomo_old_new_chunk_alignment_v1",
    rows,
    summary: {
      old_case_count: oldRows.length,
      old_scoreable_case_count: oldScoreable,
      old_unknown_case_count: oldUnknown,
      old_unclassified_case_count: oldUnclassified,
      chunk_case_count: chunkRows.length,
      chunk_scoreable_case_count: chunkScoreable,
      chunk_unknown_case_count: chunkUnknown,
      chunk_unclassified_case_count: chunkUnclassified,
      aligned_case_count: rows.filter(row => row.alignment_status === "aligned").length,
      old_only_case_count: rows.filter(row => row.alignment_status === "old_only").length,
      chunk_only_case_count: rows.filter(row => row.alignment_status === "chunk_only").length,
    },
  };
}

/** Score an evidence-case collection and return the aligned old/new table. */
export function scoreLocomoChunkCases({
  material,
  evidenceCases,
  selectedChunkIdsByCase,
  oldRows = [],
}) {
  if (!Array.isArray(evidenceCases)) throw new Error("evidence_cases_must_be_array");
  const index = indexMaterial(material);
  const cases = evidenceCases.map(item => {
    const identity = requireCaseIdentity({ sampleId: item.sampleId, qaIndex: item.qaIndex });
    const evidenceIds = Array.isArray(item.evidence)
      ? item.evidence.map(entry => entry.evidenceId)
      : item.evidence_ids;
    const frozenRows = Array.isArray(evidenceIds)
      ? frozenEvidenceRows({ index, identity, evidenceIds: evidenceIdsFromInput(evidenceIds) })
      : [];
    const frozenUnknownEvidenceIds = frozenRows
      .filter(row => row.status === "unknown")
      .map(row => row.evidenceId);
    const isFrozenMaterialScoreable = Array.isArray(evidenceIds)
      && frozenMaterialScoreable(evidenceIdsFromInput(evidenceIds), frozenUnknownEvidenceIds);
    const selection = resolveSelection(selectedChunkIdsByCase, identity);
    if (selection === undefined) {
      return scoreUnknownCase(identity, "selected_chunk_ids_missing", {
        category: item.category ?? null,
        evidence_ids: Array.isArray(evidenceIds) ? evidenceIds : [],
        ranked_selected_chunk_ids: null,
        selected_top3_chunk_ids: null,
        frozen_unknown_evidence_ids: frozenUnknownEvidenceIds,
        frozen_material_scoreable: isFrozenMaterialScoreable,
      });
    }
    return scoreLocomoChunkCase({
      material,
      sampleId: identity.sampleId,
      qaIndex: identity.qaIndex,
      evidenceIds,
      selectedChunkIds: selection,
      category: item.category ?? null,
    });
  });
  const alignment = alignLocomoChunkScoreRows({ oldRows, chunkRows: cases });
  const frozenMaterialScoreableCaseCount = cases.filter(row => row.frozen_material_scoreable === true).length;
  const frozenMaterialUnknownCaseCount = cases.filter(row => row.frozen_material_scoreable === false).length;
  const frozenMaterialUnclassifiedCaseCount = cases.length
    - frozenMaterialScoreableCaseCount
    - frozenMaterialUnknownCaseCount;
  const finalScoreableCaseCount = cases.filter(row => row.scoreable === true).length;
  const finalUnknownCaseCount = cases.filter(row => row.scoreable === false).length;
  const finalUnclassifiedCaseCount = cases.length - finalScoreableCaseCount - finalUnknownCaseCount;
  return {
    schema: LOCOMO_CHUNK_EVIDENCE_SCORE_SCHEMA,
    budget: {
      k: LOCOMO_CHUNK_EVIDENCE_BUDGET,
      unit: "complete_chunk_id",
      feasibility: "unknown",
      feasibility_reason: BUDGET_FEASIBILITY_UNKNOWN_REASON,
      observed_status: "per_case",
    },
    cases,
    aligned_case_rows: alignment.rows,
    alignment_summary: alignment.summary,
    population: {
      case_count: cases.length,
      frozen_material_scoreable_case_count: frozenMaterialScoreableCaseCount,
      frozen_material_unknown_case_count: frozenMaterialUnknownCaseCount,
      frozen_material_unclassified_case_count: frozenMaterialUnclassifiedCaseCount,
      final_scoreable_case_count: finalScoreableCaseCount,
      final_unknown_case_count: finalUnknownCaseCount,
      final_unclassified_case_count: finalUnclassifiedCaseCount,
      frozen_unknown_does_not_depend_on_selected_order: true,
    },
  };
}
