import { inferCategoryFromChunk as inferSharedCategoryFromChunk } from "./category-inference.js";
import { getMemoryEngineConfig } from "./config/runtime.js";
import { buildLiteralPrefixGlob } from "./id-prefix-resolution.js";

export const CATEGORY_MAP = {
  temporary: { conf: 0.40, tau: 2.0 },
  raw_log: { conf: 0.50, tau: 7.0 },
  episodic: { conf: 0.70, tau: 30.0 },
  preference: { conf: 0.70, tau: 30.0 },
  kg_node: { conf: 0.85, tau: 90.0 },
  user_identity: { conf: 0.95, tau: 365.0 },
};

export const AMBIGUOUS_MEMORY_ID = "AMBIGUOUS_MEMORY_ID";
export const INVALID_MEMORY_ID = "INVALID_MEMORY_ID";

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function calcTau(hits, baseTau) {
  if (baseTau >= 365.0) return baseTau;
  return baseTau + (365.0 - baseTau) * (1 - Math.exp(-0.3 * hits));
}

export function catParams(category, isProtected) {
  if (isProtected || category === "user_identity") return { conf: 0.95, tau: 365.0 };
  return CATEGORY_MAP[category] || CATEGORY_MAP.raw_log;
}

function hasStrongPreferenceLanguage(text) {
  return /我(?:喜欢|习惯|偏好|常用|一般|倾向于)|以后都|下次/u.test(text);
}

function hasExistingPreferenceLanguage(text) {
  return /记住|别忘了|我的设置/u.test(text);
}

