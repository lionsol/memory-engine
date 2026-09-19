#!/usr/bin/env node
const { DatabaseSync } = require("node:sqlite");
const { resolve } = require("node:path");

const Q6_SCHEMA = "memory_engine_q6_shadow_autorecall_decision_v1";
const Q6_DEBUG_TYPE = "q6_shadow_decision";

function usage() {
  return `Q6 shadow runtime evidence (read-only)

Usage:
  node bin/q6-shadow-runtime-evidence.js \
    --db <engine.sqlite> \
    --since-id <integer> \
    --session-id <exact-runtime-session-id> \
    [--session-id <additional-runtime-session-id>] \
    [--turns-sent <0..6>] \
    [--json]

Reads memory_events only. No database writes are performed.
`;
}

function parseArgs(argv) {
  const out = { json: false, turnsSent: 0, sessionIds: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    const value = argv[i + 1];
    if (!value) throw new Error(`missing value for ${arg}`);
    if (arg === "--db") out.db = value;
    else if (arg === "--since-id") out.sinceId = Number(value);
    else if (arg === "--session-id") out.sessionIds.push(value);
    else if (arg === "--turns-sent") out.turnsSent = Number(value);
    else throw new Error(`unknown argument: ${arg}`);
    i += 1;
  }
  if (!out.db) throw new Error("--db is required");
  if (!Number.isSafeInteger(out.sinceId) || out.sinceId < 0) {
    throw new Error("--since-id must be a non-negative integer");
  }
  if (
    out.sessionIds.length === 0 ||
    out.sessionIds.some(value => typeof value !== "string" || !value.trim())
  ) {
    throw new Error("--session-id is required");
  }
  if (!Number.isSafeInteger(out.turnsSent) || out.turnsSent < 0 || out.turnsSent > 6) {
    throw new Error("--turns-sent must be an integer from 0 to 6");
  }
  out.sessionIds = [...new Set(out.sessionIds.map(value => value.trim()))];
  out.sessionId = out.sessionIds[0];
  out.db = resolve(out.db);
  return out;
}

