import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  REDACTION_EVIDENCE_AUTHORITY_KINDS,
  REDACTION_EVIDENCE_SCHEMA_VERSION,
  assertValidStructuredRedactionEvidence,
  computeDisclosureCardBaselineProjectionHash,
  explainStructuredRedactionEvidenceValidation,
  validateStructuredRedactionEvidence,
} from "../../lib/recall/disclosure/redaction-evidence-contract.js";
import {
  explainProjectionArtifactValidation,
  projectCanonicalMemoryToDisclosureCardArtifact,
  projectCanonicalMemoryToVectorArtifact,
} from "../../lib/canonical/projection-artifact.js";

const SECRET_LITERAL = "RDE_C10_SECRET_ALPHA_01";
const ANSWER_ANCHOR = "RDE_C10_ENGINE_ISOLATED_01";
const CANONICAL_BODY = "RDE_C10_CANONICAL_BODY_01";
const RUNTIME_BODY = "RDE_C10_RUNTIME_BODY_01";

function canonicalMemory(overrides = {}) {
  const canonical = {
    schema_version: 1,
    canonical_id: "cmem:synthetic:rde-c10-001",
    memory_id: "rde-c10-memory-001",
    source: {
      system: "synthetic_evidence_contract",
      record_type: "chunk",
      record_id: "rde-c10-record-001",
      path: "memory/projects/rde-c10-contract.md",
      core_source: "synthetic",
      line_start: 12,
      line_end: 18,
      text: CANONICAL_BODY,
      core_hash: "rde-c10-core-hash-001",
      updated_at: 1780000001001,
    },
    classification: {
      category: "project",
      category_authority: "synthetic_test",
      kind: "project_state",
      kind_basis: "synthetic_test",
    },
    temporal: {
      episode_date: null,
      episode_date_basis: null,
    },
    lifecycle: {
      management: "managed",
      category: "project",
      initial_confidence: 0.7,
      confidence: 0.84,
      last_confidence_update: 1780000001,
      base_tau_days: 30,
      hit_count: 2,
      archived: false,
      protected: false,
      conflict: false,
    },
    content_ref: {
      mode: "core_chunk",
      content_hash: "sha256:rde-c10-content-hash-001",
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
  const base = {
    id: "rde-c10-runtime-001",
    path: "memory/projects/rde-c10-contract.md",
    text: RUNTIME_BODY,
    category: "project",
    kind: "project_state",
    confidence: 0.84,
    final_score: 0.91,
    sources: ["synthetic"],
    retrieval_rank: 1,
    trace_id: "rde-c10-trace-001",
    risk_flags: ["conflict_flag", "low_confidence"],
    card: {
      title: "RDE_C10 baseline title",
      summary: `${ANSWER_ANCHOR} remains true while ${SECRET_LITERAL} is bounded material.`,
      salience_reason: "RDE_C10 baseline salience reason",
    },
  };
  return {
    ...base,
    ...overrides,
    card: {
      ...base.card,
      ...(overrides.card || {}),
    },
  };
}

function baselineFixture() {
  const canonical = canonicalMemory();
  const runtime = runtimeCandidate();
  const baseline = projectCanonicalMemoryToDisclosureCardArtifact(canonical, runtime);
  return { canonical, runtime, baseline };
}

function makeEvidence(canonical, baseline, overrides = {}) {
  return {
    schema_version: REDACTION_EVIDENCE_SCHEMA_VERSION,
    memory_id: canonical.memory_id,
    canonical_id: canonical.canonical_id,
    source_content_hash: canonical.content_ref.content_hash,
    surface: "DISCLOSURE_CARD",
    baseline_projection_hash: computeDisclosureCardBaselineProjectionHash(baseline, canonical),
    directives: [{
      field: "summary",
      literal: SECRET_LITERAL,
      authority_kind: "STRUCTURED_SOURCE_ANNOTATION",
      evidence_ref: "annotation:rde-c10-annotation-001",
    }],
    ...overrides,
  };
}

function assertReason(result, reason) {
  assert.deepEqual(result, { valid: false, reason });
}

function captureThrownError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  assert.fail("expected callback to throw");
}

test("valid structured source annotation evidence binds identity, surface, baseline, and target", () => {
  const { canonical, baseline } = baselineFixture();
  const evidence = makeEvidence(canonical, baseline);

  assert.deepEqual(explainStructuredRedactionEvidenceValidation(
    evidence,
    canonical,
    baseline,
  ), { valid: true, reason: "valid" });
  assert.equal(validateStructuredRedactionEvidence(evidence, canonical, baseline), true);
  assert.deepEqual(assertValidStructuredRedactionEvidence(evidence, canonical, baseline), evidence);
});

test("accepted explicit and research detector authority kinds are structurally representable only", () => {
  const { canonical, baseline } = baselineFixture();
  assert.deepEqual(REDACTION_EVIDENCE_AUTHORITY_KINDS, [
    "STRUCTURED_SOURCE_ANNOTATION",
    "EXPLICIT_REDACTION_DIRECTIVE",
    "DETERMINISTIC_DETECTOR_EVIDENCE",
  ]);

  for (const [authorityKind, evidenceRef] of [
    ["EXPLICIT_REDACTION_DIRECTIVE", "directive:rde-c10-owner-review-001"],
    ["DETERMINISTIC_DETECTOR_EVIDENCE", "detector:rde-c10-rule-v1-run-001"],
  ]) {
    const evidence = makeEvidence(canonical, baseline, {
      directives: [{
        field: "summary",
        literal: SECRET_LITERAL,
        authority_kind: authorityKind,
        evidence_ref: evidenceRef,
      }],
    });
    const result = explainStructuredRedactionEvidenceValidation(evidence, canonical, baseline);
    assert.deepEqual(result, { valid: true, reason: "valid" });
    assert.equal(Object.hasOwn(result, "authorized"), false);
    assert.equal(Object.hasOwn(result, "production_authorized"), false);
    assert.equal(Object.hasOwn(result, "safe_to_disclose"), false);
    assert.equal(Object.hasOwn(result, "capability"), false);
    assert.equal(Object.hasOwn(assertValidStructuredRedactionEvidence(evidence, canonical, baseline), "capability"), false);
  }
});

test("canonical memory identity mismatches fail closed independently", () => {
  const { canonical, baseline } = baselineFixture();
  const evidence = makeEvidence(canonical, baseline);
  const cases = [
    ["memory_id", "rde-c10-wrong-memory", "canonical_memory_id_mismatch"],
    ["canonical_id", "cmem:synthetic:rde-c10-wrong", "canonical_id_mismatch"],
    ["source_content_hash", "sha256:rde-c10-wrong-content", "source_content_hash_mismatch"],
  ];

  for (const [field, value, reason] of cases) {
    assertReason(
      explainStructuredRedactionEvidenceValidation(
        { ...evidence, [field]: value },
        canonical,
        baseline,
      ),
      reason,
    );
  }
});

test("baseline projection hash binds representation and rejects stale evidence", () => {
  const { canonical, baseline } = baselineFixture();
  const evidence = makeEvidence(canonical, baseline);
  const baselineB = {
    ...baseline,
    payload: {
      ...baseline.payload,
      title: `${baseline.payload.title} changed`,
    },
  };

  assert.equal(explainProjectionArtifactValidation(baselineB, canonical).valid, true);
  assert.notEqual(
    computeDisclosureCardBaselineProjectionHash(baseline, canonical),
    computeDisclosureCardBaselineProjectionHash(baselineB, canonical),
  );
  assertReason(
    explainStructuredRedactionEvidenceValidation(evidence, canonical, baselineB),
    "baseline_projection_hash_mismatch",
  );
});

test("only DISCLOSURE_CARD evidence surface is accepted", () => {
  const { canonical, baseline } = baselineFixture();
  const evidence = makeEvidence(canonical, baseline, { surface: "VECTOR_INDEX" });
  assertReason(
    explainStructuredRedactionEvidenceValidation(evidence, canonical, baseline),
    "unsupported_redaction_evidence_surface",
  );

  const vector = projectCanonicalMemoryToVectorArtifact(canonical);
  const error = captureThrownError(() => computeDisclosureCardBaselineProjectionHash(vector, canonical));
  assert.equal(error instanceof TypeError, true);
  assert.equal(error.reason, "unsupported_redaction_evidence_surface");
});

test("forbidden fields and absent baseline targets fail closed", () => {
  const { canonical, baseline } = baselineFixture();
  const evidence = makeEvidence(canonical, baseline);

  for (const field of ["risk_flags", "category"]) {
    assertReason(
      explainStructuredRedactionEvidenceValidation(
        {
          ...evidence,
          directives: [{
            ...evidence.directives[0],
            field,
          }],
        },
        canonical,
        baseline,
      ),
      "redaction_field_not_allowed",
    );
  }

  assertReason(
    explainStructuredRedactionEvidenceValidation(
      {
        ...evidence,
        directives: [{
          ...evidence.directives[0],
          literal: "RDE_C10_ABSENT_FROM_BASELINE_01",
          evidence_ref: "annotation:rde-c10-absent-001",
        }],
      },
      canonical,
      baseline,
    ),
    "redaction_target_not_found_in_baseline",
  );
});

test("duplicate field and literal directives fail even with distinct evidence refs", () => {
  const { canonical, baseline } = baselineFixture();
  const evidence = makeEvidence(canonical, baseline, {
    directives: [
      makeEvidence(canonical, baseline).directives[0],
      {
        field: "summary",
        literal: SECRET_LITERAL,
        authority_kind: "EXPLICIT_REDACTION_DIRECTIVE",
        evidence_ref: "directive:rde-c10-owner-review-002",
      },
    ],
  });
  assertReason(
    explainStructuredRedactionEvidenceValidation(evidence, canonical, baseline),
    "duplicate_redaction_directive",
  );
});

test("evidence references are bounded, authority-prefixed, and literal-free", () => {
  const { canonical, baseline } = baselineFixture();
  const cases = [
    ["directive:rde-c10-wrong-prefix", "invalid_evidence_ref"],
    ["annotation:rde-c10-with whitespace", "invalid_evidence_ref"],
    ["annotation:rde-c10-with\u0001control", "invalid_evidence_ref"],
    [`annotation:${"x".repeat(247)}`, "invalid_evidence_ref"],
    [`annotation:${SECRET_LITERAL}`, "evidence_ref_contains_redaction_literal"],
  ];

  for (const [evidenceRef, reason] of cases) {
    assertReason(
      explainStructuredRedactionEvidenceValidation(
        {
          ...makeEvidence(canonical, baseline),
          directives: [{
            ...makeEvidence(canonical, baseline).directives[0],
            evidence_ref: evidenceRef,
          }],
        },
        canonical,
        baseline,
      ),
      reason,
    );
  }
});

test("closed envelope and directive schemas reject downstream authority fields", () => {
  const { canonical, baseline } = baselineFixture();
  const evidence = makeEvidence(canonical, baseline);

  for (const field of ["capability", "safe_to_disclose", "selector_result"]) {
    assertReason(
      explainStructuredRedactionEvidenceValidation(
        { ...evidence, [field]: true },
        canonical,
        baseline,
      ),
      "invalid_redaction_evidence_envelope",
    );
  }
  for (const field of ["replacement", "authorized"]) {
    assertReason(
      explainStructuredRedactionEvidenceValidation(
        {
          ...evidence,
          directives: [{ ...evidence.directives[0], [field]: true }],
        },
        canonical,
        baseline,
      ),
      "invalid_redaction_directive",
    );
  }
});

test("baseline hash is deterministic, key-order independent, and provenance-independent", () => {
  const { canonical, baseline } = baselineFixture();
  const first = computeDisclosureCardBaselineProjectionHash(baseline, canonical);
  const second = computeDisclosureCardBaselineProjectionHash(baseline, canonical);
  assert.match(first, /^[0-9a-f]{64}$/u);
  assert.equal(first, second);

  const reorderedPayload = Object.fromEntries(
    Object.entries(baseline.payload).reverse(),
  );
  const reordered = {
    ...baseline,
    payload: reorderedPayload,
    provenance: {
      ...baseline.provenance,
      adapter: "synthetic-different-adapter",
    },
  };
  assert.equal(explainProjectionArtifactValidation(reordered, canonical).valid, true);
  assert.equal(computeDisclosureCardBaselineProjectionHash(reordered, canonical), first);

  const changedPayload = {
    ...baseline,
    payload: {
      ...baseline.payload,
      summary: `${baseline.payload.summary} changed`,
    },
  };
  assert.notEqual(computeDisclosureCardBaselineProjectionHash(changedPayload, canonical), first);
});

test("invalid baseline artifacts fail closed with bounded reasons", () => {
  const { canonical, baseline } = baselineFixture();
  const evidence = makeEvidence(canonical, baseline);
  const invalidBaseline = {
    ...baseline,
    payload: {
      ...baseline.payload,
      title: "",
    },
  };
  assertReason(
    explainStructuredRedactionEvidenceValidation(evidence, canonical, invalidBaseline),
    "invalid_baseline_projection",
  );
  const error = captureThrownError(() => computeDisclosureCardBaselineProjectionHash(invalidBaseline, canonical));
  assert.equal(error instanceof TypeError, true);
  assert.equal(error.reason, "invalid_baseline_projection");

  const wrongCanonical = canonicalMemory({ canonical_id: "cmem:synthetic:rde-c10-wrong" });
  assertReason(
    explainStructuredRedactionEvidenceValidation(evidence, wrongCanonical, baseline),
    "invalid_baseline_projection",
  );
});

test("all contract APIs preserve evidence, canonical, and baseline inputs", () => {
  const { canonical, baseline } = baselineFixture();
  const evidence = makeEvidence(canonical, baseline);
  const before = structuredClone({ evidence, canonical, baseline });

  computeDisclosureCardBaselineProjectionHash(baseline, canonical);
  explainStructuredRedactionEvidenceValidation(evidence, canonical, baseline);
  validateStructuredRedactionEvidence(evidence, canonical, baseline);
  assertValidStructuredRedactionEvidence(evidence, canonical, baseline);

  assert.deepEqual({ evidence, canonical, baseline }, before);
});

test("assert failures expose only bounded reasons and do not leak sensitive inputs", () => {
  const { canonical, baseline } = baselineFixture();
  const evidence = {
    ...makeEvidence(canonical, baseline),
    directives: [{
      ...makeEvidence(canonical, baseline).directives[0],
      evidence_ref: `annotation:${SECRET_LITERAL}`,
    }],
  };
  const error = captureThrownError(() => assertValidStructuredRedactionEvidence(evidence, canonical, baseline));
  assert.equal(error instanceof TypeError, true);
  assert.equal(error.reason, "evidence_ref_contains_redaction_literal");
  assert.equal(error.message.includes(SECRET_LITERAL), false);
  assert.equal(error.message.includes(CANONICAL_BODY), false);
  assert.equal(error.message.includes(RUNTIME_BODY), false);
  assert.equal(JSON.stringify(error).includes(SECRET_LITERAL), false);
});

test("contract module stays within the pure offline dependency boundary", () => {
  const source = readFileSync(
    new URL("../../lib/recall/disclosure/redaction-evidence-contract.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /node:crypto/u);
  assert.match(source, /explainProjectionArtifactValidation/u);
  for (const forbidden of [
    "node:fs",
    "redacted-card-prototype",
    "redacted-card-evaluator",
    "capability",
    "selector",
    "DB",
    "fetch(",
    "test/fixtures",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
