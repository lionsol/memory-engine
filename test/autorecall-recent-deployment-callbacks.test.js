import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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

function createCoreDb(path) {
  const db = new Database(path);
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

function cronJob(message = "run nightly maintenance") {
  return {
    id: "job-1",
    agentId: "main",
    name: "nightly-maintenance",
    description: "offline fixture",
    enabled: true,
    deleteAfterRun: false,
    schedule: { kind: "cron", expr: "30 3 * * *", tz: "Asia/Shanghai" },
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payload: { kind: "agentTurn", message, model: "fixture-model", timeoutSeconds: 30 },
    delivery: { mode: "none" },
    state: { lastRunStatus: "ok", nextRunAtMs: 0 },
  };
}

function writeCron(path, value) {
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify({ jobs: [value] }) + "\n");
}

function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readLines(path) {
  return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean) : [];
}

function makeFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "autorecall-deployment-callbacks-"));
  const candidate = join(root, "candidate package");
  const rollback = join(root, "fresh rollback package");
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
  mkdirSync(candidate);
  mkdirSync(rollback);
  mkdirSync(cwd);
  mkdirSync(evidence);
  createCoreDb(coreDb);
  writeCron(cronBeforeSource, cronJob());
  writeCron(cronAfter, cronJob());

  writeFileSync(entrypoint, `
import { appendFileSync, existsSync, readFileSync } from "node:fs";
const logPath = process.env.INSTALL_LOG;
const previous = existsSync(logPath) ? readFileSync(logPath, "utf8").trim() : "";
const index = previous ? previous.split("\\n").filter(Boolean).length : 0;
const codes = (process.env.INSTALL_EXIT_CODES || "0").split(",").map(Number);
const packagePath = process.argv[4] || "";
appendFileSync(logPath, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), role: packagePath.includes("rollback") ? "recovery" : "candidate" }) + "\\n");
process.exit(Number.isInteger(codes[Math.min(index, codes.length - 1)]) ? codes[Math.min(index, codes.length - 1)] : 70);
`);

  writeFileSync(openclaw, `#!/usr/bin/env bash
if [[ "\${CRON_EXIT_CODE:-0}" != 0 ]]; then exit "\$CRON_EXIT_CODE"; fi
if [[ "\${CRON_MODE:-normal}" == empty ]]; then exit 0; fi
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
stop_callback() { printf '%s\\n' stop >> "$PHASE_LOG"; }
ddl_callback() { printf '%s\\n' ddl >> "$PHASE_LOG"; }
if autorecall_recent_deployment_run "\${13}" "\${14}" "\${15}" "\${12}" stop_callback ddl_callback; then
  rc=0
else
  rc=$?
fi
printf 'driver_rc=%s\\n' "$rc"
exit 0
`);
  chmodSync(driver, 0o700);

  const baseline = join(evidence, "core-post-index.json");
  const baselineResult = spawnSync(nodePath, [fingerprintPath, "--core-db", coreDb, "--out", baseline], { encoding: "utf8" });
  assert.equal(baselineResult.status, 0, baselineResult.stderr);

  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    root,
    candidate,
    rollback,
    cwd,
    entrypoint,
    openclaw,
    driver,
    coreDb,
    evidence,
    baseline,
    cronBeforeSource,
    cronAfter,
    installLog,
    phaseLog,
  };
}

