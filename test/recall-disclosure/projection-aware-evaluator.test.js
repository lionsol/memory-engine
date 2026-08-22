import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  evaluateProjectionAwareCase,
  evaluateProjectionAwareCases,
  evaluateProjectionAwareFixture,
} from "../../lib/recall/disclosure/projection-aware-evaluator.js";
import {
  PROJECTION_AWARE_HOLDOUT_ANNOTATOR,
  PROJECTION_AWARE_HOLDOUT_FAMILIES,
  validateProjectionAwareHoldoutRow,
} from "../../lib/recall/disclosure/projection-aware-holdout.js";

const EVALUATOR_PATH = new URL("../../lib/recall/disclosure/projection-aware-evaluator.js", import.meta.url);
const CARD_PAYLOAD_FIELDS = [
  "schema_version",
  "card_id",
  "title",
  "summary",
  "salience_reason",
  "source_hint",
  "category",
  "kind",
  "confidence_score",
  "risk_flags",
];

function makeRow({
  caseId,
  family,
  text,
  category = "project",
  kind = "project_state",
  policy = {},
  runtimeRiskFlags = [],
  forbiddenLiterals,
  requiredLiterals,
  answerBearing,
  expectedCapability,
  expectedAuthority,
}) {
  const memoryId = `memory-projection-holdout-v1-${caseId}`;
  const sourcePath = `synthetic/memory-projection-holdout-v1/${caseId}.md`;
  const row = {
    schema_version: 1,
    dataset_id: "memory-projection-holdout-v1",
    case_id: caseId,
    family,
    canonical_memory: {
      schema_version: 1,
      canonical_id: `cmem:synthetic:memory-projection-holdout-v1:${caseId}`,
      memory_id: memoryId,
      source: {
        system: "synthetic_evaluation",
        record_type: "chunk",
        record_id: memoryId,
        path: sourcePath,
        core_source: "synthetic",
        line_start: 1,
        line_end: 1,
        text,
        core_hash: `synthetic-core-${caseId}`,
        updated_at: 1780000000000,
      },
      classification: {
        category,
        category_authority: "synthetic_fixture",
        kind,
        kind_basis: "synthetic_fixture",
      },
      temporal: {
        episode_date: null,
        episode_date_basis: null,
      },
      lifecycle: {
        management: "managed",
        category,
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
        content_hash: `sha256:synthetic-${caseId}`,
      },
    },
    runtime_candidate: {
      id: `runtime-projection-holdout-v1-${caseId}`,
      path: sourcePath,
      text,
      category,
      kind,
      confidence: 0.9,
      final_score: 0.9,
      sources: ["synthetic_unit"],
      retrieval_rank: 1,
      trace_id: `synthetic-projection-unit-${caseId}`,
      risk_flags: runtimeRiskFlags,
    },
    policy_context: {
      scope: "shared",
      agent_scope: "shared",
      risk_flags: [],
      artifact_state: "safe",
      lifecycle_state: "active",
      current_safe_to_disclose: true,
      capability_blocker: "none",
      ...policy,
    },
    projection_surface: "DISCLOSURE_CARD",
    label: {
      answer_bearing: answerBearing,
      expected_projection_valid: true,
      surface_safety: {
        forbidden_literals: forbiddenLiterals,
      },
      semantic_preservation: {
        required_literals: requiredLiterals,
        required: answerBearing,
      },
      current_v1_1: {
        expected_capability: expectedCapability,
        expected_disclosure_authority: expectedAuthority,
      },
    },
    label_confidence: "high",
    annotator: PROJECTION_AWARE_HOLDOUT_ANNOTATOR,
  };
  const validation = validateProjectionAwareHoldoutRow(row);
  assert.equal(validation.valid, true, JSON.stringify(validation.diagnostics));
  return row;
}

function directSafeRow() {
  return makeRow({
    caseId: "direct-safe-unit-01",
    family: "direct_safe",
    text: "Synthetic direct-safe answer ENGINE_DB_ISOLATED DIRECT_SAFE_UNIT_01.",
    forbiddenLiterals: [],
    requiredLiterals: ["ENGINE_DB_ISOLATED", "DIRECT_SAFE_UNIT_01"],
    answerBearing: true,
    expectedCapability: "CARD_DISCLOSABLE",
    expectedAuthority: "CARD",
  });
}

