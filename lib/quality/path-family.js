import { toPosixPath } from "../path-utils.js";

const DEFAULT_INCLUDED_PATH_FAMILIES = new Set([
  "smart-add",
  "dreaming",
  "episodes",
  "projects",
  "daily-root",
  "memory-root",
  "memory-other",
]);

function normalizePath(value) {
  const normalized = toPosixPath(String(value ?? "")).replace(/^\.\/+/, "");
  return normalized.replace(/^\/+/, "");
}

export function getPathFamily(path) {
  const normalizedPath = normalizePath(path);

  if (normalizedPath === "MEMORY.md") return "memory-root";
  if (normalizedPath === "memory/stats-history.md") return "stats-history";
  if (normalizedPath.startsWith("memory/smart-add/")) return "smart-add";
  if (normalizedPath.startsWith("memory/dreaming/")) return "dreaming";
  if (normalizedPath.startsWith("memory/episodes/")) return "episodes";
  if (normalizedPath.startsWith("memory/projects/")) return "projects";
  if (/^memory\/\d{4}-\d{2}-\d{2}[^/]*\.md$/.test(normalizedPath)) return "daily-root";
  if (normalizedPath.startsWith("memory/")) return "memory-other";
  return "non-memory";
}

export function isDefaultIncludedPathFamily(pathFamily) {
  return DEFAULT_INCLUDED_PATH_FAMILIES.has(pathFamily);
}

export function isActiveMemoryPath(path) {
  return isDefaultIncludedPathFamily(getPathFamily(path));
}
