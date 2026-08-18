import test from "node:test";
import assert from "node:assert/strict";

import {
  CANONICAL_VECTOR_PROJECTION_VERSION,
  CANONICAL_VECTOR_TEXT_MAX_CHARS,
  materializeCanonicalLanceRow,
  projectCanonicalMemoryToVectorProjection,
} from "../lib/canonical/vector-projection.js";

function canonicalMemory(text = "canonical source text", overrides = {}) {
  return {
    schema_version: 1,
    memory_id: "exact-core-memory-id-012345678901234567890",
    canonical_id: "cmem:core:exact-core-memory-id-012345678901234567890",
    source: {
      path: "memory/projects/vector.md",
      line_start: 1,
      line_end: 2,
      text,
    },
    content_ref: {
      mode: "core_chunk",
      content_hash: "sha256:canonical-content-reference",
    },
    classification: {
      category: "project",
      kind: "project_state",
    },
    lifecycle: {
      management: "managed",
      confidence: 0.8,
    },
    ...overrides,
  };
}

test("canonical vector projection preserves exact identity and source hash", () => {
  const projection = projectCanonicalMemoryToVectorProjection(canonicalMemory("short canonical text"));

  assert.equal(projection.projection_version, CANONICAL_VECTOR_PROJECTION_VERSION);
  assert.equal(projection.memory_id, "exact-core-memory-id-012345678901234567890");
  assert.equal(projection.canonical_id, "cmem:core:exact-core-memory-id-012345678901234567890");
  assert.equal(projection.source_content_hash, "sha256:canonical-content-reference");
  assert.equal(projection.text, "short canonical text");
  assert.equal(projection.embedding_input, projection.text);
  assert.equal(projection.text_truncated, false);
  assert.equal(projection.source_text_length, "short canonical text".length);
});

test("vector projection truncates only the downstream text projection at 2000 characters", () => {
  const sourceText = "A".repeat(CANONICAL_VECTOR_TEXT_MAX_CHARS + 500);
  const original = structuredClone(canonicalMemory(sourceText));
  const projection = projectCanonicalMemoryToVectorProjection(original);

  assert.equal(projection.text, sourceText.slice(0, CANONICAL_VECTOR_TEXT_MAX_CHARS));
  assert.equal(projection.embedding_input, sourceText.slice(0, CANONICAL_VECTOR_TEXT_MAX_CHARS));
  assert.equal(projection.text.length, CANONICAL_VECTOR_TEXT_MAX_CHARS);
  assert.equal(projection.source_text_length, sourceText.length);
  assert.equal(projection.text_truncated, true);
  assert.deepEqual(original, canonicalMemory(sourceText));
});

test("Lance row materializer emits only the current schema with exact memory id", () => {
  const projection = projectCanonicalMemoryToVectorProjection(canonicalMemory("A".repeat(2500)));
  const vector = new Float32Array([0.1, -0.2, 0.3]);
  const row = materializeCanonicalLanceRow(projection, { vector, timestamp: 1780000000 });

  assert.deepEqual(Object.keys(row).sort(), ["id", "text", "timestamp", "vector"]);
  assert.equal(row.id, projection.memory_id);
  assert.equal(row.text, projection.text);
  assert.equal(row.text.includes("A".repeat(2501)), false);
  assert.deepEqual(row.vector, Array.from(vector));
  assert.equal(row.timestamp, 1780000000);
  assert.equal(Object.hasOwn(row, "canonical_id"), false);
  assert.equal(Object.hasOwn(row, "source_content_hash"), false);
  assert.equal(Object.hasOwn(row, "category"), false);
  assert.equal(Object.hasOwn(row, "confidence"), false);
  assert.equal(Object.hasOwn(row, "lifecycle"), false);
});

test("materializer copies vectors and rejects empty, non-finite, or invalid timestamp inputs", () => {
  const projection = projectCanonicalMemoryToVectorProjection(canonicalMemory());
  const inputVector = [1, 2, 3];
  const row = materializeCanonicalLanceRow(projection, { vector: inputVector, timestamp: 0 });
  inputVector[0] = 99;

  assert.deepEqual(row.vector, [1, 2, 3]);
  assert.throws(() => materializeCanonicalLanceRow(projection, { vector: [], timestamp: 1 }), /finite vector/);
  assert.throws(() => materializeCanonicalLanceRow(projection, { vector: [1, Number.NaN], timestamp: 1 }), /finite vector/);
  assert.throws(() => materializeCanonicalLanceRow(projection, { vector: [1, Infinity], timestamp: 1 }), /finite vector/);
  assert.throws(() => materializeCanonicalLanceRow(projection, { vector: [1], timestamp: "1" }), /finite numeric timestamp/);
});

test("projection validates canonical identity, exact source text, and content reference without synthesis", () => {
  assert.throws(
    () => projectCanonicalMemoryToVectorProjection(canonicalMemory("text", { memory_id: "" })),
    /memory_id/,
  );
  assert.throws(
    () => projectCanonicalMemoryToVectorProjection(canonicalMemory("text", { canonical_id: "" })),
    /canonical_id/,
  );
  assert.throws(
    () => projectCanonicalMemoryToVectorProjection(canonicalMemory("text", { source: { text: null } })),
    /source\.text/,
  );
  assert.throws(
    () => projectCanonicalMemoryToVectorProjection(canonicalMemory("text", { content_ref: { content_hash: "" } })),
    /content_ref\.content_hash/,
  );
});

test("projection is deterministic and does not call time or embedding/network facilities", () => {
  const memory = canonicalMemory("deterministic text");
  const originalNow = Date.now;
  Date.now = () => {
    throw new Error("Date.now must not be called by canonical vector projection");
  };
  try {
    const first = projectCanonicalMemoryToVectorProjection(memory);
    const second = projectCanonicalMemoryToVectorProjection(memory);
    assert.deepEqual(first, second);
  } finally {
    Date.now = originalNow;
  }
});
