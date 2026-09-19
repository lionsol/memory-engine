import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  buildQ5B1CaptureManifestV1,
} from "../lib/benchmark/q5-b1-score-capture-manifest-v1.js";

const b0 = JSON.parse(readFileSync(
  new URL("./fixtures/q5-b0-real-fixed-pool-evidence-entry-v1.json", import.meta.url),
  "utf8",
));

test("Q5-B1 deterministically selects 512 fixed-pool cases without overlap", () => {
  const manifest = buildQ5B1CaptureManifestV1(b0);

  assert.equal(manifest.population.selected_case_count, 512);
  assert.deepEqual(manifest.population.split_counts, {
    development: 256,
    validation: 128,
    final_evaluation: 128,
  });
  assert.equal(manifest.population.development.recoverable_rank_miss, 128);
  assert.equal(manifest.population.development.protect, 128);
  assert.equal(manifest.population.validation.recoverable_rank_miss, 64);
  assert.equal(manifest.population.validation.protect, 64);
  assert.equal(manifest.population.final_evaluation.case_count, 128);
  assert.equal(new Set(manifest.cases.map(row => row.case_id)).size, 512);
  assert.equal(manifest.provider_execution_authorized, false);
  assert.equal(manifest.provider_requests, 0);
  assert.equal(manifest.model_training_runs, 0);
});

test("Q5-B1 final selection is unconditional and capture rows contain no gold-derived fields", () => {
  const manifest = buildQ5B1CaptureManifestV1(b0);
  const finalRows = manifest.cases.filter(row => row.split === "final_evaluation");

  assert.equal(finalRows.length, 128);
  assert.equal(finalRows.every(row => row.selection_reason === "unconditional_hash_sample"), true);
  for (const row of manifest.cases) {
    assert.equal(Object.hasOwn(row, "diagnostic_stratum"), false);
    assert.equal(Object.hasOwn(row, "category"), false);
    assert.equal(Object.hasOwn(row, "gold_evidence_count"), false);
    assert.equal(Object.hasOwn(row, "gold_complete_in_top20"), false);
    assert.equal(Object.hasOwn(row, "evidence_ids"), false);
  }
  const serialized = JSON.stringify(manifest);
  assert.equal(serialized.includes('"query":'), false);
  assert.equal(serialized.includes('"text":'), false);
  assert.equal(serialized.includes("evidence_ids"), false);
});

test("Q5-B1 selection is deterministic and binds the exact B0 manifest", () => {
  const first = buildQ5B1CaptureManifestV1(b0);
  const second = buildQ5B1CaptureManifestV1(b0);

  assert.deepEqual(first, second);
  assert.equal(
    first.source_b0_manifest_sha256,
    "f9262cd548c8a145da32da20f46a53872cab0310661d5b3a3055f5925ca9afe0",
  );
  assert.match(first.manifest_sha256, /^[0-9a-f]{64}$/u);
  assert.equal(first.model, "Qwen/Qwen3-Reranker-0.6B");
  assert.equal(first.candidate_depth_max, 20);
  assert.equal(first.top_k, 3);
});

test("Q5-B1 frozen real capture manifest has stable identity and no raw/gold fields", () => {
  const path = new URL("./fixtures/q5-b1-score-capture-manifest-v1.json", import.meta.url);
  const raw = readFileSync(path);
  const manifest = JSON.parse(raw.toString("utf8"));

  assert.equal(
    createHash("sha256").update(raw).digest("hex"),
    "3bbb77c2d12e0f76cbffca650dcc5eb78dc630a59d74bd2822441ad8f316afa2",
  );
  assert.equal(
    manifest.manifest_sha256,
    "a4e3cadb8af68f2ec6a3016e42757a0025f6b1e81edf841aafff099a64d43d77",
  );
  assert.equal(manifest.population.selected_case_count, 512);
  assert.deepEqual(manifest.population.split_counts, {
    development: 256,
    validation: 128,
    final_evaluation: 128,
  });
  assert.equal(manifest.provider_execution_authorized, false);

  const serialized = JSON.stringify(manifest);
  assert.equal(serialized.includes('"query":'), false);
  assert.equal(serialized.includes('"text":'), false);
  assert.equal(serialized.includes("evidence_ids"), false);
  assert.equal(serialized.includes("gold_evidence_count"), false);
  assert.equal(serialized.includes("diagnostic_stratum"), false);
  assert.equal(serialized.includes('"category":'), false);
});

test("Q5-B1 does not alter sample-level split assignment inherited from B0", () => {
  const manifest = buildQ5B1CaptureManifestV1(b0);
  const b0ByCase = new Map(b0.cases.map(row => [row.case_id, row]));

  for (const row of manifest.cases) {
    assert.equal(row.split, b0ByCase.get(row.case_id)?.split);
    assert.equal(row.sample_id, b0ByCase.get(row.case_id)?.sample_id);
  }
});
