import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFieldAssessment,
  sanitizeRuntimeProbe,
  buildRecentCanaryScopeAuditReport,
  buildCurrentRecentCanaryScopeAuditReport,
} from "../lib/recall/hybrid/recent-canary-scope-audit.js";

test("field trust classes preserve trusted, ambiguous, and user-controlled distinctions", () => {
  assert.equal(buildFieldAssessment({
    field: "runtime.agentId",
    trust_class: "trusted_framework_context",
  }).trust_class, "trusted_framework_context");

  assert.equal(buildFieldAssessment({
    field: "toolCallId",
    trust_class: "framework_derived_but_ambiguous",
  }).trust_class, "framework_derived_but_ambiguous");

  assert.equal(buildFieldAssessment({
    field: "params.query",
    trust_class: "user_controlled",
  }).trust_class, "user_controlled");
});

test("runtime probe sanitization hashes values and never leaks raw identifiers", () => {
  const probe = sanitizeRuntimeProbe({
    verified: true,
    handler_argument_count: 5,
    context_present: true,
    fields: [
      { name: "agentId", value: "edi", user_controllable: false },
      { name: "sessionId", value: "session-secret-123", user_controllable: false },
    ],
  });

  assert.equal(probe.verified, true);
  assert.equal(probe.fields[0].length, 3);
  assert.equal(typeof probe.fields[0].hash, "string");
  const serialized = JSON.stringify(probe);
  assert.equal(serialized.includes("session-secret-123"), false);
  assert.equal(serialized.includes("\"edi\""), false);
});

test("decision passes only when trusted scope and sample key are both reachable on tool path", () => {
  const pass = buildRecentCanaryScopeAuditReport({
    fields: [
      {
        field: "runtime.agentId",
        trust_class: "trusted_framework_context",
        suitable_for_scope: true,
        suitable_for_sample_key: false,
        reachable_from_memory_engine_tool_path: true,
      },
      {
        field: "runtime.sessionId",
        trust_class: "trusted_framework_context",
        suitable_for_scope: false,
        suitable_for_sample_key: true,
        reachable_from_memory_engine_tool_path: true,
      },
    ],
  });
  assert.equal(pass.decision.class, "pass_trusted_scope_feasibility");
  assert.equal(pass.recommended_scope_mapping.scope_class_source, "runtime.agentId");
  assert.equal(pass.recommended_scope_mapping.sample_key_source, "runtime.sessionId");
});

test("decision is partial when only one trusted capability is reachable", () => {
  const onlyAgent = buildRecentCanaryScopeAuditReport({
    fields: [
      {
        field: "runtime.agentId",
        trust_class: "trusted_framework_context",
        suitable_for_scope: true,
        reachable_from_memory_engine_tool_path: true,
      },
    ],
  });
  assert.equal(onlyAgent.decision.class, "partial_scope_feasibility");

  const onlySession = buildRecentCanaryScopeAuditReport({
    fields: [
      {
        field: "runtime.sessionId",
        trust_class: "trusted_framework_context",
        suitable_for_sample_key: true,
        reachable_from_memory_engine_tool_path: true,
      },
    ],
  });
  assert.equal(onlySession.decision.class, "partial_scope_feasibility");
});

test("decision is inconclusive for unknown reachable semantics", () => {
  const report = buildRecentCanaryScopeAuditReport({
    fields: [
      {
        field: "runtime.requestContext",
        trust_class: "unknown",
        reachable_from_memory_engine_tool_path: true,
      },
    ],
  });
  assert.equal(report.decision.class, "inconclusive");
});

test("current memory-engine tool path reports no trusted scope available", () => {
  const report = buildCurrentRecentCanaryScopeAuditReport({
    openclaw_install: {
      which_openclaw: "/usr/bin/openclaw",
    },
  });
  assert.equal(report.decision.class, "no_trusted_scope_available");
  assert.equal(report.recommended_scope_mapping.scope_class_source, null);
  assert.equal(report.recommended_scope_mapping.sample_key_source, null);
  assert.equal(report.production_enablement_recommended, false);
  assert.equal(report.sample_rate_basis_points, 0);
});

test("default report keeps provider disabled and avoids raw scope values", () => {
  const report = buildCurrentRecentCanaryScopeAuditReport();
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("scope-secret"), false);
  assert.equal(report.recent_shadow_remains_disabled, true);
  assert.equal(report.production_enablement_recommended, false);
});
