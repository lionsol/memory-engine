import test from "node:test";
import assert from "node:assert/strict";

import {
  computeLexicalConfidence,
  computeStructuredMatchBonus,
  enrichLexicalCandidate,
  resolveLexicalConfidenceThreshold,
  tokenizeQuery,
} from "../lib/recall/hybrid/lexical.js";

test("tokenizeQuery handles english, mixed language, and empty input", () => {
  assert.deepEqual(tokenizeQuery("memory engine vector search"), ["memory", "engine", "vector", "search"]);
  assert.deepEqual(tokenizeQuery("记忆 memory 检索 recall"), ["记忆", "memory", "检索", "recall"]);
  assert.deepEqual(tokenizeQuery(""), []);
});

test("tokenizeQuery keeps current duplicate handling", () => {
  assert.deepEqual(tokenizeQuery("memory memory engine"), ["memory", "engine"]);
});

test("computeStructuredMatchBonus scores category, file, module, and path matches", () => {
  const item = {
    path: "memory/projects/vector-search/session-checkpoint.md",
    category: "session_checkpoint",
  };
  const bonus = computeStructuredMatchBonus(item, ["session", "vector"], ["checkpoint"]);
  assert.equal(bonus, 0.4);
  assert.equal(computeStructuredMatchBonus(item, ["unmatched"], []), 0);
});

test("enrichLexicalCandidate adds lexical fields without changing core candidate identity", () => {
  const candidate = {
    id: "chunk-1",
    path: "memory/projects/vector-search.md",
    text: "Vector search design and retrieval details",
    category: "project",
    source_type: "memory-engine-managed",
    semantic_score: 0.5,
  };

  const enriched = enrichLexicalCandidate(candidate, {
    queryTerms: ["vector", "search"],
    exactFragments: ["retrieval details"],
  });

  assert.equal(enriched.id, candidate.id);
  assert.equal(enriched.path, candidate.path);
  assert.equal(enriched.category, candidate.category);
  assert.equal(enriched.source_type, candidate.source_type);
  assert.equal(enriched.token_coverage > 0, true);
  assert.equal(enriched.exact_bonus, 0.12);
  assert.equal(enriched.structured_match_bonus > 0, true);
  assert.equal(enriched.lexical_signal_score > 0, true);
});

test("computeLexicalConfidence preserves high and low lexical signal behavior", () => {
  const high = computeLexicalConfidence([{
    finalScore: 1.2,
    token_coverage: 1,
    exact_bonus: 0.36,
    structured_match_bonus: 0.4,
    channels: ["kg", "fts"],
  }]);
  const low = computeLexicalConfidence([{
    finalScore: 0.05,
    token_coverage: 0,
    exact_bonus: 0,
    structured_match_bonus: 0,
    channels: ["kg"],
  }]);
  const multi = computeLexicalConfidence([
    {
      finalScore: 0.9,
      token_coverage: 0.75,
      exact_bonus: 0.12,
      structured_match_bonus: 0.14,
      channels: ["kg", "fts"],
    },
    {
      finalScore: 0.5,
      token_coverage: 0.4,
      exact_bonus: 0,
      structured_match_bonus: 0.08,
      channels: ["fts"],
    },
  ]);

  assert.equal(high.lexical_candidate_count, 1);
  assert.equal(high.lexical_confidence, 0.9);
  assert.equal(low.lexical_confidence < 0.3, true);
  assert.equal(multi.lexical_candidate_count, 2);
  assert.equal(multi.lexical_confidence > low.lexical_confidence, true);
});

test("resolveLexicalConfidenceThreshold respects defaults and env override semantics", () => {
  const prev = process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD;
  try {
    delete process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD;
    assert.equal(resolveLexicalConfidenceThreshold(null, { recall: {} }), 0.7);

    process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD = "0.83";
    assert.equal(resolveLexicalConfidenceThreshold(null, { recall: {} }), 0.83);

    process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD = "not-a-number";
    assert.equal(resolveLexicalConfidenceThreshold(null, { recall: {} }), 0.7);
  } finally {
    if (prev === undefined) {
      delete process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD;
    } else {
      process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD = prev;
    }
  }
});

test("hybridSearch keeps lexical confidence driven vector skip debug fields", async () => {
  const { hybridSearch } = await import(`../lib/recall/hybrid-search.js?ts=${Date.now()}_${Math.random()}`);
  const result = await hybridSearch("session checkpoint project", { topK: 3 }, {
    cfg: {
      memory: { backend: "sqlite" },
      autoRecall: { lexicalConfidenceThreshold: 0.65 },
    },
    withDb: fn => fn({
      prepare(sql) {
        const q = String(sql);
        return {
          all(...args) {
            if (q.includes("SELECT chunk_id") && q.includes("FROM memory_confidence")) {
              return [{
                chunk_id: "chunk-1234567890abcdef",
                confidence: 0.9,
                last_confidence_update: 0,
                base_tau: 7,
                hit_count: 3,
                is_protected: 0,
                conflict_flag: 0,
                category: "episodic",
                is_archived: 0,
              }];
            }
            if (q.includes("SELECT id, path, updated_at FROM chunks")) {
              return [{
                id: "chunk-1234567890abcdef",
                path: "memory/episodes/session-checkpoint.md",
                updated_at: 1710000000,
              }];
            }
            if (q.includes("FROM memory_confidence mc") && q.includes("mc.kg_data LIKE")) {
              return [{
                id: "chunk-1234567890abcdef",
                text: "session checkpoint project note",
                path: "memory/episodes/session-checkpoint.md",
                updated_at: 1710000000,
                confidence: 0.9,
                last_confidence_update: 0,
                base_tau: 7,
                hit_count: 3,
                is_protected: 0,
                conflict_flag: 0,
                category: "episodic",
                is_archived: 0,
                kg_data: "session checkpoint project",
              }];
            }
            if (q.includes("FROM chunks_fts f")) {
              const query = String(args[0] || "");
              if (query.includes(" OR ")) return [];
              return [{
                id: "chunk-1234567890abcdef",
                text: "session checkpoint project note",
                path: "memory/episodes/session-checkpoint.md",
                updated_at: 1710000000,
                confidence: 0.9,
                last_confidence_update: 0,
                base_tau: 7,
                hit_count: 3,
                is_protected: 0,
                conflict_flag: 0,
                category: "episodic",
                is_archived: 0,
              }];
            }
            return [];
          },
        };
      },
    }),
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    getMemorySearchManager: async () => ({
      manager: {
        search: async () => ({ entries: [] }),
      },
    }),
  });

  assert.equal(result?.debug?.vector_skipped, true);
  assert.equal(result?.debug?.vector_skip_reason, "lexical_confidence_threshold_met");
  assert.equal(typeof result?.debug?.lexical_confidence, "number");
  assert.equal(result?.debug?.lexical_confidence >= result?.debug?.lexical_confidence_threshold, true);
});
