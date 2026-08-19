export const AUTO_RECALL_TASK_INTENTS = Object.freeze([
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
]);

export const AUTO_RECALL_RECALL_INTENTS = Object.freeze([
  "none",
  "user_preference",
  "project_state",
  "prior_decision",
  "task_state",
  "workflow_rule",
  "entity_background",
  "historical_context",
]);

const TASK_INTENT_SET = new Set(AUTO_RECALL_TASK_INTENTS);
const RECALL_INTENT_SET = new Set(AUTO_RECALL_RECALL_INTENTS);

export function isAutoRecallTaskIntent(value) {
  return typeof value === "string" && TASK_INTENT_SET.has(value);
}

export function isAutoRecallRecallIntent(value) {
  return typeof value === "string" && RECALL_INTENT_SET.has(value);
}

export function isAutoRecallRecallIntentArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isAutoRecallRecallIntent);
}

export function normalizeAutoRecallRecallIntents(value, fallback = ["none"]) {
  const values = Array.isArray(value) ? value : [];
  const normalized = [];
  for (const item of values) {
    if (!isAutoRecallRecallIntent(item) || normalized.includes(item)) continue;
    normalized.push(item);
  }
  return normalized.length > 0 ? normalized : [...fallback];
}
