import {
  isAutoRecallRecallIntent,
  isAutoRecallTaskIntent,
} from "./auto-recall-intent-contract.js";

const EXPLICIT_HISTORY_RE = /继续|上次|之前|当前基线|结合我们之前|结合项目历史|按memory-engine当前状态|按 memory-engine 当前状态|记得我说过|和之前方案对比|是不是之前那个问题|结合历史|结合项目|当前状态|continue|previous|last time|remember i said|compare with previous|project history|current baseline/i;
const GENERIC_TASK_RE = /翻译|润色|改写|总结当前文本|提取要点|改格式|生成标题|语法检查|translate|polish|rewrite|summari[sz]e (?:this|current) text|extract key points|reformat|generate title|grammar check/i;
const CODE_OR_LOG_RE = /```|^\s{4,}\S|Exception|Traceback|at\s+\S+\s+\(|^\[[A-Z]+\]|^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}|^\|.+\|.+\||^\s*[-*]\s+\S/m;
const PROJECT_ENTITY_RE = /\b(memory-engine|session-checkpoint|smart-add|autorecall|auto-recall|openclaw|memory_engine|checkpoint|reinforcement|hybrid_search)\b/ig;
const TASK_CONTINUATION_RE = /^(?:继续|接着|延续)|(?:继续|接着|延续)\s*(?:上次|上回|之前)|\b(?:continue|resume|pick up)\b.*\b(?:previous|prior|last)\b|\bcontinue\s+prior\s+work\b/i;
const TASK_DEBUG_RE = /报错|错误|异常|故障|失败|debug|bug|traceback|exception|stack trace|error|issue|problem|问题/i;
const TASK_REVIEW_RE = /review|评审|审核|审查|复盘|方案\s*(?:对比|比较)|(?:对比|比较|对照).*方案|当前基线.*(?:方案|review)|\bcompare\b.*\bplan\b/i;
const TASK_TRANSLATE_RE = /翻译|译成|translate|translation|\binto\s+(?:english|chinese|中文|英文)\b/i;
const TASK_SUMMARIZE_RE = /总结|概括|摘要|summari[sz]e/i;
const TASK_EXTRACT_RE = /提取|抽取|要点|列出|列表|改格式|整理成\s*(?:markdown\s*)?(?:表格|table)|extract|key points|reformat|\bformat\b/i;
const TASK_REWRITE_RE = /润色|改写|重写|改稿|rewrite|polish|paraphrase|rephrase|proofread|grammar check/i;
const TASK_PLAN_RE = /规划|制定.*计划|项目计划|roadmap|project plan|plan\s+(?:the\s+)?project|project\s+planning/i;
const TASK_DECISION_RE = /做决定|作决定|决定一下|选哪个|选择哪一个|哪一个方案更|应该选|帮我决定|should\s+we|which\s+(?:option|plan)|decide\s+between|make\s+the\s+decision|trade[- ]?off/i;
const TASK_OPERATE_RE = /运行|执行|调用|启动|重启|安装|删除|命令|run\s+.*\bcommand\b|execute|invoke|restart|install|delete/i;
const TASK_CASUAL_RE = /你好|嗨|谢谢|感谢|闲聊|hello|hi\b|thanks|thank you|how are you|good morning|good night/i;
const TASK_WRITE_ARTIFACT_RE = /生成标题|起\s*\d*\s*个标题|写一份|写个|创建文件|生成文档|draft|compose|generate\s+(?:a\s+)?title|write\s+(?:a\s+)?(?:document|report|file)|create\s+(?:a\s+)?(?:document|report|file)/i;
const RECALL_HISTORY_CUE_RE = /之前|以前|上次|上回|说过|提到|记得|历史|此前|previous|prior|last\s+(?:time|session)|earlier|remember|mentioned|history|what\s+did\s+i/i;
const RECALL_PROJECT_CUE_RE = /memory-engine|session-checkpoint|smart-add|autorecall|auto-recall|openclaw|memory_engine|checkpoint|reinforcement|hybrid_search|项目|project|runtime\s+gate/i;
const RECALL_PREFERENCE_RE = /偏好|喜欢|习惯|preference|prefer|terminal output|keybindings/i;
const RECALL_WORKFLOW_RE = /工作流|工作规则|流程规则|提交流程|workflow|process rule|runbook|procedure/i;
const RECALL_ENTITY_BACKGROUND_RE = /背景|background|context\s+(?:of|about)|history\s+of/i;
const CONTINUATION_LOOKUP_RE = /(?:上次|上回|之前|此前|以前|刚才).{0,24}(?:做到哪(?:里)?|做到哪一步|进行到|进展到|工作到|接下来|下一步)|(?:我们|当前)?做到哪(?:里|一步)了?|(?:接下来|下一步).{0,16}(?:该|要|应该).{0,16}(?:做|处理|推进)|(?:继续|接着|延续).{0,16}(?:之前|上次|上回|先前)|\b(?:where did we leave off|what were we working on|pick up where we left off|continue prior work)\b/i;
const TASK_REVIEW_LOOKUP_RE = /(?:和|与).{0,20}(?:之前|以前|原来|先前).{0,16}(?:相比|比较|对比|比)|(?:偏离|背离|对照).{0,24}(?:决策|方案|决定)|\bcompare\s+(?:with|to)\s+(?:the\s+)?(?:previous|prior)\b/i;
const PROJECT_PHASE_RE = /\b(?:L\d+|Phase\s*\d+(?:\.\d+)?)\b/i;
const PROJECT_STATE_LOOKUP_RE = /(?:当前(?:的)?\s*(?:状态|进度|基线|baseline|开发|项目|还剩|剩下|下一步|缺口|gap|gaps)|现在(?:还剩|剩下|的?进度|状态|下一步)|目前(?:状态|进度|还剩|下一步)|(?:这个|当前|本)项目(?:的)?(?:状态|进度|下一步|还剩|剩下|缺口|gap|gaps)|(?:L\d+|Phase\s*\d+(?:\.\d+)?).{0,20}(?:还剩|剩下|状态|进度|缺口|gap|gaps|下一步)|\b(?:current|present)\s+(?:state|status|progress|baseline|gaps?|roadmap|phase|next steps?|remaining|what remains|what's left)\b|\b(?:what remains|what's left|next steps?)\b.{0,24}\b(?:project|phase|L\d+)\b|\b(?:project|phase|L\d+)\b.{0,24}\b(?:what remains|what's left|next steps?|progress|status|gaps?)\b)/iu;
const PRIOR_DECISION_LOOKUP_RE = /(?:为什么|为何).{0,20}(?:之前|以前|当时|原来).{0,20}(?:选择|决定|采用)|(?:和|与).{0,20}(?:之前|以前|原来|先前).{0,20}(?:相比|比较|对比|不一样|不同)|(?:之前|以前|当时|原来|先前).{0,20}(?:怎么|如何).{0,16}(?:决定|选择)|(?:之前|以前|当时|原来|先前).{0,20}(?:的)?(?:决定|决策)|(?:偏离|背离).{0,30}(?:之前|原|当时|先前).{0,20}(?:决策|方案|决定)|\bcompare\s+(?:with|to)\s+(?:the\s+)?(?:previous|prior)\b/i;
const PRIOR_DECISION_RECORD_RE = /(?:当时|原来|之前|以前|先前).{0,20}(?:怎么|如何|为什么|为何).{0,16}(?:决定|选择|采用)|\b(?:how|why)\s+(?:did\s+we|was\s+the\s+choice).{0,20}(?:decide|choose|selected)\b/i;
const HISTORICAL_ENTITY_REFERENCE_RE = /(?:之前|以前|上次|此前|刚才)\s*(?:提到的|提过的|说的|聊的|聊过的|讨论的|讨论过的)\s*[A-Za-z][A-Za-z0-9_.:-]*|\b(?:earlier|previously)\s*[- ]\s*mentioned\s+[A-Za-z][A-Za-z0-9_.:-]*|\b[A-Za-z][A-Za-z0-9_.:-]*\s+(?:we\s+)?(?:mentioned|discussed|talked\s+about)\s+(?:earlier|before|previously)\b/i;
const TASK_CONTINUATION_CLASSIFIER_RE = new RegExp(`(?:${TASK_CONTINUATION_RE.source})|(?:${CONTINUATION_LOOKUP_RE.source})`, "i");
const TASK_REVIEW_CLASSIFIER_RE = new RegExp(`(?:${TASK_REVIEW_RE.source})|(?:${TASK_REVIEW_LOOKUP_RE.source})`, "i");

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

function buildSemanticLookupSignals(input, features, taskIntent) {
  const hasHistory = features.explicit_history_context === true || RECALL_HISTORY_CUE_RE.test(input);
  const hasProjectAnchor = (Array.isArray(features.project_entities) && features.project_entities.length > 0)
    || /(?:memory-engine|session-checkpoint|smart-add|autorecall|auto-recall|openclaw|memory_engine|checkpoint|reinforcement|hybrid_search|项目|project)/i.test(input)
    || PROJECT_PHASE_RE.test(input);

  return {
    preferenceLookup: hasHistory && RECALL_PREFERENCE_RE.test(input),
    workflowLookup: hasHistory && RECALL_WORKFLOW_RE.test(input),
    entityBackgroundLookup: HISTORICAL_ENTITY_REFERENCE_RE.test(input)
      || (hasHistory && RECALL_ENTITY_BACKGROUND_RE.test(input)),
    continuationLookup: taskIntent === "continue_prior_work" || CONTINUATION_LOOKUP_RE.test(input),
    priorDecisionLookup: PRIOR_DECISION_LOOKUP_RE.test(input),
    priorDecisionRecord: PRIOR_DECISION_RECORD_RE.test(input),
    projectStateLookup: hasProjectAnchor && PROJECT_STATE_LOOKUP_RE.test(input),
    hasHistory,
    hasProjectAnchor,
  };
}

export function classifyTaskIntent(text, _features = {}) {
  const input = normalizeText(text);
  const rules = [
    ["continue_prior_work", TASK_CONTINUATION_CLASSIFIER_RE],
    ["debug_error", TASK_DEBUG_RE],
    ["review_plan", TASK_REVIEW_CLASSIFIER_RE],
    ["translate_current_text", TASK_TRANSLATE_RE],
    ["summarize_current_text", TASK_SUMMARIZE_RE],
    ["extract_structured_info", TASK_EXTRACT_RE],
    ["rewrite_current_text", TASK_REWRITE_RE],
    ["plan_project", TASK_PLAN_RE],
    ["make_decision", TASK_DECISION_RE],
    ["operate_tool", TASK_OPERATE_RE],
    ["casual_chat", TASK_CASUAL_RE],
    ["write_artifact", TASK_WRITE_ARTIFACT_RE],
  ];

  for (const [intent, pattern] of rules) {
    if (pattern.test(input)) return intent;
  }
  return "answer_question";
}

export function classifyRecallIntent(text, features = {}) {
  const input = normalizeText(text);
  const taskIntent = isAutoRecallTaskIntent(features.task_intent)
    ? features.task_intent
    : classifyTaskIntent(input, features);
  const signals = buildSemanticLookupSignals(input, features, taskIntent);
  const orderedRules = [
    ["preferenceLookup", ["user_preference", "historical_context"]],
    ["workflowLookup", ["workflow_rule", "historical_context"]],
    ["entityBackgroundLookup", ["entity_background", "historical_context"]],
    ["continuationLookup", ["task_state", "historical_context"]],
    ["reviewProjectStateLookup", ["project_state", "prior_decision"]],
    ["priorDecisionRecord", ["prior_decision", "historical_context"]],
    ["priorDecisionLookup", ["prior_decision", "project_state"]],
    ["projectStateLookup", ["project_state", "task_state"]],
  ];

  for (const [signal, intents] of orderedRules) {
    if (signal === "reviewProjectStateLookup") {
      if (taskIntent === "review_plan" && signals.projectStateLookup) return intents;
      continue;
    }
    if (signals[signal]) return intents;
  }

  if (taskIntent === "debug_error" && signals.hasHistory) {
    return signals.hasProjectAnchor ? ["project_state", "historical_context"] : ["historical_context"];
  }
  if (taskIntent === "review_plan" && signals.hasHistory && signals.hasProjectAnchor) {
    return ["project_state", "prior_decision"];
  }
  if (taskIntent === "rewrite_current_text" && signals.hasHistory && signals.hasProjectAnchor) {
    return ["prior_decision", "project_state"];
  }
  if (taskIntent === "answer_question" && signals.hasHistory && signals.hasProjectAnchor) {
    return ["project_state", "task_state"];
  }
  return ["none"];
}

export function analyzeAutoRecallIntent(prompt) {
  const text = normalizeText(prompt);
  const longInfo = detectLongInput(text);
  const explicitHistory = EXPLICIT_HISTORY_RE.test(text);
  const genericTaskDetected = GENERIC_TASK_RE.test(text);
  const projectEntities = detectProjectEntities(text);
  const focusedQuery = buildFocusedQuery(text, projectEntities, explicitHistory);
  const taskIntent = classifyTaskIntent(text, {
    explicit_history_context: explicitHistory,
    project_entities: projectEntities,
  });
  const recallIntent = classifyRecallIntent(text, {
    task_intent: taskIntent,
    explicit_history_context: explicitHistory,
    project_entities: projectEntities,
  });

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
    task_intent: taskIntent,
    recall_intent: recallIntent,
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
