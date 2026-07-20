import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCTION_EVIDENCE_HEALTHCHECK_METHOD,
  createProductionEvidenceHealthcheckRunner,
  registerProductionEvidenceHealthcheckGateway,
} from "../lib/recall/hybrid/production-evidence-healthcheck-gateway.js";

test("plugin-owned healthcheck records scheduled origin for both tool surfaces", async () => {
  const recorded = [];
  const executed = [];
  let counter = 0;
  const runner = createProductionEvidenceHealthcheckRunner({
    trafficOriginRegistry: {
      recordScheduledHealthcheck(value) {
        recorded.push(value);
        return true;
      },
    },
    executeMemoryEngineSearch: async (toolCallId, params) => {
      executed.push({ surface: "memory_engine_search", toolCallId, params });
      return { results: [{ id: "one" }] };
    },
    executeMemoryEngineAction: async (toolCallId, params) => {
      executed.push({ surface: "memory_engine_action_search", toolCallId, params });
      return { results: [] };
    },
    productionEvidenceWindow: { enabled: true, epochId: "epoch-1" },
    kgFailClosedMode: "full_fail_closed",
    recentFailClosedMode: "full_fail_closed",
    autoRecallEnabled: true,
    uuid: () => `id-${++counter}`,
  });

  const report = await runner();
  assert.equal(report.status, "healthy");
  assert.deepEqual(recorded.map(item => item.surface), ["memory_engine_search", "memory_engine_action_search"]);
  assert.ok(recorded.every(item => item.agentId === "memory-engine-production-healthcheck"));
  assert.ok(recorded.every(item => item.sessionId === "production-evidence:epoch-1"));
  assert.ok(recorded.every(item => item.healthcheckRunId === "id-1"));
  assert.equal(report.healthcheck_run_id, "id-1");
  assert.ok(executed.every(item => item.toolCallId.includes("scheduled-healthcheck-id-1-")));
  assert.deepEqual(executed.map(item => item.params.top_k), [1, 1]);
  assert.deepEqual(report.surfaces.map(item => item.result_count), [1, 0]);
});

test("healthcheck cannot run outside an active evidence epoch", async () => {
  const runner = createProductionEvidenceHealthcheckRunner({
    trafficOriginRegistry: { recordScheduledHealthcheck: () => true },
    executeMemoryEngineSearch: async () => ({}),
    executeMemoryEngineAction: async () => ({}),
    productionEvidenceWindow: { enabled: false, epochId: null },
    kgFailClosedMode: "full_fail_closed",
    recentFailClosedMode: "full_fail_closed",
    autoRecallEnabled: true,
  });
  await assert.rejects(runner(), /not active/);
});

test("healthcheck refuses partial sustained configuration", async () => {
  const runner = createProductionEvidenceHealthcheckRunner({
    trafficOriginRegistry: { recordScheduledHealthcheck: () => true },
    executeMemoryEngineSearch: async () => ({}),
    executeMemoryEngineAction: async () => ({}),
    productionEvidenceWindow: { enabled: true, epochId: "epoch-1" },
    kgFailClosedMode: "full_fail_closed",
    recentFailClosedMode: "legacy_fallback",
    autoRecallEnabled: true,
  });
  await assert.rejects(runner(), /KG and Recent full_fail_closed/);
});

test("gateway method is operator-read scoped and returns structured errors", async () => {
  let registration;
  const api = {
    registerGatewayMethod(method, handler, options) {
      registration = { method, handler, options };
    },
  };
  assert.equal(registerProductionEvidenceHealthcheckGateway({
    api,
    trafficOriginRegistry: { recordScheduledHealthcheck: () => true },
    executeMemoryEngineSearch: async () => ({ error: "broken" }),
    executeMemoryEngineAction: async () => ({}),
    productionEvidenceWindow: { enabled: true, epochId: "epoch-1" },
    kgFailClosedMode: "full_fail_closed",
    recentFailClosedMode: "full_fail_closed",
    autoRecallEnabled: true,
  }), true);
  assert.equal(registration.method, PRODUCTION_EVIDENCE_HEALTHCHECK_METHOD);
  assert.deepEqual(registration.options, { scope: "operator.read" });
  let response;
  await registration.handler({
    respond(ok, payload, error) {
      response = { ok, payload, error };
    },
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "PRODUCTION_EVIDENCE_HEALTHCHECK_FAILED");
});
