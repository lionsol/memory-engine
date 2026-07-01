export function isAutoRecallIntentAnalysis(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof value.intent_reason === "string" &&
    typeof value.should_recall === "boolean" &&
    typeof value.long_input_detected === "boolean" &&
    typeof value.generic_task_detected === "boolean" &&
    typeof value.explicit_history_context === "boolean" &&
    typeof value.focused_query === "string"
  );
}

export function buildAutoRecallDecisionTrace(intent) {
  if (!isAutoRecallIntentAnalysis(intent)) return null;
  return {
    long_input_detected: intent.long_input_detected,
    generic_task_detected: intent.generic_task_detected,
    explicit_history_context: intent.explicit_history_context,
    should_recall: intent.should_recall,
    intent_reason: intent.intent_reason,
    focused_query: intent.focused_query,
  };
}
