import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  TURN_GOLD_SET_SEED_FREEZE,
  observeTurnGoldSetDataset,
} from "../lib/recall/auto-recall-dataset-observation.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seedPath = resolve(repoRoot, "test/fixtures/auto-recall-turn-gold-set.seed.jsonl");
const observeScriptPath = resolve(repoRoot, "bin/observe-turn-gold-set-dataset.js");
const replayScriptPath = resolve(repoRoot, "bin/run-turn-gold-set-replay.js");

function seedContent() {
  return readFileSync(seedPath, "utf8");
}

test("seed dataset freeze contract stays stable", () => {
  const report = observeTurnGoldSetDataset(seedContent(), {
    datasetName: "seed",
    frozen: TURN_GOLD_SET_SEED_FREEZE,
  });

  assert.equal(report.summary.observation_status, "stable");
  assert.equal(report.summary.total_count, 12);
  assert.equal(report.summary.valid_count, 12);
  assert.equal(report.summary.replay_failed_count, 0);
  assert.equal(report.summary.feedback_cluster_count, 0);
  assert.equal(report.summary.expansion_candidate_count, 0);
  assert.equal(report.summary.coverage_gap_count, 0);
  assert.equal(report.summary.freeze_passed, true);
  assert.equal(report.freeze_checks.every(check => check.pass), true);
});

test("seed dataset observation covers required intent and case families", () => {
  const report = observeTurnGoldSetDataset(seedContent(), {
    datasetName: "seed",
    frozen: TURN_GOLD_SET_SEED_FREEZE,
  });

  const taskCoverage = new Map(report.coverage.task_intents.map(item => [item.key, item.count]));
  const recallCoverage = new Map(report.coverage.recall_intents.map(item => [item.key, item.count]));
  const familyCoverage = new Map(report.coverage.case_families.map(item => [item.key, item.count]));

  for (const key of [
    "answer_question",
    "continue_prior_work",
    "review_plan",
    "debug_error",
    "summarize_current_text",
    "rewrite_current_text",
    "translate_current_text",
    "extract_structured_info",
    "write_artifact",
  ]) {
    assert.equal(taskCoverage.get(key) > 0, true, `missing task coverage: ${key}`);
  }

  for (const key of ["none", "project_state", "prior_decision", "task_state", "historical_context"]) {
    assert.equal(recallCoverage.get(key) > 0, true, `missing recall coverage: ${key}`);
  }

  for (const key of [
    "long_generic_skip",
    "long_debug_without_history_skip",
    "long_debug_with_history_recall",
    "long_project_review_focused_query",
    "short_continue_recall",
    "explicit_history_recall",
  ]) {
    assert.equal(familyCoverage.get(key) > 0, true, `missing case family: ${key}`);
  }
});

test("observation reports read-only side effects", () => {
  const report = observeTurnGoldSetDataset(seedContent(), {
    datasetName: "seed",
    frozen: TURN_GOLD_SET_SEED_FREEZE,
  });

  assert.equal(report.side_effects.db_writes, false);
  assert.equal(report.side_effects.memory_file_mutation, false);
  assert.equal(report.side_effects.dataset_file_mutation, false);
  assert.equal(report.side_effects.retrieval, false);
  assert.equal(report.side_effects.injection, false);
  assert.equal(report.side_effects.reinforce, false);
  assert.equal(report.side_effects.llm, false);
  assert.equal(report.side_effects.network, false);
  assert.equal(report.side_effects.runtime_report_files, false);
});

test("observation detects freeze drift and coverage gaps", () => {
  const oneRow = seedContent().split(/\r?\n/u).filter(Boolean)[0] + "\n";
  const report = observeTurnGoldSetDataset(oneRow, {
    datasetName: "tiny",
    frozen: TURN_GOLD_SET_SEED_FREEZE,
  });

  assert.equal(report.summary.observation_status, "needs_attention");
  assert.equal(report.summary.freeze_passed, false);
  assert.equal(report.summary.coverage_gap_count > 0, true);
  assert.equal(report.freeze_checks.some(check => check.key === "total_count" && check.pass === false), true);
  assert.equal(report.gaps.some(gap => gap.kind === "missing_case_family"), true);
});

test("replay CLI and observation CLI are executable in bin commonjs package scope", () => {
  const replay = spawnSync(process.execPath, [replayScriptPath, "--summary"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(replay.status, 0);
  assert.equal((replay.stderr || "").trim(), "");
  assert.match(replay.stdout, /replay_total: 12/);
  assert.match(replay.stdout, /expansion_candidates: 0/);

  const observation = spawnSync(process.execPath, [observeScriptPath, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(observation.status, 0);
  assert.equal((observation.stderr || "").trim(), "");
  const parsed = JSON.parse(observation.stdout);
  assert.equal(parsed.summary.observation_status, "stable");
  assert.equal(parsed.summary.freeze_passed, true);
});
