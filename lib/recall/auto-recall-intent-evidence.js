const FENCED_CONTENT_RE = /```[\s\S]*?```/gu;
const QUOTED_CONTENT_RE = /“[\s\S]*?”|‘[\s\S]*?’|"[\s\S]*?"/gu;
const SUPPLIED_LINE_RE = /^\s*(?:\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}|(?:ERROR|WARN|INFO|DEBUG|TRACE)\b|Exception\b|Traceback\b|at\s+\S+\s*\(|\[[A-Z]+\]|LOG_LINE\b|\|.+\|.+\|)|^\s{4,}\S/u;

const HISTORY_REFERENCE_RE = /之前|以前|上次|上回|此前|刚才|前面|最初|当初|原先|过去|说过|提到|聊过|讨论过|研究过|约定|来着|历史|\bearlier\b|\bprevious(?:ly)?\b|\bprior\b|\blast\s+(?:time|session)\b|\bremember\b|\bmentioned\b|\bdiscussed\b|\btalked\s+about\b|\bdecided\b|\boriginal(?:ly)?\b|\binitial(?:ly)?\b|\bwe\s+chose\b/iu;
const HISTORICAL_CONTEXT_LOOKUP_RE = /结合(?:我们|项目)?(?:之前|以前|历史)|按(?:我们|项目)?(?:之前|以前|项目)?历史|\b(?:use|consider|in\s+light\s+of)\b.{0,32}\b(?:project\s+)?history\b/iu;
const HISTORY_SUPPRESSION_RE = /(?:不要|不|别|不用|无需|忽略|无须)\s*(?:参考|用|结合|考虑|管|沿用|依赖|补充).{0,32}(?:之前|以前|旧|上次|上回|此前|历史|决定|方案|报错|项目)|(?:不用|不再用|不采用)\s*(?:之前|以前|旧|上次|上回|此前|历史|决定|方案|项目)|(?:不要|不|别|不用|无需|忽略|无须)\s*(?:结合|参考).{0,32}(?:项目)?历史|\b(?:ignore|disregard|do\s+not\s+use|don't\s+use|do\s+not\s+refer\s+to|don't\s+refer\s+to|without)\b.{0,40}\b(?:previous|prior|earlier|old|history|decision|plan|bug)\b/iu;
const CURRENT_INPUT_ONLY_RE = /只\s*(?:看|分析|依据|根据|评价|解释|润色|翻译|总结|提取)|只\s*用.{0,12}(?:当前|这段|这个|这份|输入|内容|代码|日志)|单独\s*(?:分析|解释|评价)|不要补充背景|仅\s*(?:看|分析|依据|根据|评价|解释|润色|翻译|总结|提取)|仅\s*用.{0,12}(?:当前|这段|这个|这份|输入|内容|代码|日志)|\b(?:only|just)\s+(?:use|analyze|look\s+at|consider|evaluate|explain|translate|summari[sz]e|extract)\b.{0,48}\b(?:current|this|input|log|code|text|quoted)\b|\bonly\s+(?:translate|summari[sz]e|extract)\b.{0,48}\bquoted\b/iu;
const CURRENT_CONTENT_TASK_RE = /(?:继续|接着|执行|运行|处理|分析|改成|翻译|润色|总结|提取|格式化).{0,24}(?:下面|这段|当前|这份|这个|这条).{0,12}(?:文字|文本|代码|内容|日志|命令|脚本|列表|SQL)?|\b(?:continue|keep)\s+(?:analy[sz](?:e|ing)|process|run|execute|translate|rewrite|summari[sz]e|format)\s+(?:this|the\s+current|the\s+following)\s+(?:code|log|text|input|command|list)\b/iu;
const FRESH_PROJECT_RE = /全新(?:的)?(?:项目|产品)|新提出的?(?:方案|架构)|\b(?:new|fresh|newly\s+proposed)\s+(?:project|product|architecture|plan)\b/iu;

