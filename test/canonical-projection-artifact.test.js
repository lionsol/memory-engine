import test from "node:test";
import assert from "node:assert/strict";

import {
  PROJECTION_ARTIFACT_SCHEMA_VERSION,
  PROJECTION_KINDS,
  PROJECTION_SURFACES,
  explainProjectionArtifactValidation,
  projectCanonicalMemoryToDisclosureCardArtifact,
  projectCanonicalMemoryToVectorArtifact,
  validateProjectionArtifact,
} from "../lib/canonical/projection-artifact.js";
import { projectCanonicalMemoryToVectorProjection } from "../lib/canonical/vector-projection.js";
import { projectCanonicalMemoryToMemoryCard } from "../lib/recall/auto-recall-memory-card.js";

function canonicalMemory(overrides = {}) {
  const canonical = {
    schema_version: 1,
    canonical_id: "cmem:core:projection-artifact-memory-id-0123456789",
    memory_id: "projection-artifact-memory-id-0123456789",
    source: {
      system: "openclaw_core",
      record_type: "chunk",
      record_id: "projection-artifact-memory-id-0123456789",
      path: "memory/projects/projection-artifact.md",
      core_source: "memory",
      line_start: 4,
      line_end: 8,
      text: "Canonical source body used to derive bounded projection artifacts.",
      core_hash: "core-index-hash",
      updated_at: 1780000000123,
    },
    classification: {
      category: "project",
      category_authority: "path_inference",
      kind: "project_state",
      kind_basis: "category",
    },
    temporal: {
      episode_date: null,
      episode_date_basis: null,
    },
    lifecycle: {
      management: "managed",
      category: "project",
      initial_confidence: 0.7,
      confidence: 0.91,
      last_confidence_update: 1780000000,
      base_tau_days: 30,
      hit_count: 4,
      archived: false,
      protected: false,
      conflict: false,
    },
    content_ref: {
      mode: "core_chunk",
      content_hash: "sha256:projection-artifact-content-hash",
    },
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      canonical[key] = { ...canonical[key], ...value };
    } else {
      canonical[key] = value;
    }
  }
  return canonical;
}

function runtimeCandidate(overrides = {}) {
  return {
    id: "runtime-short-id",
    memory_id: "runtime-wrong-id",
    path: "memory/smart-add/runtime-preview.md",
    text: "Bounded runtime preview for the disclosure card.",
    category: "raw_log",
    kind: "diagnostic",
    confidence: 0.2,
    final_score: 0.94,
    sources: ["fts", "vector"],
    retrieval_rank: 1,
    trace_id: "projection-artifact-test",
    ...overrides,
  };
}

test("projection artifact contract exposes the four explicit surfaces", () => {
  assert.equal(PROJECTION_ARTIFACT_SCHEMA_VERSION, 1);
  assert.deepEqual(PROJECTION_SURFACES, [
    "VECTOR_INDEX",
    "INTERNAL_AGENT_CONTEXT",
    "DISCLOSURE_CARD",
    "RAW_REFERENCE",
  ]);
});

test("vector adapter preserves canonical identity/hash and existing vector representation", () => {
  const canonical = canonicalMemory();
  const legacy = projectCanonicalMemoryToVectorProjection(canonical);
  const artifact = projectCanonicalMemoryToVectorArtifact(canonical);

  assert.equal(artifact.projection_kind, PROJECTION_KINDS.VECTOR_INDEX);
  assert.equal(artifact.surface, "VECTOR_INDEX");
  assert.equal(artifact.memory_id, canonical.memory_id);
  assert.equal(artifact.canonical_id, canonical.canonical_id);
  assert.equal(artifact.source_content_hash, canonical.content_ref.content_hash);
  assert.deepEqual(artifact.payload, {
    projection_version: legacy.projection_version,
    text: legacy.text,
    embedding_input: legacy.embedding_input,
    text_truncated: legacy.text_truncated,
    source_text_length: legacy.source_text_length,
  });
  assert.equal(validateProjectionArtifact(artifact, canonical), true);
});

test("disclosure-card adapter carries presentation but omits legacy permission and raw-get authority", () => {
  const canonical = canonicalMemory();
  const runtime = runtimeCandidate();
  const legacy = projectCanonicalMemoryToMemoryCard(canonical, runtime);
  const artifact = projectCanonicalMemoryToDisclosureCardArtifact(canonical, runtime);

  assert.equal(artifact.projection_kind, PROJECTION_KINDS.DISCLOSURE_CARD);
  assert.equal(artifact.surface, "DISCLOSURE_CARD");
  assert.equal(artifact.memory_id, canonical.memory_id);
  assert.equal(artifact.canonical_id, canonical.canonical_id);
  assert.equal(artifact.source_content_hash, canonical.content_ref.content_hash);
  assert.equal(artifact.payload.title, legacy.memory_card.title);
  assert.equal(artifact.payload.summary, legacy.memory_card.summary);
  assert.equal(artifact.payload.category, canonical.classification.category);
  assert.equal(artifact.payload.kind, canonical.classification.kind);
  assert.deepEqual(artifact.payload.risk_flags, legacy.memory_card.risk_flags);

  for (const forbidden of [
    "memory_id",
    "disclosure_level",
    "get_token",
    "can_inject_card",
    "can_get_full_content",
    "can_reinforce_on_citation",
    "capability",
    "safe_to_disclose",
  ]) {
    assert.equal(Object.hasOwn(artifact.payload, forbidden), false, forbidden);
  }
  assert.equal(Object.hasOwn(artifact, "capability"), false);
  assert.equal(validateProjectionArtifact(artifact, canonical), true);
});

