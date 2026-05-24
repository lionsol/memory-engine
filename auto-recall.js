const MEMORY_TRIGGER_RE = /\b(remember|recall|memory|memories|previous|last time|said before|preference|preferences|habit|habits)\b|[\u8bb0\u5fc6]|\u8bb0\u5f97|\u4e4b\u524d|\u4e0a\u6b21|\u6211\u8bf4\u8fc7|\u4f60\u8fd8\u8bb0\u5f97|\u56de\u5fc6|\u504f\u597d|\u4e60\u60ef/i;

const GREETING_RE = /^(hi|hello|hey|yo|good morning|good evening|\u4f60\u597d|\u55e8|\u65e9|\u65e9\u4e0a\u597d|\u665a\u5b89)[.!?\s]*$/i;
const ACK_RE = /^(ok|okay|k|yes|yep|yeah|sure|thanks|thank you|got it|continue|go on|\u597d|\u597d\u7684|\u53ef\u4ee5|\u55ef|\u884c|\u6536\u5230|\u7ee7\u7eed)[.!?\s]*$/i;

function normalizePrompt(prompt) {
  return String(prompt || "").trim();
}

export function shouldForceAutoRecall(prompt) {
  const text = normalizePrompt(prompt);
  if (!text || text.startsWith("/")) return false;
  return MEMORY_TRIGGER_RE.test(text);
}

export function shouldSkipAutoRecall(prompt) {
  const text = normalizePrompt(prompt);
  if (!text) return true;
  if (text.startsWith("/")) return true;
  if (shouldForceAutoRecall(text)) return false;
  if (GREETING_RE.test(text)) return true;
  if (ACK_RE.test(text)) return true;

  const compact = text.replace(/\s+/g, "");
  const words = text.split(/\s+/).filter(Boolean);
  if (compact.length <= 3) return true;
  if (compact.length <= 8 && words.length <= 2) return true;
  return false;
}

function trimMemoryText(text, maxLength = 240) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}...`;
}

export function formatAutoRecallContext(results, options = {}) {
  const topK = Math.max(1, Number(options.topK || 3));
  const items = Array.isArray(results) ? results.slice(0, topK) : [];
  if (items.length === 0) return "";

  const lines = [
    "## Auto Recall - relevant memory",
    "",
    "The following memories may help answer this turn. Use only if relevant. If you rely on any item, cite it with memory_engine action=\"cite\".",
    "",
  ];

  items.forEach((item, index) => {
    const id = String(item.id || "").slice(0, 16);
    const category = item.category || "raw_log";
    const confidence = item.confidence ?? item.confidence_realtime ?? "n/a";
    const sources = Array.isArray(item.sources) ? item.sources.join(",") : (item.sources || "unknown");
    lines.push(`${index + 1}. [${id}] category=${category} confidence=${confidence} sources=${sources}`);
    const memoryText = trimMemoryText(item.text);
    if (memoryText) lines.push(`   ${memoryText}`);
  });

  return lines.join("\n");
}