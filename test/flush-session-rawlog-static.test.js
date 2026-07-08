import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FLUSH_SCRIPT = new URL("../bin/flush-session-rawlog.js", import.meta.url);

function readScript() {
  return readFileSync(FLUSH_SCRIPT, "utf8");
}

test("flush-session-rawlog writes event_at when available and keeps legacy updated_at fallback", () => {
  const script = readScript();
  for (const token of [
    "function toEventTimestampSec",
    "function getChunkColumns",
    "function buildChunkInsert",
    "const eventSec = toEventTimestampSec(m.ts, fallbackSec)",
    "const nowSec = Math.floor(Date.now() / 1000)",
    "if (hasDedicatedEventTime) insertColumns.push(\"event_at\")",
    "if (columns.has(\"created_at\")) insertColumns.push(\"created_at\")",
    "updated_at: chunkInsert.hasDedicatedEventTime ? nowSec : eventSec",
    "insertChunk.run(...chunkInsert.insertColumns.map((column) => chunkRow[column]))",
    ").run(chunkId, eventSec)",
  ]) {
    assert.equal(script.includes(token), true, `missing event timestamp token: ${token}`);
  }
});
