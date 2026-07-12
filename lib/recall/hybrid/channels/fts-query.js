export const ISOLATED_FTS_SQL = `
        SELECT
          c.id,
          c.text,
          c.path,
          c.updated_at
        FROM chunks_fts f
        JOIN chunks c ON c.id = f.id
        WHERE chunks_fts MATCH ?
          AND c.path NOT LIKE 'memory/generated-smart-add/%'
          AND NOT EXISTS (
            SELECT 1
            FROM json_each(?) AS archived
            WHERE CAST(archived.value AS TEXT) = c.id
          )
        ORDER BY bm25(chunks_fts, 0)
        LIMIT ?
      `;

export function isArchivedLikeLegacySql(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "bigint") return value !== 0n;
  return true;
}

export function archivedIdsFromConfidenceMap(confidenceMap = new Map()) {
  const archivedIds = [];
  for (const [chunkId, row] of confidenceMap.entries()) {
    if (typeof chunkId !== "string") continue;
    if (isArchivedLikeLegacySql(row?.is_archived)) archivedIds.push(chunkId);
  }
  return [...new Set(archivedIds)];
}

export function mergeFtsConfidenceRow(coreRow, confidenceMap = new Map()) {
  const confidence = confidenceMap.get(coreRow.id);
  return {
    ...coreRow,
    confidence: confidence?.confidence ?? null,
    last_confidence_update: confidence?.last_confidence_update ?? null,
    base_tau: confidence?.base_tau ?? 7.0,
    hit_count: confidence?.hit_count ?? 0,
    is_protected: confidence?.is_protected ?? 0,
    conflict_flag: confidence?.conflict_flag ?? 0,
    category: confidence?.category ?? null,
    is_archived: confidence?.is_archived ?? 0,
  };
}

export function selectIsolatedFtsRows({ withCoreDb, confidenceMap }, query, archivedJson, ftsTopK) {
  return withCoreDb(db => db.prepare(ISOLATED_FTS_SQL).all(query, archivedJson, ftsTopK))
    .map(row => mergeFtsConfidenceRow(row, confidenceMap));
}
