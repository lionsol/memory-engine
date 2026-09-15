import assert from "node:assert/strict";
import test from "node:test";

import {
  buildC1ALocomoQualificationCases,
  C1A_LOCOMO_QUALIFICATION_PROFILE,
  C1A_LOCOMO_SOURCE_PROFILE,
} from "../lib/benchmark/c1a-locomo-qualification.js";

function syntheticFrozen() {
  const memoryId = "memory-1";
  const chunk = {
    sampleId: "sample",
    sessionId: "session_1",
    memoryId,
    text: "A: evidence",
    startLine: 1,
    endLine: 1,
    position: {
      status: "exact",
      range: {
        startUtf16: 0,
        endUtf16: 11,
        startCodePoint: 0,
        endCodePoint: 11,
        startByte: 0,
        endByte: 11,
        startLine: 1,
        endLine: 1,
      },
    },
  };
  const memory = {
    memory_id: memoryId,
    source: {
      record_type: "chunk",
      record_id: memoryId,
      text: "A: evidence",
    },
  };
  const cases = Array.from({ length: 1970 }, (_, qaIndex) => ({
    question_id: `sample:qa:${qaIndex}`,
    sample_id: "sample",
    qa_index: qaIndex,
    query: `question-${qaIndex}`,
    memories: [memory],
  }));
  const control = {
    cases: cases.map(item => ({
      question_id: item.question_id,
      score: {
        scoreable: true,
        evidence_ids: ["D1:1"],
        category: 1,
      },
    })),
  };
  return {
    candidateManifest: { profile_id: C1A_LOCOMO_SOURCE_PROFILE },
    chunks: [chunk],
    cases,
    control,
  };
}

const turnRows = [{
  sampleId: "sample",
  sessionId: "session_1",
  diaId: "D1:1",
  range: {
    startUtf16: 0,
    endUtf16: 11,
    startCodePoint: 0,
    endCodePoint: 11,
    startByte: 0,
    endByte: 11,
    startLine: 1,
    endLine: 1,
  },
  chunkCoverage: { status: "full", chunkIds: ["memory-1"] },
}];

test("C1-A LoCoMo bridge projects the frozen source population into the depth20 qualification envelope", () => {
  const material = buildC1ALocomoQualificationCases({
    frozen: syntheticFrozen(),
    turnRows,
    egressDecision: "ALLOW",
  });
  assert.equal(material.schema, "memory_engine_r3_c1a_locomo_material_v1");
  assert.equal(material.source_profile, C1A_LOCOMO_SOURCE_PROFILE);
  assert.equal(material.qualification_profile, C1A_LOCOMO_QUALIFICATION_PROFILE);
  assert.equal(material.evidence_limitations.production_equivalent_candidate_generation, false);
  assert.equal(material.cases.length, 1970);
  assert.equal(material.cases[0].control_recall_all_at_3, 1);
  assert.equal(material.cases[0].gold_complete_in_top20, true);
  assert.equal(material.cases[0].candidates[0].egress, "ALLOW");
  assert.equal(material.cases[0].projection.total_code_points, 11);
});
