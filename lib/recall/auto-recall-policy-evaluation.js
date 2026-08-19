import { analyzeAutoRecallIntent } from "./auto-recall-intent.js";
import {
  AUTO_RECALL_RECALL_INTENTS,
  isAutoRecallRecallIntent,
  isAutoRecallRecallIntentArray,
  isAutoRecallTaskIntent,
} from "./auto-recall-intent-contract.js";
import { TURN_GOLD_SET_SCHEMA_VERSION, validateTurnGoldSetRow } from "./auto-recall-turn-gold-set.js";

export const AUTO_RECALL_POLICY_EVALUATION_FAMILIES = Object.freeze([
  "current_input_transformation",
  "fresh_current_analysis",
  "explicit_continuation",
  "implicit_project_state",
  "prior_decision_compare",
  "preference_and_workflow_minimal_pairs",
  "entity_background_minimal_pairs",
  "artifact_tool_casual_new_project",
  "ambiguous_minimal_pairs",
]);

export const AUTO_RECALL_POLICY_EVALUATION_DATASET_CONTRACT = Object.freeze({
  expected_count: 36,
  expected_yes: 18,
  expected_no: 18,
  required_families: AUTO_RECALL_POLICY_EVALUATION_FAMILIES,
});

const NON_NONE_RECALL_INTENTS = new Set(
  AUTO_RECALL_RECALL_INTENTS.filter(intent => intent !== "none"),
);

function unique(values) {
  return [...new Set(values.filter(value => value != null && value !== ""))];
}

function isBoolean(value) {
  return typeof value === "boolean";
}

function descriptor(result, reason) {
  return {
    turn_id: result.turn_id,
    family: result.family,
    reason: String(reason || "unspecified").slice(0, 96),
  };
}

function exactArrayEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Evaluation-only v2-B1 mapping. This function has no runtime policy authority.
 * The `none` value is exclusive so mixed arrays cannot be silently normalized.
 */
export function mapRecallIntentToCandidatePolicy(recallIntent) {
  if (!Array.isArray(recallIntent) || recallIntent.length === 0) {
    return {
      valid: false,
      should_recall: null,
      reason: "invalid_recall_intent_contract",
      error: "invalid_recall_intent_contract",
    };
  }

  if (!isAutoRecallRecallIntentArray(recallIntent)) {
    return {
      valid: false,
      should_recall: null,
      reason: "invalid_recall_intent_contract",
      error: "invalid_recall_intent_contract",
    };
  }

  const hasNone = recallIntent.includes("none");
  const nonNone = recallIntent.filter(intent => NON_NONE_RECALL_INTENTS.has(intent));
  if (hasNone && (recallIntent.length !== 1 || nonNone.length > 0)) {
    return {
      valid: false,
      should_recall: null,
      reason: "invalid_recall_intent_contract",
      error: "invalid_recall_intent_contract",
    };
  }

  if (hasNone) {
    return {
      valid: true,
      should_recall: false,
      reason: "no_memory_intent",
      error: null,
    };
  }

  return {
    valid: true,
    should_recall: true,
    reason: "historical_memory_intent",
    error: null,
  };
}

function validatePolicyEvaluationRow(row, { lineNumber = null } = {}) {
  const errors = [];
  const base = validateTurnGoldSetRow(row, { lineNumber });
  errors.push(...base.errors);

  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return {
      valid: false,
      errors: unique(errors),
      line_number: lineNumber,
    };
  }

  if (typeof row.family !== "string" || row.family.trim().length === 0) {
    errors.push("family");
  } else if (!AUTO_RECALL_POLICY_EVALUATION_FAMILIES.includes(row.family)) {
    errors.push("family_unknown");
  }

  if (!isAutoRecallTaskIntent(row.task_intent)) errors.push("task_intent_required");
  if (!Array.isArray(row.recall_intent)) {
    errors.push("recall_intent_required_array");
  } else if (!isAutoRecallRecallIntentArray(row.recall_intent)) {
    errors.push("recall_intent_required_valid_array");
  }

  const mapping = mapRecallIntentToCandidatePolicy(row.recall_intent);
  if (!mapping.valid) errors.push("recall_intent_policy_contract");
  if (!isBoolean(row.expected_should_recall)) errors.push("expected_should_recall_required");

  return {
    valid: errors.length === 0,
    errors: unique(errors),
    line_number: lineNumber,
  };
}

