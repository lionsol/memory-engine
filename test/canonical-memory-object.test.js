import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  composeCanonicalMemoryObject,
} from "../lib/canonical/memory-object.js";

function coreRow(overrides = {}) {
  return {
    id: "core-chunk-001",
    path: "memory/projects/roadmap.md",
    source: "memory",
    start_line: 10,
    end_line: 24,
    hash: "core-index-hash",
    model: "embedding-model-that-is-not-canonical",
    text: "Project roadmap body",
    embedding: "[0.1,0.2]",
    updated_at: 1780000000123,
    ...overrides,
  };
}

function engineRow(overrides = {}) {
  return {
    chunk_id: "core-chunk-001",
    initial_confidence: 0.7,
    confidence: 0.82,
    last_confidence_update: 1780000000,
    base_tau: 30,
    hit_count: 4,
    is_archived: 1,
    is_protected: 0,
    conflict_flag: 1,
    category: "project",
    kg_data: "must-not-cross-the-canonical-boundary",
    ...overrides,
  };
}

test("managed composer maps exact Core and Engine authorities without mutation", () => {
  const core = coreRow();
  const engine = engineRow();
  const originalCore = structuredClone(core);
  const originalEngine = structuredClone(engine);
  const memory = composeCanonicalMemoryObject(core, engine);

  assert.deepEqual(memory, {
    schema_version: 1,
    canonical_id: "cmem:core:core-chunk-001",
    memory_id: "core-chunk-001",
    source: {
      system: "openclaw_core",
      record_type: "chunk",
      record_id: "core-chunk-001",
      path: "memory/projects/roadmap.md",
      core_source: "memory",
      line_start: 10,
      line_end: 24,
      text: "Project roadmap body",
      core_hash: "core-index-hash",
      updated_at: 1780000000123,
    },
    classification: {
      category: "project",
      category_authority: "engine",
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
      confidence: 0.82,
      last_confidence_update: 1780000000,
      base_tau_days: 30,
      hit_count: 4,
      archived: true,
      protected: false,
      conflict: true,
    },
    content_ref: {
      mode: "core_chunk",
      content_hash: `sha256:${createHash("sha256").update(core.text).digest("hex")}`,
    },
  });
  assert.deepEqual(core, originalCore);
  assert.deepEqual(engine, originalEngine);
  assert.equal("model" in memory.source, false);
  assert.equal("embedding" in memory.source, false);
  assert.equal("kg_data" in memory.lifecycle, false);
});

test("external composer keeps every Engine lifecycle field null", () => {
  const memory = composeCanonicalMemoryObject(coreRow({
    id: "external-core",
    path: "docs/unmanaged.md",
    text: "unmanaged source text",
  }));

  assert.equal(memory.canonical_id, "cmem:core:external-core");
  assert.equal(memory.memory_id, "external-core");
  assert.deepEqual(memory.lifecycle, {
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
  });
});

test("canonical identity preserves a Core id longer than the P4 32-character projection", () => {
  const id = "x".repeat(48);
  const memory = composeCanonicalMemoryObject(coreRow({ id }));
  assert.equal(memory.memory_id, id);
  assert.equal(memory.source.record_id, id);
  assert.equal(memory.canonical_id, `cmem:core:${id}`);
  assert.equal(memory.canonical_id.includes(id.slice(0, 32)), true);
  assert.equal(memory.canonical_id.endsWith(id), true);
});

test("content hash uses the exact full Core text and updated_at remains raw", () => {
  const text = `${"full-text-".repeat(300)}\nfinal-byte`;
  const rawUpdatedAt = "raw-core-updated-at";
  const memory = composeCanonicalMemoryObject(coreRow({ text, updated_at: rawUpdatedAt }));
  assert.equal(memory.source.text, text);
  assert.equal(memory.source.updated_at, rawUpdatedAt);
  assert.equal(
    memory.content_ref.content_hash,
    `sha256:${createHash("sha256").update(text).digest("hex")}`,
  );
});

