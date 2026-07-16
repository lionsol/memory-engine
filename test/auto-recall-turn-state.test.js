import test from "node:test";
import assert from "node:assert/strict";
import { createAutoRecallTurnStateManager } from "../lib/recall/auto-recall-turn-state.js";
import {
  buildReinforcementAllowedIds,
  filterCitedIdsForReinforcement,
} from "../lib/recall/auto-recall-reinforcement.js";

function createClock(start = 1_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
      return current;
    },
  };
}

test("sequential isolation prevents turn B finalize from reinforcing turn A get ids", () => {
  const clock = createClock();
  const manager = createAutoRecallTurnStateManager({ ttlMs: 60_000, now: clock.now });

  manager.createTurnState({ runId: "run-A", sessionId: "session-1", traceId: "trace-A" });
  manager.recordMemoryEngineGet({ runId: "run-A", memoryId: "A1234567890abcdef" });

  manager.createTurnState({ runId: "run-B", sessionId: "session-1", traceId: "trace-B" });
  const turnStateB = manager.getTurnState("run-B");
  const allowlistB = buildReinforcementAllowedIds({
    traceState: { reinforcementAllowedIds: [] },
    currentTurnMemoryEngineGetIds: [...turnStateB.memoryEngineGetIds],
  });
  const filteredB = filterCitedIdsForReinforcement(
    ["A1234567890abcdef"],
    allowlistB.reinforcement_allowed_ids,
  );

  assert.deepEqual(allowlistB.current_turn_memory_engine_get_ids, []);
  assert.deepEqual(filteredB.reinforced_ids, []);
});

test("concurrent interleaving preserves per-run get ids", () => {
  const clock = createClock();
  const manager = createAutoRecallTurnStateManager({ ttlMs: 60_000, now: clock.now });

  manager.createTurnState({ runId: "run-A", sessionId: "session-1", traceId: "trace-A" });
  manager.createTurnState({ runId: "run-B", sessionId: "session-1", traceId: "trace-B" });
  manager.recordMemoryEngineGet({ runId: "run-A", memoryId: "A1234567890abcdef" });
  manager.recordMemoryEngineGet({ runId: "run-B", memoryId: "B1234567890abcdef" });

  const turnStateA = manager.getTurnState("run-A");
  const allowlistA = buildReinforcementAllowedIds({
    traceState: { reinforcementAllowedIds: [] },
    currentTurnMemoryEngineGetIds: [...turnStateA.memoryEngineGetIds],
  });
  const filteredA = filterCitedIdsForReinforcement(
    ["A1234567890abcdef", "B1234567890abcdef"],
    allowlistA.reinforcement_allowed_ids,
  );

  assert.deepEqual(allowlistA.current_turn_memory_engine_get_ids, ["A1234567890abcde"]);
  assert.deepEqual(filteredA.reinforced_ids, ["A1234567890abcde"]);
  assert.deepEqual(filteredA.ignored_cited_ids, ["B1234567890abcde"]);
});

test("cleanupExpired removes stale turn state after timeout", () => {
  const clock = createClock();
  const manager = createAutoRecallTurnStateManager({ ttlMs: 60_000, now: clock.now });

  manager.createTurnState({ runId: "run-A", sessionId: "session-1", traceId: "trace-A" });
  clock.advance(60_001);
  const cleanup = manager.cleanupExpired(clock.now());

  assert.equal(cleanup.deletedTurnStates, 1);
  assert.equal(manager.getTurnState("run-A"), null);
});

test("recall state lifecycle stores injected ids by run and disappears after delete", () => {
  const clock = createClock();
  const manager = createAutoRecallTurnStateManager({ ttlMs: 60_000, now: clock.now });

  manager.createTurnState({ runId: "run-A", sessionId: "session-1", traceId: "trace-A" });
  manager.updateTurnRecallState({
    runId: "run-A",
    sessionId: "session-1",
    traceId: "trace-A",
    injectedIds: ["inj1234567890abcdef", "inj1234567890abcdef"],
    reinforcementAllowedIds: ["allow1234567890abcd"],
  });

  const state = manager.getTurnState("run-A");
  assert.deepEqual(state.injectedIds, ["inj1234567890abc"]);
  assert.deepEqual(state.reinforcementAllowedIds, ["allow1234567890a"]);

  manager.deleteTurnState("run-A");
  assert.equal(manager.getTurnState("run-A"), null);
});

test("session fallback skips expired injected ids", () => {
  const clock = createClock();
  const manager = createAutoRecallTurnStateManager({ ttlMs: 60_000, now: clock.now });

  manager.createTurnState({ runId: "run-A", sessionId: "session-1", traceId: "trace-A" });
  manager.updateTurnRecallState({
    runId: "run-A",
    sessionId: "session-1",
    traceId: "trace-A",
    injectedIds: ["inj1234567890abcdef"],
    reinforcementAllowedIds: [],
  });

  clock.advance(60_001);
  manager.cleanupExpired(clock.now());

  assert.equal(manager.getTurnStateBySession("session-1"), null);
});

test("finalize cleanup removes turn state and bridge state together", () => {
  const clock = createClock();
  const manager = createAutoRecallTurnStateManager({ ttlMs: 60_000, now: clock.now });

  manager.createTurnState({ runId: "run-A", sessionId: "session-1", traceId: "trace-A" });
  manager.recordToolInvocationScope({
    toolCallId: "tool-123",
    runId: "run-A",
    sessionId: "session-1",
  });

  manager.deleteTurnState("run-A");
  manager.deleteToolInvocationScopesByRunId("run-A");

  assert.equal(manager.getTurnState("run-A"), null);
  assert.equal(manager.getToolInvocationScope("tool-123"), null);
});

test("tool bridge maps toolCallId to runId and expires with TTL", () => {
  const clock = createClock();
  const manager = createAutoRecallTurnStateManager({ ttlMs: 60_000, now: clock.now });

  manager.recordToolInvocationScope({
    toolCallId: "tool-123",
    runId: "run-A",
    sessionId: "session-1",
  });

  assert.deepEqual(manager.getToolInvocationScope("tool-123"), {
    toolCallId: "tool-123",
    runId: "run-A",
    sessionId: "session-1",
    createdAt: 1000,
    lastTouchedAt: 1000,
    expiresAt: 61_000,
  });

  clock.advance(60_001);
  const cleanup = manager.cleanupExpired(clock.now());

  assert.equal(cleanup.deletedToolInvocationScopes, 1);
  assert.equal(manager.getToolInvocationScope("tool-123"), null);
});
