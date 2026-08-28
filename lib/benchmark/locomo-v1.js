import { createHash } from "node:crypto";

export const LOCOMO_V1_SCHEMA = "memory_engine_locomo_v1";
export const LOCOMO_RETRIEVAL_PROFILE = "locomo_dialog_retrieval_contract_v1";

export const LOCOMO_UPSTREAM_REPOSITORY = "https://github.com/snap-research/locomo";
export const LOCOMO_UPSTREAM_COMMIT = "3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376";
export const LOCOMO_DATASET_FILE_COMMIT = "cbfbc1dba6bc53d00625212a0f22d55ffee7c1fc";
export const LOCOMO_DATASET_PATH = "data/locomo10.json";
export const LOCOMO_DATASET_SHA256 = "79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4";
export const LOCOMO_LICENSE_IDENTITY = "CC BY-NC 4.0 International";

export const LOCOMO_EVIDENCE_STRICT_V1 = "locomo_evidence_strict_v1";
export const LOCOMO_EVIDENCE_CANONICALIZED_V1 = "locomo_evidence_canonicalized_v1";
export const LOCOMO_DIALOG_TEXT_PROJECTION = "speaker_colon_raw_text_v1";
export const LOCOMO_BLIP_CAPTION_PROJECTION = "shares_caption_suffix_v1";

export const LOCOMO_RETRIEVAL_KS = Object.freeze([1, 3, 5, 10, 30, 50]);

export const LOCOMO_CATEGORY_MAP = Object.freeze({
  1: Object.freeze({ id: 1, name: "multi-hop-retrieval" }),
  2: Object.freeze({ id: 2, name: "temporal-reasoning" }),
  3: Object.freeze({ id: 3, name: "open-domain-knowledge" }),
  4: Object.freeze({ id: 4, name: "single-hop-retrieval" }),
  5: Object.freeze({ id: 5, name: "adversarial" }),
});

// The first applicable issue is the public skip reason. This prevents a
// malformed QA from changing its denominator merely because another parser
// discovers a later issue in the same evidence list.
export const LOCOMO_SKIP_REASON_PRECEDENCE = Object.freeze([
  "evidence_missing",
  "evidence_not_array",
  "empty_evidence",
  "malformed_evidence",
  "unmapped_evidence",
  "composite_evidence",
  "noncanonical_evidence",
  "duplicate_evidence",
]);

const LOCOMO_EVIDENCE_POLICIES = new Set([
  LOCOMO_EVIDENCE_STRICT_V1,
  LOCOMO_EVIDENCE_CANONICALIZED_V1,
]);
const LOCOMO_REPAIRABLE_EVIDENCE_ISSUES = new Set([
  "composite_evidence",
  "noncanonical_evidence",
  "duplicate_evidence",
]);
const OWN = Object.prototype.hasOwnProperty;
const NUMERIC_DIA_ID = /^D(\d+):(\d+)$/;
const CANONICAL_DIA_ID = /^D([1-9]\d*):([1-9]\d*)$/;
const SESSION_KEY = /^session_(\d+)$/;

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