function invalidProjectionRow(expectedProjectionValid) {
  const row = directSafeRow();
  row.label.expected_projection_valid = expectedProjectionValid;
  row.canonical_memory.content_ref.content_hash = new String("sha256:synthetic-direct-safe-unit-01");
  return row;
}

function redactableSecretRow() {
  return makeRow({
    caseId: "redactable-secret-unit-01",
    family: "redactable_secret",
    text: "Synthetic redactable answer ENGINE_DB_ISOLATED REDACTABLE_UNIT_01 SECRET_UNIT_7391.",
    policy: {
      risk_flags: ["secret"],
      current_safe_to_disclose: false,
    },
    forbiddenLiterals: ["SECRET_UNIT_7391"],
    requiredLiterals: ["ENGINE_DB_ISOLATED", "REDACTABLE_UNIT_01"],
    answerBearing: true,
    expectedCapability: "INTERNAL_CONTEXT",
    expectedAuthority: "NONE",
  });
}

function rawLogSemanticLossRow() {
  return makeRow({
    caseId: "raw-log-unit-01",
    family: "raw_log",
    category: "raw_log",
    kind: "diagnostic",
    text: "Synthetic raw log answer ENGINE_DB_ISOLATED RAW_LOG_UNIT_01 RAW_LOG_UNSAFE_UNIT_01.",
    policy: {
      risk_flags: ["raw_log_like"],
      artifact_state: "raw_log",
      current_safe_to_disclose: false,
    },
    runtimeRiskFlags: ["raw_log_like"],
    forbiddenLiterals: ["RAW_LOG_UNSAFE_UNIT_01"],
    requiredLiterals: ["ENGINE_DB_ISOLATED", "RAW_LOG_UNIT_01"],
    answerBearing: true,
    expectedCapability: "RETRIEVAL_ONLY",
    expectedAuthority: "NONE",
  });
}

function capabilityBlockedRow() {
  return makeRow({
    caseId: "capability-blocked-unit-01",
    family: "capability_blocked",
    text: "Synthetic blocked answer ENGINE_DB_ISOLATED CAPABILITY_BLOCKED_UNIT_01.",
    policy: {
      lifecycle_state: "archived",
      capability_blocker: "lifecycle",
      current_safe_to_disclose: true,
    },
    forbiddenLiterals: [],
    requiredLiterals: ["ENGINE_DB_ISOLATED", "CAPABILITY_BLOCKED_UNIT_01"],
    answerBearing: true,
    expectedCapability: "RETRIEVAL_ONLY",
    expectedAuthority: "NONE",
  });
}

test("direct safe case measures valid, safe, preserved, and card-authorized independently", () => {
  const result = evaluateProjectionAwareCase(directSafeRow());

  assert.equal(result.projection_valid, true);
  assert.equal(result.projection_validation_reason, "valid");
  assert.equal(result.actual_surface_safe, true);
  assert.deepEqual(result.forbidden_literals_present, []);
  assert.equal(result.actual_semantic_preserved, true);
  assert.deepEqual(result.required_literals_missing, []);
  assert.equal(result.actual_capability, "CARD_DISCLOSABLE");
  assert.equal(result.actual_capability_reason, "card_allowed");
  assert.equal(result.actual_disclosure_authority, "CARD");
  assert.equal(result.capability_matches_expected, true);
  assert.equal(result.disclosure_authority_matches_expected, true);
  assert.equal(result.useful_projection, true);
  assert.equal(result.projection_feasible_but_capability_blocked, false);
  assert.deepEqual(Object.keys(result.projected_payload).sort(), [...CARD_PAYLOAD_FIELDS].sort());
  assert.equal(Object.hasOwn(result, "canonical_memory"), false);
  assert.equal(Object.hasOwn(result, "runtime_candidate"), false);
  assert.equal(Object.hasOwn(result.projected_payload, "provenance"), false);
});

test("actual valid projection matches an expected valid projection", () => {
  const result = evaluateProjectionAwareCase(directSafeRow());

  assert.equal(result.expected_projection_valid, true);
  assert.equal(result.projection_valid, true);
  assert.equal(result.projection_valid_matches_expected, true);
});

