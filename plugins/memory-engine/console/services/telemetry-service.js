import { withDb } from "./db.js";
import { getMemoryEngineConfig } from "../../lib/config/runtime.js";

export function latencySeries({ limit = 120 } = {}) {
  return withDb(db => db.prepare(`
    SELECT id, event_type, trace_id, session_id, latency_ms, candidate_count, injected_count, source, created_at
    FROM memory_events
    WHERE latency_ms IS NOT NULL
    ORDER BY id DESC
    LIMIT ?
  `).all(limit), { readonly: true });
}

export function recallTelemetry() {
  const businessTz = getMemoryEngineConfig(null)?.timezone?.business || "Asia/Shanghai";
  return withDb(db => {
    const totals = db.prepare(`
      SELECT
        SUM(CASE WHEN event_type = 'recall_started' THEN 1 ELSE 0 END) AS started,
        SUM(CASE WHEN event_type = 'recall_completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN event_type = 'memory_candidate_retrieved' THEN 1 ELSE 0 END) AS candidates,
        SUM(CASE WHEN event_type = 'memory_injected' THEN 1 ELSE 0 END) AS injected,
        SUM(CASE WHEN event_type = 'memory_cited' THEN 1 ELSE 0 END) AS cited,
        ROUND(AVG(CASE WHEN event_type = 'recall_completed' THEN latency_ms END), 1) AS avg_latency_ms
      FROM memory_events
      WHERE created_at >= datetime('now', '-7 days')
    `).get();
    const byHour = db.prepare(`
      SELECT strftime('%Y-%m-%d %H:00', datetime(created_at, '+8 hours')) AS bucket, COUNT(*) AS count
      FROM memory_events
      WHERE event_type = 'recall_completed' AND created_at >= datetime('now', '-48 hours')
      GROUP BY bucket
      ORDER BY bucket ASC
    `).all();
    return { totals, byHour, timezone: businessTz };
  }, { readonly: true });
}

export function writeTelemetry() {
  return withDb(db => db.prepare(`
    SELECT event_type, memory_id, source, final_score, created_at
    FROM memory_events
    WHERE event_type IN ('memory_created', 'memory_archived', 'memory_deleted', 'memory_confidence_updated')
    ORDER BY id DESC
    LIMIT 100
  `).all(), { readonly: true });
}
