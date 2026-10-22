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
  return entry?.source === "conversation" || entry?.sourceKind !== "smartAdd"
    ? "conversationChars"
    : "smartAddChars";
}

function getSourceStatsKey(entry) {
  return entry?.sourceKind || "dbRawLog";
}

function getEntryPriority(entry) {
  if (entry?.source === "conversation" && entry?.provenance === "session_flush") return 400;
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

function recordBudgetUncovered(stats, entry, { coverage, reason, includedChars = 0, sessionOnly = false } = {}) {
  if (!Array.isArray(stats.budgetUncoveredEntries)) stats.budgetUncoveredEntries = [];
  stats.budgetCoverageComplete = false;
  stats.budgetUncoveredEntries.push({
    entry_id: entry?.entryId || null,
    chunk_id: entry?.chunk_id || null,
    session_id: entry?.sessionId || null,
    source: entry?.source || null,
    source_kind: entry?.sourceKind || null,
    provenance: entry?.provenance || null,
    input_index: Number.isInteger(entry?._index) ? entry._index : null,
    coverage,
    reason,
    original_chars: String(entry?.text || "").length,
    included_chars: includedChars,
    session_only: sessionOnly,
  });
}

function applyBudgetToEntries(entries, stats, budgetConfig) {
  if (!Array.isArray(stats.budgetUncoveredEntries)) stats.budgetUncoveredEntries = [];
  if (!Number.isFinite(Number(stats.budgetTruncatedCount))) stats.budgetTruncatedCount = 0;
  if (stats.budgetCoverageComplete === undefined) stats.budgetCoverageComplete = true;
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
      const exhausted = [];
      if (remainingFinal <= 0) exhausted.push("combined_budget_exhausted");
      if (remainingSource <= 0) exhausted.push("source_budget_exhausted");
      if (remainingToolSummary <= 0) exhausted.push("tool_summary_budget_exhausted");
      if (remainingSession <= 0) exhausted.push("session_budget_exhausted");
      recordBudgetUncovered(stats, entry, { coverage: "excluded", reason: exhausted.join("+") || "entry_exceeds_budget" });
      continue;
    }

    const separatorCost = selected.length > 0 ? ENTRY_SEPARATOR.length : 0;
    const textLimit = maxAllowed - separatorCost;
    if (textLimit <= 0) {
      stats.droppedByBudgetCount += 1;
      stats.budgetApplied = true;
      recordBudgetUncovered(stats, entry, { coverage: "excluded", reason: "separator_exceeds_remaining_budget" });
      continue;
    }

    const finalText = truncateTextToFit(entry.text, textLimit);
    if (!finalText) {
      stats.droppedByBudgetCount += 1;
      stats.budgetApplied = true;
      recordBudgetUncovered(stats, entry, { coverage: "excluded", reason: "no_text_fits_remaining_budget" });
      continue;
    }

    const charCost = getEntryCharCost(finalText, selected.length);
    if (finalText.length < String(entry.text || "").length) {
      stats.budgetApplied = true;
    }
    if (charCost > remainingFinal || charCost > remainingSource || charCost > remainingToolSummary || charCost > remainingSession) {
      stats.droppedByBudgetCount += 1;
      stats.budgetApplied = true;
      recordBudgetUncovered(stats, entry, { coverage: "excluded", reason: "final_text_exceeds_remaining_budget" });
      continue;
    }

    if (finalText.length < String(entry.text || "").length) {
      stats.budgetTruncatedCount += 1;
      recordBudgetUncovered(stats, entry, {
        coverage: "truncated",
        reason: "entry_text_truncated_to_budget",
        includedChars: finalText.length,
        sessionOnly: currentSessionUsage === 0
          && remainingSession === maxAllowed
          && getEntryCharCost(entry.text, selected.length) <= Math.min(remainingFinal, remainingSource, remainingToolSummary),
      });
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
