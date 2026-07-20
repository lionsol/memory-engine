import { randomUUID } from "node:crypto";

export const PRODUCTION_EVIDENCE_HEALTHCHECK_METHOD = "memoryEngine.productionEvidenceHealthcheck";
export const PRODUCTION_EVIDENCE_HEALTHCHECK_QUERY = "memory engine production evidence healthcheck";

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resultCount(value) {
  if (Array.isArray(value?.results)) return value.results.length;
  if (Array.isArray(value?.items)) return value.items.length;
  const numeric = Number(value?.result_count ?? value?.count);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function errorMessage(error) {
  return String(error?.message || error || "scheduled healthcheck failed");
}

export function createProductionEvidenceHealthcheckRunner({
  trafficOriginRegistry,
  executeMemoryEngineSearch,
  executeMemoryEngineAction,
  productionEvidenceWindow,
  kgFailClosedMode,
  recentFailClosedMode,
  autoRecallEnabled,
  uuid = randomUUID,
} = {}) {
  if (!trafficOriginRegistry || typeof trafficOriginRegistry.recordScheduledHealthcheck !== "function") {
    throw new TypeError("trafficOriginRegistry.recordScheduledHealthcheck is required");
  }
  if (typeof executeMemoryEngineSearch !== "function") throw new TypeError("executeMemoryEngineSearch is required");
  if (typeof executeMemoryEngineAction !== "function") throw new TypeError("executeMemoryEngineAction is required");

  return async function runProductionEvidenceHealthcheck() {
    const epochId = nonEmptyString(productionEvidenceWindow?.epochId);
    if (productionEvidenceWindow?.enabled !== true || !epochId) {
      throw new Error("production evidence window is not active with a valid epoch");
    }
    if (kgFailClosedMode !== "full_fail_closed" || recentFailClosedMode !== "full_fail_closed") {
      throw new Error("scheduled evidence healthcheck requires KG and Recent full_fail_closed");
    }
    if (autoRecallEnabled !== true) {
      throw new Error("scheduled evidence healthcheck requires sustained AutoRecall enablement");
    }
    const sessionId = `production-evidence:${epochId}`;
    const agentId = "memory-engine-production-healthcheck";
    const healthcheckRunId = uuid();
    const surfaces = [
      {
        surface: "memory_engine_search",
        execute: executeMemoryEngineSearch,
        params: { query: PRODUCTION_EVIDENCE_HEALTHCHECK_QUERY, top_k: 1 },
      },
      {
        surface: "memory_engine_action_search",
        execute: executeMemoryEngineAction,
        params: { action: "search", text: PRODUCTION_EVIDENCE_HEALTHCHECK_QUERY, top_k: 1 },
      },
    ];
    const results = [];
    for (const item of surfaces) {
      const toolCallId = `scheduled-healthcheck-${healthcheckRunId}-${item.surface}`;
      const recorded = trafficOriginRegistry.recordScheduledHealthcheck({
        toolCallId,
        healthcheckRunId,
        agentId,
        sessionId,
        surface: item.surface,
      });
      if (!recorded) throw new Error(`failed to register scheduled healthcheck context for ${item.surface}`);
      const response = await item.execute(toolCallId, item.params);
      if (response?.error) throw new Error(`${item.surface}: ${response.error}`);
      results.push({
        surface: item.surface,
        tool_call_id: toolCallId,
        result_count: resultCount(response),
        status: "ok",
      });
    }
    return {
      schema_version: 1,
      status: "healthy",
      evidence_epoch_id: epochId,
      healthcheck_run_id: healthcheckRunId,
      surfaces: results,
    };
  };
}

export function registerProductionEvidenceHealthcheckGateway({
  api,
  trafficOriginRegistry,
  executeMemoryEngineSearch,
  executeMemoryEngineAction,
  productionEvidenceWindow,
  kgFailClosedMode,
  recentFailClosedMode,
  autoRecallEnabled,
  uuid,
} = {}) {
  if (!api || typeof api.registerGatewayMethod !== "function") return false;
  const runHealthcheck = createProductionEvidenceHealthcheckRunner({
    trafficOriginRegistry,
    executeMemoryEngineSearch,
    executeMemoryEngineAction,
    productionEvidenceWindow,
    kgFailClosedMode,
    recentFailClosedMode,
    autoRecallEnabled,
    uuid,
  });
  api.registerGatewayMethod(PRODUCTION_EVIDENCE_HEALTHCHECK_METHOD, async ({ respond }) => {
    try {
      respond(true, await runHealthcheck());
    } catch (error) {
      respond(false, undefined, {
        code: "PRODUCTION_EVIDENCE_HEALTHCHECK_FAILED",
        message: errorMessage(error),
      });
    }
  }, { scope: "operator.read" });
  return true;
}

export { nonEmptyString, resultCount };
