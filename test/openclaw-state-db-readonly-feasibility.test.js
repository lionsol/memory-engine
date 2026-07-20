import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  CHECKPOINT_REVISION,
  WAL_REVISION,
  compareFingerprints,
  fingerprintTree,
  runStateDbReadonlyFeasibilitySmoke,
  TEMP_PREFIX,
} from "../lib/ops/sqlite-readonly-feasibility.js";

function tempFamilies() {
  return readdirSync(tmpdir()).filter((entry) => entry.startsWith(TEMP_PREFIX)).sort();
}

test("synthetic readonly feasibility smoke returns the complete report schema and cleans up", () => {
  const before = tempFamilies();
  const report = runStateDbReadonlyFeasibilitySmoke();
  const after = tempFamilies();

  assert.deepEqual(after, before);
  assert.equal(report.schema_version, 1);
  assert.match(report.generated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(report.node_version, /^v\d+/);
  assert.match(String(report.node_module_version), /^\d+$/);
  assert.equal(report.real_path_accessed, false);
  assert.equal(report.openclaw_imported, false);
  assert.equal(report.plugin_imported, false);
  assert.equal(report.temp_root_family, `${TEMP_PREFIX}*`);
  assert.equal(report.scenarios.length, 6);
  assert.deepEqual(
    report.scenarios.map((scenario) => scenario.id),
    [
      "missing-database",
      "rollback-journal",
      "wal-latest-committed-row",
      "wal-without-shm",
      "non-writable-directory",
      "immutable-live-wal",
    ],
  );

  for (const scenario of report.scenarios) {
    assert.ok(["PASS", "BLOCKED", "SKIPPED"].includes(scenario.status));
    assert.equal(typeof scenario.open_succeeded, "boolean");
    assert.equal(typeof scenario.query_succeeded, "boolean");
    assert.equal(typeof scenario.latest_row_visible, "boolean");
    assert.equal(typeof scenario.sql_write_rejected, "boolean");
    assert.equal(typeof scenario.database_created, "boolean");
    assert.equal(typeof scenario.sidecar_created, "boolean");
    assert.equal(typeof scenario.observable_write_detected, "boolean");
    assert.ok(Array.isArray(scenario.new_files));
    assert.ok(Array.isArray(scenario.deleted_files));
    assert.ok(Array.isArray(scenario.content_changed_files));
    assert.ok(Array.isArray(scenario.metadata_changed_files));
    assert.ok(Array.isArray(scenario.blockers));
  }

  const missing = report.scenarios.find((scenario) => scenario.id === "missing-database");
  assert.equal(missing.open_succeeded, false);
  assert.equal(missing.database_created, false);
  assert.equal(missing.sidecar_created, false);

  const rollback = report.scenarios.find((scenario) => scenario.id === "rollback-journal");
  assert.equal(rollback.expected_revision, CHECKPOINT_REVISION);
  assert.equal(rollback.latest_row_visible, rollback.observed_revision === CHECKPOINT_REVISION);

  const wal = report.scenarios.find((scenario) => scenario.id === "wal-latest-committed-row");
  assert.equal(wal.expected_revision, WAL_REVISION);
  assert.equal(wal.latest_row_visible, wal.observed_revision === WAL_REVISION);

  const immutable = report.scenarios.find((scenario) => scenario.id === "immutable-live-wal");
  assert.equal(immutable.expected_revision, WAL_REVISION);
  assert.equal(immutable.normal_latest_row_visible, immutable.normal_observed_revision === WAL_REVISION);
  assert.equal(immutable.immutable_latest_row_visible, immutable.immutable_observed_revision === WAL_REVISION);
});

test("the synthetic report does not expose absolute temporary paths", () => {
  const report = runStateDbReadonlyFeasibilitySmoke();
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(path.join(tmpdir(), TEMP_PREFIX)), false);
  assert.equal(serialized.includes("/synthetic/not-a-real-runtime"), false);
});

test("the smoke CLI rejects external-path arguments", () => {
  const cli = new URL("../bin/run-openclaw-state-db-readonly-feasibility-smoke.js", import.meta.url);
  const result = spawnSync(process.execPath, [cli.pathname, "--db", "/tmp/not-used.sqlite"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 64);
  assert.match(result.stderr, /unknown argument/);
});

test("fingerprints detect metadata changes without a content change", () => {
  const directory = mkdtempSync(path.join(tmpdir(), `${TEMP_PREFIX}metadata-`));
  const filePath = path.join(directory, "fixture.txt");
  try {
    writeFileSync(filePath, "stable-content");
    const before = fingerprintTree(directory);
    const contentBefore = readFileSync(filePath, "utf8");
    utimesSync(filePath, new Date(1000), new Date(5000));
    const after = fingerprintTree(directory);
    const diff = compareFingerprints(before, after);
    assert.deepEqual(readFileSync(filePath, "utf8"), contentBefore);
    assert.ok(diff.metadata_changed_files.includes("fixture.txt"));
    assert.equal(diff.content_changed_files.includes("fixture.txt"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
