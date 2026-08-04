import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WRAPPER = resolve("bin/run-session-checkpoint-direct.sh");

test("direct checkpoint wrapper uses Node 24 and target-date-bounded commands", () => {
  const source = readFileSync(WRAPPER, "utf8");

  assert.match(source, /MEMORY_ENGINE_NODE_BIN/);
  assert.match(source, /NODE_BIN=.*\.local\/node24\/bin\/node/);
  assert.match(source, /-x \"\$NODE_BIN\"/);
  assert.match(source, /\"\$NODE_BIN\" \"\$FLUSH_SCRIPT\" --checkpoint --target-date \"\$target_date\"/);
  assert.match(source, /\"\$NODE_BIN\" \"\$CHECKPOINT_SCRIPT\" --target-date \"\$target_date\"/);
  assert.doesNotMatch(source, /\bnode \"\$FLUSH_SCRIPT\"/);
  assert.doesNotMatch(source, /\bnode \"\$CHECKPOINT_SCRIPT\"/);
  assert.match(source, /MEMORY_ENGINE_CORE_DB_PATH:-\$HOME\/\.openclaw\/agents\/main\/agent\/openclaw-agent\.sqlite/);
  assert.doesNotMatch(source, /\.openclaw\/memory\/main\.sqlite/);
});