function runFixture(fixture, options = {}) {
  const env = {
    ...process.env,
    INSTALL_EXIT_CODES: options.installExitCodes ?? "0",
    CRON_EXIT_CODE: options.cronExitCode == null ? "0" : String(options.cronExitCode),
    CRON_MODE: options.cronMode ?? "normal",
    AUTORECALL_RECENT_DEPLOYMENT_LAUNCH_OBSERVED: options.launchObserved ?? "yes",
    AUTORECALL_RECENT_DEPLOYMENT_RUNTIME_STATE: options.runtimeState ?? "unchanged",
  };
  if (options.cronSource) env.CRON_SOURCE = options.cronSource;
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
  ], { encoding: "utf8", env });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  const fields = Object.fromEntries(result.stdout.trim().split("\n").filter(Boolean).map(line => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  return { result, fields, install: readLines(fixture.installLog), phases: readLines(fixture.phaseLog) };
}

test("offline deployment caller binds Core INSTALL and fresh cron facts before install", async t => {
  await t.test("normal complete input uses one immutable core-post-index baseline", () => {
    const fixture = makeFixture(t);
    const beforeHash = fileSha256(fixture.baseline);
    const run = runFixture(fixture);

    assert.equal(run.fields.driver_rc, "0");
    assert.equal(run.fields.status, "CONTINUE");
    assert.equal(run.fields.candidate_facts_status, "ok");
    assert.equal(run.fields.restart_decision, "permitted");
    assert.deepEqual(run.phases, ["stop", "ddl"]);
    assert.equal(run.install.length, 1);
    assert.equal(fileSha256(fixture.baseline), beforeHash);
    assert.equal(readLines(join(fixture.evidence, "facts-count"))[0], "1");

    const selfCompare = JSON.parse(readFileSync(join(fixture.evidence, "core-post-index-self-compare.json"), "utf8"));
    const factsCompare = JSON.parse(readFileSync(join(fixture.evidence, "core-facts-1.json"), "utf8"));
    assert.equal(selfCompare.comparison.deployment_invariant_equal, true);
    assert.equal(factsCompare.comparison.deployment_invariant_equal, true);
    assert.equal(selfCompare.comparison.baseline_path, resolve(fixture.baseline));
    assert.equal(factsCompare.comparison.baseline_path, resolve(fixture.baseline));
    assert.equal(readLines(join(fixture.evidence, "cron-before.json")).length, 1);
  });

  await t.test("recovery callback checks the recovery exit and facts report", () => {
    const fixture = makeFixture(t);
    const run = runFixture(fixture, { installExitCodes: "1,0" });

    assert.equal(run.fields.driver_rc, "1");
    assert.equal(run.fields.outcome, "candidate_failed_recovery_succeeded");
    assert.equal(run.fields.recovery_facts_status, "ok");
    assert.equal(run.fields.recovery_acceptance, "accepted");
    assert.equal(run.fields.restart_decision, "permitted");
    assert.equal(run.install.length, 2);
    assert.equal(readLines(join(fixture.evidence, "facts-count"))[0], "2");
  });

  await t.test("missing Core path blocks stop, DDL, and install", () => {
    const fixture = makeFixture(t);
    const run = runFixture(fixture, { coreDb: join(fixture.root, "missing-core.sqlite") });

    assert.equal(run.fields.driver_rc, "64");
    assert.equal(run.fields.outcome, "validation_failed");
    assert.deepEqual(run.phases, []);
    assert.deepEqual(run.install, []);
  });

  for (const [label, options] of [
    ["cron command failure", { cronExitCode: 23 }],
    ["empty cron output", { cronMode: "empty" }],
  ]) {
    await t.test(`${label} blocks before stop, DDL, and install`, () => {
      const fixture = makeFixture(t);
      const run = runFixture(fixture, options);
      assert.equal(run.fields.driver_rc, "64");
      assert.equal(run.fields.outcome, "cron_baseline_invalid");
      assert.deepEqual(run.phases, []);
      assert.deepEqual(run.install, []);
    });
  }

  await t.test("invalid and incomplete cron JSON block before stop, DDL, and install", () => {
    for (const content of [
      "not-json\n",
      JSON.stringify({ jobs: [{ id: "job-1" }] }) + "\n",
      JSON.stringify({ jobs: [], nextCursor: "page-2" }) + "\n",
    ]) {
      const fixture = makeFixture(t);
      writeFileSync(fixture.cronBeforeSource, content);
      const run = runFixture(fixture);
      assert.equal(run.fields.driver_rc, "64");
      assert.equal(run.fields.outcome, "cron_baseline_invalid");
      assert.deepEqual(run.phases, []);
      assert.deepEqual(run.install, []);
    }
  });

  await t.test("same cron id and count with changed payload is unexplained drift", () => {
    const fixture = makeFixture(t);
    writeCron(fixture.cronAfter, cronJob("changed payload"));
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
