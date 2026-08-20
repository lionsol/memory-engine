import { analyzeAutoRecallIntent } from "./auto-recall-intent.js";
import {
  applySelectiveRecallGateToV1,
  SELECTIVE_RECALL_GATE_DECISIONS,
} from "./selective-recall-gate.js";

export const SELECTIVE_RECALL_GATE_C2_EVIDENCE_ROLE = "evaluation_contract_only";
export const SELECTIVE_RECALL_GATE_C2_AUTHORITY = "OFFLINE ONLY / NOT RUNTIME AUTHORIZED";
export const SELECTIVE_RECALL_GATE_C2_ANNOTATOR = "v2c2_planner_holdout";
export const SELECTIVE_RECALL_GATE_C2_SCHEMA_VERSION = 1;

export const SELECTIVE_RECALL_GATE_C2_READINESS_GATES = Object.freeze({
  expected_count: 48,
  expected_yes: 24,
  expected_no: 24,
  expected_family_count: 12,
  rows_per_family: 4,
  minimum_false_positive_reduced: 2,
  minimum_false_positive_reduction_rate: 0.1,
});

function isBoolean(value) {
  return typeof value === "boolean";
}

function unique(values) {
  return [...new Set(values)];
}

function ratio(value) {
  return Number(value.toFixed(4));
}

function descriptor(result, reason = result?.gate_reason) {
  return {
    turn_id: result?.turn_id || null,
    family: result?.family || null,
    reason: String(reason || "unspecified").slice(0, 96),
  };
}

function normalizeFamilies(allowedFamilies) {
  if (allowedFamilies == null) return null;
  return Array.isArray(allowedFamilies)
    ? Object.freeze([...allowedFamilies])
    : allowedFamilies;
}

/**
 * Build the C2 behavioral holdout contract. The default is the frozen future
 * shape; a future Planner wrapper supplies the actual family allowlist. The
 * optional count overrides make the pure evaluator testable with small
 * synthetic rows without weakening the exported default contract.
 */
export function createSelectiveRecallGateC2Contract(options = {}) {
  const defaults = SELECTIVE_RECALL_GATE_C2_READINESS_GATES;
  return Object.freeze({
    schema_version: SELECTIVE_RECALL_GATE_C2_SCHEMA_VERSION,
    expected_count: options.expected_count ?? defaults.expected_count,
    expected_yes: options.expected_yes ?? defaults.expected_yes,
    expected_no: options.expected_no ?? defaults.expected_no,
    expected_family_count: options.expected_family_count ?? defaults.expected_family_count,
    rows_per_family: options.rows_per_family ?? defaults.rows_per_family,
    allowed_families: normalizeFamilies(options.allowed_families),
    label_confidence: "high",
    annotator: SELECTIVE_RECALL_GATE_C2_ANNOTATOR,
  });
}

export const SELECTIVE_RECALL_GATE_C2_CONTRACT = createSelectiveRecallGateC2Contract();

function validateContract(contract) {
  const errors = [];
  const integerFields = [
    "schema_version",
    "expected_count",
    "expected_yes",
    "expected_no",
    "expected_family_count",
    "rows_per_family",
  ];
  for (const field of integerFields) {
    if (!Number.isInteger(contract?.[field]) || contract[field] < 0) {
      errors.push(`contract_${field}`);
    }
  }
  if (contract?.schema_version !== SELECTIVE_RECALL_GATE_C2_SCHEMA_VERSION) {
    errors.push("contract_schema_version");
  }
  if (contract?.label_confidence !== "high") errors.push("contract_label_confidence");
  if (contract?.annotator !== SELECTIVE_RECALL_GATE_C2_ANNOTATOR) {
    errors.push("contract_annotator");
  }
  if (contract?.allowed_families != null) {
    if (!Array.isArray(contract.allowed_families)) {
      errors.push("contract_allowed_families");
    } else if (
      contract.allowed_families.length !== contract.expected_family_count
      || unique(contract.allowed_families).length !== contract.allowed_families.length
      || contract.allowed_families.some(family => typeof family !== "string" || family.trim().length === 0)
    ) {
      errors.push("contract_allowed_families");
    }
  }
  return unique(errors);
}

