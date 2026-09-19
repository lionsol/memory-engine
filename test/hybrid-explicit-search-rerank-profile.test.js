import assert from "node:assert/strict";
import test from "node:test";

import {
  executeExplicitSearchRerankProfile,
  MEMORY_EXPLICIT_RERANK_CANONICAL_READ_FAILED,
  MEMORY_EXPLICIT_RERANK_PROJECTION_REJECTED,
  normalizeExplicitSearchRerankPolicy,
} from "../lib/recall/hybrid/explicit-search-rerank-profile.js";

const IDS = Object.freeze({
  a: "explicit-memory-a",
  b: "explicit-memory-b",
  archived: "explicit-memory-archived",
  outside: "explicit-memory-outside",
  external: "explicit-memory-external",
  empty: "explicit-memory-empty",
  emptyB: "explicit-memory-empty-b",
  missing: "explicit-memory-missing",
});

function coreRow(id, text = `CANONICAL FULL TEXT ${id}`) {
  return {
    id,
    path: `memory/${id}.md`,
    source: "memory",
    start_line: 1,
    end_line: 1,
    hash: `hash-${id}`,
    text,
    updated_at: 1780000000,
  };
}

function engineRow(id, overrides = {}) {
  return {
    chunk_id: id,
    initial_confidence: 0.9,
    confidence: 0.9,
    last_confidence_update: 1780000000,
    base_tau: 7,
    hit_count: 1,
    is_archived: 0,
    is_protected: 0,
    conflict_flag: 0,
    category: "project",
    ...overrides,
  };
}

function readonlyDb(rows, key) {
  return {
    readonly: true,
    prepare(sql) {
      if (sql === "PRAGMA database_list") {
        return { all: () => [{ name: "main" }] };
      }
      return {
        all: (...ids) => rows.filter(row => ids.includes(row[key])),
      };
    },
  };
}

function canonicalAccess({ coreRows, engineRows, invalidTopology = false }) {
  const core = invalidTopology
    ? { readonly: false, prepare: () => ({ all: () => [] }) }
    : readonlyDb(coreRows, "id");
  const engine = invalidTopology
    ? { readonly: false, prepare: () => ({ all: () => [] }) }
    : readonlyDb(engineRows, "chunk_id");
  return {
    withCoreDb: callback => callback(core),
    withEngineDb: callback => callback(engine),
  };
}

function fusedItem(id, overrides = {}) {
  return {
    id,
    text: `preview-${id}`,
    path: `memory/${id}.md`,
    category: "project",
    confidence_mode: "managed",
    source_type: "memory-engine-managed",
    decay_eligible: true,
    archive_eligible: true,
    semanticScore: 0.8,
    rrfScore: 0.8,
    recencyBoost: 0,
    categoryBoost: 0,
    confidenceBoost: 0,
    externalBoost: 0,
    finalScore: 0.8,
    sources: ["vector"],
    similarity: 0.8,
    confidence: 0.9,
    created_at: 1780000000,
    ...overrides,
  };
}

function policy(topK, overrides = {}) {
  return normalizeExplicitSearchRerankPolicy({
    enabled: true,
    mode: "rerank",
    candidateDepth: Math.max(topK, 3),
    maxCodePointsPerCandidate: 8000,
    maxTotalCodePoints: 400000,
    deadlineMs: 100,
    adapterIdentity: { provider: "fake", model: "explicit-r3", revision: null },
    adapter: async (_query, texts) => ({
      scores: texts.map((_, index) => ({ index, score: texts.length - index })),
      identity: { provider: "fake", model: "explicit-r3", revision: null },
    }),
    ...overrides,
  }, topK);
}

async function executeDirect({
  ids,
  topK,
  profile: explicitProfile,
  coreRows = ids.filter(id => id !== IDS.missing).map(id => coreRow(id)),
  engineRows = ids
    .filter(id => id !== IDS.missing && id !== IDS.external)
    .map(id => engineRow(id)),
  invalidTopology = false,
} = {}) {
  const access = canonicalAccess({ coreRows, engineRows, invalidTopology });
  return executeExplicitSearchRerankProfile({
    query: "explicit search query",
    fusedSorted: ids.map(id => fusedItem(id)),
    topK,
    profile: explicitProfile,
    ...access,
  });
}

