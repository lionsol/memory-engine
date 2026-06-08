import { ensureMemoryConfidenceTable, recordEvent, safeJson, tableExists, withDb } from "./db.js";
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

function findMemoryInOpenDb(db, idPrefix) {
  if (!tableExists(db, "chunks")) return null;
  const row = db.prepare(`
    SELECT c.*, mc.initial_confidence, mc.confidence, mc.last_confidence_update, mc.base_tau,
           mc.hit_count, mc.is_archived, mc.is_protected, mc.conflict_flag, mc.category, mc.kg_data
    FROM chunks c
    LEFT JOIN memory_confidence mc ON mc.chunk_id = c.id
    WHERE c.id LIKE ? || '%'
    ORDER BY LENGTH(c.id) ASC
    LIMIT 1
  `).get(idPrefix);
  return row ? normalizeMemory(row) : null;
}

export function archiveMemory(idPrefix) {
  return withDb(db => {
    ensureMemoryConfidenceTable(db);
    const memory = findMemoryInOpenDb(db, idPrefix);
    if (!memory) return { ok: false, error: "memory not found" };
    db.prepare(`
      INSERT INTO memory_confidence
        (chunk_id, initial_confidence, confidence, last_confidence_update, base_tau, hit_count, is_archived, is_protected, conflict_flag, category)
      VALUES (?, 0, 0, strftime('%s','now'), 7.0, 0, 1, 0, 0, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET
        is_archived = 1,
        confidence = MIN(COALESCE(memory_confidence.confidence, 0), 0.05),
        last_confidence_update = excluded.last_confidence_update
    `).run(memory.id, memory.category || "raw_log");
    recordEvent(db, { event_type: "memory_archived", memory_id: memory.id, source: "console" });
    return { ok: true, id: memory.id };
  });
}

export function deleteMemory(idPrefix) {
  return withDb(db => {
    ensureMemoryConfidenceTable(db);
    const memory = findMemoryInOpenDb(db, idPrefix);
    if (!memory) return { ok: false, error: "memory not found" };
    // Core chunks are owned by OpenClaw and must remain read-only from this plugin.
    // "Delete" is implemented as a local archival tombstone inside memory_confidence.
    db.prepare(`
      INSERT INTO memory_confidence
        (chunk_id, initial_confidence, confidence, last_confidence_update, base_tau, hit_count, is_archived, is_protected, conflict_flag, category)
      VALUES (?, 0, 0, strftime('%s','now'), 7.0, 0, 1, 0, 0, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET
        is_archived = 1,
        confidence = MIN(COALESCE(memory_confidence.confidence, 0), 0.01),
        last_confidence_update = excluded.last_confidence_update
    `).run(memory.id, memory.category || "raw_log");
    recordEvent(db, { event_type: "memory_deleted", memory_id: memory.id, source: "console" });
    return { ok: true, id: memory.id };
  });
}

export function updateConfidence(idPrefix, value) {
  return withDb(db => {
    ensureMemoryConfidenceTable(db);
    const memory = findMemoryInOpenDb(db, idPrefix);
    if (!memory) return { ok: false, error: "memory not found" };
    const confidence = Math.max(0, Math.min(1, Number(value)));
    if (!Number.isFinite(confidence)) return { ok: false, error: "confidence must be a number from 0 to 1" };
    db.prepare(`
      INSERT INTO memory_confidence (chunk_id, initial_confidence, confidence, last_confidence_update)
      VALUES (?, ?, ?, strftime('%s','now'))
      ON CONFLICT(chunk_id) DO UPDATE SET confidence = excluded.confidence, last_confidence_update = excluded.last_confidence_update
    `).run(memory.id, confidence, confidence);
    recordEvent(db, { event_type: "memory_confidence_updated", memory_id: memory.id, source: "console", final_score: confidence });
    return { ok: true, id: memory.id, confidence };
  });
}
