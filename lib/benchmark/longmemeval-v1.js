export const LONGMEMEVAL_V1_SCHEMA = "memory_engine_longmemeval_v1";
export const LONGMEMEVAL_RETRIEVAL_KS = Object.freeze([1, 3, 5, 10, 30, 50]);

const QUESTION_TYPE_ALIASES = new Map([
  ["single-session-user", "single-session-user"],
  ["single_hop", "single-session-user"],
  ["single-session-assistant", "single-session-assistant"],
  ["assistant_previnfo", "single-session-assistant"],
  ["single-session-preference", "single-session-preference"],
  ["implicit_preference_v2", "single-session-preference"],
  ["temporal-reasoning", "temporal-reasoning"],
  ["temp_reasoning_implicit", "temporal-reasoning"],
  ["temp_reasoning_explicit", "temporal-reasoning"],
  ["knowledge-update", "knowledge-update"],
  ["knowledge_update", "knowledge-update"],
  ["multi-session", "multi-session"],
  ["two_hop", "multi-session"],
  ["multi_session_synthesis", "multi-session"],
]);

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}_must_be_object`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label}_must_be_nonempty_string`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label}_must_be_array`);
  return value;
}

function normalizeQuestionType(value) {
  const raw = requireString(value, "question_type");
  const normalized = QUESTION_TYPE_ALIASES.get(raw);
  if (!normalized) throw new Error(`unsupported_question_type:${raw}`);
  return normalized;
}

function parseTimestampMs(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value);
  const longMemEvalDate = raw.match(/^(\d{4})\/(\d{2})\/(\d{2}) \([A-Za-z]{3}\) (\d{2}):(\d{2})$/);
  if (longMemEvalDate) {
    const [, year, month, day, hour, minute] = longMemEvalDate;
    return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTurn(turn, sessionIndex, turnIndex) {
  const value = requireObject(turn, `session_${sessionIndex}_turn_${turnIndex}`);
  const role = requireString(value.role, `session_${sessionIndex}_turn_${turnIndex}_role`);
  if (role !== "user" && role !== "assistant") {
    throw new Error(`unsupported_turn_role:${role}`);
  }
  if (typeof value.content !== "string") {
    throw new Error(`session_${sessionIndex}_turn_${turnIndex}_content_must_be_string`);
  }
  return {
    role,
    content: value.content,
    has_answer: value.has_answer === true,
  };
}

export function normalizeLongMemEvalCase(record) {
  const value = requireObject(record, "longmemeval_case");
  const questionId = requireString(value.question_id, "question_id");
  const sessionIds = requireArray(value.haystack_session_ids, "haystack_session_ids");
  const sessionDates = requireArray(value.haystack_dates, "haystack_dates");
  const rawSessions = requireArray(value.haystack_sessions, "haystack_sessions");
  const answerSessionIds = requireArray(value.answer_session_ids, "answer_session_ids");

  if (sessionIds.length !== rawSessions.length || sessionDates.length !== rawSessions.length) {
    throw new Error("haystack_session_shape_mismatch");
  }

  const sessions = rawSessions.map((rawSession, index) => {
    const id = requireString(sessionIds[index], `haystack_session_ids_${index}`);
    const turns = requireArray(rawSession, `haystack_sessions_${index}`)
      .map((turn, turnIndex) => normalizeTurn(turn, index, turnIndex));
    if (turns.length === 0) throw new Error(`haystack_session_empty:${id}`);
    const rawDate = sessionDates[index] == null ? null : String(sessionDates[index]);
    return {
      session_id: id,
      date: rawDate,
      timestamp_ms: parseTimestampMs(sessionDates[index]),
      turns,
    };
  });

  const knownSessionIds = new Set(sessions.map(session => session.session_id));
  const evidenceSessionIds = answerSessionIds.map((id, index) => {
    const normalized = requireString(id, `answer_session_ids_${index}`);
    if (!knownSessionIds.has(normalized)) {
      throw new Error(`answer_session_not_in_haystack:${normalized}`);
    }
    return normalized;
  });

  return {
    schema: LONGMEMEVAL_V1_SCHEMA,
    question_id: questionId,
    question_type: normalizeQuestionType(value.question_type),
    question: requireString(value.question, "question"),
    expected_answer: typeof value.answer === "string" ? value.answer : null,
    question_date: value.question_date == null ? null : String(value.question_date),
    question_timestamp_ms: parseTimestampMs(value.question_date),
    abstention: questionId.endsWith("_abs"),
    sessions,
    evidence_session_ids: [...new Set(evidenceSessionIds)],
  };
}

export function buildLongMemEvalAddRequests(record, { userIdPrefix = "benchmark:v1" } = {}) {
  const item = record?.schema === LONGMEMEVAL_V1_SCHEMA ? record : normalizeLongMemEvalCase(record);
  const userId = `${userIdPrefix}:${item.question_id}`;
  return item.sessions.map((session, sessionIndex) => ({
    request_id: `${userId}:session:${sessionIndex}`,
    user_id: userId,
    session_id: session.session_id,
    session_date: session.date,
    timestamp_ms: session.timestamp_ms,
    messages: session.turns.map((turn, turnIndex) => ({
      source_id: `${item.question_id}:${session.session_id}:${turnIndex}`,
      role: turn.role,
      content: turn.content,
      timestamp_ms: session.timestamp_ms,
    })),
  }));
}

export function hasLongMemEvalUserTarget(record) {
  const item = record?.schema === LONGMEMEVAL_V1_SCHEMA ? record : normalizeLongMemEvalCase(record);
  return item.sessions.some(session => session.turns.some(
    turn => turn.role === "user" && turn.has_answer === true,
  ));
}

export function buildLongMemEvalSearchRequest(record, { userIdPrefix = "benchmark:v1", topK = 10 } = {}) {
  const item = record?.schema === LONGMEMEVAL_V1_SCHEMA ? record : normalizeLongMemEvalCase(record);
  const k = Math.max(1, Math.trunc(Number(topK) || 10));
  return {
    request_id: `${userIdPrefix}:${item.question_id}:search`,
    user_id: `${userIdPrefix}:${item.question_id}`,
    query: item.question,
    top_k: k,
    question_date: item.question_date,
  };
}

function longMemEvalDcg(relevances, k) {
  const bounded = relevances.slice(0, k);
  if (bounded.length === 0) return 0;
  let score = Number(bounded[0]) || 0;
  for (let index = 1; index < bounded.length; index += 1) {
    score += (Number(bounded[index]) || 0) / Math.log2(index + 1);
  }
  return score;
}

function longMemEvalNdcg(retrieved, evidence, k) {
  if (evidence.size === 0) return null;
  const relevances = retrieved.map(id => (evidence.has(id) ? 1 : 0));
  const ideal = Array.from({ length: evidence.size }, () => 1);
  const idealDcg = longMemEvalDcg(ideal, k);
  return idealDcg === 0 ? 0 : longMemEvalDcg(relevances, k) / idealDcg;
}

export function scoreLongMemEvalSessionMetrics(record, retrievedSessionIds, {
  ks = LONGMEMEVAL_RETRIEVAL_KS,
} = {}) {
  const item = record?.schema === LONGMEMEVAL_V1_SCHEMA ? record : normalizeLongMemEvalCase(record);
  const retrieved = (Array.isArray(retrievedSessionIds) ? retrievedSessionIds : [])
    .filter(id => typeof id === "string" && id);
  const evidence = new Set(item.evidence_session_ids);
  const metrics = {};

  for (const rawK of ks) {
    const k = Math.max(1, Math.trunc(Number(rawK) || 1));
    const recalled = new Set(retrieved.slice(0, k));
    const anyHit = [...evidence].some(id => recalled.has(id));
    const allHit = [...evidence].every(id => recalled.has(id));
    metrics[`recall_any@${k}`] = evidence.size === 0 ? null : Number(anyHit);
    metrics[`recall_all@${k}`] = evidence.size === 0 ? null : Number(allHit);
    metrics[`ndcg_any@${k}`] = longMemEvalNdcg(retrieved, evidence, k);
  }

  return {
    question_id: item.question_id,
    question_type: item.question_type,
    abstention: item.abstention,
    metrics,
  };
}

export function scoreLongMemEvalSessionRetrieval(record, retrievedSessionIds, { topK = null } = {}) {
  const item = record?.schema === LONGMEMEVAL_V1_SCHEMA ? record : normalizeLongMemEvalCase(record);
  const source = Array.isArray(retrievedSessionIds) ? retrievedSessionIds : [];
  const bounded = topK == null ? source : source.slice(0, Math.max(1, Math.trunc(Number(topK) || 1)));
  const retrieved = bounded.filter(id => typeof id === "string" && id);
  const evidence = new Set(item.evidence_session_ids);
  const hitIds = retrieved.filter(id => evidence.has(id));
  const firstRelevantRank = retrieved.findIndex(id => evidence.has(id));
  const denominator = evidence.size;

  return {
    question_id: item.question_id,
    question_type: item.question_type,
    abstention: item.abstention,
    evidence_sessions: denominator,
    retrieved_sessions: retrieved.length,
    hit_sessions: hitIds.length,
    session_recall: denominator === 0 ? null : hitIds.length / denominator,
    session_precision: retrieved.length === 0 ? null : hitIds.length / retrieved.length,
    any_evidence_hit: denominator === 0 ? null : hitIds.length > 0,
    all_evidence_found: denominator === 0 ? null : hitIds.length === denominator,
    reciprocal_rank: firstRelevantRank < 0 ? 0 : 1 / (firstRelevantRank + 1),
    hit_session_ids: hitIds,
  };
}

export function summarizeLongMemEvalDataset(records) {
  const items = requireArray(records, "longmemeval_dataset").map(normalizeLongMemEvalCase);
  const byType = {};
  let sessionCount = 0;
  let turnCount = 0;
  let evidenceSessionCount = 0;
  let abstentionCount = 0;
  let noUserTargetCount = 0;
  let retrievalScoredCount = 0;

  for (const item of items) {
    byType[item.question_type] = (byType[item.question_type] || 0) + 1;
    sessionCount += item.sessions.length;
    turnCount += item.sessions.reduce((sum, session) => sum + session.turns.length, 0);
    evidenceSessionCount += item.evidence_session_ids.length;
    if (item.abstention) abstentionCount += 1;
    const hasUserTarget = hasLongMemEvalUserTarget(item);
    if (!hasUserTarget) noUserTargetCount += 1;
    if (!item.abstention && hasUserTarget) retrievalScoredCount += 1;
  }

  return {
    schema: LONGMEMEVAL_V1_SCHEMA,
    cases: items.length,
    sessions: sessionCount,
    turns: turnCount,
    evidence_sessions: evidenceSessionCount,
    abstention_cases: abstentionCount,
    retrieval_no_user_target_cases: noUserTargetCount,
    retrieval_scored_cases: retrievalScoredCount,
    by_question_type: byType,
  };
}
