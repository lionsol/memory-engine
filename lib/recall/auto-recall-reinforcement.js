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

export function buildReinforcementAllowedIds({ traceState = null, currentTurnMemoryEngineGetIds = [] } = {}) {
  const autoRecallReinforcementAllowedIds = uniqueShortIds(traceState?.reinforcementAllowedIds || []);
  const currentTurnGetIds = uniqueShortIds(currentTurnMemoryEngineGetIds);
  const reinforcementAllowedIds = uniqueShortIds([
    ...autoRecallReinforcementAllowedIds,
    ...currentTurnGetIds,
  ]);

  return {
    auto_recall_reinforcement_allowed_ids: autoRecallReinforcementAllowedIds,
    current_turn_memory_engine_get_ids: currentTurnGetIds,
    reinforcement_allowed_ids: reinforcementAllowedIds,
  };
}

export function filterCitedIdsForReinforcement(citedIds = [], reinforcementAllowedIds = []) {
  const allowed = new Set(uniqueShortIds(reinforcementAllowedIds));
  const cited = uniqueShortIds(citedIds);
  const reinforcedIds = [];
  const ignored = [];

  for (const id of cited) {
    if (allowed.has(id)) {
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
