import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { buildLocomoChunkMaterial, flattenChunkMaterial } from "../lib/benchmark/locomo-chunk-material.js";
import {
  alignLocomoChunkScoreRows,
  scoreLocomoChunkCase,
  scoreLocomoChunkCases,
} from "../lib/benchmark/locomo-chunk-evidence-scorer.js";

function hash(text) {
  return createHash("sha256").update(text).digest("hex");
}

function modelIdentity() {
  return {
    value: "q3-scorer-test-experimental-id-v1",
    kind: "experimental_offline_id_only",
    source: "focused_test",
    productionEquivalent: false,
  };
}

function buildFixture({ includeUnknown = false } = {}) {
  const sample = {
    sample_id: "conv-scorer-test",
    conversation: {
      session_1: [
        { speaker: "A", dia_id: "D1:1", text: "evidence one two" },
        { speaker: "B", dia_id: "D1:2", text: "second evidence" },
        { speaker: "C", dia_id: "D1:3", text: "third" },
      ],
    },
  };
  const texts = [
    "A: evidence one ",
    "two",
    "evidence one two",
    "B: second evidence",
    "A: evidence one two\nB: second evidence",
    "C: third",
  ];
  if (includeUnknown) texts.push("not in source");
  const chunkMarkdown = (content) => texts.map((text, index) => ({
    startLine: index === 4 ? 1 : (index === 3 ? 2 : (index === 5 ? 3 : 1)),
    endLine: index === 3 || index === 4 ? 2 : (index === 5 ? 3 : 1),
    text,
    hash: hash(text),
  }));
  const material = buildLocomoChunkMaterial({
    samples: [sample],
    chunkMarkdown,
    tokens: 10,
    overlap: 2,
    modelIdentity: modelIdentity(),
  });
  const byText = new Map(flattenChunkMaterial(material).map(chunk => [chunk.text, chunk.memoryId]));
  return {
    material,
    ids: {
      prefix: byText.get("A: evidence one "),
      suffix: byText.get("two"),
      overlap: byText.get("evidence one two"),
      second: byText.get("B: second evidence"),
      combined: byText.get("A: evidence one two\nB: second evidence"),
      unknown: byText.get("not in source"),
    },
  };
}

function score(fixture, evidenceIds, selectedChunkIds, qaIndex = 0) {
  return scoreLocomoChunkCase({
    material: fixture.material,
    sampleId: "conv-scorer-test",
    qaIndex,
    evidenceIds,
    selectedChunkIds,
  });
}

test("source-offset union completes cross-chunk evidence and deduplicates overlap", () => {
  const fixture = buildFixture();
  const crossChunk = score(fixture, ["D1:1", "D1:2"], [
    fixture.ids.prefix,
    fixture.ids.suffix,
    fixture.ids.second,
  ]);
  assert.equal(crossChunk.scoreable, true);
  assert.deepEqual(crossChunk.full_evidence_ids, ["D1:1", "D1:2"]);
  assert.deepEqual(Object.keys(crossChunk.metrics).sort(), [
    "evidence_coverage@3",
    "ndcg@3",
    "recall_all@3",
    "recall_any@3",
  ]);
  assert.equal(crossChunk.metrics["recall_all@3"], 1);
  assert.equal(crossChunk.metrics["evidence_coverage@3"], 1);
  assert.equal(crossChunk.metrics["ndcg@3"], null);
  assert.deepEqual(crossChunk.diagnostics["completion_gains@3"], [0, 1, 1]);
  assert.equal(crossChunk.diagnostics.ndcg_reason, "formal_idcg_contract_pending_cross_chunk_dependencies");
  assert.equal(crossChunk.budget.status, "satisfied");

  const dependentCompletion = score(fixture, ["D1:1"], [fixture.ids.prefix, fixture.ids.suffix]);
  assert.deepEqual(dependentCompletion.diagnostics["completion_gains@3"], [0, 1]);
  assert.equal(dependentCompletion.diagnostics["completion_dcg@3"], 1 / Math.log2(3));
  assert.equal(dependentCompletion.metrics["ndcg@3"], null);

  const overlap = score(fixture, ["D1:1", "D1:2"], [
    fixture.ids.prefix,
    fixture.ids.overlap,
    fixture.ids.second,
  ]);
  const firstEvidence = overlap.evidence.find(row => row.evidenceId === "D1:1");
  assert.deepEqual(firstEvidence.chunkIds, [fixture.ids.prefix, fixture.ids.overlap]);
  assert.equal(firstEvidence.coveredUtf16, firstEvidence.targetUtf16);
  assert.equal(overlap.metrics["evidence_coverage@3"], 1);
});

