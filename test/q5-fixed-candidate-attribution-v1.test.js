import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  Q5_Q4_SOURCE_BINDINGS,
  analyzeQ5FixedCandidateFixtureV1,
  buildQ5FixedCandidateDerivedFixtureV1,
} from "../lib/benchmark/q5-fixed-candidate-attribution-v1.js";

const fixture = JSON.parse(readFileSync(
  new URL("./fixtures/q5-fixed-candidate-q4-derived-v1.json", import.meta.url),
  "utf8",
));

function sourceResultFromFixture(source, binding) {
  return {
    status: "PASS",
    top_k: 3,
    candidate_depth: 20,
    source_commit: binding.source_commit,
    result_sha256: binding.result_sha256,
    manifest_sha256: binding.manifest_sha256,
    evaluation: {
      rows: source.cases.map(row => ({
        case_id: row.case_id,
        family: row.family,
        gold_evidence_ids: row.gold_evidence_ids,
        baseline: {
          candidate_pool_ids: row.baseline.candidate_pool_ids,
          ranked_top3_ids: row.baseline.ranked_top3_ids,
        },
        hint: {
          candidate_pool_ids: row.hint.candidate_pool_ids,
          ranked_top3_ids: row.hint.ranked_top3_ids,
        },
      })),
    },
  };
}

function rehash(value) {
  const { fixture_sha256: _ignored, ...body } = value;
  return {
    ...body,
    fixture_sha256: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
  };
}

test("Q5-A derived fixture reproducibly binds the frozen Q4 C1b/C2 results and corpora", () => {
  const c1 = fixture.sources.find(row => row.source_name === "q4_c1b_development");
  const c2 = fixture.sources.find(row => row.source_name === "q4_c2_holdout");

  const rebuilt = buildQ5FixedCandidateDerivedFixtureV1({
    c1bResult: sourceResultFromFixture(c1, Q5_Q4_SOURCE_BINDINGS.c1b_development),
    c2Result: sourceResultFromFixture(c2, Q5_Q4_SOURCE_BINDINGS.c2_holdout),
    c1bResultFileSha256: Q5_Q4_SOURCE_BINDINGS.c1b_development.result_file_sha256,
    c2ResultFileSha256: Q5_Q4_SOURCE_BINDINGS.c2_holdout.result_file_sha256,
  });

  assert.deepEqual(rebuilt, fixture);
  assert.equal(fixture.fixture_sha256, "077b02f16c7bd463eb5f5120930473f653bf5ae37e1a16cdb377e88fd3a6b405");
  assert.equal(fixture.sources.length, 2);
  assert.equal(fixture.sources.reduce((sum, source) => sum + source.cases.length, 0), 40);
  assert.equal(fixture.sources.reduce((sum, source) => sum + source.memories.length, 0), 104);
});

test("Q5-A top3 oracle shows all observed pool-complete/top3-incomplete Q4 snapshots are top3-feasible", () => {
  const result = analyzeQ5FixedCandidateFixtureV1(fixture);

  assert.equal(result.findings.length, 35);
  assert.equal(result.findings.every(row => row.oracle.oracle_top3_feasible), true);
  assert.equal(result.findings.every(row => row.oracle.oracle_top3_recall_all === 1), true);
  assert.equal(result.findings.every(row => row.oracle.oracle_top3_ids.length <= 3), true);
  assert.equal(result.findings.every(row => row.rank_input_preserved), true);
  assert.equal(result.findings.every(row => row.rank_input_truncated_count === 0), true);

  const recovered = result.findings.filter(row => row.recovered_pool_but_top3_incomplete);
  assert.equal(recovered.length, 7);
  assert.deepEqual(
    recovered.reduce((acc, row) => {
      acc[row.source_name] = (acc[row.source_name] || 0) + 1;
      return acc;
    }, {}),
    {
      q4_c1b_development: 4,
      q4_c2_holdout: 3,
    },
  );
});

test("Q5-A deterministic attribution keeps LTR undecided and localizes Q4 synthetic selection failures", () => {
  const result = analyzeQ5FixedCandidateFixtureV1(fixture);
  const counts = result.findings.reduce((acc, row) => {
    acc[row.primary_attribution] = (acc[row.primary_attribution] || 0) + 1;
    return acc;
  }, {});

  assert.deepEqual(counts, {
    RANK_SELECTION_ERROR: 21,
    REDUNDANT_SELECTION: 14,
  });

  assert.deepEqual(result.summaries.q4_c1b_development.hint, {
    case_snapshot_count: 9,
    oracle_top3_feasible_count: 9,
    rank_input_preserved_count: 9,
    recovered_pool_but_top3_incomplete_count: 4,
    attribution_counts: {
      RANK_SELECTION_ERROR: 9,
      REDUNDANT_SELECTION: 0,
      TEMPORAL_VERSION_CONFLICT: 0,
      TOP3_CAPACITY_LIMIT: 0,
      RANK_INPUT_INFORMATION_LOSS: 0,
      MIXED_OR_UNRESOLVED: 0,
    },
    family_counts: {
      entity_reference: 2,
      multi_facet: 3,
      temporal_relation: 4,
    },
  });

  assert.deepEqual(result.summaries.q4_c2_holdout.hint, {
    case_snapshot_count: 12,
    oracle_top3_feasible_count: 12,
    rank_input_preserved_count: 12,
    recovered_pool_but_top3_incomplete_count: 3,
    attribution_counts: {
      RANK_SELECTION_ERROR: 4,
      REDUNDANT_SELECTION: 8,
      TEMPORAL_VERSION_CONFLICT: 0,
      TOP3_CAPACITY_LIMIT: 0,
      RANK_INPUT_INFORMATION_LOSS: 0,
      MIXED_OR_UNRESOLVED: 0,
    },
    family_counts: {
      entity_reference: 4,
      multi_facet: 8,
    },
  });

  assert.equal(result.provider_requests, 0);
  assert.equal(result.model_training_runs, 0);
});

test("Q5-A fixture validation fails closed on content/hash drift and topK changes", () => {
  const hashDrift = structuredClone(fixture);
  hashDrift.sources[0].cases[0].query += " drift";
  assert.throws(
    () => analyzeQ5FixedCandidateFixtureV1(hashDrift),
    /Q5_FIXTURE_HASH_MISMATCH/,
  );

  const topKDrift = rehash({ ...structuredClone(fixture), top_k: 4 });
  assert.throws(
    () => analyzeQ5FixedCandidateFixtureV1(topKDrift),
    /Q5_FIXTURE_TOPK_DRIFT/,
  );
});
