import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const RUNBOOK = new URL("../docs/auto-recall-memory-card-runtime-runbook.md", import.meta.url);

function readRunbook() {
  return readFileSync(RUNBOOK, "utf8");
}

test("memory card runtime runbook exists", () => {
  assert.equal(existsSync(RUNBOOK), true);
});

test("runbook records P4 phase map and key files", () => {
  const doc = readRunbook();

  for (const token of [
    "P4.1 Design freeze",
    "P4.2 Projection helpers",
    "P4.3 Replay integration",
    "P4.4 Console preview",
    "P4.4b Replay report export checkpoint",
    "P4.5 Gated runtime experiment",
    "docs/auto-recall-memory-card-object-model.md",
    "lib/recall/auto-recall-memory-card.js",
    "lib/recall/auto-recall-turn-gold-set.js",
    "bin/export-turn-gold-set-replay-report.js",
    "bin/run-auto-recall-card-runtime-smoke.js",
  ]) {
    assert.match(doc, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("runbook states card-first runtime is default disabled and edi-only", () => {
  const doc = readRunbook();

  assert.match(doc, /default disabled/i);
  assert.match(doc, /default runtime behavior remains raw-text/i);
  assert.match(doc, /cardFirstRuntime\.enabled is absent or false -> raw_text/i);
  assert.match(doc, /edi-only/i);
  assert.match(doc, /agentId=edi/i);
  assert.match(doc, /task-planner.*raw-text/i);
  assert.match(doc, /Do not enable card-first runtime for `task-planner`/i);
  assert.match(doc, /Do not enable card-first runtime for Codex CLI/i);
});

test("runbook documents activation config and rollback", () => {
  const doc = readRunbook();

  assert.match(doc, /"cardFirstRuntime"/);
  assert.match(doc, /"enabled": true/);
  assert.match(doc, /"card_first_runtime"/);
  assert.match(doc, /"enabled": false/);
  assert.match(doc, /remove `cardFirstRuntime` entirely/i);
  assert.match(doc, /Fastest operational rollback/i);
});

test("runbook preserves no-mutation and no-full-content invariants", () => {
  const doc = readRunbook();

  for (const required of [
    "no DB migration",
    "no storage rewrite",
    "no retrieval ranking change",
    "no automatic `memory_engine_get` call",
    "no full content injection",
    "no reinforcement from rendering or search",
    "cited-id-only reinforcement remains the invariant",
    "The supplement must not contain full original memory body text",
  ]) {
    assert.match(doc, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
});

test("runbook documents observability fields and event semantics", () => {
  const doc = readRunbook();

  assert.match(doc, /card_first_runtime_enabled/);
  assert.match(doc, /auto_recall_disclosure_mode/);
  assert.match(doc, /disclosure_mode/);
  assert.match(doc, /raw_text/);
  assert.match(doc, /memory_card/);
  assert.match(doc, /event type remains `memory_injected`/i);
});

test("runbook includes verification commands and console preview procedure", () => {
  const doc = readRunbook();

  for (const required of [
    "node bin/run-auto-recall-card-runtime-smoke.js --json",
    "node bin/export-turn-gold-set-replay-report.js --json",
    "WRITE_TURN_GOLD_REPLAY_REPORT",
    "http://127.0.0.1:8787/reports",
    "test/auto-recall-card-runtime-smoke.test.js",
    "test/console-reports.test.js",
  ]) {
    assert.match(doc, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("runbook forbids treating cards or search results as citations", () => {
  const doc = readRunbook();

  assert.match(doc, /card rendered != cited/i);
  assert.match(doc, /search result != cited/i);
  assert.match(doc, /Do not treat card render, card injection, search result, or Console preview as citation/i);
  assert.match(doc, /Do not reinforce memory because a card was displayed/i);
});

test("runbook names P5 canary as next work instead of broad rollout", () => {
  const doc = readRunbook();

  assert.match(doc, /P5 should focus on a real, opt-in canary plan/i);
  assert.match(doc, /local-only toggle/i);
  assert.match(doc, /short `edi` canary session/i);
  assert.match(doc, /compare answer quality and citation behavior against raw-text baseline/i);
  assert.match(doc, /experiment-only or become the default for `edi`/i);
});