test("one chunk may cover multiple evidence turns, while partial coverage is not a hit", () => {
  const fixture = buildFixture();
  const combined = score(fixture, ["D1:1", "D1:2"], [fixture.ids.combined]);
  assert.deepEqual(combined.full_evidence_ids, ["D1:1", "D1:2"]);
  assert.equal(combined.metrics["recall_any@3"], 1);
  assert.equal(combined.metrics["recall_all@3"], 1);

  const partial = score(fixture, ["D1:1", "D1:2"], [fixture.ids.prefix]);
  assert.deepEqual(partial.partial_evidence_ids, ["D1:1"]);
  assert.deepEqual(partial.miss_evidence_ids, ["D1:2"]);
  assert.deepEqual(partial.full_evidence_ids, []);
  assert.equal(partial.metrics["recall_any@3"], 0);
  assert.equal(partial.metrics["evidence_coverage@3"], 0);
});

test("empty evidence is frozen unknown with empty and missing selection", () => {
  const fixture = buildFixture();
  const direct = score(fixture, [], []);
  assert.equal(direct.frozen_material_scoreable, false);
  assert.equal(direct.scoreable, false);
  assert.deepEqual(direct.unknown_reasons, ["evidence_ids_empty"]);

  const evidenceCases = [{ sampleId: "conv-scorer-test", qaIndex: 0, evidence: [] }];
  const emptySelection = scoreLocomoChunkCases({
    material: fixture.material,
    evidenceCases,
    selectedChunkIdsByCase: { "conv-scorer-test:qa:0": [] },
  });
  const missingSelection = scoreLocomoChunkCases({
    material: fixture.material,
    evidenceCases,
    selectedChunkIdsByCase: {},
  });
  for (const result of [emptySelection, missingSelection]) {
    assert.equal(result.population.frozen_material_scoreable_case_count, 0);
    assert.equal(result.population.frozen_material_unknown_case_count, 1);
    assert.equal(result.population.frozen_material_unclassified_case_count, 0);
    assert.equal(result.population.final_scoreable_case_count, 0);
    assert.equal(result.population.final_unknown_case_count, 1);
    assert.equal(result.population.final_unclassified_case_count, 0);
    assert.equal(result.cases[0].frozen_material_scoreable, false);
  }
  assert.deepEqual(emptySelection.cases[0].unknown_reasons, ["evidence_ids_empty"]);
  assert.deepEqual(missingSelection.cases[0].unknown_reasons, ["selected_chunk_ids_missing"]);
});

test("material unknown population stays unknown regardless of selected ranking", () => {
  const fixture = buildFixture({ includeUnknown: true });
  const selectedKnown = score(fixture, ["D1:1"], [fixture.ids.prefix]);
  const selectedUnknown = score(fixture, ["D1:1"], [fixture.ids.unknown]);
  for (const result of [selectedKnown, selectedUnknown]) {
    assert.equal(result.scoreable, false);
    assert.equal(result.evidence[0].status, "unknown");
    assert.equal(result.evidence[0].unknownScope, "material");
    assert.equal(result.metrics["recall_any@3"], null);
    assert.equal(result.metrics["recall_all@3"], null);
    assert.equal(result.metrics["ndcg@3"], null);
    assert.equal(result.metrics["evidence_coverage@3"], null);
    assert.equal(result.budget.status, "unknown");
  }
  assert.deepEqual(selectedKnown.frozen_unknown_evidence_ids, ["D1:1"]);
  assert.deepEqual(selectedUnknown.frozen_unknown_evidence_ids, ["D1:1"]);
  assert.deepEqual(selectedKnown.selection_unknown_evidence_ids, []);
  assert.deepEqual(selectedUnknown.selection_unknown_evidence_ids, []);
  assert.deepEqual(selectedKnown.selection_unknown_chunk_ids, []);
  assert.deepEqual(selectedUnknown.selection_unknown_chunk_ids, [fixture.ids.unknown]);

  const control = scoreLocomoChunkCases({
    material: fixture.material,
    evidenceCases: [{ sampleId: "conv-scorer-test", qaIndex: 0, evidence: [{ evidenceId: "D1:1" }] }],
    selectedChunkIdsByCase: { "conv-scorer-test:qa:0": [fixture.ids.prefix] },
  });
  const rerank = scoreLocomoChunkCases({
    material: fixture.material,
    evidenceCases: [{ sampleId: "conv-scorer-test", qaIndex: 0, evidence: [{ evidenceId: "D1:1" }] }],
    selectedChunkIdsByCase: { "conv-scorer-test:qa:0": [fixture.ids.unknown] },
  });
  assert.equal(control.population.frozen_material_unknown_case_count, 1);
  assert.equal(rerank.population.frozen_material_unknown_case_count, 1);
  assert.equal(control.population.final_unknown_case_count, 1);
  assert.equal(rerank.population.final_unknown_case_count, 1);
});

