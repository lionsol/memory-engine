const CORE_STORE_CACHE = new WeakMap();

const DIALECTS = Object.freeze({
  legacy_chunks: Object.freeze({
    dialect: "legacy_chunks",
    chunksTable: "chunks",
    ftsTable: "chunks_fts",
    sourcesTable: "files",
    embeddingCacheTable: "embedding_cache",
  }),
  openclaw_memory_index: Object.freeze({
    dialect: "openclaw_memory_index",
    chunksTable: "memory_index_chunks",
    ftsTable: "memory_index_chunks_fts",
    sourcesTable: "memory_index_sources",
    embeddingCacheTable: "memory_embedding_cache",
  }),
});

function assertSchemaName(schema) {
  if (schema !== "main" && schema !== "core") {
    throw new TypeError("Core store schema must be main or core");
  }
  return schema;
}

function tableExists(db, schema, table) {
  const statement = db.prepare(`
    SELECT 1
    FROM ${schema}.sqlite_master
    WHERE type IN ('table', 'view')
      AND name = ?
    LIMIT 1
  `);
  if (!statement || typeof statement.get !== "function") return null;
  return Boolean(statement.get(table));
}

function cacheFor(db) {
  let cache = CORE_STORE_CACHE.get(db);
  if (!cache) {
    cache = new Map();
    CORE_STORE_CACHE.set(db, cache);
  }
  return cache;
}

function detectCoreStoreDialect(db, { schema = "main" } = {}) {
  const resolvedSchema = assertSchemaName(schema);
  const cache = cacheFor(db);
  const cached = cache.get(resolvedSchema);
  if (cached) return cached;

  const currentExists = tableExists(db, resolvedSchema, DIALECTS.openclaw_memory_index.chunksTable);
  const legacyExists = tableExists(db, resolvedSchema, DIALECTS.legacy_chunks.chunksTable);
  let base;
  let opaqueHandle = false;
  if (currentExists === true) {
    base = DIALECTS.openclaw_memory_index;
  } else if (legacyExists === true) {
    base = DIALECTS.legacy_chunks;
  } else if (currentExists === null || legacyExists === null) {
    base = DIALECTS.legacy_chunks;
    opaqueHandle = true;
  } else {
    throw new Error(`Unsupported OpenClaw Core store schema in ${resolvedSchema}`);
  }

  const descriptor = Object.freeze({
    ...base,
    schema: resolvedSchema,
    opaqueHandle,
    chunksFrom: base.dialect === "openclaw_memory_index"
      ? "chunks"
      : (resolvedSchema === "main" ? base.chunksTable : `${resolvedSchema}.${base.chunksTable}`),
    physicalChunksFrom: resolvedSchema === "main"
      ? base.chunksTable
      : `${resolvedSchema}.${base.chunksTable}`,
    physicalFtsFrom: resolvedSchema === "main"
      ? base.ftsTable
      : `${resolvedSchema}.${base.ftsTable}`,
    ftsMatchName: base.ftsTable,
  });
  cache.set(resolvedSchema, descriptor);
  return descriptor;
}

function ensureCoreStoreCompatibility(db, { schema = "main" } = {}) {
  const descriptor = detectCoreStoreDialect(db, { schema });
  if (descriptor.dialect !== "openclaw_memory_index") return descriptor;

  db.exec(`
    CREATE TEMP VIEW IF NOT EXISTS chunks AS
    SELECT
      id,
      path,
      source,
      start_line,
      end_line,
      hash,
      model,
      text,
      updated_at
    FROM ${descriptor.physicalChunksFrom}
  `);
  return descriptor;
}

function getCoreFtsReference(db, { schema = "main" } = {}) {
  const descriptor = ensureCoreStoreCompatibility(db, { schema });
  const ftsExists = tableExists(db, descriptor.schema, descriptor.ftsTable);
  if (ftsExists === false) {
    throw new Error(`OpenClaw Core FTS table not found: ${descriptor.physicalFtsFrom}`);
  }
  return Object.freeze({
    dialect: descriptor.dialect,
    from: descriptor.physicalFtsFrom,
    matchName: descriptor.ftsMatchName,
    bm25Name: descriptor.ftsMatchName,
  });
}

function getCoreStoreDescriptor(db, options = {}) {
  return ensureCoreStoreCompatibility(db, options);
}

module.exports = {
  detectCoreStoreDialect,
  ensureCoreStoreCompatibility,
  getCoreFtsReference,
  getCoreStoreDescriptor,
};
