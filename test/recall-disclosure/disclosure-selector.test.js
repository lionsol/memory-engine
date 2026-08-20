import test from "node:test";
import assert from "node:assert/strict";

import { selectDisclosureCandidates } from "../../lib/recall/disclosure/disclosure-selector.js";
import { DISCLOSURE_DECISIONS } from "../../lib/recall/disclosure/disclosure-types.js";
import { envelopeFixture } from "./fixtures.js";

test("selector discloses only an admissible card with sufficient retrieval evidence", () => {
  const candidateA = envelopeFixture();
  const candidateB = envelopeFixture({
    canonical: {
      ...envelopeFixture().canonical,
      classification: {
        ...envelopeFixture().canonical.classification,
        category: "raw_log",
        kind: "diagnostic",
      },
    },
    card: { risk_flags: ["raw_log_like"] },
  });
  const candidateC = envelopeFixture({
    retrievalEvidence: { rank: 1, sources: [], channel_count: 0 },
  });

  const original = structuredClone([candidateA, candidateB, candidateC]);
  const selections = selectDisclosureCandidates([candidateA, candidateB, candidateC]);

  assert.deepEqual(selections.map(selection => selection.decision), [
    DISCLOSURE_DECISIONS.DISCLOSE_CARD,
    DISCLOSURE_DECISIONS.WITHHOLD,
    DISCLOSURE_DECISIONS.WITHHOLD,
  ]);
  assert.equal(selections[0].card.memory_id, candidateA.memory_id);
  assert.equal(Object.hasOwn(selections[1], "card"), false);
  assert.equal(Object.hasOwn(selections[2], "card"), false);
  assert.equal(selections[1].reason, "unsafe_artifact");
  assert.equal(selections[2].reason, "insufficient_retrieval_evidence");
  assert.equal(JSON.stringify(selections).includes("FULL CANONICAL MEMORY BODY"), false);
  assert.deepEqual([candidateA, candidateB, candidateC], original);
});

test("selector preserves retrieval order and has no runtime or persistence side effects", () => {
  const candidates = [
    envelopeFixture({ canonical: { ...envelopeFixture().canonical, memory_id: "memory-1", canonical_id: "cmem:core:memory-1", source: { ...envelopeFixture().canonical.source, record_id: "memory-1" } } }),
    envelopeFixture({ canonical: { ...envelopeFixture().canonical, memory_id: "memory-2", canonical_id: "cmem:core:memory-2", source: { ...envelopeFixture().canonical.source, record_id: "memory-2" } } }),
  ];
  const result = selectDisclosureCandidates(candidates);

  assert.deepEqual(result.map(item => item.memory_id), ["memory-1", "memory-2"]);
  assert.equal(result.every(item => item.decision === DISCLOSURE_DECISIONS.DISCLOSE_CARD), true);
  assert.equal(result.some(item => Object.hasOwn(item, "candidate")), false);
});
