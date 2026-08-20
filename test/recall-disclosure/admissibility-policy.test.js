import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateAdmissibility,
  explainAdmissibility,
} from "../../lib/recall/disclosure/admissibility-policy.js";
import { ADMISSIBILITY_DECISIONS } from "../../lib/recall/disclosure/disclosure-types.js";
import { envelopeFixture } from "./fixtures.js";

test("valid active canonical memory with a valid card is admissible", () => {
  const result = explainAdmissibility(envelopeFixture());
  assert.deepEqual(result, { decision: ADMISSIBILITY_DECISIONS.ALLOW, reason: "admissible" });
  assert.equal(evaluateAdmissibility(envelopeFixture()), "ALLOW");
});

test("unsafe artifact is denied even when retrieval evidence is strong", () => {
  const candidate = envelopeFixture({
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
  assert.deepEqual(explainAdmissibility(candidate), {
    decision: ADMISSIBILITY_DECISIONS.DENY,
    reason: "unsafe_artifact",
  });
});

test("non-active lifecycle states are denied", () => {
  const base = envelopeFixture();
  for (const state of ["archived", "quarantined", "needs_review", "stale_index_candidate"]) {
    const candidate = structuredClone(base);
    candidate.canonical.classification.lifecycle_state = state;
    assert.equal(evaluateAdmissibility(candidate), "DENY", state);
  }
});

test("scope violation is denied without using task or recall intent", () => {
  const candidate = envelopeFixture();
  candidate.canonical.classification.agent_scope = "task-planner";
  candidate.canonical.classification.scope = "project_state";
  candidate.task_intent = "answer_question";
  candidate.recall_intent = ["project_state"];

  assert.equal(evaluateAdmissibility(candidate, { agentScope: "edi" }), "DENY");
  assert.equal(evaluateAdmissibility(envelopeFixture({ card: { risk_flags: ["cross_agent_scope"] } })), "DENY");
});

test("projection identity and disclosure failures are denied", () => {
  const invalidIdentity = envelopeFixture();
  invalidIdentity.card.memory_id = "different-memory";
  assert.equal(evaluateAdmissibility(invalidIdentity), "DENY");

  const invalidLevel = envelopeFixture({ card: { disclosure_level: "none" } });
  assert.equal(evaluateAdmissibility(invalidLevel), "DENY");

  const leakedCard = envelopeFixture();
  leakedCard.card.text = "raw body";
  assert.equal(evaluateAdmissibility(leakedCard), "DENY");
});
