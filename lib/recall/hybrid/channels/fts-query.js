import { getCoreFtsReference } from "../../../db/core-store.js";

export function buildIsolatedFtsSql({
  from = "chunks_fts",
  matchName = "chunks_fts",
  bm25Name = matchName,
  stableFallbackOrder = false,
} = {}) {
  const orderBy = stableFallbackOrder
    ? `ORDER BY bm25(${bm25Name}, 0), c.id ASC`
    : `ORDER BY bm25(${bm25Name}, 0)`;
  return `
        SELECT
          c.id,
          c.text,
          c.path,
          c.updated_at
        FROM ${from} f
        JOIN chunks c ON c.id = f.id
        WHERE ${matchName} MATCH ?
          AND c.path NOT LIKE 'memory/generated-smart-add/%'
          AND NOT EXISTS (
            SELECT 1
            FROM json_each(?) AS archived
            WHERE CAST(archived.value AS TEXT) = c.id
          )
        ${orderBy}
        LIMIT ?
      `;
}

export const ISOLATED_FTS_SQL = buildIsolatedFtsSql();
export const ISOLATED_FTS_FALLBACK_SQL = buildIsolatedFtsSql({ stableFallbackOrder: true });

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

export function selectIsolatedFtsRows(
  { withCoreDb, confidenceMap },
  query,
  archivedJson,
  ftsTopK,
  stableFallbackOrder = false,
) {
  return withCoreDb(db => {
    const fts = getCoreFtsReference(db, { schema: "main" });
    return db.prepare(buildIsolatedFtsSql({ ...fts, stableFallbackOrder }))
      .all(query, archivedJson, ftsTopK);
  }).map(row => mergeFtsConfidenceRow(row, confidenceMap));
}