function validateRow(row, contract) {
  const errors = [];
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return ["row_object_required"];
  }
  if (row.schema_version !== contract.schema_version) errors.push("schema_version");
  if (typeof row.turn_id !== "string" || row.turn_id.trim().length === 0) {
    errors.push("turn_id");
  }
  if (typeof row.family !== "string" || row.family.trim().length === 0) {
    errors.push("family");
  } else if (
    Array.isArray(contract.allowed_families)
    && !contract.allowed_families.includes(row.family)
  ) {
    errors.push("family_unknown");
  }
  if (typeof row.prompt !== "string" || row.prompt.trim().length === 0) {
    errors.push("prompt");
  }
  if (!isBoolean(row.expected_should_recall)) errors.push("expected_should_recall");
  if (row.label_confidence !== contract.label_confidence) errors.push("label_confidence");
  if (row.annotator !== contract.annotator) errors.push("annotator");
  return unique(errors);
}

export function validateSelectiveRecallGateC2Dataset(
  rows,
  contract = SELECTIVE_RECALL_GATE_C2_CONTRACT,
) {
  const items = Array.isArray(rows) ? rows : [];
  const errors = validateContract(contract);
  const rowErrors = [];
  const ids = new Set();
  const familyCounts = new Map();
  let expectedYes = 0;
  let expectedNo = 0;

  items.forEach((row, index) => {
    const lineNumber = index + 1;
    const rowValidation = validateRow(row, contract);
    if (rowValidation.length > 0) {
      rowErrors.push({
        turn_id: row?.turn_id || null,
        family: row?.family || null,
        line_number: lineNumber,
        errors: rowValidation,
      });
    }
    if (typeof row?.turn_id === "string" && row.turn_id.length > 0) {
      if (ids.has(row.turn_id)) errors.push(`duplicate_turn_id:${row.turn_id}`);
      ids.add(row.turn_id);
    }
    if (typeof row?.family === "string" && row.family.length > 0) {
      familyCounts.set(row.family, (familyCounts.get(row.family) || 0) + 1);
    }
    if (row?.expected_should_recall === true) expectedYes += 1;
    if (row?.expected_should_recall === false) expectedNo += 1;
  });

  if (items.length !== contract.expected_count) {
    errors.push(`dataset_count:${items.length}!=${contract.expected_count}`);
  }
  if (expectedYes !== contract.expected_yes) {
    errors.push(`expected_yes:${expectedYes}!=${contract.expected_yes}`);
  }
  if (expectedNo !== contract.expected_no) {
    errors.push(`expected_no:${expectedNo}!=${contract.expected_no}`);
  }

  const familyNames = [...familyCounts.keys()];
  if (familyNames.length !== contract.expected_family_count) {
    errors.push(`family_count:${familyNames.length}!=${contract.expected_family_count}`);
  }
  for (const [family, count] of familyCounts.entries()) {
    if (count !== contract.rows_per_family) {
      errors.push(`family_rows:${family}:${count}!=${contract.rows_per_family}`);
    }
  }
  if (Array.isArray(contract.allowed_families)) {
    for (const family of contract.allowed_families) {
      if (!familyCounts.has(family)) errors.push(`missing_family:${family}`);
    }
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
      family_counts: Object.fromEntries(
        [...familyCounts.entries()].sort(([left], [right]) => left.localeCompare(right)),
      ),
    },
  };
}

function confusionMatrix(results, actualKey) {
  let truePositive = 0;
  let trueNegative = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let invalid = 0;

  for (const result of results) {
    const expected = result.expected_should_recall;
    const actual = result[actualKey];
    if (!isBoolean(expected) || !isBoolean(actual)) {
      invalid += 1;
    } else if (expected && actual) {
      truePositive += 1;
    } else if (!expected && !actual) {
      trueNegative += 1;
    } else if (!expected && actual) {
      falsePositive += 1;
    } else {
      falseNegative += 1;
    }
  }

  const total = results.length;
  const scored = truePositive + trueNegative + falsePositive + falseNegative;
  return {
    total,
    scored,
    invalid,
    true_positive: truePositive,
    true_negative: trueNegative,
    false_positive: falsePositive,
    false_negative: falseNegative,
    accuracy: scored > 0 ? ratio((truePositive + trueNegative) / scored) : null,
    precision: truePositive + falsePositive > 0
      ? ratio(truePositive / (truePositive + falsePositive))
      : null,
    recall: truePositive + falseNegative > 0
      ? ratio(truePositive / (truePositive + falseNegative))
      : null,
  };
}

