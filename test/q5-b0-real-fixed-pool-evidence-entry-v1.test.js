import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  Q5_B0_EXPECTED_CASE_COUNT,
  buildQ5B0EvidenceEntryManifestV1,
} from "../lib/benchmark/q5-b0-real-fixed-pool-evidence-entry-v1.js";
import { C1A_LOCOMO_SOURCE_PROFILE } from "../lib/benchmark/c1a-locomo-qualification.js";

function fakeMaterial() {
  const cases = [];
  for (let sample = 0; sample < 10; sample += 1) {
    for (let index = sample; index < Q5_B0_EXPECTED_CASE_COUNT; index += 10) {
      const goldCount = index % 17 === 0 ? 4 : (index % 5 === 0 ? 2 : 1);
      const controlAll = index % 3 === 0 ? 1 : 0;
      const complete = index % 4 !== 0;
      const candidates = Array.from({ length: 20 }, (_value, candidateIndex) => ({
        id: `sample-${sample}-case-${index}-cand-${candidateIndex}`,
        text: `candidate text ${sample} ${index} ${candidateIndex}`,
        egress: "UNKNOWN",
      }));
      cases.push({
        case_id: `sample-${sample}:qa:${index}`,
        sample_id: `sample-${sample}`,
        qa_index: index,
        query: `question ${sample} ${index}`,
        query_egress: "UNKNOWN",
        candidates,
        control_order: candidates.map(row => row.id),
        control_top3: candidates.slice(0, 3).map(row => row.id),
        control_recall_all_at_3: controlAll,
        gold_evidence_count: goldCount,
        gold_complete_in_top20: complete,
        evidence_ids: Array.from({ length: goldCount }, (_v, g) => `D${g + 1}:1`),
        category: index % 4,
        projection: { total_code_points: 1000, candidate_count: 20 },
      });
    }
  }
  return {
    schema: "memory_engine_r3_c1a_locomo_material_v1",
    source_profile: C1A_LOCOMO_SOURCE_PROFILE,
    qualification_profile: "r3_c1a_locomo_fts20_canonical_qwen3_0_6b_v1",
    evidence_limitations: {
      candidate_generation: "frozen_fts_only_not_production_hybrid",
      candidate_depth: 20,
      production_equivalent_candidate_generation: false,
      canonical_text_projection: true,
    },
    profile: {
      candidateDepth: 20,
      topK: 3,
      maxCodePointsPerCandidate: 4000,
      maxTotalCodePoints: 48000,
      deadlineMs: 5000,
    },
    cases,
  };
}

const sourceIdentity = {
  candidate_manifest_sha256: "a".repeat(64),
  overlay_sha256: "b".repeat(64),
  control_score_sha256: "c".repeat(64),
  chunk_count: 714,
  case_count: 1970,
  profile_id: C1A_LOCOMO_SOURCE_PROFILE,
};

test("Q5-B0 freezes all 1970 cases with sample-level 6/2/2 split and no conversation leakage", () => {
  const manifest = buildQ5B0EvidenceEntryManifestV1({
    material: fakeMaterial(),
    sourceIdentity,
  });

  assert.equal(manifest.population.case_count, 1970);
  assert.equal(manifest.population.sample_count, 10);
  assert.equal(manifest.population.development.sample_count, 6);
  assert.equal(manifest.population.validation.sample_count, 2);
  assert.equal(manifest.population.final_evaluation.sample_count, 2);

  const splitBySample = new Map();
  for (const row of manifest.cases) {
    const existing = splitBySample.get(row.sample_id);
    if (existing) assert.equal(existing, row.split);
    else splitBySample.set(row.sample_id, row.split);
  }
  assert.equal(splitBySample.size, 10);
  assert.equal(manifest.egress_decision, "UNKNOWN");
  assert.equal(manifest.provider_requests, 0);
  assert.equal(manifest.model_training_runs, 0);
});