function looksLikeSensitiveArtifact(text) {
  const secretLabel = /\b(?:api[\s_-]?key|access[\s_-]?token|auth[\s_-]?token|secret[\s_-]?key|password|passwd)\b/iu;
  const bearerToken = /\bbearer(?:\s+token)?\s+[A-Za-z0-9._~+/=-]{4,}/iu;
  const opaqueIdentifier = /\bvoice[\s_-]?id\b/iu;
  const hashLike = /(?<![A-Za-z0-9])[a-f0-9]{32,}(?![A-Za-z0-9])/iu;
  const filesystemPath = /(?:^|[\s"'“”‘’([{=：])(?:\/|\.{1,2}[\\/]|[A-Za-z]:[\\/])[^\s"'，。！？；：:)}\]]+/u;
  const technicalAssignment = /\bmodel\s*[:=：]\s*\S+/iu;

  return secretLabel.test(text)
    || bearerToken.test(text)
    || opaqueIdentifier.test(text)
    || hashLike.test(text)
    || filesystemPath.test(text)
    || technicalAssignment.test(text);
}

export function autoRouteCategory(text, metadata = {}) {
  const normalizedText = typeof text === "string" ? text : String(text ?? "");
  if (typeof metadata?.category === "string" && metadata.category.trim()) {
    return metadata.category;
  }
  if (/我是|我叫|我的名字|我的职业|我在.*工作|我住在/u.test(normalizedText)) {
    return "user_identity";
  }
  if (/暂时|临时|一次性|仅这次|就现在|当前会话|测试一下|试试看/u.test(normalizedText)) {
    return "temporary";
  }
  if (hasStrongPreferenceLanguage(normalizedText)) {
    return "preference";
  }
  if (looksLikeSensitiveArtifact(normalizedText)) {
    return "raw_log";
  }
  if (hasExistingPreferenceLanguage(normalizedText)) {
    return "preference";
  }
  if (/决定|结论|总结|教训|经验|最终选择|定下来|确定了/u.test(normalizedText)) {
    return "preference";
  }
  return "raw_log";
}

export function calcRealtimeConf(row, now) {
  if (row?.is_protected) return row.confidence;
  let c = calcDecayedBaseConfidence(row, now);
  if (row.conflict_flag) c -= 0.5;
  return Math.max(0, c);
}

export function calcDecayedBaseConfidence(row, now) {
  if (row?.is_protected) return row.confidence;
  if (!row?.last_confidence_update) {
    return row?.confidence;
  }
  const deltaDays = (now - row.last_confidence_update) / 86400;
  const tau = calcTau(row.hit_count, row.base_tau);
  return Math.max(0, row.confidence * Math.exp(-deltaDays / tau));
}

export function buildRecallCompletedMetadata({
  skipped = false,
  skip_reason = null,
  candidate_count = 0,
  candidate_count_before_gate = 0,
  candidate_count_after_gate = 0,
  strict_count = 0,
  fallback_count = 0,
  post_rerank_count = 0,
  injected_count = 0,
} = {}) {
  return {
    skipped: Boolean(skipped),
    skip_reason: skip_reason || null,
    candidate_count: Number(candidate_count) || 0,
    candidate_count_before_gate: Number(candidate_count_before_gate) || 0,
    candidate_count_after_gate: Number(candidate_count_after_gate) || 0,
    strict_count: Number(strict_count) || 0,
    fallback_count: Number(fallback_count) || 0,
    post_rerank_count: Number(post_rerank_count) || 0,
    injected_count: Number(injected_count) || 0,
  };
}

export function gateThresholdForCategory(category, minCoverage = null, cfg = null) {
  const normalized = String(category || "raw_log").toLowerCase();
  const engineConfig = getMemoryEngineConfig(cfg);
  const gateThresholds = engineConfig?.confidence?.gateThresholdByCategory || {};
  const rawThreshold = gateThresholds?.[normalized]?.final_score_min;
  const finalScoreMin = Number.isFinite(Number(rawThreshold))
    ? Number(rawThreshold)
    : null;
  return {
    final_score_min: finalScoreMin,
    min_coverage: Number.isFinite(minCoverage) ? Number(minCoverage) : null,
  };
}

export function batchReinforce(db, ids, nowSec, options = {}) {
  const read = db.prepare([
    "SELECT chunk_id, confidence, last_confidence_update, base_tau, hit_count,",
    "is_archived, is_protected, conflict_flag",
    "FROM memory_confidence",
    "WHERE chunk_id = ?",
    "AND is_archived = 0",
  ].join(" "));
  const write = db.prepare([
    "UPDATE memory_confidence SET",
    "hit_count = hit_count + 1,",
    "confidence = ?,",
    "last_confidence_update = ?",
    "WHERE chunk_id = ?",
    "AND is_archived = 0",
  ].join(" "));
  const txn = db.transaction(() => {
    let count = 0;
    const seen = new Set();
    for (const id of Array.isArray(ids) ? ids : []) {
      if (typeof id !== "string" || !id || seen.has(id)) continue;
      seen.add(id);
      const row = read.get(id);
      if (!row) continue;
      const decayedBase = calcDecayedBaseConfidence(row, nowSec);
      if (!Number.isFinite(Number(decayedBase))) throw codedError("INVALID_CONFIDENCE_STATE");
      const nextConfidence = Math.min(1.0, Math.max(0, Number(decayedBase) + 0.1));
      const result = write.run(nextConfidence, nowSec, id);
      const changes = Number(result?.changes ?? write.changes ?? 0);
      if (changes > 0) {
        count++;
        if (typeof options?.onReinforced === "function") options.onReinforced(id);
      }
    }
    return count;
  });
  return txn();
}

export function resolvePrefixes(db, prefixes) {
  const exact = db.prepare([
    "SELECT chunk_id FROM memory_confidence",
    "WHERE chunk_id = ?",
    "AND is_archived = 0",
    "LIMIT 1",
  ].join(" "));
  const prefix = db.prepare([
    "SELECT chunk_id FROM memory_confidence",
    "WHERE is_archived = 0",
    "AND chunk_id GLOB ?",
    "ORDER BY chunk_id ASC",
    "LIMIT 2",
  ].join(" "));
  const results = [];
  const seen = new Set();
  for (const rawPrefix of Array.isArray(prefixes) ? prefixes : []) {
    if (typeof rawPrefix !== "string" || !rawPrefix.trim()) throw codedError(INVALID_MEMORY_ID);
    const pf = rawPrefix.trim();
    const exactRow = exact.get(pf);
    const rows = exactRow ? [exactRow] : prefix.all(buildLiteralPrefixGlob(pf));
    if (rows.length > 1) throw codedError(AMBIGUOUS_MEMORY_ID);
    const resolved = rows[0]?.chunk_id;
    if (typeof resolved === "string" && !seen.has(resolved)) {
      seen.add(resolved);
      results.push(resolved);
    }
  }
  return results;
}

export function inferCategoryFromChunk(path = "", text = "", fallback = "raw_log") {
  return inferSharedCategoryFromChunk(path, text, {
    fallback,
    allowCategory: fromText => Boolean(CATEGORY_MAP[fromText]),
  });
}
