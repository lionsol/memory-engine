import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import cardRuntimeSmokeCli from "../bin/run-auto-recall-card-runtime-smoke.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = resolve(repoRoot, "bin/run-auto-recall-card-runtime-smoke.js");

const {
  parseArgs,
  formatSyntheticRuntimeContext,
  runCardRuntimeSmoke,
  main,
} = cardRuntimeSmokeCli;

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

test("card runtime smoke script exists", () => {
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
  assert.deepEqual(parseArgs([]), {
    help: false,
    json: true,
    markdown: false,
  });
  assert.throws(() => parseArgs(["--json", "--markdown"]), /choose exactly one output format/);
  assert.throws(() => parseArgs(["--nope"]), /unknown argument/);
});

test("card runtime smoke is read-only by construction", () => {
  const source = readFileSync(scriptPath, "utf8");
  assert.equal(source.includes("definePluginEntry"), false);
  assert.equal(source.includes("api.on"), false);
  assert.equal(source.includes("hybridSearch"), false);
  assert.equal(source.includes("runHybridSearch"), false);
  assert.equal(source.includes("batchReinforce"), false);
  assert.equal(source.includes("execFileSync"), false);
});

test("synthetic runtime keeps raw text by default", async () => {
  const result = await formatSyntheticRuntimeContext({
    config: {},
    runtimeGate: { agentId: "edi" },
    candidates: [{
      id: "abc123def4567890",
      category: "project",
      confidence: 0.8,
      sources: ["fts"],
      text: "FULL_BODY_SHOULD_NOT_LEAK in default raw runtime",
    }],
  });

  assert.equal(result.card_first_runtime_enabled, false);
  assert.equal(result.disclosure_mode, "raw_text");
  assert.match(result.context, /Auto Recall - relevant memory/);
  assert.match(result.context, /FULL_BODY_SHOULD_NOT_LEAK/);
  assert.doesNotMatch(result.context, /Auto Recall - memory cards/);
  assert.equal(result.side_effects.injection, false);
});

test("synthetic runtime uses memory cards only for edi with explicit flag", async () => {
  const result = await formatSyntheticRuntimeContext({
    config: { cardFirstRuntime: { enabled: true } },
    runtimeGate: { agentId: "edi" },
    candidates: [{
      id: "abc123def4567890",
      path: "memory/projects/memory-engine.md",
      category: "project",
      confidence: 0.8,
      sources: ["fts", "kg"],
      title: "Card runtime title",
      summary: "Card runtime summary.",
      text: "FULL_BODY_SHOULD_NOT_LEAK in card runtime",
    }],
  });

  assert.equal(result.card_first_runtime_enabled, true);
  assert.equal(result.disclosure_mode, "memory_card");
  assert.equal(result.card_count, 1);
  assert.match(result.context, /Auto Recall - memory cards/);
  assert.match(result.context, /card-only previews/);
  assert.match(result.context, /Card runtime title/);
  assert.match(result.context, /Card runtime summary/);
  assert.match(result.context, /memory_engine_get:abc123def4567890/);
  assert.doesNotMatch(result.context, /FULL_BODY_SHOULD_NOT_LEAK/);
});

test("synthetic runtime stays raw text for non-edi even when flag is enabled", async () => {
  const result = await formatSyntheticRuntimeContext({
    config: { cardFirstRuntime: { enabled: true } },
    runtimeGate: { agentId: "task-planner" },
    candidates: [{
      id: "abc123def4567890",
      category: "project",
      confidence: 0.8,
      sources: ["fts"],
      text: "FULL_BODY_SHOULD_NOT_LEAK in non-edi raw runtime",
    }],
  });

  assert.equal(result.card_first_runtime_enabled, false);
  assert.equal(result.disclosure_mode, "raw_text");
  assert.match(result.context, /Auto Recall - relevant memory/);
  assert.match(result.context, /FULL_BODY_SHOULD_NOT_LEAK/);
});

test("card runtime smoke covers expected runtime selection and raw-log withholding", async () => {
  const report = await runCardRuntimeSmoke();
  const ids = report.checks.map(check => check.id);

  assert.deepEqual(ids, [
    "default_runtime_uses_raw_text",
    "enabled_edi_runtime_uses_memory_cards",
    "enabled_non_edi_runtime_stays_raw_text",
    "enabled_card_runtime_withholds_raw_log_body",
  ]);
  assert.equal(report.summary.mode, "read_only_card_runtime_smoke");
  assert.equal(report.summary.status, "pass");
  assert.equal(report.summary.check_count, 4);
  assert.equal(report.summary.failed_count, 0);
  assert.equal(report.checks.every(check => check.pass), true);

  const rawLogCheck = report.checks.find(check => check.id === "enabled_card_runtime_withholds_raw_log_body");
  assert.equal(rawLogCheck.details.risk_flags.includes("raw_log_like"), true);
  assert.equal(rawLogCheck.details.risk_flags.includes("tool_output_like"), true);
  assert.equal(rawLogCheck.details.leaked_traceback, false);
  assert.equal(rawLogCheck.details.leaked_timestamp, false);
});

test("card runtime smoke reports read-only side effects", async () => {
  const report = await runCardRuntimeSmoke();

  assert.deepEqual(report.side_effects, {
    db_writes: false,
    memory_file_mutation: false,
    dataset_file_mutation: false,
    retrieval: false,
    injection: false,
    cleanup_apply: false,
    archive: false,
    quarantine: false,
    reinforce: false,
    llm: false,
    network: false,
    runtime_report_files: false,
  });
});

test("CLI main returns zero and prints JSON by default", async () => {
  const result = spawnSync(process.execPath, [scriptPath, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.equal((result.stderr || "").trim(), "");
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.summary.status, "pass");
  assert.equal(parsed.summary.check_count, 4);
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
  assert.equal(parsed.summary.check_count, 4);
});

test("CLI executable supports markdown output", () => {
  const result = spawnSync(process.execPath, [scriptPath, "--markdown"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.equal((result.stderr || "").trim(), "");
  assert.match(result.stdout, /# AutoRecall Card Runtime Smoke/);
  assert.match(result.stdout, /PASS: default_runtime_uses_raw_text/);
  assert.match(result.stdout, /PASS: enabled_edi_runtime_uses_memory_cards/);
});
