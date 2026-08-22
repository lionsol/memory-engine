import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  projectCanonicalMemoryToDisclosureCardArtifact,
} from "../../lib/canonical/projection-artifact.js";
import { projectRedactedCardCandidate } from "../../lib/recall/disclosure/redacted-card-prototype.js";

const PROTOTYPE_PATH = new URL("../../lib/recall/disclosure/redacted-card-prototype.js", import.meta.url);

function canonicalMemory() {
  return {
    schema_version: 1,
    canonical_id: "cmem:synthetic:redacted-card-prototype-01",
    memory_id: "redacted-card-prototype-01",
    source: {
      system: "synthetic_evaluation",
      record_type: "chunk",
      record_id: "redacted-card-prototype-01",
      path: "synthetic/redacted-card-prototype/unit.md",
      core_source: "synthetic",
      line_start: 3,
      line_end: 6,
      text: "Synthetic canonical source for redacted-card prototype tests.",
      core_hash: "synthetic-redacted-card-core",
      updated_at: 1780000001000,
    },
    classification: {
      category: "project",
      category_authority: "synthetic_fixture",
      kind: "project_state",
      kind_basis: "synthetic_fixture",
    },
    temporal: {
      episode_date: null,
      episode_date_basis: null,
    },
    lifecycle: {
      management: "managed",
      category: "project",
      initial_confidence: 0.9,
      confidence: 0.9,
      last_confidence_update: 1780000000,
      base_tau_days: 30,
      hit_count: 1,
      archived: false,
      protected: false,
      conflict: false,
    },
    content_ref: {
      mode: "core_chunk",
      content_hash: "sha256:synthetic-redacted-card-content",
    },
  };
}

function runtimeCandidate(overrides = {}) {
  return {
    id: "redacted-card-runtime-01",
    path: "synthetic/redacted-card-prototype/unit.md",
    text: "Synthetic answer UNIT_ANSWER_ANCHOR_RED_01 UNIT_SECRET_RED_9001.",
    category: "project",
    kind: "project_state",
    confidence: 0.88,
    final_score: 0.88,
    sources: ["synthetic_unit"],
    retrieval_rank: 1,
    trace_id: "synthetic-redacted-card-prototype",
    card: {
      title: "Synthetic answer UNIT_ANSWER_ANCHOR_RED_01",
      summary: "Synthetic answer UNIT_ANSWER_ANCHOR_RED_01 contains UNIT_SECRET_RED_9001.",
      salience_reason: "Synthetic prototype evidence UNIT_ANSWER_ANCHOR_RED_01.",
    },
    ...overrides,
  };
}

function plan(directives) {
  return {
    schema_version: 1,
    directives,
  };
}

test("summary exact redaction preserves an answer anchor and structural compatibility", () => {
  const result = projectRedactedCardCandidate(
    canonicalMemory(),
    runtimeCandidate(),
    plan([{ field: "summary", literal: "UNIT_SECRET_RED_9001" }]),
  );

  assert.equal(result.strategy, "REDACTED_CARD");
  assert.equal(result.strategy_schema_version, 1);
  assert.equal(result.surface, "DISCLOSURE_CARD");
  assert.equal(result.structural_compatibility.valid, true);
  assert.equal(result.candidate_payload.summary.includes("UNIT_SECRET_RED_9001"), false);
  assert.equal(result.candidate_payload.summary.includes("UNIT_ANSWER_ANCHOR_RED_01"), true);
  assert.deepEqual(result.redaction_evidence, {
    directive_count: 1,
    applied_directive_count: 1,
    occurrence_count: 1,
    fields_changed: ["summary"],
  });
  assert.equal(Object.hasOwn(result, "capability"), false);
  assert.equal(Object.hasOwn(result, "safe_to_disclose"), false);
  assert.equal(Object.hasOwn(result, "disclosure_authority"), false);
});

