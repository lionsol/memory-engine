import { safeJson, tableExists, withCoreDb, withDb } from "./db.js";
import { inferCategoryFromPath } from "../../lib/category-inference.js";

function normalizeMemory(row) {
  const confidence = row.confidence ?? null;
  const confidenceMode = confidence === null || confidence === undefined ? "external" : "managed";
  const inferredCategory = inferCategoryFromPath(row.path ?? row.file_path ?? "");
  const category = row.category ?? (confidenceMode === "external" ? inferredCategory : "unknown");
  return {
    id: row.id ?? row.chunk_id,
    short_id: String(row.id ?? row.chunk_id ?? "").slice(0, 16),
    text: row.text ?? "",
    path: row.path ?? row.file_path ?? "",
    category,
    confidence,
    confidence_mode: confidenceMode,
    source_type: confidenceMode === "external" ? "openclaw-core" : "memory-engine-managed",
    external_badge: confidenceMode === "external",
    initial_confidence: row.initial_confidence ?? null,
    hit_count: row.hit_count ?? 0,
    is_archived: Number(row.is_archived ?? 0),
    is_protected: Number(row.is_protected ?? 0),
    conflict_flag: Number(row.conflict_flag ?? 0),
    decay_eligible: confidenceMode === "external" ? false : Number(row.is_protected ?? 0) === 0 && Number(row.is_archived ?? 0) === 0,
    archive_eligible: confidenceMode === "external" ? false : Number(row.is_protected ?? 0) === 0 && Number(row.is_archived ?? 0) === 0,
    base_tau: row.base_tau ?? null,
    last_confidence_update: row.last_confidence_update ?? null,
    kg_data: safeJson(row.kg_data, null),
  };
}

function chunked(values, size = 400) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function loadEngineMetadata(ids) {
  if (ids.length === 0) return new Map();
  return withDb(db => {
    if (!tableExists(db, "memory_confidence")) return new Map();
    const map = new Map();
    for (const batch of chunked(ids)) {
      const placeholders = batch.map(() => "?").join(", ");
      const rows = db.prepare(`
        SELECT chunk_id, initial_confidence, confidence, last_confidence_update, base_tau,
               hit_count, is_archived, is_protected, conflict_flag, category, kg_data
        FROM memory_confidence
        WHERE chunk_id IN (${placeholders})
      `).all(...batch);
      for (const row of rows) map.set(String(row.chunk_id), row);
    }
    return map;
  }, { readonly: true });
}

function mergeCoreAndEngine(coreRows, metadata) {
  return coreRows.map(row => ({
    ...row,
    ...(metadata.get(String(row.id)) || {}),
  }));
}

function compareMemoryRows(left, right) {
  const protectedDiff = Number(right.is_protected ?? 0) - Number(left.is_protected ?? 0);
  if (protectedDiff !== 0) return protectedDiff;
  const confidenceDiff = Number(right.confidence ?? 0) - Number(left.confidence ?? 0);
  if (confidenceDiff !== 0) return confidenceDiff;
  return String(right.id || "").localeCompare(String(left.id || ""));
}

export function listMemories({ q = "", category = "", archived = "active", limit = 100 } = {}) {
  const normalizedLimit = Math.min(Number(limit) || 100, 500);
  let coreRows;
  let orderedWarning = null;
  try {
    coreRows = withCoreDb(db => {
      if (!tableExists(db, "chunks")) return [];
      if (q) {
        return db.prepare(`
          SELECT id, path, source, start_line, end_line, hash, model, text, updated_at
          FROM chunks
          WHERE text LIKE @q OR path LIKE @q OR id LIKE @q
        `).all({ q: `%${q}%` });
      }
      return db.prepare(`
        SELECT id, path, source, start_line, end_line, hash, model, text, updated_at
        FROM chunks
      `).all();
    });
  } catch (error) {
    if (!/malformed/i.test(error.message)) throw error;
    orderedWarning = "ordered query skipped because SQLite reported database disk image is malformed";
    coreRows = [];
  }

  const metadata = loadEngineMetadata(coreRows.map(row => row.id));
  const merged = mergeCoreAndEngine(coreRows, metadata)
    .filter(row => {
      const meta = metadata.get(String(row.id));
      if (category && meta?.category !== category) return false;
      if (archived === "active" && Number(meta?.is_archived ?? 0) !== 0) return false;
      if (archived === "archived" && Number(meta?.is_archived ?? 0) !== 1) return false;
      return true;
    })
    .sort(compareMemoryRows)
    .slice(0, normalizedLimit)
    .map(normalizeMemory);

  if (!orderedWarning) return merged;
  return merged.map(row => ({ ...row, warning: orderedWarning }));
}

export function getMemory(idPrefix) {
  const row = withCoreDb(db => {
    if (!tableExists(db, "chunks")) return null;
    return db.prepare(`
      SELECT id, path, source, start_line, end_line, hash, model, text, updated_at
      FROM chunks
      WHERE id LIKE ? || '%'
      LIMIT 1
    `).get(idPrefix) || null;
  });
  if (!row) return null;
  const metadata = loadEngineMetadata([row.id]);
  return normalizeMemory({
    ...row,
    ...(metadata.get(String(row.id)) || {}),
  });
}