function parseMetadata(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isQ6Envelope(metadata) {
  return metadata?.schema === Q6_SCHEMA && metadata?.debug_type === Q6_DEBUG_TYPE;
}

function finiteNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function median(sorted) {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentileNearestRank(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[Math.min(sorted.length - 1, rank - 1)];
}

function timingSummary(values) {
  const sorted = values.filter(finiteNonNegativeInteger).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { count: 0, min: null, median: null, p95: null, max: null };
  }
  return {
    count: sorted.length,
    min: sorted[0],
    median: median(sorted),
    p95: percentileNearestRank(sorted, 0.95),
    max: sorted[sorted.length - 1],
  };
}

function histogram(values) {
  const map = new Map();
  for (const value of values) {
    const key = String(value);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Object.fromEntries([...map.entries()].sort((a, b) => Number(a[0]) - Number(b[0])));
}

const ROOT_KEYS = new Set([
  "schema",
  "debug_type",
  "mode",
  "shadow_status",
  "apply_suppressed",
  "runtime_gate_allowed",
  "runtime_gate_reason",
  "structural_skip_reason",
  "search_executed",
  "focused_query_used",
  "original_input_chars",
  "focused_query_chars",
  "candidate_count",
  "candidate_count_after_gate",
  "direct_card_selected_count",
  "would_inject_count",
  "would_inject_ids",
  "candidate_decisions",
  "timings",
]);

const CANDIDATE_KEYS = new Set([
  "rank",
  "memory_id",
  "category",
  "final_score",
  "gate_pass",
  "gate_reason",
  "capability",
  "capability_reason",
  "selection_decision",
  "selection_reason",
  "would_inject",
]);

const TIMING_KEYS = new Set(["retrieval_ms", "decision_ms", "total_ms"]);

function unknownKeys(object, allowed) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return ["<not_object>"];
  return Object.keys(object).filter(key => !allowed.has(key));
}

function validateEnvelope(event, boundSessionIds) {
  const envelope = event.metadata;
  const violations = [];
  const prefix = `event:${event.id}`;

  for (const key of unknownKeys(envelope, ROOT_KEYS)) {
    violations.push(`${prefix}:unknown_root_key:${key}`);
  }
  if (envelope.mode !== "shadow") violations.push(`${prefix}:mode_not_shadow`);
  if (envelope.apply_suppressed !== true) violations.push(`${prefix}:apply_not_suppressed`);
  if (!boundSessionIds.has(event.session_id)) violations.push(`${prefix}:foreign_session`);

  const decisions = Array.isArray(envelope.candidate_decisions)
    ? envelope.candidate_decisions
    : [];
  if (decisions.length > 32) violations.push(`${prefix}:candidate_decision_overflow`);

  let wouldInject = 0;
  for (const [index, decision] of decisions.entries()) {
    for (const key of unknownKeys(decision, CANDIDATE_KEYS)) {
      violations.push(`${prefix}:candidate:${index}:unknown_key:${key}`);
    }
    if (
      decision?.memory_id !== null &&
      decision?.memory_id !== undefined &&
      (typeof decision.memory_id !== "string" || decision.memory_id.length > 16)
    ) {
      violations.push(`${prefix}:candidate:${index}:memory_id_invalid`);
    }
    if (decision?.would_inject === true) wouldInject += 1;
  }

  const wouldInjectIds = Array.isArray(envelope.would_inject_ids)
    ? envelope.would_inject_ids
    : [];
  if (wouldInjectIds.some(id => typeof id !== "string" || id.length > 16)) {
    violations.push(`${prefix}:would_inject_id_invalid`);
  }
  if (envelope.would_inject_count !== wouldInject) {
    violations.push(`${prefix}:would_inject_count_mismatch`);
  }
  if (envelope.direct_card_selected_count !== envelope.would_inject_count) {
    violations.push(`${prefix}:direct_card_selected_count_mismatch`);
  }

  const timings = envelope.timings;
  for (const key of unknownKeys(timings, TIMING_KEYS)) {
    violations.push(`${prefix}:timings_unknown_key:${key}`);
  }
  for (const key of TIMING_KEYS) {
    if (!finiteNonNegativeInteger(timings?.[key])) {
      violations.push(`${prefix}:timing_invalid:${key}`);
    }
  }
  return violations;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const db = new DatabaseSync(options.db, { readOnly: true });
  let rows;
  try {
    rows = db.prepare(`
      SELECT id, event_type, session_id, trace_id, memory_id, latency_ms,
             candidate_count, injected_count, source, metadata_json, created_at
      FROM memory_events
      WHERE id > ?
      ORDER BY id ASC
    `).all(options.sinceId);
  } finally {
    db.close();
  }

  const events = rows.map(row => ({
    ...row,
    metadata: parseMetadata(row.metadata_json),
  }));
  const q6Events = events
    .filter(event => event.event_type === "auto_recall_debug" && isQ6Envelope(event.metadata));
  const boundSessionIds = new Set(options.sessionIds);
  const boundQ6 = q6Events.filter(event => boundSessionIds.has(event.session_id));
  const foreignQ6 = q6Events.filter(event => !boundSessionIds.has(event.session_id));

  const violations = [];
  for (const event of boundQ6) violations.push(...validateEnvelope(event, boundSessionIds));
  for (const event of foreignQ6) violations.push(`event:${event.id}:foreign_q6_shadow_decision`);

  const traceIds = new Set(boundQ6.map(event => event.trace_id).filter(Boolean));
  const shadowTraceEvents = events.filter(event => traceIds.has(event.trace_id));
  const boundedDebugEvents = shadowTraceEvents.filter(
    event => event.event_type === "auto_recall_debug" &&
      !isQ6Envelope(event.metadata) &&
      event.metadata &&
      typeof event.metadata === "object",
  );

  const injectedOnShadow = shadowTraceEvents.filter(event => event.event_type === "memory_injected");
  const reinforcedOnShadow = shadowTraceEvents.filter(
    event => event.event_type === "memory_reinforced" && event.source === "autoRecall",
  );
  const completedOnShadow = shadowTraceEvents.filter(event => event.event_type === "recall_completed");

  for (const event of injectedOnShadow) violations.push(`event:${event.id}:memory_injected_on_shadow_trace`);
  for (const event of reinforcedOnShadow) violations.push(`event:${event.id}:memory_reinforced_on_shadow_trace`);
  for (const event of completedOnShadow) {
    if (Number(event.injected_count || 0) !== 0) {
      violations.push(`event:${event.id}:recall_completed_injected_nonzero`);
    }
  }

  const envelopes = boundQ6.map(event => event.metadata);
  const candidateCounts = envelopes.map(item => Number(item.candidate_count || 0));
  const gateCounts = envelopes.map(item => Number(item.candidate_count_after_gate || 0));
  const wouldInjectCounts = envelopes.map(item => Number(item.would_inject_count || 0));
  const retrievalTimings = envelopes.map(item => item.timings?.retrieval_ms);
  const decisionTimings = envelopes.map(item => item.timings?.decision_ms);
  const totalTimings = envelopes.map(item => item.timings?.total_ms);

  const withholdingReasons = new Map();
  for (const envelope of envelopes) {
    for (const decision of Array.isArray(envelope.candidate_decisions)
      ? envelope.candidate_decisions
      : []) {
      if (decision?.would_inject === true) continue;
      const reason =
        decision?.gate_reason ??
        decision?.capability_reason ??
        decision?.selection_reason ??
        "unspecified";
      withholdingReasons.set(reason, (withholdingReasons.get(reason) || 0) + 1);
    }
  }

  const directCardBoundaryErrors = new Map();
  for (const event of boundedDebugEvents) {
    const reason = event.metadata?.direct_card_boundary_error;
    if (typeof reason !== "string" || !reason.trim()) continue;
    const key = reason.trim().slice(0, 96);
    directCardBoundaryErrors.set(key, (directCardBoundaryErrors.get(key) || 0) + 1);
  }

  const report = {
    schema: "memory_engine_q6_shadow_autorecall_real_host_evidence_v1",
    mode: "read_only_post_baseline",
    session_id: options.sessionId,
    session_ids: options.sessionIds,
    since_event_id: options.sinceId,
    turns_sent: options.turnsSent,
    post_baseline_event_count: events.length,
    shadow_decisions: boundQ6.length,
    shadow_event_ids: boundQ6.map(event => event.id),
    structural_skips: envelopes.filter(item => item.search_executed !== true).length,
    search_executed: envelopes.filter(item => item.search_executed === true).length,
    candidate_count_distribution: histogram(candidateCounts),
    candidate_count_after_gate_distribution: histogram(gateCounts),
    would_inject_count_distribution: histogram(wouldInjectCounts),
    would_inject_turns: envelopes.filter(item => Number(item.would_inject_count || 0) > 0).length,
    no_injection_turns: envelopes.filter(item => Number(item.would_inject_count || 0) === 0).length,
    direct_card_withholding_reason_counts: Object.fromEntries(
      [...withholdingReasons.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    ),
    direct_card_boundary_error_counts: Object.fromEntries(
      [...directCardBoundaryErrors.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    ),
    latency_ms: {
      retrieval: timingSummary(retrievalTimings),
      decision: timingSummary(decisionTimings),
      total: timingSummary(totalTimings),
    },
    shadow_status_counts: Object.fromEntries(
      [...envelopes.reduce((map, item) => {
        const key = String(item.shadow_status || "unknown");
        map.set(key, (map.get(key) || 0) + 1);
        return map;
      }, new Map()).entries()].sort((a, b) => a[0].localeCompare(b[0])),
    ),
    foreign_q6_shadow_decision_count: foreignQ6.length,
    memory_injected_on_shadow_trace_count: injectedOnShadow.length,
    memory_reinforced_on_shadow_trace_count: reinforcedOnShadow.length,
    recall_completed_on_shadow_trace_count: completedOnShadow.length,
    violations,
    mechanism_pass: boundQ6.length > 0 && violations.length === 0,
    limitations: [
      "natural-turn sample is bounded to at most six turns",
      "results are descriptive observations, not production prevalence estimates",
      "without independent labels this report does not estimate false-positive rate or precision/recall",
    ],
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `Q6 shadow evidence: decisions=${report.shadow_decisions} violations=${report.violations.length} mechanism_pass=${report.mechanism_pass}\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`q6-shadow-runtime-evidence: ${error?.message || error}\n`);
  process.exitCode = 1;
}
