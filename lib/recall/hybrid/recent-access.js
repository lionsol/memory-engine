const ARCHIVED_PAYLOAD_LARGE_THRESHOLD_BYTES = 262144;

export const RECENT_ARCHIVED_IDS_SQL = `
  SELECT chunk_id
  FROM memory_confidence
  WHERE COALESCE(is_archived, 0) != 0
`;

export const RECENT_METADATA_BY_IDS_SQL = `
  WITH selected AS (
    SELECT CAST(value AS TEXT) AS chunk_id
    FROM json_each(?)
  )
  SELECT
    mc.chunk_id,
    mc.confidence,
    mc.last_confidence_update,
    mc.base_tau,
    mc.hit_count,
    mc.is_protected,
    mc.conflict_flag,
    mc.category,
    mc.is_archived
  FROM memory_confidence mc
  JOIN selected s
    ON mc.chunk_id = s.chunk_id
`;

function summarizeIds(rows, key) {
  if (!Array.isArray(rows)) return null;
  const summary = {
    total_count: rows.length,
    text_count: 0,
    non_text_count: 0,
    storage_classes: {
      text: 0,
      blob: 0,
      integer: 0,
      real: 0,
      null: 0,
      other: 0,
    },
  };

  for (const row of rows) {
    const classification = classifyRecentSqliteId(row?.[key]);
    if (classification.text) {
      summary.text_count += 1;
      summary.storage_classes.text += 1;
      continue;
    }

    summary.non_text_count += 1;
    if (classification.storage_class === "blob") summary.storage_classes.blob += 1;
    else if (classification.storage_class === "integer") summary.storage_classes.integer += 1;
    else if (classification.storage_class === "real") summary.storage_classes.real += 1;
    else if (classification.storage_class === "null") summary.storage_classes.null += 1;
    else summary.storage_classes.other += 1;
  }

  return summary;
}

export function classifyRecentSqliteId(value) {
  if (value === null) return { storage_class: "null", text: false };
  if (Buffer.isBuffer(value)) return { storage_class: "blob", text: false };
  if (typeof value === "string") return { storage_class: "text", text: true };
  return { storage_class: typeof value, text: false };
}

export function evaluateRecentTextIdInvariant({ engineRows, coreRows } = {}) {
  const engine = summarizeIds(engineRows, "chunk_id");
  const core = summarizeIds(coreRows, "id");

  if (!engine || !core) {
    return {
      passed: false,
      engine: engine || {
        total_count: 0,
        text_count: 0,
        non_text_count: 0,
        storage_classes: { text: 0, blob: 0, integer: 0, real: 0, null: 0, other: 0 },
      },
      core: core || {
        total_count: 0,
        text_count: 0,
        non_text_count: 0,
        storage_classes: { text: 0, blob: 0, integer: 0, real: 0, null: 0, other: 0 },
      },
      reason: "invalid_id_snapshot",
    };
  }

  const engineFailed = engine.non_text_count > 0;
  const coreFailed = core.non_text_count > 0;
  let reason = "text_id_invariant_passed";
  if (engineFailed && coreFailed) reason = "engine_and_core_non_text_id";
  else if (engineFailed) reason = "engine_non_text_id";
  else if (coreFailed) reason = "core_non_text_id";

  return {
    passed: !engineFailed && !coreFailed,
    engine,
    core,
    reason,
  };
}

export function inspectRecentIsolationTopology({ withCoreDb, withEngineDb } = {}) {
  if (typeof withCoreDb !== "function" || typeof withEngineDb !== "function") {
    return {
      valid: false,
      reason: "isolated_recent_provider_unavailable",
      core: null,
      engine: null,
    };
  }

  const read = (accessor) => {
    try {
      return accessor(db => ({
        readonly: db.readonly === true,
        database_names: db.prepare("PRAGMA database_list").all().map(row => String(row.name)),
      }));
    } catch {
      return null;
    }
  };

  const core = read(withCoreDb);
  const engine = read(withEngineDb);
  const valid =
    core !== null
    && engine !== null
    && core.readonly === true
    && engine.readonly === true
    && core.database_names.length === 1
    && core.database_names[0] === "main"
    && engine.database_names.length === 1
    && engine.database_names[0] === "main";

  return {
    valid,
    reason: valid
      ? null
      : (core === null || engine === null
          ? "isolated_recent_provider_unavailable"
          : "isolated_recent_invalid_topology"),
    core,
    engine,
  };
}

export function resolveRecentAccessDecision({
  isolatedRecentCapability,
  invariant,
  topology,
} = {}) {
  const requested = isolatedRecentCapability === true;
  if (!requested) {
    return {
      requested: false,
      mode: "legacy",
      fallback_reason: "capability_disabled",
    };
  }
  if (!invariant || invariant.reason === "invalid_id_snapshot") {
    return {
      requested: true,
      mode: "guarded_fallback",
      fallback_reason: "isolated_recent_snapshot_unavailable",
    };
  }
  if (!invariant.passed) {
    if (invariant.reason === "core_non_text_id") {
      return {
        requested: true,
        mode: "guarded_fallback",
        fallback_reason: "isolated_recent_core_id_invariant_failed",
      };
    }
    if (invariant.reason === "engine_non_text_id") {
      return {
        requested: true,
        mode: "guarded_fallback",
        fallback_reason: "isolated_recent_engine_id_invariant_failed",
      };
    }
    if (invariant.reason === "engine_and_core_non_text_id") {
      return {
        requested: true,
        mode: "guarded_fallback",
        fallback_reason: "isolated_recent_engine_and_core_id_invariant_failed",
      };
    }
    return {
      requested: true,
      mode: "guarded_fallback",
      fallback_reason: "isolated_recent_snapshot_unavailable",
    };
  }
  if (!topology?.valid) {
    return {
      requested: true,
      mode: "guarded_fallback",
      fallback_reason: topology?.reason || "isolated_recent_invalid_topology",
    };
  }
  return {
    requested: true,
    mode: "isolated",
    fallback_reason: null,
  };
}

