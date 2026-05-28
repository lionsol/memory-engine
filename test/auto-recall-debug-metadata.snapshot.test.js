import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { buildFtsFallbackQuery, normalizeFtsQuery, stripPromptMetadataPrefix } from "../query-utils.js";

function extractFunctionSource(code, functionName) {
  const marker = `function ${functionName}(`;
  const start = code.indexOf(marker);
  if (start < 0) throw new Error(`function not found: ${functionName}`);
  const braceStart = code.indexOf("{", start);
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

test("autoRecall debug metadata snapshot stays stable", () => {
  const indexCode = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  const source = extractFunctionSource(indexCode, "buildAutoRecallDebugMetadata");
  const context = {
    buildFtsFallbackQuery,
    normalizeFtsQuery,
    stripPromptMetadataPrefix,
  };
  vm.runInNewContext(`${source}\nthis.__fn = buildAutoRecallDebugMetadata;`, context);
  const fn = context.__fn;

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
      vector_error: null,
      vector_warning: "table_missing",
      vector_ms: 12.3,
      vector_query_length: 8,
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
  "vector_error": null,
  "vector_warning": "table_missing",
  "vector_ms": 12.3,
  "vector_query_length": 8,
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
  "skipped": false,
  "skip_reason": null,
  "candidate_counts_before_filtering": {
    "vector_raw": 3
  }
}`
  );
});

test("autoRecall debug metadata includes vector_init_error only when present", () => {
  const indexCode = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  const source = extractFunctionSource(indexCode, "buildAutoRecallDebugMetadata");
  const context = {
    buildFtsFallbackQuery,
    normalizeFtsQuery,
    stripPromptMetadataPrefix,
  };
  vm.runInNewContext(`${source}\nthis.__fn = buildAutoRecallDebugMetadata;`, context);
  const fn = context.__fn;

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
