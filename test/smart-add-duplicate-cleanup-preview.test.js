import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import previewCli from "../bin/preview-smart-add-duplicate-cleanup-candidates.js";
import {
  createSmartAddDuplicateFixture,
  withSmartAddDuplicateEnv,
} from "./helpers/smart-add-duplicate-fixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = resolve(repoRoot, "bin/preview-smart-add-duplicate-cleanup-candidates.js");

const {
  parseArgs,
  runCleanupCandidatePreview,
  main,
} = previewCli;

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

test("preview CLI file exists", () => {
  assert.equal(existsSync(scriptPath), true);
});

test("parseArgs supports json markdown help and limit", () => {
  assert.deepEqual(parseArgs(["--json"]), {
    help: false,
    json: true,
    markdown: false,
    limit: null,
  });
  assert.deepEqual(parseArgs(["--markdown", "--limit", "3"]), {
    help: false,
    json: false,
    markdown: true,
    limit: 3,
  });
  assert.deepEqual(parseArgs(["--help"]), {
    help: true,
    json: false,
    markdown: false,
    limit: null,
  });
});

test("parseArgs rejects destructive flags", () => {
  for (const flag of [
    "--apply",
    "--fix",
    "--delete",
    "--archive",
    "--quarantine",
    "--backfill-confidence",
    "--write-db",
  ]) {
    assert.throws(() => parseArgs([flag]), /unsupported destructive flag/);
  }
});

test("preview source is read-only by construction", () => {
  const source = readFileSync(scriptPath, "utf8");
  assert.equal(source.includes("execFileSync"), false);
  assert.equal(source.includes("--apply"), false);
  assert.equal(source.includes("applyConfirmed"), false);
});

test("preview returns current cleanup-eligible baseline with keep and delete candidates", async () => {
  const fixture = createSmartAddDuplicateFixture();
  await withSmartAddDuplicateEnv(fixture, async () => {
    const report = await runCleanupCandidatePreview();
    assert.equal(report.summary.cleanup_eligible_groups >= 1, true);
    assert.equal(report.summary.cleanup_eligible_entries >= report.summary.cleanup_eligible_groups, true);
    assert.equal(report.summary.previewed_groups, report.groups.length);
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

    for (const group of report.groups) {
      assert.equal(group.cleanup_eligibility, true);
      assert.equal(group.classification, "ingestion_bug_candidate");
      assert.equal(group.retrieved_count_total, 0);
      assert.equal(group.injected_count_total, 0);
      assert.equal(Boolean(group.suggested_keep_candidate), true);
      assert.equal(Array.isArray(group.suggested_delete_candidates), true);
      assert.equal(group.suggested_delete_candidates.length >= 1, true);
      assert.equal(Array.isArray(group.occurrences), true);
      assert.equal(group.occurrences.length >= 2, true);
    }
  });
});

test("preview respects limit", async () => {
  const fixture = createSmartAddDuplicateFixture();
  await withSmartAddDuplicateEnv(fixture, async () => {
    const report = await runCleanupCandidatePreview({ limit: 1 });
    assert.equal(report.summary.cleanup_eligible_groups >= 1, true);
    assert.equal(report.summary.cleanup_eligible_entries >= report.summary.cleanup_eligible_groups, true);
    assert.equal(report.summary.previewed_groups, 1);
    assert.equal(report.groups.length, 1);
  });
});

test("CLI default JSON output parses successfully", async () => {
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
  assert.equal(parsed.summary.mode, "read_only_preview");
  assert.equal(parsed.summary.cleanup_eligible_groups >= 1, true);
  assert.equal(parsed.summary.cleanup_eligible_entries >= parsed.summary.cleanup_eligible_groups, true);
  assert.equal(Array.isArray(parsed.groups), true);
});

test("CLI markdown output includes group hashes and candidate sections", async () => {
  const fixture = createSmartAddDuplicateFixture();
  const result = spawnSync(process.execPath, [scriptPath, "--markdown", "--limit", "1"], {
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
  assert.equal(result.stdout.includes("# Smart-Add Duplicate Cleanup Candidate Preview"), true);
  assert.equal(result.stdout.includes("## Candidate Groups"), true);
  assert.equal(result.stdout.includes("suggested_keep_candidate"), true);
  assert.equal(result.stdout.includes("suggested_delete_candidates"), true);
  assert.equal(result.stdout.includes("### "), true);
});

test("CLI executable exits zero with clean stderr", () => {
  const fixture = createSmartAddDuplicateFixture();
  const result = spawnSync(process.execPath, [scriptPath, "--markdown", "--limit", "1"], {
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
  assert.equal((result.stderr || "").trim(), "");
});
