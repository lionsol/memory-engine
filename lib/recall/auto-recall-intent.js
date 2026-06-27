const EXPLICIT_HISTORY_RE = /继续|上次|之前|当前基线|结合我们之前|结合项目历史|按memory-engine当前状态|按 memory-engine 当前状态|记得我说过|和之前方案对比|是不是之前那个问题|结合历史|结合项目|当前状态|continue|previous|last time|remember i said|compare with previous|project history|current baseline/i;
const GENERIC_TASK_RE = /翻译|润色|改写|总结当前文本|提取要点|改格式|生成标题|语法检查|translate|polish|rewrite|summari[sz]e (?:this|current) text|extract key points|reformat|generate title|grammar check/i;
const CODE_OR_LOG_RE = /```|^\s{4,}\S|Exception|Traceback|at\s+\S+\s+\(|^\[[A-Z]+\]|^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}|^\|.+\|.+\||^\s*[-*]\s+\S/m;
const PROJECT_ENTITY_RE = /\b(memory-engine|session-checkpoint|smart-add|autorecall|auto-recall|openclaw|memory_engine|checkpoint|reinforcement|hybrid_search)\b/ig;

function normalizeText(prompt) {
  return String(prompt || "").replace(/\r/g, "").trim();
}

function countLines(text) {
  if (!text) return 0;
  return text.split("\n").length;
}

function detectLongInput(text) {
  const inputChars = text.length;
  const inputLines = countLines(text);
  const signalMatches = text.match(CODE_OR_LOG_RE);
  const structuralSignal = Boolean(signalMatches && signalMatches.length > 0);
  return {
    input_chars: inputChars,
    input_lines: inputLines,
    long_input_detected: inputChars > 1200 || inputLines > 30 || structuralSignal,
    structural_signal_detected: structuralSignal,
  };
}

function detectProjectEntities(text) {
  const found = new Set();
  for (const match of text.matchAll(PROJECT_ENTITY_RE)) {
    const value = String(match[0] || "").trim();
    if (value) found.add(value);
  }
  return [...found];
}

function extractFocusedInstruction(text) {
  const lines = text.split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !line.startsWith("```"))
    .filter(line => !/^\|.+\|.+\|?$/.test(line))
    .filter(line => !/^(Exception|Traceback|at\s+\S+\s+\()/i.test(line))
    .filter(line => !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(line))
    .filter(line => !/\b(DEBUG|INFO|WARN|ERROR|TRACE|LOG[_ -]?\w*)\b/i.test(line))
    .filter(line => line.length <= 220);
  return lines.slice(0, 3).join(" ").replace(/\s+/g, " ").trim();
}

function buildFocusedQuery(text, entities, hasExplicitHistory) {
  const instruction = extractFocusedInstruction(text);
  const parts = [];
  if (hasExplicitHistory) parts.push("结合之前上下文");
  if (entities.length > 0) parts.push(entities.slice(0, 5).join(" "));
  if (instruction) parts.push(instruction);
  const focused = parts.join(" | ").replace(/\s+/g, " ").trim();
  return focused.slice(0, 280);
}

export function analyzeAutoRecallIntent(prompt) {
  const text = normalizeText(prompt);
  const longInfo = detectLongInput(text);
  const explicitHistory = EXPLICIT_HISTORY_RE.test(text);
  const genericTaskDetected = GENERIC_TASK_RE.test(text);
  const projectEntities = detectProjectEntities(text);
  const focusedQuery = buildFocusedQuery(text, projectEntities, explicitHistory);

  let shouldRecall = true;
  let intentReason = "default_allow";

  if (genericTaskDetected && !explicitHistory) {
    shouldRecall = false;
    intentReason = longInfo.long_input_detected
      ? "generic_task_without_history_context_long_input"
      : "generic_task_without_history_context";
  } else if (longInfo.long_input_detected && !explicitHistory) {
    shouldRecall = false;
    intentReason = "long_input_without_history_context";
  } else if (longInfo.long_input_detected && explicitHistory) {
    shouldRecall = true;
    intentReason = "long_input_with_history_context_use_focused_query";
  } else if (explicitHistory) {
    shouldRecall = true;
    intentReason = "explicit_history_context";
  }

  return {
    should_recall: shouldRecall,
    intent_reason: intentReason,
    long_input_detected: longInfo.long_input_detected,
    generic_task_detected: genericTaskDetected,
    original_input_chars: longInfo.input_chars,
    original_input_lines: longInfo.input_lines,
    focused_query: focusedQuery,
    focused_query_chars: focusedQuery.length,
    skipped_by_recall_intent: !shouldRecall,
    explicit_history_context: explicitHistory,
    project_entities: projectEntities,
  };
}
