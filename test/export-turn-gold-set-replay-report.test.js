import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { readReportFile } from "../console/services/reports-service.js";

const require = createRequire(import.meta.url);
const exporter = require("../bin/export-turn-gold-set-replay-report.js");

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scriptPath = resolve(repoRoot, "bin/export-turn-gold-set-replay-report.js");

function tempReportsDir() {
  return mkdtempSync(join(tmpdir(), "memory-engine-turn-gold-reports-"));
}

test("parseArgs defaults to dry-run and validates timestamps", () => {
  assert.deepEqual(exporter.parseArgs([]), {
    dataset: exporter.DEFAULT_DATASET,
    reportsDir: null,
    timestamp: null,
    writeReport: false,
    confirmWriteReport: "",
    json: true,
    help: false,
  });

  assert.equal(exporter.reportNameForTimestamp("20260702-101010"), "auto-recall-turn-gold-set-replay-20260702-101010.json");
  assert.equal(exporter.validateTimestamp("20260702-101010"), "20260702-101010");
  assert.throws(() => exporter.validateTimestamp("2026-07-02"), /YYYYMMDD-HHMMSS/);
});

test("dry-run export builds replay report without writing a file", async () => {
  const reportsDir = tempReportsDir();
  try {
    const result = await exporter.buildExport({
      ...exporter.parseArgs(["--reports-dir", reportsDir, "--timestamp", "20260702-101010"]),
    });

    assert.equal(result.summary.dry_run, true);
    assert.equal(result.summary.write_requested, false);
    assert.equal(result.summary.wrote_report, false);
    assert.equal(result.summary.report_name, "auto-recall-turn-gold-set-replay-20260702-101010.json");
    assert.equal(result.summary.replay_total, 12);
    assert.equal(result.summary.replay_failed, 0);
    assert.equal(result.summary.replay_invalid, 0);
    assert.equal(result.summary.card_projection_count, 5);
    assert.equal(result.summary.side_effects.runtime_report_files, false);
    assert.equal(result._can_write, false);
    assert.equal(existsSync(join(reportsDir, result.summary.report_name)), false);
  } finally {
    rmSync(reportsDir, { recursive: true, force: true });
  }
});

test("write-report requires explicit confirm token and does not write without it", async () => {
  const reportsDir = tempReportsDir();
  try {
    const result = await exporter.buildExport({
      ...exporter.parseArgs(["--reports-dir", reportsDir, "--timestamp", "20260702-111111", "--write-report"]),
    });

    assert.equal(result.summary.write_requested, true);
    assert.equal(result.summary.wrote_report, false);
    assert.equal(result.summary.errors.includes("missing_or_invalid_confirm_write_report_token"), true);
    assert.equal(result.summary.side_effects.runtime_report_files, false);
    assert.equal(result._can_write, false);
    assert.equal(existsSync(join(reportsDir, result.summary.report_name)), false);
  } finally {
    rmSync(reportsDir, { recursive: true, force: true });
  }
});

test("confirmed write creates an allowlisted Console replay report", async () => {
  const reportsDir = tempReportsDir();
  const previousReportsDir = process.env.MEMORY_ENGINE_REPORTS_DIR;
  process.env.MEMORY_ENGINE_REPORTS_DIR = reportsDir;
  try {
    const run = spawnSync(process.execPath, [
      scriptPath,
      "--reports-dir", reportsDir,
      "--timestamp", "20260702-121212",
      "--write-report",
      "--confirm-write-report", exporter.CONFIRM_TOKEN,
    ], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    assert.equal(run.status, 0);
    assert.equal((run.stderr || "").trim(), "");
    const output = JSON.parse(run.stdout);
    assert.equal(output.summary.wrote_report, true);
    assert.equal(output.summary.side_effects.runtime_report_files, true);

    const reportPath = join(reportsDir, "auto-recall-turn-gold-set-replay-20260702-121212.json");
    assert.equal(existsSync(reportPath), true);
    const written = JSON.parse(readFileSync(reportPath, "utf8"));
    assert.equal(written.kind, "auto_recall_turn_gold_set_replay");
    assert.equal(written.replay.summary.card_projection_count, 5);

    const file = readReportFile("auto-recall-turn-gold-set-replay-20260702-121212.json");
    assert.equal(file.kind, "auto_recall_turn_gold_set_replay");
    assert.equal(file.memory_card_preview.summary.mode, "read_only_memory_card_preview");
    assert.equal(file.memory_card_preview.summary.card_projection_count, 5);
    assert.equal(file.memory_card_preview.cards.length, 5);
    assert.equal(file.memory_card_preview.cards[0].get_token.startsWith("memory_engine_get:"), true);
  } finally {
    if (previousReportsDir === undefined) delete process.env.MEMORY_ENGINE_REPORTS_DIR;
    else process.env.MEMORY_ENGINE_REPORTS_DIR = previousReportsDir;
    rmSync(reportsDir, { recursive: true, force: true });
  }
});

test("CLI dry-run exits zero with clean stderr", () => {
  const reportsDir = tempReportsDir();
  try {
    const run = spawnSync(process.execPath, [
      scriptPath,
      "--reports-dir", reportsDir,
      "--timestamp", "20260702-131313",
    ], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    assert.equal(run.status, 0);
    assert.equal((run.stderr || "").trim(), "");
    const output = JSON.parse(run.stdout);
    assert.equal(output.summary.dry_run, true);
    assert.equal(output.summary.wrote_report, false);
    assert.equal(output.summary.side_effects.runtime_report_files, false);
  } finally {
    rmSync(reportsDir, { recursive: true, force: true });
  }
});
