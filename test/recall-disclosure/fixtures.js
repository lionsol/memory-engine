import { createRecallCandidateEnvelope } from "../../lib/recall/disclosure/candidate-envelope.js";

export function canonicalFixture(overrides = {}) {
  const memoryId = overrides.memory_id || "core-disclosure-memory-001";
  const canonical = {
    schema_version: 1,
    memory_id: memoryId,
    canonical_id: `cmem:core:${memoryId}`,
    source: {
      system: "openclaw_core",
      record_type: "chunk",
      record_id: memoryId,
      path: "memory/projects/disclosure.md",
      core_source: "memory",
      line_start: 10,
      line_end: 18,
      text: "FULL CANONICAL MEMORY BODY MUST STAY OUT OF THE ENVELOPE",
      core_hash: "core-hash-001",
      updated_at: 1780000000000,
    },
    classification: {
      category: "project",
      category_authority: "engine",
      kind: "project_state",
      kind_basis: "category",
      scope: "project_state",
      agent_scope: "edi",
    },
    temporal: {
      episode_date: null,
      episode_date_basis: null,
    },
    lifecycle: {
      management: "managed",
      category: "project",
      confidence: 0.82,
      archived: false,
      protected: false,
      conflict: false,
    },
    content_ref: {
      mode: "core_chunk",
      content_hash: "sha256:canonical-content-001",
    },
    ...overrides,
  };
  return canonical;
}

export function cardProjectionFor(canonical, overrides = {}) {
  const card = {
    schema_version: 1,
    card_id: `memcard_${canonical.memory_id}`,
    memory_id: canonical.memory_id,
    title: "Disclosure project memory",
    summary: "A compact card-safe project summary.",
    salience_reason: "Matched by vector and FTS retrieval.",
    source_hint: "memory/projects/disclosure.md:10-18",
    category: "project",
    kind: "project_state",
    confidence_score: 0.82,
    risk_flags: [],
    disclosure_level: "memory_card",
    get_token: `memory_engine_get:${canonical.memory_id}`,
    ...overrides,
  };
  return {
    memory_object: {
      policy: {
        disclosure_level: card.disclosure_level,
        can_inject_card: card.disclosure_level === "memory_card",
        can_get_full_content: true,
        can_reinforce_on_citation: true,
      },
    },
    memory_card: card,
    side_effects: {
      db_writes: false,
      memory_file_mutation: false,
      injection: false,
    },
  };
}

export function envelopeFixture({
  canonical = canonicalFixture(),
  retrievalEvidence = {
    rank: 1,
    sources: ["vector", "fts"],
    channel_count: 2,
    final_score: 0.91,
    channel_agreement: true,
  },
  card = {},
} = {}) {
  return createRecallCandidateEnvelope({
    canonicalMemory: canonical,
    retrievalEvidence,
    cardProjection: cardProjectionFor(canonical, card),
  });
}
