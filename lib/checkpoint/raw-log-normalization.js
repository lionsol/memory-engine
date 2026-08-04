function normalizeWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function buildDedupeKey(category, text) {
  return `${String(category || "raw_log").toLowerCase()}|${normalizeWhitespace(text).toLowerCase()}`;
}

function buildDialogueDedupeKey(role, body) {
  return `${String(role || "message").toLowerCase()}|${normalizeWhitespace(body).toLowerCase()}`;
}

function stripOptionalMetadataHeader(text) {
  return String(text || "").replace(/^\s*\[[^\]]+\]\s*/, "").trim();
}

function parseDialogueRoleBody(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const normalized = stripOptionalMetadataHeader(raw);
  const match = normalized.match(/^\*\*(User|Assistant):\*\*\s*([\s\S]+)$/i);
  if (!match) return null;
  return {
    role: String(match[1]).toLowerCase(),
    body: String(match[2] || "").trim(),
  };
}

function inferRoleKey(entry) {
  if (entry.sourceKind === "smartAdd") return "note";
  if (entry.role === "user") return "user";
  if (entry.role === "assistant" && entry.isAssistantSummary) return "assistant_summary";
  if (entry.role === "assistant" && entry.isToolSummary) return "assistant_tool_summary";
  if (entry.role === "assistant") return "assistant";
  return "metadata_header";
}

function isTaggedSmartAdd(entry) {
  if (!entry || entry.sourceKind !== "smartAdd") return false;
  if (["preference", "user_identity"].includes(String(entry.category || "").toLowerCase())) return true;
  return /\b(decision|decided|lesson|learned|todo|follow-up|next step|preference|resolved)\b|决定|结论|教训|经验|待办|偏好|总结/i
    .test(String(entry.text || ""));
}

function isCompactToolSummary(text) {
  const normalized = normalizeWhitespace(text);
  return normalized.length <= 400 && /\b(tool summary|command summary|result summary)\b/i.test(normalized);
}

function scoreAssistantSummary(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return false;
  if (normalized.length > 1200) return false;
  return /\b(summary|in short|root cause|resolved|fix|caused by|final|conclusion)\b|总结|结论|原因|修复|已解决/i.test(normalized);
}

function contentToText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item && item.type === "text" && typeof item.text === "string" && item.text.trim())
    .map((item) => item.text.trim())
    .join(" ")
    .trim();
}

function rankLogEntry(entry) {
  let score = 0;
  if (entry.sourceKind === "resetTranscript") score += 20;
  if (entry.sourceKind === "dbRawLog") score += 10;
  if (entry.timestampMs !== null) score += 2;
  if (entry.sessionId) score += 1;
  return score;
}

module.exports = {
  normalizeWhitespace,
  buildDedupeKey,
  buildDialogueDedupeKey,
  stripOptionalMetadataHeader,
  parseDialogueRoleBody,
  inferRoleKey,
  isTaggedSmartAdd,
  isCompactToolSummary,
  scoreAssistantSummary,
  contentToText,
  rankLogEntry,
};
