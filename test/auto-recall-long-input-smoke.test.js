import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import longInputSmokeCli from "../bin/run-auto-recall-long-input-smoke.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = resolve(repoRoot, "bin/run-auto-recall-long-input-smoke.js");

const {
  parseArgs,
  runLongInputSmoke,
  main,
} = longInputSmokeCli;

async function captureConsole(fn) {
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => errors.push(args.join(" "));
  try {
    const result = await fn();
    return { result, output: logs.join("\n"), error: errors.join("\n") };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

test("long input smoke script exists", () => {
  assert.equal(existsSync(scriptPath), true);
});

test("parseArgs supports json and markdown output flags", () => {
  assert.deepEqual(parseArgs(["--json"]), {
    help: false,
    json: true,
    markdown: false,
  });
  assert.deepEqual(parseArgs(["--markdown"]), {
    help: false,
    json: false,
    markdown: true,
  });
  assert.throws(() => parseArgs(["--json", "--markdown"]), /choose exactly one output format/);
});

test("long input smoke is read-only by construction", () => {
  const source = readFileSync(scriptPath, "utf8");
  assert.equal(source.includes("runAutoRecall"), false);
  assert.equal(source.includes("hybridSearch"), false);
  assert.equal(source.includes("batchReinforce"), false);
  assert.equal(source.includes("execFileSync"), false);
});

test("long input smoke covers P2 gate and focused query cases", async () => {
  const report = await runLongInputSmoke();
  const ids = report.checks.map(check => check.id);

  assert.deepEqual(ids, [
    "long_rewrite_skips_recall",
    "long_summarize_skips_recall",
    "long_translate_skips_recall",
    "long_debug_without_history_skips_recall",
    "long_project_review_uses_focused_query",
    "long_debug_with_history_uses_focused_query",
  ]);
  assert.equal(report.summary.mode, "read_only_long_input_smoke");
  assert.equal(report.summary.check_count, 6);
  assert.equal(report.summary.status, "pass");
  assert.equal(report.summary.failed_count, 0);
  assert.equal(report.checks.every(check => check.pass), true);
});

test("long input smoke reports read-only side effects", async () => {
  const report = await runLongInputSmoke();

  assert.equal(report.side_effects.db_writes, false);
  assert.equal(report.side_effects.memory_file_mutation, false);
  assert.equal(report.side_effects.retrieval, false);
  assert.equal(report.side_effects.injection, false);
  assert.equal(report.side_effects.cleanup_apply, false);
  assert.equal(report.side_effects.archive, false);
  assert.equal(report.side_effects.quarantine, false);
  assert.equal(report.side_effects.reinforce, false);
  assert.equal(report.side_effects.llm, false);
  assert.equal(report.side_effects.network, false);
  assert.equal(report.side_effects.runtime_report_files, false);
});

test("focused query cases strip long body and keep task focus", async () => {
  const report = await runLongInputSmoke();
  const byId = new Map(report.checks.map(check => [check.id, check]));
  const projectReview = byId.get("long_project_review_uses_focused_query")?.details;
  const debugWithHistory = byId.get("long_debug_with_history_uses_focused_query")?.details;

  assert.equal(projectReview.should_recall, true);
  assert.equal(projectReview.intent_reason, "long_input_with_history_context_use_focused_query");
  assert.equal(projectReview.focused_query_chars < projectReview.original_input_chars, true);
  assert.match(projectReview.focused_query, /memory-engine/);
  assert.equal(projectReview.focused_query.includes("LOG_LINE keep this body out of focused query"), false);

  assert.equal(debugWithHistory.should_recall, true);
  assert.equal(debugWithHistory.intent_reason, "long_input_with_history_context_use_focused_query");
  assert.equal(debugWithHistory.focused_query_chars < debugWithHistory.original_input_chars, true);
  assert.match(debugWithHistory.focused_query, /memory-engine/);
  assert.equal(debugWithHistory.focused_query.includes("Traceback"), false);
  assert.equal(debugWithHistory.focused_query.includes("2026-07-01 10:00:00"), false);
});

test("CLI main returns zero and prints JSON by default", async () => {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.equal((result.stderr || "").trim(), "");
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.summary.status, "pass");
  assert.equal(parsed.summary.check_count, 6);
  assert.equal(parsed.summary.failed_count, 0);
});

test("CLI executable exits zero with clean stderr", () => {
  const result = spawnSync(process.execPath, [scriptPath, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.equal((result.stderr || "").trim(), "");
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.summary.status, "pass");
  assert.equal(parsed.summary.check_count, 6);
});