test("actual invalid projection matches an expected invalid projection", () => {
  const result = evaluateProjectionAwareCase(invalidProjectionRow(false));

  assert.equal(result.expected_projection_valid, false);
  assert.equal(result.projection_valid, false);
  assert.equal(result.projection_valid_matches_expected, true);
});

test("actual invalid projection does not match an expected valid projection", () => {
  const result = evaluateProjectionAwareCase(invalidProjectionRow(true));

  assert.equal(result.expected_projection_valid, true);
  assert.equal(result.projection_valid, false);
  assert.equal(result.projection_valid_matches_expected, false);
});

test("expected projection validity is evidence only, not projector or capability input", () => {
  const expectedValidRow = directSafeRow();
  const expectedInvalidRow = structuredClone(expectedValidRow);
  expectedInvalidRow.label.expected_projection_valid = false;

  const expectedValid = evaluateProjectionAwareCase(expectedValidRow);
  const expectedInvalid = evaluateProjectionAwareCase(expectedInvalidRow);

  assert.deepEqual(expectedInvalid.projected_payload, expectedValid.projected_payload);
  assert.equal(expectedInvalid.projection_valid, expectedValid.projection_valid);
  assert.equal(expectedInvalid.actual_capability, expectedValid.actual_capability);
  assert.equal(expectedInvalid.actual_capability_reason, expectedValid.actual_capability_reason);
  assert.equal(expectedInvalid.actual_disclosure_authority, expectedValid.actual_disclosure_authority);
  assert.equal(expectedValid.projection_valid_matches_expected, true);
  assert.equal(expectedInvalid.projection_valid_matches_expected, false);
});

test("unsafe literal survives a valid projection without becoming a useful projection", () => {
  const result = evaluateProjectionAwareCase(redactableSecretRow());

  assert.equal(result.projection_valid, true);
  assert.equal(result.actual_surface_safe, false);
  assert.deepEqual(result.forbidden_literals_present, ["SECRET_UNIT_7391"]);
  assert.equal(result.actual_semantic_preserved, true);
  assert.equal(result.actual_capability, "INTERNAL_CONTEXT");
  assert.equal(result.actual_disclosure_authority, "NONE");
  assert.equal(result.useful_projection, false);
  assert.equal(result.projection_feasible_but_capability_blocked, false);
});

test("safe but semantic-loss projection is not counted as useful", () => {
  const result = evaluateProjectionAwareCase(rawLogSemanticLossRow());

  assert.equal(result.projection_valid, true);
  assert.equal(result.actual_surface_safe, true);
  assert.deepEqual(result.forbidden_literals_present, []);
  assert.equal(result.actual_semantic_preserved, false);
  assert.deepEqual(result.required_literals_missing, ["ENGINE_DB_ISOLATED", "RAW_LOG_UNIT_01"]);
  assert.equal(result.useful_projection, false);
  assert.equal(result.actual_capability, "RETRIEVAL_ONLY");
});

test("useful projection can remain capability-blocked", () => {
  const result = evaluateProjectionAwareCase(capabilityBlockedRow());

  assert.equal(result.projection_valid, true);
  assert.equal(result.actual_surface_safe, true);
  assert.equal(result.actual_semantic_preserved, true);
  assert.equal(result.useful_projection, true);
  assert.equal(result.actual_capability, "RETRIEVAL_ONLY");
  assert.equal(result.actual_capability_reason, "blocked_lifecycle");
  assert.equal(result.actual_disclosure_authority, "NONE");
  assert.equal(result.projection_feasible_but_capability_blocked, true);
  assert.equal(result.capability_matches_expected, true);
  assert.equal(result.disclosure_authority_matches_expected, true);
});

test("projection failure is bounded and fail-closed without source body or raw exception", () => {
  const row = directSafeRow();
  row.canonical_memory.content_ref.content_hash = new String("sha256:synthetic-direct-safe-unit-01");

  const result = evaluateProjectionAwareCase(row);

  assert.equal(result.projection_valid, false);
  assert.equal(result.projection_validation_reason, "projection_failed");
  assert.equal(result.projected_payload, null);
  assert.equal(result.forbidden_literals_present, null);
  assert.equal(result.actual_surface_safe, null);
  assert.equal(result.required_literals_missing, null);
  assert.equal(result.actual_semantic_preserved, null);
  assert.equal(result.useful_projection, false);
  assert.equal(result.projection_feasible_but_capability_blocked, false);
  assert.equal(result.actual_capability, "RETRIEVAL_ONLY");
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("ENGINE_DB_ISOLATED"), false);
  assert.equal(serialized.includes("stack"), false);
});

