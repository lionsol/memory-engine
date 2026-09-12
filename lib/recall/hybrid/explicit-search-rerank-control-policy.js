const R3_C0_PROFILE = Object.freeze({
  mode: "control",
  candidateDepth: 20,
  maxCodePointsPerCandidate: 4000,
  maxTotalCodePoints: 48000,
  deadlineMs: 2500,
  adapterIdentity: Object.freeze({
    provider: "local-control",
    model: "none",
    revision: "r3-c0-control-v1",
  }),
});

export const R3_C0_CONTROL_ADAPTER_MUST_NOT_BE_CALLED = "R3_C0_CONTROL_ADAPTER_MUST_NOT_BE_CALLED";

function controlAdapter() {
  const error = new Error(R3_C0_CONTROL_ADAPTER_MUST_NOT_BE_CALLED);
  error.code = R3_C0_CONTROL_ADAPTER_MUST_NOT_BE_CALLED;
  throw error;
}

export function createExplicitSearchRerankControlPolicy(effectiveRuntimeConfig) {
  if (effectiveRuntimeConfig?.valid !== true) return null;
  if (effectiveRuntimeConfig.explicitSearchRerankControl?.enabled !== true) return null;

  return Object.freeze({
    enabled: true,
    ...R3_C0_PROFILE,
    adapter: controlAdapter,
  });
}

export { R3_C0_PROFILE };
