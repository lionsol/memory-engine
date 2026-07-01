import {
  TURN_DISCLOSURE_LEVELS,
  TURN_RECALL_INTENTS,
  TURN_TASK_INTENTS,
  parseTurnGoldSetJsonl,
  replayTurnGoldSetJsonlWithFeedback,
} from "./auto-recall-turn-gold-set.js";

const REQUIRED_TASK_INTENTS = [
  "answer_question",
  "continue_prior_work",
  "review_plan",
  "debug_error",
  "summarize_current_text",
  "rewrite_current_text",
  "translate_current_text",
  "extract_structured_info",
  "write_artifact",
];

const REQUIRED_RECALL_INTENTS = [
  "none",
  "project_state",
  "prior_decision",
  "task_state",
  "historical_context",
];

const REQUIRED_CASE_FAMILIES = [
  "long_generic_skip",
  "long_debug_without_history_skip",
  "long_debug_with_history_recall",
  "long_project_review_focused_query",
  "short_continue_recall",
  "explicit_history_recall",
];

function inc(map, key) {
  const value = String(key ?? "unknown");
  map[value] = Number(map[value] || 0) + 1;
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map(item => String(item));
  if (value == null) return [];
  return [String(value)];
}

function getPrompt(row) {
  return String(row?.prompt ?? row?.user_prompt ?? row?.input ?? row?.text ?? "");
}

function classifyCaseFamily(row, result = null) {
  const prompt = getPrompt(row);
  const taskIntent = String(row?.task_intent || "");
  const recallIntents = normalizeArray(row?.recall_intent);
  const expectedRecall = row?.expected_should_recall;
  const actual = result?.actual || {};

  const longInput = actual.long_input_detected === true || prompt.length >= 1000;

  if (
    expectedRecall === false &&
    ["rewrite_current_text", "summarize_current_text", "translate_current_text", "extract_structured_info", "write_artifact"].includes(taskIntent) &&
    longInput
  ) {
    return "long_generic_skip";
  }

  if (taskIntent === "debug_error" && expectedRecall === false && longInput) {
    return "long_debug_without_history_skip";
  }

  if (taskIntent === "debug_error" && expectedRecall === true && recallIntents.includes("historical_context")) {
    return "long_debug_with_history_recall";
  }

  if (taskIntent === "review_plan" && expectedRecall === true && longInput) {
    return "long_project_review_focused_query";
  }

  if (taskIntent === "continue_prior_work" && expectedRecall === true) {
    return "short_continue_recall";
  }

  if (expectedRecall === true && (recallIntents.includes("prior_decision") || actual.explicit_history_context === true)) {
    return "explicit_history_recall";
  }

  return "other";
}

function coverageArray(required, counts) {
  return required.map(key => ({
    key,
    count: Number(counts[key] || 0),
    covered: Number(counts[key] || 0) > 0,
  }));
}

function missingKeys(required, counts) {
  return required.filter(key => Number(counts[key] || 0) === 0);
}

