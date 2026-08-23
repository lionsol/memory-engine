import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { composeCanonicalMemoryObject } from "../../lib/canonical/memory-object.js";
import {
  assertDisclosureAttestation,
} from "../../lib/recall/disclosure/owner-attestation.js";
import {
  buildOwnerDisclosurePreview,
} from "../../lib/recall/disclosure/owner-attestable-projection.js";
import {
  evaluateDirectCardCapability,
} from "../../lib/recall/disclosure/disclosure-capability.js";
import {
  evaluateDirectCardProductionBoundary,
} from "../../lib/recall/disclosure/direct-card-production-boundary.js";
import {
  formatDirectCardContext,
} from "../../lib/recall/disclosure/direct-card-formatter.js";
import {
  selectDirectCardCandidates,
} from "../../lib/recall/disclosure/disclosure-selector.js";
import {
  ensureMemoryEngineTables,
} from "../../lib/db/schema.js";
import { createAutoRecallHookLifecycle } from "../../lib/recall/auto-recall-hook-lifecycle.js";
import { createHybridRuntimeContext } from "../../lib/recall/hybrid/runtime-context.js";

const SAFE_SENTINEL = "DIRECT_CARD_FULL_SOURCE_SENTINEL_20260823";
const SAFE_LONG_PREFIX = "bounded canonical source text ".repeat(20);

function createCanonicalRow(record) {
  return {
    id: record.id,
    path: record.path || "memory/episodes/2026-08-23.md",
    source: "openclaw_core",
    start_line: 1,
    end_line: 4,
    hash: null,
    text: record.text || `OpenClaw memory-engine 5.20+ compatibility ${record.id} ${SAFE_LONG_PREFIX}${SAFE_SENTINEL}`,
    updated_at: 1_756_000_000,
  };
}

function createEngineRow(record) {
  return {
    chunk_id: record.id,
    initial_confidence: record.confidence ?? 0.82,
    confidence: record.confidence ?? 0.82,
    last_confidence_update: 1_756_000_000,
    base_tau: 90,
    hit_count: 1,
    is_archived: record.isArchived ? 1 : 0,
    is_protected: 0,
    conflict_flag: record.conflictFlag ? 1 : 0,
    category: record.category || "episodic",
  };
}

function readonlyView(db) {
  return {
    readonly: true,
    prepare(sql) {
      return db.prepare(sql);
    },
  };
}

