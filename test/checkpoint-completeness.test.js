import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const checkpointCompleteness = require("../lib/checkpoint/completeness.js");

test("empty rawLogs => no_raw_logs and shouldCallLlm false", () => {
  const result = checkpointCompleteness.assessCheckpointCompleteness([]);
  assert.equal(result.status, "no_raw_logs");
  assert.equal(result.shouldCallLlm, false);
  assert.equal(result.rawCount, 0);
  assert.equal(result.allCount, 0);
  assert.equal(result.conversationCount, 0);
});

test("whitespace-only logs => all_logs_empty and shouldCallLlm false", () => {
  const result = checkpointCompleteness.assessCheckpointCompleteness([
    { category: "raw_log", text: "   ", source: "conversation" },
    { category: "note", text: "\n\t", source: "note" },
  ]);
  assert.equal(result.status, "all_logs_empty");
  assert.equal(result.shouldCallLlm, false);
  assert.equal(result.rawCount, 2);
  assert.equal(result.allCount, 0);
  assert.equal(result.combinedText, "");
});

test("note-only logs => no_conversation and counts remain correct", () => {
  const result = checkpointCompleteness.assessCheckpointCompleteness([
    { category: "preference", text: "note a", source: "note" },
    { category: "raw_log", text: "note b", source: "note" },
  ]);
  assert.equal(result.status, "no_conversation");
  assert.equal(result.shouldCallLlm, false);
  assert.equal(result.noteCount, 2);
  assert.equal(result.allCount, 2);
  assert.equal(result.conversationCount, 0);
});

test("mixed note and conversation => ok and shouldCallLlm true", () => {
  const result = checkpointCompleteness.assessCheckpointCompleteness([
    { category: "preference", text: "note a", source: "note" },
    { category: "raw_log", text: "**User:** hi", source: "conversation" },
  ]);
  assert.equal(result.status, "ok");
  assert.equal(result.shouldCallLlm, true);
  assert.equal(result.noteCount, 1);
  assert.equal(result.allCount, 2);
  assert.equal(result.conversationCount, 1);
});

test("combinedText keeps current order and separator format", () => {
  const result = checkpointCompleteness.assessCheckpointCompleteness([
    { category: "raw_log", text: " first ", source: "conversation" },
    { category: "raw_log", text: "second", source: "note" },
    { category: "raw_log", text: " third ", source: "conversation" },
  ]);
  assert.equal(result.combinedText, "first\n---\nsecond\n---\nthird");
});
