import { ensureMemoryEventsTable } from "./schema.js";

export function insertMemoryEvent(db, event, options = {}) {
  const defaultSource = Object.prototype.hasOwnProperty.call(options, "defaultSource")
    ? options.defaultSource
    : null;
  ensureMemoryEventsTable(db);
  db.prepare([
    "INSERT INTO memory_events",
    "(event_type, session_id, trace_id, memory_id, latency_ms, candidate_count, injected_count, cited_count, vector_score, fts_score, final_score, source, metadata_json)",
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ].join(" ")).run(
    event.event_type,
    event.session_id ?? null,
    event.trace_id ?? null,
    event.memory_id ?? null,
    event.latency_ms ?? null,
    event.candidate_count ?? null,
    event.injected_count ?? null,
    event.cited_count ?? null,
    event.vector_score ?? null,
    event.fts_score ?? null,
    event.final_score ?? null,
    event.source ?? defaultSource,
    event.metadata_json ? JSON.stringify(event.metadata_json) : null
  );
}
