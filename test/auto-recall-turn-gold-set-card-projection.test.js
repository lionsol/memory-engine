import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTurnGoldSetCardProjection,
  replayTurnGoldSet,
  replayTurnGoldSetJsonl,
} from "../lib/recall/auto-recall-turn-gold-set.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seedPath = resolve(repoRoot, "test/fixtures/auto-recall-turn-gold-set.seed.jsonl");

function seedContent() {
  return readFileSync(seedPath, "utf8");
}

test("turn gold-set replay includes read-only card projection summary", () => {
  const report = replayTurnGoldSetJsonl(seedContent());

  assert.equal(report.summary.total_count, 12);
  assert.equal(report.summary.passed_count, 12);
  assert.equal(report.summary.card_expected_count, 5);
  assert.equal(report.summary.card_projection_count, 5);
  assert.equal(report.summary.full_content_on_get_expected_count, 0);
  assert.equal(report.side_effects.db_writes, false);
  assert.equal(report.side_effects.memory_file_mutation, false);
  assert.equal(report.side_effects.dataset_file_mutation, false);
  assert.equal(report.side_effects.retrieval, false);
  assert.equal(report.side_effects.injection, false);
  assert.equal(report.side_effects.reinforce, false);
});

test("positive recall rows get expected memory-card projection without full content", () => {
  const report = replayTurnGoldSetJsonl(seedContent());
  const result = report.results.find(item => item.turn_id === "seed_long_project_review_001");

  assert.equal(result.pass, true);
  assert.equal(result.expected.disclosure_level, "memory_card");
  assert.equal(result.card_projection.expected.card_expected, true);
  assert.equal(result.card_projection.actual.runtime_should_recall, true);
  assert.equal(result.card_projection.actual.projection_status, "projected_expected_card");

  const card = result.card_projection.memory_card;
  assert.equal(card.memory_id, "turn_gold_seed_long_project_review_001");
  assert.equal(card.disclosure_level, "memory_card");
  assert.equal(card.category, "project");
  assert.equal(card.kind, "decision");
  assert.match(card.title, /Expected memory card/);
  assert.match(card.summary, /Expected memory_card disclosure/);
  assert.match(card.source_hint, /test\/fixtures\/auto-recall-turn-gold-set\.seed\.jsonl:9-9/);
  assert.equal(card.get_token, "memory_engine_get:turn_gold_seed_long_project_review_001");
  assert.equal(Object.hasOwn(card, "text"), false);
  assert.equal(Object.hasOwn(card, "full_content"), false);
  assert.equal(Object.hasOwn(card, "content_ref"), false);
});

test("no-recall rows carry not-expected card projection and no card", () => {
  const report = replayTurnGoldSetJsonl(seedContent());
  const result = report.results.find(item => item.turn_id === "seed_long_rewrite_001");

  assert.equal(result.pass, true);
  assert.equal(result.expected.disclosure_level, "none");
  assert.equal(result.card_projection.expected.disclosure_level, "none");
  assert.equal(result.card_projection.expected.card_expected, false);
  assert.equal(result.card_projection.actual.runtime_should_recall, false);
  assert.equal(result.card_projection.actual.projection_status, "not_expected");
  assert.equal(result.card_projection.memory_object, null);
  assert.equal(result.card_projection.memory_card, null);
});

test("full_content_on_get labels project a card with get token but no injected full content", () => {
  const rows = [{
    turn_id: "custom_full_content_get_001",
    schema_version: 1,
    prompt: "继续上次 memory-engine P4 card object 设计",
    task_intent: "continue_prior_work",
    recall_intent: ["project_state"],
    disclosure_level: "full_content_on_get",
    expected_should_recall: true,
    expected_intent_reason: "explicit_history_context",
    expected_focused_query_contains: ["memory-engine"],
    label_confidence: "high",
  }];

  const report = replayTurnGoldSet(rows);
  const [result] = report.results;

  assert.equal(report.summary.card_expected_count, 1);
  assert.equal(report.summary.card_projection_count, 1);
  assert.equal(report.summary.full_content_on_get_expected_count, 1);
  assert.equal(result.card_projection.expected.full_content_on_get_expected, true);
  assert.equal(result.card_projection.memory_object.policy.disclosure_level, "full_content_on_get");
  assert.equal(result.card_projection.memory_object.policy.can_get_full_content, true);
  assert.equal(result.card_projection.memory_object.policy.can_inject_card, false);
  assert.equal(result.card_projection.memory_card.disclosure_level, "full_content_on_get");
  assert.equal(result.card_projection.memory_card.get_token, "memory_engine_get:turn_gold_custom_full_content_get_001");
  assert.equal(Object.hasOwn(result.card_projection.memory_card, "full_content"), false);
});

test("direct card projection helper is read-only and can project expected cards", () => {
  const projection = buildTurnGoldSetCardProjection({
    turn_id: "direct_projection_001",
    schema_version: 1,
    prompt: "结合之前 memory-engine 方案继续",
    task_intent: "continue_prior_work",
    recall_intent: ["task_state"],
    disclosure_level: "memory_card",
    expected_should_recall: true,
    label_confidence: "medium",
  }, {
    should_recall: true,
    focused_query: "memory-engine 方案",
  }, {
    lineNumber: 7,
  });

  assert.equal(projection.mode, "read_only_turn_gold_set_card_projection");
  assert.equal(projection.expected.card_expected, true);
  assert.equal(projection.memory_object.classification.kind, "task_state");
  assert.equal(projection.memory_object.classification.scope, "task_state");
  assert.equal(projection.memory_object.confidence.score, 0.7);
  assert.equal(projection.memory_card.source_hint, "test/fixtures/auto-recall-turn-gold-set.seed.jsonl:7-7");
  assert.deepEqual(projection.side_effects, {
    db_writes: false,
    memory_file_mutation: false,
    dataset_file_mutation: false,
    retrieval: false,
    injection: false,
    cleanup_apply: false,
    archive: false,
    quarantine: false,
    reinforce: false,
    llm: false,
    network: false,
    runtime_report_files: false,
  });
});
