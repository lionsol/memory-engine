import { createHash } from "node:crypto";

import { scoreQ1EvidenceRankingAt3 } from "./q1-product-metric-contract-v1.js";
import {
  buildQ4RecallHintC1FreshCorpusV1,
} from "./q4-recall-hint-c1-corpus-v1.js";
import {
  Q4_RECALL_HINT_C1_FROZEN_IDENTITY,
  assertQ4RecallHintC1FrozenIdentityV1,
  buildQ4RecallHintC1ManifestV1,
  flattenQ4RecallHintC1MemoryRecordsV1,
} from "./q4-recall-hint-c1-manifest-v1.js";
import {
  buildQ4RecallHintC2FreshHoldoutCorpusV1,
} from "./q4-recall-hint-c2-holdout-corpus-v1.js";
import {
  Q4_RECALL_HINT_C2_HOLDOUT_FROZEN_IDENTITY,
  assertQ4RecallHintC2HoldoutFrozenIdentityV1,
  flattenQ4RecallHintC2HoldoutMemoryRecordsV1,
} from "./q4-recall-hint-c2-holdout-manifest-v1.js";
import { R3_C1_B_PROVIDER_PROFILE } from "../recall/hybrid/explicit-search-rerank-provider-policy.js";
import { projectCanonicalRerankTexts } from "../recall/rerank/canonical-text-projector.js";

export const Q5_FIXED_CANDIDATE_FIXTURE_SCHEMA =
  "memory_engine_q5_fixed_candidate_q4_derived_fixture_v1";
export const Q5_FIXED_CANDIDATE_ATTRIBUTION_SCHEMA =
  "memory_engine_q5_fixed_candidate_attribution_v1";
export const Q5_FIXED_CANDIDATE_TOP_K = 3;

export const Q5_Q4_SOURCE_BINDINGS = Object.freeze({
  c1b_development: Object.freeze({
    source_commit: "4ee4374c31cd41149298b528958e60f42004dc37",
    result_sha256: "5d51c8258b5842de9be91b074af64931525ad6fd6fa64972326d8136a32fac89",
    result_file_sha256: "fdccf12a52f3fe078e72b4400b559d9b80d6ab364d48810947b15c7832dad391",
    manifest_sha256: Q4_RECALL_HINT_C1_FROZEN_IDENTITY.manifest_sha256,
  }),
  c2_holdout: Object.freeze({
    source_commit: "d5f75bf95006c9557dd4289164c5e41c058cfc72",
    result_sha256: "bf809cd7cc15d737ccce36503f5a036e1e1987870ec558bee10c21f5a035b6d9",
    result_file_sha256: "03c09e9af8641e6c2a082004524957142cfe286aaa1570950e515afd41698878",
    manifest_sha256: Q4_RECALL_HINT_C2_HOLDOUT_FROZEN_IDENTITY.manifest_sha256,
  }),
});

export const Q5_ATTRIBUTION_LABELS = Object.freeze([
  "RANK_SELECTION_ERROR",
  "REDUNDANT_SELECTION",
  "TEMPORAL_VERSION_CONFLICT",
  "TOP3_CAPACITY_LIMIT",
  "RANK_INPUT_INFORMATION_LOSS",
  "MIXED_OR_UNRESOLVED",
]);

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function uniqueStrings(value, field) {
  if (!Array.isArray(value) || value.length === 0) throw fail(`Q5_${field}_REQUIRED`);
  const out = value.map(item => String(item));
  if (out.some(item => item.trim() === "")) throw fail(`Q5_${field}_EMPTY`);
  if (new Set(out).size !== out.length) throw fail(`Q5_${field}_DUPLICATE`);
  return out;
}

function roleForRecord(family, index) {
  if (family === "entity_reference") return "entity_fact";
  if (family === "temporal_relation") return index === 0 ? "temporal_before" : "temporal_after";
  if (family === "multi_facet") return index === 0 ? "multi_rationale" : "multi_limit";
  if (family === "protection") return "protection_fact";
  return "unknown";
}

