import { safeJson, tableExists, withDb } from "./db.js";

function eventRow(row) {
  return { ...row, metadata: safeJson(row.metadata_json, {}) };
}

export function listSessions({ limit = 50 } = {}) {
  return withDb(db => db.prepare(`
    SELECT
      COALESCE(NULLIF(session_id, ''), trace_id, 'local') AS id,
      COUNT(*) AS event_count,
      COUNT(DISTINCT trace_id) AS trace_count,
      MIN(created_at) AS started_at,
      MAX(created_at) AS last_seen_at,
      SUM(CASE WHEN event_type = 'recall_completed' THEN 1 ELSE 0 END) AS recall_count,
      SUM(CASE WHEN event_type = 'memory_injected' THEN 1 ELSE 0 END) AS injected_count,
      SUM(CASE WHEN event_type = 'memory_cited' THEN 1 ELSE 0 END) AS cited_count,
      ROUND(AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END), 1) AS avg_latency_ms
    FROM memory_events
    GROUP BY COALESCE(NULLIF(session_id, ''), trace_id, 'local')
    ORDER BY MAX(created_at) DESC
    LIMIT ?
  `).all(limit), { readonly: true });
}

export function getSession(sessionId) {
  return withDb(db => {
    const session = db.prepare(`
      SELECT COALESCE(NULLIF(session_id, ''), trace_id, 'local') AS id,
        COUNT(*) AS event_count, COUNT(DISTINCT trace_id) AS trace_count,
        MIN(created_at) AS started_at, MAX(created_at) AS last_seen_at,
        ROUND(AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END), 1) AS avg_latency_ms
      FROM memory_events
      WHERE COALESCE(NULLIF(session_id, ''), trace_id, 'local') = ?
      GROUP BY COALESCE(NULLIF(session_id, ''), trace_id, 'local')
    `).get(sessionId);
    if (!session) return null;
    const traces = db.prepare(`
      SELECT trace_id, COUNT(*) AS event_count, MIN(created_at) AS started_at,
        MAX(created_at) AS completed_at, MAX(candidate_count) AS candidate_count,
        MAX(injected_count) AS injected_count, MAX(latency_ms) AS latency_ms
      FROM memory_events
      WHERE COALESCE(NULLIF(session_id, ''), trace_id, 'local') = ?
      GROUP BY trace_id
      ORDER BY MAX(created_at) DESC
      LIMIT 100
    `).all(sessionId);
    return { ...session, traces };
  }, { readonly: true });
}

export function getTrace(traceId) {
  return withDb(db => {
    const events = db.prepare("SELECT * FROM memory_events WHERE trace_id = ? ORDER BY id ASC").all(traceId).map(eventRow);
    const candidates = events.filter(event => event.event_type === "memory_candidate_retrieved");
    const injected = events.filter(event => event.event_type === "memory_injected");
    const completed = events.find(event => event.event_type === "recall_completed");
    return {
      trace_id: traceId,
      started_at: events[0]?.created_at ?? null,
      completed_at: completed?.created_at ?? events.at(-1)?.created_at ?? null,
      latency_ms: completed?.latency_ms ?? null,
      candidate_count: completed?.candidate_count ?? candidates.length,
      injected_count: completed?.injected_count ?? injected.length,
      events,
      candidates,
      injected,
    };
  }, { readonly: true });
}

export function recentTraces({ limit = 50 } = {}) {
  return withDb(db => db.prepare(`
    SELECT trace_id, COALESCE(NULLIF(session_id, ''), trace_id, 'local') AS session_id,
      MIN(created_at) AS started_at, MAX(created_at) AS completed_at,
      MAX(candidate_count) AS candidate_count, MAX(injected_count) AS injected_count,
      MAX(latency_ms) AS latency_ms, COUNT(*) AS event_count
    FROM memory_events
    WHERE trace_id IS NOT NULL
    GROUP BY trace_id
    ORDER BY MAX(created_at) DESC
    LIMIT ?
  `).all(limit), { readonly: true });
}

export function overviewSnapshot() {
  return withDb(db => {
    const eventCounts = db.prepare(`
      SELECT event_type, COUNT(*) AS count
      FROM memory_events
      WHERE created_at >= datetime('now', '-7 days')
      GROUP BY event_type
      ORDER BY count DESC
    `).all();
    const memoryCount = tableExists(db, "chunks") ? db.prepare("SELECT COUNT(*) AS count FROM chunks").get().count : 0;
    const activeCount = db.prepare("SELECT COUNT(*) AS count FROM memory_confidence WHERE is_archived = 0").get().count;
    const archivedCount = db.prepare("SELECT COUNT(*) AS count FROM memory_confidence WHERE is_archived = 1").get().count;
    const recentEvents = db.prepare("SELECT * FROM memory_events ORDER BY id DESC LIMIT 12").all().map(eventRow);
    return { eventCounts, memoryCount, activeCount, archivedCount, recentEvents };
  }, { readonly: true });
}
