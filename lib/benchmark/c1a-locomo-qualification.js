import { projectCanonicalRerankTexts } from "../recall/rerank/canonical-text-projector.js";
import {
  QWEN3_UTF8_BYTE_TOKEN_UPPER_BOUND_ID,
  SILICONFLOW_RERANK_ENDPOINT,
  SILICONFLOW_RERANK_LIMITS,
  SILICONFLOW_RERANK_MODEL,
  SILICONFLOW_RERANK_PROVIDER,
  qwen3Utf8ByteTokenUpperBound,
} from "../recall/rerank/siliconflow-rerank-adapter.js";
import { buildC1AQualificationManifest } from "./c1a-qualification-manifest.js";
import { preflightC1AQualificationCase } from "./c1a-qualification-runner.js";
import { C1A_ACCEPTANCE_THRESHOLDS } from "./c1a-qualification-scorer.js";
import {
  evaluateLocomoChunkEvidenceCoverage,
  scoreLocomoChunkCase,
} from "./locomo-chunk-evidence-scorer.js";

export const C1A_LOCOMO_SOURCE_PROFILE = "q3_locomo_chunk_fts_only_v1";
export const C1A_LOCOMO_QUALIFICATION_PROFILE = "r3_c1a_locomo_fts20_canonical_v2";
export const C1A_LOCOMO_CANDIDATE_DEPTH = 20;
export const C1A_MAX_CODE_POINTS_PER_CANDIDATE = 4000;
export const C1A_MAX_TOTAL_CODE_POINTS = 48000;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function sourceKey(sampleId, sessionId) {
  return `${sampleId}\u0000${sessionId}`;
}

export function buildC1ALocomoScoringMaterial({ chunks, turnRows } = {}) {
  if (!Array.isArray(chunks) || !Array.isArray(turnRows)) {
    throw fail("C1A_LOCOMO_SCORING_MATERIAL_INPUT_INVALID");
  }
  const bySource = new Map();
  const ensure = (sampleId, sessionId) => {
    const key = sourceKey(sampleId, sessionId);
    let source = bySource.get(key);
    if (!source) {
      source = { sampleId, sessionId, chunks: [], turnRanges: [] };
      bySource.set(key, source);
    }
    return source;
  };
  for (const chunk of chunks) {
    if (typeof chunk?.sampleId !== "string" || typeof chunk?.sessionId !== "string") {
      throw fail("C1A_LOCOMO_CHUNK_IDENTITY_INVALID");
    }
    ensure(chunk.sampleId, chunk.sessionId).chunks.push(chunk);
  }
  for (const row of turnRows) {
    if (typeof row?.sampleId !== "string" || typeof row?.sessionId !== "string") {
      throw fail("C1A_LOCOMO_TURN_IDENTITY_INVALID");
    }
    ensure(row.sampleId, row.sessionId).turnRanges.push(row);
  }
  return {
    sources: [...bySource.values()].sort((left, right) => (
      left.sampleId.localeCompare(right.sampleId) || left.sessionId.localeCompare(right.sessionId)
    )),
  };
}

function controlByQuestionId(control) {
  if (!Array.isArray(control?.cases)) throw fail("C1A_LOCOMO_CONTROL_CASES_INVALID");
  const map = new Map();
  for (const row of control.cases) {
    if (typeof row?.question_id !== "string" || map.has(row.question_id)) {
      throw fail("C1A_LOCOMO_CONTROL_IDENTITY_INVALID");
    }
    map.set(row.question_id, row);
  }
  return map;
}