test("chunk budget is observed from source coverage, not gold evidence count", () => {
  const sample = {
    sample_id: "conv-four-evidence",
    conversation: {
      session_1: [
        { speaker: "A", dia_id: "D1:1", text: "one" },
        { speaker: "B", dia_id: "D1:2", text: "two" },
        { speaker: "C", dia_id: "D1:3", text: "three" },
        { speaker: "D", dia_id: "D1:4", text: "four" },
      ],
    },
  };
  let allText = "";
  const material = buildLocomoChunkMaterial({
    samples: [sample],
    chunkMarkdown: (content) => {
      allText = content;
      return [{ startLine: 1, endLine: 4, text: content, hash: hash(content) }];
    },
    tokens: 10,
    overlap: 2,
    modelIdentity: modelIdentity(),
  });
  assert.ok(allText.length > 0);
  const chunkId = flattenChunkMaterial(material)[0].memoryId;
  const result = scoreLocomoChunkCase({
    material,
    sampleId: "conv-four-evidence",
    qaIndex: 0,
    evidenceIds: ["D1:1", "D1:2", "D1:3", "D1:4"],
    selectedChunkIds: [chunkId],
  });
  assert.equal(result.budget.evidence_count, 4);
  assert.equal(result.budget.status, "satisfied");
  assert.equal(result.budget.feasibility, "unknown");
  assert.equal(result.budget.feasibility_reason, "formal_minimum_chunk_cover_not_computed");
  assert.equal(Object.hasOwn(result.budget, "feasibility_definition"), false);
  assert.equal(result.metrics["recall_all@3"], 1);
});

test("aligned table keeps old session metrics separate from new chunk metrics", () => {
  const fixture = buildFixture();
  const cases = scoreLocomoChunkCases({
    material: fixture.material,
    evidenceCases: [
      { sampleId: "conv-scorer-test", qaIndex: 0, category: 1, evidence: [{ evidenceId: "D1:1" }] },
      { sampleId: "conv-scorer-test", qaIndex: 1, category: 2, evidence: [{ evidenceId: "D1:2" }] },
    ],
    selectedChunkIdsByCase: new Map([
      ["conv-scorer-test:qa:0", [fixture.ids.overlap]],
      ["conv-scorer-test:qa:1", [fixture.ids.second]],
    ]),
    oldRows: [
      {
        sample_id: "conv-scorer-test",
        qa_index: 0,
        question_id: "conv-scorer-test:qa:0",
        scoreable: true,
        q1: { metrics: { "recall_any@3": 0, "recall_all@3": 0, "ndcg@3": 0, "evidence_coverage@3": 0 } },
      },
      {
        sample_id: "conv-scorer-test",
        qa_index: 1,
        question_id: "conv-scorer-test:qa:1",
        scoreable: false,
      },
    ],
  });
  assert.equal(cases.alignment_summary.aligned_case_count, 2);
  assert.equal(cases.alignment_summary.old_scoreable_case_count, 1);
  assert.equal(cases.alignment_summary.chunk_scoreable_case_count, 2);
  assert.equal(cases.aligned_case_rows[0].old_session_score.metrics["recall_any@3"], 0);
  assert.equal(cases.aligned_case_rows[0].chunk_score.metrics["recall_any@3"], 1);
  assert.equal(cases.aligned_case_rows[0].alignment_status, "aligned");

  const direct = alignLocomoChunkScoreRows({
    oldRows: [{ question_id: "old-only", scoreable: true }],
    chunkRows: [
      { question_id: "new-only", scoreable: true, unknown: false, metrics: {} },
      { question_id: "missing-scoreable", unknown: false, metrics: {} },
    ],
  });
  assert.equal(direct.summary.old_only_case_count, 1);
  assert.equal(direct.summary.chunk_only_case_count, 2);
  assert.equal(direct.summary.chunk_scoreable_case_count, 1);
  assert.equal(direct.summary.chunk_unknown_case_count, 0);
  assert.equal(direct.summary.chunk_unclassified_case_count, 1);
});