export function observeTurnGoldSetDataset(content, { datasetName = "turn-gold-set", frozen = null } = {}) {
  const parsed = parseTurnGoldSetJsonl(content);
  const { replay, feedback, expansion_plan } = replayTurnGoldSetJsonlWithFeedback(content);
  const rows = parsed.map(item => item.row).filter(row => row && typeof row === "object");
  const resultByTurnId = new Map((replay.results || []).map(result => [result.turn_id, result]));

  const taskIntentCounts = {};
  const recallIntentCounts = {};
  const disclosureLevelCounts = {};
  const caseFamilyCounts = {};
  const expectedRecallCounts = { recall_true: 0, recall_false: 0 };

  for (const row of rows) {
    inc(taskIntentCounts, row.task_intent || "unknown");
    for (const intent of normalizeArray(row.recall_intent)) inc(recallIntentCounts, intent || "unknown");
    inc(disclosureLevelCounts, row.disclosure_level || "unknown");
    if (row.expected_should_recall === true) expectedRecallCounts.recall_true += 1;
    if (row.expected_should_recall === false) expectedRecallCounts.recall_false += 1;
    const result = resultByTurnId.get(row.turn_id);
    inc(caseFamilyCounts, classifyCaseFamily(row, result));
  }

  const missingTaskIntents = missingKeys(REQUIRED_TASK_INTENTS, taskIntentCounts);
  const missingRecallIntents = missingKeys(REQUIRED_RECALL_INTENTS, recallIntentCounts);
  const missingCaseFamilies = missingKeys(REQUIRED_CASE_FAMILIES, caseFamilyCounts);
  const freezeChecks = [];

  if (frozen && typeof frozen === "object") {
    const checks = [
      ["total_count", replay.summary.total_count, frozen.total_count],
      ["valid_count", replay.summary.valid_count, frozen.valid_count],
      ["failed_count", replay.summary.failed_count, frozen.failed_count],
      ["feedback_cluster_count", feedback.summary.cluster_count, frozen.feedback_cluster_count],
      ["expansion_candidate_count", expansion_plan.summary.candidate_count, frozen.expansion_candidate_count],
    ];
    for (const [key, actual, expected] of checks) {
      if (expected !== undefined) {
        freezeChecks.push({ key, actual, expected, pass: actual === expected });
      }
    }
  }

  const gaps = [];
  for (const key of missingTaskIntents) gaps.push({ kind: "missing_task_intent", key, suggested_action: "add_seed_or_real_turn_for_task_intent" });
  for (const key of missingRecallIntents) gaps.push({ kind: "missing_recall_intent", key, suggested_action: "add_seed_or_real_turn_for_recall_intent" });
  for (const key of missingCaseFamilies) gaps.push({ kind: "missing_case_family", key, suggested_action: "add_case_family_counterexample" });
  if (expectedRecallCounts.recall_true === 0) gaps.push({ kind: "missing_expected_recall_true", key: "expected_should_recall", suggested_action: "add_positive_recall_turn" });
  if (expectedRecallCounts.recall_false === 0) gaps.push({ kind: "missing_expected_recall_false", key: "expected_should_recall", suggested_action: "add_no_recall_turn" });

  const freezePassed = freezeChecks.every(check => check.pass);
  const replayClean = replay.summary.failed_count === 0 && replay.summary.invalid_count === 0;

  return {
    summary: {
      mode: "read_only_turn_gold_set_growth_observation",
      dataset: datasetName,
      total_count: replay.summary.total_count,
      valid_count: replay.summary.valid_count,
      invalid_count: replay.summary.invalid_count,
      replay_passed_count: replay.summary.passed_count,
      replay_failed_count: replay.summary.failed_count,
      replay_pass_rate: replay.summary.pass_rate,
      feedback_cluster_count: feedback.summary.cluster_count,
      expansion_candidate_count: expansion_plan.summary.candidate_count,
      coverage_gap_count: gaps.length,
      freeze_check_count: freezeChecks.length,
      freeze_passed: freezeChecks.length > 0 ? freezePassed : null,
      observation_status: replayClean && gaps.length === 0 && (freezeChecks.length === 0 || freezePassed) ? "stable" : "needs_attention",
    },
    freeze_checks: freezeChecks,
    coverage: {
      expected_recall: expectedRecallCounts,
      task_intents: coverageArray(TURN_TASK_INTENTS, taskIntentCounts),
      recall_intents: coverageArray(TURN_RECALL_INTENTS, recallIntentCounts),
      disclosure_levels: coverageArray(TURN_DISCLOSURE_LEVELS, disclosureLevelCounts),
      case_families: coverageArray(REQUIRED_CASE_FAMILIES, caseFamilyCounts),
    },
    gaps,
    replay_summary: replay.summary,
    feedback_summary: feedback.summary,
    expansion_summary: expansion_plan.summary,
    growth_observation: {
      can_expand_from_current_failures: expansion_plan.summary.candidate_count > 0,
      requires_manual_review: expansion_plan.summary.requires_manual_review,
      recommended_next_step: expansion_plan.summary.candidate_count > 0
        ? "review_expansion_candidates_before_commit"
        : gaps.length > 0
          ? "add_manual_seed_rows_for_coverage_gaps"
          : "observe_real_world_mismatches_before_expanding",
    },
    side_effects: {
      db_writes: false,
      memory_file_mutation: false,
      dataset_file_mutation: false,
      retrieval: false,
      injection: false,
      cleanup_apply: false,
      archive: false,
      quarantine: false,
      reinforce: false,
      llm: false,
      network: false,
      runtime_report_files: false,
    },
  };
}

export const TURN_GOLD_SET_SEED_FREEZE = {
  total_count: 12,
  valid_count: 12,
  failed_count: 0,
  feedback_cluster_count: 0,
  expansion_candidate_count: 0,
};
