import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  auditProductionEvidenceContinuity,
  exitCodeForStatus,
  parseArgs,
} from "../bin/audit-production-evidence-continuity.js";

const identity = {
  production_evidence_enabled: true,
  evidence_epoch_id: "epoch-1",
  runtime_build_identity: "a".repeat(64),
  rollout_config_fingerprint: "b".repeat(64),
};

function row(surface, origin) {
  const evidence = origin === "natural_user_turn"
    ? {
      source: "before_prompt_build",
      agent_id_present: true,
      run_id_present: true,
      session_id_present: true,
      tool_call_id_present: false,
      trigger: "user",
    }
    : {
      source: "before_tool_call_agent",
      agent_id_present: true,
      run_id_present: true,
      session_id_present: true,
      tool_call_id_present: true,
      trigger: null,
    };
  return {
    event_type: "hybrid_search_observation",
    source: `hybrid.${surface}`,
    trace_id: `${surface}-trace`,
    session_id: surface === "auto_recall" ? "session-1" : null,
    metadata_json: {
      schema_version: 1,
      surface,
      search_executed: true,
      completed_at: "2026-07-01T00:00:00.000Z",
      traffic_origin: origin,
      traffic_origin_schema_version: 1,
      traffic_origin_evidence: evidence,
      traffic_origin_valid: true,
      traffic_origin_reasons: [],
      ...identity,
    },
  };
}

function reportRows() {
  return [
    row("auto_recall", "natural_user_turn"),
    row("memory_engine_search", "natural_agent_tool_call"),
    row("memory_engine_action_search", "natural_agent_tool_call"),
  ];
}

function writeFixture(name, content) {
  const root = mkdtempSync(resolve(tmpdir(), "continuity-cli-"));
  const path = resolve(root, name);
  writeFileSync(path, content);
  return path;
}

test("CLI parses JSON, JSONL, pretty, and threshold overrides", () => {
  const options = parseArgs([
    "--observations", "observations.jsonl",
    "--pretty",
    "--minimum-window-days", "2",
    "--maximum-observation-gap-hours", "48",
  ]);
  assert.equal(options.pretty, true);
  assert.equal(options.thresholds.minimum_window_days, 2);
  assert.equal(options.thresholds.maximum_observation_gap_hours, 48);
});

test("CLI maps continuity statuses to stable exit codes", () => {
  assert.equal(exitCodeForStatus("continuity_ready"), 0);
  assert.equal(exitCodeForStatus("continuity_collecting"), 1);
  assert.equal(exitCodeForStatus("continuity_incomplete"), 1);
  assert.equal(exitCodeForStatus("blocked"), 2);
});

test("CLI returns ready for a synthetic complete three-surface report", async () => {
  const path = writeFixture("observations.json", JSON.stringify(reportRows()));
  const result = await auditProductionEvidenceContinuity([
    "--observations", path,
    "--minimum-window-days", "0",
    "--minimum-active-utc-days", "1",
    "--minimum-active-day-ratio", "0",
    "--maximum-observation-gap-hours", "72",
    "--minimum-observations", "3",
    "--minimum-surface-observations", "1",
    "--minimum-surface-active-days", "1",
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.status, "continuity_ready");
});

test("CLI accepts JSONL and distinguishes blocked input evidence", async () => {
  const path = writeFixture("observations.jsonl", `${JSON.stringify(row("memory_engine_search", "unknown"))}\n`);
  const result = await auditProductionEvidenceContinuity(["--observations", path]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.report.status, "blocked");
});

test("CLI rejects unknown flags, invalid numbers, and malformed JSON with usage code", async () => {
  assert.throws(() => parseArgs(["--unknown"]));
  assert.throws(() => parseArgs(["--minimum-window-days", "nope"]));
  const path = writeFixture("bad.json", "not-json");
  await assert.rejects(() => auditProductionEvidenceContinuity(["--observations", path]));
});

test("CLI rejects primitive and invalid threshold JSON before merging overrides", async () => {
  for (const value of [null, 5, true, [], { minimum_active_day_ratio: 1.2 }, { minimum_observations: 1.5 }, { unknown_threshold: 1 }]) {
    const path = writeFixture("thresholds.json", JSON.stringify(value));
    await assert.rejects(
      () => auditProductionEvidenceContinuity([
        "--observations", writeFixture("observations.json", JSON.stringify(reportRows())),
        "--thresholds", path,
      ]),
      /invalid_thresholds|invalid_threshold|unknown_threshold/,
    );
  }
});
