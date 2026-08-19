import {
  isAutoRecallRecallIntentArray,
  isAutoRecallTaskIntent,
} from "./auto-recall-intent-contract.js";

export function isAutoRecallIntentAnalysis(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof value.intent_reason === "string" &&
    typeof value.should_recall === "boolean" &&
    typeof value.long_input_detected === "boolean" &&
    typeof value.generic_task_detected === "boolean" &&
    typeof value.explicit_history_context === "boolean" &&
    typeof value.focused_query === "string" &&
    isAutoRecallTaskIntent(value.task_intent) &&
    isAutoRecallRecallIntentArray(value.recall_intent)
  );
}

export function buildAutoRecallDecisionTrace(intent) {
  if (!isAutoRecallIntentAnalysis(intent)) return null;
  return {
    long_input_detected: intent.long_input_detected,
    generic_task_detected: intent.generic_task_detected,
    explicit_history_context: intent.explicit_history_context,
    should_recall: intent.should_recall,
    task_intent: intent.task_intent,
    recall_intent: [...intent.recall_intent],
    intent_reason: intent.intent_reason,
    focused_query: intent.focused_query,
  };
}
