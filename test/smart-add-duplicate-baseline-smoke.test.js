import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import smokeCli from "../bin/run-smart-add-duplicate-baseline-smoke.js";
import {
  createSmartAddDuplicateFixture,
  withSmartAddDuplicateEnv,
} from "./helpers/smart-add-duplicate-fixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = resolve(repoRoot, "bin/run-smart-add-duplicate-baseline-smoke.js");

const {
  parseArgs,
  runSmartAddDuplicateBaselineSmoke,
  main,
} = smokeCli;

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

test("baseline smoke script exists", () => {
  assert.equal(existsSync(scriptPath), true);
});

test("parseArgs supports json, markdown, and help", () => {
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
  assert.deepEqual(parseArgs(["--help"]), {
    help: true,
    json: false,
    markdown: false,
  });
  assert.throws(() => parseArgs(["--json", "--markdown"]), /choose exactly one output format/);
});

test("baseline smoke is read-only by construction as much as practical", () => {
  const source = readFileSync(scriptPath, "utf8");
  assert.equal(source.includes("execFileSync"), false);
  assert.equal(source.includes("--apply"), false);
  assert.equal(source.includes("--out"), false);
});

test("baseline smoke checks intended invariants and reports read-only side effects", async () => {
  const fixture = createSmartAddDuplicateFixture();
  await withSmartAddDuplicateEnv(fixture, async () => {
    const report = await runSmartAddDuplicateBaselineSmoke();
    const ids = report.checks.map(check => check.id);

    assert.equal(report.side_effects.db_writes, false);
    assert.equal(report.side_effects.memory_file_mutation, false);
    assert.equal(report.side_effects.cleanup_apply, false);
    assert.equal(report.side_effects.archive, false);
    assert.equal(report.side_effects.quarantine, false);
    assert.equal(report.side_effects.reinforce, false);
    assert.equal(report.side_effects.confidence_backfill, false);
    assert.equal(report.side_effects.llm, false);
    assert.equal(report.side_effects.network, false);
    assert.equal(report.side_effects.runtime_report_files, false);

    assert.deepEqual(ids, [
      "cleanup_eligible_groups_count",
      "cleanup_eligible_entries_count",
      "ingestion_bug_candidate_groups_count",
      "unsafe_to_cleanup_groups_count",
      "cleanup_eligible_groups_are_safe",
      "usage_groups_are_not_cleanup_eligible",
      "repeated_confirmation_groups_are_not_cleanup_eligible",
      "mixed_or_unclear_groups_are_not_cleanup_eligible",
    ]);
  });
});

test("baseline smoke passes on current repo/data", async () => {
  const fixture = createSmartAddDuplicateFixture();
  await withSmartAddDuplicateEnv(fixture, async () => {
    const report = await runSmartAddDuplicateBaselineSmoke();
    assert.equal(report.summary.status, "pass");
    assert.equal(report.summary.failed_count, 0);
    assert.equal(report.summary.passed_count, report.summary.check_count);
    assert.equal(report.checks.every(check => check.pass), true);
    assert.equal(report.baseline.cleanup_eligible_groups >= 1, true);
    assert.equal(report.baseline.cleanup_eligible_entries >= report.baseline.cleanup_eligible_groups, true);
    assert.equal(report.baseline.ingestion_bug_candidate_groups >= report.baseline.cleanup_eligible_groups, true);
    assert.equal(report.baseline.unsafe_to_cleanup_groups >= 1, true);
  });
});

test("CLI main returns zero and prints JSON by default", async () => {
  const fixture = createSmartAddDuplicateFixture();
  const result = spawnSync(process.execPath, [scriptPath, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      MEMORY_ENGINE_CORE_DB: fixture.corePath,
      MEMORY_ENGINE_DB: fixture.enginePath,
      MEMORY_ENGINE_DB_PATH: fixture.enginePath,
    },
  });
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.summary.status, "pass");
  assert.equal(parsed.summary.failed_count, 0);
  assert.equal(parsed.summary.check_count, 8);
  assert.deepEqual(parsed.summary.failed_check_ids, []);
});

test("CLI executable exits zero with clean stderr", () => {
  const result = spawnSync(process.execPath, [scriptPath, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: (() => {
      const fixture = createSmartAddDuplicateFixture();
      return {
        ...process.env,
        MEMORY_ENGINE_CORE_DB: fixture.corePath,
        MEMORY_ENGINE_DB: fixture.enginePath,
        MEMORY_ENGINE_DB_PATH: fixture.enginePath,
      };
    })(),
  });

  assert.equal(result.status, 0);
  assert.equal((result.stderr || "").trim(), "");
});
