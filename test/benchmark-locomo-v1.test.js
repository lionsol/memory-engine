import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  LOCOMO_CATEGORY_MAP,
  LOCOMO_DATASET_FILE_COMMIT,
  LOCOMO_DATASET_SHA256,
  LOCOMO_EVIDENCE_CANONICALIZED_V1,
  LOCOMO_EVIDENCE_STRICT_V1,
  LOCOMO_LICENSE_IDENTITY,
  LOCOMO_RETRIEVAL_KS,
  LOCOMO_RETRIEVAL_PROFILE,
  LOCOMO_SKIP_REASON_PRECEDENCE,
  LOCOMO_UPSTREAM_COMMIT,
  LOCOMO_UPSTREAM_REPOSITORY,
  buildLocomoDialogDocuments,
  buildLocomoSearchRequest,
  buildLocomoSessionDocuments,
  normalizeLocomoCase,
  projectLocomoDialogToSessions,
  scoreLocomoDialogMetrics,
  scoreLocomoRetrieval,
  scoreLocomoSessionMetrics,
  summarizeLocomoDataset,
  validateLocomoDataset,
} from "../lib/benchmark/locomo-v1.js";

function rawCase({
  sampleId = "conv-test",
  evidence = ["D1:1"],
  category = 4,
  question = "Where did Alice go?",
} = {}) {
  return {
    sample_id: sampleId,
    conversation: {
      speaker_a: "Alice",
      speaker_b: "Bob",
      session_1_date_time: "1:00 pm on 1 May, 2023",
      session_1: [
        { speaker: "Alice", dia_id: "D1:1", text: "Alice visited Kyoto." },
        { speaker: "Bob", dia_id: "D1:2", text: "That sounds memorable." },
        { speaker: "Alice", dia_id: "D1:3", text: "She plans to return." },
      ],
      session_2_date_time: "2:00 pm on 2 May, 2023",
      session_2: [
        { speaker: "Bob", dia_id: "D2:1", text: "Bob moved to Osaka." },
        { speaker: "Alice", dia_id: "D2:2", text: "I will remember that." },
      ],
    },
    qa: [{ question, answer: "SECRET GOLD ANSWER", evidence, category }],
  };
}

test("freezes LoCoMo identity, provenance, categories, and retrieval ks", () => {
  assert.equal(LOCOMO_RETRIEVAL_PROFILE, "locomo_dialog_retrieval_contract_v1");
  assert.equal(LOCOMO_UPSTREAM_REPOSITORY, "https://github.com/snap-research/locomo");
  assert.equal(LOCOMO_UPSTREAM_COMMIT, "3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376");
  assert.equal(LOCOMO_DATASET_FILE_COMMIT, "cbfbc1dba6bc53d00625212a0f22d55ffee7c1fc");
  assert.equal(LOCOMO_DATASET_SHA256, "79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4");
  assert.equal(LOCOMO_LICENSE_IDENTITY, "CC BY-NC 4.0 International");
  assert.deepEqual(LOCOMO_RETRIEVAL_KS, [1, 3, 5, 10, 30, 50]);
  assert.deepEqual(Object.fromEntries(Object.entries(LOCOMO_CATEGORY_MAP).map(([id, value]) => [id, value.name])), {
    1: "multi-hop-retrieval",
    2: "temporal-reasoning",
    3: "open-domain-knowledge",
    4: "single-hop-retrieval",
    5: "adversarial",
  });
  assert.deepEqual(LOCOMO_SKIP_REASON_PRECEDENCE, [
    "evidence_missing",
    "evidence_not_array",
    "empty_evidence",
    "malformed_evidence",
    "unmapped_evidence",
    "composite_evidence",
    "noncanonical_evidence",
    "duplicate_evidence",
  ]);
});

test("normalizes session and turn identity without using global dia_id", () => {
  const item = normalizeLocomoCase(rawCase());
  assert.equal(item.sessions.length, 2);
  assert.equal(item.turn_identity.total, 5);
  assert.equal(item.turn_identity.validated, 5);
  assert.equal(item.turn_identity.complete, true);
  assert.equal(item.sessions[0].turns[0].dia_id, "D1:1");
  assert.equal(item.sessions[0].timestamp_ms, Date.UTC(2023, 4, 1, 13, 0));
  assert.equal(item.questions[0].question_id, "conv-test:qa:0");
});

