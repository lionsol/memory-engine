import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("direct checkpoint wrapper delegates date resolution to the canonical Node resolver", () => {
  const source = readFileSync(WRAPPER, "utf8");

  assert.match(source, /BUSINESS_TIME_SCRIPT/);
  assert.match(source, /resolve-business-time\.js/);
  assert.match(source, /--timezone/);
  assert.match(source, /export MEMORY_ENGINE_TIME_ZONE=/);
  assert.doesNotMatch(source, /date\s+-d\s+['\"]yesterday/);
});
