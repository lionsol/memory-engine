import { collectQualityCandidates } from "./collect-quality-candidates.js";
import { classifyQualityScope } from "./quality-scope.js";
import { writeAuditReport } from "./chunks-without-confidence-audit.js";

function compareStrings(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function incrementCount(map, key) {
  const name = String(key ?? "unknown");
  map[name] = (map[name] || 0) + 1;
}

function safePreview(text, maxLength = 160) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}

function toBoolean(value) {
  return Boolean(value);
}

function resolveSuggestedAction(candidate) {
  if (Number(candidate?.injected_count || 0) > 0) {
    return "manual_review_required";
  }
  if (Number(candidate?.retrieved_count || 0) > 0) {
    return "manual_review_required";
  }
  if (toBoolean(candidate?.has_confidence_record)) {
    return "manual_review_required";
  }
  return "safe_to_review_for_stale_index_or_legacy_file";
}

function resolveUnknownReason(candidate, scope) {
  const reasons = [];
  if (String(candidate?.quality_scope_owner || scope.owner) === "unknown") {
    reasons.push("unknown ownership");
  }
  if (String(candidate?.quality_scope_family || scope.family) === "unknown") {
    reasons.push("unknown quality scope family");
  }
  if (String(candidate?.path_family || "") === "unknown") {
    reasons.push("unknown path family");
  }
  if (reasons.length === 0) {
    reasons.push("unknown memory path classification");
  }
  return `${reasons.join("; ")}; audit only, no automatic cleanup`;
}

function normalizeUnknownItem(candidate) {
  const scope = classifyQualityScope(candidate?.path);
  const qualityScopeOwner = candidate?.quality_scope_owner ?? scope.owner;
  const qualityScopeFamily = candidate?.quality_scope_family ?? scope.family;
  const pathFamily = candidate?.path_family ?? "unknown";
  const expectedConfidence = candidate?.expected_confidence ?? scope.expected_confidence;
  const hasConfidenceRecord = toBoolean(candidate?.has_confidence_record);
  const suggestedAction = resolveSuggestedAction(candidate);

  return {
    id: String(candidate?.id || ""),
    path: String(candidate?.path || ""),
    path_family: pathFamily,
    quality_scope_owner: qualityScopeOwner,
    quality_scope_family: qualityScopeFamily,
    expected_confidence: expectedConfidence,
    has_confidence_record: hasConfidenceRecord,
    category: candidate?.category ?? null,
    retrieved_count: Number(candidate?.retrieved_count || 0),
    injected_count: Number(candidate?.injected_count || 0),
    last_retrieved_at: candidate?.last_retrieved_at ?? null,
    last_injected_at: candidate?.last_injected_at ?? null,
    text_preview: safePreview(candidate?.text),
    suggested_action: suggestedAction,
    reason: resolveUnknownReason(candidate, scope),
  };
}

function isUnknownCandidate(candidate) {
  const scope = classifyQualityScope(candidate?.path);
  const qualityScopeOwner = String(candidate?.quality_scope_owner ?? scope.owner);
  const qualityScopeFamily = String(candidate?.quality_scope_family ?? scope.family);
  const pathFamily = String(candidate?.path_family ?? "");
  return qualityScopeOwner === "unknown"
    || qualityScopeFamily === "unknown"
    || pathFamily === "unknown";
}

function sortItems(items) {
  return items.slice().sort((a, b) => (
    Number(b.injected_count || 0) - Number(a.injected_count || 0)
    || Number(b.retrieved_count || 0) - Number(a.retrieved_count || 0)
    || Number(b.has_confidence_record || 0) - Number(a.has_confidence_record || 0)
    || compareStrings(a.path, b.path)
    || compareStrings(a.id, b.id)
  ));
}

function toSortedObject(map) {
  return Object.fromEntries(
    Object.entries(map).sort((a, b) => (
      Number(b[1] || 0) - Number(a[1] || 0)
      || compareStrings(a[0], b[0])
    )),
  );
}

