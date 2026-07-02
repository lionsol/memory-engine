import { createHash } from "node:crypto";

export const MEMORY_OBJECT_SCHEMA_VERSION = 1;
export const MEMORY_CARD_SCHEMA_VERSION = 1;

export const MEMORY_DISCLOSURE_LEVELS = [
  "none",
  "memory_card",
  "short_summary",
  "full_content_on_get",
];

export const MEMORY_RISK_FLAGS = [
  "raw_log_like",
  "tool_output_like",
  "dreaming_artifact",
  "low_confidence",
  "archived",
  "quarantined",
  "stale_index_candidate",
  "conflict_flag",
  "cross_agent_scope",
  "sensitive_source",
];

export const MEMORY_LIFECYCLE_STATES = [
  "active",
  "candidate",
  "needs_review",
  "archived",
  "quarantined",
  "deleted_shadow",
  "stale_index_candidate",
];

const BLOCKING_RISK_FLAGS = new Set([
  "dreaming_artifact",
  "archived",
  "quarantined",
  "stale_index_candidate",
]);

const RAW_CONTENT_RISK_FLAGS = new Set([
  "raw_log_like",
  "tool_output_like",
  "dreaming_artifact",
  "sensitive_source",
]);

function compactWhitespace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncate(value = "", max = 160) {
  const text = compactWhitespace(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function normalizePath(path = "") {
  return String(path || "").replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

function stableHash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function stableObjectId(candidate = {}, projectionVersion = MEMORY_OBJECT_SCHEMA_VERSION) {
  const id = String(candidate.id || candidate.memory_id || candidate.chunk_id || "").trim();
  if (id) return `memobj_${id.slice(0, 32)}`;
  const payload = JSON.stringify({
    projectionVersion,
    path: candidate.path || candidate.source?.path || "",
    start: candidate.start_line ?? candidate.line_range?.start ?? null,
    end: candidate.end_line ?? candidate.line_range?.end ?? null,
    text: String(candidate.text || "").slice(0, 512),
  });
  return `memobj_${stableHash(payload)}`;
}

function memoryId(candidate = {}) {
  const id = String(candidate.memory_id || candidate.id || candidate.chunk_id || "").trim();
  if (id) return id;
  return stableObjectId(candidate).replace(/^memobj_/, "");
}

function normalizeLine(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sourceLineRange(candidate = {}) {
  const start = normalizeLine(candidate.start_line ?? candidate.line_start ?? candidate.line_range?.start);
  const end = normalizeLine(candidate.end_line ?? candidate.line_end ?? candidate.line_range?.end);
  if (start === null && end === null) return { start: null, end: null };
  return { start, end };
}

function sourceHintFrom(path = "", lineRange = {}) {
  const normalized = normalizePath(path);
  if (!normalized) return "unknown source";
  const start = normalizeLine(lineRange.start);
  const end = normalizeLine(lineRange.end);
  if (start !== null && end !== null) return `${normalized}:${start}-${end}`;
  if (start !== null) return `${normalized}:${start}`;
  if (end !== null) return `${normalized}:${end}`;
  return normalized;
}

function bucketFromPath(path = "") {
  const normalized = normalizePath(path).toLowerCase();
  if (normalized.startsWith("memory/projects/")) return "projects";
  if (normalized.startsWith("memory/episodes/")) return "episodes";
  if (normalized.startsWith("memory/smart-add/")) return "smart_add";
  if (normalized.startsWith("memory/dreaming/")) return "dreaming";
  if (/^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(normalized)) return "daily";
  if (normalized === "memory.md") return "root";
  return "unknown";
}

function sourceTypeFrom(candidate = {}, path = "") {
  const explicit = String(candidate.source_type || candidate.source?.source_type || "").trim();
  if (explicit) return explicit;
  const normalized = normalizePath(path).toLowerCase();
  if (normalized.startsWith("memory/smart-add/")) return "smart_add";
  if (normalized.startsWith("memory/episodes/")) return "episode";
  if (normalized.startsWith("memory/dreaming/")) return "dreaming";
  if (candidate.confidence_mode === "external" || candidate.external_badge) return "openclaw-core";
  return "memory-engine-managed";
}

function lifecycleFrom(candidate = {}) {
  const explicit = String(candidate.lifecycle_state || candidate.lifecycle?.state || "").trim().toLowerCase();
  if (MEMORY_LIFECYCLE_STATES.includes(explicit)) return explicit;
  if (Number(candidate.is_archived || 0) === 1) return "archived";
  if (candidate.is_quarantined === true || Number(candidate.is_quarantined || 0) === 1) return "quarantined";
  if (candidate.stale_index_candidate === true) return "stale_index_candidate";
  if (candidate.needs_review === true) return "needs_review";
  return "active";
}

function categoryFrom(candidate = {}, path = "") {
  const explicit = String(candidate.category || candidate.classification?.category || "").trim().toLowerCase();
  if (explicit) return explicit;
  const normalized = normalizePath(path).toLowerCase();
  if (normalized.startsWith("memory/projects/")) return "project";
  if (normalized.startsWith("memory/episodes/")) return "episodic";
  if (normalized.startsWith("memory/smart-add/")) return "raw_log";
  if (normalized.startsWith("memory/dreaming/")) return "dreaming";
  if (normalized === "memory.md") return "core_profile";
  return "unknown";
}

function kindFrom(candidate = {}, category = "") {
  const explicit = String(candidate.kind || candidate.classification?.kind || "").trim().toLowerCase();
  if (explicit) return explicit;
  const normalizedCategory = String(category || "").toLowerCase();
  if (normalizedCategory.includes("preference") || normalizedCategory === "user_identity") return "preference";
  if (normalizedCategory === "project") return "project_state";
  if (normalizedCategory === "episodic") return "episode";
  if (normalizedCategory === "raw_log") return "diagnostic";
  if (normalizedCategory === "workflow" || normalizedCategory === "workflow_rule") return "workflow_rule";
  if (normalizedCategory === "stats") return "quality_signal";
  return "fact";
}

function scopeFrom(candidate = {}, kind = "", category = "") {
  const explicit = String(candidate.scope || candidate.classification?.scope || "").trim().toLowerCase();
  if (explicit) return explicit;
  if (kind === "project_state" || category === "project") return "project_state";
  if (kind === "decision") return "prior_decision";
  if (kind === "task_state") return "task_state";
  if (kind === "workflow_rule") return "workflow_rule";
  if (kind === "preference") return "user_preference";
  if (kind === "episode") return "historical_context";
  return "entity_background";
}

function normalizeAgentScope(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "unknown";
  return normalized;
}

function confidenceScore(candidate = {}) {
  const candidates = [
    candidate.confidence_score,
    candidate.confidence,
    candidate.final_score,
    candidate.semantic_score,
    candidate.similarity,
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.max(0, Math.min(1, Math.round(n * 10000) / 10000));
  }
  return null;
}

function signalList(candidate = {}) {
  const sources = Array.isArray(candidate.sources) ? candidate.sources : [];
  const explicit = Array.isArray(candidate.confidence?.signals) ? candidate.confidence.signals : [];
  return [...new Set([...sources, ...explicit].map(v => String(v || "").trim()).filter(Boolean))];
}

function contentHash(text = "") {
  return `sha256:${createHash("sha256").update(String(text || "")).digest("hex")}`;
}

function extractSafeText(candidate = {}) {
  return String(candidate.card?.summary || candidate.summary || candidate.text || "")
    .replace(/(?:^|\n)Category:\s*[^\n]+/gi, "\n")
    .trim();
}

function looksLikeToolOutput(text = "") {
  return /\b(ERROR|WARN|Traceback|stack trace|at Object\.|Exception|SyntaxError|TypeError)\b/i.test(String(text || ""));
}

function looksLikeRawLog(path = "", category = "", text = "") {
  const normalizedPath = normalizePath(path).toLowerCase();
  const normalizedCategory = String(category || "").toLowerCase();
  if (normalizedPath.startsWith("memory/smart-add/")) return true;
  if (normalizedCategory === "raw_log") return true;
  return /\braw[_ -]?log\b|\bLOG_LINE\b|\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/i.test(String(text || ""));
}

function collectRiskFlags(candidate = {}, { agentScope = "unknown" } = {}) {
  const path = candidate.path || candidate.source?.path || "";
  const category = categoryFrom(candidate, path);
  const text = String(candidate.text || candidate.summary || candidate.card?.summary || "");
  const lifecycle = lifecycleFrom(candidate);
  const flags = new Set(Array.isArray(candidate.risk_flags) ? candidate.risk_flags : []);

  if (looksLikeRawLog(path, category, text)) flags.add("raw_log_like");
  if (looksLikeToolOutput(text)) flags.add("tool_output_like");
  if (normalizePath(path).toLowerCase().startsWith("memory/dreaming/") || category === "dreaming") flags.add("dreaming_artifact");
  if (lifecycle === "archived") flags.add("archived");
  if (lifecycle === "quarantined") flags.add("quarantined");
  if (lifecycle === "stale_index_candidate") flags.add("stale_index_candidate");
  if (Number(candidate.conflict_flag || 0) === 1 || candidate.conflict_flag === true) flags.add("conflict_flag");

  const score = confidenceScore(candidate);
  if (score !== null && score < 0.2) flags.add("low_confidence");

  const objectAgentScope = normalizeAgentScope(candidate.agent_scope || candidate.classification?.agent_scope);
  const runtimeAgentScope = normalizeAgentScope(agentScope);
  if (
    objectAgentScope !== "unknown" &&
    runtimeAgentScope !== "unknown" &&
    objectAgentScope !== "shared" &&
    objectAgentScope !== runtimeAgentScope
  ) {
    flags.add("cross_agent_scope");
  }

  const normalizedPath = normalizePath(path).toLowerCase();
  if (normalizedPath.startsWith("memory/daily/") || /^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(normalizedPath)) {
    flags.add("sensitive_source");
  }

  return [...flags].filter(flag => MEMORY_RISK_FLAGS.includes(flag)).sort();
}

function safeSummary(candidate = {}, riskFlags = []) {
  const text = extractSafeText(candidate);
  if (riskFlags.some(flag => RAW_CONTENT_RISK_FLAGS.has(flag))) {
    if (riskFlags.includes("dreaming_artifact")) return "Dreaming artifact content withheld; use maintenance review if needed.";
    if (riskFlags.includes("tool_output_like")) return "Tool or error-log-like content withheld from first-pass memory card.";
    if (riskFlags.includes("raw_log_like")) return "Raw-log-like content withheld from first-pass memory card.";
    return "Sensitive source content withheld from first-pass memory card.";
  }
  return truncate(text || "Memory item available for review.", 220);
}

function titleFrom(candidate = {}, category = "memory", kind = "fact", riskFlags = []) {
  const explicit = compactWhitespace(candidate.card?.title || candidate.title || "");
  if (explicit) return truncate(explicit, 80);
  if (riskFlags.includes("dreaming_artifact")) return "Withheld dreaming memory";
  if (riskFlags.includes("raw_log_like") || riskFlags.includes("tool_output_like")) return "Withheld operational memory";
  const text = extractSafeText(candidate);
  const firstLine = text.split(/\r?\n/u).map(line => line.trim()).find(Boolean);
  if (firstLine) return truncate(firstLine, 80);
  return truncate(`${category} ${kind}`.replace(/_/g, " "), 80);
}

function salienceReason(candidate = {}, category = "", riskFlags = []) {
  const explicit = compactWhitespace(candidate.card?.salience_reason || candidate.salience_reason || "");
  if (explicit) return truncate(explicit, 180);
  const sources = Array.isArray(candidate.sources) ? candidate.sources.join("+") : "retrieval";
  const risk = riskFlags.length ? ` with risk flags: ${riskFlags.join(", ")}` : "";
  return truncate(`Matched by ${sources || "retrieval"} in category ${category || "unknown"}${risk}.`, 180);
}

function resolveDisclosurePolicy(candidate = {}, riskFlags = [], lifecycleState = "active", contentAvailable = true) {
  const explicitLevel = String(candidate.disclosure_level || candidate.policy?.disclosure_level || "").trim();
  const hasBlockingRisk = riskFlags.some(flag => BLOCKING_RISK_FLAGS.has(flag));
  const active = lifecycleState === "active";
  const baseLevel = MEMORY_DISCLOSURE_LEVELS.includes(explicitLevel)
    ? explicitLevel
    : active && !hasBlockingRisk
      ? "memory_card"
      : "none";
  const disclosureLevel = hasBlockingRisk || !active ? "none" : baseLevel;
  const canInjectCard = disclosureLevel === "memory_card" || disclosureLevel === "short_summary";
  const canGetFullContent = contentAvailable && !hasBlockingRisk && !riskFlags.includes("quarantined") && lifecycleState !== "deleted_shadow";

  return {
    disclosure_level: disclosureLevel,
    can_inject_card: canInjectCard,
    can_get_full_content: canGetFullContent,
    can_reinforce_on_citation: disclosureLevel !== "none" && active && !hasBlockingRisk,
  };
}

export function normalizeCandidateToMemoryObject(candidate = {}, {
  agentScope = "unknown",
  traceId = null,
  retrievalRank = null,
  projectionVersion = MEMORY_OBJECT_SCHEMA_VERSION,
} = {}) {
  const path = candidate.path || candidate.source?.path || "";
  const normalizedPath = normalizePath(path);
  const lineRange = sourceLineRange(candidate);
  const category = categoryFrom(candidate, normalizedPath);
  const kind = kindFrom(candidate, category);
  const scope = scopeFrom(candidate, kind, category);
  const lifecycleState = lifecycleFrom(candidate);
  const objectAgentScope = normalizeAgentScope(candidate.agent_scope || candidate.classification?.agent_scope || agentScope);
  const riskFlags = collectRiskFlags(candidate, { agentScope });
  const id = memoryId(candidate);
  const text = String(candidate.text || "");
  const contentAvailable = Boolean(id || normalizedPath || text);
  const policy = resolveDisclosurePolicy(candidate, riskFlags, lifecycleState, contentAvailable);
  const score = confidenceScore(candidate);

  return {
    schema_version: projectionVersion,
    object_id: stableObjectId(candidate, projectionVersion),
    memory_id: id,
    source: {
      path: normalizedPath,
      line_start: lineRange.start,
      line_end: lineRange.end,
      source_type: sourceTypeFrom(candidate, normalizedPath),
      bucket: bucketFromPath(normalizedPath),
      created_at: candidate.created_at ?? candidate.source?.created_at ?? null,
      updated_at: candidate.updated_at ?? candidate.source?.updated_at ?? null,
    },
    classification: {
      category,
      kind,
      scope,
      agent_scope: objectAgentScope,
      lifecycle_state: lifecycleState,
    },
    content_ref: {
      mode: normalizedPath ? "source_span" : "memory_id",
      available: contentAvailable,
      content_hash: contentHash(text || id || normalizedPath),
      full_content_on_get: policy.can_get_full_content,
    },
    card: {
      title: titleFrom(candidate, category, kind, riskFlags),
      summary: safeSummary(candidate, riskFlags),
      salience_reason: salienceReason(candidate, category, riskFlags),
      evidence_hint: sourceHintFrom(normalizedPath, lineRange),
      risk_flags: riskFlags,
    },
    confidence: {
      score,
      signals: signalList(candidate),
      last_reinforced_at: candidate.last_reinforced_at ?? null,
    },
    policy,
    debug: {
      retrieval_rank: retrievalRank ?? candidate.retrieval_rank ?? null,
      retrieval_score: candidate.final_score ?? candidate.retrieval_score ?? null,
      trace_id: traceId ?? candidate.trace_id ?? null,
    },
  };
}

export function projectMemoryObjectToCard(memoryObject = {}) {
  const source = memoryObject.source || {};
  const classification = memoryObject.classification || {};
  const confidence = memoryObject.confidence || {};
  const policy = memoryObject.policy || {};
  const card = memoryObject.card || {};
  const memoryIdValue = String(memoryObject.memory_id || "").trim();

  return {
    schema_version: MEMORY_CARD_SCHEMA_VERSION,
    card_id: `memcard_${String(memoryObject.object_id || memoryIdValue || stableHash(JSON.stringify(memoryObject))).replace(/^memobj_/, "")}`,
    memory_id: memoryIdValue,
    title: truncate(card.title || "Memory card", 80),
    summary: truncate(card.summary || "Memory item available for review.", 240),
    salience_reason: truncate(card.salience_reason || "Matched by memory retrieval.", 180),
    source_hint: sourceHintFrom(source.path || "", {
      start: source.line_start,
      end: source.line_end,
    }),
    category: classification.category || "unknown",
    kind: classification.kind || "fact",
    confidence_score: Number.isFinite(Number(confidence.score)) ? Number(confidence.score) : null,
    risk_flags: Array.isArray(card.risk_flags) ? [...card.risk_flags] : [],
    disclosure_level: policy.disclosure_level || "none",
    get_token: memoryIdValue && policy.can_get_full_content
      ? `memory_engine_get:${memoryIdValue}`
      : null,
  };
}

export function projectCandidateToMemoryCard(candidate = {}, options = {}) {
  const memoryObject = normalizeCandidateToMemoryObject(candidate, options);
  return {
    memory_object: memoryObject,
    memory_card: projectMemoryObjectToCard(memoryObject),
    side_effects: {
      db_writes: false,
      memory_file_mutation: false,
      dataset_file_mutation: false,
      retrieval: false,
      injection: false,
      cleanup_apply: false,
      archive: false,
      quarantine: false,
      reinforce: false,
      llm: false,
      network: false,
      runtime_report_files: false,
    },
  };
}

export function isInjectableMemoryCard(card = {}) {
  return Boolean(
    card &&
    card.disclosure_level &&
    ["memory_card", "short_summary"].includes(card.disclosure_level) &&
    !card.risk_flags?.some(flag => BLOCKING_RISK_FLAGS.has(flag))
  );
}