export function validateAutoRecallPolicyEvaluationDataset(rows, options = {}) {
  const items = Array.isArray(rows) ? rows : [];
  const errors = [];
  const rowErrors = [];
  const ids = new Set();
  const familyCounts = new Map();
  let expectedYes = 0;
  let expectedNo = 0;

  items.forEach((row, index) => {
    const lineNumber = index + 1;
    const validation = validatePolicyEvaluationRow(row, { lineNumber });
    if (!validation.valid) {
      rowErrors.push({
        turn_id: row?.turn_id || null,
        family: row?.family || null,
        line_number: lineNumber,
        errors: validation.errors,
      });
    }

    if (row?.turn_id) {
      if (ids.has(row.turn_id)) errors.push(`duplicate_turn_id:${row.turn_id}`);
      ids.add(row.turn_id);
    }
    if (typeof row?.family === "string") {
      familyCounts.set(row.family, (familyCounts.get(row.family) || 0) + 1);
    }
    if (row?.expected_should_recall === true) expectedYes += 1;
    if (row?.expected_should_recall === false) expectedNo += 1;
  });

  const expectedCount = options.expected_count ?? null;
  const expectedYesCount = options.expected_yes ?? null;
  const expectedNoCount = options.expected_no ?? null;
  if (expectedCount != null && items.length !== expectedCount) {
    errors.push(`dataset_count:${items.length}!=${expectedCount}`);
  }
  if (expectedYesCount != null && expectedYes !== expectedYesCount) {
    errors.push(`expected_yes:${expectedYes}!=${expectedYesCount}`);
  }
  if (expectedNoCount != null && expectedNo !== expectedNoCount) {
    errors.push(`expected_no:${expectedNo}!=${expectedNoCount}`);
  }

  const requiredFamilies = Array.isArray(options.required_families)
    ? options.required_families
    : [];
  for (const family of requiredFamilies) {
    if (!familyCounts.has(family)) errors.push(`missing_family:${family}`);
  }

  return {
    valid: errors.length === 0 && rowErrors.length === 0,
    errors: unique(errors),
    row_errors: rowErrors,
    summary: {
      total: items.length,
      valid: items.length - rowErrors.length,
      invalid: rowErrors.length,
      expected_yes: expectedYes,
      expected_no: expectedNo,
      family_counts: Object.fromEntries([...familyCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
    },
  };
}

export function parseAutoRecallPolicyEvaluationJsonl(content) {
  const rows = [];
  const parseErrors = [];
  for (const [index, line] of String(content || "").split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      parseErrors.push({
        line_number: index + 1,
        error: String(error?.message || error).slice(0, 160),
      });
    }
  }
  return { rows, parse_errors: parseErrors };
}

function confusionMatrix(results, policyKey) {
  let truePositive = 0;
  let trueNegative = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let invalid = 0;

  for (const result of results) {
    const expected = result.expected.should_recall;
    const actual = result[policyKey]?.should_recall;
    if (!isBoolean(expected) || !isBoolean(actual)) {
      invalid += 1;
      continue;
    }
    if (expected && actual) truePositive += 1;
    else if (!expected && !actual) trueNegative += 1;
    else if (!expected && actual) falsePositive += 1;
    else falseNegative += 1;
  }

  const total = results.length;
  const scored = truePositive + trueNegative + falsePositive + falseNegative;
  const ratio = value => (value == null ? null : Number(value.toFixed(4)));
  return {
    total,
    scored,
    invalid,
    true_positive: truePositive,
    true_negative: trueNegative,
    false_positive: falsePositive,
    false_negative: falseNegative,
    accuracy: scored > 0 ? ratio((truePositive + trueNegative) / scored) : null,
    precision: truePositive + falsePositive > 0 ? ratio(truePositive / (truePositive + falsePositive)) : null,
    recall: truePositive + falseNegative > 0 ? ratio(truePositive / (truePositive + falseNegative)) : null,
  };
}

function buildRootCauses(result) {
  const causes = [];
  const expected = result.expected.should_recall;
  const oracle = result.v2_oracle.should_recall;
  const runtime = result.v2_runtime_candidate.should_recall;
  const v1 = result.v1.should_recall;

  if (expected === true && oracle === true && runtime === false && result.classification.recall_intent_match === false) {
    causes.push("CLASSIFIER_GAP");
  }
  if (expected === true && oracle === false) causes.push("POLICY_MAPPING_GAP");
  if (expected === false && v1 === true && runtime === false) causes.push("FALSE_POSITIVE_REMOVED");
  if (expected === true && v1 === true && runtime === false) causes.push("FALSE_NEGATIVE_INTRODUCED");
  return causes;
}

function evaluateCase(row, index) {
  const validation = validatePolicyEvaluationRow(row, { lineNumber: index + 1 });
  const prompt = typeof row?.prompt === "string" ? row.prompt : "";
  const actual = prompt.trim() ? analyzeAutoRecallIntent(prompt) : null;
  const expectedRecall = Array.isArray(row?.recall_intent) ? row.recall_intent : null;
  const oraclePolicy = mapRecallIntentToCandidatePolicy(expectedRecall);
  const runtimePolicy = mapRecallIntentToCandidatePolicy(actual?.recall_intent);
  const taskMatch = isAutoRecallTaskIntent(row?.task_intent) && actual
    ? actual.task_intent === row.task_intent
    : null;
  const recallMatch = isAutoRecallRecallIntentArray(expectedRecall) && actual
    ? exactArrayEqual(actual.recall_intent, expectedRecall)
    : null;
  const v1ShouldRecall = actual?.should_recall ?? null;
  const expectedShouldRecall = isBoolean(row?.expected_should_recall)
    ? row.expected_should_recall
    : null;
  const runtimeShouldRecall = runtimePolicy.should_recall;
  const changed = isBoolean(v1ShouldRecall) && isBoolean(runtimeShouldRecall)
    ? v1ShouldRecall !== runtimeShouldRecall
    : null;
  const direction = changed === false
    ? "unchanged"
    : v1ShouldRecall === false && runtimeShouldRecall === true
      ? "recall_added"
      : v1ShouldRecall === true && runtimeShouldRecall === false
        ? "recall_removed"
        : null;

  const result = {
    turn_id: row?.turn_id || null,
    family: row?.family || null,
    valid: validation.valid,
    errors: validation.errors,
    expected: {
      task_intent: row?.task_intent ?? null,
      recall_intent: expectedRecall,
      should_recall: expectedShouldRecall,
    },
    actual_classifier: actual
      ? {
        task_intent: actual.task_intent,
        recall_intent: actual.recall_intent,
      }
      : null,
    v1: {
      should_recall: v1ShouldRecall,
      reason: actual?.intent_reason || null,
      correct: isBoolean(expectedShouldRecall) && v1ShouldRecall === expectedShouldRecall,
    },
    v2_oracle: {
      should_recall: oraclePolicy.should_recall,
      reason: oraclePolicy.reason,
      error: oraclePolicy.error,
      correct: isBoolean(expectedShouldRecall) && oraclePolicy.should_recall === expectedShouldRecall,
    },
    v2_runtime_candidate: {
      should_recall: runtimeShouldRecall,
      reason: runtimePolicy.reason,
      error: runtimePolicy.error,
      correct: isBoolean(expectedShouldRecall) && runtimeShouldRecall === expectedShouldRecall,
    },
    classification: {
      task_intent_match: taskMatch,
      recall_intent_match: recallMatch,
    },
    decision_delta: {
      v1_to_candidate_changed: changed,
      direction,
    },
  };

  result.root_causes = buildRootCauses(result);
  return result;
}

function caseList(results, predicate, reason) {
  return results.filter(predicate).map(result => descriptor(result, reason(result)));
}

export function evaluateAutoRecallPolicyDataset(rows, options = {}) {
  const items = Array.isArray(rows) ? rows : [];
  const validation = validateAutoRecallPolicyEvaluationDataset(items, options);
  const results = items.map(evaluateCase);
  const parseErrors = Array.isArray(options.parse_errors) ? options.parse_errors : [];
  if (parseErrors.length > 0) {
    validation.valid = false;
    validation.errors = unique([...validation.errors, "json_parse_error"]);
  }

  const v1 = confusionMatrix(results, "v1");
  const oracle = confusionMatrix(results, "v2_oracle");
  const runtime = confusionMatrix(results, "v2_runtime_candidate");
  const v1ToRuntimeChanged = results.filter(result => result.decision_delta.v1_to_candidate_changed === true);
  const falsePositiveReduced = results.filter(result => (
    result.expected.should_recall === false
    && result.v1.should_recall === true
    && result.v2_runtime_candidate.should_recall === false
  ));
  const falseNegativeAdded = results.filter(result => (
    result.expected.should_recall === true
    && result.v1.should_recall === true
    && result.v2_runtime_candidate.should_recall === false
  ));
  const v1FalsePositive = results.filter(result => result.expected.should_recall === false && result.v1.should_recall === true);
  const v1FalseNegative = results.filter(result => result.expected.should_recall === true && result.v1.should_recall === false);
  const runtimeFalsePositive = results.filter(result => result.expected.should_recall === false && result.v2_runtime_candidate.should_recall === true);
  const runtimeFalseNegative = results.filter(result => result.expected.should_recall === true && result.v2_runtime_candidate.should_recall === false);
  const taskMismatches = results.filter(result => result.classification.task_intent_match === false);
  const recallMismatches = results.filter(result => result.classification.recall_intent_match === false);

  const diagnostics = {
    task_intent_mismatch_count: taskMismatches.length,
    recall_intent_mismatch_count: recallMismatches.length,
    v1_false_positive_count: v1.false_positive,
    v1_false_negative_count: v1.false_negative,
    oracle_false_positive_count: oracle.false_positive,
    oracle_false_negative_count: oracle.false_negative,
    runtime_candidate_false_positive_count: runtime.false_positive,
    runtime_candidate_false_negative_count: runtime.false_negative,
    v1_to_runtime_changed_count: v1ToRuntimeChanged.length,
    false_positive_reduced_count: falsePositiveReduced.length,
    false_negative_added_count: falseNegativeAdded.length,
    v1_false_positive_cases: v1FalsePositive.map(result => descriptor(result, result.v1.reason)),
    v1_false_negative_cases: v1FalseNegative.map(result => descriptor(result, result.v1.reason)),
    runtime_false_positive_cases: runtimeFalsePositive.map(result => descriptor(result, result.v2_runtime_candidate.reason)),
    runtime_false_negative_cases: runtimeFalseNegative.map(result => descriptor(result, result.v2_runtime_candidate.reason)),
    task_classifier_mismatch_cases: taskMismatches.map(result => descriptor(result, "task_intent_mismatch")),
    recall_classifier_mismatch_cases: recallMismatches.map(result => descriptor(result, "recall_intent_mismatch")),
    root_cause_counts: Object.fromEntries(
      ["CLASSIFIER_GAP", "POLICY_MAPPING_GAP", "FALSE_POSITIVE_REMOVED", "FALSE_NEGATIVE_INTRODUCED"]
        .map(cause => [cause, results.filter(result => result.root_causes.includes(cause)).length]),
    ),
  };

  return {
    mode: "offline_auto_recall_policy_evaluation_v2b1",
    schema_version: TURN_GOLD_SET_SCHEMA_VERSION,
    policy: {
      name: "v2b1_recall_intent_non_none_allows_recall",
      authority: "evaluation_only",
      task_intent_authority: false,
      none_exclusive: true,
    },
    validation: {
      ...validation,
      parse_errors: parseErrors,
    },
    summary: {
      total: items.length,
      expected_yes: validation.summary.expected_yes,
      expected_no: validation.summary.expected_no,
      valid: validation.summary.valid,
      invalid: validation.summary.invalid,
    },
    confusion_matrices: {
      v1_current: v1,
      v2_oracle_policy: oracle,
      v2_runtime_candidate: runtime,
    },
    diagnostics,
    results,
    side_effects: {
      db_writes: false,
      dataset_file_mutation: false,
      memory_file_mutation: false,
      retrieval: false,
      injection: false,
      llm: false,
      network: false,
      runtime_report_files: false,
    },
  };
}

export function evaluateAutoRecallPolicyDatasetJsonl(content, options = {}) {
  const parsed = parseAutoRecallPolicyEvaluationJsonl(content);
  return evaluateAutoRecallPolicyDataset(parsed.rows, {
    ...options,
    parse_errors: parsed.parse_errors,
  });
}