function evaluateRow(row, index) {
  const prompt = typeof row?.prompt === "string" ? row.prompt : "";
  const analysis = prompt.trim() ? analyzeAutoRecallIntent(prompt) : null;
  const v1ShouldRecall = analysis?.should_recall ?? null;
  const applied = analysis
    ? applySelectiveRecallGateToV1(prompt, v1ShouldRecall)
    : {
      decision: SELECTIVE_RECALL_GATE_DECISIONS.ABSTAIN,
      reason: "invalid_prompt",
      should_recall: null,
    };
  const selectiveShouldRecall = applied.should_recall;
  const safeSkipChangedV1 = applied.decision === SELECTIVE_RECALL_GATE_DECISIONS.SAFE_SKIP
    && isBoolean(v1ShouldRecall)
    && v1ShouldRecall !== selectiveShouldRecall;

  return {
    turn_id: row?.turn_id || null,
    family: row?.family || null,
    expected_should_recall: row?.expected_should_recall ?? null,
    v1_should_recall: v1ShouldRecall,
    v1_reason: analysis?.intent_reason || null,
    gate_decision: applied.decision,
    gate_reason: applied.reason,
    selective_should_recall: selectiveShouldRecall,
    safe_skip_changed_v1: safeSkipChangedV1,
    line_number: index + 1,
  };
}

function safeSkipPrecision(safeSkipExpectedNoCount, safeSkipCount) {
  return safeSkipCount > 0 ? ratio(safeSkipExpectedNoCount / safeSkipCount) : null;
}

export function assessSelectiveRecallGateC2Readiness(
  report,
  contract = SELECTIVE_RECALL_GATE_C2_CONTRACT,
) {
  const diagnostics = report?.diagnostics || {};
  const datasetContractValid = report?.validation?.valid === true;
  const safeSkipCount = diagnostics.safe_skip_count || 0;
  const safeSkipPrecisionGate = safeSkipCount === 0
    || diagnostics.safe_skip_precision === 1;
  const hardSafetyGate = datasetContractValid
    && diagnostics.unsafe_safe_skip_count === 0
    && diagnostics.introduced_false_negative_count === 0
    && safeSkipPrecisionGate;
  const utilityGate = diagnostics.false_positive_reduced_count >= 2
    && Number.isFinite(diagnostics.false_positive_reduction_rate)
    && diagnostics.false_positive_reduction_rate >= 0.1;

  return {
    evaluator_status: "PASS",
    dataset_contract_valid: datasetContractValid,
    hard_safety_gate_pass: hardSafetyGate,
    utility_gate_pass: utilityGate,
    all_gates_pass: hardSafetyGate && utilityGate,
    gates: {
      dataset_contract_valid: datasetContractValid,
      unsafe_safe_skip_zero: diagnostics.unsafe_safe_skip_count === 0,
      introduced_false_negative_zero: diagnostics.introduced_false_negative_count === 0,
      safe_skip_precision_one: safeSkipPrecisionGate,
      false_positive_reduction_minimum:
        diagnostics.false_positive_reduced_count >= 2,
      false_positive_reduction_rate_minimum:
        Number.isFinite(diagnostics.false_positive_reduction_rate)
        && diagnostics.false_positive_reduction_rate >= 0.1,
    },
    thresholds: {
      expected_count: contract.expected_count,
      expected_yes: contract.expected_yes,
      expected_no: contract.expected_no,
      expected_family_count: contract.expected_family_count,
      rows_per_family: contract.rows_per_family,
      minimum_false_positive_reduced: 2,
      minimum_false_positive_reduction_rate: 0.1,
    },
    safety_dominates_utility: true,
    evidence_role: SELECTIVE_RECALL_GATE_C2_EVIDENCE_ROLE,
    independent_readiness_evidence: false,
    authority: SELECTIVE_RECALL_GATE_C2_AUTHORITY,
    candidate_policy_status: "NOT RUNTIME AUTHORIZED",
    status: "CONTRACT ONLY / NOT INDEPENDENT READINESS EVIDENCE",
  };
}

