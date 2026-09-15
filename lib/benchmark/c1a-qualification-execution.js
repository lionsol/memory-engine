import { validateC1AExecutionPacket } from "./c1a-execution-packet.js";
import { buildC1ALocomoScoreRows } from "./c1a-locomo-qualification.js";
import { runC1AQualificationBatch } from "./c1a-qualification-batch.js";
import { createC1AExecutionBudget } from "./c1a-qualification-runner.js";
import { scoreC1AQualification } from "./c1a-qualification-scorer.js";

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function assertMaterialEgressAllowed(material) {
  if (!Array.isArray(material?.cases)) throw fail("C1A_EXECUTION_MATERIAL_CASES_REQUIRED");
  for (const item of material.cases) {
    if (item?.query_egress !== "ALLOW") {
      throw fail("C1A_EXECUTION_MATERIAL_QUERY_EGRESS_NOT_ALLOWED", { caseId: item?.case_id ?? null });
    }
    if (!Array.isArray(item.candidates)
        || item.candidates.some(candidate => candidate?.text.length > 0 && candidate?.egress !== "ALLOW")) {
      throw fail("C1A_EXECUTION_MATERIAL_CANDIDATE_EGRESS_NOT_ALLOWED", { caseId: item?.case_id ?? null });
    }
  }
}

export async function executeC1ALocomoQualification({
  packet,
  manifest,
  material,
  sourceCommit,
  worktreeClean,
  adapter,
  tokenCounter,
  pacer,
  onEvidence,
} = {}) {
  if (typeof adapter !== "function") throw fail("C1A_EXECUTION_ADAPTER_REQUIRED");
  const binding = validateC1AExecutionPacket({
    packet,
    manifest,
    sourceCommit,
    worktreeClean,
  });
  assertMaterialEgressAllowed(material);

  const budget = createC1AExecutionBudget({
    maxRequests: binding.max_provider_requests,
    maxInputTokens: binding.max_input_tokens,
    maxCostUsd: binding.max_cost_usd,
    inputPriceUsdPerMillion: binding.input_price_usd_per_million,
  });

  const batch = await runC1AQualificationBatch({
    manifest,
    cases: material.cases,
    adapter,
    budget,
    tokenCounter,
    deadlineMs: binding.deadline_ms,
    pacer,
    onEvidence,
  });
  const rows = buildC1ALocomoScoreRows({ material, batch });
  const score = scoreC1AQualification(rows);

  return {
    schema: "memory_engine_r3_c1a_execution_result_v1",
    binding: {
      source_commit: binding.source_commit,
      manifest_sha256: binding.manifest_sha256,
      provider: binding.provider,
      model: binding.model,
      endpoint: binding.endpoint,
      max_provider_requests: binding.max_provider_requests,
      max_input_tokens: binding.max_input_tokens,
      max_cost_usd: binding.max_cost_usd,
      input_price_usd_per_million: binding.input_price_usd_per_million,
      deadline_ms: binding.deadline_ms,
      pacing_min_interval_ms: binding.pacing.min_interval_ms,
      pacing_token_window_ms: binding.pacing.token_window_ms,
      pacing_max_estimated_tokens_per_window: binding.pacing.max_estimated_tokens_per_window,
      rate_limit_source: binding.rate_limits.source,
    },
    batch,
    score,
  };
}
