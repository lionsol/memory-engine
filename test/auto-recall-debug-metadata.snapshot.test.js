import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { buildFtsFallbackQuery, normalizeFtsQuery, stripPromptMetadataPrefix } from "../query-utils.js";

function extractFunctionSource(code, functionName) {
  const marker = `function ${functionName}(`;
  const start = code.indexOf(marker);
  if (start < 0) throw new Error(`function not found: ${functionName}`);
  const parenStart = code.indexOf("(", start);
  let parenDepth = 0;
  let parenEnd = -1;
  for (let i = parenStart; i < code.length; i += 1) {
    if (code[i] === "(") parenDepth += 1;
    if (code[i] === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        parenEnd = i;
        break;
      }
    }
  }
  const braceStart = code.indexOf("{", parenEnd);
  if (braceStart < 0) throw new Error(`function body not found: ${functionName}`);
  let depth = 0;
  for (let i = braceStart; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) return code.slice(start, i + 1);
  }
  throw new Error(`function parse failed: ${functionName}`);
}

function loadMetadataBuilder() {
  const indexCode = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  const source = extractFunctionSource(indexCode, "buildAutoRecallDebugMetadata");
  const context = {
    buildFtsFallbackQuery,
    normalizeFtsQuery,
    stripPromptMetadataPrefix,
  };
  vm.runInNewContext(`${source}\nthis.__fn = buildAutoRecallDebugMetadata;`, context);
  return context.__fn;
}

test("autoRecall debug metadata snapshot stays stable", () => {
  const fn = loadMetadataBuilder();

  const result = fn("5.20+ 和 memory-engine 兼容性", {
    results: [{ id: "a" }, { id: "b" }],
    debug: {
      query_original: "orig",
      query_stripped: "stripped",
      query_normalized: "norm",
      fts_query_final: "fts",
      vector_backend: "lancedb",
      vector_backend_attempted: "lancedb",
      vector_ready_state: "ready",
      vector_stage: "lancedb_search",
      vector_skipped: false,
      vector_skip_reason: null,
      vector_error: null,
      vector_warning: "table_missing",
      vector_ms: 12.3,
      vector_query_length: 8,
      lexical_candidate_count: 4,
      lexical_top_score: 0.93,
      lexical_confidence: 0.81,
      fallbacks_triggered: ["fts_empty"],
      strict_count: 1,
      fallback_count: 2,
      post_rerank_topK: [{ id: "x", score: 0.9 }],
      candidate_count_before_gate: 5,
      candidate_count_after_gate: 2,
      rejected_candidates: [{ id: "r1" }],
      gate_decisions: [{ id: "g1" }],
      injected_count: 2,
      candidate_counts_before_filtering: { vector_raw: 3 },
    },
  });

  assert.equal(
    JSON.stringify(result, null, 2),
    `{
  "query_original": "5.20+ 和 memory-engine 兼容性",
  "query_stripped": "stripped",
  "query_normalized": "norm",
  "fts_query_final": "fts",
  "vector_backend": "lancedb",
  "vector_ready_state": "ready",
  "vector_backend_attempted": "lancedb",
  "vector_stage": "lancedb_search",
  "vector_skipped": false,
  "vector_skip_reason": null,
  "vector_error": null,
  "vector_warning": "table_missing",
  "vector_ms": 12.3,
  "vector_query_length": 8,
  "lexical_candidate_count": 4,
  "lexical_top_score": 0.93,
  "lexical_confidence": 0.81,
  "fallbacks_triggered": [
    "fts_empty"
  ],
  "candidate_count": 2,
  "strict_count": 1,
  "fallback_count": 2,
  "post_rerank_count": 1,
  "post_rerank_topK": [
    {
      "id": "x",
      "score": 0.9
    }
  ],
  "candidate_count_before_gate": 5,
  "candidate_count_after_gate": 2,
  "rejected_candidates": [
    {
      "id": "r1"
    }
  ],
  "gate_decisions": [
    {
      "id": "g1"
    }
  ],
  "injected_count": 2,
  "recall_intent_should_recall": null,
  "recall_intent_reason": null,
  "long_input_detected": null,
  "generic_task_detected": null,
  "focused_query": null,
  "focused_query_chars": null,
  "original_input_chars": null,
  "skipped_by_recall_intent": false,
  "skipped": false,
  "skip_reason": null,
  "candidate_counts_before_filtering": {
    "vector_raw": 3
  }
}`
  );
});

