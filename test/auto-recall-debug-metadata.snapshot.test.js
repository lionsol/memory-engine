import test from "node:test";
import assert from "node:assert/strict";

import { buildAutoRecallDebugMetadata } from "../lib/recall/auto-recall-debug-metadata.js";

function loadMetadataBuilder() {
  return buildAutoRecallDebugMetadata;
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
  "original_input_chars": 25,
  "query_stripped_chars": 8,
  "query_normalized_chars": 4,
  "fts_query_chars": 3,
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
  "focused_query_chars": 0,
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

test("autoRecall debug metadata preserves bounded fallback rerank source and count", () => {
  const metadata = buildAutoRecallDebugMetadata("query", {
    results: [],
    debug: {
      fts_rerank_term_source: "bounded_fallback",
      fts_rerank_term_count: 8,
    },
  });

  assert.equal(metadata.fts_rerank_term_source, "bounded_fallback");
  assert.equal(metadata.fts_rerank_term_count, 8);
});

test("autoRecall debug metadata preserves bounded preselection counters", () => {
  const metadata = buildAutoRecallDebugMetadata("query", {
    results: [],
    debug: {
      fts_preselection_strategy: "global_or_plus_term_probes_v1",
      fts_preselection_global_count: 20,
      fts_preselection_probe_query_count: 8,
      fts_preselection_probe_raw_count: 15,
      fts_preselection_union_count: 21,
      fts_preselection_probe_per_term_limit: 2,
      fts_preselection_post_rerank_count: 20,
    },
  });

  assert.deepEqual(
    {
      strategy: metadata.fts_preselection_strategy,
      global: metadata.fts_preselection_global_count,
      probeQueries: metadata.fts_preselection_probe_query_count,
      probeRaw: metadata.fts_preselection_probe_raw_count,
      union: metadata.fts_preselection_union_count,
      perTerm: metadata.fts_preselection_probe_per_term_limit,
      postRerank: metadata.fts_preselection_post_rerank_count,
    },
    {
      strategy: "global_or_plus_term_probes_v1",
      global: 20,
      probeQueries: 8,
      probeRaw: 15,
      union: 21,
      perTerm: 2,
      postRerank: 20,
    },
  );
});

test("autoRecall debug metadata includes recall intent telemetry fields", () => {
  const fn = loadMetadataBuilder();

  const result = fn("full prompt", {
    results: [],
    debug: {
      query_stripped: "memory-engine 当前基线 review",
      recall_intent_should_recall: true,
      recall_intent_reason: "long_input_with_history_context_use_focused_query",
      task_intent: "review_plan",
      recall_intent: ["project_state", "prior_decision"],
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
  assert.equal(result.task_intent, "review_plan");
  assert.deepEqual(result.recall_intent, ["project_state", "prior_decision"]);
  assert.equal(result.long_input_detected, true);
  assert.equal(result.focused_query_chars, 27);
  assert.equal(result.original_input_chars, 3200);
  assert.equal(Object.hasOwn(result, "query_original"), false);
  assert.equal(Object.hasOwn(result, "query_stripped"), false);
  assert.equal(Object.hasOwn(result, "query_normalized"), false);
  assert.equal(Object.hasOwn(result, "fts_query_final"), false);
  assert.equal(Object.hasOwn(result, "focused_query"), false);
  assert.equal(result.query_stripped_chars > 0, true);
  assert.equal(result.query_normalized_chars > 0, true);
  assert.equal(result.fts_query_chars > 0, true);
  assert.equal(result.skipped_by_recall_intent, false);
});

test("autoRecall debug metadata bounds intent values to the shared contract", () => {
  const metadata = buildAutoRecallDebugMetadata("query", {
    results: [],
    debug: {
      task_intent: "not_a_task_intent",
      recall_intent: ["not_a_recall_intent"],
    },
  });

  assert.equal(metadata.task_intent, null);
  assert.deepEqual(metadata.recall_intent, []);
  assert.equal(Object.hasOwn(metadata, "prompt"), false);
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

test("AutoRecall persists bounded ID-only channel and fusion provenance", () => {
  const channelIds = Array.from({ length: 2 }, (_, index) => `fts-${index}-long-id`);
  const vectorIds = Array.from({ length: 33 }, (_, index) => `vector-${String(index).padStart(2, "0")}-long-id`);
  const metadata = buildAutoRecallDebugMetadata("PRIVATE_PROMPT_SECRET", {
    results: [],
    debug: {
      channel_candidate_provenance: {
        fts: {
          count: channelIds.length,
          captured_count: channelIds.length,
          truncated: false,
          ids: channelIds,
          text: "MEMORY_BODY_SECRET",
          preview: "PREVIEW_SECRET",
          path: "PATH_SECRET",
        },
        vector: {
          count: vectorIds.length,
          captured_count: 33,
          truncated: true,
          ids: vectorIds,
          candidate_metadata: {
            prompt: "QUERY_SECRET",
            exact_fragment: "FRAGMENT_SECRET",
          },
        },
      },
      fusion_candidate_provenance: {
        pre_rerank_ids: Array.from({ length: 10 }, (_, index) => ({
          id: `pre-${index}-long-id`,
          text: "PRE_RERANK_TEXT_SECRET",
          path: "PRE_RERANK_PATH_SECRET",
        })),
        post_rerank_ids: Array.from({ length: 9 }, (_, index) => ({
          id: `post-${index}-long-id`,
          preview: "POST_RERANK_PREVIEW_SECRET",
        })),
      },
    },
  });

  assert.deepEqual(metadata.channel_candidate_provenance.fts, {
    count: 2,
    captured_count: 2,
    truncated: false,
    ids: channelIds.map(id => id.slice(0, 16)),
  });
  assert.deepEqual(metadata.channel_candidate_provenance.vector, {
    count: 33,
    captured_count: 32,
    truncated: true,
    ids: vectorIds.slice(0, 32).map(id => id.slice(0, 16)),
  });
  assert.equal(metadata.channel_candidate_provenance.vector.ids.length, 32);
  assert.deepEqual(metadata.fusion_candidate_provenance, {
    pre_rerank_ids: Array.from({ length: 8 }, (_, index) => `pre-${index}-long-id`.slice(0, 16)),
    post_rerank_ids: Array.from({ length: 8 }, (_, index) => `post-${index}-long-id`.slice(0, 16)),
  });

  const serialized = JSON.stringify(metadata);
  for (const secret of [
    "PRIVATE_PROMPT_SECRET",
    "MEMORY_BODY_SECRET",
    "PREVIEW_SECRET",
    "PATH_SECRET",
    "QUERY_SECRET",
    "FRAGMENT_SECRET",
    "PRE_RERANK_TEXT_SECRET",
    "PRE_RERANK_PATH_SECRET",
    "POST_RERANK_PREVIEW_SECRET",
  ]) assert.equal(serialized.includes(secret), false, secret);
  assert.deepEqual(Object.keys(metadata.channel_candidate_provenance.fts), [
    "count",
    "captured_count",
    "truncated",
    "ids",
  ]);
});

test("AutoRecall provenance projection completes capture at or below 32 IDs", () => {
  const ids = Array.from({ length: 32 }, (_, index) => `candidate-${String(index).padStart(2, "0")}`);
  const metadata = buildAutoRecallDebugMetadata("query", {
    results: [],
    debug: {
      channel_candidate_provenance: {
        recent: {
          count: ids.length,
          captured_count: 0,
          truncated: true,
          ids,
        },
      },
    },
  });

  assert.deepEqual(metadata.channel_candidate_provenance.recent, {
    count: 32,
    captured_count: 32,
    truncated: false,
    ids,
  });
});

test("DIRECT_CARD diagnostics use an explicit bounded whitelist", () => {
  const metadata = buildAutoRecallDebugMetadata("query", {
    results: [],
    debug: {
      direct_card_event_sender_is_owner: true,
      direct_card_owner_audience_authenticated: true,
      direct_card_selected_count: 2.9,
      direct_card_capability_results: Array.from({ length: 6 }, (_, index) => ({
        memory_id: `memory-${index}-full-identity`,
        capability: "CARD_DISCLOSABLE",
        reason: "r".repeat(140),
        card: "CARD_PAYLOAD_SECRET",
        source: "CANONICAL_SOURCE_SECRET",
        canonical: { text: "CANONICAL_BODY_SECRET" },
      })),
      direct_card_selections: Array.from({ length: 6 }, (_, index) => ({
        memory_id: `memory-${index}-full-identity`,
        decision: "DISCLOSE_CARD",
        reason: "d".repeat(140),
        card: { summary: "CARD_SUMMARY_SECRET" },
        source_text: "SOURCE_TEXT_SECRET",
      })),
      direct_card_boundary_error: "e".repeat(140),
      card_payload: "UNDECLARED_CARD_PAYLOAD",
      canonical_source: "UNDECLARED_SOURCE_TEXT",
    },
  });

  assert.equal(metadata.direct_card_event_sender_is_owner, true);
  assert.equal(metadata.direct_card_owner_audience_authenticated, true);
  assert.equal(metadata.direct_card_selected_count, 2);
  assert.equal(metadata.direct_card_capability_results.length, 3);
  assert.equal(metadata.direct_card_selections.length, 3);
  assert.equal(metadata.direct_card_capability_results[0].memory_id, "memory-0-full-id");
  assert.equal(metadata.direct_card_selections[0].memory_id, "memory-0-full-id");
  assert.equal(metadata.direct_card_capability_results[0].reason.length, 96);
  assert.equal(metadata.direct_card_selections[0].reason.length, 96);
  assert.equal(metadata.direct_card_boundary_error.length, 96);
  assert.deepEqual(Object.keys(metadata.direct_card_capability_results[0]).sort(), [
    "capability",
    "memory_id",
    "reason",
  ]);
  assert.deepEqual(Object.keys(metadata.direct_card_selections[0]).sort(), [
    "decision",
    "memory_id",
    "reason",
  ]);

  const serialized = JSON.stringify(metadata);
  for (const secret of [
    "CARD_PAYLOAD_SECRET",
    "CANONICAL_SOURCE_SECRET",
    "CANONICAL_BODY_SECRET",
    "CARD_SUMMARY_SECRET",
    "SOURCE_TEXT_SECRET",
    "UNDECLARED_CARD_PAYLOAD",
    "UNDECLARED_SOURCE_TEXT",
  ]) assert.equal(serialized.includes(secret), false, secret);
  assert.equal(Object.hasOwn(metadata, "card_payload"), false);
  assert.equal(Object.hasOwn(metadata, "canonical_source"), false);
});
