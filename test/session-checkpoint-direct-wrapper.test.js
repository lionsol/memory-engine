import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const WRAPPER = resolve("bin/run-session-checkpoint-direct.sh");

test("direct checkpoint wrapper delegates ordered flush, Core index, and reconciliation to canonical checkpoint", () => {
  const source = readFileSync(WRAPPER, "utf8");

  assert.match(source, /MEMORY_ENGINE_NODE_BIN/);
  assert.match(source, /NODE_BIN=.*\.local\/node24\/bin\/node/);
  assert.match(source, /-x "\$NODE_BIN"/);
  assert.match(source, /"\$NODE_BIN" "\$CHECKPOINT_SCRIPT" --target-date "\$target_date"/);
  assert.doesNotMatch(source, /FLUSH_SCRIPT=/);
  assert.match(source, /see structured Business status for completeness/);
  assert.match(source, /MEMORY_ENGINE_CORE_DB_PATH:-\$HOME\/\.openclaw\/agents\/main\/agent\/openclaw-agent\.sqlite/);
  assert.doesNotMatch(source, /\.openclaw\/memory\/main\.sqlite/);

  const checkpointSource = readFileSync(resolve("bin/session-checkpoint.js"), "utf8");
  assert.match(checkpointSource, /sync-memory-index\.js/);
  const mainFlow = checkpointSource.slice(checkpointSource.indexOf("const flushResult"));
  assert.ok(mainFlow.indexOf("flushCheckpointRawLog") < mainFlow.indexOf("syncCoreMemoryIndex"));
  assert.ok(mainFlow.indexOf("syncCoreMemoryIndex") < mainFlow.indexOf("reconcileSessionFlushManagedState"));
});

test("wrapper loads cron environment and checks configuration without running checkpoint", t => {
  const root = mkdtempSync(resolve(tmpdir(), "checkpoint-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const envFile = resolve(root, "checkpoint.env"), memoryDir = resolve(root, "memory");
  writeFileSync(envFile, [
    'MEMORY_ENGINE_CHECKPOINT_SUMMARY_MODE=derived',
    'MEMORY_ENGINE_CHECKPOINT_DERIVED_TRANSPORT=http',
    'MEMORY_ENGINE_CHECKPOINT_SUMMARY_INPUT_CHARS=200000',
    'MEMORY_ENGINE_CHECKPOINT_SUMMARY_OUTPUT_CHARS=20000',
    'MEMORY_ENGINE_MEMORY_DIR="' + memoryDir + '"',
  ].join("\n"));
  const result = spawnSync("bash", [WRAPPER, "--check-config"], { encoding: "utf8",
    env: { ...process.env, MEMORY_ENGINE_NODE_BIN: process.execPath, MEMORY_ENGINE_CHECKPOINT_ENV_FILE: envFile } });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(config.status, "CONFIG_OK"); assert.equal(config.memory_dir, memoryDir);
  assert.equal(config.summary_mode, "derived"); assert.equal(config.input_chars_per_batch, 200000);
  assert.equal(config.model_requests, 0); assert.equal(config.database_operations, 0);
  assert.equal(existsSync(memoryDir), false);
  writeFileSync(envFile, 'MEMORY_ENGINE_CHECKPOINT_SUMMARY_INPUT_CHARS=invalid\n');
  const invalid = spawnSync("bash", [WRAPPER, "--check-config"], { encoding: "utf8",
    env: { ...process.env, MEMORY_ENGINE_NODE_BIN: process.execPath, MEMORY_ENGINE_CHECKPOINT_ENV_FILE: envFile } });
  assert.equal(invalid.status, 1);
  assert.equal(JSON.parse(invalid.stderr).error, "derived_budget_invalid");
  assert.equal(existsSync(memoryDir), false);
});

test("direct checkpoint wrapper delegates date resolution to the canonical Node resolver", () => {
  const source = readFileSync(WRAPPER, "utf8");

  assert.match(source, /BUSINESS_TIME_SCRIPT/);
  assert.match(source, /resolve-business-time\.js/);
  assert.match(source, /--timezone/);
  assert.match(source, /export MEMORY_ENGINE_TIME_ZONE=/);
  assert.doesNotMatch(source, /date\s+-d\s+['\"]yesterday/);
});
