export const Q6_SHADOW_AUTORECALL_DECISION_SCHEMA_V1 =
  "memory_engine_q6_shadow_autorecall_decision_v1";

const MAX_MEMORY_ID_LENGTH = 16;
const MAX_REASON_LENGTH = 96;
const MAX_DECISIONS = 32;

function boundedId(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const id = String(value).trim().slice(0, MAX_MEMORY_ID_LENGTH);
  return id || null;
}

function boundedReason(value) {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  if (!reason || reason.length > MAX_REASON_LENGTH || !/^[A-Za-z0-9_:-]+$/u.test(reason)) {
    return null;
  }
  return reason;
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function nonNegativeInteger(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

function exactSessionAllowlist(config = {}) {
  const list = config?.shadow?.sessionAllowlist;
  return Array.isArray(list)
    ? list.map(value => String(value || "").trim()).filter(Boolean)
    : [];
}

export function resolveAutoRecallShadowScope(config = {}, sessionId = null) {
  if (config?.shadow?.enabled !== true) {
    return { active: false, reason: "shadow_disabled" };
  }
  const sessions = exactSessionAllowlist(config);
  if (sessions.length === 0) {
    return { active: false, reason: "shadow_scope_empty" };
  }
  const exactSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!exactSessionId) {
    return { active: false, reason: "shadow_session_missing" };
  }
  if (!sessions.includes(exactSessionId)) {
    return { active: false, reason: "shadow_session_not_allowlisted" };
  }
  return {
    active: true,
    reason: "shadow_session_allowlisted",
    sessionId: exactSessionId,
  };
}

function gateDecisionMap(gateDecisions = []) {
  const map = new Map();
  for (const item of Array.isArray(gateDecisions) ? gateDecisions : []) {
    const id = boundedId(item?.id);
    if (id) map.set(id, item);
  }
  return map;
}

function capabilityByIndex(capabilityResults = []) {
  const map = new Map();
  for (const item of Array.isArray(capabilityResults) ? capabilityResults : []) {
    const index = Number(item?.candidate_index);
    if (!Number.isSafeInteger(index) || index < 0) continue;
    map.set(index, {
      capability: boundedReason(item?.capability),
      capability_reason: boundedReason(item?.reason),
    });
  }
  return map;
}

function selectionByIndex(selections = []) {
  const map = new Map();
  for (const item of Array.isArray(selections) ? selections : []) {
    const index = Number(item?.candidate_index);
    if (!Number.isSafeInteger(index) || index < 0) continue;
    map.set(index, {
      decision: boundedReason(item?.decision),
      decision_reason: boundedReason(item?.reason),
      memory_id: boundedId(item?.memory_id),
    });
  }
  return map;
}

export function buildQ6ShadowAutoRecallDecisionV1({
  runtimeGate = {},
  structuralSkipReason = null,
  searchExecuted = false,
  focusedQueryUsed = false,
  originalInputChars = 0,
  focusedQueryChars = 0,
  candidates = [],
  candidateCount = null,
  candidateCountAfterGate = null,
  gateDecisions = [],
  capabilityResults = [],
  selections = [],
  wouldInjectEntries = [],
  status = null,
} = {}) {
  const gateById = gateDecisionMap(gateDecisions);
  const capability = capabilityByIndex(capabilityResults);
  const selection = selectionByIndex(selections);
  const gateRows = Array.isArray(gateDecisions) ? gateDecisions : [];
  let gatedIndex = -1;
  const candidateRows = (gateRows.length > 0
    ? gateRows.slice(0, MAX_DECISIONS).map((gate, index) => {
      const gatePass = gate?.injected === true;
      if (gatePass) gatedIndex += 1;
      const cap = gatePass ? (capability.get(gatedIndex) || {}) : {};
      const select = gatePass ? (selection.get(gatedIndex) || {}) : {};
      return {
        rank: index + 1,
        memory_id: boundedId(gate?.id),
        category: boundedReason(String(gate?.category || "raw_log")) || "raw_log",
        final_score: finiteNumber(gate?.final_score),
        gate_pass: gatePass,
        gate_reason: boundedReason(gate?.rejection_reason ?? gate?.rejected_reason ?? gate?.reason),
        capability: cap.capability ?? null,
        capability_reason: cap.capability_reason ?? null,
        selection_decision: select.decision ?? null,
        selection_reason: select.decision_reason ?? null,
        would_inject: select.decision === "DISCLOSE_CARD",
      };
    })
    : (Array.isArray(candidates) ? candidates : [])
      .slice(0, MAX_DECISIONS)
      .map((candidate, index) => {
        const id = boundedId(candidate?.id ?? candidate?.memory_id ?? candidate?.chunk_id);
        const gate = id ? gateById.get(id) : null;
        return {
          rank: index + 1,
          memory_id: id,
          category: boundedReason(String(candidate?.category || "raw_log")) || "raw_log",
          final_score: finiteNumber(
            candidate?.final_score ?? candidate?.finalScore ?? candidate?.rrf_score,
          ),
          gate_pass: gate ? gate.injected === true : false,
          gate_reason: boundedReason(gate?.rejection_reason ?? gate?.rejected_reason ?? gate?.reason),
          capability: null,
          capability_reason: null,
          selection_decision: null,
          selection_reason: null,
          would_inject: false,
        };
      }));

  const wouldInjectIds = (Array.isArray(wouldInjectEntries) ? wouldInjectEntries : [])
    .map(entry => boundedId(
      entry?.selection?.memory_id ??
      entry?.memory?.memory_id ??
      entry?.memory?.id,
    ))
    .filter(Boolean)
    .slice(0, MAX_DECISIONS);

  const skipReason = boundedReason(structuralSkipReason);
  const runtimeReason = boundedReason(runtimeGate?.reason);
  const resolvedStatus = boundedReason(status) || (
    skipReason
      ? "skipped"
      : wouldInjectIds.length > 0
        ? "would_inject"
        : "no_injection"
  );

  return {
    schema: Q6_SHADOW_AUTORECALL_DECISION_SCHEMA_V1,
    debug_type: "q6_shadow_decision",
    mode: "shadow",
    shadow_status: resolvedStatus,
    apply_suppressed: true,
    runtime_gate_allowed: runtimeGate?.allowed === true,
    runtime_gate_reason: runtimeReason,
    structural_skip_reason: skipReason,
    search_executed: searchExecuted === true,
    focused_query_used: focusedQueryUsed === true,
    original_input_chars: nonNegativeInteger(originalInputChars),
    focused_query_chars: nonNegativeInteger(focusedQueryChars),
    candidate_count: candidateCount === null
      ? (Array.isArray(candidates) ? candidates.length : 0)
      : nonNegativeInteger(candidateCount),
    candidate_count_after_gate: candidateCountAfterGate === null
      ? (Array.isArray(gateDecisions) ? gateDecisions : []).filter(item => item?.injected === true).length
      : nonNegativeInteger(candidateCountAfterGate),
    direct_card_selected_count: (Array.isArray(selections) ? selections : [])
      .filter(item => item?.decision === "DISCLOSE_CARD").length,
    would_inject_count: wouldInjectIds.length,
    would_inject_ids: wouldInjectIds,
    candidate_decisions: candidateRows,
  };
}