function corpusMemoryIndex(corpus) {
  const rows = [];
  for (const item of corpus.cases) {
    item.memory_records.forEach((record, index) => {
      rows.push(Object.freeze({
        id: record.id,
        text: record.text,
        owner_case_id: item.case_id,
        owner_family: item.family,
        role: roleForRecord(item.family, index),
      }));
    });
  }
  return rows;
}

function normalizeResultRows({ sourceName, result, corpus, allowedCaseIds = null }) {
  if (!result || typeof result !== "object") throw fail("Q5_RESULT_REQUIRED");
  if (result.status !== "PASS") throw fail(`Q5_${sourceName}_RESULT_NOT_PASS`);
  if (result.top_k !== Q5_FIXED_CANDIDATE_TOP_K) throw fail(`Q5_${sourceName}_TOPK_DRIFT`);
  if (result.candidate_depth !== 20) throw fail(`Q5_${sourceName}_CANDIDATE_DEPTH_DRIFT`);

  const corpusByCase = new Map(corpus.cases.map(row => [row.case_id, row]));
  const rows = result.evaluation?.rows;
  if (!Array.isArray(rows) || rows.length === 0) throw fail(`Q5_${sourceName}_ROWS_REQUIRED`);

  return rows.map(row => {
    const sourceCase = corpusByCase.get(row.case_id);
    if (!sourceCase) throw fail(`Q5_${sourceName}_CASE_NOT_IN_CORPUS`);
    if (allowedCaseIds && !allowedCaseIds.has(row.case_id)) {
      throw fail(`Q5_${sourceName}_CASE_OUT_OF_SCOPE`);
    }
    if (row.family !== sourceCase.family) throw fail(`Q5_${sourceName}_FAMILY_DRIFT`);
    if (JSON.stringify(row.gold_evidence_ids) !== JSON.stringify(sourceCase.gold_evidence_ids)) {
      throw fail(`Q5_${sourceName}_GOLD_DRIFT`);
    }

    return Object.freeze({
      case_id: row.case_id,
      family: row.family,
      query: sourceCase.query,
      gold_evidence_ids: Object.freeze([...row.gold_evidence_ids]),
      baseline: Object.freeze({
        candidate_pool_ids: Object.freeze([...row.baseline.candidate_pool_ids]),
        ranked_top3_ids: Object.freeze([...row.baseline.ranked_top3_ids]),
      }),
      hint: Object.freeze({
        candidate_pool_ids: Object.freeze([...row.hint.candidate_pool_ids]),
        ranked_top3_ids: Object.freeze([...row.hint.ranked_top3_ids]),
      }),
    });
  });
}

function validateSourceBinding(result, binding, sourceName) {
  if (result.source_commit !== binding.source_commit) throw fail(`Q5_${sourceName}_SOURCE_COMMIT_DRIFT`);
  if (result.result_sha256 !== binding.result_sha256) throw fail(`Q5_${sourceName}_RESULT_IDENTITY_DRIFT`);
  if (result.manifest_sha256 !== binding.manifest_sha256) throw fail(`Q5_${sourceName}_MANIFEST_DRIFT`);
}

