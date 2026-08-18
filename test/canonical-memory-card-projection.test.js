import test from "node:test";
import assert from "node:assert/strict";

import {
  isInjectableMemoryCard,
  projectCandidateToMemoryCard,
  projectCanonicalMemoryToMemoryCard,
  projectCanonicalMemoryToMemoryObject,
} from "../lib/recall/auto-recall-memory-card.js";

function managedCanonical(overrides = {}) {
  const canonical = {
    schema_version: 1,
    canonical_id: "cmem:core:canonical-project-memory-id-0123456789",
    memory_id: "canonical-project-memory-id-0123456789",
    source: {
      system: "openclaw_core",
      record_type: "chunk",
      record_id: "canonical-project-memory-id-0123456789",
      path: "memory/projects/canonical.md",
      core_source: "memory",
      line_start: 10,
      line_end: 20,
      text: "FULL CORE TEXT MUST NOT BECOME CARD PRESENTATION",
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
      content_hash: "sha256:canonical-full-core-text-hash",
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

function externalCanonical() {
  return managedCanonical({
    canonical_id: "cmem:core:external-memory-id-0123456789",
    memory_id: "external-memory-id-0123456789",
    source: {
      record_id: "external-memory-id-0123456789",
      path: "docs/unmanaged.md",
      line_start: 2,
      line_end: 4,
      text: "FULL EXTERNAL CORE TEXT",
      updated_at: 1780000000999,
    },
    classification: {
      category: "unknown",
      category_authority: "unknown",
      kind: "fact",
    },
    lifecycle: {
      management: "external",
      category: null,
      initial_confidence: null,
      confidence: null,
      last_confidence_update: null,
      base_tau_days: null,
      hit_count: null,
      archived: null,
      protected: null,
      conflict: null,
    },
    content_ref: {
      content_hash: "sha256:external-full-core-text-hash",
    },
  });
}

function conflictingRuntimeCandidate(overrides = {}) {
  return {
    id: "runtime-short-id",
    memory_id: "runtime-wrong-memory-id",
    path: "memory/smart-add/runtime-wrong.md",
    source: {
      path: "memory/smart-add/runtime-source-wrong.md",
      line_start: 900,
      line_end: 901,
      updated_at: 1,
      source_type: "runtime-spoofed-source",
    },
    start_line: 900,
    end_line: 901,
    updated_at: 1,
    category: "raw_log",
    kind: "diagnostic",
    scope: "runtime-wrong-scope",
    text: "Safe retrieval preview used only for card presentation.",
    confidence: 0.12,
    final_score: 0.99,
    semantic_score: 0.98,
    similarity: 0.97,
    sources: ["fts", "vector"],
    retrieval_rank: 7,
    trace_id: "runtime-trace",
    agent_scope: "task-planner",
    ...overrides,
  };
}

test("canonical-aware projector gives canonical identity, source, category, and kind precedence", () => {
  const canonical = managedCanonical();
  const runtime = conflictingRuntimeCandidate();
  const originalCanonical = structuredClone(canonical);
  const originalRuntime = structuredClone(runtime);
  const object = projectCanonicalMemoryToMemoryObject(canonical, runtime, { agentScope: "edi" });

  assert.equal(object.memory_id, canonical.memory_id);
  assert.equal(object.canonical_id, canonical.canonical_id);
  assert.equal(object.object_id, `memobj_${canonical.memory_id.slice(0, 32)}`);
  assert.equal(object.source.path, canonical.source.path);
  assert.equal(object.source.line_start, canonical.source.line_start);
  assert.equal(object.source.line_end, canonical.source.line_end);
  assert.equal(object.source.updated_at, canonical.source.updated_at);
  assert.equal(object.source.source_type, "memory-engine-managed");
  assert.equal(object.classification.category, "project");
  assert.equal(object.classification.kind, "project_state");
  assert.equal(object.classification.scope, "project_state");
  assert.equal(object.classification.agent_scope, "task-planner");
  assert.deepEqual(canonical, originalCanonical);
  assert.deepEqual(runtime, originalRuntime);
});

test("canonical confidence and content hash beat runtime scores and preview text", () => {
  const canonical = managedCanonical();
  const runtime = conflictingRuntimeCandidate();
  const result = projectCanonicalMemoryToMemoryCard(canonical, runtime);

  assert.equal(result.memory_object.confidence.score, 0.91);
  assert.equal(result.memory_object.debug.retrieval_score, 0.99);
  assert.equal(result.memory_object.debug.retrieval_rank, 7);
  assert.equal(result.memory_object.debug.trace_id, "runtime-trace");
  assert.equal(result.memory_object.content_ref.content_hash, canonical.content_ref.content_hash);
  assert.equal(result.memory_object.content_ref.content_hash === "sha256:runtime-preview-hash", false);
  assert.equal(result.memory_object.source.text, undefined);
  assert.equal(result.memory_card.summary.includes(canonical.source.text), false);
  assert.equal(result.memory_card.summary.includes(runtime.text), true);
});

test("external canonical memory keeps lifecycle confidence null despite retrieval similarity", () => {
  const result = projectCanonicalMemoryToMemoryCard(
    externalCanonical(),
    conflictingRuntimeCandidate({
      id: "runtime-external-short",
      category: "raw_log",
      kind: "diagnostic",
      text: "External safe preview.",
      final_score: 0.97,
      similarity: 0.96,
    }),
  );

  assert.equal(result.memory_object.memory_id, "external-memory-id-0123456789");
  assert.equal(result.memory_object.source.source_type, "openclaw-core");
  assert.equal(result.memory_object.classification.category, "unknown");
  assert.equal(result.memory_object.classification.kind, "fact");
  assert.equal(result.memory_object.confidence.score, null);
  assert.equal(result.memory_card.confidence_score, null);
  assert.equal(result.memory_object.debug.retrieval_score, 0.97);
  assert.equal(result.memory_object.content_ref.content_hash, "sha256:external-full-core-text-hash");
});

test("canonical archived state and runtime quarantine/stale gates remain non-injectable", () => {
  const archived = projectCanonicalMemoryToMemoryCard(
    managedCanonical({ lifecycle: { archived: true } }),
    conflictingRuntimeCandidate({ is_archived: 0 }),
  );
  assert.equal(archived.memory_object.classification.lifecycle_state, "archived");
  assert.equal(archived.memory_object.card.risk_flags.includes("archived"), true);
  assert.equal(archived.memory_card.disclosure_level, "none");
  assert.equal(isInjectableMemoryCard(archived.memory_card), false);

  for (const [flag, state] of [["quarantined", "quarantined"], ["stale_index_candidate", "stale_index_candidate"]]) {
    const runtime = conflictingRuntimeCandidate({
      is_quarantined: flag === "quarantined",
      stale_index_candidate: flag === "stale_index_candidate",
    });
    const result = projectCanonicalMemoryToMemoryCard(managedCanonical(), runtime);
    assert.equal(result.memory_object.classification.lifecycle_state, state);
    assert.equal(result.memory_object.card.risk_flags.includes(flag), true);
    assert.equal(result.memory_card.disclosure_level, "none");
    assert.equal(isInjectableMemoryCard(result.memory_card), false);
  }
});

test("runtime agent scope remains runtime-only risk evidence", () => {
  const canonical = managedCanonical();
  const result = projectCanonicalMemoryToMemoryCard(
    canonical,
    conflictingRuntimeCandidate({ agent_scope: "task-planner" }),
    { agentScope: "edi" },
  );

  assert.equal(result.memory_object.classification.agent_scope, "task-planner");
  assert.equal(result.memory_object.card.risk_flags.includes("cross_agent_scope"), true);
  assert.equal(Object.hasOwn(canonical, "agent_scope"), false);
  assert.equal(Object.hasOwn(canonical.classification, "agent_scope"), false);
  assert.equal(Object.hasOwn(canonical, "risk_flags"), false);
});

test("canonical-aware managed and external projections preserve legacy card semantics", () => {
  const managedRuntime = {
    id: "managed-parity-id",
    path: "memory/projects/parity.md",
    start_line: 12,
    end_line: 18,
    text: "A compact project preview for parity.",
    category: "project",
    kind: "project_state",
    confidence: 0.82,
    sources: ["fts", "kg"],
  };
  const managedCanonicalFixture = managedCanonical({
    canonical_id: "cmem:core:managed-parity-id",
    memory_id: "managed-parity-id",
    source: {
      record_id: "managed-parity-id",
      path: managedRuntime.path,
      line_start: managedRuntime.start_line,
      line_end: managedRuntime.end_line,
      text: "FULL PARITY CORE TEXT",
    },
    classification: { category: "project", kind: "project_state" },
    lifecycle: { confidence: managedRuntime.confidence },
    content_ref: { content_hash: "sha256:managed-parity-full-text" },
  });
  const legacyManaged = projectCandidateToMemoryCard(managedRuntime);
  const canonicalManaged = projectCanonicalMemoryToMemoryCard(managedCanonicalFixture, managedRuntime);

  for (const field of ["category", "kind", "source_hint", "title", "summary", "salience_reason", "disclosure_level", "risk_flags"]) {
    assert.deepEqual(canonicalManaged.memory_card[field], legacyManaged.memory_card[field], `managed parity: ${field}`);
  }
  assert.equal(isInjectableMemoryCard(canonicalManaged.memory_card), isInjectableMemoryCard(legacyManaged.memory_card));
  assert.equal(canonicalManaged.memory_object.canonical_id, "cmem:core:managed-parity-id");
  assert.equal(Object.hasOwn(legacyManaged.memory_object, "canonical_id"), false);
  assert.notEqual(canonicalManaged.memory_object.content_ref.content_hash, legacyManaged.memory_object.content_ref.content_hash);

  const externalRuntime = {
    id: "external-parity-id",
    path: "docs/unmanaged.md",
    start_line: 2,
    end_line: 4,
    text: "An external safe preview for parity.",
    category: "unknown",
    kind: "fact",
    confidence_mode: "external",
  };
  const externalCanonicalFixture = externalCanonical();
  externalCanonicalFixture.canonical_id = "cmem:core:external-parity-id";
  externalCanonicalFixture.memory_id = "external-parity-id";
  externalCanonicalFixture.source.record_id = "external-parity-id";
  externalCanonicalFixture.source.path = externalRuntime.path;
  externalCanonicalFixture.source.line_start = externalRuntime.start_line;
  externalCanonicalFixture.source.line_end = externalRuntime.end_line;
  externalCanonicalFixture.source.text = "FULL EXTERNAL PARITY CORE TEXT";
  const legacyExternal = projectCandidateToMemoryCard(externalRuntime);
  const canonicalExternal = projectCanonicalMemoryToMemoryCard(externalCanonicalFixture, externalRuntime);

  for (const field of ["category", "kind", "source_hint", "title", "summary", "salience_reason", "disclosure_level", "risk_flags"]) {
    assert.deepEqual(canonicalExternal.memory_card[field], legacyExternal.memory_card[field], `external parity: ${field}`);
  }
  assert.equal(isInjectableMemoryCard(canonicalExternal.memory_card), isInjectableMemoryCard(legacyExternal.memory_card));
});
