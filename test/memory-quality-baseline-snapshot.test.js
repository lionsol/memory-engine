import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMemoryQualityBaselineSnapshot,
  MEMORY_QUALITY_BASELINE_LEVEL_ORDER,
  stableStringify,
} from "../lib/quality/memory-quality-baseline-snapshot.js";

const EXPECTED_CONTRACT_HASH = "548c34bd0b8d773ceafa0e37afc01b03e2b253bbb0b6582b1dba589b74718fce";
const EXPECTED_LEVEL_HASH = "f1cb860a5729d236622c0acd9e38aafb5586c5d0ecb29236798f7b8fd2f97448";
const EXPECTED_STRUCTURE_HASH = "fa271e024aa45043104b986a4bfe31d299e2e57dab93a87d6f39b268de1e56ca";

const EXPECTED_CONTRACTS = [
  {
    index: 0,
    id: "unknown_memory_paths_clean",
    level: "structural",
    name: "unknown memory path audit reports unknown_count === 0",
  },
  {
    index: 1,
    id: "active_memory_chunks_without_confidence_zero",
    level: "quality",
    name: "memory quality eval active-memory chunks_without_confidence_count === 0",
  },
  {
    index: 2,
    id: "active_memory_lifecycle_owned_chunks_without_confidence_zero",
    level: "quality",
    name: "memory quality eval active-memory lifecycle_owned_chunks_without_confidence_count === 0",
  },
  {
    index: 3,
    id: "process_boundary_pass",
    level: "process_boundary",
    name: "memory process boundary audit still passes",
  },
  {
    index: 4,
    id: "legacy_singleton_cleanup_no_actionable_target",
    level: "cleanup",
    name: "confirmed legacy singleton stale cleanup dry-run has no actionable target",
  },
  {
    index: 5,
    id: "auto_recall_suspected_tool_output_denied",
    level: "recall_safety",
    name: "autoRecall safety smoke denies suspected_tool_output",
  },
  {
    index: 6,
    id: "auto_recall_dreaming_artifact_denied",
    level: "recall_safety",
    name: "autoRecall safety smoke denies dreaming artifact candidate",
  },
];

const EXPECTED_LEVELS = {
  structural: {
    count: 1,
    contract_ids: [
      "unknown_memory_paths_clean",
    ],
  },
  quality: {
    count: 2,
    contract_ids: [
      "active_memory_chunks_without_confidence_zero",
      "active_memory_lifecycle_owned_chunks_without_confidence_zero",
    ],
  },
  process_boundary: {
    count: 1,
    contract_ids: [
      "process_boundary_pass",
    ],
  },
  cleanup: {
    count: 1,
    contract_ids: [
      "legacy_singleton_cleanup_no_actionable_target",
    ],
  },
  recall_safety: {
    count: 2,
    contract_ids: [
      "auto_recall_suspected_tool_output_denied",
      "auto_recall_dreaming_artifact_denied",
    ],
  },
};

test("baseline snapshot level order is frozen", () => {
  assert.deepEqual(MEMORY_QUALITY_BASELINE_LEVEL_ORDER, [
    "structural",
    "quality",
    "process_boundary",
    "cleanup",
    "recall_safety",
  ]);
});

test("baseline snapshot structure is deterministic", () => {
  const first = buildMemoryQualityBaselineSnapshot();
  const second = buildMemoryQualityBaselineSnapshot();

  assert.deepEqual(first, second);
  assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
});

test("baseline snapshot hashes are frozen regression guards", () => {
  const snapshot = buildMemoryQualityBaselineSnapshot();

  assert.equal(snapshot.contract_count, 7);
  assert.equal(snapshot.contract_hash, EXPECTED_CONTRACT_HASH);
  assert.equal(snapshot.level_hash, EXPECTED_LEVEL_HASH);
  assert.equal(snapshot.structure_hash, EXPECTED_STRUCTURE_HASH);
});

test("baseline snapshot contract order and level grouping are frozen", () => {
  const snapshot = buildMemoryQualityBaselineSnapshot();

  assert.deepEqual(snapshot.contracts, EXPECTED_CONTRACTS);
  assert.deepEqual(snapshot.levels, EXPECTED_LEVELS);
});