export function buildQ5FixedCandidateDerivedFixtureV1({
  c1bResult,
  c2Result,
  c1bResultFileSha256,
  c2ResultFileSha256,
} = {}) {
  const c1Corpus = buildQ4RecallHintC1FreshCorpusV1();
  const c2Corpus = buildQ4RecallHintC2FreshHoldoutCorpusV1();
  assertQ4RecallHintC1FrozenIdentityV1(c1Corpus);
  assertQ4RecallHintC2HoldoutFrozenIdentityV1(c2Corpus);

  validateSourceBinding(c1bResult, Q5_Q4_SOURCE_BINDINGS.c1b_development, "C1B");
  validateSourceBinding(c2Result, Q5_Q4_SOURCE_BINDINGS.c2_holdout, "C2");

  if (c1bResultFileSha256 !== Q5_Q4_SOURCE_BINDINGS.c1b_development.result_file_sha256) {
    throw fail("Q5_C1B_RESULT_FILE_HASH_DRIFT");
  }
  if (c2ResultFileSha256 !== Q5_Q4_SOURCE_BINDINGS.c2_holdout.result_file_sha256) {
    throw fail("Q5_C2_RESULT_FILE_HASH_DRIFT");
  }

  const c1Manifest = buildQ4RecallHintC1ManifestV1(c1Corpus);
  const developmentIds = new Set(c1Manifest.development.map(row => row.case_id));

  const sources = [
    Object.freeze({
      source_name: "q4_c1b_development",
      source_commit: Q5_Q4_SOURCE_BINDINGS.c1b_development.source_commit,
      source_result_sha256: Q5_Q4_SOURCE_BINDINGS.c1b_development.result_sha256,
      source_result_file_sha256: c1bResultFileSha256,
      corpus_sha256: Q4_RECALL_HINT_C1_FROZEN_IDENTITY.corpus_sha256,
      manifest_sha256: Q4_RECALL_HINT_C1_FROZEN_IDENTITY.manifest_sha256,
      memories: Object.freeze(corpusMemoryIndex(c1Corpus)),
      cases: Object.freeze(normalizeResultRows({
        sourceName: "C1B",
        result: c1bResult,
        corpus: c1Corpus,
        allowedCaseIds: developmentIds,
      })),
    }),
    Object.freeze({
      source_name: "q4_c2_holdout",
      source_commit: Q5_Q4_SOURCE_BINDINGS.c2_holdout.source_commit,
      source_result_sha256: Q5_Q4_SOURCE_BINDINGS.c2_holdout.result_sha256,
      source_result_file_sha256: c2ResultFileSha256,
      corpus_sha256: Q4_RECALL_HINT_C2_HOLDOUT_FROZEN_IDENTITY.corpus_sha256,
      manifest_sha256: Q4_RECALL_HINT_C2_HOLDOUT_FROZEN_IDENTITY.manifest_sha256,
      memories: Object.freeze(corpusMemoryIndex(c2Corpus)),
      cases: Object.freeze(normalizeResultRows({
        sourceName: "C2",
        result: c2Result,
        corpus: c2Corpus,
      })),
    }),
  ];

  const body = {
    schema: Q5_FIXED_CANDIDATE_FIXTURE_SCHEMA,
    top_k: Q5_FIXED_CANDIDATE_TOP_K,
    candidate_depth: 20,
    evidence_mapping: "direct_candidate_id_equals_gold_evidence_id",
    rank_input_profile: Object.freeze({
      max_code_points_per_candidate: R3_C1_B_PROVIDER_PROFILE.maxCodePointsPerCandidate,
      max_total_code_points: R3_C1_B_PROVIDER_PROFILE.maxTotalCodePoints,
      projector: "projectCanonicalRerankTexts",
      historical_projector_diff_from_q4_sources: "NONE",
    }),
    sources: Object.freeze(sources),
  };

  return Object.freeze({
    ...body,
    fixture_sha256: sha256(JSON.stringify(body)),
  });
}

function canonicalMemory(record) {
  return {
    memory_id: record.id,
    source: {
      record_type: "chunk",
      record_id: record.id,
      text: record.text,
    },
  };
}

function scoreSelection(goldEvidenceIds, selectedIds) {
  return scoreQ1EvidenceRankingAt3({
    gold_evidence_ids: goldEvidenceIds,
    ranked_retrieved_ids: selectedIds,
  });
}

