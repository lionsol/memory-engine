import {
  inferCategoryFromChunk as inferSharedCategoryFromChunk,
  inferCategoryFromPath as inferSharedCategoryFromPath,
} from "../../category-inference.js";
import { getMemoryEngineConfig } from "../../config/runtime.js";

const DEFAULT_EXTERNAL_CATEGORY_KEYS = Object.keys(
  getMemoryEngineConfig(null)?.ranking?.categoryBoost?.external || {}
);

export function round4(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

export function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeUnixSeconds(value) {
  const n = toFiniteNumber(value);
  if (n === null || n <= 0) return 0;
  // Handle millisecond timestamps from LanceDB rows.
  return n > 100000000000 ? Math.floor(n / 1000) : Math.floor(n);
}

export const inferCategoryFromPath = inferSharedCategoryFromPath;

export function isRetrievalExcludedPath(path = "") {
  const normalized = String(path || "").replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
  return normalized.startsWith("memory/generated-smart-add/");
}

export function inferCategoryFromChunk(path = "", text = "", categoryMap = null, fallback = "external") {
  return inferSharedCategoryFromChunk(path, text, {
    fallback,
    allowCategory: fromText => (
      (!categoryMap || categoryMap[fromText]) ||
      DEFAULT_EXTERNAL_CATEGORY_KEYS.includes(fromText)
    ),
  });
}

export function deriveCandidateSources({ path = "", category = "", text = "", confidence_mode = "" }) {
  const tags = [];
  const p = String(path || "");
  const c = String(category || "").toLowerCase();
  const t = String(text || "").toLowerCase();
  if (isRetrievalExcludedPath(p)) tags.push("retrieval_excluded");
  if (p.startsWith("memory/smart-add/")) tags.push("smart-add");
  if (p.startsWith("memory/episodes/") || c === "episodic") tags.push("episodic");
  if (/session\s*checkpoint|session[_ -]?key|session[_ -]?id/.test(t) || /session[-_]?checkpoint/i.test(p)) {
    tags.push("session_checkpoint");
  }
  if (confidence_mode === "external") tags.push("external");
  return tags;
}

export function normalizeExternalMemory(row = {}, {
  nowSec,
  calcRealtimeConf,
  categoryMap = null,
} = {}) {
  const id = String(row.id || row.chunk_id || "").trim();
  if (!id) return null;
  const text = String(row.text || "");
  const path = String(row.path || "");
  if (isRetrievalExcludedPath(path)) return null;
  const similarity = round4(toFiniteNumber(row.similarity) ?? 0);
  const createdAt = normalizeUnixSeconds(row.created_at ?? row.updated_at ?? row.timestamp);
  const rawConfidence = toFiniteNumber(row.confidence);
  const hasManagedConfidence = rawConfidence !== null;
  const mode = hasManagedConfidence ? "managed" : "external";
  const explicitCategory = row.category ? String(row.category).toLowerCase() : "";
  const inferredCategory = inferCategoryFromChunk(
    path,
    text,
    categoryMap,
    mode === "external" ? "external" : "raw_log"
  );
  const category = explicitCategory || inferredCategory;

  if (mode === "external") {
    return {
      id,
      text: text.slice(0, 600),
      path,
      category,
      semantic_score: similarity,
      similarity,
      confidence: null,
      confidence_mode: "external",
      source_type: "openclaw-core",
      hit_count: Number(row.hit_count || 0),
      hits: Number(row.hit_count || 0),
      is_protected: Number(row.is_protected || 0),
      conflict_flag: Number(row.conflict_flag || 0),
      is_archived: Number(row.is_archived || 0),
      decay_eligible: false,
      archive_eligible: false,
      external_badge: true,
      created_at: createdAt,
    };
  }

  let realtimeConf = toFiniteNumber(row.confidence_realtime);
  if (realtimeConf === null && typeof calcRealtimeConf === "function") {
    try {
      realtimeConf = toFiniteNumber(calcRealtimeConf({
        ...row,
        confidence: rawConfidence,
      }, nowSec));
    } catch {
      realtimeConf = rawConfidence;
    }
  }
  if (realtimeConf === null) realtimeConf = rawConfidence;
  realtimeConf = Math.max(0, Math.min(1, Number(realtimeConf)));
  const isProtected = Number(row.is_protected || 0);
  const isArchived = Number(row.is_archived || 0);

  return {
    id,
    text: text.slice(0, 600),
    path,
    category,
    semantic_score: similarity,
    similarity,
    confidence: round4(realtimeConf),
    confidence_mode: "managed",
    source_type: "memory-engine-managed",
    hit_count: Number(row.hit_count || 0),
    hits: Number(row.hit_count || 0),
    is_protected: isProtected,
    conflict_flag: Number(row.conflict_flag || 0),
    is_archived: isArchived,
    decay_eligible: isProtected === 0 && isArchived === 0,
    archive_eligible: isProtected === 0 && isArchived === 0,
    external_badge: false,
    created_at: createdAt,
  };
}

export function isCandidateAllowedForRerank(item, minConfidence) {
  if (!item || !item.id) return false;
  if (isRetrievalExcludedPath(item.path)) return false;
  if (item.confidence_mode === "external") return true;
  const conf = toFiniteNumber(item.confidence);
  if (conf === null) return false;
  return conf >= minConfidence;
}
