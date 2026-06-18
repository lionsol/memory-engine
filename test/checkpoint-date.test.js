import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const checkpointDate = require("../lib/checkpoint/date.js");

test("yesterdayDateStr uses Asia/Shanghai business date instead of UTC date", () => {
  const generatedAt = "2026-05-28T16:30:00.000Z"; // 2026-05-29 00:30 Asia/Shanghai
  assert.equal(checkpointDate.yesterdayDateStr(generatedAt, "Asia/Shanghai"), "2026-05-28");
});

test("shiftDateString crosses month and year boundaries", () => {
  assert.equal(checkpointDate.shiftDateString("2026-03-01", -1), "2026-02-28");
  assert.equal(checkpointDate.shiftDateString("2026-01-01", -1), "2025-12-31");
});

test("buildNightlyEntryId keeps output format unchanged", () => {
  const entryId = checkpointDate.buildNightlyEntryId({
    targetDate: "2026-05-28",
    category: "episodic",
    generatedAt: "2026-05-28T19:30:00.000Z",
    timeZone: "Asia/Shanghai",
  });
  assert.equal(entryId, "2026-05-28_episodic_nightly_generated_033000");
});

test("buildNightlyEntryId keeps generatedAt and targetDate semantics separate", () => {
  const entryId = checkpointDate.buildNightlyEntryId({
    targetDate: "2026-05-28",
    category: "episodic",
    generatedAt: "2026-05-29T20:15:45.000Z",
    timeZone: "Asia/Shanghai",
  });
  assert.equal(entryId, "2026-05-28_episodic_nightly_generated_041545");
});
