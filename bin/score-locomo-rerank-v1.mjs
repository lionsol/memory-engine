#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { scoreQ1EvidenceRankingAt3 } from "../lib/benchmark/q1-product-metric-contract-v1.js";
import { loadLocomoMaterial } from "./run-locomo-rerank-v1.mjs";

const METRICS = ["recall_any@3", "recall_all@3", "ndcg@3", "evidence_coverage@3"];
const TOLERANCE = 1e-12;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function writeFinalizedJsonReportWithDigest(reportPath, report) {
  const bytes = Buffer.from(JSON.stringify(report, null, 2), "utf8");
  writeFileSync(reportPath, bytes, { mode: 0o600 });
  const reportSha256 = createHash("sha256").update(bytes).digest("hex");
  const reportSha256Path = `${reportPath}.sha256`;
  writeFileSync(reportSha256Path, `${reportSha256}\n`, { mode: 0o600 });
  return { reportSha256, reportSha256Path };
}

function mean(values) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function metrics(score) {
  return Object.fromEntries(METRICS.map(key => [key, score[key]]));
}

function aggregate(rows, field) {
  return Object.fromEntries(METRICS.map(key => [key, mean(rows.map(row => row[field][key]))]));
}

function transitions(rows, left, right) {
  return Object.fromEntries(METRICS.map(key => {
    let improved = 0;
    let regressed = 0;
    let unchanged = 0;
    for (const row of rows) {
      const delta = row[left][key] - row[right][key];
      if (delta > TOLERANCE) improved += 1;
      else if (delta < -TOLERANCE) regressed += 1;
      else unchanged += 1;
    }
    return [key, { improved, regressed, unchanged, comparable: rows.length }];
  }));
}

function structure(rows, field) {
  const feasible = rows.filter(row => row[field]["budget_feasible@3"] === true);
  const crossSession = rows.filter(row => row[field].cross_session_case === true);
  const firstRanks = rows.map(row => row[field]["first_relevant_rank@3"]).filter(rank => rank !== null);
  return {
    budget_feasible: feasible.length,
    budget_infeasible: rows.length - feasible.length,
    recall_all_at_3_feasible: mean(feasible.map(row => row[field]["recall_all@3_feasible"])),
    cross_session_case_count: crossSession.length,
    cross_session_evidence_coverage_at_3: mean(crossSession.map(row => row[field]["evidence_coverage@3"])),
    first_relevant_rank_distribution: {
      "1": firstRanks.filter(rank => rank === 1).length,
      "2": firstRanks.filter(rank => rank === 2).length,
      "3": firstRanks.filter(rank => rank === 3).length,
      none_in_top3: rows.length - firstRanks.length,
    },
  };
}

function scoreCase(gold, ranked) {
  return scoreQ1EvidenceRankingAt3({
    gold_evidence_ids: gold,
    ranked_retrieved_ids: ranked,
  }, {
    provenance: "BENCHMARK_DERIVED",
    source_identity: {
      dataset: "LoCoMo",
      dataset_sha256: "79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4",
      experiment: "q3_v1_2_locomo_rerank",
    },
  });
}

