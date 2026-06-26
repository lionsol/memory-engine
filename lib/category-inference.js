const EXTERNAL_CATEGORY = "external";

function normalizeCategoryPath(path = "") {
  return String(path || "").replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();
}

export function extractCategoryFromText(text = "") {
  const match = String(text || "").match(/(?:^|\n)Category:\s*([a-z_]+)/i);
  return match?.[1] ? String(match[1]).toLowerCase() : "";
}

export function inferCategoryFromPath(path = "", { fallback = EXTERNAL_CATEGORY } = {}) {
  const normalized = normalizeCategoryPath(path);
  if (!normalized) return fallback;
  if (normalized === "memory.md") return "core_profile";
  if (normalized.startsWith("memory/projects/")) return "project";
  if (/^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(normalized)) return "daily_journal";
  if (normalized.startsWith("memory/dreaming/")) return "dreaming";
  if (normalized === "memory/stats-history.md") return "stats";
  if (normalized.startsWith("memory/episodes/")) return "episodic";
  if (normalized.startsWith("memory/generated-smart-add/")) return "generated";
  if (normalized.startsWith("memory/smart-add/")) return "raw_log";
  return fallback;
}

export function inferCategoryFromChunk(path = "", text = "", {
  fallback = EXTERNAL_CATEGORY,
  allowCategory = null,
  externalCategory = EXTERNAL_CATEGORY,
} = {}) {
  const fromText = extractCategoryFromText(text);
  if (fromText && (!allowCategory || allowCategory(fromText))) return fromText;
  const fromPath = inferCategoryFromPath(path, { fallback: externalCategory });
  if (fromPath !== externalCategory) return fromPath;
  return fallback;
}
