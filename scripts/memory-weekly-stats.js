#!/usr/bin/env node
/**
 * memory-weekly-stats.js — P2 核心观测指标周快照
 *
 * 收集以下指标并写入 memory/stats-history.md：
 *   1. Retrieval Diversity — normalized_entropy, top1_share, distinct_count
 *   2. Reinforcement Concentration — top10_share, HHI
 *   3. Recall Miss — miss_rate, candidate_count, gate stats
 *   4. Top Memories — 被召回最多的记忆
 *   5. Top Categories — 类别分布
 *
 * 运行方式：cron 每周日 05:00
 * 数据来源：memory-engine.sqlite.memory_events
 */

const { homedir } = require("node:os");
const { resolve } = require("node:path");
const { existsSync, readFileSync, appendFileSync, mkdirSync } = require("node:fs");
const Database = require("better-sqlite3");

// ── Paths ──
const HOME = homedir();
const ME_DB = resolve(HOME, ".openclaw/memory/memory-engine/memory-engine.sqlite");
const MAIN_DB = resolve(HOME, ".openclaw/memory/main.sqlite");
const WORKSPACE = resolve(HOME, ".openclaw/workspace");
const STATS_LOG = resolve(WORKSPACE, "memory/stats-history.md");

// ── Helpers ──
function withDb(path, fn) {
  const db = new Database(path, { readonly: true });
  try { return fn(db); } finally { db.close(); }
}

function isoWeekStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

function isoWeekEnd() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  const day = d.getDay();
  const diff = d.getDate() + (7 - (day === 0 ? 7 : day));
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

