import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

const repoRoot = resolve(import.meta.dirname, "..");
const callerPath = join(repoRoot, "docs/smoke-tests/autorecall-recent-deployment-callbacks-20261011.sh");
const fingerprintPath = join(repoRoot, "bin/core-deployment-logical-fingerprint.js");
const nodePath = process.execPath;

function createCoreDb(databasePath) {
  const db = new Database(databasePath);
  db.exec(`
    PRAGMA user_version = 1;
    CREATE TABLE schema_meta (
      meta_key TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      agent_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      app_version TEXT,
      updated_at INTEGER
    );
    CREATE TABLE memory_index_chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      source TEXT,
      start_line INTEGER,
      end_line INTEGER,
      hash TEXT,
      model TEXT,
      text TEXT,
      embedding BLOB,
      updated_at INTEGER
    );
    CREATE VIRTUAL TABLE memory_index_chunks_fts USING fts5(id UNINDEXED, text, path UNINDEXED);
    CREATE TABLE memory_index_sources (
      path TEXT NOT NULL,
      source TEXT NOT NULL,
      hash TEXT,
      mtime INTEGER,
      size INTEGER,
      PRIMARY KEY(path, source)
    );
    CREATE TABLE memory_embedding_cache (
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      provider_key TEXT NOT NULL,
      hash TEXT NOT NULL,
      embedding BLOB,
      dims INTEGER,
      updated_at INTEGER,
      PRIMARY KEY(provider, model, provider_key, hash)
    );
    CREATE TABLE memory_index_meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE memory_index_state (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL);
    CREATE INDEX memory_index_chunks_path_idx ON memory_index_chunks(path);
    INSERT INTO schema_meta VALUES ('primary', 'agent', 1, 'main', 1720000000, '1.0.0', 1720000001);
    INSERT INTO memory_index_chunks VALUES
      ('chunk-1', 'memory/a.md', 'memory', 1, 3, 'chunk-hash', 'model-a', 'alpha content', X'0001FF', 1720000002);
    INSERT INTO memory_index_chunks_fts VALUES ('chunk-1', 'alpha content', 'memory/a.md');
    INSERT INTO memory_index_sources VALUES ('memory/a.md', 'memory', 'source-hash', 1720000000, 42);
    INSERT INTO memory_embedding_cache VALUES ('provider-a', 'model-a', 'key-a', 'cache-hash', X'010203', 3, 1720000003);
    INSERT INTO memory_index_meta VALUES ('format', 'v1');
    INSERT INTO memory_index_state VALUES (1, 7);
  `);
  db.close();
}

function cronJob({ id = "job-1", enabled = true, message = "run nightly maintenance" } = {}) {
  return {
    id,
    agentId: "main",
    name: id === "job-1" ? "nightly-maintenance" : "disabled-maintenance",
    description: "offline fixture",
    enabled,
    deleteAfterRun: false,
    schedule: { kind: "cron", expr: "30 3 * * *", tz: "Asia/Shanghai" },
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payload: { kind: "agentTurn", message, model: "fixture-model", timeoutSeconds: 30 },
    delivery: { mode: "none" },
    state: { lastRunStatus: "ok", nextRunAtMs: 0 },
  };
}

function cronDocument(jobs, metadata = {}) {
  return JSON.stringify({
    total: jobs.length,
    offset: 0,
    hasMore: false,
    nextOffset: null,
    ...metadata,
    jobs,
  }) + "\n";
}

function writeCron(path, value) {
  writeFileSync(path, Array.isArray(value) ? cronDocument(value) : value);
}

function readLines(path) {
  return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean) : [];
}

function makeFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "autorecall-deployment-callbacks-"));
  const candidate = join(root, "candidate package");
  const rollback = join(root, "fresh rollback package");
  const active = join(root, "active artifact");
  const cwd = join(root, "stable install cwd");
  const entrypoint = join(root, "harmless openclaw fixture.mjs");
  const openclaw = join(root, "offline gateway cron fixture.sh");
  const driver = join(root, "offline deployment driver.sh");
  const coreDb = join(root, "openclaw-agent.sqlite");
  const evidence = join(root, "evidence");
  const cronBeforeSource = join(root, "cron-before-source.json");
  const cronAfter = join(root, "cron-after.json");
  const installLog = join(root, "install.log");
  const phaseLog = join(root, "phase.log");
  const cronArgsLog = join(root, "cron-args.log");
  const preDdlBaseline = join(evidence, "core-pre-ddl.json");
  const jobs = [cronJob(), cronJob({ id: "job-2", enabled: false, message: "disabled maintenance" })];

  for (const path of [candidate, rollback, active, cwd, evidence]) mkdirSync(path);
  createCoreDb(coreDb);
  writeFileSync(join(candidate, "runtime.js"), "candidate-runtime\n");
  writeFileSync(join(candidate, "package.json"), JSON.stringify({ name: "candidate", version: "1.0.0" }) + "\n");
  writeFileSync(join(rollback, "runtime.js"), "rollback-runtime\n");
  writeFileSync(join(rollback, "package.json"), JSON.stringify({ name: "rollback", version: "0.9.0" }) + "\n");
  for (const name of readdirSync(rollback)) cpSync(join(rollback, name), join(active, name), { recursive: true });
  writeCron(cronBeforeSource, jobs);
  writeCron(cronAfter, jobs);

  writeFileSync(entrypoint, `
import { appendFileSync, existsSync, readdirSync, rmSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const activeRoot = process.env.ACTIVE_ARTIFACT_ROOT;
const logPath = process.env.INSTALL_LOG;
const previous = existsSync(logPath) ? readFileSync(logPath, "utf8").trim() : "";
const index = previous ? previous.split("\\n").filter(Boolean).length : 0;
const codes = (process.env.INSTALL_EXIT_CODES || "0").split(",").map(Number);
const packagePath = process.argv[4] || "";
const role = packagePath.includes("candidate") ? "candidate" : "recovery";
appendFileSync(logPath, JSON.stringify({ packagePath, role }) + "\\n");
for (const name of readdirSync(activeRoot)) rmSync(join(activeRoot, name), { recursive: true, force: true });
for (const name of readdirSync(packagePath)) cpSync(join(packagePath, name), join(activeRoot, name), { recursive: true });
if ((process.env.INSTALL_MODE || "normal") === "unexpected" && role === "candidate") {
  writeFileSync(join(activeRoot, "unexpected.js"), "unexpected runtime\\n");
}
process.exit(Number.isInteger(codes[Math.min(index, codes.length - 1)]) ? codes[Math.min(index, codes.length - 1)] : 70);
`);

  writeFileSync(openclaw, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CRON_ARGS_LOG"
if [[ "\${CRON_EXIT_CODE:-0}" != 0 ]]; then exit "\$CRON_EXIT_CODE"; fi
if [[ "\${CRON_MODE:-normal}" == empty ]]; then exit 0; fi
if [[ "\$1" != cron || "\$2" != list || "\$3" != --all || "\$4" != --json ]]; then exit 65; fi
cat -- "$CRON_SOURCE"
`);
  chmodSync(openclaw, 0o700);

  writeFileSync(driver, `#!/usr/bin/env bash
set +e
source "$1"
export AUTORECALL_DEPLOYMENT_NODE="$2"
export AUTORECALL_DEPLOYMENT_CORE_FINGERPRINT_TOOL="$3"
export AUTORECALL_DEPLOYMENT_OPENCLAW="$4"
export AUTORECALL_DEPLOYMENT_INSTALL_ENTRYPOINT="$5"
export AUTORECALL_DEPLOYMENT_INSTALL_CWD="$6"
export AUTORECALL_DEPLOYMENT_INSTALL_PATH="$7"
export AUTORECALL_DEPLOYMENT_CRON_AFTER_JSON="$8"
export INSTALL_LOG="$9"
export PHASE_LOG="\${10}"
export CRON_SOURCE="\${11}"
export CRON_ARGS_LOG="\${17}"
export ACTIVE_ARTIFACT_ROOT="\${16}"
export AUTORECALL_DEPLOYMENT_ACTIVE_ARTIFACT_ROOT="\${16}"
export INSTALL_MODE="\${18}"
export DDL_NODE="$2"
export DDL_CORE_DB="\${12}"
stop_callback() { printf '%s\\n' stop >> "$PHASE_LOG"; }
ddl_callback() {
  if "$DDL_NODE" -e '
    const Database = require("better-sqlite3");
    const db = new Database(process.argv[1]);
    db.exec("CREATE INDEX idx_memory_index_chunks_recent_cover ON memory_index_chunks(updated_at DESC, id ASC, path)");
    db.close();
  ' "$DDL_CORE_DB"; then
    printf '%s\\n' ddl >> "$PHASE_LOG"
    return 0
  fi
  return \$?
}
if autorecall_recent_deployment_run "\${13}" "\${14}" "\${15}" "\${12}" stop_callback ddl_callback; then
  rc=0
else
  rc=\$?
fi
printf 'driver_rc=%s\\n' "\$rc"
exit 0
`);
  chmodSync(driver, 0o700);

  const preDdl = spawnSync(nodePath, [fingerprintPath, "--core-db", coreDb, "--out", preDdlBaseline], { encoding: "utf8" });
  assert.equal(preDdl.status, 0, preDdl.stderr);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    root,
    candidate,
    rollback,
    active,
    cwd,
    entrypoint,
    openclaw,
    driver,
    coreDb,
    evidence,
    baseline: join(evidence, "core-post-index.json"),
    preDdlBaseline,
    cronBeforeSource,
    cronAfter,
    installLog,
    phaseLog,
    cronArgsLog,
  };
}

function runFixture(fixture, options = {}) {
  if (options.cronSourceContent !== undefined) writeFileSync(fixture.cronBeforeSource, options.cronSourceContent);
  const env = {
    ...process.env,
    INSTALL_EXIT_CODES: options.installExitCodes ?? "0",
    INSTALL_MODE: options.installMode ?? "normal",
    CRON_EXIT_CODE: options.cronExitCode == null ? "0" : String(options.cronExitCode),
    CRON_MODE: options.cronMode ?? "normal",
    ACTIVE_ARTIFACT_ROOT: fixture.active,
    CRON_ARGS_LOG: fixture.cronArgsLog,
  };
  for (const key of ["AUTORECALL_RECENT_DEPLOYMENT_LAUNCH_OBSERVED", "AUTORECALL_RECENT_DEPLOYMENT_RUNTIME_STATE"]) delete env[key];
  const result = spawnSync("/bin/bash", [
    fixture.driver,
    callerPath,
    nodePath,
    fingerprintPath,
    fixture.openclaw,
    fixture.entrypoint,
    fixture.cwd,
    env.PATH,
    fixture.cronAfter,
    fixture.installLog,
    fixture.phaseLog,
    fixture.cronBeforeSource,
    options.coreDb ?? fixture.coreDb,
    fixture.candidate,
    fixture.rollback,
    fixture.evidence,
    fixture.active,
    fixture.cronArgsLog,
    options.installMode ?? "normal",
  ], { encoding: "utf8", env });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  const fields = Object.fromEntries(result.stdout.trim().split("\n").filter(Boolean).map(line => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  return {
    result,
    fields,
    install: readLines(fixture.installLog),
    phases: readLines(fixture.phaseLog),
    cronArgs: readLines(fixture.cronArgsLog),
  };
}

test("offline deployment caller enforces fresh cron, post-DDL Core, and observed runtime contracts", async t => {
  await t.test("creates and freezes core-post-index only after the real DDL", () => {
    const fixture = makeFixture(t);
    assert.equal(existsSync(fixture.baseline), false);
    const run = runFixture(fixture);
    assert.equal(run.fields.driver_rc, "0");
    assert.equal(run.fields.status, "CONTINUE");
    assert.equal(run.fields.candidate_facts_status, "ok");
    assert.equal(run.fields.candidate_launch_observed, "yes");
    assert.equal(run.fields.candidate_runtime_state, "changed");
    assert.equal(run.fields.candidate_data_drift, "none");
    assert.equal(run.fields.restart_decision, "permitted");
    assert.deepEqual(run.phases, ["stop", "ddl"]);
    assert.equal(run.install.length, 1);
    assert.deepEqual(run.cronArgs, ["cron list --all --json"]);
    assert.equal(readLines(join(fixture.evidence, "facts-count"))[0], "1");
    assert.equal(readFileSync(join(fixture.active, "runtime.js"), "utf8"), "candidate-runtime\n");

    const db = new Database(fixture.coreDb, { readonly: true, fileMustExist: true });
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get("idx_memory_index_chunks_recent_cover").name, "idx_memory_index_chunks_recent_cover");
    db.close();
    const before = JSON.parse(readFileSync(fixture.preDdlBaseline, "utf8"));
    const after = JSON.parse(readFileSync(fixture.baseline, "utf8"));
    assert.notEqual(before.deployment_invariant_sha256, after.deployment_invariant_sha256);
    assert.equal(before.canonical_content.sha256, after.canonical_content.sha256);
    assert.equal(before.schema_identity.sha256, after.schema_identity.sha256);
    assert.notEqual(before.schema_surface.sha256, after.schema_surface.sha256);
    assert.equal(before.pragma_user_version, after.pragma_user_version);
    assert.equal(JSON.parse(readFileSync(join(fixture.evidence, "core-post-index-self-compare.json"), "utf8")).comparison.deployment_invariant_equal, true);
    assert.equal(JSON.parse(readFileSync(join(fixture.evidence, "core-facts-1.json"), "utf8")).comparison.deployment_invariant_equal, true);
  });

  await t.test("compares the actual active candidate artifact, not runtime_state hints", () => {
    const fixture = makeFixture(t);
    const run = runFixture(fixture);
    const artifact = JSON.parse(readFileSync(join(fixture.evidence, "runtime-facts-1-compare.json"), "utf8"));
    assert.equal(run.fields.candidate_runtime_state, "changed");
    assert.equal(artifact.accepted, true);
    assert.equal(artifact.classification, "EXACT");
    assert.equal(artifact.semantic_equal, true);
    assert.equal(artifact.topology_equal, true);
  });

  await t.test("blocks an unexpected active artifact", () => {
    const fixture = makeFixture(t);
    const run = runFixture(fixture, { installMode: "unexpected" });
    const artifact = JSON.parse(readFileSync(join(fixture.evidence, "runtime-facts-1-compare.json"), "utf8"));
    assert.equal(run.fields.status, "STOPPED");
    assert.equal(run.fields.outcome, "candidate_facts_blocked");
    assert.equal(run.fields.candidate_facts_status, "ok");
    assert.equal(run.fields.candidate_data_drift, "unexplained");
    assert.equal(run.fields.recovery_invocations, "0");
    assert.equal(run.fields.restart_decision, "blocked");
    assert.equal(artifact.accepted, false);
    assert.equal(existsSync(join(fixture.active, "unexpected.js")), true);
  });

  await t.test("requires recovery acceptance to match the actual fresh rollback", () => {
    const fixture = makeFixture(t);
    const run = runFixture(fixture, { installExitCodes: "1,0" });
    const artifact = JSON.parse(readFileSync(join(fixture.evidence, "runtime-facts-2-compare.json"), "utf8"));
    assert.equal(run.fields.driver_rc, "1");
    assert.equal(run.fields.outcome, "candidate_failed_recovery_succeeded");
    assert.equal(run.fields.recovery_facts_status, "ok");
    assert.equal(run.fields.recovery_acceptance, "accepted");
    assert.equal(run.fields.restart_decision, "permitted");
    assert.equal(artifact.accepted, true);
    assert.equal(artifact.classification, "EXACT");
    assert.equal(readFileSync(join(fixture.active, "runtime.js"), "utf8"), "rollback-runtime\n");
    assert.equal(run.install.length, 2);
    assert.equal(readLines(join(fixture.evidence, "facts-count"))[0], "2");
  });

  await t.test("missing Core blocks before stop, DDL, and install", () => {
    const fixture = makeFixture(t);
    const run = runFixture(fixture, { coreDb: join(fixture.root, "missing-core.sqlite") });
    assert.equal(run.fields.driver_rc, "64");
    assert.equal(run.fields.outcome, "validation_failed");
    assert.deepEqual(run.phases, []);
    assert.deepEqual(run.install, []);
    assert.deepEqual(run.cronArgs, []);
  });

  for (const [label, options] of [
    ["cron command failure", { cronExitCode: 23 }],
    ["empty cron output", { cronMode: "empty" }],
    ["invalid cron JSON", { cronSourceContent: "not-json\n" }],
  ]) {
    await t.test(label + " blocks before stop, DDL, and install", () => {
      const fixture = makeFixture(t);
      const run = runFixture(fixture, options);
      assert.equal(run.fields.driver_rc, "64");
      assert.equal(run.fields.outcome, "cron_baseline_invalid");
      assert.deepEqual(run.phases, []);
      assert.deepEqual(run.install, []);
    });
  }

  await t.test("an incomplete tail page blocks before any mutation", () => {
    const fixture = makeFixture(t);
    const incomplete = cronDocument([cronJob()], { total: 2, hasMore: true, nextOffset: 2 });
    const run = runFixture(fixture, { cronSourceContent: incomplete });
    assert.equal(run.fields.driver_rc, "64");
    assert.equal(run.fields.outcome, "cron_baseline_invalid");
    assert.deepEqual(run.phases, []);
    assert.deepEqual(run.install, []);
  });

  await t.test("detects disabled job definition and payload changes with equal id/count", () => {
    const fixture = makeFixture(t);
    writeCron(fixture.cronAfter, [
      cronJob(),
      cronJob({ id: "job-2", enabled: false, message: "changed disabled payload" }),
    ]);
    const run = runFixture(fixture);
    assert.equal(run.fields.status, "STOPPED");
    assert.equal(run.fields.outcome, "candidate_facts_blocked");
    assert.equal(run.fields.candidate_facts_status, "ok");
    assert.equal(run.fields.candidate_data_drift, "unexplained");
    assert.equal(run.fields.restart_decision, "blocked");
    assert.equal(run.install.length, 1);
    assert.deepEqual(run.phases, ["stop", "ddl"]);
  });
});
