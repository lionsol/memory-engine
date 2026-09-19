import {
  createSiliconFlowRerankAdapter,
  SILICONFLOW_RERANK_MODEL_0_6B,
  SILICONFLOW_RERANK_PROVIDER,
} from "../rerank/siliconflow-rerank-adapter.js";

export const R3_C1_B_PROVIDER_PROFILE = Object.freeze({
  mode: "rerank",
  candidateDepth: 20,
  maxCodePointsPerCandidate: 4000,
  maxTotalCodePoints: 48000,
  deadlineMs: 2500,
  adapterIdentity: Object.freeze({
    provider: SILICONFLOW_RERANK_PROVIDER,
    model: SILICONFLOW_RERANK_MODEL_0_6B,
    revision: null,
  }),
});

export function createExplicitSearchRerankProviderPolicy(
  effectiveRuntimeConfig,
  { apiKey, transport, onCredentialMissing } = {},
) {
  if (effectiveRuntimeConfig?.valid !== true) return null;
  if (effectiveRuntimeConfig.explicitSearchRerankProvider?.enabled !== true) return null;
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    if (typeof onCredentialMissing === "function") {
      onCredentialMissing("SILICONFLOW_RERANK_API_KEY_REQUIRED");
    }
    return null;
  }

  const adapter = createSiliconFlowRerankAdapter({
    apiKey,
    ...(typeof transport === "function" ? { transport } : {}),
    model: SILICONFLOW_RERANK_MODEL_0_6B,
  });

  return Object.freeze({
    enabled: true,
    ...R3_C1_B_PROVIDER_PROFILE,
    adapter,
  });
}