test("autoRecall debug metadata includes vector_init_error only when present", () => {
  const fn = loadMetadataBuilder();

  const failedResult = fn("query", {
    results: [],
    debug: {
      query_stripped: "query",
      vector_ready_state: "failed",
      vector_init_error: "lancedb init failed",
    },
  });
  const readyResult = fn("query", {
    results: [],
    debug: {
      query_stripped: "query",
      vector_ready_state: "ready",
    },
  });

  assert.equal(failedResult.vector_init_error, "lancedb init failed");
  assert.equal(Object.prototype.hasOwnProperty.call(readyResult, "vector_init_error"), false);
});

test("autoRecall debug metadata includes recall intent telemetry fields", () => {
  const fn = loadMetadataBuilder();

  const result = fn("full prompt", {
    results: [],
    debug: {
      query_stripped: "memory-engine 当前基线 review",
      recall_intent_should_recall: true,
      recall_intent_reason: "long_input_with_history_context_use_focused_query",
      long_input_detected: true,
      generic_task_detected: false,
      focused_query: "memory-engine 当前基线 review",
      focused_query_chars: 27,
      original_input_chars: 3200,
      skipped_by_recall_intent: false,
    },
  });

  assert.equal(result.recall_intent_should_recall, true);
  assert.equal(result.recall_intent_reason, "long_input_with_history_context_use_focused_query");
  assert.equal(result.long_input_detected, true);
  assert.equal(result.focused_query, "memory-engine 当前基线 review");
  assert.equal(result.focused_query_chars, 27);
  assert.equal(result.original_input_chars, 3200);
  assert.equal(result.skipped_by_recall_intent, false);
});

test("executed Hybrid access metadata is persisted with stable fallback summary", () => {
  const fn = loadMetadataBuilder();
  const persisted = {
    event_type: "auto_recall_debug",
    metadata_json: fn("query", {
      results: [],
      debug: {
        kg_access_mode: "legacy_fallback",
        kg_isolated_fallback_reason: "text_id_invariant_failed",
        recent_access_mode: "guarded_fallback",
        recent_isolated_fallback_reason: "isolated_recent_engine_id_invariant_failed",
      },
    }, null, { searchExecuted: true }),
  };

  assert.equal(
    JSON.stringify({
      kg_access_mode: persisted.metadata_json.kg_access_mode,
      kg_isolated_fallback_reason: persisted.metadata_json.kg_isolated_fallback_reason,
      kg_isolation_fallback_reason: persisted.metadata_json.kg_isolation_fallback_reason,
      recent_access_mode: persisted.metadata_json.recent_access_mode,
      recent_isolated_fallback_reason: persisted.metadata_json.recent_isolated_fallback_reason,
      recent_isolation_fallback_reason: persisted.metadata_json.recent_isolation_fallback_reason,
      legacy_db_fallback_used: persisted.metadata_json.legacy_db_fallback_used,
      legacy_db_fallback_channels: persisted.metadata_json.legacy_db_fallback_channels,
    }),
    JSON.stringify({
      kg_access_mode: "legacy_fallback",
      kg_isolated_fallback_reason: "text_id_invariant_failed",
      kg_isolation_fallback_reason: "text_id_invariant_failed",
      recent_access_mode: "guarded_fallback",
      recent_isolated_fallback_reason: "isolated_recent_engine_id_invariant_failed",
      recent_isolation_fallback_reason: "isolated_recent_engine_id_invariant_failed",
      legacy_db_fallback_used: true,
      legacy_db_fallback_channels: ["kg", "recent"],
    }),
  );
});

