import { classifyQualityScope, getQualityScopeFamily } from "./quality-scope.js";

export function getPathFamily(path) {
  const family = getQualityScopeFamily(path);
  switch (family) {
    case "smart_add": return "smart-add";
    case "dreaming": return "dreaming";
    case "episode": return "episodes";
    case "project": return "projects";
    case "daily_memory": return "daily-root";
    case "curated_memory": return "memory-root";
    case "stats_history": return "stats-history";
    case "raw_log": return "memory-other";
    case "unknown": return "memory-other";
    default: return "non-memory";
  }
}

export function isDefaultIncludedPathFamily(pathFamily) {
  switch (String(pathFamily || "")) {
    case "smart-add":
    case "episodes":
      return true;
    default:
      return false;
  }
}

export function isActiveMemoryPath(path) {
  return Boolean(classifyQualityScope(path).default_quality_score_scope);
}
