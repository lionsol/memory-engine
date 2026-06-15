import { inferCategoryFromChunk as inferSharedCategoryFromChunk } from "./category-inference.js";
import { getMemoryEngineConfig } from "./config/runtime.js";

export const CATEGORY_MAP = {
  temporary: { conf: 0.40, tau: 2.0 },
  raw_log: { conf: 0.50, tau: 7.0 },
  episodic: { conf: 0.70, tau: 30.0 },
  preference: { conf: 0.70, tau: 30.0 },
  kg_node: { conf: 0.85, tau: 90.0 },
  user_identity: { conf: 0.95, tau: 365.0 },
};

export function calcTau(hits, baseTau) {
  if (baseTau >= 365.0) return baseTau;
  return baseTau + (365.0 - baseTau) * (1 - Math.exp(-0.3 * hits));
}

export function catParams(category, isProtected) {
  if (isProtected || category === "user_identity") return { conf: 0.95, tau: 365.0 };
  return CATEGORY_MAP[category] || CATEGORY_MAP.raw_log;
}

export function autoRouteCategory(text, metadata = {}) {
  if (metadata.category && metadata.category !== "raw_log") {
    return metadata.category;
  }
  if (/api[_-]?key|voice[_-]?id|model\s*[:=]|\/[a-z0-9_\/\.-]+\.[a-z]{2,5}|[a-f0-9]{32,}/i.test(text)) {
    return "preference";
  }
  if (/我是|我叫|我的名字|我的职业|我在.*工作|我住在/.test(text)) {
    return "user_identity";
  }
  if (/暂时|临时|一次性|仅这次|就现在|当前会话|测试一下|试试看/.test(text)) {
    return "temporary";
  }
  if (/我喜欢|我习惯|我偏好|我常用|我一般|我倾向于|记住|别忘了|以后都|下次|我的设置/.test(text)) {
    return "preference";
  }
  if (/决定|结论|总结|教训|经验|最终选择|定下来|确定了/.test(text)) {
    return "preference";
  }
  return "raw_log";
}

export function calcRealtimeConf(row, now) {
  if (row.is_protected) return row.confidence;
  if (!row.last_confidence_update) return row.confidence;
  const deltaDays = (now - row.last_confidence_update) / 86400;
  const tau = calcTau(row.hit_count, row.base_tau);
  let c = row.confidence * Math.exp(-deltaDays / tau);
  if (row.conflict_flag) c -= 0.5;
  return Math.max(0, c);
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

export function batchReinforce(db, ids, nowSec) {
  const stmt = db.prepare([
    "UPDATE memory_confidence SET",
    "hit_count = hit_count + 1,",
    "confidence = MIN(1.0, confidence + 0.1),",
    "conflict_flag = 0,",
    "last_confidence_update = ?",
    "WHERE chunk_id = ?",
    "AND is_archived = 0",
  ].join(" "));
  const txn = db.transaction(() => {
    let count = 0;
    for (const id of ids) {
      const result = stmt.run(nowSec, id);
      const changes = Number(result?.changes ?? stmt.changes ?? 0);
      if (changes > 0) count++;
    }
    return count;
  });
  return txn();
}

export function resolvePrefixes(db, prefixes) {
  const results = [];
  for (const pf of prefixes) {
    const rows = db.prepare([
      "SELECT chunk_id FROM memory_confidence",
      "WHERE chunk_id LIKE ? || '%'",
      "AND is_archived = 0",
      "ORDER BY last_confidence_update DESC, hit_count DESC, chunk_id ASC",
      "LIMIT 1",
    ].join(" ")).all(pf);
    if (rows.length > 0) results.push(rows[0].chunk_id);
  }
  return results;
}

export function inferCategoryFromChunk(path = "", text = "", fallback = "raw_log") {
  return inferSharedCategoryFromChunk(path, text, {
    fallback,
    allowCategory: fromText => Boolean(CATEGORY_MAP[fromText]),
  });
}
