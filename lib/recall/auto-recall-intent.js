import {
  isAutoRecallRecallIntent,
  isAutoRecallTaskIntent,
} from "./auto-recall-intent-contract.js";
import { extractAutoRecallIntentEvidence } from "./auto-recall-intent-evidence.js";

const EXPLICIT_HISTORY_RE = /继续|上次|之前|当前基线|结合我们之前|结合项目历史|按memory-engine当前状态|按 memory-engine 当前状态|记得我说过|和之前方案对比|是不是之前那个问题|结合历史|结合项目|当前状态|continue|previous|last time|remember i said|compare with previous|project history|current baseline/i;
const GENERIC_TASK_RE = /翻译|润色|改写|总结当前文本|提取要点|改格式|生成标题|语法检查|translate|polish|rewrite|summari[sz]e (?:this|current) text|extract key points|reformat|generate title|grammar check/i;
const CODE_OR_LOG_RE = /```|^\s{4,}\S|Exception|Traceback|at\s+\S+\s+\(|^\[[A-Z]+\]|^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}|^\|.+\|.+\||^\s*[-*]\s+\S/m;
const PROJECT_ENTITY_RE = /\b(memory-engine|session-checkpoint|smart-add|autorecall|auto-recall|openclaw|memory_engine|checkpoint|reinforcement|hybrid_search)\b/ig;
const TASK_DEBUG_RE = /报错|错误|异常|故障|失败|debug|bug|traceback|exception|stack trace|error|issue|problem|问题/i;
const TASK_REVIEW_RE = /review|评审|审核|审查|复盘|评价|(?:分析|检查).{0,24}(?:这段|下面|当前|这份).{0,24}(?:代码|SQL|实现|架构|方案)|(?:方案|设计|版本).{0,20}(?:之前|先前|以前|prior|previous).{0,20}(?:相比|比较|对比)|(?:方案|设计|版本)\s*(?:对比|比较)|(?:对比|比较|对照).*(?:方案|设计|版本)|(?:当前|这个|现在).{0,24}(?:实现|方案|设计).{0,24}(?:偏|偏离|背离)|当前基线.*(?:方案|review)|\bcompare\b.*\b(?:plan|architecture|design)\b/i;
const TASK_TRANSLATE_RE = /翻译|译成|translate|translation|\binto\s+(?:english|chinese|中文|英文)\b/i;
const TASK_SUMMARIZE_RE = /总结|概括|摘要|summari[sz]e/i;
const TASK_EXTRACT_RE = /提取|抽取|要点|列出|列表|改格式|整理成\s*(?:markdown\s*)?(?:表格|table)|extract|key points|reformat|\bformat\b/i;
const TASK_REWRITE_RE = /润色|改写|重写|改稿|rewrite|polish|paraphrase|rephrase|proofread|grammar check/i;
const TASK_PLAN_RE = /规划|制定.{0,20}计划|项目计划|(?:定义|制定|建立).{0,24}baseline|(?:制定|规划|design|define).{0,24}\b(?:roadmap|project\s+plan|project\s+planning)\b|\bplan\s+(?:the\s+)?project\b/i;
const TASK_DECISION_RE = /做决定|作决定|决定一下|选哪个|选择哪一个|哪一个方案更|应该选|帮我决定|按当前条件.{0,12}(?:重新)?判断|重新判断|帮我判断.{0,12}(?:是否|该不该|选)|should\s+we|which\s+(?:option|plan)|decide\s+between|make\s+the\s+decision|trade[- ]?off/i;
const TASK_OPERATE_RE = /(?:运行|执行|调用|启动|重启|安装|删除|跑)\s*(?:一下|一次)?(?:测试|命令|服务|程序|脚本|检查|任务|targeted\s+tests)?|\brun\s+.*\b(?:command|test|tests|service|script)\b|\b(?:execute|invoke|restart|install|delete)\b/i;
const TASK_CASUAL_RE = /你好|嗨|谢谢|感谢|闲聊|hello|hi\b|thanks|thank you|how are you|good morning|good night/i;
const TASK_WRITE_ARTIFACT_RE = /生成标题|起\s*\d*\s*个标题|写一份|写个|创建文件|生成文档|设计一份|生成一份|readiness\s+checklist|checklist|email|report|draft|compose|generate\s+(?:a\s+)?title|write\s+(?:a\s+)?(?:document|report|file|email)|create\s+(?:a\s+)?(?:document|report|file)/i;

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

function getIntentEvidence(text, features = {}) {
  return features.evidence || extractAutoRecallIntentEvidence(text, {
    project_entities: features.project_entities,
  });
}

export function classifyTaskIntent(text, features = {}) {
  const evidence = getIntentEvidence(text, features);
  const input = evidence.request_text;
  const rules = [
    ["continue_prior_work", evidence.continuation_lookup],
    ["debug_error", TASK_DEBUG_RE],
    ["review_plan", TASK_REVIEW_RE],
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
    if (typeof pattern === "boolean" ? pattern : pattern.test(input)) return intent;
  }
  return "answer_question";
}

export function classifyRecallIntent(text, features = {}) {
  const evidence = getIntentEvidence(text, features);
  const taskIntent = isAutoRecallTaskIntent(features.task_intent)
    ? features.task_intent
    : classifyTaskIntent(evidence.request_text, { ...features, evidence });

  if (evidence.history_suppressed || evidence.current_input_only) return ["none"];
  if (evidence.preference_lookup) return ["user_preference", "historical_context"];
  if (evidence.workflow_lookup) return ["workflow_rule", "historical_context"];
  if (evidence.entity_background_lookup) return ["entity_background", "historical_context"];
  if (evidence.continuation_lookup) return ["task_state", "historical_context"];

  if (evidence.prior_decision_lookup) {
    if (evidence.decision_record_lookup) {
      return ["prior_decision", "historical_context"];
    }
    if (evidence.project_state_lookup) return ["project_state", "prior_decision"];
    if (evidence.project_anchor) return ["prior_decision", "project_state"];
    return ["prior_decision", "historical_context"];
  }

  if (evidence.project_state_lookup) return ["project_state", "task_state"];

  if (taskIntent === "debug_error" && evidence.history_reference) {
    return evidence.project_anchor
      ? ["project_state", "historical_context"]
      : ["historical_context"];
  }
  if (taskIntent === "rewrite_current_text" && evidence.history_reference && evidence.project_anchor) {
    return ["prior_decision", "project_state"];
  }
  if (taskIntent === "answer_question" && evidence.historical_context_lookup && evidence.project_anchor) {
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
  const evidence = extractAutoRecallIntentEvidence(text, {
    project_entities: projectEntities,
  });
  const taskIntent = classifyTaskIntent(text, {
    explicit_history_context: explicitHistory,
    project_entities: projectEntities,
    evidence,
  });
  const recallIntent = classifyRecallIntent(text, {
    task_intent: taskIntent,
    explicit_history_context: explicitHistory,
    project_entities: projectEntities,
    evidence,
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
