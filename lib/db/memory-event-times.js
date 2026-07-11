import { createHash } from "node:crypto";

export const MEMORY_EVENT_TIMES_TABLE = "memory_event_times";
export const MEMORY_EVENT_TIME_WRITE_GUARD = "denied_by_default_write_guard";
export const MEMORY_EVENT_TIME_PRECISIONS = new Set(["exact", "date_only", "unknown"]);
export const MEMORY_EVENT_TIME_SOURCES = new Set([
  "session_transcript",
  "external_note",
  "manual_timestamp",
  "smart_add_path",
  "import_metadata",
  "unknown",
]);
export const MEMORY_EVENT_TIME_CONFIDENCES = new Set(["high", "medium", "low", "unknown"]);

export const MEMORY_EVENT_TIMES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memory_event_times (
  chunk_id TEXT PRIMARY KEY,
  event_at INTEGER,
  event_date TEXT,
  precision TEXT NOT NULL CHECK (precision IN ('exact', 'date_only', 'unknown')),
  source TEXT NOT NULL CHECK (source IN ('session_transcript', 'external_note', 'manual_timestamp', 'smart_add_path', 'import_metadata', 'unknown')),
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'unknown')),
  evidence_type TEXT,
  evidence_ref TEXT,
  evidence_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (event_at IS NULL OR typeof(event_at) = 'integer'),
  CHECK (precision != 'exact' OR event_at IS NOT NULL),
  CHECK (precision != 'date_only' OR (event_at IS NULL AND event_date IS NOT NULL)),
  CHECK (precision != 'unknown' OR (event_at IS NULL AND event_date IS NULL AND source = 'unknown'))
);
`;

function datePattern(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function eventDateFromUnixSeconds(eventAt, timeZone = "Asia/Shanghai") {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(eventAt * 1000)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function error(name, detail) {
  return `${name}${detail ? `:${detail}` : ""}`;
}

export function validateMemoryEventTime(record = {}, options = {}) {
  const errors = [];
  const precision = String(record.precision || "");
  const source = String(record.source || "");
  const confidence = String(record.confidence || "");
  const evidenceType = record.evidence_type == null ? null : String(record.evidence_type);
  const hasEvidenceRef = Boolean(String(record.evidence_ref || "").trim());
  const eventAt = record.event_at === null || record.event_at === undefined || record.event_at === "" ? null : record.event_at;
  const eventDate = record.event_date === null || record.event_date === undefined || record.event_date === "" ? null : String(record.event_date);

  if (!String(record.chunk_id || "").trim()) errors.push(error("chunk_id"));
  if (!MEMORY_EVENT_TIME_PRECISIONS.has(precision)) errors.push(error("precision"));
  if (!MEMORY_EVENT_TIME_SOURCES.has(source)) errors.push(error("source"));
  if (!MEMORY_EVENT_TIME_CONFIDENCES.has(confidence)) errors.push(error("confidence"));
  if (eventDate !== null && !datePattern(eventDate)) errors.push(error("event_date_format"));

  let normalizedEventAt = null;
  if (eventAt !== null) {
    const numeric = typeof eventAt === "number" ? eventAt : String(eventAt).trim();
    if ((typeof numeric !== "number" && !/^\d+$/.test(numeric)) || !Number.isSafeInteger(Number(numeric)) || Number(numeric) > 100000000000) {
      errors.push(error("event_at_unix_seconds"));
    } else {
      normalizedEventAt = Number(numeric);
    }
  }

  if (precision === "exact") {
    if (normalizedEventAt === null) errors.push(error("exact_requires_event_at"));
    if (["smart_add_path", "import_metadata", "unknown"].includes(source)) errors.push(error("exact_source_not_event_evidence"));
    if (normalizedEventAt !== null) {
      const derivedDate = eventDateFromUnixSeconds(normalizedEventAt, options.timeZone);
      if (eventDate !== null && eventDate !== derivedDate) errors.push(error("event_date_mismatch"));
      if (confidence === "high" && !String(record.evidence_ref || "").trim()) errors.push(error("high_confidence_requires_evidence_ref"));
    }
  } else if (precision === "date_only") {
    if (normalizedEventAt !== null) errors.push(error("date_only_event_at_forbidden"));
    if (eventDate === null) errors.push(error("date_only_requires_event_date"));
  } else if (precision === "unknown") {
    if (normalizedEventAt !== null || eventDate !== null) errors.push(error("unknown_time_forbidden"));
    if (source !== "unknown") errors.push(error("unknown_source_required"));
    if (hasEvidenceRef && evidenceType !== "rejected_source") errors.push(error("unknown_evidence_ref_requires_rejected_source_type"));
  }

  if (evidenceType === "rejected_source") {
    if (precision !== "unknown") errors.push(error("rejected_source_requires_unknown_precision"));
    if (source !== "unknown") errors.push(error("rejected_source_requires_unknown_source"));
    if (normalizedEventAt !== null || eventDate !== null) errors.push(error("rejected_source_time_forbidden"));
  }

  return { valid: errors.length === 0, errors, normalized_event_at: normalizedEventAt };
}

export function normalizeMemoryEventTime(record = {}, options = {}) {
  const normalized = {
    chunk_id: String(record.chunk_id || "").trim(),
    event_at: record.event_at === null || record.event_at === undefined || record.event_at === "" ? null : Number(record.event_at),
    event_date: record.event_date === null || record.event_date === undefined || record.event_date === "" ? null : String(record.event_date).trim(),
    precision: String(record.precision || "").trim(),
    source: String(record.source || "").trim(),
    confidence: String(record.confidence || "").trim(),
    evidence_type: record.evidence_type == null ? null : String(record.evidence_type),
    evidence_ref: record.evidence_ref == null ? null : String(record.evidence_ref),
    evidence_hash: record.evidence_hash == null ? null : String(record.evidence_hash),
    created_at: record.created_at == null ? null : Number(record.created_at),
    updated_at: record.updated_at == null ? null : Number(record.updated_at),
  };
  if (normalized.precision === "exact" && normalized.event_at !== null && normalized.event_date === null) {
    normalized.event_date = eventDateFromUnixSeconds(normalized.event_at, options.timeZone);
  }
  if (normalized.evidence_ref && !normalized.evidence_hash) normalized.evidence_hash = createHash("sha256").update(normalized.evidence_ref).digest("hex");
  return normalized;
}

export function createMemoryEventTimesTable(db) {
  db.exec(MEMORY_EVENT_TIMES_SCHEMA_SQL);
  return inspectMemoryEventTimesSchema(db);
}

export function inspectMemoryEventTimesSchema(db) {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(MEMORY_EVENT_TIMES_TABLE);
  const columns = table ? db.prepare(`PRAGMA table_info(${MEMORY_EVENT_TIMES_TABLE})`).all().map((row) => ({ name: row.name, type: row.type, notnull: row.notnull, pk: row.pk })) : [];
  const indexes = table ? db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%'").all(MEMORY_EVENT_TIMES_TABLE) : [];
  return { table: MEMORY_EVENT_TIMES_TABLE, exists: Boolean(table), columns, indexes };
}

export function getMemoryEventTime(db, chunkId) {
  return db.prepare(`SELECT * FROM ${MEMORY_EVENT_TIMES_TABLE} WHERE chunk_id = ?`).get(String(chunkId || "")) || null;
}

export function listMemoryEventTimes(db, options = {}) {
  const where = [];
  const params = {};
  if (options.precision) { where.push("precision = @precision"); params.precision = options.precision; }
  if (options.source) { where.push("source = @source"); params.source = options.source; }
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? ` LIMIT ${options.limit}` : "";
  return db.prepare(`SELECT * FROM ${MEMORY_EVENT_TIMES_TABLE}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY chunk_id ASC${limit}`).all(params);
}

export function upsertMemoryEventTime(db, record, options = {}) {
  if (options.allowWrite !== true) throw new Error(MEMORY_EVENT_TIME_WRITE_GUARD);
  const normalized = normalizeMemoryEventTime(record, options);
  const validation = validateMemoryEventTime(normalized, options);
  if (!validation.valid) throw new Error(`invalid_memory_event_time:${validation.errors.join(",")}`);
  const now = Number.isSafeInteger(options.nowSec) ? options.nowSec : Math.floor(Date.now() / 1000);
  const createdAt = normalized.created_at ?? now;
  const updatedAt = normalized.updated_at ?? now;
  db.prepare(`
    INSERT INTO ${MEMORY_EVENT_TIMES_TABLE}
      (chunk_id,event_at,event_date,precision,source,confidence,evidence_type,evidence_ref,evidence_hash,created_at,updated_at)
    VALUES (@chunk_id,@event_at,@event_date,@precision,@source,@confidence,@evidence_type,@evidence_ref,@evidence_hash,@created_at,@updated_at)
    ON CONFLICT(chunk_id) DO UPDATE SET
      event_at=excluded.event_at,event_date=excluded.event_date,precision=excluded.precision,
      source=excluded.source,confidence=excluded.confidence,evidence_type=excluded.evidence_type,
      evidence_ref=excluded.evidence_ref,evidence_hash=excluded.evidence_hash,updated_at=excluded.updated_at
  `).run({ ...normalized, created_at: createdAt, updated_at: updatedAt });
  return getMemoryEventTime(db, normalized.chunk_id);
}

export function resolveEffectiveEventTime({ sidecar = null, coreChunk = null } = {}, options = {}) {
  if (sidecar?.precision === "exact") return { precision: "exact", event_at: sidecar.event_at, event_date: sidecar.event_date, source: sidecar.source, fallback_used: false };
  if (sidecar?.precision === "date_only") return { precision: "date_only", event_at: null, event_date: sidecar.event_date, source: sidecar.source, fallback_used: false };
  return { precision: "unknown", event_at: null, event_date: null, source: "unknown", fallback_used: false };
}