function recentCoreSql(where) {
  return `
    SELECT
      c.id,
      c.text,
      c.path,
      c.updated_at
    FROM chunks c
    WHERE ${where}
    ORDER BY c.updated_at DESC, c.id ASC
    LIMIT ?
  `;
}

export function buildIsolatedRecentLikeSql(patternCount) {
  const likeWhere = Array.from({ length: patternCount }, () => "(c.path LIKE ? OR c.text LIKE ?)").join(" OR ");
  return recentCoreSql(`
      c.path NOT LIKE 'memory/generated-smart-add/%'
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(?) AS archived
        WHERE c.id = CAST(archived.value AS TEXT)
      )
      AND (${likeWhere})
  `);
}

export const ISOLATED_RECENT_DOMAIN_SQL = recentCoreSql(`
    c.path NOT LIKE 'memory/generated-smart-add/%'
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(?) AS archived
      WHERE c.id = CAST(archived.value AS TEXT)
    )
    AND (c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')
`);

export function summarizeArchivedIds(archivedIds = []) {
  const uniqueIds = [...new Set(archivedIds)];
  const idBytes = uniqueIds.map(id => Buffer.byteLength(id, "utf8"));
  const json = JSON.stringify(uniqueIds);
  return {
    row_count: archivedIds.length,
    unique_id_count: uniqueIds.length,
    duplicate_id_count: archivedIds.length - uniqueIds.length,
    json_utf8_bytes: Buffer.byteLength(json, "utf8"),
    max_id_utf8_bytes: idBytes.length > 0 ? Math.max(...idBytes) : 0,
    payload_large: Buffer.byteLength(json, "utf8") > ARCHIVED_PAYLOAD_LARGE_THRESHOLD_BYTES,
    archived_json: json,
  };
}

function guardTextRows(rows, key, fallbackReason, storageClassKey = null) {
  for (const row of rows) {
    if (storageClassKey && row?.[storageClassKey] && row[storageClassKey] !== "text") {
      return { ok: false, fallback_reason: fallbackReason };
    }
    if (typeof row?.[key] !== "string") {
      return { ok: false, fallback_reason: fallbackReason };
    }
  }
  return { ok: true };
}

export function loadArchivedIds(withEngineDb) {
  const rows = withEngineDb(db => db.prepare(RECENT_ARCHIVED_IDS_SQL).all());
  const guard = guardTextRows(rows, "chunk_id", "isolated_recent_archived_id_invariant_failed");
  if (!guard.ok) return { ...guard, rows, archived_ids: [] };
  const archivedIds = rows.map(row => row.chunk_id);
  return {
    ok: true,
    rows,
    archived_ids: archivedIds,
    ...summarizeArchivedIds(archivedIds),
  };
}

export function selectIsolatedRecentLikeRows({ withCoreDb }, archivedJson, likePatterns, likeTopK) {
  const sql = buildIsolatedRecentLikeSql(likePatterns.length);
  const params = [archivedJson, ...likePatterns.flatMap(pattern => [pattern, pattern]), likeTopK];
  const rows = withCoreDb(db => db.prepare(sql).all(...params));
  return { sql, rows };
}

export function selectIsolatedRecentDomainRows({ withCoreDb }, archivedJson, topK) {
  const rows = withCoreDb(db => db.prepare(ISOLATED_RECENT_DOMAIN_SQL).all(archivedJson, topK));
  return { sql: ISOLATED_RECENT_DOMAIN_SQL, rows };
}

export function selectRecentMetadataRows({ withEngineDb }, selectedIds) {
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) return [];
  return withEngineDb(db => db.prepare(RECENT_METADATA_BY_IDS_SQL).all(JSON.stringify(selectedIds)));
}

export function guardRecentMetadataRows(rows) {
  const textGuard = guardTextRows(rows, "chunk_id", "isolated_recent_metadata_id_invariant_failed");
  if (!textGuard.ok) return textGuard;
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.chunk_id)) {
      return {
        ok: false,
        fallback_reason: "isolated_recent_metadata_duplicate_id",
      };
    }
    seen.add(row.chunk_id);
  }
  return { ok: true };
}

export function mergeRecentMetadataRow(coreRow, metadata) {
  return {
    ...coreRow,
    confidence: metadata?.confidence ?? null,
    last_confidence_update: metadata?.last_confidence_update ?? null,
    base_tau: metadata?.base_tau ?? 7.0,
    hit_count: metadata?.hit_count ?? 0,
    is_protected: metadata?.is_protected ?? 0,
    conflict_flag: metadata?.conflict_flag ?? 0,
    category: metadata?.category ?? null,
    is_archived: metadata?.is_archived ?? 0,
  };
}

export function mergeRecentMetadataRows(coreRows = [], metadataRows = []) {
  const metadataById = new Map(metadataRows.map(row => [row.chunk_id, row]));
  return coreRows.map(row => mergeRecentMetadataRow(row, metadataById.get(row.id)));
}
