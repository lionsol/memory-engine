import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  Q5_B2_EXPECTED_B1_MANIFEST_SHA256,
  validateQ5B2PacketV1,
} from "../lib/benchmark/q5-b2-fixed-pool-score-capture-v1.js";

const fixtureUrl = new URL("./fixtures/q5-b2-real-score-capture-v1.json", import.meta.url);
const raw = readFileSync(fixtureUrl);
const packet = JSON.parse(raw.toString("utf8"));

test("Q5-B2 frozen real score packet preserves exact transaction identity", () => {
  const validation = validateQ5B2PacketV1(packet);

  assert.equal(validation.valid, true);
  assert.equal(validation.case_count, 512);
  assert.equal(
    validation.packet_sha256,
    "ebf1cadc0204fb2e81e2603f8d1027785446d03cafd64c1e3ad434b4c8fcd598",
  );
  assert.equal(packet.source_commit, "9e6154e761a4d6301a021d8e785d20e144da6232");
  assert.equal(packet.source_b1_manifest_sha256, Q5_B2_EXPECTED_B1_MANIFEST_SHA256);
  assert.equal(packet.case_count, 512);
  assert.equal(packet.contains_gold_fields, false);
  assert.equal(packet.top_k, 3);
  assert.equal(packet.candidate_depth_max, 20);
  assert.equal(
    createHash("sha256").update(raw).digest("hex"),
    "3f43e979901ee618d53cdbc577c498570b8451c1797da781992918cf04a8c9be",
  );
});

test("Q5-B2 frozen packet covers all selected cases exactly once with complete finite scores", () => {
  const ids = packet.cases.map(row => row.case_id);
  assert.equal(new Set(ids).size, 512);

  const splitCounts = packet.cases.reduce((counts, row) => {
    counts[row.split] = (counts[row.split] || 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(splitCounts, {
    development: 256,
    validation: 128,
    final_evaluation: 128,
  });

  assert.equal(
    packet.cases.reduce((sum, row) => sum + row.candidate_count, 0),
    9734,
  );
  assert.equal(Math.min(...packet.cases.map(row => row.candidate_count)), 1);
  assert.equal(Math.max(...packet.cases.map(row => row.candidate_count)), 20);
  assert.equal(
    packet.cases.every(row => row.candidates.every(candidate => (
      Number.isFinite(candidate.rerank_score)
      && Number.isInteger(candidate.pre_rerank_rank)
      && Number.isInteger(candidate.rerank_rank)
    ))),
    true,
  );
});

test("Q5-B2 frozen packet contains no forbidden raw or evaluator fields", () => {
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
