export const CORE_KG_JSON_JOIN_SQL = `
  SELECT
    c.id,
    c.text,
    c.path,
    c.updated_at
  FROM json_each(?) AS candidate
  JOIN chunks c
    ON c.id = CAST(candidate.value AS TEXT)
  ORDER BY c.updated_at DESC, c.id ASC
  LIMIT ?
`;

function engineKgCandidateSql(likePatterns = []) {
  const where = likePatterns.map(() => "kg_data LIKE ?").join(" OR ");
  return `
    SELECT
      chunk_id,
      typeof(chunk_id) AS chunk_id_storage_class,
      confidence,
      last_confidence_update,
      COALESCE(base_tau, 7.0) AS base_tau,
      COALESCE(hit_count, 0) AS hit_count,
      COALESCE(is_protected, 0) AS is_protected,
      COALESCE(conflict_flag, 0) AS conflict_flag,
      category,
      COALESCE(is_archived, 0) AS is_archived,
      kg_data
    FROM memory_confidence
    WHERE COALESCE(is_archived, 0) = 0
      AND kg_data IS NOT NULL
      AND kg_data != ''
      AND (${where})
  `;
}

export function selectEngineKgCandidateRows({ withEngineDb }, likePatterns) {
  const sql = engineKgCandidateSql(likePatterns);
  return withEngineDb(db => db.prepare(sql).all(...likePatterns));
}

export function guardIsolatedKgCandidates(engineRows = []) {
  const candidateIds = [];
  const metadataById = new Map();
  const seen = new Set();

  for (const row of engineRows) {
    if (row?.chunk_id_storage_class !== "text" || typeof row?.chunk_id !== "string") {
      return {
        safe: false,
        fallback_reason: "non_text_matching_candidate_id",
        engine_rows: [],
        candidate_ids: [],
        metadata_by_id: new Map(),
      };
    }
    if (seen.has(row.chunk_id)) continue;
    seen.add(row.chunk_id);
    candidateIds.push(row.chunk_id);
    metadataById.set(row.chunk_id, row);
  }

  return {
    safe: true,
    fallback_reason: null,
    engine_rows: engineRows,
    candidate_ids: candidateIds,
    metadata_by_id: metadataById,
  };
}

export function selectCoreKgRows({ withCoreDb }, candidateIds, ftsTopK) {
  return withCoreDb(db => db.prepare(CORE_KG_JSON_JOIN_SQL).all(JSON.stringify(candidateIds), ftsTopK));
}

export function mergeKgMetadataRows(coreRows = [], metadataById = new Map()) {
  return coreRows.map((row) => {
    const metadata = metadataById.get(row.id);
    return {
      ...row,
      confidence: metadata.confidence,
      last_confidence_update: metadata.last_confidence_update,
      base_tau: metadata.base_tau,
      hit_count: metadata.hit_count,
      is_protected: metadata.is_protected,
      conflict_flag: metadata.conflict_flag,
      category: metadata.category,
      is_archived: metadata.is_archived,
      kg_data: metadata.kg_data,
    };
  });
}

export function selectIsolatedKgRows(access, likePatterns, ftsTopK) {
  const engineRows = selectEngineKgCandidateRows(access, likePatterns);
  const guarded = guardIsolatedKgCandidates(engineRows);
  if (!guarded.safe) return guarded;
  const coreRows = selectCoreKgRows(access, guarded.candidate_ids, ftsTopK);
  return {
    ...guarded,
    rows: mergeKgMetadataRows(coreRows, guarded.metadata_by_id),
  };
}
