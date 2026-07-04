import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FLUSH_SCRIPT = new URL("../bin/flush-session-rawlog.js", import.meta.url);

function readScript() {
  return readFileSync(FLUSH_SCRIPT, "utf8");
}

test("flush-session-rawlog stores raw_log event timestamp instead of flush time", () => {
  const script = readScript();
  for (const token of [
    "function toEventTimestampSec",
    "const eventSec = toEventTimestampSec(m.ts, fallbackSec)",
    "Do not use flush time here.",
    "VALUES (?, ?, 'memory', 0, 0, ?, 'flush-script', ?, '', ?)",
    ").run(chunkId, smartAddPath, hash(m.text), m.text, eventSec)",
    ").run(chunkId, eventSec)",
  ]) {
    assert.equal(script.includes(token), true, `missing event timestamp token: ${token}`);
  }
  assert.equal(script.includes("const nowSec = Math.floor(Date.now() / 1000)"), false);
});