test("strict policy rejects composite, noncanonical, duplicate, malformed, and unmapped evidence", () => {
  const item = normalizeLocomoCase({
    ...rawCase({ evidence: ["D1:1; D2:1"] }),
    qa: [
      { question: "composite", answer: "gold", evidence: ["D1:1; D2:1"], category: 1 },
      { question: "noncanonical", answer: "gold", evidence: ["D1:01"], category: 2 },
      { question: "duplicate", answer: "gold", evidence: ["D1:1", "D1:1"], category: 1 },
      { question: "malformed", answer: "gold", evidence: ["D"], category: 4 },
      { question: "unmapped", answer: "gold", evidence: ["D2:99"], category: 1 },
    ],
  });
  assert.deepEqual(item.questions.map(question => question.skip_reason), [
    "composite_evidence",
    "noncanonical_evidence",
    "duplicate_evidence",
    "malformed_evidence",
    "unmapped_evidence",
  ]);
  assert.deepEqual(item.questions.map(question => question.scoreable), [false, false, false, false, false]);
});

test("canonicalized policy accepts only deterministic evidence repairs", () => {
  const item = normalizeLocomoCase({
    ...rawCase(),
    qa: [
      { question: "composite", answer: "gold", evidence: ["D1:1; D2:1"], category: 1 },
      { question: "whitespace", answer: "gold", evidence: ["D1:1 D2:1"], category: 1 },
      { question: "noncanonical", answer: "gold", evidence: ["D1:01"], category: 2 },
      { question: "duplicate", answer: "gold", evidence: ["D1:1", "D1:1"], category: 1 },
      { question: "malformed", answer: "gold", evidence: ["D"], category: 4 },
      { question: "unmapped", answer: "gold", evidence: ["D2:99"], category: 1 },
    ],
  }, { evidencePolicy: LOCOMO_EVIDENCE_CANONICALIZED_V1 });
  assert.deepEqual(item.questions.map(question => question.scoreable), [true, true, true, true, false, false]);
  assert.deepEqual(item.questions.slice(0, 4).map(question => question.evidence_session_ids), [
    ["session_1", "session_2"],
    ["session_1", "session_2"],
    ["session_1"],
    ["session_1"],
  ]);
  assert.equal(item.questions[4].skip_reason, "malformed_evidence");
  assert.equal(item.questions[5].skip_reason, "unmapped_evidence");
});

test("skip reason precedence is deterministic when a QA has multiple issues", () => {
  const item = normalizeLocomoCase({
    ...rawCase(),
    qa: [{
      question: "multiple issues",
      answer: "gold",
      evidence: ["D", "D1:1", "D1:1", "D2:99"],
      category: 1,
    }],
  });
  assert.deepEqual(item.questions[0].evidence_anomalies, [
    "malformed_evidence",
    "unmapped_evidence",
    "duplicate_evidence",
  ]);
  assert.equal(item.questions[0].skip_reason, "malformed_evidence");
});

test("empty and missing evidence are unscorable rather than retrieval hits", () => {
  const item = normalizeLocomoCase({
    ...rawCase(),
    qa: [
      { question: "empty", answer: "gold", evidence: [], category: 3 },
      { question: "missing", answer: "gold", category: 3 },
    ],
  });
  assert.equal(item.questions[0].scoreable, false);
  assert.equal(item.questions[0].skip_reason, "empty_evidence");
  assert.equal(item.questions[1].scoreable, false);
  assert.equal(item.questions[1].skip_reason, "evidence_missing");
  const score = scoreLocomoDialogMetrics(item, ["D1:1"], { questionIndex: 0 });
  assert.equal(score.metrics["recall_any@1"], null);
  assert.equal(score.first_relevant_rank, null);
});

test("dialog to session projection preserves rank and deduplicates by first occurrence", () => {
  const item = normalizeLocomoCase(rawCase({ evidence: ["D1:1", "D2:1"] }));
  assert.deepEqual(projectLocomoDialogToSessions(item, ["D1:2", "D1:1", "D2:2", "D2:1"]), [
    "session_1",
    "session_2",
  ]);
  assert.deepEqual(projectLocomoDialogToSessions(item, ["D2:1", "D1:3", "D2:2"]), [
    "session_2",
    "session_1",
  ]);
});

