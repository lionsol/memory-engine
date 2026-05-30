import { tableExists, withDb } from "./db.js";
import { getMemoryEngineConfig } from "../../lib/config/runtime.js";

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
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

export function retrievalMetrics() {
  const metricWindowDays = Math.max(1, Number(getMemoryEngineConfig(null)?.metrics?.windowDays) || 7);
  return withDb(db => {
    const aggregate = db.prepare(`
      SELECT COUNT(*) AS completed, ROUND(AVG(latency_ms), 1) AS avg_latency_ms,
        ROUND(AVG(candidate_count), 1) AS avg_candidates, ROUND(AVG(injected_count), 1) AS avg_injected,
        SUM(candidate_count) AS candidate_total, SUM(injected_count) AS injected_total
      FROM memory_events
      WHERE event_type = 'recall_completed'
    `).get();
    const categories = db.prepare(`
      SELECT COALESCE(json_extract(metadata_json, '$.category'), 'unknown') AS category, COUNT(*) AS count
      FROM memory_events
      WHERE event_type = 'memory_candidate_retrieved' AND created_at >= datetime('now', '-${metricWindowDays} days')
      GROUP BY category
      ORDER BY count DESC
    `).all();
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
    return { aggregate, categories, diversity };
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
