import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const checkpoint = require("../bin/session-checkpoint.js");

test("nightly checkpoint uses targetDate for episode id/file/metadata and keeps generatedAt separate", () => {
  const generatedAt = "2026-05-28T19:30:00.000Z"; // 2026-05-29 03:30 Asia/Shanghai
  const targetDate = checkpoint.yesterdayDateStr(generatedAt);
  assert.equal(targetDate, "2026-05-28");

  const entryId = checkpoint.buildNightlyEntryId({
    targetDate,
    category: "episodic",
    generatedAt,
  });
  assert.equal(entryId, "2026-05-28_episodic_nightly_generated_033000");
  assert.equal(`${targetDate}.md`, "2026-05-28.md");

  const metadata = JSON.parse(
    checkpoint.mergeKgData(
      JSON.stringify({ episode_of: ["chunk-a"], date: targetDate }),
      { date: targetDate, generatedAt },
    ),
  );
  assert.equal(metadata.date, "2026-05-28");
  assert.equal(metadata.generatedAt, generatedAt);
});