test("projection adapters are deterministic and do not mutate canonical or runtime inputs", () => {
  const canonical = canonicalMemory();
  const runtime = runtimeCandidate();
  const canonicalBefore = structuredClone(canonical);
  const runtimeBefore = structuredClone(runtime);

  const firstVector = projectCanonicalMemoryToVectorArtifact(canonical);
  const secondVector = projectCanonicalMemoryToVectorArtifact(canonical);
  const firstCard = projectCanonicalMemoryToDisclosureCardArtifact(canonical, runtime);
  const secondCard = projectCanonicalMemoryToDisclosureCardArtifact(canonical, runtime);

  assert.deepEqual(firstVector, secondVector);
  assert.deepEqual(firstCard, secondCard);
  assert.deepEqual(canonical, canonicalBefore);
  assert.deepEqual(runtime, runtimeBefore);
});

test("validation fails closed on canonical identity, content-hash, category, and kind drift", () => {
  const canonical = canonicalMemory();
  const base = projectCanonicalMemoryToDisclosureCardArtifact(canonical, runtimeCandidate());

  const cases = [
    [{ ...base, memory_id: "wrong-memory" }, "canonical_identity_mismatch"],
    [{ ...base, canonical_id: "cmem:core:wrong" }, "canonical_identity_mismatch"],
    [{ ...base, source_content_hash: "sha256:wrong" }, "canonical_content_hash_mismatch"],
    [{ ...base, payload: { ...base.payload, category: "preference" } }, "canonical_category_mismatch"],
    [{ ...base, payload: { ...base.payload, kind: "preference" } }, "canonical_kind_mismatch"],
  ];

  for (const [artifact, reason] of cases) {
    assert.deepEqual(explainProjectionArtifactValidation(artifact, canonical), { valid: false, reason });
  }
});

test("disclosure-card validation rejects full-body fields and permission/capability authority", () => {
  const canonical = canonicalMemory();
  const base = projectCanonicalMemoryToDisclosureCardArtifact(canonical, runtimeCandidate());

  const bodyLeak = {
    ...base,
    payload: { ...base.payload, text: canonical.source.text },
  };
  assert.deepEqual(explainProjectionArtifactValidation(bodyLeak, canonical), {
    valid: false,
    reason: "forbidden_full_body_field",
  });

  for (const field of ["capability", "safe_to_disclose", "can_get_full_content", "get_token"]) {
    const withAuthority = {
      ...base,
      payload: { ...base.payload, [field]: field === "capability" ? "CARD_DISCLOSABLE" : true },
    };
    assert.deepEqual(explainProjectionArtifactValidation(withAuthority, canonical), {
      valid: false,
      reason: "projection_contains_authority_field",
    });
  }

  assert.deepEqual(explainProjectionArtifactValidation({
    ...base,
    capability: "CARD_DISCLOSABLE",
  }, canonical), {
    valid: false,
    reason: "projection_contains_authority_field",
  });
});

test("known but undefined internal/raw surfaces fail closed and cross-surface reuse is rejected", () => {
  const canonical = canonicalMemory();
  const vector = projectCanonicalMemoryToVectorArtifact(canonical);

  assert.deepEqual(explainProjectionArtifactValidation({
    ...vector,
    surface: "INTERNAL_AGENT_CONTEXT",
  }, canonical), {
    valid: false,
    reason: "surface_not_implemented",
  });

  assert.deepEqual(explainProjectionArtifactValidation({
    ...vector,
    surface: "RAW_REFERENCE",
  }, canonical), {
    valid: false,
    reason: "surface_not_implemented",
  });

  assert.deepEqual(explainProjectionArtifactValidation({
    ...vector,
    surface: "DISCLOSURE_CARD",
  }, canonical), {
    valid: false,
    reason: "surface_projection_kind_mismatch",
  });
});

test("a structurally valid risky card artifact still carries no disclosure authorization", () => {
  const canonical = canonicalMemory();
  const artifact = projectCanonicalMemoryToDisclosureCardArtifact(canonical, runtimeCandidate({
    text: "2026-08-22 08:00:00 ERROR request failed\nTraceback at Object.handle (/tmp/runtime.js:42)",
  }));

  assert.equal(artifact.payload.risk_flags.includes("raw_log_like"), true);
  assert.equal(artifact.payload.risk_flags.includes("tool_output_like"), true);
  assert.match(artifact.payload.summary, /withheld/i);
  assert.equal(validateProjectionArtifact(artifact, canonical), true);
  assert.equal(Object.hasOwn(artifact, "capability"), false);
  assert.equal(Object.hasOwn(artifact.payload, "disclosure_level"), false);
  assert.equal(Object.hasOwn(artifact.payload, "get_token"), false);
});
