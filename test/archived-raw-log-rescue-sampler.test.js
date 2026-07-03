import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  selectActiveSamplerSamples,
} = require("../lib/annotation/archived-raw-log-rescue-sampler.cjs");

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sample(id, overrides = {}) {
  return {
    sample_id: `rescue:${id}`,
    chunk_id: id,
    path: "memory/smart-add/2026-06-01.md",
    primary_bucket: "archived_raw_log_project",
    risk_score: 50,
    risk_signals: ["project:memory-engine"],
    quality_flags: ["archived_raw_log", "raw_log_leak"],
    signal_polarity: {
      positive_evidence: [],
      negative_evidence: [],
    },
    ...overrides,
  };
}

test("active sampler combines conflict, transient, bucket diversity, and boundary selections", () => {
  const input = [
    sample("conflict", {
      primary_bucket: "archived_raw_log_project",
      risk_score: 95,
      risk_signals: [
        "project:memory-engine",
        "engineering_evidence_signal",
        "transient_runtime_noise_signal",
      ],
      signal_polarity: {
        positive_evidence: ["engineering_evidence_signal"],
        negative_evidence: ["transient_runtime_noise_signal"],
      },
    }),
    sample("transient", {
      primary_bucket: "archived_raw_log_transient",
      risk_score: 90,
      risk_signals: ["project:openclaw", "transient_runtime_noise_signal"],
      signal_polarity: {
        positive_evidence: [],
        negative_evidence: ["transient_runtime_noise_signal"],
      },
    }),
    sample("decision", {
      primary_bucket: "archived_raw_log_decision",
      risk_score: 80,
      risk_signals: ["project:memory-engine", "decision_signal"],
    }),
    sample("preference", {
      primary_bucket: "archived_raw_log_preference",
      risk_score: 70,
      risk_signals: ["project:memory-engine", "preference_signal"],
    }),
    sample("todo", {
      primary_bucket: "archived_raw_log_todo",
      risk_score: 60,
      risk_signals: ["project:memory-engine", "todo_signal"],
    }),
    sample("keyword", {
      primary_bucket: "archived_raw_log_keyword",
      risk_score: 40,
      risk_signals: ["project:memory-engine", "decision_signal", "preference_signal"],
    }),
    sample("boundary-a", {
      primary_bucket: "archived_raw_log_project",
      risk_score: 55,
      risk_signals: ["project:memory-engine", "decision_signal"],
    }),
    sample("boundary-b", {
      primary_bucket: "archived_raw_log_project",
      risk_score: 54,
      risk_signals: ["project:memory-engine", "decision_signal"],
    }),
  ];

  const result = selectActiveSamplerSamples(input, { limit: 8, threshold: 55 });

  assert.equal(result.mode, "v0.4_active_sampler_diversity_mvp");
  assert.equal(result.selected_count, 8);
  assert.equal(new Set(result.selected.map(s => s.sample_id)).size, 8);
  assert.ok(result.summary.selection_reason_distribution.positive_negative_conflict >= 1);
  assert.ok(result.summary.selection_reason_distribution.transient_sanity_check >= 1);
  assert.ok(result.summary.selection_reason_distribution.bucket_diversity >= 1);
  assert.ok(result.summary.selection_reason_distribution.boundary >= 1);
  assert.ok(result.summary.selected_bucket_distribution.archived_raw_log_transient >= 1);
  assert.ok(Object.keys(result.summary.selected_bucket_distribution).length >= 5);
});

test("sampler exposes positive and negative evidence pool counts", () => {
  const result = selectActiveSamplerSamples([
    sample("positive", {
      risk_signals: ["project:memory-engine", "engineering_evidence_signal"],
      signal_polarity: {
        positive_evidence: ["engineering_evidence_signal"],
        negative_evidence: [],
      },
    }),
    sample("negative", {
      primary_bucket: "archived_raw_log_transient",
      risk_signals: ["project:openclaw", "transient_runtime_noise_signal"],
      signal_polarity: {
        positive_evidence: [],
        negative_evidence: ["transient_runtime_noise_signal"],
      },
    }),
  ], { limit: 2 });

  assert.equal(result.summary.positive_evidence_count, 1);
  assert.equal(result.summary.negative_evidence_count, 1);
  assert.equal(result.summary.transient_pool_count, 1);
});

test("CLI accepts --input path and emits diversity sampler summary", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "archived-rescue-sampler-"));
  const inputPath = resolve(dir, "candidates.jsonl");
  const rows = [
    sample("conflict", {
      risk_signals: ["project:memory-engine", "engineering_evidence_signal", "transient_runtime_noise_signal"],
      signal_polarity: {
        positive_evidence: ["engineering_evidence_signal"],
        negative_evidence: ["transient_runtime_noise_signal"],
      },
    }),
    sample("transient", {
      primary_bucket: "archived_raw_log_transient",
      risk_signals: ["project:openclaw", "transient_runtime_noise_signal"],
      signal_polarity: {
        positive_evidence: [],
        negative_evidence: ["transient_runtime_noise_signal"],
      },
    }),
    sample("decision", {
      primary_bucket: "archived_raw_log_decision",
      risk_signals: ["project:memory-engine", "decision_signal"],
    }),
  ];
  writeFileSync(inputPath, `${rows.map(row => JSON.stringify(row)).join("\n")}\n`, "utf8");

  const result = spawnSync(
    process.execPath,
    [resolve(repoRoot, "bin/v4-active-sampler.cjs"), "--input", inputPath, "--limit", "3"],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.input, inputPath);
  assert.equal(parsed.mode, "v0.4_active_sampler_diversity_mvp");
  assert.equal(parsed.selected_count, 3);
  assert.ok(parsed.summary.conflict_pool_count >= 1);
});