function weekLabel() {
  return `${isoWeekStart()} ~ ${isoWeekEnd()}`;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ── 1. Retrieval Diversity ──
function calcDiversity(events) {
  // Count distinct categories from post_rerank_topK / gate_decisions
  const catFreq = {};
  const memIds = new Set();
  let total = 0;

  for (const e of events) {
    if (!e.metadata_json) continue;
    const meta = JSON.parse(e.metadata_json);
    
    // Count from gate_decisions (all candidates that went through gate)
    const decisions = meta.gate_decisions;
    if (Array.isArray(decisions)) {
      for (const d of decisions) {
        const cat = d.category || "unknown";
        catFreq[cat] = (catFreq[cat] || 0) + 1;
        memIds.add(d.id);
        total++;
      }
    }
    
    // Also count from post_rerank_topK
    const reranked = meta.post_rerank_topK;
    if (Array.isArray(reranked)) {
      for (const r of reranked) {
        const cat = r.category || "unknown";
        catFreq[cat] = (catFreq[cat] || 0) + 1;
        memIds.add(r.id);
        total++;
      }
    }
  }

  // Shannon entropy
  let entropy = 0;
  for (const cat of Object.keys(catFreq)) {
    const p = catFreq[cat] / total;
    if (p > 0) entropy -= p * Math.log(p);
  }
  const n = Object.keys(catFreq).length;
  const normalizedEntropy = n > 1 ? entropy / Math.log(n) : 1;

  // Top-1 share
  const sorted = Object.entries(catFreq).sort((a, b) => b[1] - a[1]);
  const top1Share = total > 0 ? (sorted[0]?.[1] || 0) / total : 0;

  // Distinct memory count
  const distinctCount = memIds.size;

  // Category count
  const categoryCount = n;

  return {
    normalizedEntropy: +normalizedEntropy.toFixed(4),
    top1Share: +top1Share.toFixed(4),
    distinctCount,
    categoryCount,
    categoryBreakdown: sorted.map(([k, v]) => ({ category: k, count: v, share: +(v / total).toFixed(4) })),
    totalSamples: total,
  };
}

// ── 2. Reinforcement Concentration ──
function calcConcentration(events) {
  const memFreq = {};
  let total = 0;

  for (const e of events) {
    if (!e.metadata_json) continue;
    const meta = JSON.parse(e.metadata_json);

    const decisions = meta.gate_decisions;
    if (Array.isArray(decisions)) {
      for (const d of decisions) {
        memFreq[d.id] = (memFreq[d.id] || 0) + 1;
        total++;
      }
    }

    const reranked = meta.post_rerank_topK;
    if (Array.isArray(reranked)) {
      for (const r of reranked) {
        memFreq[r.id] = (memFreq[r.id] || 0) + 1;
        total++;
      }
    }
  }

  const sorted = Object.entries(memFreq).sort((a, b) => b[1] - a[1]);
  const n = sorted.length;

  // HHI = sum of squared market shares
  let hhi = 0;
  for (const [, count] of sorted) {
    const share = count / total;
    hhi += share * share;
  }

  // Top-10 share
  const top10Count = sorted.slice(0, 10).reduce((sum, [, c]) => sum + c, 0);
  const top10Share = total > 0 ? top10Count / total : 0;

  // Top-5 share (for extra granularity)
  const top5Count = sorted.slice(0, 5).reduce((sum, [, c]) => sum + c, 0);
  const top5Share = total > 0 ? top5Count / total : 0;

  return {
    hhi: +hhi.toFixed(4),
    top10Share: +top10Share.toFixed(4),
    top5Share: +top5Share.toFixed(4),
    totalMemories: n,
    totalSamples: total,
    topMemories: sorted.slice(0, 10).map(([id, count]) => ({
      id,
      count,
      share: +(count / total).toFixed(4),
    })),
  };
}

// ── 3. Recall Miss ──
function calcRecallMiss(events) {
  let totalCandidates = 0;
  let totalInjected = 0;
  let totalBeforeGate = 0;
  let totalAfterGate = 0;
  let totalRejected = 0;
  let totalSearches = 0;
  let totalMisses = 0; // injected = 0
  let totalVectorMs = 0;
  let vectorCount = 0;

  for (const e of events) {
    if (!e.metadata_json) continue;
    const meta = JSON.parse(e.metadata_json);
    totalSearches++;

    if (typeof meta.candidate_count === "number") totalCandidates += meta.candidate_count;
    if (typeof meta.strict_count === "number") totalCandidates += meta.strict_count;
    if (typeof meta.fallback_count === "number") totalCandidates += meta.fallback_count;
    if (typeof meta.candidate_count_before_gate === "number") totalBeforeGate += meta.candidate_count_before_gate;
    if (typeof meta.candidate_count_after_gate === "number") totalAfterGate += meta.candidate_count_after_gate;
    if (typeof meta.injected_count === "number") totalInjected += meta.injected_count;
    if (typeof meta.vector_ms === "number") { totalVectorMs += meta.vector_ms; vectorCount++; }

    const rejected = meta.rejected_candidates;
    if (Array.isArray(rejected)) totalRejected += rejected.length;

    if (meta.injected_count === 0 || meta.injected_count == null) totalMisses++;
  }

  const missRate = totalSearches > 0 ? totalMisses / totalSearches : 0;
  const injectRate = totalSearches > 0 ? totalAfterGate / totalSearches : 0;
  const avgCandidates = totalSearches > 0 ? totalCandidates / totalSearches : 0;
  const avgBeforeGate = totalSearches > 0 ? totalBeforeGate / totalSearches : 0;
  const avgAfterGate = totalSearches > 0 ? totalAfterGate / totalSearches : 0;
  const avgInjected = totalSearches > 0 ? totalInjected / totalSearches : 0;
  const avgVectorMs = vectorCount > 0 ? totalVectorMs / vectorCount : 0;

  return {
    missRate: +missRate.toFixed(4),
    injectRate: +injectRate.toFixed(4),
    avgCandidateCount: +avgCandidates.toFixed(2),
    avgBeforeGate: +avgBeforeGate.toFixed(2),
    avgAfterGate: +avgAfterGate.toFixed(2),
    autoRecallInjectionRate: totalCandidates > 0 ? +(totalInjected / totalCandidates).toFixed(4) : 0,
    avgInjected: +avgInjected.toFixed(2),
    totalSearches: totalSearches,
    totalInjected,
    totalRejected,
    avgVectorMs: +avgVectorMs.toFixed(0),
  };
}

// ── 4. Top Memories (resolve chunk paths) ──
function resolveChunkPaths(memories) {
  const ids = memories.map(m => m.id);
  if (ids.length === 0) return memories;

  return withDb(MAIN_DB, (db) => {
    const rows = {};
    const stmt = db.prepare("SELECT id, path, start_line, end_line, model FROM chunks WHERE id = ?");
    for (const id of ids) {
      try {
        const row = stmt.get(id);
        if (row) rows[id] = row;
      } catch (_) {}
    }
    return memories.map(m => ({
      ...m,
      path: rows[m.id]?.path || "unknown",
      lines: rows[m.id] ? `${rows[m.id].start_line}-${rows[m.id].end_line}` : "-",
      model: rows[m.id]?.model || "-",
    }));
  });
}

// ── 5. Category Stats from memory_confidence ──
function collectCategoryStats() {
  return withDb(MAIN_DB, (db) => {
    const rows = db.prepare(`
      SELECT mc.category, 
             COUNT(*) as count, 
             AVG(mc.confidence) as avg_conf,
             SUM(mc.hit_count) as total_hits,
             SUM(CASE WHEN mc.is_archived = 1 THEN 1 ELSE 0 END) as archived
      FROM memory_confidence mc
      GROUP BY mc.category
      ORDER BY count DESC
    `).all();
    return rows.map(r => ({
      category: r.category,
      count: r.count,
      avgConfidence: +r.avg_conf.toFixed(3),
      totalHits: r.total_hits || 0,
      archived: r.archived || 0,
    }));
  });
}

// ── Generate weekly snapshot ──
function generateSnapshot() {
  const week = weekLabel();
  const dateStr = new Date().toISOString().slice(0, 10);

  console.log(`[weekly] === P2 Weekly Snapshot — ${week} ===`);

  // Read events from the past 7 days
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const events = withDb(ME_DB, (db) => {
    return db.prepare(`
      SELECT * FROM memory_events 
      WHERE event_type = 'auto_recall_debug'
      AND datetime(created_at) >= datetime(?)
      ORDER BY id
    `).all(weekAgo.toISOString().slice(0, 19));
  });

  console.log(`[weekly] Events in window: ${events.length}`);

  if (events.length === 0) {
    console.log("[weekly] No events in window, writing empty snapshot");
    return writeSnapshot({
      week,
      date: dateStr,
      diversity: null,
      concentration: null,
      recallMiss: null,
      categoryStats: collectCategoryStats(),
    });
  }

  const diversity = calcDiversity(events);
  const concentration = calcConcentration(events);
  const recallMiss = calcRecallMiss(events);
  const categoryStats = collectCategoryStats();

  // Resolve top memory paths
  const topMemories = resolveChunkPaths(concentration.topMemories);

  writeSnapshot({
    week,
    date: dateStr,
    eventCount: events.length,
    diversity,
    concentration: { ...concentration, topMemories },
    recallMiss,
    categoryStats,
  });
}

// ── Write to stats-history.md ──
function writeSnapshot(data) {
  const lines = [`\n## 📊 P2 周报 — ${data.week}`, `生成日期：${data.date}`, ""];

  // Compact trend summary for cross-week comparison
  if (data.diversity && data.concentration && data.recallMiss) {
    const entropy = data.diversity.normalizedEntropy;
    const hhi = data.concentration.hhi;
    const miss = data.recallMiss.missRate;
    const inject = data.recallMiss.autoRecallInjectionRate;
    const entropyFlag = entropy < 0.2 ? '⚠️过低' : entropy > 0.8 ? '⚠️过高' : entropy < 0.4 ? '👀偏低' : entropy > 0.6 ? '👀偏高' : '✅';
    const hhiFlag = hhi > 0.40 ? '⚠️垄断' : hhi > 0.20 ? '👀偏高' : hhi < 0.05 ? '👀偏低' : '✅';
    const missFlag = miss > 0.70 ? '⚠️过严' : miss > 0.40 ? '👀偏高' : miss < 0.05 ? '⚠️过松' : miss < 0.10 ? '👀偏低' : '✅';
    lines.push(`> 📈 速览: entropy=${entropy}(${entropyFlag}) | HHI=${hhi}(${hhiFlag}) | miss_rate=${miss}(${missFlag}) | inject_rate=${inject}`);
    lines.push("");
  }

  // Event count
  if (data.eventCount != null) {
    lines.push(`分析事件数：${data.eventCount}`);
    lines.push("");
  }

  // 1. Retrieval Diversity
  lines.push("### 1️⃣ Retrieval Diversity");
  if (data.diversity) {
    const d = data.diversity;
    lines.push(`- normalized_entropy: **${d.normalizedEntropy}**${d.normalizedEntropy < 0.2 ? ' ⚠️ 过低（过于集中）' : d.normalizedEntropy > 0.8 ? ' ⚠️ 过高（过于分散）' : ' ✅'} （理想 0.4 ~ 0.8）`);
    lines.push(`- top1_share: **${d.top1Share}**`);
    lines.push(`- distinct_count: ${d.distinctCount}`);
    lines.push(`- category_count: ${d.categoryCount}`);
    lines.push(`- total_samples: ${d.totalSamples}`);
    lines.push("");
    lines.push("类别分布：");
    for (const cat of d.categoryBreakdown) {
      lines.push(`  - ${cat.category}: ${cat.count} 次 (${(cat.share * 100).toFixed(1)}%)`);
    }
  } else {
    lines.push("（无数据）");
  }
  lines.push("");

  // 2. Concentration
  lines.push("### 2️⃣ Reinforcement Concentration");
  if (data.concentration) {
    const c = data.concentration;
    const hhiOk = c.hhi >= 0.05 && c.hhi <= 0.20;
    lines.push(`- HHI: **${c.hhi}**${c.hhi > 0.40 ? ' ⚠️ 过高（记忆垄断）' : hhiOk ? ' ✅' : ' 👀'} （理想 0.05 ~ 0.20）`);
    lines.push(`- top5_share: ${c.top5Share}`);
    lines.push(`- top10_share: ${c.top10Share}`);
    lines.push(`- total_memories_in_recall: ${c.totalMemories}`);
    lines.push("");
    lines.push("Top 记忆：");
    let rank = 0;
    for (const m of c.topMemories) {
      rank++;
      lines.push(`  ${rank}. \`${m.path || m.id}\` — 召回 ${m.count} 次 (${(m.share * 100).toFixed(1)}%)`);
      if (m.path && m.path !== "unknown") {
        lines.push(`     lines=${m.lines} model=${m.model}`);
      }
    }
  } else {
    lines.push("（无数据）");
  }
  lines.push("");

  // 3. Recall Miss
  lines.push("### 3️⃣ Recall Miss After Response");
  if (data.recallMiss) {
    const m = data.recallMiss;
    lines.push(`- miss_rate: **${m.missRate}**${m.missRate > 0.70 ? ' ⚠️ 过高（Gate 太保守）' : m.missRate < 0.05 ? ' ⚠️ 过低（Gate 太宽松）' : ' ✅'} （理想 0.10 ~ 0.40）`);
    lines.push(`- inject_rate: ${m.injectRate}`);
    lines.push(`- avg_candidate_count: ${m.avgCandidateCount}`);
    lines.push(`- avg_before_gate: ${m.avgBeforeGate}`);
    lines.push(`- avg_after_gate: ${m.avgAfterGate}`);
    lines.push(`- autoRecall_injection_rate: **${m.autoRecallInjectionRate}**`);
    lines.push(`- avg_injected: ${m.avgInjected}`);
    lines.push(`- total_searches: ${m.totalSearches}`);
    lines.push(`- total_injected: ${m.totalInjected}`);
    lines.push(`- total_rejected_by_gate: ${m.totalRejected}`);
    lines.push(`- avg_vector_ms: ${m.avgVectorMs}ms`);
  } else {
    lines.push("（无数据）");
  }
  lines.push("");

  // 4. Category Stats
  lines.push("### 4️⃣ Category 分布（全量）");
  if (data.categoryStats && data.categoryStats.length > 0) {
    for (const c of data.categoryStats) {
      lines.push(`- ${c.category}: ${c.count} 条, 平均置信度 ${c.avgConfidence}, 命中 ${c.totalHits} 次, 已归档 ${c.archived}`);
    }
  } else {
    lines.push("（无数据）");
  }
  lines.push("");

  // Status summary
  lines.push("### 状态评估");
  const issues = [];
  if (data.diversity) {
    if (data.diversity.normalizedEntropy < 0.2) issues.push("❌ Diversity 过低 — 召回集中");
    else if (data.diversity.normalizedEntropy < 0.4) issues.push("⚠️ Diversity 偏低");
    else if (data.diversity.normalizedEntropy > 0.8) issues.push("⚠️ Diversity 偏高 — 可能缺少聚焦");
  }
  if (data.concentration) {
    if (data.concentration.hhi > 0.40) issues.push("❌ HHI 过高 — 记忆垄断");
    else if (data.concentration.hhi > 0.20) issues.push("⚠️ HHI 偏高");
  }
  if (data.recallMiss) {
    if (data.recallMiss.missRate > 0.70) issues.push("❌ Miss Rate 过高 — Gate 过严");
    else if (data.recallMiss.missRate > 0.40) issues.push("⚠️ Miss Rate 偏高");
    else if (data.recallMiss.missRate < 0.05) issues.push("⚠️ Miss Rate 过低 — 可能注入过多无用记忆");
  }
  if (issues.length === 0) {
    lines.push("✅ 所有指标正常");
  } else {
    for (const issue of issues) lines.push(issue);
  }
  lines.push("");
  lines.push("---");

  // Append
  mkdirSync(resolve(WORKSPACE, "memory"), { recursive: true });
  appendFileSync(STATS_LOG, lines.join("\n"));
  console.log(`[weekly] ✅ Snapshot written to ${STATS_LOG}`);
}

// ── Main ──
generateSnapshot();
