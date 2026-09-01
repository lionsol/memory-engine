import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  AMBIGUOUS_MEMORY_ID,
  batchReinforce,
  calcDecayedBaseConfidence,
  calcRealtimeConf,
  resolvePrefixes,
} from "../lib/memory-confidence.js";
import { ensureMemoryConfidenceTable } from "../lib/db/schema.js";
import { createMemoryEngineExecute, createMemoryEngineSearchExecute } from "../lib/tools/memory-engine-actions.js";
import { createAutoRecallHookLifecycle } from "../lib/recall/auto-recall-hook-lifecycle.js";
import { createAutoRecallTurnStateManager } from "../lib/recall/auto-recall-turn-state.js";
import { createHybridRuntimeContext } from "../lib/recall/hybrid/runtime-context.js";
import {
  MEMORY_CITE_NOT_AUTHORIZED,
  resolveAuthorizedMemoryIds,
} from "../lib/recall/cite-authority.js";

function createDb() {
  const db = new Database(":memory:");
  ensureMemoryConfidenceTable(db);
  return db;
}

function insertMemory(db, chunkId, {
  confidence = 0.8,
  lastConfidenceUpdate = 1_700_000_000,
  baseTau = 10,
  hitCount = 0,
  isArchived = 0,
  isProtected = 0,
  conflictFlag = 0,
} = {}) {
  db.prepare(`
    INSERT INTO memory_confidence (
      chunk_id, confidence, last_confidence_update, base_tau, hit_count,
      is_archived, is_protected, conflict_flag
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    chunkId,
    confidence,
    lastConfidenceUpdate,
    baseTau,
    hitCount,
    isArchived,
    isProtected,
    conflictFlag,
  );
}

test("memory identity resolution is exact-or-unique and active-row only", () => {
  const db = createDb();
  try {
    insertMemory(db, "exact-memory-id");
    insertMemory(db, "unique-memory-123");
    insertMemory(db, "shared-memory-a");
    insertMemory(db, "shared-memory-b");
    insertMemory(db, "archived-prefix-old", { isArchived: 1 });
    insertMemory(db, "archived-prefix-live");

    assert.deepEqual(resolvePrefixes(db, ["exact-memory-id"]), ["exact-memory-id"]);
    assert.deepEqual(resolvePrefixes(db, ["unique-memory-"]), ["unique-memory-123"]);
    assert.deepEqual(resolvePrefixes(db, ["missing-memory"]), []);
    assert.deepEqual(resolvePrefixes(db, ["archived-prefix-"]), ["archived-prefix-live"]);
    assert.deepEqual(
      resolvePrefixes(db, ["unique-memory-", "unique-memory-"]),
      ["unique-memory-123"],
    );
    assert.throws(
      () => resolvePrefixes(db, ["shared-memory-"]),
      error => error.message === AMBIGUOUS_MEMORY_ID,
    );
  } finally {
    db.close();
  }
});

test("authorized citation prefixes resolve only inside the immutable exact allowlist", () => {
  const served = "abcdef1234567890AAAAAAAA";
  const other = "abcdef9999999999BBBBBBBB";

  assert.deepEqual(
    resolveAuthorizedMemoryIds(["abcdef123"], [served]),
    { authorized: true, resolved_ids: [served], error: null, code: null },
  );
  assert.deepEqual(
    resolveAuthorizedMemoryIds([served.slice(0, 16), served.slice(0, 16)], [served]),
    { authorized: true, resolved_ids: [served], error: null, code: null },
  );
  assert.deepEqual(
    resolveAuthorizedMemoryIds(["abcdef"], [served, other]),
    { authorized: false, resolved_ids: [], error: AMBIGUOUS_MEMORY_ID, code: AMBIGUOUS_MEMORY_ID },
  );
  assert.deepEqual(
    resolveAuthorizedMemoryIds([other], [served]),
    { authorized: false, resolved_ids: [], error: MEMORY_CITE_NOT_AUTHORIZED, code: MEMORY_CITE_NOT_AUTHORIZED },
  );
});

test("reinforcement decays the current base, preserves conflict authority, and skips archived rows", () => {
  const db = createDb();
  const nowSec = 1_800_000_000;
  const oldRow = {
    confidence: 0.8,
    last_confidence_update: nowSec - 864_000,
    base_tau: 10,
    hit_count: 0,
    is_protected: 0,
    conflict_flag: 1,
  };
  try {
    insertMemory(db, "decayed-conflicted", {
      confidence: oldRow.confidence,
      lastConfidenceUpdate: oldRow.last_confidence_update,
      baseTau: oldRow.base_tau,
      hitCount: oldRow.hit_count,
      conflictFlag: oldRow.conflict_flag,
    });
    insertMemory(db, "archived-memory", { confidence: 0.6, isArchived: 1 });

    const expectedDecayedBase = calcDecayedBaseConfidence(oldRow, nowSec);
    const changed = batchReinforce(
      db,
      ["decayed-conflicted", "decayed-conflicted", "archived-memory"],
      nowSec,
    );
    const updated = db.prepare("SELECT * FROM memory_confidence WHERE chunk_id = ?").get("decayed-conflicted");
    const archived = db.prepare("SELECT * FROM memory_confidence WHERE chunk_id = ?").get("archived-memory");

    assert.equal(changed, 1);
    assert.ok(Math.abs(updated.confidence - Math.min(1, expectedDecayedBase + 0.1)) < 1e-12);
    assert.equal(updated.hit_count, 1);
    assert.equal(updated.last_confidence_update, nowSec);
    assert.equal(updated.conflict_flag, 1);
    assert.ok(updated.confidence > expectedDecayedBase);
    assert.equal(archived.hit_count, 0);
    assert.equal(archived.confidence, 0.6);
    assert.equal(
      calcRealtimeConf(updated, nowSec),
      Math.max(0, updated.confidence - 0.5),
    );
  } finally {
    db.close();
  }
});

test("ambiguous cite resolution performs zero reinforcement writes or success events", async () => {
  const db = createDb();
  const events = [];
  let batchCalls = 0;
  try {
    insertMemory(db, "ambiguous-cite-a");
    insertMemory(db, "ambiguous-cite-b");
    const execute = createMemoryEngineExecute({
      api: { config: {} },
      withDb: fn => fn(db),
      getLancedbTable: () => null,
      authorizeMemoryEngineCite: () => ({
        authorized: false,
        error: AMBIGUOUS_MEMORY_ID,
        code: AMBIGUOUS_MEMORY_ID,
      }),
      batchReinforce: (...args) => {
        batchCalls += 1;
        return batchReinforce(...args);
      },
      recordMemoryEvent: event => events.push(event),
      now: () => 1_800_000_000_000,
    });

    const result = await execute("ambiguous-cite-call", {
      action: "cite",
      chunk_ids: ["ambiguous-cite-"],
    });

    assert.deepEqual(result, { error: AMBIGUOUS_MEMORY_ID, code: AMBIGUOUS_MEMORY_ID });
    assert.equal(batchCalls, 0);
    assert.deepEqual(events, []);
    assert.deepEqual(
      db.prepare("SELECT chunk_id, hit_count FROM memory_confidence ORDER BY chunk_id").all(),
      [
        { chunk_id: "ambiguous-cite-a", hit_count: 0 },
        { chunk_id: "ambiguous-cite-b", hit_count: 0 },
      ],
    );
  } finally {
    db.close();
  }
});

function createAuthorityFixture({
  resultIds = ["served-memory-abcdef123456"],
  ttlMs = 60_000,
  autoRecallConfig = null,
} = {}) {
  let nowMs = 1_800_000_000_000;
  const db = createDb();
  const events = [];
  const hooks = [];
  const turnState = createAutoRecallTurnStateManager({ ttlMs, now: () => nowMs });
  const api = {
    config: {},
    logger: { warn() {} },
    on(name, handler, options) {
      hooks.push({ name, handler, options: options || null });
    },
  };
  const lifecycle = createAutoRecallHookLifecycle({
    api,
    autoRecallConfig: { enabled: false, ...(autoRecallConfig || {}) },
    recordMemoryEvent: event => events.push(event),
    withDb: fn => fn(db),
    now: () => nowMs,
    turnState,
    randomUUID: () => "cite-trace",
  });
  const hybridRuntime = createHybridRuntimeContext({
    dataAccess: {
      withDb: fn => fn(db),
      withHybridDbAccessScope: run => run({}),
      getLancedbTable: () => null,
      getLancedbRuntime: async () => ({ table: null, readyState: "ready" }),
      getMemorySearchManager: async () => ({ manager: null, error: null }),
    },
    retrievalPolicy: {
      calcRealtimeConf: () => 0.8,
      categoryMap: {},
      generateEmbedding: async () => [],
      hybridSearch: async () => ({
        pool: resultIds.length,
        channels: resultIds.length > 0 ? ["fts"] : [],
        channel_sizes: { fts: resultIds.length },
        debug: {},
        results: resultIds.map(id => ({
          id: id.slice(0, 16),
          memory_id: id,
          text: `served ${id}`,
          path: "memory/smart-add/served.md",
          category: "episodic",
          confidence: 0.8,
          final_score: 1,
          sources: ["fts"],
        })),
      }),
    },
    telemetry: {
      recordMemoryEvent: event => events.push(event),
      recordHybridSearchObservation: () => true,
      onMemoryEngineSearchSuccess: lifecycle.onMemoryEngineSearchSuccess,
    },
  });
  lifecycle.register(hybridRuntime);
  const executeAction = createMemoryEngineExecute({
    api,
    withDb: fn => fn(db),
    getLancedbTable: () => null,
    recordMemoryEvent: event => events.push(event),
    authorizeMemoryEngineCite: lifecycle.authorizeMemoryEngineCite,
    now: () => nowMs,
    hybrid: hybridRuntime,
  });
  const executeSearch = createMemoryEngineSearchExecute({ hybrid: hybridRuntime });
  const beforeToolCall = (toolName, toolCallId, runId) => hooks[0].handler(
    { toolName, toolCallId },
    { runId, sessionId: `session-${runId}`, toolCallId },
  );
  return {
    db,
    events,
    hooks,
    lifecycle,
    turnState,
    executeAction,
    executeSearch,
    beforeToolCall,
    resultIds,
    advance(ms) {
      nowMs += ms;
    },
    close() {
      db.close();
    },
  };
}

test("broad action Search and dedicated Search both authorize same-turn cite", async () => {
  const broad = createAuthorityFixture({ resultIds: ["broad-memory-abcdef123456"] });
  const dedicated = createAuthorityFixture({ resultIds: ["dedicated-memory-abcdef"] });
  try {
    insertMemory(broad.db, broad.resultIds[0]);
    insertMemory(dedicated.db, dedicated.resultIds[0]);
    const broadId = broad.resultIds[0].slice(0, 16);
    const dedicatedId = dedicated.resultIds[0].slice(0, 16);

    await broad.beforeToolCall("memory_engine", "broad-search-call", "run-broad");
    const broadSearch = await broad.executeAction("broad-search-call", {
      action: "search",
      text: "question",
    });
    const broadState = broad.turnState.getTurnState("run-broad");
    assert.deepEqual(broadState.memoryEngineSearchIds, new Set([broadId]));
    assert.deepEqual(broadState.memoryEngineSearchExactIds, new Set(broad.resultIds));
    await broad.beforeToolCall("memory_engine", "broad-cite-call", "run-broad");
    const broadCite = await broad.executeAction("broad-cite-call", {
      action: "cite",
      chunk_ids: [broadId],
    });
    assert.equal(broadSearch.results[0].id, broadId);
    assert.equal(broadSearch.results[0].memory_id, broad.resultIds[0]);
    assert.equal(broadCite.success, true);
    assert.equal(broadCite.reinforced, 1);

    await dedicated.beforeToolCall("memory_engine_search", "dedicated-search-call", "run-dedicated");
    const dedicatedSearch = await dedicated.executeSearch("dedicated-search-call", { query: "question" });
    await dedicated.beforeToolCall("memory_engine", "dedicated-cite-call", "run-dedicated");
    const dedicatedCite = await dedicated.executeAction("dedicated-cite-call", {
      action: "cite",
      chunk_ids: [dedicatedId],
    });
    assert.equal(dedicatedSearch.results[0].id, dedicatedId);
    assert.equal(dedicatedSearch.results[0].memory_id, dedicated.resultIds[0]);
    assert.equal(dedicatedCite.success, true);
    assert.equal(dedicatedCite.reinforced, 1);
    assert.equal(
      dedicated.events.filter(event => event.event_type === "memory_cited").length,
      1,
    );
    assert.equal(
      dedicated.events.filter(event => event.event_type === "memory_reinforced").length,
      1,
    );
  } finally {
    broad.close();
    dedicated.close();
  }
});

test("Search authority cannot substitute an unavailable served id with another prefix match", async () => {
  const servedA = "abcdef1234567890AAAAAAAA";
  const foreignB = "abcdef1234567890BBBBBBBB";
  const fixture = createAuthorityFixture({ resultIds: [servedA] });
  try {
    insertMemory(fixture.db, servedA);
    insertMemory(fixture.db, foreignB);

    await fixture.beforeToolCall("memory_engine_search", "search-substitution", "run-substitution");
    await fixture.executeSearch("search-substitution", { query: "question" });
    assert.deepEqual(
      [...fixture.turnState.getTurnState("run-substitution").memoryEngineSearchExactIds],
      [servedA],
    );

    fixture.db.prepare("UPDATE memory_confidence SET is_archived = 1 WHERE chunk_id = ?").run(servedA);
    await fixture.beforeToolCall("memory_engine", "cite-substitution", "run-substitution");
    const result = await fixture.executeAction("cite-substitution", {
      action: "cite",
      chunk_ids: [servedA.slice(0, 16)],
    });

    assert.equal(result.success, true);
    assert.equal(result.reinforced, 0);
    assert.deepEqual(result.ids, []);
    assert.equal(fixture.db.prepare("SELECT hit_count FROM memory_confidence WHERE chunk_id = ?").get(foreignB).hit_count, 0);
    assert.equal(fixture.db.prepare("SELECT is_archived FROM memory_confidence WHERE chunk_id = ?").get(servedA).is_archived, 1);
    assert.equal(fixture.events.some(event => event.event_type === "memory_cited"), false);
    assert.equal(fixture.events.some(event => event.event_type === "memory_reinforced"), false);
  } finally {
    fixture.close();
  }
});

test("ambiguous prefixes inside the served exact-id set fail closed before mutation", async () => {
  const servedA = "abcdef1234567890AAAAAAAA";
  const servedB = "abcdef1234567890BBBBBBBB";
  const fixture = createAuthorityFixture({ resultIds: [servedA, servedB] });
  try {
    insertMemory(fixture.db, servedA);
    insertMemory(fixture.db, servedB);
    await fixture.beforeToolCall("memory_engine_search", "search-ambiguous", "run-ambiguous");
    await fixture.executeSearch("search-ambiguous", { query: "question" });
    await fixture.beforeToolCall("memory_engine", "cite-ambiguous", "run-ambiguous");

    const result = await fixture.executeAction("cite-ambiguous", {
      action: "cite",
      chunk_ids: ["abcdef1234567890"],
    });

    assert.deepEqual(result, { error: AMBIGUOUS_MEMORY_ID, code: AMBIGUOUS_MEMORY_ID });
    assert.deepEqual(
      fixture.db.prepare("SELECT chunk_id, hit_count FROM memory_confidence ORDER BY chunk_id").all(),
      [
        { chunk_id: servedA, hit_count: 0 },
        { chunk_id: servedB, hit_count: 0 },
      ],
    );
    assert.equal(fixture.events.some(event => event.event_type === "memory_cited"), false);
    assert.equal(fixture.events.some(event => event.event_type === "memory_reinforced"), false);
  } finally {
    fixture.close();
  }
});

test("AutoRecall exact allowlist cannot substitute an unavailable injected id", async () => {
  const allowedA = "abcdef1234567890AAAAAAAA";
  const foreignB = "abcdef1234567890BBBBBBBB";
  const fixture = createAuthorityFixture({
    resultIds: [allowedA],
    autoRecallConfig: { enabled: true, sessionAllowlist: ["session-auto"] },
  });
  try {
    insertMemory(fixture.db, allowedA);
    insertMemory(fixture.db, foreignB);
    const beforePrompt = fixture.hooks.find(item => item.name === "before_prompt_build").handler;
    await beforePrompt({
      prompt: "served memory",
      runId: "run-auto-substitution",
      sessionId: "session-auto",
    }, {
      agentId: "edi",
      trigger: "user",
      runId: "run-auto-substitution",
      sessionId: "session-auto",
    });
    assert.deepEqual(
      fixture.lifecycle.turnState.getTurnState("run-auto-substitution").reinforcementAllowedExactIds,
      [allowedA],
    );

    fixture.db.prepare("UPDATE memory_confidence SET is_archived = 1 WHERE chunk_id = ?").run(allowedA);
    const finalize = fixture.hooks.find(item => item.name === "before_agent_finalize").handler;
    await finalize({
      runId: "run-auto-substitution",
      sessionId: "session-auto",
      lastAssistantMessage: `used memory\ncited_memory_ids: ["${allowedA.slice(0, 16)}"]`,
    }, { runId: "run-auto-substitution", sessionId: "session-auto" });

    assert.equal(fixture.db.prepare("SELECT hit_count FROM memory_confidence WHERE chunk_id = ?").get(foreignB).hit_count, 0);
    assert.equal(fixture.events.some(event => event.event_type === "memory_cited"), false);
    assert.equal(fixture.events.some(event => event.event_type === "memory_reinforced"), false);
  } finally {
    fixture.close();
  }
});

test("current-turn Get authority cannot substitute an unavailable exact id", async () => {
  const fetchedA = "abcdef1234567890AAAAAAAA";
  const foreignB = "abcdef1234567890BBBBBBBB";
  const fixture = createAuthorityFixture({
    resultIds: [],
    autoRecallConfig: { enabled: true },
  });
  try {
    insertMemory(fixture.db, fetchedA);
    insertMemory(fixture.db, foreignB);
    fixture.lifecycle.turnState.createTurnState({
      runId: "run-get-substitution",
      sessionId: "session-get",
      traceId: "trace-get",
    });
    const getScope = fixture.hooks.filter(item => item.name === "before_tool_call")[1].handler;
    await getScope({
      toolName: "memory_engine_get",
      toolCallId: "get-substitution",
      runId: "run-get-substitution",
    }, {
      runId: "run-get-substitution",
      sessionId: "session-get",
    });
    fixture.lifecycle.onMemoryEngineGetSuccess(fetchedA, { _toolCallId: "get-substitution" });
    assert.deepEqual(
      [...fixture.lifecycle.turnState.getTurnState("run-get-substitution").memoryEngineGetExactIds],
      [fetchedA],
    );

    fixture.db.prepare("UPDATE memory_confidence SET is_archived = 1 WHERE chunk_id = ?").run(fetchedA);
    const finalize = fixture.hooks.find(item => item.name === "before_agent_finalize").handler;
    await finalize({
      runId: "run-get-substitution",
      sessionId: "session-get",
      lastAssistantMessage: `used memory\ncited_memory_ids: ["${fetchedA.slice(0, 16)}"]`,
    }, { runId: "run-get-substitution", sessionId: "session-get" });

    assert.equal(fixture.db.prepare("SELECT hit_count FROM memory_confidence WHERE chunk_id = ?").get(foreignB).hit_count, 0);
    assert.equal(fixture.events.some(event => event.event_type === "memory_cited"), false);
    assert.equal(fixture.events.some(event => event.event_type === "memory_reinforced"), false);
  } finally {
    fixture.close();
  }
});

test("cite rejects unserved, foreign, expired, absent, and missing-scope requests without success events", async () => {
  const unserved = createAuthorityFixture({ resultIds: ["served-memory-abcdef123456"] });
  const foreign = createAuthorityFixture({ resultIds: ["foreign-memory-abcdef"] });
  const expired = createAuthorityFixture({ resultIds: ["expired-memory-abcdef"] });
  const absent = createAuthorityFixture({ resultIds: ["absent-memory-abcdef"] });
  const missingScope = createAuthorityFixture({ resultIds: ["missing-memory-abcdef"] });
  try {
    for (const fixture of [unserved, foreign, expired, absent, missingScope]) {
      insertMemory(fixture.db, fixture.resultIds[0]);
    }
    await unserved.beforeToolCall("memory_engine_search", "search-unserved", "run-unserved");
    await unserved.executeSearch("search-unserved", { query: "question" });
    await unserved.beforeToolCall("memory_engine", "cite-unserved", "run-unserved");
    const unservedResult = await unserved.executeAction("cite-unserved", {
      action: "cite",
      chunk_ids: ["not-served"],
    });
    assert.deepEqual(unservedResult, {
      error: MEMORY_CITE_NOT_AUTHORIZED,
      code: MEMORY_CITE_NOT_AUTHORIZED,
    });

    await foreign.beforeToolCall("memory_engine_search", "search-foreign", "run-a");
    await foreign.executeSearch("search-foreign", { query: "question" });
    await foreign.beforeToolCall("memory_engine", "cite-foreign", "run-b");
    const foreignResult = await foreign.executeAction("cite-foreign", {
      action: "cite",
      chunk_ids: [foreign.resultIds[0].slice(0, 16)],
    });
    assert.deepEqual(foreignResult, {
      error: MEMORY_CITE_NOT_AUTHORIZED,
      code: MEMORY_CITE_NOT_AUTHORIZED,
    });

    await expired.beforeToolCall("memory_engine_search", "search-expired", "run-expired");
    await expired.executeSearch("search-expired", { query: "question" });
    expired.advance(expired.turnState.ttlMs + 1);
    const expiredResult = await expired.executeAction("cite-expired", {
      action: "cite",
      chunk_ids: [expired.resultIds[0].slice(0, 16)],
    });
    assert.deepEqual(expiredResult, {
      error: MEMORY_CITE_NOT_AUTHORIZED,
      code: MEMORY_CITE_NOT_AUTHORIZED,
    });

    await absent.beforeToolCall("memory_engine", "cite-absent", "run-absent");
    const absentResult = await absent.executeAction("cite-absent", {
      action: "cite",
      chunk_ids: [absent.resultIds[0].slice(0, 16)],
    });
    assert.deepEqual(absentResult, {
      error: MEMORY_CITE_NOT_AUTHORIZED,
      code: MEMORY_CITE_NOT_AUTHORIZED,
    });

    const missingScopeResult = await missingScope.executeAction("cite-missing-scope", {
      action: "cite",
      chunk_ids: [missingScope.resultIds[0].slice(0, 16)],
    });
    assert.deepEqual(missingScopeResult, {
      error: MEMORY_CITE_NOT_AUTHORIZED,
      code: MEMORY_CITE_NOT_AUTHORIZED,
    });
    assert.equal(unserved.db.prepare("SELECT hit_count FROM memory_confidence WHERE chunk_id = ?").get(unserved.resultIds[0]).hit_count, 0);
    assert.equal(unserved.events.some(event => event.event_type === "memory_cited"), false);
    assert.equal(unserved.events.some(event => event.event_type === "memory_reinforced"), false);
    for (const fixture of [unserved, foreign, expired, absent, missingScope]) {
      assert.equal(fixture.events.some(event => event.event_type === "memory_cited"), false);
      assert.equal(fixture.events.some(event => event.event_type === "memory_reinforced"), false);
    }
  } finally {
    for (const fixture of [unserved, foreign, expired, absent, missingScope]) fixture.close();
  }
});
