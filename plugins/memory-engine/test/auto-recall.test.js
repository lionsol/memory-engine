import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldForceAutoRecall,
  shouldSkipAutoRecall,
  formatAutoRecallContext,
} from "../auto-recall.js";

test("skips slash commands", () => {
  assert.equal(shouldSkipAutoRecall("/help"), true);
  assert.equal(shouldForceAutoRecall("/memory previous"), false);
});

test("skips greetings and acknowledgements", () => {
  assert.equal(shouldSkipAutoRecall("hello"), true);
  assert.equal(shouldSkipAutoRecall("ok"), true);
  assert.equal(shouldSkipAutoRecall("continue"), true);
});

test("forces recall for memory trigger phrases", () => {
  assert.equal(shouldForceAutoRecall("do you remember my last preference"), true);
  assert.equal(shouldSkipAutoRecall("previous"), false);
  assert.equal(shouldForceAutoRecall("recall my preference"), true);
});

test("does not skip substantive short prompt", () => {
  assert.equal(shouldSkipAutoRecall("fix startup dependency issue"), false);
});

test("formats top memory results as prepend context", () => {
  const text = formatAutoRecallContext([
    {
      id: "abcdef1234567890",
      category: "preference",
      confidence: 0.82,
      sources: ["vector", "fts"],
      text: "User prefers explicit opt-in features.",
    },
  ]);

  assert.match(text, /Auto Recall/);
  assert.match(text, /abcdef1234567890/);
  assert.match(text, /preference/);
  assert.match(text, /memory_engine action="cite"/);
});