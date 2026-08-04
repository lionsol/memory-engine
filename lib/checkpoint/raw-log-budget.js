const {
  inferRoleKey,
  isTaggedSmartAdd,
} = require("./raw-log-normalization");

const ENTRY_SEPARATOR = "\n---\n";
const DEFAULT_BUDGETS = {
  maxFinalCombinedChars: 40000,
  smartAddChars: 16000,
  conversationChars: 24000,
  perSessionChars: 8000,
  toolSummaryChars: 4000,
};

function clampPositiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function getBudgetConfig(options = {}) {
  const overrides = options.budgets || {};
  return {
    maxFinalCombinedChars: clampPositiveNumber(
      overrides.maxFinalCombinedChars || process.env.MEMORY_ENGINE_CHECKPOINT_MAX_FINAL_CHARS,
      DEFAULT_BUDGETS.maxFinalCombinedChars,
    ),
    smartAddChars: clampPositiveNumber(
      overrides.smartAddChars || process.env.MEMORY_ENGINE_CHECKPOINT_SMARTADD_CHARS,
      DEFAULT_BUDGETS.smartAddChars,
    ),
    conversationChars: clampPositiveNumber(
      overrides.conversationChars || process.env.MEMORY_ENGINE_CHECKPOINT_CONVERSATION_CHARS,
      DEFAULT_BUDGETS.conversationChars,
    ),
    perSessionChars: clampPositiveNumber(
      overrides.perSessionChars || process.env.MEMORY_ENGINE_CHECKPOINT_PER_SESSION_CHARS,
      DEFAULT_BUDGETS.perSessionChars,
    ),
    toolSummaryChars: clampPositiveNumber(
      overrides.toolSummaryChars || process.env.MEMORY_ENGINE_CHECKPOINT_TOOL_SUMMARY_CHARS,
      DEFAULT_BUDGETS.toolSummaryChars,
    ),
  };
}

function getEntryCharCost(text, selectedCount) {
  return String(text || "").length + (selectedCount > 0 ? ENTRY_SEPARATOR.length : 0);
}

function getSourceBudgetKey(entry) {
  return entry && entry.sourceKind === "smartAdd" ? "smartAddChars" : "conversationChars";
}

function getSourceStatsKey(entry) {
  return entry?.sourceKind || "dbRawLog";
}

function getEntryPriority(entry) {
  if (isTaggedSmartAdd(entry)) return 500;
  if (entry?.role === "user") return 400;
  if (entry?.isAssistantSummary) return 300;
  if (entry?.isToolSummary) return 200;
  if (entry?.role === "assistant") return 100;
  return 50;
}