test("Q5-B0 snapshots exclude raw query/candidate text and gold evidence ids", () => {
  const manifest = buildQ5B0EvidenceEntryManifestV1({
    material: fakeMaterial(),
    sourceIdentity,
  });
  const serialized = JSON.stringify(manifest);

  assert.equal(serialized.includes('"query":'), false);
  assert.equal(serialized.includes('"text":'), false);
  assert.equal(serialized.includes("evidence_ids"), false);
  assert.equal(manifest.cases.every(row => /^[0-9a-f]{64}$/u.test(row.query_sha256)), true);
  assert.equal(manifest.cases.every(row => /^[0-9a-f]{64}$/u.test(row.canonical_texts_sha256)), true);
});

test("Q5-B0 split and manifest identities are deterministic", () => {
  const first = buildQ5B0EvidenceEntryManifestV1({
    material: fakeMaterial(),
    sourceIdentity,
  });
  const second = buildQ5B0EvidenceEntryManifestV1({
    material: fakeMaterial(),
    sourceIdentity,
  });

  assert.deepEqual(first, second);
  assert.match(first.manifest_sha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(
    first.population.development.sample_ids,
    second.population.development.sample_ids,
  );
});

test("Q5-B0 frozen real LoCoMo evidence manifest has stable identity and zero sample leakage", () => {
  const path = new URL("./fixtures/q5-b0-real-fixed-pool-evidence-entry-v1.json", import.meta.url);
  const raw = readFileSync(path);
  const manifest = JSON.parse(raw.toString("utf8"));

  assert.equal(
    createHash("sha256").update(raw).digest("hex"),
    "c26f9a2feb69296f0cf6bcd48ae2c035abaf55550c153fe6a2597f314042fb05",
  );
  assert.equal(
    manifest.manifest_sha256,
    "f9262cd548c8a145da32da20f46a53872cab0310661d5b3a3055f5925ca9afe0",
  );
  assert.equal(manifest.population.case_count, 1970);
  assert.equal(manifest.population.sample_count, 10);
  assert.deepEqual(manifest.population.overall_diagnostic_strata, {
    candidate_miss: 550,
    recoverable_rank_miss: 433,
    protect: 888,
    top3_budget_infeasible: 99,
  });
  assert.equal(manifest.population.development.case_count, 1156);
  assert.equal(manifest.population.validation.case_count, 386);
  assert.equal(manifest.population.final_evaluation.case_count, 428);
  assert.equal(manifest.population.development.diagnostic_strata.recoverable_rank_miss, 257);
  assert.equal(manifest.population.validation.diagnostic_strata.recoverable_rank_miss, 90);
  assert.equal(manifest.population.final_evaluation.diagnostic_strata.recoverable_rank_miss, 86);

  const splitBySample = new Map();
  for (const row of manifest.cases) {
    const existing = splitBySample.get(row.sample_id);
    if (existing) assert.equal(existing, row.split);
    else splitBySample.set(row.sample_id, row.split);
  }
  assert.equal(splitBySample.size, 10);
  assert.equal(Math.min(...manifest.cases.map(row => row.candidate_count)), 1);
  assert.equal(Math.max(...manifest.cases.map(row => row.candidate_count)), 20);
  assert.equal(manifest.cases.filter(row => row.candidate_count === 20).length, 1814);
});

test("Q5-B0 explicitly rejects production-equivalent or egress-authorized drift", () => {
  const productionDrift = fakeMaterial();
  productionDrift.evidence_limitations.production_equivalent_candidate_generation = true;
  assert.throws(
    () => buildQ5B0EvidenceEntryManifestV1({
      material: productionDrift,
      sourceIdentity,
    }),
    /Q5_B0_PRODUCTION_EQUIVALENCE_BOUNDARY_INVALID/,
  );

  const egressDrift = fakeMaterial();
  egressDrift.cases[0].query_egress = "ALLOW";
  assert.throws(
    () => buildQ5B0EvidenceEntryManifestV1({
      material: egressDrift,
      sourceIdentity,
    }),
    /Q5_B0_EGRESS_MUST_REMAIN_UNKNOWN/,
  );
});
