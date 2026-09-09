import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildLocomoChunkCandidateManifest,
  LOCOMO_CHUNK_FTS_ONLY_PROFILE,
} from "../lib/benchmark/locomo-chunk-candidate-builder.js";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function makeCanonical({ sampleId, id, text, path = `memory/${sampleId}/${id}.md`, lifecycle = {} }) {
  const hash = sha256(text);
  return {
    memory_id: id,
    source: {
      system: "openclaw_core",
      record_type: "chunk",
      record_id: id,
      path,
      core_source: "memory",
      line_start: 1,
      line_end: 1,
      text,
      core_hash: hash,
      updated_at: 1705066861,
    },
    classification: {
      category: "project",
      category_authority: "synthetic_fixture",
    },
    lifecycle: {
      management: "managed",
      category: "project",
      initial_confidence: 0.8,
      confidence: 0.8,
      last_confidence_update: 1705066861,
      base_tau_days: 30,
      hit_count: 1,
      archived: false,
      protected: false,
      conflict: false,
      ...lifecycle,
    },
    content_ref: {
      mode: "core_chunk",
      content_hash: `sha256:${hash}`,
    },
    sample_id_for_fixture: sampleId,
  };
}

function makeMaterial({ sampleId, id, text, path = `memory/${sampleId}/${id}.md` }) {
  const hash = sha256(text);
  return {
    sampleId,
    memoryId: id,
    chunkIndex: 0,
    text,
    hash,
    startLine: 1,
    endLine: 1,
    source: {
      system: "openclaw_core",
      recordType: "chunk",
      recordId: id,
      path,
      coreSource: "memory",
      lineStart: 1,
      lineEnd: 1,
      text: `renderer source for ${id}`,
      coreHash: `source-${hash}`,
    },
    position: { status: "exact" },
  };
}

function fixture() {
  const materialChunks = [];
  const canonicalMemories = [];
  for (let index = 0; index < 55; index += 1) {
    const id = `sample-a-chunk-${String(index).padStart(2, "0")}`;
    const text = `alpha stable candidate ${index}`;
    materialChunks.push(makeMaterial({ sampleId: "sample-a", id, text }));
    canonicalMemories.push(makeCanonical({ sampleId: "sample-a", id, text }));
  }
  const otherId = "sample-b-chunk-00";
  materialChunks.push(makeMaterial({
    sampleId: "sample-b",
    id: otherId,
    text: "alpha stable candidate from another sample",
  }));
  canonicalMemories.push(makeCanonical({
    sampleId: "sample-b",
    id: otherId,
    text: "alpha stable candidate from another sample",
  }));
  return { materialChunks, canonicalMemories };
}

function outputDir() {
  return mkdtempSync(join(tmpdir(), "q3-locomo-chunk-candidate-test-"));
}

async function build(cases, overrides = {}) {
  const { materialChunks, canonicalMemories } = fixture();
  const dir = outputDir();
  try {
    const result = await buildLocomoChunkCandidateManifest({
      cases,
      materialChunks,
      canonicalMemories,
      materialIdentity: {
        dataset_sha256: "dataset-fixture-sha",
        chunk_material_manifest_sha256: "material-fixture-sha",
      },
      profile: LOCOMO_CHUNK_FTS_ONLY_PROFILE,
      outputDir: dir,
      ...overrides,
    });
    return { result, dir };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

test("candidate manifest scopes every query to its sample and never calls closed channels", async () => {
  const { result, dir } = await build([
    {
      question_id: "q-a",
      sample_id: "sample-a",
      qa_index: 0,
      question: "alpha stable candidate",
    },
  ]);
  try {
    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
    const row = manifest.cases[0];
    assert.equal(row.scope.column, "chunks.sample_id");
    assert.equal(row.scope.value, "sample-a");
    assert.equal(row.scope.isolation, "sample_exact_match");
    assert.equal(row.candidate_count, 50);
    assert.equal(row.candidate_ids.includes("sample-b-chunk-00"), false);
    assert.equal(row.channel_usage.fts, 1);
    assert.equal(row.channel_usage.kg, 0);
    assert.equal(row.channel_usage.recent, 0);
    assert.equal(row.channel_usage.vector, 0);
    assert.equal(row.candidate_ids[0], "sample-a-chunk-00");
    assert.equal(row.candidate_ids[1], "sample-a-chunk-01");
    assert.equal(row.candidate_ids.every(id => id.length > 16), true);
    assert.match(readFileSync(result.checksumsPath, "utf8"), /candidate-manifest\.json/);
    assert.doesNotMatch(readFileSync(result.checksumsPath, "utf8"), /SHA256SUMS/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("empty FTS result is recorded without guessing a candidate", async () => {
  const { result, dir } = await build([
    {
      question_id: "q-empty",
      sample_id: "sample-a",
      qa_index: 1,
      question: "term-that-does-not-exist",
    },
  ]);
  try {
    const row = JSON.parse(readFileSync(result.manifestPath, "utf8")).cases[0];
    assert.deepEqual(row.candidate_ids, []);
    assert.equal(row.candidate_count, 0);
    assert.equal(row.channel_usage.fts, 1);
    assert.equal(row.channel_usage.vector, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid material-to-canonical mapping and missing lifecycle are rejected before index creation", async () => {
  const { materialChunks, canonicalMemories } = fixture();
  const dir = outputDir();
  const mismatched = canonicalMemories.map(memory => ({ ...memory }));
  mismatched[0] = {
    ...mismatched[0],
    source: { ...mismatched[0].source, text: "not the material text" },
  };
  await assert.rejects(
    buildLocomoChunkCandidateManifest({
      cases: [{ question_id: "q", sample_id: "sample-a", qa_index: 0, question: "alpha" }],
      materialChunks,
      canonicalMemories: mismatched,
      materialIdentity: { dataset_sha256: "d", chunk_material_manifest_sha256: "m" },
      profile: LOCOMO_CHUNK_FTS_ONLY_PROFILE,
      outputDir: dir,
    }),
    /canonical_memory:0:text_mismatch/,
  );
  rmSync(dir, { recursive: true, force: true });

  const missingLifecycle = fixture().canonicalMemories.map(memory => ({ ...memory }));
  const lifecycle = { ...missingLifecycle[0].lifecycle };
  delete lifecycle.confidence;
  missingLifecycle[0] = { ...missingLifecycle[0], lifecycle };
  const secondDir = outputDir();
  await assert.rejects(
    buildLocomoChunkCandidateManifest({
      cases: [{ question_id: "q", sample_id: "sample-a", qa_index: 0, question: "alpha" }],
      materialChunks,
      canonicalMemories: missingLifecycle,
      materialIdentity: { dataset_sha256: "d", chunk_material_manifest_sha256: "m" },
      profile: LOCOMO_CHUNK_FTS_ONLY_PROFILE,
      outputDir: secondDir,
    }),
    /canonical_memory:0:lifecycle_confidence_missing/,
  );
  rmSync(secondDir, { recursive: true, force: true });
});

test("case-to-sample mapping is rejected instead of searching another sample", async () => {
  await assert.rejects(
    build([
      {
        question_id: "q-invalid-sample",
        sample_id: "sample-missing",
        qa_index: 0,
        question: "alpha",
      },
    ]),
    /case_sample_mapping_missing:sample-missing/,
  );
});