test("dialog-level metrics are primary and session projection is separately scored", () => {
  const item = normalizeLocomoCase(rawCase({ evidence: ["D1:1", "D1:2", "D2:1"] }));
  const dialog = scoreLocomoDialogMetrics(item, ["D2:1", "D1:2", "D1:1"], { ks: [1, 2, 3] });
  assert.equal(dialog.metric_level, "dialog");
  assert.equal(dialog.metrics["recall_any@1"], 1);
  assert.equal(dialog.metrics["recall_all@2"], 0);
  assert.equal(dialog.metrics["recall_all@3"], 1);
  assert.equal(dialog.first_relevant_rank, 1);

  const session = scoreLocomoSessionMetrics(item, ["session_2", "session_1"], { ks: [1, 2] });
  assert.equal(session.metric_level, "session");
  assert.equal(session.metrics["recall_all@1"], 0);
  assert.equal(session.metrics["recall_all@2"], 1);

  const combined = scoreLocomoRetrieval(item, ["D2:1", "D1:2", "D1:1"], { ks: [1, 2, 3] });
  assert.deepEqual(combined.projected_session_ids, ["session_2", "session_1"]);
  assert.equal(combined.dialog.metrics["recall_all@3"], 1);
  assert.equal(combined.session.metrics["recall_all@2"], 1);
});

test("corpus and search envelopes do not carry answer, evidence, or evaluator labels", () => {
  const item = normalizeLocomoCase(rawCase({ evidence: ["D1:1"] }));
  const search = buildLocomoSearchRequest(item, { topK: 7 });
  const dialogs = buildLocomoDialogDocuments(item);
  const sessions = buildLocomoSessionDocuments(item);
  for (const envelope of [search, ...dialogs, ...sessions]) {
    const serialized = JSON.stringify(envelope);
    assert.equal(serialized.includes("SECRET GOLD ANSWER"), false);
    assert.equal("answer" in envelope, false);
    assert.equal("evidence" in envelope, false);
    assert.equal("category" in envelope, false);
  }
  assert.equal(search.query, "Where did Alice go?");
  assert.equal(dialogs[0].dia_id, "D1:1");
  assert.equal(dialogs[0].session_id, "session_1");
  assert.equal(sessions.length, 2);
});

test("dataset summary freezes strict and canonicalized denominators", () => {
  const records = [
    rawCase({ sampleId: "conv-empty", evidence: [] }),
    rawCase({ sampleId: "conv-composite", evidence: ["D1:1; D2:1"] }),
    rawCase({ sampleId: "conv-noncanonical", evidence: ["D1:01"] }),
  ];
  const strict = summarizeLocomoDataset(records, { evidencePolicy: LOCOMO_EVIDENCE_STRICT_V1 });
  const canonicalized = summarizeLocomoDataset(records, { evidencePolicy: LOCOMO_EVIDENCE_CANONICALIZED_V1 });
  assert.equal(strict.questions, 3);
  assert.equal(strict.scored_cases, 0);
  assert.equal(strict.skipped_cases, 3);
  assert.equal(canonicalized.scored_cases, 2);
  assert.equal(canonicalized.skipped_cases, 1);
});

test("CLI smoke is deterministic and can require the pinned official identity", async () => {
  const cliModule = await import("../bin/benchmark-locomo-v1.js");
  const { run } = cliModule.default;
  const root = mkdtempSync(join(tmpdir(), "memory-engine-locomo-cli-"));
  const input = join(root, "fixture.json");
  writeFileSync(input, JSON.stringify([rawCase()]));
  try {
    const result = await run(["--input", input, "--json"]);
    const output = JSON.parse(result.text);
    assert.equal(output.schema, "memory_engine_locomo_v1");
    assert.equal(output.selected_evidence_policy, LOCOMO_EVIDENCE_STRICT_V1);
    assert.equal(output.scored_cases, undefined);
    assert.equal(output.selected_policy_summary.scored_cases, 1);
    assert.equal(output.dataset_sha256_matches, false);

    await assert.rejects(
      () => run(["--input", input, "--require-official"]),
      /dataset_sha256_mismatch/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("official dataset validation is available without vendoring the dataset", { skip: !existsSync(process.env.LOCOMO_DATASET_PATH || "") }, () => {
  const path = process.env.LOCOMO_DATASET_PATH;
  const bytes = readFileSync(path);
  const parsed = JSON.parse(bytes);
  const validation = validateLocomoDataset(parsed);
  assert.equal(validation.official_shape_matches, true);
  assert.deepEqual(validation.category_totals, { 1: 282, 2: 321, 3: 96, 4: 841, 5: 446 });
  assert.equal(validation.turn_identity.validated, 5882);
  assert.equal(validation.policies[LOCOMO_EVIDENCE_STRICT_V1].scored_cases, 1972);
  assert.equal(validation.policies[LOCOMO_EVIDENCE_STRICT_V1].skipped_cases, 14);
  assert.equal(validation.policies[LOCOMO_EVIDENCE_CANONICALIZED_V1].scored_cases, 1978);
  assert.equal(validation.policies[LOCOMO_EVIDENCE_CANONICALIZED_V1].skipped_cases, 8);
});