function requireEvidencePolicy(policy) {
  if (!LOCOMO_EVIDENCE_POLICIES.has(policy)) {
    throw new Error(`unsupported_evidence_policy:${String(policy)}`);
  }
  return policy;
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseDiaId(value) {
  if (typeof value !== "string") return null;
  const match = value.match(NUMERIC_DIA_ID);
  if (!match) return null;
  const sessionNumber = parsePositiveInteger(match[1]);
  const turnNumber = parsePositiveInteger(match[2]);
  if (sessionNumber === null || turnNumber === null) return null;
  return {
    raw: value,
    session_number: sessionNumber,
    turn_number: turnNumber,
    canonical: `D${sessionNumber}:${turnNumber}`,
    canonical_input: CANONICAL_DIA_ID.test(value) && value === `D${sessionNumber}:${turnNumber}`,
  };
}

function parseTimestampMs(value) {
  if (value == null || value === "") return null;
  const raw = String(value);
  const match = raw.match(/^(\d{1,2}):(\d{2})\s+(am|pm) on (\d{1,2}) ([A-Za-z]+), (\d{4})$/i);
  if (!match) return null;

  const [, rawHour, rawMinute, rawMeridiem, rawDay, rawMonth, rawYear] = match;
  const months = new Map([
    ["january", 0], ["february", 1], ["march", 2], ["april", 3],
    ["may", 4], ["june", 5], ["july", 6], ["august", 7],
    ["september", 8], ["october", 9], ["november", 10], ["december", 11],
  ]);
  const month = months.get(rawMonth.toLowerCase());
  if (month === undefined) return null;

  let hour = Number(rawHour);
  if (!Number.isInteger(hour) || hour < 1 || hour > 12) return null;
  if (rawMeridiem.toLowerCase() === "am") hour = hour === 12 ? 0 : hour;
  else hour = hour === 12 ? 12 : hour + 12;
  const minute = Number(rawMinute);
  const day = Number(rawDay);
  const year = Number(rawYear);
  if (minute > 59 || day < 1 || day > 31) return null;
  return Date.UTC(year, month, day, hour, minute);
}

function enumerateSessions(conversation) {
  const keys = Object.keys(conversation)
    .filter(key => SESSION_KEY.test(key))
    .sort((left, right) => Number(left.slice(8)) - Number(right.slice(8)));
  if (keys.length === 0) throw new Error("conversation_sessions_missing");

  return keys.map(key => {
    const sessionNumber = Number(key.slice(8));
    if (!Number.isSafeInteger(sessionNumber) || sessionNumber < 1) {
      throw new Error(`invalid_session_key:${key}`);
    }
    const turns = requireArray(conversation[key], `${key}_must_be_array`);
    if (turns.length === 0) throw new Error(`${key}_must_not_be_empty`);
    const dateKey = `${key}_date_time`;
    const dateTime = conversation[dateKey] == null ? null : String(conversation[dateKey]);
    return { key, sessionNumber, turns, dateTime };
  });
}

function normalizeSessions(conversation) {
  const sessions = [];
  const seenDiaIds = new Set();
  let turnIdentityValidated = 0;

  for (const entry of enumerateSessions(conversation)) {
    const normalizedTurns = entry.turns.map((rawTurn, turnIndex) => {
      const turn = requireObject(rawTurn, `${entry.key}_turn_${turnIndex}`);
      const speaker = requireString(turn.speaker, `${entry.key}_turn_${turnIndex}_speaker`);
      if (typeof turn.text !== "string") {
        throw new Error(`${entry.key}_turn_${turnIndex}_text_must_be_string`);
      }
      const diaId = requireString(turn.dia_id, `${entry.key}_turn_${turnIndex}_dia_id`);
      const parsedDiaId = parseDiaId(diaId);
      if (!parsedDiaId) throw new Error(`invalid_dia_id:${diaId}`);
      if (!parsedDiaId.canonical_input) throw new Error(`noncanonical_dia_id:${diaId}`);
      if (parsedDiaId.session_number !== entry.sessionNumber) {
        throw new Error(`dia_id_session_mismatch:${diaId}:${entry.key}`);
      }
      if (parsedDiaId.turn_number !== turnIndex + 1) {
        throw new Error(`dia_id_turn_mismatch:${diaId}:${entry.key}:${turnIndex + 1}`);
      }
      if (seenDiaIds.has(diaId)) throw new Error(`duplicate_dia_id:${diaId}`);
      seenDiaIds.add(diaId);
      turnIdentityValidated += 1;

      const normalizedTurn = {
        dia_id: diaId,
        speaker,
        text: turn.text,
      };
      // These fields are optional in the upstream shape. They remain outside
      // the default raw-text projection and are only used by the explicitly
      // opted-in BLIP caption contract below.
      if (typeof turn.img_file === "string") normalizedTurn.img_file = turn.img_file;
      if (typeof turn.blip_caption === "string") normalizedTurn.blip_caption = turn.blip_caption;
      return normalizedTurn;
    });

    sessions.push({
      session_id: entry.key,
      session_number: entry.sessionNumber,
      date_time: entry.dateTime,
      timestamp_ms: parseTimestampMs(entry.dateTime),
      turns: normalizedTurns,
    });
  }

  return { sessions, turnIdentityValidated };
}

function parseEvidenceItem(rawItem) {
  if (typeof rawItem !== "string") {
    return { kind: "malformed", tokens: [] };
  }

  const direct = parseDiaId(rawItem);
  if (direct) {
    return {
      kind: "single",
      tokens: [direct],
      noncanonical: rawItem !== direct.canonical,
    };
  }

  const trimmed = rawItem.trim();
  const rawTokens = trimmed === "" ? [] : trimmed.split(/[;\s]+/).filter(Boolean);
  const tokens = rawTokens.map(token => parseDiaId(token));
  if (tokens.length > 1 && tokens.every(Boolean)) {
    return {
      kind: "composite",
      composite_type: rawItem.includes(";") ? "semicolon" : "whitespace",
      tokens,
      noncanonical: tokens.some(token => token.raw !== token.canonical),
    };
  }

  return { kind: "malformed", tokens: [] };
}

function sortedIssues(issueSet) {
  const rank = new Map(LOCOMO_SKIP_REASON_PRECEDENCE.map((reason, index) => [reason, index]));
  return [...issueSet].sort((left, right) => (rank.get(left) ?? 999) - (rank.get(right) ?? 999));
}

function normalizeQuestion(rawQuestion, {
  sampleId,
  qaIndex,
  turnByDiaId,
  evidencePolicy,
} = {}) {
  const question = requireObject(rawQuestion, `qa_${qaIndex}`);
  const questionText = requireString(question.question, `qa_${qaIndex}_question`);
  const category = question.category;
  if (!Number.isInteger(category) || !LOCOMO_CATEGORY_MAP[category]) {
    throw new Error(`unsupported_category:${String(question.category)}`);
  }

  const hasEvidence = OWN.call(question, "evidence");
  const rawEvidence = hasEvidence ? question.evidence : undefined;
  const audit = {
    missing: !hasEvidence,
    null_value: hasEvidence && rawEvidence === null,
    non_array: hasEvidence && !Array.isArray(rawEvidence),
    empty: Array.isArray(rawEvidence) && rawEvidence.length === 0,
    raw_item_count: Array.isArray(rawEvidence) ? rawEvidence.length : 0,
    composite_semicolon_items: 0,
    composite_whitespace_items: 0,
    malformed_items: 0,
    noncanonical_items: 0,
    unmapped_items: 0,
    duplicate_occurrences: 0,
  };
  const issues = new Set();
  if (audit.missing) issues.add("evidence_missing");
  else if (audit.non_array) issues.add("evidence_not_array");
  else if (audit.empty) issues.add("empty_evidence");

  const parsedIds = [];
  if (Array.isArray(rawEvidence)) {
    for (const rawItem of rawEvidence) {
      const parsed = parseEvidenceItem(rawItem);
      if (parsed.kind === "malformed") {
        audit.malformed_items += 1;
        issues.add("malformed_evidence");
        continue;
      }
      if (parsed.kind === "composite") {
        if (parsed.composite_type === "semicolon") audit.composite_semicolon_items += 1;
        else audit.composite_whitespace_items += 1;
        issues.add("composite_evidence");
      }
      if (parsed.noncanonical) {
        audit.noncanonical_items += 1;
        issues.add("noncanonical_evidence");
      }
      for (const token of parsed.tokens) {
        parsedIds.push(token.canonical);
        if (!turnByDiaId.has(token.canonical)) {
          audit.unmapped_items += 1;
          issues.add("unmapped_evidence");
        }
      }
    }
  }

  const counts = new Map();
  for (const id of parsedIds) counts.set(id, (counts.get(id) || 0) + 1);
  for (const count of counts.values()) {
    if (count > 1) {
      audit.duplicate_occurrences += count - 1;
      issues.add("duplicate_evidence");
    }
  }

  const allIssues = sortedIssues(issues);
  const blockingIssues = allIssues.filter(issue => (
    evidencePolicy === LOCOMO_EVIDENCE_STRICT_V1 || !LOCOMO_REPAIRABLE_EVIDENCE_ISSUES.has(issue)
  ));
  const uniqueDialogIds = [...new Set(parsedIds)];
  const evidenceSessionIds = [];
  const seenSessionIds = new Set();
  for (const diaId of uniqueDialogIds) {
    const turn = turnByDiaId.get(diaId);
    if (!turn || seenSessionIds.has(turn.session_id)) continue;
    seenSessionIds.add(turn.session_id);
    evidenceSessionIds.push(turn.session_id);
  }

  return {
    question_id: `${sampleId}:qa:${qaIndex}`,
    qa_index: qaIndex,
    question: questionText,
    category,
    category_name: LOCOMO_CATEGORY_MAP[category].name,
    evidence_policy: evidencePolicy,
    raw_evidence: Array.isArray(rawEvidence) ? [...rawEvidence] : rawEvidence,
    evidence_dialog_ids: uniqueDialogIds,
    evidence_session_ids: evidenceSessionIds,
    evidence_anomalies: allIssues,
    evidence_audit: audit,
    scoreable: blockingIssues.length === 0,
    skip_reason: blockingIssues.length > 0 ? blockingIssues[0] : null,
    skip_reasons: blockingIssues,
  };
}

export function normalizeLocomoCase(record, {
  evidencePolicy = LOCOMO_EVIDENCE_STRICT_V1,
} = {}) {
  requireEvidencePolicy(evidencePolicy);
  const value = requireObject(record, "locomo_case");
  const sampleId = requireString(value.sample_id, "sample_id");
  const conversation = requireObject(value.conversation, "conversation");
  const rawQa = requireArray(value.qa, "qa");
  const { sessions, turnIdentityValidated } = normalizeSessions(conversation);
  const turnByDiaId = new Map();
  for (const session of sessions) {
    for (const turn of session.turns) {
      turnByDiaId.set(turn.dia_id, { ...turn, session_id: session.session_id });
    }
  }
  const questions = rawQa.map((qa, qaIndex) => normalizeQuestion(qa, {
    sampleId,
    qaIndex,
    turnByDiaId,
    evidencePolicy,
  }));

  return {
    schema: LOCOMO_V1_SCHEMA,
    profile: LOCOMO_RETRIEVAL_PROFILE,
    sample_id: sampleId,
    evidence_policy: evidencePolicy,
    sessions,
    questions,
    turn_identity: {
      total: turnIdentityValidated,
      validated: turnIdentityValidated,
      complete: true,
    },
  };
}

export function normalizeLocomoDataset(records, options = {}) {
  const seenSampleIds = new Set();
  return requireArray(records, "locomo_dataset").map((record, index) => {
    const item = normalizeLocomoCase(record, options);
    if (seenSampleIds.has(item.sample_id)) throw new Error(`duplicate_sample_id:${item.sample_id}:${index}`);
    seenSampleIds.add(item.sample_id);
    return item;
  });
}

function ensureCase(record, options = {}) {
  const evidencePolicy = options.evidencePolicy || LOCOMO_EVIDENCE_STRICT_V1;
  if (record?.schema === LOCOMO_V1_SCHEMA) {
    if (record.evidence_policy !== evidencePolicy) {
      throw new Error(`normalized_case_policy_mismatch:${record.evidence_policy}:${evidencePolicy}`);
    }
    return record;
  }
  return normalizeLocomoCase(record, { evidencePolicy });
}

function getQuestion(item, questionIndex = 0) {
  const index = Number(questionIndex);
  if (!Number.isSafeInteger(index) || index < 0 || index >= item.questions.length) {
    throw new Error(`qa_index_out_of_range:${String(questionIndex)}`);
  }
  return item.questions[index];
}

function getTurnByDiaId(item) {
  const turnByDiaId = new Map();
  for (const session of item.sessions) {
    for (const turn of session.turns) {
      turnByDiaId.set(turn.dia_id, { ...turn, session_id: session.session_id });
    }
  }
  return turnByDiaId;
}

function hashIdentity(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function buildLocomoSearchRequest(record, {
  questionIndex = 0,
  userIdPrefix = "benchmark:locomo:v1",
  topK = 50,
  evidencePolicy = LOCOMO_EVIDENCE_STRICT_V1,
} = {}) {
  const item = ensureCase(record, { evidencePolicy });
  const question = getQuestion(item, questionIndex);
  const normalizedQuestionIndex = question.qa_index;
  const k = Math.trunc(Number(topK));
  if (!Number.isSafeInteger(k) || k < 1) throw new Error("top_k_must_be_positive_integer");
  const userId = `${userIdPrefix}:${item.sample_id}:qa:${normalizedQuestionIndex}`;
  return {
    request_id: `${userId}:search`,
    user_id: userId,
    query: question.question,
    top_k: k,
  };
}

function buildMemoryId(item, questionIndex, sessionId, diaId) {
  return hashIdentity(`${item.sample_id}\u0000${questionIndex}\u0000${sessionId}\u0000${diaId}`);
}

function buildConversationMemoryId(item, sessionId, diaId) {
  return hashIdentity(`${item.sample_id}\u0000conversation\u0000${sessionId}\u0000${diaId}`);
}

export function buildLocomoDialogText(turn, { includeBlipCaption = false } = {}) {
  if (!turn || typeof turn !== "object") throw new Error("locomo_turn_required");
  const speaker = requireString(turn.speaker, "turn_speaker");
  if (typeof turn.text !== "string") throw new Error("turn_text_must_be_string");
  const rawText = `${speaker}: ${turn.text}`;
  const hasCaption = includeBlipCaption
    && typeof turn.img_file === "string"
    && turn.img_file.trim() !== ""
    && typeof turn.blip_caption === "string"
    && turn.blip_caption.trim() !== "";
  return hasCaption ? `${rawText}\n[shares ${turn.blip_caption}]` : rawText;
}

export function buildLocomoDialogDocuments(record, {
  questionIndex = 0,
  userIdPrefix = "benchmark:locomo:v1",
  evidencePolicy = LOCOMO_EVIDENCE_STRICT_V1,
} = {}) {
  const item = ensureCase(record, { evidencePolicy });
  const question = getQuestion(item, questionIndex);
  const normalizedQuestionIndex = question.qa_index;
  const userId = `${userIdPrefix}:${item.sample_id}:qa:${normalizedQuestionIndex}`;
  return item.sessions.flatMap(session => session.turns.map(turn => ({
    memory_id: buildMemoryId(item, normalizedQuestionIndex, session.session_id, turn.dia_id),
    request_id: `${userId}:dialog:${turn.dia_id}`,
    user_id: userId,
    session_id: session.session_id,
    dia_id: turn.dia_id,
    source_id: `${item.sample_id}:${session.session_id}:${turn.dia_id}`,
    content: buildLocomoDialogText(turn),
    session_date: session.date_time,
    timestamp_ms: session.timestamp_ms,
  })));
}

export function buildLocomoConversationDialogDocuments(record, {
  userIdPrefix = "benchmark:locomo:v1",
  evidencePolicy = LOCOMO_EVIDENCE_STRICT_V1,
  includeBlipCaption = false,
} = {}) {
  const item = ensureCase(record, { evidencePolicy });
  const userId = `${userIdPrefix}:${item.sample_id}`;
  return item.sessions.flatMap(session => session.turns.map(turn => ({
    memory_id: buildConversationMemoryId(item, session.session_id, turn.dia_id),
    request_id: `${userId}:dialog:${turn.dia_id}`,
    user_id: userId,
    session_id: session.session_id,
    dia_id: turn.dia_id,
    source_id: `${item.sample_id}:${session.session_id}:${turn.dia_id}`,
    content: buildLocomoDialogText(turn, { includeBlipCaption }),
    session_date: session.date_time,
    timestamp_ms: session.timestamp_ms,
  })));
}

export function buildLocomoSessionDocuments(record, {
  questionIndex = 0,
  userIdPrefix = "benchmark:locomo:v1",
  evidencePolicy = LOCOMO_EVIDENCE_STRICT_V1,
} = {}) {
  const item = ensureCase(record, { evidencePolicy });
  const question = getQuestion(item, questionIndex);
  const normalizedQuestionIndex = question.qa_index;
  const userId = `${userIdPrefix}:${item.sample_id}:qa:${normalizedQuestionIndex}`;
  return item.sessions.map(session => ({
    memory_id: hashIdentity(`${item.sample_id}\u0000${normalizedQuestionIndex}\u0000${session.session_id}`),
    request_id: `${userId}:session:${session.session_id}`,
    user_id: userId,
    session_id: session.session_id,
    source_id: `${item.sample_id}:${session.session_id}`,
    content: session.turns.map(turn => buildLocomoDialogText(turn)).join("\n"),
    session_date: session.date_time,
    timestamp_ms: session.timestamp_ms,
  }));
}

export const buildLocomoCorpusDocuments = buildLocomoDialogDocuments;

function rankedIdValue(value, index, label) {
  if (typeof value === "string" && value !== "") return value;
  if (value && typeof value === "object" && typeof value.dia_id === "string" && value.dia_id !== "") {
    return value.dia_id;
  }
  throw new Error(`${label}_id_invalid:${index}`);
}

function normalizeRankedIds(values, label) {
  if (!Array.isArray(values)) throw new Error(`${label}_must_be_array`);
  return values.map((value, index) => rankedIdValue(value, index, label));
}

export function projectLocomoDialogToSessions(record, retrievedDialogIds, {
  evidencePolicy = LOCOMO_EVIDENCE_STRICT_V1,
} = {}) {
  const item = ensureCase(record, { evidencePolicy });
  const ranked = normalizeRankedIds(retrievedDialogIds, "retrieved_dialog");
  const turnByDiaId = getTurnByDiaId(item);
  const seenSessions = new Set();
  const projected = [];
  for (const [index, diaId] of ranked.entries()) {
    const turn = turnByDiaId.get(diaId);
    if (!turn) throw new Error(`retrieved_dialog_id_unknown:${diaId}:${index}`);
    if (seenSessions.has(turn.session_id)) continue;
    seenSessions.add(turn.session_id);
    projected.push(turn.session_id);
  }
  return projected;
}

export const projectLocomoDialogRankToSessions = projectLocomoDialogToSessions;

function normalizeKs(ks) {
  const values = ks == null ? LOCOMO_RETRIEVAL_KS : requireArray(ks, "ks");
  return values.map(value => {
    const k = Math.trunc(Number(value));
    if (!Number.isSafeInteger(k) || k < 1) throw new Error(`invalid_metric_k:${String(value)}`);
    return k;
  });
}

function dcg(relevances, k) {
  return relevances.slice(0, k).reduce((sum, relevance, index) => (
    sum + (Number(relevance) || 0) / Math.log2(index + 2)
  ), 0);
}

function metricMap(retrieved, targetIds, ks, scoreable) {
  const metrics = {};
  if (!scoreable) {
    for (const k of ks) {
      metrics[`recall_any@${k}`] = null;
      metrics[`recall_all@${k}`] = null;
      metrics[`ndcg_any@${k}`] = null;
    }
    return metrics;
  }

  const target = new Set(targetIds);
  const idealDcgByK = new Map(ks.map(k => [k, dcg(Array.from({ length: target.size }, () => 1), k)]));
  for (const k of ks) {
    const prefix = retrieved.slice(0, k);
    const recalled = new Set(prefix);
    const anyHit = [...target].some(id => recalled.has(id));
    const allHit = [...target].every(id => recalled.has(id));
    const relevances = prefix.map(id => (target.has(id) ? 1 : 0));
    const idealDcg = idealDcgByK.get(k);
    metrics[`recall_any@${k}`] = Number(anyHit);
    metrics[`recall_all@${k}`] = Number(allHit);
    metrics[`ndcg_any@${k}`] = idealDcg === 0 ? 0 : dcg(relevances, k) / idealDcg;
  }
  return metrics;
}

function scoreRankedTargets(item, question, retrieved, targetIds, level, ks) {
  const target = new Set(targetIds);
  const firstIndex = retrieved.findIndex(id => target.has(id));
  return {
    profile: LOCOMO_RETRIEVAL_PROFILE,
    metric_level: level,
    question_id: question.question_id,
    category: question.category,
    category_name: question.category_name,
    scoreable: question.scoreable,
    skip_reason: question.skip_reason,
    target_ids: [...target],
    retrieved_ids: retrieved,
    first_relevant_rank: question.scoreable && firstIndex >= 0 ? firstIndex + 1 : null,
    metrics: metricMap(retrieved, [...target], ks, question.scoreable),
  };
}

export function scoreLocomoDialogMetrics(record, retrievedDialogIds, {
  questionIndex = 0,
  ks = LOCOMO_RETRIEVAL_KS,
  evidencePolicy = LOCOMO_EVIDENCE_STRICT_V1,
} = {}) {
  const item = ensureCase(record, { evidencePolicy });
  const question = getQuestion(item, questionIndex);
  return scoreRankedTargets(
    item,
    question,
    normalizeRankedIds(retrievedDialogIds, "retrieved_dialog"),
    question.evidence_dialog_ids,
    "dialog",
    normalizeKs(ks),
  );
}

export function scoreLocomoSessionMetrics(record, retrievedSessionIds, {
  questionIndex = 0,
  ks = LOCOMO_RETRIEVAL_KS,
  evidencePolicy = LOCOMO_EVIDENCE_STRICT_V1,
} = {}) {
  const item = ensureCase(record, { evidencePolicy });
  const question = getQuestion(item, questionIndex);
  if (!Array.isArray(retrievedSessionIds)) throw new Error("retrieved_session_must_be_array");
  const retrieved = retrievedSessionIds.map((value, index) => {
    if (typeof value !== "string" || value === "") throw new Error(`retrieved_session_id_invalid:${index}`);
    return value;
  });
  return scoreRankedTargets(
    item,
    question,
    retrieved,
    question.evidence_session_ids,
    "session",
    normalizeKs(ks),
  );
}

export function scoreLocomoRetrieval(record, retrievedDialogIds, options = {}) {
  const item = ensureCase(record, options);
  const projectedSessionIds = projectLocomoDialogToSessions(item, retrievedDialogIds, options);
  return {
    dialog: scoreLocomoDialogMetrics(item, retrievedDialogIds, options),
    session: scoreLocomoSessionMetrics(item, projectedSessionIds, options),
    projected_session_ids: projectedSessionIds,
  };
}

function emptyCounts() {
  return {
    missing_field: 0,
    null_value: 0,
    non_array: 0,
    empty_arrays: 0,
    nonempty_questions: 0,
    raw_items: 0,
    composite_semicolon_items: 0,
    composite_whitespace_items: 0,
    malformed_items: 0,
    noncanonical_items: 0,
    unmapped_items: 0,
    duplicate_qas: 0,
    duplicate_occurrences: 0,
    anomaly_qas: 0,
    nonempty_anomaly_qas: 0,
  };
}

function summarizeItems(items) {
  const categoryTotals = {};
  const categoryPolicy = {};
  const evidence = emptyCounts();
  let sessions = 0;
  let turns = 0;
  let scored = 0;
  let skipped = 0;
  const skipReasons = {};
  let turnIdentityValidated = 0;

  for (const item of items) {
    sessions += item.sessions.length;
    turns += item.turn_identity.total;
    turnIdentityValidated += item.turn_identity.validated;
    for (const question of item.questions) {
      const category = String(question.category);
      categoryTotals[category] = (categoryTotals[category] || 0) + 1;
      categoryPolicy[category] ||= { total: 0, scored: 0, skipped: 0, skip_reasons: {} };
      categoryPolicy[category].total += 1;
      if (question.scoreable) {
        scored += 1;
        categoryPolicy[category].scored += 1;
      } else {
        skipped += 1;
        categoryPolicy[category].skipped += 1;
        const reason = question.skip_reason || "unknown";
        skipReasons[reason] = (skipReasons[reason] || 0) + 1;
        categoryPolicy[category].skip_reasons[reason] = (
          categoryPolicy[category].skip_reasons[reason] || 0
        ) + 1;
      }

      const audit = question.evidence_audit;
      if (audit.missing) evidence.missing_field += 1;
      if (audit.null_value) evidence.null_value += 1;
      if (audit.non_array) evidence.non_array += 1;
      if (audit.empty) evidence.empty_arrays += 1;
      if (Array.isArray(question.raw_evidence) && question.raw_evidence.length > 0) {
        evidence.nonempty_questions += 1;
      }
      evidence.raw_items += audit.raw_item_count;
      evidence.composite_semicolon_items += audit.composite_semicolon_items;
      evidence.composite_whitespace_items += audit.composite_whitespace_items;
      evidence.malformed_items += audit.malformed_items;
      evidence.noncanonical_items += audit.noncanonical_items;
      evidence.unmapped_items += audit.unmapped_items;
      if (audit.duplicate_occurrences > 0) evidence.duplicate_qas += 1;
      evidence.duplicate_occurrences += audit.duplicate_occurrences;
      if (question.evidence_anomalies.length > 0) evidence.anomaly_qas += 1;
      if (question.evidence_anomalies.some(issue => issue !== "empty_evidence")) {
        evidence.nonempty_anomaly_qas += 1;
      }
    }
  }

  return {
    conversations: items.length,
    sessions,
    turns,
    questions: Object.values(categoryTotals).reduce((sum, count) => sum + count, 0),
    qa: Object.values(categoryTotals).reduce((sum, count) => sum + count, 0),
    category_totals: categoryTotals,
    turn_identity: {
      total: turns,
      validated: turnIdentityValidated,
      complete: turns === turnIdentityValidated,
    },
    evidence_audit: evidence,
    scored_cases: scored,
    skipped_cases: skipped,
    skip_reasons: skipReasons,
    by_category: categoryPolicy,
  };
}

export function summarizeLocomoDataset(records, {
  evidencePolicy = LOCOMO_EVIDENCE_STRICT_V1,
} = {}) {
  const items = normalizeLocomoDataset(records, { evidencePolicy });
  const summary = summarizeItems(items);
  return {
    schema: LOCOMO_V1_SCHEMA,
    profile: LOCOMO_RETRIEVAL_PROFILE,
    evidence_policy: evidencePolicy,
    ...summary,
  };
}

export function validateLocomoDataset(records) {
  const strictItems = normalizeLocomoDataset(records, { evidencePolicy: LOCOMO_EVIDENCE_STRICT_V1 });
  const canonicalizedItems = normalizeLocomoDataset(records, {
    evidencePolicy: LOCOMO_EVIDENCE_CANONICALIZED_V1,
  });
  const strict = summarizeItems(strictItems);
  const canonicalized = summarizeItems(canonicalizedItems);
  const categoryTotals = strict.category_totals;
  const officialShapeMatches = (
    strict.conversations === 10
    && strict.sessions === 272
    && strict.turns === 5882
    && strict.qa === 1986
    && JSON.stringify(categoryTotals) === JSON.stringify({ 1: 282, 2: 321, 3: 96, 4: 841, 5: 446 })
    && strict.turn_identity.validated === 5882
    && strict.turn_identity.complete
  );

  return {
    valid: true,
    schema: LOCOMO_V1_SCHEMA,
    profile: LOCOMO_RETRIEVAL_PROFILE,
    provenance: getLocomoProvenance(),
    official_shape_matches: officialShapeMatches,
    conversations: strict.conversations,
    sessions: strict.sessions,
    turns: strict.turns,
    qa: strict.qa,
    category_totals: categoryTotals,
    turn_identity: strict.turn_identity,
    evidence_audit: strict.evidence_audit,
    policies: {
      [LOCOMO_EVIDENCE_STRICT_V1]: {
        scored_cases: strict.scored_cases,
        skipped_cases: strict.skipped_cases,
        skip_reasons: strict.skip_reasons,
        by_category: strict.by_category,
      },
      [LOCOMO_EVIDENCE_CANONICALIZED_V1]: {
        scored_cases: canonicalized.scored_cases,
        skipped_cases: canonicalized.skipped_cases,
        skip_reasons: canonicalized.skip_reasons,
        by_category: canonicalized.by_category,
      },
    },
  };
}

export function getLocomoProvenance() {
  return {
    upstream_repository: LOCOMO_UPSTREAM_REPOSITORY,
    upstream_commit: LOCOMO_UPSTREAM_COMMIT,
    dataset_file_commit: LOCOMO_DATASET_FILE_COMMIT,
    dataset_path: LOCOMO_DATASET_PATH,
    dataset_sha256: LOCOMO_DATASET_SHA256,
    license_identity: LOCOMO_LICENSE_IDENTITY,
  };
}

export function sha256LocomoDatasetBytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function assertOfficialLocomoDataset(records, datasetBytes) {
  const validation = validateLocomoDataset(records);
  const actualSha256 = sha256LocomoDatasetBytes(datasetBytes);
  if (actualSha256 !== LOCOMO_DATASET_SHA256) {
    throw new Error(`dataset_sha256_mismatch:${actualSha256}`);
  }
  if (!validation.official_shape_matches) throw new Error("official_locomo_shape_mismatch");
  return { ...validation, actual_dataset_sha256: actualSha256 };
}
