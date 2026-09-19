import {
  createSiliconFlowRecallHintAdapterV1,
  RECALL_HINT_RUNTIME_DEADLINE_MS_V1,
  siliconFlowRecallHintAdapterIdentityV1,
} from "./siliconflow-recall-hint-adapter-v1.js";

export const RECALL_HINT_RUNTIME_PROVIDER_POLICY_SCHEMA_V1 = "memory_engine_recall_hint_runtime_provider_policy_v1";

export function createRecallHintRuntimeProviderPolicyV1(
  effectiveRuntimeConfig,
  { apiKey, transport, onCredentialMissing } = {},
) {
  if (effectiveRuntimeConfig?.valid !== true) return null;
  const canary = effectiveRuntimeConfig.recallHintRuntimeCanary;
  if (canary?.enabled !== true) return null;
  if (!Array.isArray(canary.sessionIds) || canary.sessionIds.length === 0) return null;
  if (canary.executionProbe === "rh_l3_canonical_v1") return null;
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    if (typeof onCredentialMissing === "function") {
      onCredentialMissing("RECALL_HINT_SF_API_KEY_REQUIRED");
    }
    return null;
  }

  const provider = createSiliconFlowRecallHintAdapterV1({
    apiKey,
    ...(typeof transport === "function" ? { transport } : {}),
  });

  return Object.freeze({
    schema: RECALL_HINT_RUNTIME_PROVIDER_POLICY_SCHEMA_V1,
    enabled: true,
    deadlineMs: RECALL_HINT_RUNTIME_DEADLINE_MS_V1,
    adapterIdentity: siliconFlowRecallHintAdapterIdentityV1(),
    provider,
  });
}
