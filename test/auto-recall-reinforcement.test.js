import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReinforcementAllowedIds,
  filterCitedIdsForReinforcement,
} from "../lib/recall/auto-recall-reinforcement.js";

test("autoRecall reinforcement allowlist plus cited ids hit results in reinforcement", () => {
  const allowlist = buildReinforcementAllowedIds({
    traceState: {
      reinforcementAllowedIds: ["abcdef1234567890"],
    },
    currentTurnMemoryEngineGetIds: [],
  });
  const filtered = filterCitedIdsForReinforcement(
    ["abcdef1234567890"],
    allowlist.reinforcement_allowed_ids,
  );

  assert.deepEqual(allowlist.auto_recall_reinforcement_allowed_ids, ["abcdef1234567890"]);
  assert.deepEqual(allowlist.current_turn_memory_engine_get_ids, []);
  assert.deepEqual(allowlist.reinforcement_allowed_ids, ["abcdef1234567890"]);
  assert.deepEqual(filtered.reinforced_ids, ["abcdef1234567890"]);
  assert.deepEqual(filtered.ignored_cited_ids, []);
});

test("memory_engine_get ids are unioned into reinforcement allowlist", () => {
  const allowlist = buildReinforcementAllowedIds({
    traceState: {
      reinforcementAllowedIds: ["auto111111111111"],
    },
    currentTurnMemoryEngineGetIds: ["get22222222222222"],
  });
  const filtered = filterCitedIdsForReinforcement(
    ["get22222222222222"],
    allowlist.reinforcement_allowed_ids,
  );

  assert.deepEqual(allowlist.reinforcement_allowed_ids, [
    "auto111111111111",
    "get2222222222222",
  ]);
  assert.deepEqual(filtered.reinforced_ids, ["get2222222222222"]);
});

test("search-only cited ids are not reinforced", () => {
  const allowlist = buildReinforcementAllowedIds({
    traceState: null,
    currentTurnMemoryEngineGetIds: [],
  });
  const filtered = filterCitedIdsForReinforcement(
    ["searchonly1234567"],
    allowlist.reinforcement_allowed_ids,
  );

  assert.deepEqual(allowlist.reinforcement_allowed_ids, []);
  assert.deepEqual(filtered.reinforced_ids, []);
  assert.deepEqual(filtered.ignored_cited_ids, ["searchonly123456"]);
  assert.deepEqual(filtered.ignored_reasons, [
    { id: "searchonly123456", reason: "not_in_reinforcement_allowed_ids" },
  ]);
});

test("hallucinated cited ids are not reinforced", () => {
  const allowlist = buildReinforcementAllowedIds({
    traceState: {
      reinforcementAllowedIds: ["real123456789012"],
    },
    currentTurnMemoryEngineGetIds: [],
  });
  const filtered = filterCitedIdsForReinforcement(
    ["hallucinated99999"],
    allowlist.reinforcement_allowed_ids,
  );

  assert.deepEqual(filtered.reinforced_ids, []);
  assert.deepEqual(filtered.ignored_cited_ids, ["hallucinated9999"]);
});

test("suspected_tool_output rejected by autoRecall never enters reinforcement allowlist", () => {
  const allowlist = buildReinforcementAllowedIds({
    traceState: {
      reinforcementAllowedIds: [],
    },
    currentTurnMemoryEngineGetIds: [],
  });
  const filtered = filterCitedIdsForReinforcement(
    ["suspectedtoolout1"],
    allowlist.reinforcement_allowed_ids,
  );

  assert.deepEqual(allowlist.reinforcement_allowed_ids, []);
  assert.deepEqual(filtered.reinforced_ids, []);
  assert.deepEqual(filtered.ignored_cited_ids, ["suspectedtoolout"]);
});

test("no autoRecall trace plus no get ids defaults to deny", () => {
  const allowlist = buildReinforcementAllowedIds({
    traceState: null,
    currentTurnMemoryEngineGetIds: [],
  });
  const filtered = filterCitedIdsForReinforcement(
    ["abcdef1234567890"],
    allowlist.reinforcement_allowed_ids,
  );

  assert.deepEqual(allowlist.auto_recall_reinforcement_allowed_ids, []);
  assert.deepEqual(allowlist.current_turn_memory_engine_get_ids, []);
  assert.deepEqual(allowlist.reinforcement_allowed_ids, []);
  assert.deepEqual(filtered.reinforced_ids, []);
});
