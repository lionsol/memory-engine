import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { validateQ5SelectionSignalPacketV1 } from "../lib/benchmark/q5-selection-signal-contract-v1.js";
import { R3_C1_B_PROVIDER_PROFILE } from "../lib/recall/hybrid/explicit-search-rerank-provider-policy.js";

const packet = JSON.parse(readFileSync(
  new URL("./fixtures/q5-fixed-pool-rerank-score-capture-v1.json", import.meta.url),
  "utf8",
));

test("Q5-A5 frozen real score packet validates and preserves the exact transaction identity", () => {
  const validation = validateQ5SelectionSignalPacketV1(packet);

  assert.equal(validation.valid, true);
  assert.equal(validation.case_count, 80);
  assert.equal(
    validation.packet_sha256,
    "a148f6f2c5d378442714c8ba3ce6a853e4f895e0d37385f9e075a57f523b8257",
  );
  assert.equal(packet.source_commit, "78f2e029039587040d4f62b4447ed3ddccd15bd5");
  assert.equal(
    packet.fixture_sha256,
    "077b02f16c7bd463eb5f5120930473f653bf5ae37e1a16cdb377e88fd3a6b405",
  );
  assert.equal(packet.top_k, 3);
  assert.equal(packet.candidate_depth, 20);
  assert.equal(packet.contains_gold_fields, false);
  assert.equal(packet.cases.length, 80);
  assert.equal(new Set(packet.cases.map(row => (
    `${row.source_name}\0${row.case_id}\0${row.arm}`
  ))).size, 80);
});

test("Q5-A5 real packet contains complete finite scores for all 20 candidates per case-arm", () => {
  assert.equal(packet.cases.every(row => row.candidate_count === 20), true);
  assert.equal(packet.cases.every(row => row.candidates.length === 20), true);
  assert.equal(packet.cases.every(row => row.candidates.every(candidate => (
    Number.isFinite(candidate.rerank_score)
    && Number.isInteger(candidate.pre_rerank_rank)
    && Number.isInteger(candidate.rerank_rank)
  ))), true);
  assert.equal(packet.cases.every(row => (
    row.adapter_identity.provider === R3_C1_B_PROVIDER_PROFILE.adapterIdentity.provider
    && row.adapter_identity.model === R3_C1_B_PROVIDER_PROFILE.adapterIdentity.model
    && row.adapter_identity.revision === R3_C1_B_PROVIDER_PROFILE.adapterIdentity.revision
  )), true);
});

test("Q5-A5 frozen packet persists no forbidden raw query/candidate/evaluator fields", () => {
  const forbidden = [];
  const exactForbidden = new Set([
    "gold",
    "gold_evidence_ids",
    "label",
    "labels",
    "relevance_label",
    "relevance_labels",
    "evaluator",
    "evaluator_only",
    "answer",
    "answers",
    "acceptance",
    "acceptance_case",
    "acceptance_label",
    "query",
    "text",
    "candidate_text",
    "memory_text",
    "documents",
    "prompt",
  ]);

  const walk = (value, path = "packet") => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      const normalized = key.toLowerCase();
      if (
        exactForbidden.has(normalized)
        || normalized.startsWith("gold_")
        || normalized.startsWith("evaluator_")
        || normalized.startsWith("acceptance_")
      ) {
        forbidden.push(`${path}.${key}`);
      }
      walk(item, `${path}.${key}`);
    }
  };

  walk(packet);
  assert.deepEqual(forbidden, []);
});