test("case evaluation does not mutate caller inputs", () => {
  const row = capabilityBlockedRow();
  const before = structuredClone(row);

  evaluateProjectionAwareCase(row);

  assert.deepEqual(row, before);
});

test("aggregate metrics distinguish safety, semantics, usefulness, and authority", () => {
  const result = evaluateProjectionAwareCases([
    directSafeRow(),
    redactableSecretRow(),
    rawLogSemanticLossRow(),
    capabilityBlockedRow(),
  ]);

  assert.equal(result.case_count, 4);
  assert.equal(result.projection_valid_count, 4);
  assert.equal(result.projection_invalid_count, 0);
  assert.equal(result.surface_safe_count, 3);
  assert.equal(result.surface_unsafe_count, 1);
  assert.equal(result.answer_bearing_total, 4);
  assert.equal(result.answer_bearing_semantic_preserved, 3);
  assert.equal(result.semantic_preservation_rate, 0.75);
  assert.equal(result.useful_projection_count, 2);
  assert.equal(result.useful_projection_rate, 0.5);
  assert.equal(result.card_authorized_useful_projection_count, 1);
  assert.equal(result.projection_feasible_but_capability_blocked_count, 1);
  assert.equal(result.capability_match_count, 4);
  assert.equal(result.capability_match_rate, 1);
  assert.equal(result.disclosure_authority_match_count, 4);
  assert.equal(result.disclosure_authority_match_rate, 1);
  assert.deepEqual(Object.keys(result.family_breakdown), [...PROJECTION_AWARE_HOLDOUT_FAMILIES]);
  assert.deepEqual(result.family_breakdown.direct_safe, {
    cases: 1,
    answer_bearing: 1,
    projection_valid: 1,
    projection_valid_match: 1,
    surface_safe: 1,
    semantic_preserved: 1,
    useful_projection: 1,
    capability_blocked_useful: 0,
  });
  assert.deepEqual(result.family_breakdown.capability_blocked, {
    cases: 1,
    answer_bearing: 1,
    projection_valid: 1,
    projection_valid_match: 1,
    surface_safe: 1,
    semantic_preserved: 1,
    useful_projection: 1,
    capability_blocked_useful: 1,
  });
  assert.deepEqual(result.side_effects, {
    retrieval: false,
    db_writes: false,
    data_mutation: false,
    selector: false,
    network: false,
    llm: false,
    runtime: false,
  });
});

test("aggregate metrics report projection validity contract matches", () => {
  const result = evaluateProjectionAwareCases([
    directSafeRow(),
    invalidProjectionRow(false),
    invalidProjectionRow(true),
  ]);

  assert.equal(result.case_count, 3);
  assert.equal(result.projection_valid_count, 1);
  assert.equal(result.projection_invalid_count, 2);
  assert.equal(result.projection_valid_match_count, 2);
  assert.equal(result.projection_valid_match_rate, 0.6667);
  assert.equal(result.family_breakdown.direct_safe.projection_valid_match, 2);
});

test("fixture API requires the complete frozen contract without opening a fixture", () => {
  assert.throws(() => evaluateProjectionAwareFixture([directSafeRow()]), error => {
    assert.equal(error.code, "invalid_projection_aware_holdout_row");
    assert.equal(error.message, "projection-aware case must pass the frozen holdout row contract");
    assert.equal(JSON.stringify(error).includes("ENGINE_DB_ISOLATED"), false);
    return true;
  });
});

test("evaluator has no direct selector, storage, retrieval, network, or LLM boundary", () => {
  const source = readFileSync(EVALUATOR_PATH, "utf8");
  for (const forbidden of [
    "disclosure-selector.js",
    "selectDisclosureCandidates",
    "better-sqlite3",
    "node:sqlite",
    "readFileSync",
    "writeFile",
    "fetch(",
    "http://",
    "https://",
    "openclaw/memory",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
