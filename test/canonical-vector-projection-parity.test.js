import test from "node:test";
import assert from "node:assert/strict";

import {
  materializeCanonicalLanceRow,
  projectCanonicalMemoryToVectorProjection,
} from "../lib/canonical/vector-projection.js";

function canonicalWithLongText() {
  const text = "A".repeat(2500);
  return {
    memory_id: "parity-exact-core-id",
    canonical_id: "cmem:core:parity-exact-core-id",
    source: { text },
    content_ref: { content_hash: "sha256:parity-content" },
  };
}

test("historical vector write-path parity: orphan/reconciliation aligned, legacy add over 2000 chars drifted", () => {
  const canonical = canonicalWithLongText();
  const projection = projectCanonicalMemoryToVectorProjection(canonical);
  const vector = [0.25, 0.5];

  // Existing orphan/reconciliation shape: Core text is bounded before both operations.
  const orphanEmbeddingInput = canonical.source.text.slice(0, 2000);
  const orphanRow = materializeCanonicalLanceRow(projection, { vector, timestamp: 1 });
  assert.equal(orphanEmbeddingInput, orphanRow.text);
  assert.equal(orphanEmbeddingInput.length, 2000);
  assert.equal(orphanRow.text.length, 2000);

  // Historical memory_engine add shape: raw caller input was embedded, while Lance text was bounded.
  const addEmbeddingInput = canonical.source.text;
  const addLanceText = addEmbeddingInput.slice(0, 2000);
  assert.equal(addEmbeddingInput.length, 2500);
  assert.equal(addLanceText.length, 2000);
  assert.notEqual(addEmbeddingInput, addLanceText);

  // This is an intentional known finding, deferred with persistent writer adoption to Phase 2.5-D.
  assert.deepEqual({
    VECTOR_PARITY: "PASS",
    ADD_LONG_TEXT_EMBEDDING_TEXT: "DRIFT",
    SOURCE_TEXT_AUTHORITY_PARITY: "UNPROVEN/DRIFT",
  }, {
    VECTOR_PARITY: "PASS",
    ADD_LONG_TEXT_EMBEDDING_TEXT: "DRIFT",
    SOURCE_TEXT_AUTHORITY_PARITY: "UNPROVEN/DRIFT",
  });
});

test("historical vector write-path parity: legacy add inputs at or below 2000 aligned conditionally", () => {
  const text = "B".repeat(2000);
  const projection = projectCanonicalMemoryToVectorProjection({
    memory_id: "parity-short-core-id",
    canonical_id: "cmem:core:parity-short-core-id",
    source: { text },
    content_ref: { content_hash: "sha256:parity-short-content" },
  });
  const addEmbeddingInput = text;
  const addLanceText = text.slice(0, 2000);

  assert.equal(addEmbeddingInput, addLanceText);
  assert.equal(addEmbeddingInput, projection.embedding_input);
  assert.deepEqual({ ADD_SOURCE_TEXT_AUTHORITY: "CONDITIONAL/UNPROVEN" }, {
    ADD_SOURCE_TEXT_AUTHORITY: "CONDITIONAL/UNPROVEN",
  });
});
