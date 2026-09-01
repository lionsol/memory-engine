import { resolveAuthorizedMemoryIds } from "./cite-authority.js";

function uniqueShortIds(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const shortId = String(value || "").slice(0, 16).trim();
    if (!shortId || seen.has(shortId)) continue;
    seen.add(shortId);
    result.push(shortId);
  }
  return result;
}

function uniqueExactIds(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    if (typeof value !== "string") continue;
    const exactId = value.trim();
    if (!exactId || seen.has(exactId)) continue;
    seen.add(exactId);
    result.push(exactId);
  }
  return result;
}

export function buildReinforcementAllowedIds({
  traceState = null,
  currentTurnMemoryEngineGetIds = [],
  currentTurnMemoryEngineGetExactIds = null,
} = {}) {
  const autoRecallReinforcementAllowedExactIds = uniqueExactIds(
    traceState?.reinforcementAllowedExactIds ?? traceState?.reinforcementAllowedIds ?? [],
  );
  const currentTurnGetExactIds = uniqueExactIds(
    currentTurnMemoryEngineGetExactIds ?? currentTurnMemoryEngineGetIds,
  );
  const autoRecallReinforcementAllowedIds = uniqueShortIds(
    traceState?.reinforcementAllowedIds || autoRecallReinforcementAllowedExactIds,
  );
  const currentTurnGetIds = uniqueShortIds(
    currentTurnMemoryEngineGetIds.length > 0 ? currentTurnMemoryEngineGetIds : currentTurnGetExactIds,
  );
  const reinforcementAllowedIds = uniqueShortIds([
    ...autoRecallReinforcementAllowedIds,
    ...currentTurnGetIds,
  ]);
  const reinforcementAllowedExactIds = uniqueExactIds([
    ...autoRecallReinforcementAllowedExactIds,
    ...currentTurnGetExactIds,
  ]);

  return {
    auto_recall_reinforcement_allowed_ids: autoRecallReinforcementAllowedIds,
    current_turn_memory_engine_get_ids: currentTurnGetIds,
    reinforcement_allowed_ids: reinforcementAllowedIds,
    auto_recall_reinforcement_allowed_exact_ids: autoRecallReinforcementAllowedExactIds,
    current_turn_memory_engine_get_exact_ids: currentTurnGetExactIds,
    reinforcement_allowed_exact_ids: reinforcementAllowedExactIds,
  };
}

export function filterCitedIdsForReinforcement(
  citedIds = [],
  reinforcementAllowedIds = [],
  reinforcementAllowedExactIds = reinforcementAllowedIds,
) {
  const cited = uniqueShortIds(citedIds);
  const reinforcedIds = [];
  const ignored = [];

  for (const id of cited) {
    const resolution = resolveAuthorizedMemoryIds([id], reinforcementAllowedExactIds);
    if (resolution.authorized) {
      reinforcedIds.push(id);
      continue;
    }
    ignored.push({
      id,
      reason: "not_in_reinforcement_allowed_ids",
    });
  }

  return {
    reinforced_ids: reinforcedIds,
    ignored_cited_ids: ignored.map(item => item.id),
    ignored_reasons: ignored,
  };
}