export function buildUnknownMemoryPathAudit({
  generatedAt = new Date().toISOString(),
  includeArchived = false,
  sampleLimit = 20,
  candidateSource = null,
} = {}) {
  const collected = candidateSource || collectQualityCandidates({
    scope: "all",
    includeArchived,
    includeStatsHistory: false,
  });
  const candidates = Array.isArray(collected?.candidates) ? collected.candidates : [];
  const unknownItems = sortItems(candidates.filter(isUnknownCandidate).map(normalizeUnknownItem));

  const pathDistribution = {};
  const suggestedActionDistribution = {};
  let injectedCount = 0;
  let retrievedCount = 0;
  let withConfidenceCount = 0;
  let withoutConfidenceCount = 0;

  for (const item of unknownItems) {
    incrementCount(pathDistribution, item.path);
    incrementCount(suggestedActionDistribution, item.suggested_action);
    injectedCount += item.injected_count;
    retrievedCount += item.retrieved_count;
    if (item.has_confidence_record) withConfidenceCount += 1;
    else withoutConfidenceCount += 1;
  }

  return {
    mode: "readonly",
    generated_at: generatedAt,
    include_archived: Boolean(includeArchived),
    sample_limit: sampleLimit,
    summary: {
      unknown_count: unknownItems.length,
      injected_count: injectedCount,
      retrieved_count: retrievedCount,
      with_confidence_count: withConfidenceCount,
      without_confidence_count: withoutConfidenceCount,
      path_distribution: toSortedObject(pathDistribution),
      suggested_action_distribution: toSortedObject(suggestedActionDistribution),
    },
    items: unknownItems.slice(0, Math.max(1, Number(sampleLimit) || 20)),
    side_effects: {
      db_writes: false,
      memory_file_mutation: false,
      config_mutation: false,
      archive: false,
      quarantine: false,
      reinforce: false,
      confidence_backfill: false,
      llm: false,
      network: false,
    },
  };
}

export function renderUnknownMemoryPathMarkdown(report) {
  const actionLines = Object.entries(report?.summary?.suggested_action_distribution || {})
    .map(([key, count]) => `- ${key}: ${count}`)
    .join("\n") || "- none";
  const itemLines = (report?.items || [])
    .map(item => [
      `- path: ${item.path}`,
      `  id: ${item.id}`,
      `  path_family: ${item.path_family}`,
      `  quality_scope_owner: ${item.quality_scope_owner}`,
      `  quality_scope_family: ${item.quality_scope_family}`,
      `  has_confidence_record: ${item.has_confidence_record}`,
      `  category: ${item.category ?? "null"}`,
      `  retrieved_count: ${item.retrieved_count}`,
      `  injected_count: ${item.injected_count}`,
      `  suggested_action: ${item.suggested_action}`,
      `  reason: ${item.reason}`,
      `  text_preview: ${item.text_preview || "(empty)"}`,
    ].join("\n"))
    .join("\n") || "- none";

  return `# Unknown Memory Path Audit

## Status / Summary

- mode: ${report.mode}
- generated_at: ${report.generated_at}
- include_archived: ${report.include_archived}
- sample_limit: ${report.sample_limit}
- unknown_count: ${report.summary.unknown_count}
- injected_count: ${report.summary.injected_count}
- retrieved_count: ${report.summary.retrieved_count}
- with_confidence_count: ${report.summary.with_confidence_count}
- without_confidence_count: ${report.summary.without_confidence_count}
- audit_only: true
- cleanup: none

## Action Distribution

${actionLines}

## Items

${itemLines}

## Side Effects

- db_writes: ${report.side_effects.db_writes}
- memory_file_mutation: ${report.side_effects.memory_file_mutation}
- config_mutation: ${report.side_effects.config_mutation}
- archive: ${report.side_effects.archive}
- quarantine: ${report.side_effects.quarantine}
- reinforce: ${report.side_effects.reinforce}
- confidence_backfill: ${report.side_effects.confidence_backfill}
- llm: ${report.side_effects.llm}
- network: ${report.side_effects.network}
`;
}

export function runUnknownMemoryPathAudit(options = {}) {
  return buildUnknownMemoryPathAudit({
    generatedAt: options.generatedAt || new Date().toISOString(),
    includeArchived: options.includeArchived,
    sampleLimit: options.sampleLimit,
    candidateSource: options.candidateSource || null,
  });
}

export {
  writeAuditReport,
};