const PROJECT_ANCHOR_RE = /memory[-_ ]?engine|session[-_ ]?checkpoint|smart[-_ ]?add|auto[-_ ]?recall|autorecall|openclaw|checkpoint|reinforcement|hybrid(?:\s+search|_search)|项目|project|路线图|roadmap|baseline|基线|架构|architecture|方案|设计|实现|决策|design|阶段|phase|L\d+/iu;
const PHASE_ANCHOR_RE = /\b(?:L\d+|Phase\s*\d+(?:\.\d+)?)\b/iu;
const STATE_RELATION_RE = /卡在|卡在哪|哪一环|尾巴|还剩|剩下|还差|没(?:有)?落地|未落地|没(?:有)?完成|未完成|没做完|下一步|接下来.{0,24}(?:动|做|处理|推进)|进度|状态|基线|baseline|缺口|gap|gaps|收尾|日常可用|进行到|做到(?:哪|什么程度)|哪个阶段|这一阶段|离.+可用|\b(?:current|present)\s+(?:state|status|progress|baseline|gaps?|phase|next\s+steps?|remaining|what\s+remains|what'?s\s+left)\b|\b(?:where\s+is|what\s+remains|what'?s\s+left|next\s+steps?)\b.{0,48}\b(?:project|phase|L\d+)\b|\b(?:project|phase|L\d+)\b.{0,48}\b(?:what\s+remains|what'?s\s+left|next\s+steps?|progress|status|gaps?)\b/iu;
const CONTINUATION_RE = /继续|接着|延续|恢复|没做完|未完成|停在|做到哪(?:里|一步)?|进行到哪|\b(?:where\s+did\s+we\s+(?:stop|leave\s+off)|what\s+were\s+we\s+working\s+on|pick\s+up|resume|unfinished|continue\s+(?:prior|previous)|where\s+we\s+left\s+off)\b/iu;
const DECISION_RELATION_RE = /(?:为什么|为何).{0,32}(?:选择|决定|采用|取舍|定下|走哪|走这条路|没走|不走)|(?:最初|当初|原来|原先|之前|以前|先前|当时|original(?:ly)?|initial(?:ly)?).{0,32}(?:决定|决策|选择|采用|方向|取舍|考虑|rationale)|(?:和|与).{0,32}(?:之前|以前|原来|先前|prior|previous).{0,24}(?:相比|比较|对比|不一样|不同|compare)|偏离|背离|原决策|原方案|\b(?:why\s+did\s+we\s+choose|why\s+did\s+we\s+decide|original\s+rationale|compare\s+(?:with|to)\s+(?:the\s+)?(?:previous|prior)|we\s+decided)\b/iu;
const DECISION_RECORD_RE = /(?:当时|原来|之前|以前|先前).{0,20}(?:怎么|如何).{0,16}(?:决定|选择|采用)|\bhow\s+(?:did\s+we\s+)?(?:decide|choose|select).{0,24}\b/iu;
const DECISION_TARGET_RE = /方案|架构|取舍|边界|路线|方向|设计|实现|项目|决策|决定|路|路径|architecture|design|plan|route|path|boundary|choice|decision|option|memory[-_ ]?engine|autorecall|auto[- ]?recall|database|DB/iu;
const PREFERENCE_RE = /偏好|偏向|倾向|喜欢|习惯|preference|prefer|\bwhich\b.{0,24}\bprefer\b|\bwhat\s+was\s+my\s+preference\b|\bdid\s+i\s+say\b.{0,24}\bprefer\b/iu;
const WORKFLOW_RE = /工作流|工作规则|流程规则|提交流程|分工|规则|约定|授权|workflow|process|role\s+split|authorization\s+rule|process\s+convention|runbook|procedure/iu;
const ENTITY_HISTORY_RELATION_RE = /(?:我们\s*(?:聊过|讨论过|提到过|说过)|(?:之前|以前|上次|上回|此前|刚才)\s*(?:提到|提过|研究|讨论|聊|说)|\b(?:earlier|previously)\b.{0,24}\b(?:we\s+)?(?:discussed|mentioned|talked\s+about)\b|\b(?:we\s+)?(?:discussed|mentioned|talked\s+about)\b.{0,48}\b(?:earlier|before|previously)\b|\bwhat\s+did\s+we\s+conclude\s+about\b)/iu;
const ENTITY_TARGET_RE = /\b[A-Z][\p{Letter}\p{Number}_.:-]*(?:\s+[A-ZÀ-ÖØ-Þ][\p{Letter}\p{Number}_.:-]*)*\b|[\p{Script=Han}]{2,}/u;

function normalizeText(text) {
  return String(text || "").replace(/\r/g, "").trim();
}

function maskContent(match) {
  return String(match).replace(/[^\n]/gu, " ");
}

function maskRequestSurface(text) {
  let detected = false;
  let masked = text.replace(FENCED_CONTENT_RE, match => {
    detected = true;
    return maskContent(match);
  });
  masked = masked.replace(QUOTED_CONTENT_RE, match => {
    detected = true;
    return maskContent(match);
  });

  let meaningfulLineSeen = false;
  masked = masked.split("\n").map(line => {
    if (!line.trim()) return line;
    if (!meaningfulLineSeen) {
      meaningfulLineSeen = true;
      return line;
    }
    if (!SUPPLIED_LINE_RE.test(line)) return line;
    detected = true;
    return maskContent(line);
  }).join("\n");

  return {
    request_text: masked.replace(/\s+/gu, " ").trim(),
    quoted_or_supplied_content_detected: detected,
  };
}

function hasProjectAnchor(requestText, projectEntities = []) {
  return (Array.isArray(projectEntities) && projectEntities.length > 0)
    || PROJECT_ANCHOR_RE.test(requestText);
}

export function extractAutoRecallIntentEvidence(text, options = {}) {
  const input = normalizeText(text);
  const surface = maskRequestSurface(input);
  const requestText = surface.request_text;
  const historySuppressed = HISTORY_SUPPRESSION_RE.test(requestText);
  const historyReference = HISTORY_REFERENCE_RE.test(requestText);
  const currentInputOnly = CURRENT_INPUT_ONLY_RE.test(requestText)
    || (CURRENT_CONTENT_TASK_RE.test(requestText) && !historyReference);
  const historicalContextLookup = HISTORICAL_CONTEXT_LOOKUP_RE.test(requestText);
  const projectAnchor = hasProjectAnchor(requestText, options.project_entities);
  const phaseAnchor = PHASE_ANCHOR_RE.test(requestText);
  const freshProject = FRESH_PROJECT_RE.test(requestText);
  const continuationLookup = !currentInputOnly && CONTINUATION_RE.test(requestText);
  const decisionRecordLookup = DECISION_RECORD_RE.test(requestText);
  const priorDecisionLookup = (DECISION_RELATION_RE.test(requestText)
    || decisionRecordLookup)
    && DECISION_TARGET_RE.test(requestText);
  const preferenceLookup = PREFERENCE_RE.test(requestText)
    && (historyReference || /\b(?:past|previous)\b.{0,24}\bpreference\b/iu.test(requestText));
  const workflowLookup = WORKFLOW_RE.test(requestText)
    && (historyReference || /(?:来着|what\s+was|what\s+were|原先|previous|prior)/iu.test(requestText));
  const entityBackgroundLookup = ENTITY_HISTORY_RELATION_RE.test(requestText)
    && ENTITY_TARGET_RE.test(requestText);
  const projectStateLookup = !freshProject
    && projectAnchor
    && STATE_RELATION_RE.test(requestText);

  return {
    request_text: requestText,
    quoted_or_supplied_content_detected: surface.quoted_or_supplied_content_detected,
    history_suppressed: historySuppressed,
    current_input_only: currentInputOnly,
    history_reference: historyReference,
    historical_context_lookup: historicalContextLookup,
    project_anchor: projectAnchor,
    phase_anchor: phaseAnchor,
    continuation_lookup: continuationLookup,
    project_state_lookup: projectStateLookup,
    prior_decision_lookup: priorDecisionLookup,
    preference_lookup: preferenceLookup,
    workflow_lookup: workflowLookup,
    entity_background_lookup: entityBackgroundLookup,
    decision_record_lookup: decisionRecordLookup,
    fresh_project_request: freshProject,
  };
}