test("category authority is Engine before supported source metadata and path inference", () => {
  const engine = composeCanonicalMemoryObject(
    coreRow({
      path: "memory/projects/roadmap.md",
      text: "Category: preference\nbody",
    }),
    engineRow({ category: "user_identity" }),
  );
  assert.equal(engine.classification.category, "user_identity");
  assert.equal(engine.classification.category_authority, "engine");
  assert.equal(engine.classification.kind, "preference");

  const source = composeCanonicalMemoryObject(coreRow({
    id: "source-category",
    path: "docs/unmanaged.md",
    text: "Category: workflow_rule\nbody",
  }));
  assert.equal(source.classification.category, "workflow_rule");
  assert.equal(source.classification.category_authority, "source_metadata");
  assert.equal(source.classification.kind, "workflow_rule");

  const path = composeCanonicalMemoryObject(coreRow({
    id: "path-category",
    path: "memory/projects/roadmap.md",
    text: "Category: unsupported_bucket\nbody",
  }));
  assert.equal(path.classification.category, "project");
  assert.equal(path.classification.category_authority, "path_inference");
});

test("unsupported Category metadata falls through to path inference or unknown", () => {
  const unknown = composeCanonicalMemoryObject(coreRow({
    id: "unknown-category",
    path: "docs/unmanaged.md",
    text: "Category: external\nI am a user identity and I prefer this",
  }));
  assert.equal(unknown.classification.category, "unknown");
  assert.equal(unknown.classification.category_authority, "unknown");
  assert.equal(unknown.classification.kind, "fact");
  assert.notEqual(unknown.classification.category_authority, "text_inference");
});

test("kind mapping is deterministic and closed", () => {
  const expected = new Map([
    ["preference", "preference"],
    ["user_identity", "preference"],
    ["project", "project_state"],
    ["episodic", "episode"],
    ["raw_log", "diagnostic"],
    ["workflow", "workflow_rule"],
    ["workflow_rule", "workflow_rule"],
    ["stats", "quality_signal"],
    ["kg_node", "fact"],
  ]);
  for (const [category, kind] of expected) {
    const memory = composeCanonicalMemoryObject(coreRow({
      id: `kind-${category}`,
      path: "docs/unmanaged.md",
      text: `Category: ${category}\nbody`,
    }));
    assert.equal(memory.classification.category, category);
    assert.equal(memory.classification.kind, kind);
    assert.equal(memory.classification.kind_basis, "category");
  }
});

test("only the exact episode path supplies an episode date", () => {
  const episode = composeCanonicalMemoryObject(coreRow({
    id: "episode",
    path: "memory/episodes/2026-08-18.md",
  }));
  assert.deepEqual(episode.temporal, {
    episode_date: "2026-08-18",
    episode_date_basis: "source_path",
  });

  const daily = composeCanonicalMemoryObject(coreRow({
    id: "daily",
    path: "memory/2026-08-18.md",
  }));
  assert.deepEqual(daily.temporal, { episode_date: null, episode_date_basis: null });

  const naturalLanguage = composeCanonicalMemoryObject(coreRow({
    id: "natural-language-date",
    path: "docs/unmanaged.md",
    text: "The episode happened on 2026-08-18 and should not be promoted.",
  }));
  assert.deepEqual(naturalLanguage.temporal, { episode_date: null, episode_date_basis: null });
});

test("malformed identity, Core text, and Engine identity fail closed", () => {
  assert.throws(
    () => composeCanonicalMemoryObject(coreRow({ text: 42 })),
    error => error.reason === "core_malformed",
  );
  assert.throws(
    () => composeCanonicalMemoryObject(coreRow({ id: "" })),
    error => error.reason === "core_malformed",
  );
  assert.throws(
    () => composeCanonicalMemoryObject(coreRow(), engineRow({ chunk_id: "other-core" })),
    error => error.reason === "engine_malformed",
  );
  assert.throws(
    () => composeCanonicalMemoryObject(coreRow(), engineRow({ confidence: "0.8" })),
    error => error.reason === "engine_malformed",
  );
});

test("Canonical v1 contains no eligibility, runtime evidence, or card policy fields", () => {
  const memory = composeCanonicalMemoryObject(coreRow(), engineRow());
  const forbidden = [
    "eligibility",
    "risk_flags",
    "scope",
    "agent_scope",
    "retrieval_rank",
    "retrieval_score",
    "final_score",
    "vector_score",
    "fts_score",
    "trace_id",
    "salience_reason",
    "can_inject_card",
    "can_reinforce_on_citation",
  ];
  for (const field of forbidden) assert.equal(field in memory, false, field);
  assert.equal(JSON.stringify(memory).includes("current-turn"), false);
});
