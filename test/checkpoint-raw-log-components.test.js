import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const normalization = require("../lib/checkpoint/raw-log-normalization");
const toolSummary = require("../lib/checkpoint/raw-log-tool-summary");
const budget = require("../lib/checkpoint/raw-log-budget");

function createStats() {
  return {
    droppedByBudgetCount: 0,
    budgetApplied: false,
    sourceCharCountsAfter: { smartAdd: 0, dbRawLog: 0, resetTranscript: 0 },
    charsBySourceAfterBudget: { smartAdd: 0, dbRawLog: 0, resetTranscript: 0 },
    charsByRoleAfterBudget: {
      note: 0,
      user: 0,
      assistant_summary: 0,
      assistant_tool_summary: 0,
      assistant: 0,
      metadata_header: 0,
    },
  };
}

test("raw-log normalization keeps role parsing and dedupe keys stable", () => {
  assert.deepEqual(
    normalization.parseDialogueRoleBody("[2026-06-17T00:00:00.000Z | session:s1] **User:**  Hello   world "),
    { role: "user", body: "Hello   world" },
  );
  assert.equal(
    normalization.buildDialogueDedupeKey("User", " Hello   world "),
    "user|hello world",
  );
  assert.equal(
    normalization.buildDedupeKey("RAW_LOG", " Hello   world "),
    "raw_log|hello world",
  );
});

test("role inference preserves note user summary tool-summary and metadata buckets", () => {
  assert.equal(normalization.inferRoleKey({ sourceKind: "smartAdd" }), "note");
  assert.equal(normalization.inferRoleKey({ role: "user" }), "user");
  assert.equal(normalization.inferRoleKey({ role: "assistant", isAssistantSummary: true }), "assistant_summary");
  assert.equal(normalization.inferRoleKey({ role: "assistant", isToolSummary: true }), "assistant_tool_summary");
  assert.equal(normalization.inferRoleKey({ role: "assistant" }), "assistant");
  assert.equal(normalization.inferRoleKey({ role: "other" }), "metadata_header");
});

test("tool summary keeps checkpoint test git and doctor recognizers", () => {
  assert.equal(
    toolSummary.compactToolResult({
      toolName: "bash",
      command: "node --test test/a.test.js",
      output: "# pass 12\n# fail 0\nduration_ms 45.5",
    }),
    "Tool summary: tests pass=12, duration_ms=45.5",
  );
  assert.equal(
    toolSummary.compactToolResult({
      toolName: "bash",
      command: "git status --short --branch",
      output: "## main...origin/main [ahead 2]\n M index.js",
    }),
    "Tool summary: git modified=1, status=ahead 2",
  );
  assert.match(
    toolSummary.compactToolResult({
      toolName: "openclaw",
      command: "doctor",
      output: "WARNING cache stale\nERROR plugin missing",
    }),
    /^Tool summary: doctor warnings=1, errors=1, highlights=/,
  );
});

test("checkpoint dry-run summary takes precedence over generic tool recognizers", () => {
  const output = '[checkpoint] Input stats {"targetDate":"2026-06-17","finalCombinedTextCharCount":1200,"budgetApplied":true,"droppedByBudgetCount":3}\n'
    + '[checkpoint] Dry run summary {"targetDate":"2026-06-17","rawCount":8,"combinedTextCharCount":1200}';
  assert.equal(
    toolSummary.compactToolResult({ toolName: "bash", command: "npm test", output }),
    "Tool summary: checkpoint dry-run targetDate=2026-06-17, rawCount=8, combinedChars=1200, budgetApplied=true, droppedByBudget=3",
  );
});

test("budget preserves priority and enforces final source session and tool caps", () => {
  const stats = createStats();
  const entries = [
    {
      _index: 0,
      sourceKind: "resetTranscript",
      role: "assistant",
      text: "assistant chatter ".repeat(20),
      timestampMs: 1,
      sessionId: "s1",
    },
    {
      _index: 1,
      sourceKind: "resetTranscript",
      role: "user",
      text: "critical user request",
      timestampMs: 2,
      sessionId: "s1",
    },
    {
      _index: 2,
      sourceKind: "smartAdd",
      category: "preference",
      text: "User prefers explicit safety checks",
      timestampMs: null,
      sessionId: null,
    },
    {
      _index: 3,
      sourceKind: "resetTranscript",
      role: "assistant",
      isToolSummary: true,
      text: "Tool summary: tests pass=12",
      timestampMs: 3,
      sessionId: "s2",
    },
  ];
  const selected = budget.applyBudgetToEntries(entries, stats, {
    maxFinalCombinedChars: 110,
    smartAddChars: 60,
    conversationChars: 70,
    perSessionChars: 40,
    toolSummaryChars: 20,
  });
  const combined = selected.map(entry => entry.text).join(budget.ENTRY_SEPARATOR);

  assert.match(combined, /User prefers explicit safety checks/);
  assert.match(combined, /critical user request/);
  assert.doesNotMatch(combined, /assistant chatter/);
  assert.equal(combined.length <= 110, true);
  assert.equal(stats.budgetApplied, true);
  assert.equal(selected.find(entry => entry.isToolSummary)?.text.length <= 20, true);
  assert.equal(
    selected.find(entry => entry._index === 0)?.text.length < entries[0].text.length,
    true,
  );
});

test("budget summary updates canonical source and role counters", () => {
  const stats = createStats();
  const entries = [
    { sourceKind: "smartAdd", category: "preference", text: "note", role: null },
    { sourceKind: "dbRawLog", text: "question", role: "user" },
    { sourceKind: "resetTranscript", text: "Tool summary: tests pass=2", role: "assistant", isToolSummary: true },
  ];
  budget.summarizeBudgetedEntries(entries, stats);

  assert.deepEqual(stats.charsBySourceAfterBudget, {
    smartAdd: 4,
    dbRawLog: 8,
    resetTranscript: 26,
  });
  assert.equal(stats.charsByRoleAfterBudget.note, 4);
  assert.equal(stats.charsByRoleAfterBudget.user, 8);
  assert.equal(stats.charsByRoleAfterBudget.assistant_tool_summary, 26);
});
