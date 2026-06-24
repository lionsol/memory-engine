import { toPosixPath } from "../path-utils.js";

function normalizePath(value) {
  const normalized = toPosixPath(String(value ?? "")).replace(/^\.\/+/, "");
  return normalized.replace(/^\/+/, "");
}

export function getQualityScopeFamily(path) {
  const normalizedPath = normalizePath(path);

  if (normalizedPath === "MEMORY.md") return "curated_memory";
  if (normalizedPath === "memory/stats-history.md") return "stats_history";
  if (normalizedPath.startsWith("memory/legacy-daily-mirrors/")) return "quarantined_daily_mirror";
  if (normalizedPath.startsWith("memory/smart-add/")) return "smart_add";
  if (normalizedPath.startsWith("memory/dreaming/")) return "dreaming";
  if (normalizedPath.startsWith("memory/episodes/")) return "episode";
  if (normalizedPath.startsWith("memory/projects/")) return "project";
  if (normalizedPath.startsWith("memory/raw_log/")) return "raw_log";
  if (/^memory\/\d{4}-\d{2}-\d{2}[^/]*\.md$/.test(normalizedPath)) return "daily_memory";
  if (normalizedPath.startsWith("memory/")) return "unknown";
  return "non_memory";
}

function baseScope({
  family,
  owner,
  expected_confidence,
  default_quality_score_scope,
  diagnostic_scope,
  retrieval_visible,
  reason,
}) {
  return {
    family,
    owner,
    expected_confidence,
    default_quality_score_scope,
    diagnostic_scope,
    retrieval_visible,
    reason,
  };
}

export function classifyQualityScope(path) {
  const family = getQualityScopeFamily(path);

  switch (family) {
    case "smart_add":
      return baseScope({
        family,
        owner: "memory_engine_lifecycle",
        expected_confidence: true,
        default_quality_score_scope: true,
        diagnostic_scope: true,
        retrieval_visible: true,
        reason: "smart-add chunks are lifecycle-owned by memory-engine and should carry confidence metadata",
      });
    case "episode":
      return baseScope({
        family,
        owner: "memory_engine_lifecycle",
        expected_confidence: true,
        default_quality_score_scope: true,
        diagnostic_scope: true,
        retrieval_visible: true,
        reason: "episode chunks are lifecycle-owned by memory-engine and should carry confidence metadata",
      });
    case "dreaming":
      return baseScope({
        family,
        owner: "memory_engine_generated_or_diagnostic",
        expected_confidence: false,
        default_quality_score_scope: false,
        diagnostic_scope: true,
        retrieval_visible: false,
        reason: "dreaming output is generated or diagnostic memory, not part of the current confidence lifecycle",
      });
    case "quarantined_daily_mirror":
      return baseScope({
        family,
        owner: "memory_engine_generated_or_diagnostic",
        expected_confidence: false,
        default_quality_score_scope: false,
        diagnostic_scope: false,
        retrieval_visible: false,
        reason: "quarantined legacy daily mirrors are retired checkpoint artifacts and must stay outside recall and quality candidate pipelines",
      });
    case "curated_memory":
      return baseScope({
        family,
        owner: "openclaw_core",
        expected_confidence: false,
        default_quality_score_scope: false,
        diagnostic_scope: true,
        retrieval_visible: true,
        reason: "MEMORY.md is core-owned memory that may be retrieval-visible without memory-engine confidence ownership",
      });
    case "daily_memory":
      return baseScope({
        family,
        owner: "openclaw_core",
        expected_confidence: false,
        default_quality_score_scope: false,
        diagnostic_scope: true,
        retrieval_visible: true,
        reason: "daily memory files are core-owned memory that may be retrieval-visible without memory-engine confidence ownership",
      });
    case "project":
      return baseScope({
        family,
        owner: "memory_engine_legacy_or_manual",
        expected_confidence: false,
        default_quality_score_scope: false,
        diagnostic_scope: true,
        retrieval_visible: true,
        reason: "project memory files look legacy or manual relative to the current confidence lifecycle",
      });
    case "raw_log":
      return baseScope({
        family,
        owner: "raw_or_legacy",
        expected_confidence: false,
        default_quality_score_scope: false,
        diagnostic_scope: true,
        retrieval_visible: false,
        reason: "raw-log artifacts are not currently confidence-owned by memory-engine lifecycle",
      });
    case "stats_history":
      return baseScope({
        family,
        owner: "memory_engine_generated_or_diagnostic",
        expected_confidence: false,
        default_quality_score_scope: false,
        diagnostic_scope: true,
        retrieval_visible: false,
        reason: "stats-history is diagnostic output and should stay outside default quality scoring",
      });
    case "unknown":
      return baseScope({
        family,
        owner: "unknown",
        expected_confidence: true,
        default_quality_score_scope: true,
        diagnostic_scope: true,
        retrieval_visible: true,
        reason: "unknown memory paths are suspicious and should stay in default quality scope until classified explicitly",
      });
    default:
      return baseScope({
        family,
        owner: "unknown",
        expected_confidence: false,
        default_quality_score_scope: false,
        diagnostic_scope: false,
        retrieval_visible: false,
        reason: "non-memory paths are outside memory quality scope",
      });
  }
}

export function isDefaultQualityScoreScope(pathOrScope) {
  const scope = typeof pathOrScope === "string"
    ? classifyQualityScope(pathOrScope)
    : pathOrScope;
  return Boolean(scope?.default_quality_score_scope);
}

export function isLifecycleOwnedQualityScope(pathOrScope) {
  const scope = typeof pathOrScope === "string"
    ? classifyQualityScope(pathOrScope)
    : pathOrScope;
  return scope?.owner === "memory_engine_lifecycle";
}