function combinations(values, count) {
  if (count === 0) return [[]];
  if (count > values.length) return [];
  const out = [];
  const walk = (start, acc) => {
    if (acc.length === count) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i <= values.length - (count - acc.length); i += 1) {
      acc.push(values[i]);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}

function metric(score, name) {
  return Number(score?.metrics?.[name] ?? score?.[name] ?? 0);
}

function computeTop3Oracle(goldEvidenceIds, poolIds) {
  let best = null;
  const maxSize = Math.min(Q5_FIXED_CANDIDATE_TOP_K, poolIds.length);
  for (let size = 1; size <= maxSize; size += 1) {
    for (const ids of combinations(poolIds, size)) {
      const score = scoreSelection(goldEvidenceIds, ids);
      const candidate = {
        ids,
        recall_all: metric(score, "recall_all@3"),
        recall_any: metric(score, "recall_any@3"),
        evidence_coverage: metric(score, "evidence_coverage@3"),
        ndcg: metric(score, "ndcg@3"),
      };
      if (!best
          || candidate.recall_all > best.recall_all
          || (candidate.recall_all === best.recall_all
            && candidate.evidence_coverage > best.evidence_coverage)
          || (candidate.recall_all === best.recall_all
            && candidate.evidence_coverage === best.evidence_coverage
            && candidate.ndcg > best.ndcg)
          || (candidate.recall_all === best.recall_all
            && candidate.evidence_coverage === best.evidence_coverage
            && candidate.ndcg === best.ndcg
            && candidate.ids.length < best.ids.length)) {
        best = candidate;
      }
    }
  }

  if (!best) {
    best = {
      ids: [],
      recall_all: 0,
      recall_any: 0,
      evidence_coverage: 0,
      ndcg: 0,
    };
  }

  let minimumGoldCoverSize = null;
  if (best.recall_all === 1) {
    for (let size = 1; size <= maxSize; size += 1) {
      const complete = combinations(poolIds, size)
        .some(ids => metric(scoreSelection(goldEvidenceIds, ids), "recall_all@3") === 1);
      if (complete) {
        minimumGoldCoverSize = size;
        break;
      }
    }
  }

  return Object.freeze({
    oracle_top3_ids: Object.freeze([...best.ids]),
    oracle_top3_recall_any: best.recall_any,
    oracle_top3_recall_all: best.recall_all,
    oracle_top3_evidence_coverage: best.evidence_coverage,
    oracle_top3_feasible: best.recall_all === 1,
    minimum_gold_cover_size: minimumGoldCoverSize,
  });
}

function projectPool(poolIds, memoryMap) {
  const records = poolIds.map(id => {
    const record = memoryMap.get(id);
    if (!record) throw fail("Q5_POOL_MEMORY_MISSING");
    return record;
  });
  const projected = projectCanonicalRerankTexts({
    memories: records.map(canonicalMemory),
    maxCodePointsPerCandidate: R3_C1_B_PROVIDER_PROFILE.maxCodePointsPerCandidate,
    maxTotalCodePoints: R3_C1_B_PROVIDER_PROFILE.maxTotalCodePoints,
  });
  const byId = new Map(projected.candidates.map(row => [row.id, row.text]));
  const metaById = new Map(projected.metadata.map(row => [row.id, row]));
  return {
    preserved: records.every(record => {
      const metadata = metaById.get(record.id);
      return metadata?.truncated === false
        && byId.get(record.id) === record.text;
    }),
    projected,
  };
}

function hasTemporalSiblingConflict({ caseRow, run, memoryMap }) {
  if (caseRow.family !== "temporal_relation") return false;
  const goldSet = new Set(caseRow.gold_evidence_ids);
  const goldOwnerIds = new Set(caseRow.gold_evidence_ids.map(id => memoryMap.get(id)?.owner_case_id).filter(Boolean));
  return run.ranked_top3_ids.some(id => {
    const row = memoryMap.get(id);
    return row
      && goldOwnerIds.has(row.owner_case_id)
      && !goldSet.has(id)
      && ["temporal_before", "temporal_after"].includes(row.role);
  });
}

function hasMultiFacetRedundancy({ caseRow, run, memoryMap }) {
  if (caseRow.family !== "multi_facet") return false;
  const requiredRoles = new Set(caseRow.gold_evidence_ids.map(id => memoryMap.get(id)?.role).filter(Boolean));
  if (requiredRoles.size < 2) return false;

  const topRoles = run.ranked_top3_ids
    .map(id => memoryMap.get(id)?.role)
    .filter(role => requiredRoles.has(role));
  const counts = new Map();
  for (const role of topRoles) counts.set(role, (counts.get(role) || 0) + 1);

  const missingRole = [...requiredRoles].some(role => !topRoles.includes(role));
  const duplicatedRequiredRole = [...counts.values()].some(count => count >= 2);
  return missingRole && duplicatedRequiredRole;
}

function attributeCase({ caseRow, run, memoryMap, oracle, rankInputPreserved }) {
  if (!oracle.oracle_top3_feasible) return "TOP3_CAPACITY_LIMIT";
  if (!rankInputPreserved) return "RANK_INPUT_INFORMATION_LOSS";
  if (hasTemporalSiblingConflict({ caseRow, run, memoryMap })) {
    return "TEMPORAL_VERSION_CONFLICT";
  }
  if (hasMultiFacetRedundancy({ caseRow, run, memoryMap })) {
    return "REDUNDANT_SELECTION";
  }
  return "RANK_SELECTION_ERROR";
}

function attributionEvidence({ caseRow, run, memoryMap, oracle, rankInputPreserved }) {
  const goldSet = new Set(caseRow.gold_evidence_ids);
  const missingGoldIds = caseRow.gold_evidence_ids.filter(id => !run.ranked_top3_ids.includes(id));
  const top3RoleCounts = {};
  for (const id of run.ranked_top3_ids) {
    const role = memoryMap.get(id)?.role || "unknown";
    top3RoleCounts[role] = (top3RoleCounts[role] || 0) + 1;
  }
  return Object.freeze({
    missing_gold_count: missingGoldIds.length,
    oracle_top3_feasible: oracle.oracle_top3_feasible,
    rank_input_preserved: rankInputPreserved,
    temporal_sibling_conflict: hasTemporalSiblingConflict({ caseRow, run, memoryMap }),
    required_roles: Object.freeze(caseRow.gold_evidence_ids
      .map(id => memoryMap.get(id)?.role || "unknown")),
    top3_role_counts: Object.freeze(top3RoleCounts),
    top3_gold_count: run.ranked_top3_ids.filter(id => goldSet.has(id)).length,
  });
}

function summarize(rows) {
  const byAttribution = Object.fromEntries(Q5_ATTRIBUTION_LABELS.map(label => [label, 0]));
  const byFamily = {};
  let oracleFeasible = 0;
  let rankInputPreserved = 0;
  let recoveredButNotServed = 0;
  for (const row of rows) {
    byAttribution[row.primary_attribution] += 1;
    byFamily[row.family] = (byFamily[row.family] || 0) + 1;
    oracleFeasible += Number(row.oracle.oracle_top3_feasible);
    rankInputPreserved += Number(row.rank_input_preserved);
    recoveredButNotServed += Number(row.recovered_pool_but_top3_incomplete);
  }
  return Object.freeze({
    case_snapshot_count: rows.length,
    oracle_top3_feasible_count: oracleFeasible,
    rank_input_preserved_count: rankInputPreserved,
    recovered_pool_but_top3_incomplete_count: recoveredButNotServed,
    attribution_counts: Object.freeze(byAttribution),
    family_counts: Object.freeze(byFamily),
  });
}

export function analyzeQ5FixedCandidateFixtureV1(fixture) {
  if (!fixture || fixture.schema !== Q5_FIXED_CANDIDATE_FIXTURE_SCHEMA) {
    throw fail("Q5_FIXTURE_SCHEMA_INVALID");
  }
  const { fixture_sha256: fixtureSha256, ...fixtureBody } = fixture;
  if (fixtureSha256 !== sha256(JSON.stringify(fixtureBody))) {
    throw fail("Q5_FIXTURE_HASH_MISMATCH");
  }
  if (fixture.top_k !== Q5_FIXED_CANDIDATE_TOP_K) throw fail("Q5_FIXTURE_TOPK_DRIFT");
  if (fixture.evidence_mapping !== "direct_candidate_id_equals_gold_evidence_id") {
    throw fail("Q5_FIXTURE_EVIDENCE_MAPPING_UNSUPPORTED");
  }

  const findings = [];
  const summaries = {};

  for (const source of fixture.sources || []) {
    const memoryMap = new Map((source.memories || []).map(row => [row.id, row]));
    const byCase = new Map((source.cases || []).map(row => [row.case_id, row]));
    const sourceFindings = [];

    for (const caseRow of source.cases || []) {
      const baselinePoolComplete = caseRow.gold_evidence_ids
        .every(id => caseRow.baseline.candidate_pool_ids.includes(id));

      for (const arm of ["baseline", "hint"]) {
        const run = caseRow[arm];
        const poolComplete = caseRow.gold_evidence_ids.every(id => run.candidate_pool_ids.includes(id));
        const product = scoreSelection(caseRow.gold_evidence_ids, run.ranked_top3_ids);
        const productRecallAll = metric(product, "recall_all@3");
        if (!poolComplete || productRecallAll === 1) continue;

        const oracle = computeTop3Oracle(caseRow.gold_evidence_ids, run.candidate_pool_ids);
        const projection = projectPool(run.candidate_pool_ids, memoryMap);
        const recoveredButNotServed = arm === "hint"
          && !baselinePoolComplete
          && poolComplete
          && productRecallAll === 0;
        const primaryAttribution = attributeCase({
          caseRow,
          run,
          memoryMap,
          oracle,
          rankInputPreserved: projection.preserved,
        });

        const evidence = attributionEvidence({
          caseRow,
          run,
          memoryMap,
          oracle,
          rankInputPreserved: projection.preserved,
        });

        sourceFindings.push(Object.freeze({
          source_name: source.source_name,
          case_id: caseRow.case_id,
          family: caseRow.family,
          arm,
          pool_gold_complete: true,
          product_top3_recall_any: metric(product, "recall_any@3"),
          product_top3_recall_all: productRecallAll,
          product_top3_evidence_coverage: metric(product, "evidence_coverage@3"),
          oracle,
          oracle_gap: oracle.oracle_top3_evidence_coverage
            - metric(product, "evidence_coverage@3"),
          rank_input_preserved: projection.preserved,
          rank_input_truncated_count: projection.projected.metadata
            .filter(row => row.truncated).length,
          recovered_pool_but_top3_incomplete: recoveredButNotServed,
          primary_attribution: primaryAttribution,
          attribution_evidence: evidence,
        }));
      }
    }

    findings.push(...sourceFindings);
    summaries[source.source_name] = Object.freeze({
      baseline: summarize(sourceFindings.filter(row => row.arm === "baseline")),
      hint: summarize(sourceFindings.filter(row => row.arm === "hint")),
    });

    for (const row of source.cases || []) {
      if (!byCase.has(row.case_id)) throw fail("Q5_CASE_INDEX_CORRUPT");
    }
  }

  const resultBody = {
    schema: Q5_FIXED_CANDIDATE_ATTRIBUTION_SCHEMA,
    fixture_sha256: fixture.fixture_sha256,
    top_k: Q5_FIXED_CANDIDATE_TOP_K,
    provider_requests: 0,
    model_training_runs: 0,
    findings: Object.freeze(findings),
    summaries: Object.freeze(summaries),
  };

  return Object.freeze({
    ...resultBody,
    result_sha256: sha256(JSON.stringify(resultBody)),
  });
}