function createFixture({
  records = [{ id: "direct-card-memory-001" }],
  attestIds = records.map(record => record.id),
} = {}) {
  const coreDb = new Database(":memory:");
  const engineDb = new Database(":memory:");
  coreDb.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      source TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      hash TEXT,
      text TEXT NOT NULL,
      updated_at INTEGER
    )
  `);
  ensureMemoryEngineTables(engineDb);

  const insertCore = coreDb.prepare(`
    INSERT INTO chunks (id, path, source, start_line, end_line, hash, text, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEngine = engineDb.prepare(`
    INSERT INTO memory_confidence (
      chunk_id, initial_confidence, confidence, last_confidence_update, base_tau,
      hit_count, is_archived, is_protected, conflict_flag, category
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const canonicalById = new Map();
  for (const record of records) {
    const coreRow = createCanonicalRow(record);
    const engineRow = createEngineRow(record);
    insertCore.run(
      coreRow.id,
      coreRow.path,
      coreRow.source,
      coreRow.start_line,
      coreRow.end_line,
      coreRow.hash,
      coreRow.text,
      coreRow.updated_at,
    );
    insertEngine.run(
      engineRow.chunk_id,
      engineRow.initial_confidence,
      engineRow.confidence,
      engineRow.last_confidence_update,
      engineRow.base_tau,
      engineRow.hit_count,
      engineRow.is_archived,
      engineRow.is_protected,
      engineRow.conflict_flag,
      engineRow.category,
    );
    canonicalById.set(
      record.id,
      composeCanonicalMemoryObject(coreRow, engineRow),
    );
  }

  for (const [index, id] of attestIds.entries()) {
    const canonical = canonicalById.get(id);
    if (!canonical) throw new Error(`missing fixture canonical memory: ${id}`);
    assertDisclosureAttestation(
      engineDb,
      buildOwnerDisclosurePreview(canonical).binding,
      { now: 100 + index },
    );
  }

  const calls = { scope: 0, core: 0, engine: 0 };
  const withHybridDbAccessScope = async run => {
    calls.scope += 1;
    return run({
      withCoreDb(callback) {
        calls.core += 1;
        return callback(readonlyView(coreDb));
      },
      withEngineDb(callback) {
        calls.engine += 1;
        return callback(readonlyView(engineDb));
      },
    });
  };

  return {
    coreDb,
    engineDb,
    calls,
    canonicalById,
    withHybridDbAccessScope,
    candidateFor(record, index = 0) {
      return {
        id: record.id.slice(0, 16),
        memory_id: record.id,
        canonical_id: `cmem:core:${record.id}`,
        path: record.path || "memory/episodes/2026-08-23.md",
        text: record.text || `OpenClaw memory-engine 5.20+ compatibility ${record.id}`,
        category: record.category || "episodic",
        kind: "episode",
        confidence: record.confidence ?? 0.82,
        rank: index + 1,
        final_score: 0.42 - index / 100,
        sources: ["fts"],
      };
    },
    close() {
      coreDb.close();
      engineDb.close();
    },
  };
}

async function evaluate(fixture, {
  event = { senderIsOwner: true },
  candidates = [fixture.candidateFor({ id: "direct-card-memory-001" })],
  runtimeAgentScope = "edi",
} = {}) {
  return evaluateDirectCardProductionBoundary({
    event,
    candidates,
    runtimeAgentScope,
    withHybridDbAccessScope: fixture.withHybridDbAccessScope,
  });
}

test("production boundary discloses a bounded card only after the full authority conjunction", async () => {
  const fixture = createFixture();
  try {
    const result = await evaluate(fixture);

    assert.equal(fixture.calls.scope, 1);
    assert.equal(fixture.calls.core, 1);
    assert.equal(result.capabilityResults[0].capability, "CARD_DISCLOSABLE");
    assert.equal(result.selected.length, 1);
    assert.equal(result.selected[0].decision, "DISCLOSE_CARD");
    assert.equal(result.selected[0].memory_id, "direct-card-memory-001");

    const context = formatDirectCardContext(result.selected);
    assert.match(context, /direct-card-memory-001/u);
    assert.match(context, /memory cards/u);
    assert.doesNotMatch(context, new RegExp(SAFE_SENTINEL, "u"));
    assert.doesNotMatch(context, /get_token|full_content|source_text/u);
  } finally {
    fixture.close();
  }
});

test("false, missing, non-boolean, and Owner-like transport context never authenticates the audience", async () => {
  const fixture = createFixture();
  try {
    for (const event of [
      { senderIsOwner: false },
      {},
      { senderIsOwner: "true" },
      {
        senderId: "owner",
        sessionKey: "owner-session",
        channel: "dm",
        ctx: { senderId: "owner", agentId: "edi" },
      },
    ]) {
      const result = await evaluate(fixture, { event });
      assert.equal(result.ownerAudienceAuthenticated, false);
      assert.equal(result.capabilityResults[0].capability, "RETRIEVAL_ONLY");
      assert.equal(result.selections[0].decision, "WITHHOLD");
      assert.deepEqual(result.selected, []);
    }
    assert.equal(fixture.calls.scope, 0);
  } finally {
    fixture.close();
  }
});

test("missing, revoked, wrong-hash, and stale-source attestations fail closed", async () => {
  const missing = createFixture({ attestIds: [] });
  try {
    const result = await evaluate(missing);
    assert.equal(result.capabilityResults[0].reason, "attestation_missing");
    assert.deepEqual(result.selected, []);
  } finally {
    missing.close();
  }

  const revoked = createFixture();
  try {
    revoked.engineDb.prepare(
      "UPDATE disclosure_attestations SET state = 'revoked', revoked_at = 200, updated_at = 200",
    ).run();
    const result = await evaluate(revoked);
    assert.equal(result.capabilityResults[0].capability, "RETRIEVAL_ONLY");
    assert.equal(result.capabilityResults[0].reason, "attestation_not_active");
  } finally {
    revoked.close();
  }

  const wrongHash = createFixture();
  try {
    wrongHash.engineDb.prepare(
      "UPDATE disclosure_attestations SET projection_hash = ?",
    ).run("f".repeat(64));
    const result = await evaluate(wrongHash);
    assert.equal(result.capabilityResults[0].capability, "RETRIEVAL_ONLY");
    assert.ok([
      "projection_hash_mismatch",
      "attestation_id_mismatch",
    ].includes(result.capabilityResults[0].reason));
  } finally {
    wrongHash.close();
  }

  const stale = createFixture();
  try {
    stale.coreDb.prepare("UPDATE chunks SET text = ?").run(
      `OpenClaw memory-engine 5.20+ compatibility CHANGED_${SAFE_SENTINEL}`,
    );
    const result = await evaluate(stale);
    assert.equal(result.capabilityResults[0].capability, "RETRIEVAL_ONLY");
    assert.ok([
      "source_content_hash_mismatch",
      "projection_hash_mismatch",
      "attestation_missing",
    ].includes(result.capabilityResults[0].reason));
  } finally {
    stale.close();
  }
});

test("projection, unsafe source, lifecycle, conflict, and scope hard denies remain independent", async () => {
  const raw = createFixture({
    records: [{
      id: "direct-card-raw-log-001",
      path: "memory/logs/tool-output.log",
      category: "raw_log",
      text: `ERROR tool output ${SAFE_SENTINEL}`,
    }],
  });
  try {
    const result = await evaluate(raw, {
      candidates: [raw.candidateFor({
        id: "direct-card-raw-log-001",
        path: "memory/logs/tool-output.log",
        category: "raw_log",
      })],
    });
    assert.equal(result.capabilityResults[0].reason, "unsafe_risk");
    assert.deepEqual(result.selected, []);
  } finally {
    raw.close();
  }

  const archived = createFixture({
    records: [{ id: "direct-card-archived-001", isArchived: true }],
  });
  try {
    const result = await evaluate(archived, {
      candidates: [archived.candidateFor({ id: "direct-card-archived-001" })],
    });
    assert.equal(result.capabilityResults[0].reason, "blocked_lifecycle");
  } finally {
    archived.close();
  }

  const conflict = createFixture({
    records: [{ id: "direct-card-conflict-001", conflictFlag: true }],
  });
  try {
    const result = await evaluate(conflict, {
      candidates: [conflict.candidateFor({ id: "direct-card-conflict-001" })],
    });
    assert.equal(result.capabilityResults[0].reason, "unsafe_risk");
  } finally {
    conflict.close();
  }

  const fixture = createFixture();
  try {
    const canonical = fixture.canonicalById.get("direct-card-memory-001");
    const preview = buildOwnerDisclosurePreview(canonical);
    const authority = {
      safe_to_disclose: true,
      authority: preview.binding,
    };
    const invalidProjection = evaluateDirectCardCapability({
      event: { senderIsOwner: true },
      canonicalMemory: canonical,
      projectionArtifact: {
        ...preview.artifact,
        payload: { ...preview.artifact.payload, summary: "" },
      },
      attestationEvidence: authority,
      runtimeAgentScope: "edi",
    });
    assert.equal(invalidProjection.capability, "RETRIEVAL_ONLY");

    const scopeDenied = evaluateDirectCardCapability({
      event: { senderIsOwner: true },
      canonicalMemory: {
        ...canonical,
        classification: { ...canonical.classification, agent_scope: "other-agent" },
      },
      projectionArtifact: preview.artifact,
      attestationEvidence: authority,
      runtimeAgentScope: "edi",
    });
    assert.equal(scopeDenied.reason, "scope_denied");

    const lifecycleDenied = evaluateDirectCardCapability({
      event: { senderIsOwner: true },
      canonicalMemory: {
        ...canonical,
        lifecycle: { ...canonical.lifecycle, state: "quarantined" },
      },
      projectionArtifact: preview.artifact,
      attestationEvidence: authority,
      runtimeAgentScope: "edi",
    });
    assert.equal(lifecycleDenied.reason, "blocked_lifecycle");
  } finally {
    fixture.close();
  }
});

test("selector cannot upgrade retrieval-only or insufficient evidence into a card", async () => {
  const fixture = createFixture();
  try {
    const result = await evaluate(fixture);
    const card = result.selected[0].card;
    const base = {
      memory_id: "direct-card-memory-001",
      canonical_id: "cmem:core:direct-card-memory-001",
      capability: "CARD_DISCLOSABLE",
      card,
    };
    assert.equal(
      selectDirectCardCandidates([{ ...base, retrieval: { rank: 0, sources: [] } }])[0].decision,
      "WITHHOLD",
    );
    assert.equal(
      selectDirectCardCandidates([{ ...base, retrieval: { rank: 1, sources: ["fts"] } }])[0].decision,
      "DISCLOSE_CARD",
    );
    assert.equal(
      selectDirectCardCandidates([{ ...base, capability: "RETRIEVAL_ONLY", retrieval: { rank: 1, sources: ["fts"] } }])[0].decision,
      "WITHHOLD",
    );
  } finally {
    fixture.close();
  }
});

test("card mode uses actual selections for prependContext and injection telemetry, with no fallback", async () => {
  const records = [
    {
      id: "direct-card-life-001",
      text: `OpenClaw memory-engine 5.20+ compatibility first ${SAFE_LONG_PREFIX}${SAFE_SENTINEL}`,
    },
    {
      id: "direct-card-life-002",
      text: "OpenClaw memory-engine 5.20+ compatibility second",
    },
  ];
  const fixture = createFixture({ attestIds: [records[0].id], records });
  const events = [];
  const hooks = [];
  const lifecycle = createAutoRecallHookLifecycle({
    api: {
      config: null,
      on(name, handler, options) {
        hooks.push({ name, handler, options });
      },
    },
    autoRecallConfig: {
      enabled: true,
      topK: 2,
      cardFirstRuntime: { enabled: true },
    },
    recordMemoryEvent: event => events.push(event),
    withDb: fn => fn({}),
    resolvePrefixes: (_db, ids) => ids,
    batchReinforce: () => 0,
    now: () => 1_756_000_000_000,
    randomUUID: () => "direct-card-trace-001",
  });
  const candidates = records.map((record, index) => fixture.candidateFor(record, index));
  const hybridRuntimeContext = createHybridRuntimeContext({
    dataAccess: {
      withDb: fn => fn({}),
      withHybridDbAccessScope: fixture.withHybridDbAccessScope,
      getLancedbTable: () => null,
      getLancedbRuntime: async () => ({ table: null, readyState: "ready" }),
      getMemorySearchManager: async () => ({ manager: null, error: null }),
    },
    retrievalPolicy: {
      apiConfig: null,
      calcRealtimeConf: () => 0.8,
      syncIndexIfNeeded: () => null,
      categoryMap: {},
      generateEmbedding: async () => [],
      hybridSearch: async () => ({
        results: candidates,
        debug: {
          query_stripped: "5.20+ memory-engine compatibility",
          strict_count: 2,
          fallback_count: 0,
          post_rerank_topK: candidates.map(candidate => ({ id: candidate.id, score: candidate.final_score })),
        },
      }),
    },
    telemetry: {
      recordMemoryEvent: event => events.push(event),
    },
  });

  try {
    lifecycle.register(hybridRuntimeContext);
    const beforePrompt = hooks.find(item => item.name === "before_prompt_build").handler;
    const result = await beforePrompt({
      prompt: "5.20+ memory-engine compatibility",
      senderIsOwner: true,
      runId: "direct-card-run-001",
      sessionId: "direct-card-session-001",
    }, {
      agentId: "edi",
      trigger: "user",
      runId: "direct-card-run-001",
      sessionId: "direct-card-session-001",
    });

    assert.match(result.prependContext, /direct-card-life-001/u);
    assert.doesNotMatch(result.prependContext, /direct-card-life-002/u);
    assert.doesNotMatch(result.prependContext, new RegExp(SAFE_SENTINEL, "u"));
    assert.doesNotMatch(result.prependContext, /get_token|full_content|source_text/u);

    const injected = events.filter(event => event.event_type === "memory_injected");
    assert.equal(injected.length, 1);
    assert.equal(injected[0].memory_id, "direct-card-life");
    const completed = events.filter(event => event.event_type === "recall_completed").at(-1);
    assert.equal(completed.injected_count, 1);
    const state = lifecycle.turnState.getTurnState("direct-card-run-001");
    assert.deepEqual(state.injectedIds, ["direct-card-life"]);
    assert.deepEqual(state.reinforcementAllowedIds, ["direct-card-life"]);

    fixture.engineDb.prepare("DELETE FROM disclosure_attestations").run();
    const missingAuthority = await beforePrompt({
      prompt: "5.20+ memory-engine compatibility",
      senderIsOwner: true,
      runId: "direct-card-run-002",
      sessionId: "direct-card-session-002",
    }, {
      agentId: "edi",
      trigger: "user",
      runId: "direct-card-run-002",
      sessionId: "direct-card-session-002",
    });
    assert.equal(missingAuthority?.prependContext, undefined);
    const secondCompleted = events.filter(event => event.event_type === "recall_completed").at(-1);
    assert.equal(secondCompleted.injected_count, 0);
    assert.equal(events.filter(event => event.event_type === "memory_injected").length, 1);
    const secondState = lifecycle.turnState.getTurnState("direct-card-run-002");
    assert.deepEqual(secondState.injectedIds, []);
    assert.deepEqual(secondState.reinforcementAllowedIds, []);
  } finally {
    fixture.close();
  }
});
