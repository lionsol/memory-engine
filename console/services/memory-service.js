import { safeJson, tableExists, withDb } from "./db.js";
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

export function listMemories({ q = "", category = "", archived = "active", limit = 100 } = {}) {
  return withDb(db => {
    if (!tableExists(db, "chunks")) return [];
    const where = [];
    const params = {};
    if (q) {
      where.push("(c.text LIKE @q OR c.path LIKE @q OR c.id LIKE @q)");
      params.q = `%${q}%`;
    }
    if (category) {
      where.push("mc.category = @category");
      params.category = category;
    }
    if (archived === "active") where.push("COALESCE(mc.is_archived, 0) = 0");
    if (archived === "archived") where.push("COALESCE(mc.is_archived, 0) = 1");
    params.limit = Math.min(Number(limit) || 100, 500);
    const select = `
      SELECT c.id, c.path, c.source, c.start_line, c.end_line, c.hash, c.model, c.text, c.updated_at,
             mc.initial_confidence, mc.confidence, mc.last_confidence_update, mc.base_tau,
             mc.hit_count, mc.is_archived, mc.is_protected, mc.conflict_flag, mc.category, mc.kg_data
      FROM chunks c
      LEFT JOIN memory_confidence mc ON mc.chunk_id = c.id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    `;
    const orderedSql = `${select}
      ORDER BY COALESCE(mc.is_protected, 0) DESC, COALESCE(mc.confidence, 0) DESC, c.id DESC
      LIMIT @limit
    `;
    const fallbackSql = `${select}
      LIMIT @limit
    `;
    try {
      return db.prepare(orderedSql).all(params).map(normalizeMemory);
    } catch (error) {
      if (!/malformed/i.test(error.message)) throw error;
      return db.prepare(fallbackSql).all(params).map(row => ({
        ...normalizeMemory(row),
        warning: "ordered query skipped because SQLite reported database disk image is malformed",
      }));
    }
  }, { readonly: true });
}

export function getMemory(idPrefix) {
  return withDb(db => {
    if (!tableExists(db, "chunks")) return null;
    const row = db.prepare(`
      SELECT c.id, c.path, c.source, c.start_line, c.end_line, c.hash, c.model, c.text, c.updated_at,
             mc.initial_confidence, mc.confidence, mc.last_confidence_update, mc.base_tau,
             mc.hit_count, mc.is_archived, mc.is_protected, mc.conflict_flag, mc.category, mc.kg_data
      FROM chunks c
      LEFT JOIN memory_confidence mc ON mc.chunk_id = c.id
      WHERE c.id LIKE ? || '%'
      LIMIT 1
    `).get(idPrefix);
    return row ? normalizeMemory(row) : null;
  }, { readonly: true });
}