function truncateTextToFit(text, maxChars) {
  const normalized = String(text || "").trim();
  if (normalized.length <= maxChars) return normalized;
  if (maxChars <= 1) return "";
  if (maxChars <= 3) return normalized.slice(0, maxChars);
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

function calculateCombinedTextLength(entries) {
  return (entries || [])
    .filter((entry) => entry && entry.text && entry.text.trim())
    .map((entry) => entry.text.trim())
    .join(ENTRY_SEPARATOR)
    .length;
}

function applyBudgetToEntries(entries, stats, budgetConfig) {
  const selected = [];
  const sourceUsage = {
    smartAddChars: 0,
    conversationChars: 0,
    toolSummaryChars: 0,
  };
  const sessionUsage = new Map();
  const ranked = [...entries].sort((left, right) => {
    const priorityDiff = getEntryPriority(right) - getEntryPriority(left);
    if (priorityDiff !== 0) return priorityDiff;
    if (left.timestampMs !== null && right.timestampMs !== null && left.timestampMs !== right.timestampMs) {
      return left.timestampMs - right.timestampMs;
    }
    if (left.timestampMs !== null && right.timestampMs === null) return -1;
    if (left.timestampMs === null && right.timestampMs !== null) return 1;
    return left._index - right._index;
  });

  for (const entry of ranked) {
    const sourceBudgetKey = getSourceBudgetKey(entry);
    const sourceLimit = budgetConfig[sourceBudgetKey];
    const currentSourceUsage = sourceUsage[sourceBudgetKey];
    const currentToolSummaryUsage = entry.isToolSummary ? sourceUsage.toolSummaryChars : 0;
    const currentSessionUsage = entry.sessionId ? (sessionUsage.get(entry.sessionId) || 0) : 0;
    const remainingFinal = budgetConfig.maxFinalCombinedChars - calculateCombinedTextLength(selected);
    const remainingSource = sourceLimit - currentSourceUsage;
    const remainingToolSummary = entry.isToolSummary
      ? (budgetConfig.toolSummaryChars - currentToolSummaryUsage)
      : Number.POSITIVE_INFINITY;
    const remainingSession = entry.sessionId ? (budgetConfig.perSessionChars - currentSessionUsage) : Number.POSITIVE_INFINITY;
    const maxAllowed = Math.min(remainingFinal, remainingSource, remainingToolSummary, remainingSession);
    if (maxAllowed <= 0) {
      stats.droppedByBudgetCount += 1;
      stats.budgetApplied = true;
      continue;
    }

    const separatorCost = selected.length > 0 ? ENTRY_SEPARATOR.length : 0;
    const textLimit = maxAllowed - separatorCost;
    if (textLimit <= 0) {
      stats.droppedByBudgetCount += 1;
      stats.budgetApplied = true;
      continue;
    }

    const finalText = truncateTextToFit(entry.text, textLimit);
    if (!finalText) {
      stats.droppedByBudgetCount += 1;
      stats.budgetApplied = true;
      continue;
    }

    const charCost = getEntryCharCost(finalText, selected.length);
    if (finalText.length < String(entry.text || "").length) {
      stats.budgetApplied = true;
    }
    if (charCost > remainingFinal || charCost > remainingSource || charCost > remainingToolSummary || charCost > remainingSession) {
      stats.droppedByBudgetCount += 1;
      stats.budgetApplied = true;
      continue;
    }

    selected.push({
      ...entry,
      text: finalText,
    });
    sourceUsage[sourceBudgetKey] += charCost;
    if (entry.isToolSummary) sourceUsage.toolSummaryChars += charCost;
    if (entry.sessionId) {
      sessionUsage.set(entry.sessionId, currentSessionUsage + charCost);
    }
  }

  return selected.sort((left, right) => {
    if (left.timestampMs !== null && right.timestampMs !== null && left.timestampMs !== right.timestampMs) {
      return left.timestampMs - right.timestampMs;
    }
    if (left.timestampMs !== null && right.timestampMs === null) return -1;
    if (left.timestampMs === null && right.timestampMs !== null) return 1;
    return left._index - right._index;
  });
}

function summarizeBudgetedEntries(entries, stats) {
  for (const entry of entries) {
    const sourceKey = getSourceStatsKey(entry);
    const roleKey = inferRoleKey(entry);
    if (stats.sourceCharCountsAfter[sourceKey] !== undefined) {
      stats.sourceCharCountsAfter[sourceKey] += String(entry.text || "").length;
    }
    if (stats.charsBySourceAfterBudget[sourceKey] !== undefined) {
      stats.charsBySourceAfterBudget[sourceKey] += String(entry.text || "").length;
    }
    if (stats.charsByRoleAfterBudget[roleKey] !== undefined) {
      stats.charsByRoleAfterBudget[roleKey] += String(entry.text || "").length;
    } else {
      stats.charsByRoleAfterBudget.metadata_header += String(entry.text || "").length;
    }
  }
}

module.exports = {
  ENTRY_SEPARATOR,
  DEFAULT_BUDGETS,
  getBudgetConfig,
  applyBudgetToEntries,
  calculateCombinedTextLength,
  summarizeBudgetedEntries,
  truncateTextToFit,
};
