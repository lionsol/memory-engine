import { analyzeAutoRecallIntent } from "./auto-recall-intent.js";

export const TURN_GOLD_SET_SCHEMA_VERSION = 1;

export const TURN_TASK_INTENTS = [
  "answer_question",
  "continue_prior_work",
  "review_plan",
  "debug_error",
  "summarize_current_text",
  "rewrite_current_text",
  "translate_current_text",
  "extract_structured_info",
  "write_artifact",
  "plan_project",
  "make_decision",
  "operate_tool",
  "casual_chat",
];

export const TURN_RECALL_INTENTS = [
  "none",
  "user_preference",
  "project_state",
  "prior_decision",
  "task_state",
  "workflow_rule",
  "entity_background",
  "historical_context",
];

export const TURN_DISCLOSURE_LEVELS = [
  "none",
  "memory_card",
  "short_summary",
  "full_content_on_get",
];

const TASK_INTENT_SET = new Set(TURN_TASK_INTENTS);
const RECALL_INTENT_SET = new Set(TURN_RECALL_INTENTS);
const DISCLOSURE_LEVEL_SET = new Set(TURN_DISCLOSURE_LEVELS);
const LABEL_CONFIDENCE_SET = new Set(["low", "medium", "high"]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeStringArray(value) {
  if (value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter(item => typeof item === "string");
  return [];
}

function getPrompt(row) {
  return row?.prompt ?? row?.user_prompt ?? row?.input ?? row?.text ?? "";
}

export function parseTurnGoldSetJsonl(content) {
  return String(content || "")
    .split(/\r?\n/u)
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(item => item.line.trim().length > 0)
    .map(({ line, lineNumber }) => {
      try {
        return { lineNumber, row: JSON.parse(line), parse_error: null };
      } catch (error) {
        return { lineNumber, row: null, parse_error: String(error?.message || error) };
      }
    });
}

export function validateTurnGoldSetRow(row, { lineNumber = null } = {}) {
  const errors = [];

  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return { valid: false, errors: ["row_object"], line_number: lineNumber };
  }

  if (row.schema_version !== TURN_GOLD_SET_SCHEMA_VERSION) errors.push("schema_version");
  if (!isNonEmptyString(row.turn_id)) errors.push("turn_id");
  if (!isNonEmptyString(getPrompt(row))) errors.push("prompt");
  if (typeof row.expected_should_recall !== "boolean") errors.push("expected_should_recall");

  if (row.task_intent != null && !TASK_INTENT_SET.has(String(row.task_intent))) {
    errors.push("task_intent");
  }

  const recallIntents = normalizeStringArray(row.recall_intent);
  if (row.recall_intent != null && recallIntents.length === 0) {
    errors.push("recall_intent");
  }
  for (const intent of recallIntents) {
    if (!RECALL_INTENT_SET.has(intent)) errors.push("recall_intent");
  }

  if (row.disclosure_level != null && !DISCLOSURE_LEVEL_SET.has(String(row.disclosure_level))) {
    errors.push("disclosure_level");
  }

  if (row.label_confidence != null && !LABEL_CONFIDENCE_SET.has(String(row.label_confidence))) {
    errors.push("label_confidence");
  }

  for (const key of ["expected_focused_query_contains", "expected_focused_query_excludes"]) {
    if (row[key] != null && !Array.isArray(row[key])) errors.push(key);
    if (Array.isArray(row[key]) && row[key].some(item => typeof item !== "string" || item.length === 0)) {
      errors.push(key);
    }
  }

  return {
    valid: errors.length === 0,
    errors: Array.from(new Set(errors)),
    line_number: lineNumber,
  };
}

function replayOne(row, { lineNumber = null } = {}) {
  const validation = validateTurnGoldSetRow(row, { lineNumber });
  if (!validation.valid) {
    return {
      turn_id: row?.turn_id || null,
      line_number: lineNumber,
      valid: false,
      pass: false,
      errors: validation.errors,
      mismatches: ["invalid_label_row"],
      expected: null,
      actual: null,
    };
  }

  const prompt = String(getPrompt(row));
  const actual = analyzeAutoRecallIntent(prompt);
  const mismatches = [];

  if (actual.should_recall !== row.expected_should_recall) {
    mismatches.push("should_recall");
  }

  if (row.expected_intent_reason != null && actual.intent_reason !== row.expected_intent_reason) {
    mismatches.push("intent_reason");
  }

  for (const token of normalizeStringArray(row.expected_focused_query_contains)) {
    if (!actual.focused_query.includes(token)) mismatches.push(`focused_query_missing:${token}`);
  }

  for (const token of normalizeStringArray(row.expected_focused_query_excludes)) {
    if (actual.focused_query.includes(token)) mismatches.push(`focused_query_forbidden:${token}`);
  }

  return {
    turn_id: row.turn_id,
    line_number: lineNumber,
    valid: true,
    pass: mismatches.length === 0,
    errors: [],
    mismatches,
    expected: {
      should_recall: row.expected_should_recall,
      intent_reason: row.expected_intent_reason ?? null,
      focused_query_contains: normalizeStringArray(row.expected_focused_query_contains),
      focused_query_excludes: normalizeStringArray(row.expected_focused_query_excludes),
      task_intent: row.task_intent ?? null,
      recall_intent: normalizeStringArray(row.recall_intent),
      disclosure_level: row.disclosure_level ?? null,
    },
    source: {
      prompt,
      prompt_chars: prompt.length,
      prompt_preview: prompt.slice(0, 240),
    },
    actual: {
      should_recall: actual.should_recall,
      intent_reason: actual.intent_reason,
      long_input_detected: actual.long_input_detected,
      generic_task_detected: actual.generic_task_detected,
      explicit_history_context: actual.explicit_history_context,
      focused_query: actual.focused_query,
      focused_query_chars: actual.focused_query_chars,
      skipped_by_recall_intent: actual.skipped_by_recall_intent,
      project_entities: actual.project_entities,
    },
  };
}

export function replayTurnGoldSet(rows) {
  const items = Array.isArray(rows) ? rows : [];
  const results = items.map((item, index) => {
    const row = item && typeof item === "object" && "row" in item ? item.row : item;
    const lineNumber = item && typeof item === "object" && "lineNumber" in item ? item.lineNumber : index + 1;
    if (item?.parse_error) {
      return {
        turn_id: null,
        line_number: lineNumber,
        valid: false,
        pass: false,
        errors: ["json_parse_error"],
        parse_error: item.parse_error,
        mismatches: ["invalid_label_row"],
        expected: null,
        actual: null,
      };
    }
    return replayOne(row, { lineNumber });
  });

  const valid = results.filter(result => result.valid);
  const invalid = results.filter(result => !result.valid);
  const failed = results.filter(result => !result.pass);
  const passed = results.filter(result => result.pass);
  const validFailed = valid.filter(result => !result.pass);

  return {
    summary: {
      mode: "read_only_turn_gold_set_replay",
      schema_version: TURN_GOLD_SET_SCHEMA_VERSION,
      total_count: results.length,
      valid_count: valid.length,
      invalid_count: invalid.length,
      passed_count: passed.length,
      failed_count: failed.length,
      valid_failed_count: validFailed.length,
      pass_rate: results.length > 0 ? Number((passed.length / results.length).toFixed(4)) : 0,
      valid_pass_rate: valid.length > 0 ? Number(((valid.length - validFailed.length) / valid.length).toFixed(4)) : 0,
      failed_turn_ids: failed.map(result => result.turn_id).filter(Boolean),
      invalid_line_numbers: invalid.map(result => result.line_number),
    },
    side_effects: {
      db_writes: false,
      memory_file_mutation: false,
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
    results,
  };
}

export function replayTurnGoldSetJsonl(content) {
  return replayTurnGoldSet(parseTurnGoldSetJsonl(content));
}

function unique(values) {
  return Array.from(new Set(values.filter(value => value != null && value !== "")));
}

function classifyMismatchToken(result, mismatch) {
  if (mismatch === "invalid_label_row") {
    return result?.parse_error ? "json_parse_error" : "invalid_label_row";
  }

  if (mismatch === "should_recall") {
    if (result?.expected?.should_recall === false && result?.actual?.should_recall === true) {
      return "false_positive_recall";
    }
    if (result?.expected?.should_recall === true && result?.actual?.should_recall === false) {
      return "false_negative_recall";
    }
    return "should_recall_mismatch";
  }

  if (mismatch === "intent_reason") return "intent_reason_mismatch";
  if (String(mismatch).startsWith("focused_query_missing:")) return "focused_query_missing_expected_token";
  if (String(mismatch).startsWith("focused_query_forbidden:")) return "focused_query_contains_forbidden_token";
  return "other_mismatch";
}

export function classifyTurnGoldSetReplayResult(result) {
  if (!result || typeof result !== "object") return ["invalid_replay_result"];
  if (result.pass) return [];
  const mismatches = Array.isArray(result.mismatches) ? result.mismatches : [];
  if (mismatches.length === 0) return ["unknown_failed_result"];
  return unique(mismatches.map(mismatch => classifyMismatchToken(result, mismatch)));
}

function suggestionForCluster(category) {
  switch (category) {
    case "false_positive_recall":
      return {
        target: "intent_rule_or_label",
        confidence: "medium",
        suggested_action: "Inspect whether the prompt truly has historical/project dependency. If not, tighten generic/no-history gating; if yes, correct expected_should_recall.",
      };
    case "false_negative_recall":
      return {
        target: "intent_rule_or_label",
        confidence: "medium",
        suggested_action: "Inspect whether explicit history/project signals were missed. If the label is correct, add or tune history/project signal detection; otherwise correct expected_should_recall.",
      };
    case "intent_reason_mismatch":
      return {
        target: "label_expectation",
        confidence: "high",
        suggested_action: "Check whether expected_intent_reason is overly strict. Prefer asserting should_recall plus focused-query tokens unless the reason itself is a contract.",
      };
    case "focused_query_missing_expected_token":
      return {
        target: "focused_query_or_label",
        confidence: "medium",
        suggested_action: "Inspect entity extraction and expected_focused_query_contains. If the token is required for recall, tune focused query construction; otherwise relax the label.",
      };
    case "focused_query_contains_forbidden_token":
      return {
        target: "focused_query_stripping",
        confidence: "high",
        suggested_action: "Inspect focused_query pollution. If the forbidden token is log/body noise, tighten stripping; if it is a legitimate entity, remove it from expected_focused_query_excludes.",
      };
    case "invalid_label_row":
    case "json_parse_error":
      return {
        target: "dataset_label",
        confidence: "high",
        suggested_action: "Fix the JSONL row or schema fields before interpreting replay accuracy.",
      };
    default:
      return {
        target: "manual_review",
        confidence: "low",
        suggested_action: "Inspect the replay result manually and add a narrower classifier if this mismatch repeats.",
      };
  }
}

export function buildTurnGoldSetReplayFeedback(replayReport, { exampleLimit = 5 } = {}) {
  const results = Array.isArray(replayReport?.results) ? replayReport.results : [];
  const failed = results.filter(result => !result.pass);
  const clustersByCategory = new Map();

  for (const result of failed) {
    const categories = classifyTurnGoldSetReplayResult(result);
    for (const category of categories) {
      if (!clustersByCategory.has(category)) {
        clustersByCategory.set(category, {
          category,
          count: 0,
          turn_ids: [],
          line_numbers: [],
          mismatches: [],
          examples: [],
          suggestion: suggestionForCluster(category),
        });
      }
      const cluster = clustersByCategory.get(category);
      cluster.count += 1;
      if (result.turn_id) cluster.turn_ids.push(result.turn_id);
      if (result.line_number != null) cluster.line_numbers.push(result.line_number);
      cluster.mismatches.push(...(Array.isArray(result.mismatches) ? result.mismatches : []));
      if (cluster.examples.length < exampleLimit) {
        cluster.examples.push({
          turn_id: result.turn_id || null,
          line_number: result.line_number ?? null,
          mismatches: Array.isArray(result.mismatches) ? result.mismatches : [],
          expected: result.expected,
          actual: result.actual,
          errors: result.errors || [],
        });
      }
    }
  }

  const clusters = Array.from(clustersByCategory.values())
    .map(cluster => ({
      ...cluster,
      turn_ids: unique(cluster.turn_ids),
      line_numbers: unique(cluster.line_numbers),
      mismatches: unique(cluster.mismatches),
    }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  return {
    summary: {
      mode: "read_only_turn_gold_set_feedback",
      source_mode: replayReport?.summary?.mode || null,
      total_count: Number(replayReport?.summary?.total_count || results.length || 0),
      failed_count: failed.length,
      cluster_count: clusters.length,
      categories: clusters.map(cluster => ({ category: cluster.category, count: cluster.count })),
    },
    side_effects: {
      db_writes: false,
      memory_file_mutation: false,
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
    clusters,
  };
}

function expansionActionForCategory(category) {
  switch (category) {
    case "false_positive_recall":
      return "review_label_or_add_no_recall_counterexample";
    case "false_negative_recall":
      return "review_label_or_add_recall_positive_example";
    case "focused_query_missing_expected_token":
      return "add_entity_retention_counterexample";
    case "focused_query_contains_forbidden_token":
      return "add_noise_stripping_counterexample";
    case "intent_reason_mismatch":
      return "relax_or_confirm_reason_contract";
    case "invalid_label_row":
    case "json_parse_error":
      return "fix_dataset_row_before_expansion";
    default:
      return "manual_review";
  }
}

function candidateIdFor(result, category) {
  const base = String(result?.turn_id || `line_${result?.line_number || "unknown"}`)
    .replace(/[^a-z0-9_:-]+/ig, "_")
    .replace(/^_+|_+$/g, "") || "unknown";
  return `expand_${category}_${base}`;
}

function buildExpansionCandidate(result, category) {
  const expected = result?.expected || {};
  const source = result?.source || {};
  const prompt = String(source.prompt || "");
  const rowTemplate = {
    turn_id: candidateIdFor(result, category),
    schema_version: TURN_GOLD_SET_SCHEMA_VERSION,
    prompt,
    task_intent: expected.task_intent || null,
    recall_intent: Array.isArray(expected.recall_intent) ? expected.recall_intent : [],
    disclosure_level: expected.disclosure_level || null,
    expected_should_recall: expected.should_recall ?? null,
    expected_intent_reason: expected.intent_reason || null,
    expected_focused_query_contains: Array.isArray(expected.focused_query_contains) ? expected.focused_query_contains : [],
    expected_focused_query_excludes: Array.isArray(expected.focused_query_excludes) ? expected.focused_query_excludes : [],
    label_confidence: "low",
    annotator: "manual_required",
  };

  return {
    candidate_id: candidateIdFor(result, category),
    source_turn_id: result?.turn_id || null,
    source_line_number: result?.line_number ?? null,
    category,
    suggested_dataset_action: expansionActionForCategory(category),
    status: "manual_review_required",
    reason: "Generated from replay mismatch feedback; do not append without human validation.",
    mismatches: Array.isArray(result?.mismatches) ? result.mismatches : [],
    prompt_preview: source.prompt_preview || prompt.slice(0, 240),
    actual: result?.actual || null,
    expected,
    row_template: rowTemplate,
  };
}

export function buildTurnGoldSetExpansionPlan(replayReport, feedbackReport = null, { maxCandidates = 20 } = {}) {
  const feedback = feedbackReport || buildTurnGoldSetReplayFeedback(replayReport);
  const results = Array.isArray(replayReport?.results) ? replayReport.results : [];
  const failed = results.filter(result => !result.pass);
  const candidates = [];

  for (const result of failed) {
    for (const category of classifyTurnGoldSetReplayResult(result)) {
      if (candidates.length >= maxCandidates) break;
      candidates.push(buildExpansionCandidate(result, category));
    }
    if (candidates.length >= maxCandidates) break;
  }

  return {
    summary: {
      mode: "read_only_turn_gold_set_expansion_plan",
      source_mode: replayReport?.summary?.mode || null,
      total_count: Number(replayReport?.summary?.total_count || results.length || 0),
      failed_count: failed.length,
      feedback_cluster_count: Number(feedback?.summary?.cluster_count || 0),
      candidate_count: candidates.length,
      max_candidates: maxCandidates,
      requires_manual_review: candidates.length > 0,
      categories: unique(candidates.map(candidate => candidate.category)),
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
    candidates,
  };
}

export function replayTurnGoldSetJsonlWithFeedback(content) {
  const replay = replayTurnGoldSetJsonl(content);
  const feedback = buildTurnGoldSetReplayFeedback(replay);
  const expansion_plan = buildTurnGoldSetExpansionPlan(replay, feedback);
  return {
    replay,
    feedback,
    expansion_plan,
  };
}
