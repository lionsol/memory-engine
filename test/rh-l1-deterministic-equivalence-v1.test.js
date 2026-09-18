import test from "node:test";
import assert from "node:assert/strict";

import { buildQ4RecallHintC1FreshCorpusV1 } from "../lib/benchmark/q4-recall-hint-c1-corpus-v1.js";
import { buildRhL1PerformanceContractV1 } from "../lib/benchmark/rh-l1-performance-contract-v1.js";
import {
  createRhL1DeterministicEmbeddingV1,
  runRhL1DeterministicEquivalenceV1,
} from "../lib/benchmark/rh-l1-deterministic-equivalence-v1.js";

const SOURCE = "3".repeat(40);

test("RH-L1-E1 deterministic embedding is stable, finite, and source-independent", () => {
  const left = createRhL1DeterministicEmbeddingV1("same exact input", 2560);
  const right = createRhL1DeterministicEmbeddingV1("same exact input", 2560);
  const other = createRhL1DeterministicEmbeddingV1("different input", 2560);

  assert.equal(left.length, 2560);
  assert.deepEqual(left, right);
  assert.notDeepEqual(left, other);
  assert.ok(left.every(Number.isFinite));
  assert.ok(left.some(value => value !== 0));
});

test("RH-L1-E1 proves exact ordered equivalence through the real semantic session path", async () => {
  const corpus = buildQ4RecallHintC1FreshCorpusV1();
  const contract = buildRhL1PerformanceContractV1({ corpus, sourceCommit: SOURCE });
  const result = await runRhL1DeterministicEquivalenceV1({ corpus, contract });

  assert.equal(result.status, "PASS", JSON.stringify(result.equivalence));
  assert.equal(result.external_provider_requests, 0);
  assert.equal(result.target_case_count, 12);
  assert.equal(result.equivalence.candidate_pool_exact_count, 12);
  assert.equal(result.equivalence.ranked_top3_exact_count, 12);
  assert.equal(result.equivalence.execution_modes_valid, true);
  assert.equal(result.equivalence.usage_equal, true);
  assert.deepEqual(result.equivalence.reasons, []);
  assert.equal(result.usage.sequential.embedding_requests, 99);
  assert.equal(result.usage.parallel.embedding_requests, 99);
  assert.equal(result.usage.sequential.rerank_requests, 12);
  assert.equal(result.usage.parallel.rerank_requests, 12);
  assert.ok(result.rows.every(row => row.candidate_pool_exact && row.ranked_top3_exact));
  assert.match(result.result_sha256, /^[0-9a-f]{64}$/);
});
