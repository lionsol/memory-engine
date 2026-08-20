import test from "node:test";
import assert from "node:assert/strict";

import {
  createRecallCandidateEnvelope,
} from "../../lib/recall/disclosure/candidate-envelope.js";
import { canonicalFixture, cardProjectionFor } from "./fixtures.js";

test("candidate envelope preserves canonical identity and exposes only bounded projections", () => {
  const canonical = canonicalFixture();
  const originalCanonical = structuredClone(canonical);
  const envelope = createRecallCandidateEnvelope({
    canonicalMemory: canonical,
    retrievalEvidence: {
      rank: 1,
      sources: ["vector", "fts"],
      final_score: 0.91,
      task_intent: "debug_error",
      recall_intent: ["project_state"],
      history_reference: true,
    },
    cardProjection: cardProjectionFor(canonical),
  });

  assert.equal(envelope.schema_version, 1);
  assert.equal(envelope.memory_id, canonical.memory_id);
  assert.equal(envelope.canonical_id, canonical.canonical_id);
  assert.equal(envelope.canonical.memory_id, canonical.memory_id);
  assert.equal(envelope.canonical.canonical_id, canonical.canonical_id);
  assert.equal(Object.hasOwn(envelope.canonical.source, "text"), false);
  assert.equal(JSON.stringify(envelope).includes("FULL CANONICAL MEMORY BODY"), false);
  assert.equal(Object.hasOwn(envelope.retrieval, "task_intent"), false);
  assert.equal(Object.hasOwn(envelope.evidence, "recall_intent"), false);
  assert.equal(envelope.card.memory_id, canonical.memory_id);
  assert.equal(envelope.policy.can_inject_card, true);
  assert.deepEqual(canonical, originalCanonical);
});

test("candidate envelope accepts nested retrieval/evidence views without persisting or merging semantic labels", () => {
  const canonical = canonicalFixture();
  const envelope = createRecallCandidateEnvelope({
    canonicalMemory: canonical,
    retrievalEvidence: {
      retrieval: { rank: 2, final_score: 0.77 },
      evidence: { sources: ["fts"], channel_count: 1, exact_match: true },
      task_intent: "answer_question",
    },
    cardProjection: cardProjectionFor(canonical),
  });

  assert.deepEqual(envelope.retrieval, { rank: 2, final_score: 0.77 });
  assert.deepEqual(envelope.evidence, { sources: ["fts"], channel_count: 1, exact_match: true });
  assert.equal(Object.hasOwn(envelope, "side_effects"), false);
  assert.equal(Object.hasOwn(envelope, "task_intent"), false);
  assert.equal(Object.hasOwn(envelope, "recall_intent"), false);
});

test("canonical identity is required before an envelope can be formed", () => {
  assert.throws(
    () => createRecallCandidateEnvelope({ canonicalMemory: { source: {} } }),
    /canonicalMemory\.memory_id is required/,
  );
  assert.throws(
    () => createRecallCandidateEnvelope({ canonicalMemory: { memory_id: "id" } }),
    /canonicalMemory\.canonical_id is required/,
  );
});
