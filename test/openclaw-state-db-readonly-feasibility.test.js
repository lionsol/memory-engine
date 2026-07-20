import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  CHECKPOINT_REVISION,
  createSyntheticDatabase,
  WAL_REVISION,
  POST_OPEN_WAL_REVISION,
  compareFingerprints,
  classifyImmutableBehavior,
  fingerprintTree,
  probeSqlWriteRejections,
  runStateDbReadonlyFeasibilitySmoke,
  runReadOnlyChecks,
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
    if (scenario.id === "immutable-live-wal") {
      if (!scenario.immutable_database_shape_verified
        || scenario.immutable_initial_query_error_code
        || scenario.immutable_post_update_query_error_code) {
        assert.notEqual(scenario.status, "PASS");
      }
    }
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
  assert.notEqual(CHECKPOINT_REVISION, WAL_REVISION);
  assert.notEqual(WAL_REVISION, POST_OPEN_WAL_REVISION);
  assert.equal(typeof immutable.reader_phase_1_diff, "object");
  assert.equal(typeof immutable.reader_phase_2_diff, "object");
  assert.equal(typeof immutable.normal_location_matches, "boolean");
  assert.equal(typeof immutable.immutable_location_matches, "boolean");
  assert.equal(immutable.immutable_candidate_allowed, false);
  assert.ok([
    "saw-post-open-update",
    "retained-stale-snapshot",
    "query-failed-after-update",
    "uri-or-location-unproven",
    "other",
  ].includes(immutable.immutable_behavior));
  assert.equal(immutable.normal_post_update_revision === POST_OPEN_WAL_REVISION,
    immutable.normal_post_update_latest_visible);
  assert.equal(immutable.normal_latest_row_visible,
    immutable.normal_initial_latest_visible && immutable.normal_post_update_latest_visible);

  const nonWritable = report.scenarios.find((scenario) => scenario.id === "non-writable-directory");
  if (nonWritable.status === "SKIPPED") {
    assert.ok(nonWritable.blockers.includes("permission_model_not_enforceable"));
  } else {
    assert.equal(nonWritable.fixture_wal_present, true);
    assert.equal(nonWritable.fixture_shm_present, true);
    assert.equal(nonWritable.directory_writable_before, true);
    assert.equal(nonWritable.directory_writable_during, false);
    assert.equal(nonWritable.expected_revision, WAL_REVISION);
  }
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

test("fingerprints report newly created sidecars as observable writes", () => {
  const directory = mkdtempSync(path.join(tmpdir(), `${TEMP_PREFIX}sidecar-`));
  try {
    const before = fingerprintTree(directory);
    writeFileSync(path.join(directory, "fixture.sqlite-shm"), "synthetic-shm");
    const after = fingerprintTree(directory);
    const diff = compareFingerprints(before, after);
    assert.equal(diff.sidecar_created, true);
    assert.ok(diff.new_files.includes("fixture.sqlite-shm"));
    assert.equal(diff.observable_write_detected, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("read-only open failures retain an after fingerprint and stable error code", () => {
  const directory = mkdtempSync(path.join(tmpdir(), `${TEMP_PREFIX}failure-`));
  const databasePath = path.join(directory, "broken.sqlite");
  try {
    writeFileSync(databasePath, "not-a-sqlite-database");
    const before = fingerprintTree(directory);
    const result = {
      expected_revision: CHECKPOINT_REVISION,
      blockers: [],
    };
    runReadOnlyChecks(result, databasePath, before, directory);
    assert.equal(typeof result.open_error_code, "string");
    assert.equal(typeof result.after_fingerprint, "object");
    assert.ok(result.blockers.length > 0);
    assert.equal(JSON.stringify(result).includes(directory), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the shared SQL probe distinguishes writable success from read-only rejection", () => {
  const directory = mkdtempSync(path.join(tmpdir(), `${TEMP_PREFIX}write-probe-`));
  const writableDatabasePath = path.join(directory, "writable-probe.sqlite");
  const readOnlyDatabasePath = path.join(directory, "readonly-probe.sqlite");
  try {
    const writable = createSyntheticDatabase(writableDatabasePath);
    const writableResult = probeSqlWriteRejections(writable);
    writable.close();
    assert.deepEqual(writableResult, {
      insert: false,
      update: false,
      delete: false,
      ddl: false,
    });

    const readOnlyFixture = createSyntheticDatabase(readOnlyDatabasePath);
    readOnlyFixture.close();
    const freshCheck = new DatabaseSync(readOnlyDatabasePath, { readOnly: true });
    const probeCount = freshCheck.prepare(
      "SELECT COUNT(*) AS count FROM installed_plugin_index WHERE index_key = ?",
    ).get("plugin-registry-write-probe-insert").count;
    freshCheck.close();
    assert.equal(Number(probeCount), 0);

    const readOnly = new DatabaseSync(readOnlyDatabasePath, { readOnly: true });
    const readOnlyResult = probeSqlWriteRejections(readOnly);
    readOnly.close();
    assert.deepEqual(readOnlyResult, {
      insert: true,
      update: true,
      delete: true,
      ddl: true,
    });
    assert.equal(Object.values(readOnlyResult).every(Boolean), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("immutable behavior classification is deterministic and fail closed", () => {
  const cases = [
    [
      "location mismatch takes precedence",
      { locationMatches: false, initialRevision: "checkpointed-A", postRevision: POST_OPEN_WAL_REVISION },
      "uri-or-location-unproven",
    ],
    [
      "A to A is stale",
      { locationMatches: true, initialRevision: CHECKPOINT_REVISION, postRevision: CHECKPOINT_REVISION },
      "retained-stale-snapshot",
    ],
    [
      "B to B is stale",
      { locationMatches: true, initialRevision: WAL_REVISION, postRevision: WAL_REVISION },
      "retained-stale-snapshot",
    ],
    [
      "B to C sees post-open update",
      { locationMatches: true, initialRevision: WAL_REVISION, postRevision: POST_OPEN_WAL_REVISION },
      "saw-post-open-update",
    ],
    [
      "post query failure wins over initial query failure",
      { locationMatches: true, initialQueryError: "initial", postQueryError: "post", initialRevision: WAL_REVISION },
      "query-failed-after-update",
    ],
    [
      "initial query failure is retained",
      { locationMatches: true, initialQueryError: "initial", initialRevision: null, postRevision: null },
      "initial-query-failed",
    ],
  ];
  for (const [name, input, expected] of cases) {
    assert.equal(classifyImmutableBehavior(input), expected, name);
  }
});

test("scenario write rejection summary is mathematically consistent", () => {
  const report = runStateDbReadonlyFeasibilitySmoke();
  for (const scenario of report.scenarios) {
    assert.equal(
      scenario.sql_write_rejected,
      Object.values(scenario.sql_write_rejections).every(Boolean),
    );
    if (scenario.status === "PASS") assert.equal(scenario.blockers.length, 0);
    if (scenario.status === "BLOCKED" || scenario.status === "SKIPPED") {
      assert.ok(scenario.blockers.length > 0);
    }
  }
  const provisional = report.decision.includes("PROVISIONAL");
  const blocked = report.decision.includes("BLOCKED");
  assert.equal(provisional || blocked, true);
  if (provisional) {
    assert.equal(report.blockers.length, 0);
    assert.equal(report.scenarios.every((scenario) => scenario.status === "PASS"), true);
  }
  if (blocked) {
    assert.equal(
      report.scenarios.some((scenario) => scenario.status === "BLOCKED" || scenario.status === "SKIPPED"),
      true,
    );
  }
});
