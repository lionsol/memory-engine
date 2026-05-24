import { tableExists, withDb } from "./db.js";

export function overviewMetrics() {
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
    return { events, memories, confidence };
  }, { readonly: true });
}

export function retrievalMetrics() {
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
      WHERE event_type = 'memory_candidate_retrieved'
      GROUP BY category
      ORDER BY count DESC
    `).all();
    return { aggregate, categories };
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