test("all exact occurrences are redacted deterministically", () => {
  const row = runtimeCandidate({
    card: {
      title: "Synthetic answer UNIT_ANSWER_ANCHOR_RED_01",
      summary: "UNIT_SECRET_RED_9001 before; UNIT_SECRET_RED_9001 after.",
      salience_reason: "Synthetic repeated-literal test.",
    },
  });
  const result = projectRedactedCardCandidate(
    canonicalMemory(),
    row,
    plan([{ field: "summary", literal: "UNIT_SECRET_RED_9001" }]),
  );

  assert.equal(result.structural_compatibility.valid, true);
  assert.equal(result.candidate_payload.summary.includes("UNIT_SECRET_RED_9001"), false);
  assert.equal((result.candidate_payload.summary.match(/\[REDACTED\]/gu) || []).length, 2);
  assert.equal(result.redaction_evidence.occurrence_count, 2);
});

test("multiple presentation fields are changed in deterministic directive order", () => {
  const result = projectRedactedCardCandidate(
    canonicalMemory(),
    runtimeCandidate({
      card: {
        title: "UNIT_SECRET_RED_9002 title",
        summary: "UNIT_ANSWER_ANCHOR_RED_01 with UNIT_SECRET_RED_9001",
        salience_reason: "Synthetic multi-field test.",
      },
    }),
    plan([
      { field: "title", literal: "UNIT_SECRET_RED_9002" },
      { field: "summary", literal: "UNIT_SECRET_RED_9001" },
    ]),
  );

  assert.equal(result.structural_compatibility.valid, true);
  assert.equal(result.candidate_payload.title, "[REDACTED] title");
  assert.equal(result.candidate_payload.summary, "UNIT_ANSWER_ANCHOR_RED_01 with [REDACTED]");
  assert.deepEqual(result.redaction_evidence.fields_changed, ["title", "summary"]);
  assert.equal(result.redaction_evidence.directive_count, 2);
  assert.equal(result.redaction_evidence.applied_directive_count, 2);
  assert.equal(result.redaction_evidence.occurrence_count, 2);
});

test("forbidden authority and risk fields fail closed", () => {
  const result = projectRedactedCardCandidate(
    canonicalMemory(),
    runtimeCandidate({ risk_flags: ["conflict_flag"] }),
    plan([{ field: "risk_flags", literal: "conflict_flag" }]),
  );

  assert.equal(result.structural_compatibility.valid, false);
  assert.equal(result.structural_compatibility.reason, "redaction_field_not_allowed");
  assert.equal(result.candidate_payload, null);
  assert.equal(JSON.stringify(result).includes("conflict_flag"), false);
});

test("missing redaction target fails closed without silent success", () => {
  const result = projectRedactedCardCandidate(
    canonicalMemory(),
    runtimeCandidate(),
    plan([{ field: "summary", literal: "UNIT_SECRET_RED_MISSING" }]),
  );

  assert.equal(result.structural_compatibility.valid, false);
  assert.equal(result.structural_compatibility.reason, "redaction_target_not_found");
  assert.equal(result.candidate_payload, null);
  assert.equal(result.redaction_evidence.applied_directive_count, 0);
});

test("malformed plan fails closed with a bounded reason", () => {
  const result = projectRedactedCardCandidate(
    canonicalMemory(),
    runtimeCandidate(),
    { schema_version: 2, directives: [] },
  );

  assert.equal(result.structural_compatibility.valid, false);
  assert.equal(result.structural_compatibility.reason, "invalid_redaction_plan");
  assert.equal(result.candidate_payload, null);
});

test("extra benign top-level plan fields fail closed", () => {
  const result = projectRedactedCardCandidate(
    canonicalMemory(),
    runtimeCandidate(),
    {
      ...plan([{ field: "summary", literal: "UNIT_SECRET_RED_9001" }]),
      metadata: "synthetic metadata",
    },
  );

  assert.equal(result.structural_compatibility.reason, "invalid_redaction_plan");
  assert.equal(result.candidate_payload, null);
});

test("capability-like top-level plan fields fail closed as invalid plans", () => {
  const result = projectRedactedCardCandidate(
    canonicalMemory(),
    runtimeCandidate(),
    {
      ...plan([{ field: "summary", literal: "UNIT_SECRET_RED_9001" }]),
      capability: "CARD_DISCLOSABLE",
    },
  );

  assert.equal(result.structural_compatibility.reason, "invalid_redaction_plan");
  assert.equal(result.candidate_payload, null);
});

