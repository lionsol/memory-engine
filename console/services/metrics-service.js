import { tableExists, withDb } from "./db.js";
import { getMemoryEngineConfig } from "../../lib/config/runtime.js";

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function safeJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function asKey(value, fallback = "unknown") {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : fallback;
}

function parseSqliteDateTimeUtc(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const parsed = Date.parse(iso.endsWith("Z") ? iso : `${iso}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function schemaHasTable(db, schema, tableName) {
  try {
    const row = db
      .prepare(`SELECT name FROM ${schema}.sqlite_master WHERE type = 'table' AND name = ?`)
      .get(String(tableName || ""));
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

function eventDedupeKey(row = {}) {
  return [
    row.event_type ?? "",
    row.session_id ?? "",
    row.trace_id ?? "",
    row.memory_id ?? "",
    row.latency_ms ?? "",
    row.candidate_count ?? "",
    row.injected_count ?? "",
    row.cited_count ?? "",
    row.vector_score ?? "",
    row.fts_score ?? "",
    row.final_score ?? "",
    row.source ?? "",
    row.metadata_json ?? "",
    row.created_at ?? "",
  ].join("\u001f");
}

function readEventsFromSchema(db, schema) {
  if (!schemaHasTable(db, schema, "memory_events")) return [];
  return db.prepare(`
    SELECT
      id, event_type, session_id, trace_id, memory_id,
      latency_ms, candidate_count, injected_count, cited_count,
      vector_score, fts_score, final_score, source, metadata_json, created_at,
      '${schema}' AS event_source
    FROM ${schema}.memory_events
  `).all();
}

export function readUnifiedMemoryEvents(db, options = {}) {
  const rows = [
    ...readEventsFromSchema(db, "main"),
    ...readEventsFromSchema(db, "core"),
  ];
  const deduped = new Map();
  for (const row of rows) {
    deduped.set(eventDedupeKey(row), row);
  }
  const merged = [...deduped.values()];
  merged.sort((a, b) => {
    const tsA = parseSqliteDateTimeUtc(a?.created_at) || 0;
    const tsB = parseSqliteDateTimeUtc(b?.created_at) || 0;
    if (tsA !== tsB) return tsB - tsA;
    return (Number(b?.id) || 0) - (Number(a?.id) || 0);
  });
  const limit = Number(options?.limit);
  if (Number.isFinite(limit) && limit > 0) return merged.slice(0, Math.floor(limit));
  return merged;
}

function toShare(count, total) {
  const n = Number(count) || 0;
  const d = Number(total) || 0;
  if (d <= 0) return 0;
  return round(n / d, 4);
}

export function derivePathPrefix(path = "") {
  const normalized = String(path || "").replace(/\\/g, "/").replace(/^\.?\//, "").trim();
  if (!normalized) return "unknown";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) return parts.join("/");
  return `${parts[0]}/${parts[1]}`;
}

export function summarizeDistribution(items, keySelector) {
  const counts = new Map();
  for (const item of (Array.isArray(items) ? items : [])) {
    const key = asKey(keySelector(item), "unknown");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const distribution = Object.fromEntries(sorted);
  const total = sorted.reduce((sum, [, count]) => sum + (Number(count) || 0), 0);
  const distinctCount = sorted.length;
  const entropy = total > 0
    ? sorted.reduce((sum, [, count]) => {
      const probability = (Number(count) || 0) / total;
      return probability > 0 ? sum - (probability * Math.log2(probability)) : sum;
    }, 0)
    : 0;
  const top1 = sorted[0]?.[1] ? Number(sorted[0][1]) : 0;
  return {
    distribution,
    total,
    distinct_count: distinctCount,
    entropy: round(entropy, 4),
    normalized_entropy: distinctCount > 1 ? round(entropy / Math.log2(distinctCount), 4) : 0,
    top1_share: total > 0 ? round(top1 / total, 4) : 0,
  };
}

function filterRowsByWindowDays(rows, windowDays, nowMs = Date.now()) {
  const thresholdMs = nowMs - (Math.max(1, Number(windowDays) || 1) * 86400000);
  return (Array.isArray(rows) ? rows : []).filter(row => {
    const ts = parseSqliteDateTimeUtc(row?.created_at);
    return ts !== null && ts >= thresholdMs;
  });
}

export function resolveMemoryReferenceId(row = {}, metadata = {}, fallbackPath = "") {
  const memoryId = asKey(row?.memory_id ?? metadata?.memory_id, "");
  if (memoryId) return memoryId;
  const chunkId = asKey(metadata?.chunk_id ?? metadata?.id, "");
  if (chunkId) return chunkId;
  const path = asKey(metadata?.path ?? fallbackPath, "");
  if (path) return path;
  return "unknown";
}

function extractDebugPathMaps(rows) {
  const byTrace = new Map();
  for (const row of rows) {
    if (row?.event_type !== "auto_recall_debug") continue;
    const traceId = asKey(row?.trace_id, "");
    if (!traceId) continue;
    const metadata = safeJson(row?.metadata_json, {});
    const candidates = [
      ...(Array.isArray(metadata?.post_rerank_topK) ? metadata.post_rerank_topK : []),
      ...(Array.isArray(metadata?.post_rerank_top) ? metadata.post_rerank_top : []),
    ];
    if (!byTrace.has(traceId)) byTrace.set(traceId, new Map());
    const traceMap = byTrace.get(traceId);
    for (const item of candidates) {
      const itemId = asKey(item?.id, "");
      if (!itemId) continue;
      const path = asKey(item?.path, "");
      if (!path) continue;
      traceMap.set(itemId, path);
    }
  }
  return byTrace;
}

export function extractRecallTopEntries(rows, { windowDays = 7, topN = 10, nowMs = Date.now() } = {}) {
  const withinWindow = filterRowsByWindowDays(rows, windowDays, nowMs);
  const debugPathMaps = extractDebugPathMaps(withinWindow);
  const grouped = new Map();
  for (const row of withinWindow) {
    if (row?.event_type !== "memory_candidate_retrieved") continue;
    const metadata = safeJson(row?.metadata_json, {});
    const traceId = asKey(row?.trace_id, "");
    const recallKey = traceId || `missing-trace:${asKey(row?.session_id, "unknown")}:${Number(row?.id) || 0}`;
    if (!grouped.has(recallKey)) grouped.set(recallKey, []);
    const candidateId = resolveMemoryReferenceId(row, metadata, "");
    const debugPath = traceId && candidateId
      ? debugPathMaps.get(traceId)?.get(candidateId) || ""
      : "";
    const explicitPath = asKey(metadata?.path, "");
    const path = explicitPath || debugPath || "unknown";
    const rankRaw = Number(metadata?.rank);
    const memoryIdRaw = asKey(row?.memory_id ?? metadata?.memory_id, "");
    const chunkIdRaw = asKey(metadata?.chunk_id ?? metadata?.id, "");
    grouped.get(recallKey).push({
      row_id: Number(row?.id) || 0,
      trace_id: traceId || "",
      recall_key: recallKey,
      rank: Number.isFinite(rankRaw) && rankRaw > 0 ? rankRaw : Number.POSITIVE_INFINITY,
      reference_id: candidateId || "unknown",
      memory_id: memoryIdRaw || "unknown",
      chunk_id: chunkIdRaw || "unknown",
      category: asKey(metadata?.category, "unknown"),
      source_type: asKey(metadata?.source_type, "unknown"),
      path,
      path_prefix: derivePathPrefix(path),
    });
  }

  const flattened = [];
  for (const entries of grouped.values()) {
    const sorted = entries
      .slice()
      .sort((a, b) => (a.rank - b.rank) || (a.row_id - b.row_id))
      .slice(0, Math.max(1, Number(topN) || 1));
    flattened.push(...sorted);
  }
  return {
    entries: flattened,
    recall_count: grouped.size,
    window_days: Math.max(1, Number(windowDays) || 7),
    top_n_per_recall: Math.max(1, Number(topN) || 10),
  };
}

export function buildRetrievalDiversitySummary(rows, { windowDays = 7, topN = 10, nowMs = Date.now() } = {}) {
  const extracted = extractRecallTopEntries(rows, { windowDays, topN, nowMs });
  const { entries } = extracted;
  return {
    window_days: extracted.window_days,
    top_n_per_recall: extracted.top_n_per_recall,
    recall_count: extracted.recall_count,
    sampled_items_total: entries.length,
    category: summarizeDistribution(entries, item => item.category),
    source_type: summarizeDistribution(entries, item => item.source_type),
    path_prefix: summarizeDistribution(entries, item => item.path_prefix),
  };
}

export function buildReinforcementConcentrationSummary(rows, { windowDays = 7, topN = 10, nowMs = Date.now() } = {}) {
  const extracted = extractRecallTopEntries(rows, { windowDays, topN, nowMs });
  return buildReinforcementConcentrationFromEntries(extracted);
}

function buildReinforcementConcentrationFromEntries(extracted) {
  const entries = Array.isArray(extracted?.entries) ? extracted.entries : [];
  const memoryCounts = new Map();
  const memoryMeta = new Map();
  for (const item of entries) {
    const id = asKey(item?.reference_id, "unknown");
    memoryCounts.set(id, (memoryCounts.get(id) || 0) + 1);
    const existing = memoryMeta.get(id) || { category: "unknown", path: "unknown" };
    if (existing.category === "unknown" && item?.category && item.category !== "unknown") {
      existing.category = item.category;
    }
    if (existing.path === "unknown" && item?.path && item.path !== "unknown") {
      existing.path = item.path;
    }
    memoryMeta.set(id, existing);
  }

  const sorted = [...memoryCounts.entries()]
    .map(([id, count]) => ({ id, count: Number(count) || 0 }))
    .sort((a, b) => b.count - a.count);
  const distribution = Object.fromEntries(sorted.map(item => [item.id, item.count]));
  const totalReferences = sorted.reduce((sum, item) => sum + item.count, 0);
  const uniqueMemories = sorted.length;
  const top1Count = sorted[0]?.count || 0;
  const top5Count = sorted.slice(0, 5).reduce((sum, item) => sum + item.count, 0);
  const top10Count = sorted.slice(0, 10).reduce((sum, item) => sum + item.count, 0);
  const hhi = totalReferences > 0
    ? sorted.reduce((sum, item) => {
      const share = item.count / totalReferences;
      return sum + (share * share);
    }, 0)
    : 0;
  const topMemories = sorted.slice(0, 10).map(item => {
    const meta = memoryMeta.get(item.id) || { category: "unknown", path: "unknown" };
    return {
      id: item.id,
      count: item.count,
      share: toShare(item.count, totalReferences),
      category: asKey(meta.category, "unknown"),
      path: asKey(meta.path, "unknown"),
    };
  });

  return {
    window_days: Math.max(1, Number(extracted?.window_days) || 7),
    top_n_per_recall: Math.max(1, Number(extracted?.top_n_per_recall) || 10),
    recall_count: Number(extracted?.recall_count) || 0,
    total_references: totalReferences,
    unique_memories: uniqueMemories,
    top1_share: toShare(top1Count, totalReferences),
    top5_share: toShare(top5Count, totalReferences),
    top10_share: toShare(top10Count, totalReferences),
    hhi: round(hhi, 4),
    distribution,
    top_memories: topMemories,
  };
}

function buildInjectedReferenceSets(rows, { windowDays = 7, nowMs = Date.now() } = {}) {
  const withinWindow = filterRowsByWindowDays(rows, windowDays, nowMs);
  const injectedByTrace = new Map();
  const injectedGlobal = new Set();
  for (const row of withinWindow) {
    if (row?.event_type !== "memory_injected") continue;
    const metadata = safeJson(row?.metadata_json, {});
    const traceId = asKey(row?.trace_id, "");
    const referenceId = resolveMemoryReferenceId(row, metadata, "");
    if (!referenceId) continue;
    injectedGlobal.add(referenceId);
    if (!traceId) continue;
    if (!injectedByTrace.has(traceId)) injectedByTrace.set(traceId, new Set());
    injectedByTrace.get(traceId).add(referenceId);
  }
  return { injectedByTrace, injectedGlobal };
}

export function buildRecallMissAfterResponseSummary(rows, { windowDays = 7, topN = 10, nowMs = Date.now() } = {}) {
  const extracted = extractRecallTopEntries(rows, { windowDays, topN, nowMs });
  const opportunities = Array.isArray(extracted?.entries) ? extracted.entries : [];
  const { injectedByTrace, injectedGlobal } = buildInjectedReferenceSets(rows, { windowDays, nowMs });
  const missByReference = new Map();

  for (const item of opportunities) {
    const referenceId = asKey(item?.reference_id, "unknown");
    const traceId = asKey(item?.trace_id, "");
    const injectedSet = traceId ? injectedByTrace.get(traceId) : null;
    const isInjected = injectedSet ? injectedSet.has(referenceId) : injectedGlobal.has(referenceId);
    if (isInjected) continue;
    const existing = missByReference.get(referenceId) || {
      memory_id: asKey(item?.memory_id, "unknown"),
      chunk_id: asKey(item?.chunk_id, "unknown"),
      path: asKey(item?.path, "unknown"),
      category: asKey(item?.category, "unknown"),
      source_type: asKey(item?.source_type, "unknown"),
      count: 0,
    };
    existing.count += 1;
    if (existing.memory_id === "unknown" && item?.memory_id && item.memory_id !== "unknown") existing.memory_id = item.memory_id;
    if (existing.chunk_id === "unknown" && item?.chunk_id && item.chunk_id !== "unknown") existing.chunk_id = item.chunk_id;
    if (existing.path === "unknown" && item?.path && item.path !== "unknown") existing.path = item.path;
    if (existing.category === "unknown" && item?.category && item.category !== "unknown") existing.category = item.category;
    if (existing.source_type === "unknown" && item?.source_type && item.source_type !== "unknown") existing.source_type = item.source_type;
    missByReference.set(referenceId, existing);
  }

  const totalOpportunities = opportunities.length;
  const sortedMisses = [...missByReference.entries()]
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => (b.count - a.count) || String(a.id).localeCompare(String(b.id)));
  const missCount = sortedMisses.reduce((sum, item) => sum + (Number(item.count) || 0), 0);
  const topMissedMemories = sortedMisses.slice(0, 5).map(item => ({
    id: item.id,
    memory_id: item.memory_id || "unknown",
    chunk_id: item.chunk_id || "unknown",
    path: item.path || "unknown",
    category: item.category || "unknown",
    source_type: item.source_type || "unknown",
    count: item.count,
    share: toShare(item.count, totalOpportunities),
  }));

  return {
    window_days: Math.max(1, Number(extracted?.window_days) || 7),
    top_n_per_recall: Math.max(1, Number(extracted?.top_n_per_recall) || 10),
    total_recall_opportunities: totalOpportunities,
    miss_count: missCount,
    miss_rate: toShare(missCount, totalOpportunities),
    top_missed_memories: topMissedMemories,
  };
}

export function buildAutoRecallInjectionRateSummary(rows, { windowDays = 7, nowMs = Date.now() } = {}) {
  const withinWindow = filterRowsByWindowDays(rows, windowDays, nowMs);
  let candidateCount = 0;
  let candidateCountAfterGate = 0;
  let injectedCount = 0;
  for (const row of withinWindow) {
    if (row?.event_type !== "auto_recall_debug") continue;
    const metadata = safeJson(row?.metadata_json, {});
    candidateCount += Math.max(0, Number(metadata?.candidate_count) || 0);
    candidateCountAfterGate += Math.max(0, Number(metadata?.candidate_count_after_gate) || 0);
    injectedCount += Math.max(0, Number(metadata?.injected_count) || 0);
  }
  return {
    window_days: Math.max(1, Number(windowDays) || 7),
    candidate_count: candidateCount,
    candidate_count_after_gate: candidateCountAfterGate,
    injected_count: injectedCount,
    injection_rate: toShare(injectedCount, candidateCount),
    gate_pass_rate: toShare(candidateCountAfterGate, candidateCount),
  };
}

export function overviewMetrics() {
  const metricTopN = Math.max(1, Number(getMemoryEngineConfig(null)?.metrics?.topN) || 10);
  return withDb(db => {
    const events = db.prepare("SELECT COUNT(*) AS count FROM memory_events").get().count;
    const memories = tableExists(db, "chunks") ? db.prepare("SELECT COUNT(*) AS count FROM chunks").get().count : 0;
    const confidence = db.prepare(`
      SELECT COUNT(*) AS tracked, ROUND(AVG(confidence), 3) AS avg_confidence,
        SUM(CASE WHEN is_archived = 1 THEN 1 ELSE 0 END) AS archived,
        SUM(CASE WHEN conflict_flag = 1 THEN 1 ELSE 0 END) AS conflicts,
        SUM(CASE WHEN is_protected = 1 THEN 1 ELSE 0 END) AS protected
      FROM memory_confidence
    `).get();
    const activeHits = db.prepare(`
      SELECT COALESCE(hit_count, 0) AS hit_count
      FROM memory_confidence
      WHERE COALESCE(is_archived, 0) = 0
      ORDER BY hit_count DESC
    `).all();
    const hitValues = activeHits.map(row => Number(row.hit_count) || 0);
    const totalHits = hitValues.reduce((sum, value) => sum + value, 0);
    const reinforcedMemories = hitValues.filter(value => value > 0).length;
    const topHits = hitValues.slice(0, metricTopN).reduce((sum, value) => sum + value, 0);
    const hhi = totalHits > 0
      ? hitValues.reduce((sum, value) => {
        const share = value / totalHits;
        return sum + share * share;
      }, 0)
      : 0;
    const reinforcement = {
      active_memories: hitValues.length,
      reinforced_memories: reinforcedMemories,
      total_hits: totalHits,
      top10_share: totalHits > 0 ? round(topHits / totalHits, 4) : 0,
      hhi: round(hhi, 4),
    };
    return { events, memories, confidence, reinforcement };
  }, { readonly: true });
}

export function retrievalMetrics({ nowMs = Date.now() } = {}) {
  const metricConfig = getMemoryEngineConfig(null)?.metrics || {};
  const metricWindowDays = Math.max(1, Number(metricConfig?.windowDays) || 7);
  const metricTopN = Math.max(1, Number(metricConfig?.topN) || 10);
  return withDb(db => {
    const metricsNowMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
    const unifiedEvents = readUnifiedMemoryEvents(db);
    const recallCompleted = unifiedEvents.filter(event => event?.event_type === "recall_completed");
    const avgNullable = values => {
      const nums = values.map(v => Number(v)).filter(Number.isFinite);
      if (nums.length === 0) return null;
      return round(nums.reduce((sum, v) => sum + v, 0) / nums.length, 1);
    };
    const sumNullable = values => {
      const nums = values.map(v => Number(v)).filter(Number.isFinite);
      if (nums.length === 0) return null;
      return nums.reduce((sum, v) => sum + v, 0);
    };
    const aggregate = {
      completed: recallCompleted.length,
      avg_latency_ms: avgNullable(recallCompleted.map(event => event.latency_ms)),
      avg_candidates: avgNullable(recallCompleted.map(event => event.candidate_count)),
      avg_injected: avgNullable(recallCompleted.map(event => event.injected_count)),
      candidate_total: sumNullable(recallCompleted.map(event => event.candidate_count)),
      injected_total: sumNullable(recallCompleted.map(event => event.injected_count)),
    };
    const windowEvents = filterRowsByWindowDays(unifiedEvents, metricWindowDays, metricsNowMs);
    const categoryCounts = new Map();
    for (const event of windowEvents) {
      if (event?.event_type !== "memory_candidate_retrieved") continue;
      const metadata = safeJson(event?.metadata_json, {});
      const category = asKey(metadata?.category, "unknown");
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    }
    const categories = [...categoryCounts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0));
    const categoryTotal = categories.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
    const distinctCategories = categories.length;
    const entropy = categoryTotal > 0
      ? categories.reduce((sum, row) => {
        const probability = (Number(row.count) || 0) / categoryTotal;
        return probability > 0 ? sum - (probability * Math.log(probability)) : sum;
      }, 0)
      : 0;
    const top1 = categories[0] ? Number(categories[0].count) || 0 : 0;
    const diversity = {
      window_days: metricWindowDays,
      candidate_events: categoryTotal,
      distinct_categories: distinctCategories,
      entropy: round(entropy, 4),
      normalized_entropy: distinctCategories > 1 ? round(entropy / Math.log(distinctCategories), 4) : 0,
      top1_share: categoryTotal > 0 ? round(top1 / categoryTotal, 4) : 0,
    };
    const extracted = extractRecallTopEntries(unifiedEvents, {
      windowDays: metricWindowDays,
      topN: metricTopN,
      nowMs: metricsNowMs,
    });
    const retrievalDiversity = {
      window_days: extracted.window_days,
      top_n_per_recall: extracted.top_n_per_recall,
      recall_count: extracted.recall_count,
      sampled_items_total: extracted.entries.length,
      category: summarizeDistribution(extracted.entries, item => item.category),
      source_type: summarizeDistribution(extracted.entries, item => item.source_type),
      path_prefix: summarizeDistribution(extracted.entries, item => item.path_prefix),
    };
    const reinforcementConcentration = buildReinforcementConcentrationFromEntries(extracted);
    const recallMissAfterResponse = buildRecallMissAfterResponseSummary(unifiedEvents, {
      windowDays: metricWindowDays,
      topN: metricTopN,
      nowMs: metricsNowMs,
    });
    const autoRecallInjectionRate = buildAutoRecallInjectionRateSummary(unifiedEvents, {
      windowDays: metricWindowDays,
      nowMs: metricsNowMs,
    });
    return {
      aggregate,
      categories,
      diversity,
      retrieval_diversity: retrievalDiversity,
      reinforcement_concentration: reinforcementConcentration,
      recall_miss_after_response: recallMissAfterResponse,
      auto_recall_injection_rate: autoRecallInjectionRate,
    };
  }, { readonly: true });
}

export function conflictMetrics() {
  return withDb(db => db.prepare(`
    SELECT category, COUNT(*) AS count, ROUND(AVG(confidence), 3) AS avg_confidence
    FROM memory_confidence
    WHERE conflict_flag = 1
    GROUP BY category
    ORDER BY count DESC
  `).all(), { readonly: true });
}