test("isolated access metadata persists modes and empty summary", () => {
  const fn = loadMetadataBuilder();
  const metadata = fn("query", {
    results: [],
    debug: {
      kg_access_mode: "isolated",
      recent_access_mode: "isolated",
    },
  }, null, { searchExecuted: true });

  assert.equal(metadata.kg_access_mode, "isolated");
  assert.equal(metadata.kg_isolated_fallback_reason, null);
  assert.equal(metadata.kg_isolation_fallback_reason, null);
  assert.equal(metadata.recent_access_mode, "isolated");
  assert.equal(metadata.recent_isolated_fallback_reason, null);
  assert.equal(metadata.recent_isolation_fallback_reason, null);
  assert.equal(metadata.legacy_db_fallback_used, false);
  assert.equal(JSON.stringify(metadata.legacy_db_fallback_channels), "[]");
});

test("KG-only and Recent-only fallback summaries preserve channel order", () => {
  const fn = loadMetadataBuilder();
  const kgOnly = fn("query", {
    results: [],
    debug: {
      kg_access_mode: "legacy_fallback",
      kg_isolated_fallback_reason: "text_id_invariant_failed",
      recent_access_mode: "isolated",
    },
  }, null, { searchExecuted: true });
  const recentOnly = fn("query", {
    results: [],
    debug: {
      kg_access_mode: "isolated",
      recent_access_mode: "guarded_fallback",
      recent_isolated_fallback_reason: "isolated_recent_topology_guard_failed",
    },
  }, null, { searchExecuted: true });

  assert.equal(kgOnly.legacy_db_fallback_used, true);
  assert.equal(kgOnly.kg_isolation_fallback_reason, "text_id_invariant_failed");
  assert.equal(JSON.stringify(kgOnly.legacy_db_fallback_channels), '["kg"]');
  assert.equal(recentOnly.legacy_db_fallback_used, true);
  assert.equal(recentOnly.recent_isolation_fallback_reason, "isolated_recent_topology_guard_failed");
  assert.equal(JSON.stringify(recentOnly.legacy_db_fallback_channels), '["recent"]');
});

test("partial channel debug does not infer missing access or fallback", () => {
  const fn = loadMetadataBuilder();
  const metadata = fn("query", {
    results: [],
    debug: {
      kg_access_mode: "isolated",
      kg_isolated_fallback_reason: null,
      recent_error: "recent query failed",
    },
  }, null, { searchExecuted: true });

  assert.equal(metadata.kg_access_mode, "isolated");
  assert.equal(metadata.kg_isolation_fallback_reason, null);
  assert.equal(Object.hasOwn(metadata, "recent_access_mode"), false);
  assert.equal(metadata.legacy_db_fallback_used, false);
  assert.equal(JSON.stringify(metadata.legacy_db_fallback_channels), "[]");
});

test("pre-search skip does not fabricate Hybrid access metadata", () => {
  const fn = loadMetadataBuilder();
  const metadata = fn("query", null, "intent_gate");

  assert.equal(Object.hasOwn(metadata, "kg_access_mode"), false);
  assert.equal(Object.hasOwn(metadata, "recent_access_mode"), false);
  assert.equal(Object.hasOwn(metadata, "legacy_db_fallback_used"), false);
  assert.equal(metadata.skipped, true);
  assert.equal(metadata.skip_reason, "intent_gate");
});

test("channel error without a fallback remains non-fallback", () => {
  const fn = loadMetadataBuilder();
  const metadata = fn("query", {
    results: [],
    debug: {
      kg_access_mode: "isolated",
      recent_access_mode: "isolated",
      recent_error: "malformed query",
    },
  }, null, { searchExecuted: true });

  assert.equal(metadata.recent_error, undefined);
  assert.equal(metadata.legacy_db_fallback_used, false);
  assert.equal(JSON.stringify(metadata.legacy_db_fallback_channels), "[]");
});