export function buildC1ALocomoQualificationCases({
  frozen,
  turnRows,
  egressDecision = "UNKNOWN",
} = {}) {
  if (!isRecord(frozen) || !Array.isArray(frozen.cases) || frozen.cases.length !== 1970) {
    throw fail("C1A_LOCOMO_FROZEN_POPULATION_INVALID");
  }
  if (frozen.candidateManifest?.profile_id !== C1A_LOCOMO_SOURCE_PROFILE) {
    throw fail("C1A_LOCOMO_SOURCE_PROFILE_INVALID");
  }
  if (!Array.isArray(frozen.chunks)) throw fail("C1A_LOCOMO_FROZEN_CHUNKS_MISSING");
  if (egressDecision !== "ALLOW" && egressDecision !== "UNKNOWN" && egressDecision !== "DENY") {
    throw fail("C1A_LOCOMO_EGRESS_DECISION_INVALID");
  }

  const scoringMaterial = buildC1ALocomoScoringMaterial({ chunks: frozen.chunks, turnRows });
  const controls = controlByQuestionId(frozen.control);
  const cases = frozen.cases.map(materialCase => {
    const controlRow = controls.get(materialCase.question_id);
    if (!controlRow?.score?.scoreable || !Array.isArray(controlRow.score.evidence_ids)) {
      throw fail("C1A_LOCOMO_CONTROL_SCORE_INVALID", { caseId: materialCase.question_id });
    }
    const memories = materialCase.memories.slice(0, C1A_LOCOMO_CANDIDATE_DEPTH);
    let projection;
    try {
      projection = projectCanonicalRerankTexts({
        memories,
        maxCodePointsPerCandidate: C1A_MAX_CODE_POINTS_PER_CANDIDATE,
        maxTotalCodePoints: C1A_MAX_TOTAL_CODE_POINTS,
      });
    } catch (error) {
      throw fail("C1A_LOCOMO_CANONICAL_PROJECTION_REJECTED", {
        caseId: materialCase.question_id,
        cause: error?.message ?? String(error),
      });
    }
    const controlOrder = projection.candidates.map(candidate => candidate.id);
    const controlScore = scoreLocomoChunkCase({
      material: scoringMaterial,
      sampleId: materialCase.sample_id,
      qaIndex: materialCase.qa_index,
      evidenceIds: controlRow.score.evidence_ids,
      selectedChunkIds: controlOrder,
      category: controlRow.score.category ?? null,
    });
    const top20Coverage = evaluateLocomoChunkEvidenceCoverage({
      material: scoringMaterial,
      sampleId: materialCase.sample_id,
      qaIndex: materialCase.qa_index,
      evidenceIds: controlRow.score.evidence_ids,
      selectedChunkIds: controlOrder,
    });
    if (controlScore.scoreable !== true || top20Coverage.scoreable !== true) {
      throw fail("C1A_LOCOMO_CASE_SCORE_UNKNOWN", { caseId: materialCase.question_id });
    }
    return {
      case_id: materialCase.question_id,
      sample_id: materialCase.sample_id,
      qa_index: materialCase.qa_index,
      query: materialCase.query,
      query_egress: egressDecision,
      candidates: projection.candidates.map(candidate => ({
        id: candidate.id,
        text: candidate.text,
        egress: egressDecision,
      })),
      control_order: controlOrder,
      control_top3: controlOrder.slice(0, 3),
      control_recall_all_at_3: controlScore.metrics["recall_all@3"],
      gold_evidence_count: controlRow.score.evidence_ids.length,
      gold_complete_in_top20: top20Coverage.recall_all === 1,
      evidence_ids: [...controlRow.score.evidence_ids],
      category: controlRow.score.category ?? null,
      control_score: controlScore,
      projection: {
        total_code_points: projection.totalCodePoints,
        candidate_count: projection.candidates.length,
      },
    };
  });

  return {
    schema: "memory_engine_r3_c1a_locomo_material_v1",
    source_profile: C1A_LOCOMO_SOURCE_PROFILE,
    qualification_profile: C1A_LOCOMO_QUALIFICATION_PROFILE,
    evidence_limitations: {
      candidate_generation: "frozen_fts_only_not_production_hybrid",
      candidate_depth: C1A_LOCOMO_CANDIDATE_DEPTH,
      production_equivalent_candidate_generation: false,
      canonical_text_projection: true,
    },
    profile: {
      candidateDepth: C1A_LOCOMO_CANDIDATE_DEPTH,
      topK: 3,
      maxCodePointsPerCandidate: C1A_MAX_CODE_POINTS_PER_CANDIDATE,
      maxTotalCodePoints: C1A_MAX_TOTAL_CODE_POINTS,
      deadlineMs: 5000,
    },
    scoring_material: scoringMaterial,
    cases,
  };
}

