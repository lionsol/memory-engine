import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CLI = join(ROOT, "bin/q6-shadow-runtime-evidence.js");

function makeDb() {
  const dir = mkdtempSync(join(tmpdir(), "q6-shadow-evidence-"));
  const dbPath = join(dir, "engine.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE memory_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      session_id TEXT,
      trace_id TEXT,
      memory_id TEXT,
      latency_ms INTEGER,
      candidate_count INTEGER,
      injected_count INTEGER,
      source TEXT,
      metadata_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  return { dir, dbPath, db };
}

function insert(db, event) {
  db.prepare(`
    INSERT INTO memory_events
      (event_type, session_id, trace_id, memory_id, latency_ms, candidate_count,
       injected_count, source, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.event_type,
    event.session_id ?? null,
    event.trace_id ?? null,
    event.memory_id ?? null,
    event.latency_ms ?? null,
    event.candidate_count ?? null,
    event.injected_count ?? null,
    event.source ?? null,
    event.metadata_json ? JSON.stringify(event.metadata_json) : null,
  );
}

function q6Envelope(overrides = {}) {
  return {
    schema: "memory_engine_q6_shadow_autorecall_decision_v1",
    debug_type: "q6_shadow_decision",
    mode: "shadow",
    shadow_status: "would_inject",
    apply_suppressed: true,
    runtime_gate_allowed: true,
    runtime_gate_reason: "allowed",
    structural_skip_reason: null,
    search_executed: true,
    focused_query_used: false,
    original_input_chars: 20,
    focused_query_chars: 20,
    candidate_count: 2,
    candidate_count_after_gate: 1,
    direct_card_selected_count: 1,
    would_inject_count: 1,
    would_inject_ids: ["abcdef1234567890"],
    candidate_decisions: [{
      rank: 1,
      memory_id: "abcdef1234567890",
      category: "episodic",
      final_score: 0.8,
      gate_pass: true,
      gate_reason: null,
      capability: "CARD_DISCLOSABLE",
      capability_reason: "card_allowed",
      selection_decision: "DISCLOSE_CARD",
      selection_reason: "card_capability_and_retrieval_evidence_pass",
      would_inject: true,
    }, {
      rank: 2,
      memory_id: "fedcba0987654321",
      category: "raw_log",
      final_score: 0.1,
      gate_pass: false,
      gate_reason: "raw_log_final_score_below_minimum",
      capability: null,
      capability_reason: null,
      selection_decision: null,
      selection_reason: null,
      would_inject: false,
    }],
    timings: {
      retrieval_ms: 120,
      decision_ms: 8,
      total_ms: 135,
    },
    ...overrides,
  };
}

function runCli(dbPath, sessionId, turnsSent = 1) {
  const result = spawnSync(
    process.execPath,
    [
      CLI,
      "--db", dbPath,
      "--since-id", "0",
      "--session-id", sessionId,
      "--turns-sent", String(turnsSent),
      "--json",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("Q6-D evidence CLI reports bounded passing shadow traces", () => {
  const fixture = makeDb();
  try {
    insert(fixture.db, {
      event_type: "auto_recall_debug",
      session_id: "q6-session",
      trace_id: "trace-1",
      source: "autoRecall",
      metadata_json: q6Envelope(),
    });
    insert(fixture.db, {
      event_type: "auto_recall_debug",
      session_id: "q6-session",
      trace_id: "trace-1",
      source: "autoRecall",
      metadata_json: {
        direct_card_boundary_error: null,
      },
    });
    insert(fixture.db, {
      event_type: "recall_completed",
      session_id: "q6-session",
      trace_id: "trace-1",
      candidate_count: 2,
      injected_count: 0,
      source: "autoRecall",
      metadata_json: { injected_count: 0 },
    });
    fixture.db.close();

    const report = runCli(fixture.dbPath, "q6-session");
    assert.equal(report.shadow_decisions, 1);
    assert.equal(report.mechanism_pass, true);
    assert.deepEqual(report.violations, []);
    assert.deepEqual(report.candidate_count_distribution, { "2": 1 });
    assert.deepEqual(report.candidate_count_after_gate_distribution, { "1": 1 });
    assert.deepEqual(report.would_inject_count_distribution, { "1": 1 });
    assert.equal(report.would_inject_turns, 1);
    assert.equal(report.no_injection_turns, 0);
    assert.deepEqual(report.latency_ms.retrieval, {
      count: 1,
      min: 120,
      median: 120,
      p95: 120,
      max: 120,
    });
    assert.equal(
      report.direct_card_withholding_reason_counts.raw_log_final_score_below_minimum,
      1,
    );
    assert.deepEqual(report.direct_card_boundary_error_counts, {});
  } finally {
    try { fixture.db.close(); } catch {}
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("Q6-D evidence CLI fails mechanism on foreign scope or apply-side effects", () => {
  const fixture = makeDb();
  try {
    insert(fixture.db, {
      event_type: "auto_recall_debug",
      session_id: "q6-session",
      trace_id: "trace-1",
      source: "autoRecall",
      metadata_json: q6Envelope(),
    });
    insert(fixture.db, {
      event_type: "auto_recall_debug",
      session_id: "q6-session",
      trace_id: "trace-1",
      source: "autoRecall",
      metadata_json: {
        direct_card_boundary_error: "direct_card_boundary_error",
      },
    });
    insert(fixture.db, {
      event_type: "memory_injected",
      session_id: "q6-session",
      trace_id: "trace-1",
      memory_id: "abcdef1234567890",
      injected_count: 1,
      source: "autoRecall",
    });
    insert(fixture.db, {
      event_type: "recall_completed",
      session_id: "q6-session",
      trace_id: "trace-1",
      injected_count: 1,
      source: "autoRecall",
    });
    insert(fixture.db, {
      event_type: "auto_recall_debug",
      session_id: "other-session",
      trace_id: "trace-foreign",
      source: "autoRecall",
      metadata_json: q6Envelope({ would_inject_count: 0, direct_card_selected_count: 0, would_inject_ids: [], candidate_decisions: [] }),
    });
    fixture.db.close();

    const report = runCli(fixture.dbPath, "q6-session");
    assert.equal(report.mechanism_pass, false);
    assert.equal(report.foreign_q6_shadow_decision_count, 1);
    assert.equal(report.memory_injected_on_shadow_trace_count, 1);
    assert.deepEqual(report.direct_card_boundary_error_counts, {
      direct_card_boundary_error: 1,
    });
    assert.ok(report.violations.some(value => value.includes("foreign_q6_shadow_decision")));
    assert.ok(report.violations.some(value => value.includes("memory_injected_on_shadow_trace")));
    assert.ok(report.violations.some(value => value.includes("recall_completed_injected_nonzero")));
  } finally {
    try { fixture.db.close(); } catch {}
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("Q6-D evidence CLI rejects unbounded or unknown Q6 fields", () => {
  const fixture = makeDb();
  try {
    insert(fixture.db, {
      event_type: "auto_recall_debug",
      session_id: "q6-session",
      trace_id: "trace-1",
      source: "autoRecall",
      metadata_json: q6Envelope({
        prompt: "forbidden",
        timings: { retrieval_ms: 1, decision_ms: 2, total_ms: 3, extra: 4 },
      }),
    });
    fixture.db.close();

    const report = runCli(fixture.dbPath, "q6-session");
    assert.equal(report.mechanism_pass, false);
    assert.ok(report.violations.some(value => value.includes("unknown_root_key:prompt")));
    assert.ok(report.violations.some(value => value.includes("timings_unknown_key:extra")));
    assert.equal(JSON.stringify(report).includes("forbidden"), false);
  } finally {
    try { fixture.db.close(); } catch {}
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});