function sentinelComparison(state, phaseA, phaseB) {
  const a = new Map(state.phases[phaseA].results.map(item => [item.question_id, item]));
  const b = new Map(state.phases[phaseB].results.map(item => [item.question_id, item]));
  const rows = [];
  for (const [questionId, left] of a) {
    const right = b.get(questionId);
    if (!right) throw new Error(`locomo_post_sentinel_missing:${questionId}`);
    const leftEvidence = readJson(left.evidence_path);
    const rightEvidence = readJson(right.evidence_path);
    const leftScores = leftEvidence.raw_scores_by_original_index;
    const rightScores = rightEvidence.raw_scores_by_original_index;
    const deltas = leftScores.map((value, index) => rightScores[index] - value);
    rows.push({
      question_id: questionId,
      pre_fingerprint: leftEvidence.fingerprint,
      post_fingerprint: rightEvidence.fingerprint,
      fingerprint_equal: leftEvidence.fingerprint === rightEvidence.fingerprint,
      max_abs_score_delta: Math.max(...deltas.map(delta => Math.abs(delta))),
      score_delta_sum: deltas.reduce((sum, delta) => sum + delta, 0),
      pre_top3: leftEvidence.sorted_session_ids.slice(0, 3),
      post_top3: rightEvidence.sorted_session_ids.slice(0, 3),
      top3_changed: JSON.stringify(leftEvidence.sorted_session_ids.slice(0, 3))
        !== JSON.stringify(rightEvidence.sorted_session_ids.slice(0, 3)),
      order_changed: JSON.stringify(leftEvidence.sorted_session_ids)
        !== JSON.stringify(rightEvidence.sorted_session_ids),
    });
  }
  return {
    case_count: rows.length,
    fingerprint_equal_count: rows.filter(row => row.fingerprint_equal).length,
    fingerprint_different_count: rows.filter(row => !row.fingerprint_equal).length,
    order_changed_count: rows.filter(row => row.order_changed).length,
    top3_changed_count: rows.filter(row => row.top3_changed).length,
    max_abs_score_delta: rows.length ? Math.max(...rows.map(row => row.max_abs_score_delta)) : 0,
    cases: rows,
  };
}