export function prepareC1ALocomoQualification({
  frozen,
  turnRows,
  egressDecision,
  tokenCounter = qwen3Utf8ByteTokenUpperBound,
  qualificationSourceIdentity = null,
} = {}) {
  const material = buildC1ALocomoQualificationCases({
    frozen,
    turnRows,
    egressDecision,
  });
  const eligibilityByCase = Object.fromEntries(material.cases.map(item => {
    const candidateEgress = Object.fromEntries(item.candidates.map(candidate => [candidate.id, candidate.egress]));
    const preflight = preflightC1AQualificationCase({
      query: item.query,
      candidates: item.candidates,
      controlOrder: item.control_order,
      queryEgress: item.query_egress,
      candidateEgress,
      tokenCounter,
    });
    return [item.case_id, preflight.eligible];
  }));
  const manifest = buildC1AQualificationManifest({
    cases: material.cases,
    eligibilityByCase,
    profile: {
      ...material.profile,
      provider: {
        provider: SILICONFLOW_RERANK_PROVIDER,
        model: SILICONFLOW_RERANK_MODEL,
        endpoint: SILICONFLOW_RERANK_ENDPOINT,
        revision: null,
      },
      token_preflight: {
        counter_id: QWEN3_UTF8_BYTE_TOKEN_UPPER_BOUND_ID,
        ...SILICONFLOW_RERANK_LIMITS,
      },
      acceptance_thresholds: { ...C1A_ACCEPTANCE_THRESHOLDS },
    },
    sourceIdentity: {
      qualification_source: qualificationSourceIdentity,
      source_profile: material.source_profile,
      qualification_profile: material.qualification_profile,
      egress_decision: egressDecision,
      evidence_limitations: material.evidence_limitations,
      frozen_material_identity: frozen.material_identity ?? null,
      frozen_input_hashes: frozen.hashes ?? null,
    },
  });
  return { material, manifest, eligibilityByCase };
}

function scoreCase(scoringMaterial, materialCase, selectedIds) {
  return scoreLocomoChunkCase({
    material: scoringMaterial,
    sampleId: materialCase.sample_id,
    qaIndex: materialCase.qa_index,
    evidenceIds: materialCase.evidence_ids,
    selectedChunkIds: selectedIds,
    category: materialCase.category ?? null,
  });
}

export function buildC1ALocomoScoreRows({ material, batch } = {}) {
  if (material?.schema !== "memory_engine_r3_c1a_locomo_material_v1") {
    throw fail("C1A_LOCOMO_MATERIAL_SCHEMA_INVALID");
  }
  if (!Array.isArray(batch?.main_evidence) || !Array.isArray(batch?.sentinel_evidence)) {
    throw fail("C1A_LOCOMO_BATCH_EVIDENCE_INVALID");
  }
  const byId = new Map(material.cases.map(item => [item.case_id, item]));
  const mainRows = batch.main_evidence.map(evidence => {
    const materialCase = byId.get(evidence.case_id);
    if (!materialCase) throw fail("C1A_LOCOMO_EVIDENCE_CASE_MISSING", { caseId: evidence.case_id });
    const control = materialCase.control_score;
    const final = scoreCase(material.scoring_material, materialCase, evidence.ordered_ids);
    if (control.scoreable !== true || final.scoreable !== true) {
      throw fail("C1A_LOCOMO_SCORE_UNKNOWN", { caseId: evidence.case_id });
    }
    return {
      case_id: evidence.case_id,
      qualification_population: evidence.qualification_population,
      stratum: evidence.qualification_stratum,
      eligible: evidence.eligible === true,
      rerank_eligible: evidence.eligible === true,
      attempted: evidence.attempted,
      provider_status: evidence.provider_status,
      structurally_invalid_response: evidence.structurally_invalid_response === true,
      adapter_elapsed_ms: evidence.adapter_elapsed_ms,
      control,
      final,
    };
  });

  const firstById = new Map(batch.main_evidence.map(row => [row.case_id, row]));
  const sentinelRows = batch.sentinel_evidence.map(second => {
    const first = firstById.get(second.case_id);
    if (!first) throw fail("C1A_LOCOMO_SENTINEL_FIRST_RESULT_MISSING", { caseId: second.case_id });
    return {
      case_id: second.case_id,
      first_top3: first.top3_ids,
      second_top3: second.top3_ids,
      first_status: first.provider_status,
      second_status: second.provider_status,
    };
  });

  return {
    primaryRows: mainRows.filter(row => row.qualification_population === "primary"),
    diagnosticRows: mainRows.filter(row => row.qualification_population === "diagnostic"),
    sentinelRows,
    executionSummary: batch.execution_summary,
  };
}