export function evaluateSelectiveRecallGateC2Rows(
  rows,
  options = {},
) {
  const contract = options.contract || SELECTIVE_RECALL_GATE_C2_CONTRACT;
  const items = Array.isArray(rows) ? rows : [];
  const validation = validateSelectiveRecallGateC2Dataset(items, contract);
  const results = items.map(evaluateRow);
  const v1 = confusionMatrix(results, "v1_should_recall");
  const selective = confusionMatrix(results, "selective_should_recall");
  const safeSkips = results.filter(result => (
    result.gate_decision === SELECTIVE_RECALL_GATE_DECISIONS.SAFE_SKIP
  ));
  const abstains = results.filter(result => (
    result.gate_decision === SELECTIVE_RECALL_GATE_DECISIONS.ABSTAIN
  ));
  const unsafeSafeSkips = safeSkips.filter(result => result.expected_should_recall === true);
  const safeSkipExpectedNo = safeSkips.filter(result => result.expected_should_recall === false);
  const introducedFalseNegatives = results.filter(result => (
    result.expected_should_recall === true
    && result.v1_should_recall === true
    && result.selective_should_recall === false
  ));
  const falsePositiveReduced = results.filter(result => (
    result.expected_should_recall === false
    && result.v1_should_recall === true
    && result.selective_should_recall === false
  ));
  const safeSkipPrecisionValue = safeSkipPrecision(safeSkipExpectedNo.length, safeSkips.length);
  const falsePositiveReductionRate = v1.false_positive > 0
    ? ratio(falsePositiveReduced.length / v1.false_positive)
    : null;

  const diagnostics = {
    safe_skip_count: safeSkips.length,
    abstain_count: abstains.length,
    override_count: results.filter(result => result.safe_skip_changed_v1).length,
    safe_skip_expected_no_count: safeSkipExpectedNo.length,
    safe_skip_expected_yes_count: unsafeSafeSkips.length,
    unsafe_safe_skip_count: unsafeSafeSkips.length,
    safe_skip_precision: safeSkipPrecisionValue,
    introduced_false_negative_count: introducedFalseNegatives.length,
    false_positive_reduced_count: falsePositiveReduced.length,
    v1_false_positive_count: v1.false_positive,
    selective_false_positive_count: selective.false_positive,
    false_positive_reduction_rate: falsePositiveReductionRate,
    unsafe_safe_skip_cases: unsafeSafeSkips.map(result => descriptor(result)),
    introduced_false_negative_cases: introducedFalseNegatives.map(result => descriptor(result)),
    false_positive_reduced_cases: falsePositiveReduced.map(result => descriptor(result)),
  };

  const report = {
    mode: "offline_selective_recall_gate_c2_contract_evaluation",
    schema_version: SELECTIVE_RECALL_GATE_C2_SCHEMA_VERSION,
    evidence_role: SELECTIVE_RECALL_GATE_C2_EVIDENCE_ROLE,
    authority: SELECTIVE_RECALL_GATE_C2_AUTHORITY,
    independent_readiness_evidence: false,
    candidate_policy_status: "NOT RUNTIME AUTHORIZED",
    validation,
    summary: validation.summary,
    confusion_matrices: {
      v1_current: v1,
      selective_candidate: selective,
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

  return {
    ...report,
    readiness: assessSelectiveRecallGateC2Readiness(report, contract),
  };
}

export function parseSelectiveRecallGateC2Jsonl(content) {
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

export function evaluateSelectiveRecallGateC2Jsonl(content, options = {}) {
  const parsed = parseSelectiveRecallGateC2Jsonl(content);
  const report = evaluateSelectiveRecallGateC2Rows(parsed.rows, options);
  if (parsed.parse_errors.length === 0) return report;
  return {
    ...report,
    validation: {
      ...report.validation,
      valid: false,
      errors: unique([...report.validation.errors, "json_parse_error"]),
      parse_errors: parsed.parse_errors,
    },
    readiness: {
      ...report.readiness,
      dataset_contract_valid: false,
      hard_safety_gate_pass: false,
      all_gates_pass: false,
      gates: {
        ...report.readiness.gates,
        dataset_contract_valid: false,
      },
    },
  };
}