export function scoreLocomoRerank({ root }) {
  const material = loadLocomoMaterial(root);
  const statePath = join(root, "state", "runner-state.json");
  if (!existsSync(statePath)) throw new Error("locomo_score_state_missing");
  const state = readJson(statePath);
  if (state.status !== "complete") throw new Error(`locomo_score_run_not_complete:${state.status}`);
  if (state.budget.unknown_requests !== 0 || state.budget.failed_responses !== 0) {
    throw new Error("locomo_score_run_contains_unknown_or_failed_requests");
  }
  const semantic = readJson(join(root, "material", "locomo-binding-full.json"));
  const semanticRows = semantic.case_scores.filter(row => row.scoreable === true);
  const lexical = readJson(join(root, "material", "locomo-lexical-case-rows.json"));
  const lexicalById = new Map(lexical.filter(row => row.scoreable === true).map(row => [row.question_id, row]));
  if (semanticRows.length !== material.cases.length || lexicalById.size !== material.cases.length) {
    throw new Error("locomo_score_baseline_denominator_mismatch");
  }

  const mainById = new Map(state.phases.main.results.map(item => [item.question_id, item]));
  const rows = material.cases.map((item, index) => {
    const main = mainById.get(item.question_id);
    if (!main?.validation_ok) throw new Error(`locomo_score_main_case_missing:${item.question_id}`);
    const evidence = readJson(main.evidence_path);
    const rerank = scoreCase(item.gold_evidence_ids, evidence.sorted_session_ids);
    const control = scoreCase(item.gold_evidence_ids, item.retrieved_session_ids);
    const semanticScore = semanticRows[index];
    if (JSON.stringify(semanticScore.gold_evidence_ids) !== JSON.stringify(item.gold_evidence_ids)) {
      throw new Error(`locomo_score_semantic_alignment_mismatch:${item.question_id}`);
    }
    const lexicalScore = lexicalById.get(item.question_id);
    return {
      question_id: item.question_id,
      family: item.family,
      rerank: { ...metrics(rerank), "budget_feasible@3": rerank["budget_feasible@3"], "recall_all@3_feasible": rerank["recall_all@3_feasible"], "first_relevant_rank@3": rerank["first_relevant_rank@3"], cross_session_case: rerank.cross_session_case },
      semantic: metrics(semanticScore),
      lexical: metrics(lexicalScore.q1),
      control: { ...metrics(control), "budget_feasible@3": control["budget_feasible@3"], "recall_all@3_feasible": control["recall_all@3_feasible"], "first_relevant_rank@3": control["first_relevant_rank@3"], cross_session_case: control.cross_session_case },
      usage: evidence.usage ?? null,
      request_latency_ms: evidence.request_latency_ms,
      fingerprint: evidence.fingerprint,
    };
  });

  const phaseAttempts = state.attempts.filter(attempt => attempt.outcome === "confirmed_valid");
  const usageRows = rows.map(row => row.usage).filter(Boolean);
  const latency = rows.map(row => row.request_latency_ms).filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = p => latency.length ? latency[Math.min(latency.length - 1, Math.ceil(p * latency.length) - 1)] : null;
  const byFamily = {};
  for (const row of rows) (byFamily[row.family] ||= []).push(row);
  const report = {
    schema: "q3_v1_2_locomo_rerank_score_v1",
    status: "PROVISIONAL_POST_SENTINEL_COMPLETE",
    provider_calls_for_scoring: 0,
    frozen_scorer: "scoreQ1EvidenceRankingAt3",
    material_identity: material.material_identity,
    metrics: {
      rerank: aggregate(rows, "rerank"),
      semantic: aggregate(rows, "semantic"),
      lexical: aggregate(rows, "lexical"),
      empty_placement_control: aggregate(rows, "control"),
    },
    deltas: {
      rerank_vs_semantic: Object.fromEntries(METRICS.map(key => [key, aggregate(rows, "rerank")[key] - aggregate(rows, "semantic")[key]])),
      rerank_vs_lexical: Object.fromEntries(METRICS.map(key => [key, aggregate(rows, "rerank")[key] - aggregate(rows, "lexical")[key]])),
      rerank_vs_empty_placement_control: Object.fromEntries(METRICS.map(key => [key, aggregate(rows, "rerank")[key] - aggregate(rows, "control")[key]])),
    },
    paired_transitions: {
      rerank_vs_semantic: transitions(rows, "rerank", "semantic"),
      rerank_vs_lexical: transitions(rows, "rerank", "lexical"),
      rerank_vs_empty_placement_control: transitions(rows, "rerank", "control"),
    },
    structure: structure(rows, "rerank"),
    category_breakdown: Object.fromEntries(Object.entries(byFamily).sort(([a], [b]) => a.localeCompare(b)).map(([family, familyRows]) => [family, {
      count: familyRows.length,
      rerank: aggregate(familyRows, "rerank"),
      semantic: aggregate(familyRows, "semantic"),
      lexical: aggregate(familyRows, "lexical"),
      delta_vs_semantic: Object.fromEntries(METRICS.map(key => [key, aggregate(familyRows, "rerank")[key] - aggregate(familyRows, "semantic")[key]])),
    }])),
    sentinel_comparison: sentinelComparison(state, "pre_sentinel", "post_sentinel"),
    execution: {
      attempts: state.budget.attempts,
      valid_responses: state.budget.valid_responses,
      failed_responses: state.budget.failed_responses,
      unknown_requests: state.budget.unknown_requests,
      confirmed_main_requests: phaseAttempts.filter(attempt => attempt.phase === "main").length,
      usage_available: usageRows.length,
      input_tokens_sum: usageRows.reduce((sum, usage) => sum + Number(usage?.tokens?.input_tokens ?? usage?.input_tokens ?? 0), 0),
      latency_ms: {
        count: latency.length,
        p50: percentile(0.5),
        p95: percentile(0.95),
        min: latency[0] ?? null,
        max: latency.at(-1) ?? null,
        mean: mean(latency),
      },
      active_wait_is_excluded_from_latency: true,
    },
    artifact_hashes: {
      state: sha256File(statePath),
      material_manifest: sha256File(join(root, "material.sha256.before-run")),
    },
  };
  const reportPath = join(root, "reports", "locomo-rerank-score.json");
  mkdirSync(join(root, "reports"), { recursive: true, mode: 0o700 });
  const { reportSha256, reportSha256Path } = writeFinalizedJsonReportWithDigest(reportPath, report);
  return { reportPath, reportSha256, reportSha256Path, report };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rootArg = process.argv[process.argv.indexOf("--root") + 1];
  const root = resolve(rootArg || process.env.Q3_LOCOMO_ROOT || "/tmp/q3-locomo-v1.2");
  try {
    const result = scoreLocomoRerank({ root });
    console.log(JSON.stringify({ report_path: result.reportPath, status: result.report.status }));
  } catch (error) {
    console.error(`LOCOMO_SCORE_STOPPED ${error?.message || error}`);
    process.exitCode = 1;
  }
}