test("safe_to_disclose top-level plan fields fail closed as invalid plans", () => {
  const result = projectRedactedCardCandidate(
    canonicalMemory(),
    runtimeCandidate(),
    {
      ...plan([{ field: "summary", literal: "UNIT_SECRET_RED_9001" }]),
      safe_to_disclose: true,
    },
  );

  assert.equal(result.structural_compatibility.reason, "invalid_redaction_plan");
  assert.equal(result.candidate_payload, null);
});

test("plan validation precedes baseline projection failure", () => {
  const canonical = canonicalMemory();
  canonical.content_ref.content_hash = new String("sha256:invalid-synthetic-content-hash");
  const result = projectRedactedCardCandidate(
    canonical,
    runtimeCandidate(),
    {
      ...plan([{ field: "summary", literal: "UNIT_SECRET_RED_9001" }]),
      capability: "CARD_DISCLOSABLE",
    },
  );

  assert.equal(result.structural_compatibility.reason, "invalid_redaction_plan");
  assert.notEqual(result.structural_compatibility.reason, "baseline_projection_failed");
  assert.equal(result.candidate_payload, null);
});

test("canonical authority and protected payload fields remain unchanged", () => {
  const canonical = canonicalMemory();
  const runtime = runtimeCandidate({ risk_flags: ["conflict_flag"] });
  const canonicalBefore = structuredClone(canonical);
  const runtimeBefore = structuredClone(runtime);
  const baseline = projectCanonicalMemoryToDisclosureCardArtifact(canonical, runtime);
  const result = projectRedactedCardCandidate(
    canonical,
    runtime,
    plan([{ field: "summary", literal: "UNIT_SECRET_RED_9001" }]),
  );

  assert.equal(result.structural_compatibility.valid, true);
  assert.equal(result.candidate_payload.card_id, baseline.payload.card_id);
  assert.equal(result.candidate_payload.category, baseline.payload.category);
  assert.equal(result.candidate_payload.kind, baseline.payload.kind);
  assert.equal(result.candidate_payload.confidence_score, baseline.payload.confidence_score);
  assert.deepEqual(result.candidate_payload.risk_flags, baseline.payload.risk_flags);
  assert.deepEqual(canonical, canonicalBefore);
  assert.deepEqual(runtime, runtimeBefore);
});

test("output is deterministic and side-effect contract is explicit", () => {
  const canonical = canonicalMemory();
  const runtime = runtimeCandidate();
  const redactionPlan = plan([{ field: "summary", literal: "UNIT_SECRET_RED_9001" }]);
  const first = projectRedactedCardCandidate(canonical, runtime, redactionPlan);
  const second = projectRedactedCardCandidate(canonical, runtime, redactionPlan);

  assert.deepEqual(first, second);
  assert.deepEqual(first.side_effects, {
    retrieval: false,
    db_writes: false,
    data_mutation: false,
    selector: false,
    capability: false,
    network: false,
    llm: false,
    runtime: false,
  });
});

test("baseline projection failure is bounded and does not leak source or stack", () => {
  const canonical = canonicalMemory();
  canonical.content_ref.content_hash = new String("sha256:invalid-synthetic-content-hash");
  const result = projectRedactedCardCandidate(
    canonical,
    runtimeCandidate(),
    plan([{ field: "summary", literal: "UNIT_SECRET_RED_9001" }]),
  );

  assert.equal(result.structural_compatibility.valid, false);
  assert.equal(result.structural_compatibility.reason, "baseline_projection_failed");
  assert.equal(result.candidate_payload, null);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("UNIT_ANSWER_ANCHOR_RED_01"), false);
  assert.equal(serialized.includes("stack"), false);
});

test("prototype has no capability, selector, storage, retrieval, network, LLM, or fixture boundary", () => {
  const source = readFileSync(PROTOTYPE_PATH, "utf8");
  for (const forbidden of [
    "disclosure-capability-shadow-evaluator.js",
    "disclosure-selector.js",
    "admissibility-policy.js",
    "better-sqlite3",
    "node:sqlite",
    "readFileSync",
    "writeFile",
    "fetch(",
    "http://",
    "https://",
    "memory-projection-holdout-v1.jsonl",
    "test/fixtures",
    "SANITIZED_CARD",
    "PROJECTABLE_CARD",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