test("bounded valid pool excludes missing candidates, admits deeper in-bound candidates, and never refills", async () => {
  const adapterTexts = [];
  const explicitProfile = policy(3, {
    candidateDepth: 3,
    adapter: async (_query, texts) => {
      adapterTexts.push(...texts);
      return {
        scores: texts.map((text, index) => ({
          index,
          score: text.includes(IDS.b) ? 9 : 1,
        })),
        identity: { provider: "fake", model: "explicit-r3", revision: null },
      };
    },
  });
  const result = await executeDirect({
    ids: [IDS.a, IDS.missing, IDS.b, IDS.outside],
    topK: 3,
    profile: explicitProfile,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.results.map(item => item.memory_id), [IDS.b, IDS.a]);
  assert.deepEqual(adapterTexts, [
    `CANONICAL FULL TEXT ${IDS.a}`,
    `CANONICAL FULL TEXT ${IDS.b}`,
  ]);
  assert.equal(result.results.some(item => item.memory_id === IDS.outside), false);
  assert.deepEqual(result.debug.limits, {
    candidate_depth: 3,
    max_code_points_per_candidate: 8000,
    max_total_code_points: 400000,
    deadline_ms: 100,
  });
  assert.deepEqual(result.debug.canonical_pool, {
    bounded_candidate_count: 3,
    eligible_candidate_count: 3,
    requested_count: 3,
    resolved_count: 2,
    valid_count: 2,
    excluded_count: 1,
    excluded_reasons: { core_not_found: 1 },
  });
  assert.deepEqual(result.debug.final_serving, {
    top_k: 3,
    served_count: 2,
    top_k_truncation_count: 0,
  });
  assert.equal(result.canonicalProjection.dropped_count, 0);
  assert.equal(JSON.stringify(result).includes("CANONICAL FULL TEXT"), false);
  assert.equal(result.results[0].canonical_id, `cmem:core:${IDS.b}`);
});

test("control and rerank use identical valid canonical pools while only rerank changes order", async () => {
  const control = await executeDirect({
    ids: [IDS.a, IDS.missing, IDS.b],
    topK: 3,
    profile: normalizeExplicitSearchRerankPolicy({
      enabled: true,
      mode: "control",
      candidateDepth: 3,
      maxCodePointsPerCandidate: 8000,
      maxTotalCodePoints: 400000,
      deadlineMs: 100,
      adapterIdentity: { provider: "fake", model: "explicit-r3", revision: null },
      adapter: async () => { throw new Error("control must not call adapter"); },
    }, 3),
  });
  const reranked = await executeDirect({
    ids: [IDS.a, IDS.missing, IDS.b],
    topK: 3,
    profile: policy(3, {
      adapter: async (_query, texts) => ({
        scores: texts.map((_, index) => ({ index, score: index === 1 ? 9 : 1 })),
        identity: { provider: "fake", model: "explicit-r3", revision: null },
      }),
    }),
  });

  assert.deepEqual(reranked.debug.canonical_pool, control.debug.canonical_pool);
  assert.deepEqual(new Set(reranked.results.map(item => item.memory_id)), new Set(control.results.map(item => item.memory_id)));
  assert.deepEqual(control.results.map(item => item.memory_id), [IDS.a, IDS.b]);
  assert.deepEqual(reranked.results.map(item => item.memory_id), [IDS.b, IDS.a]);
});

test("managed archived candidates are excluded before adapter and external canonical memories stay external", async () => {
  const adapterTexts = [];
  const explicitProfile = policy(3, {
    adapter: async (_query, texts) => {
      adapterTexts.push(...texts);
      throw new Error("force same-profile fallback");
    },
  });
  const result = await executeDirect({
    ids: [IDS.archived, IDS.external, IDS.a],
    topK: 3,
    profile: explicitProfile,
    coreRows: [coreRow(IDS.archived), coreRow(IDS.external), coreRow(IDS.a)],
    engineRows: [
      engineRow(IDS.archived, { is_archived: 1 }),
      engineRow(IDS.a),
    ],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(adapterTexts, [
    `CANONICAL FULL TEXT ${IDS.external}`,
    `CANONICAL FULL TEXT ${IDS.a}`,
  ]);
  assert.deepEqual(result.debug.canonical_pool.excluded_reasons, { canonical_archived: 1 });
  assert.deepEqual(result.results.map(item => item.memory_id), [IDS.external, IDS.a]);
  assert.equal(result.results[0].confidence_mode, "external");
  assert.equal(result.results[0].external_badge, true);
  assert.equal(result.debug.rerank.reason, "adapter_error");
  assert.equal(result.debug.rerank.score_state, "all_null");
});

test("external archive-looking retrieval metadata does not override canonical external lifecycle", async () => {
  const result = await executeExplicitSearchRerankProfile({
    query: "external archive-looking query",
    fusedSorted: [fusedItem(IDS.external, {
      confidence_mode: "external",
      source_type: "openclaw-core",
      is_archived: 1,
      archived: true,
      archive_status: "archived",
      lifecycle: { management: "managed", archived: true },
      archive_eligible: false,
    })],
    topK: 1,
    profile: policy(1),
    ...canonicalAccess({
      coreRows: [coreRow(IDS.external)],
      engineRows: [],
    }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.results.map(item => item.memory_id), [IDS.external]);
  assert.equal(result.results[0].confidence_mode, "external");
  assert.equal(result.debug.canonical_pool.excluded_count, 0);
});

test("canonical batch failure is explicit and never invokes the adapter", async () => {
  let adapterCalls = 0;
  const explicitProfile = policy(1, {
    candidateDepth: 1,
    adapter: async () => {
      adapterCalls += 1;
      return { scores: [{ index: 0, score: 1 }] };
    },
  });
  const result = await executeDirect({
    ids: [IDS.a],
    topK: 1,
    profile: explicitProfile,
    invalidTopology: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, MEMORY_EXPLICIT_RERANK_CANONICAL_READ_FAILED);
  assert.equal(result.error, MEMORY_EXPLICIT_RERANK_CANONICAL_READ_FAILED);
  assert.equal(adapterCalls, 0);
  assert.equal(result.debug.rerank.status, "not_attempted");
});

test("projection rejection is explicit and all valid candidates remain undisclosed", async () => {
  let adapterCalls = 0;
  const explicitProfile = policy(2, {
    candidateDepth: 2,
    maxCodePointsPerCandidate: 2,
    maxTotalCodePoints: 3,
    adapter: async () => {
      adapterCalls += 1;
      return { scores: [{ index: 0, score: 1 }, { index: 1, score: 0 }] };
    },
  });
  const result = await executeDirect({
    ids: [IDS.a, IDS.b],
    topK: 2,
    profile: explicitProfile,
    coreRows: [coreRow(IDS.a, "abcd"), coreRow(IDS.b, "efgh")],
    engineRows: [engineRow(IDS.a), engineRow(IDS.b)],
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, MEMORY_EXPLICIT_RERANK_PROJECTION_REJECTED);
  assert.equal(adapterCalls, 0);
  assert.equal(JSON.stringify(result).includes("abcd"), false);
  assert.equal(result.debug.rerank.reason, "projection_rejected");
});

test("adapter failures atomically fall back to the same valid-pool control order", async () => {
  const cases = [
    ["adapter_error", async () => { throw new Error("fake adapter error"); }],
    ["invalid_response", async () => ({ scores: [{ index: 0, score: 1 }] })],
    ["adapter_identity_conflict", async () => ({
      scores: [{ index: 0, score: 1 }, { index: 1, score: 2 }],
      identity: { provider: "wrong", model: "wrong", revision: null },
    })],
  ];
  for (const [expectedReason, adapter] of cases) {
    const result = await executeDirect({
      ids: [IDS.a, IDS.b],
      topK: 2,
      profile: policy(2, { candidateDepth: 2, adapter }),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.results.map(item => item.memory_id), [IDS.a, IDS.b]);
    assert.equal(result.debug.rerank.status, "fallback");
    assert.equal(result.debug.rerank.reason, expectedReason);
    assert.equal(result.debug.rerank.score_state, "all_null");
  }
});

test("bounded adapter error code survives atomic fallback into explicit-search debug", async () => {
  const result = await executeDirect({
    ids: [IDS.a, IDS.b],
    topK: 2,
    profile: policy(2, {
      candidateDepth: 2,
      adapter: async () => ({
        scores: null,
        adapterErrorCode: "SILICONFLOW_RERANK_INDEX_DUPLICATE",
      }),
    }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.results.map(item => item.memory_id), [IDS.a, IDS.b]);
  assert.equal(result.debug.rerank.status, "fallback");
  assert.equal(result.debug.rerank.reason, "invalid_response");
  assert.equal(
    result.debug.rerank.adapter_error_code,
    "SILICONFLOW_RERANK_INDEX_DUPLICATE",
  );
});

test("observed adapter identity is bounded before it reaches debug diagnostics", async () => {
  const matchingWithExtras = await executeDirect({
    ids: [IDS.a],
    topK: 1,
    profile: policy(1, {
      candidateDepth: 1,
      adapter: async () => ({
        scores: [{ index: 0, score: 1 }],
        identity: {
          provider: "fake",
          model: "explicit-r3",
          revision: null,
          apiKey: "secret-api-key",
          rawText: "must-not-appear",
        },
      }),
    }),
  });

  assert.equal(matchingWithExtras.debug.rerank.status, "applied");
  assert.deepEqual(matchingWithExtras.debug.rerank.observed_adapter_identity, {
    provider: "fake",
    model: "explicit-r3",
    revision: null,
  });
  assert.equal(JSON.stringify(matchingWithExtras.debug).includes("secret-api-key"), false);
  assert.equal(JSON.stringify(matchingWithExtras.debug).includes("must-not-appear"), false);

  const malformedIdentity = {
    provider: "fake",
    model: { rawText: "malformed-model" },
    revision: null,
    endpoint: "https://must-not-appear",
  };
  const malformed = await executeDirect({
    ids: [IDS.a, IDS.b],
    topK: 2,
    profile: policy(2, {
      candidateDepth: 2,
      adapter: async () => ({
        scores: [{ index: 0, score: 1 }, { index: 1, score: 0 }],
        identity: malformedIdentity,
      }),
    }),
  });

  assert.equal(malformed.debug.rerank.status, "fallback");
  assert.equal(malformed.debug.rerank.reason, "adapter_identity_conflict");
  assert.deepEqual(malformed.debug.rerank.observed_adapter_identity, {
    provider: "fake",
    model: null,
    revision: null,
  });
  assert.equal(JSON.stringify(malformed.debug).includes("malformed-model"), false);
  assert.equal(JSON.stringify(malformed.debug).includes("https://must-not-appear"), false);
});

test("timeout returns control immediately and late settlement cannot mutate the result", async () => {
  let resolveLate;
  const late = new Promise(resolve => { resolveLate = resolve; });
  const result = await executeDirect({
    ids: [IDS.a, IDS.b],
    topK: 2,
    profile: policy(2, {
      candidateDepth: 2,
      deadlineMs: 10,
      adapter: async () => late,
    }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.results.map(item => item.memory_id), [IDS.a, IDS.b]);
  assert.equal(result.debug.rerank.status, "fallback");
  assert.equal(result.debug.rerank.reason, "timeout");
  assert.equal(result.debug.rerank.score_state, "all_null");

  resolveLate({
    scores: [{ index: 0, score: 99 }, { index: 1, score: 98 }],
    identity: { provider: "fake", model: "explicit-r3", revision: null },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(result.results.map(item => item.memory_id), [IDS.a, IDS.b]);
});

test("all-empty canonical text bypasses the adapter and preserves candidate order", async () => {
  let adapterCalls = 0;
  const result = await executeDirect({
    ids: [IDS.empty, IDS.emptyB],
    topK: 2,
    profile: policy(2, {
      candidateDepth: 2,
      adapter: async () => {
        adapterCalls += 1;
        return { scores: [] };
      },
    }),
    coreRows: [coreRow(IDS.empty, ""), coreRow(IDS.emptyB, "")],
    engineRows: [engineRow(IDS.empty), engineRow(IDS.emptyB)],
  });

  assert.equal(result.ok, true);
  assert.equal(adapterCalls, 0);
  assert.deepEqual(result.results.map(item => item.memory_id), [IDS.empty, IDS.emptyB]);
  assert.equal(result.debug.rerank.reason, "all_text_empty");
});
