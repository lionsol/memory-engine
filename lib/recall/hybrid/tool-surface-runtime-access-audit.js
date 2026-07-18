const REQUIRED_REGISTERED_TOOLS = Object.freeze([
  "memory_engine",
  "memory_engine_search",
  "memory_engine_get",
]);

const REQUIRED_EXECUTION_SURFACES = Object.freeze([
  "memory_engine_action_search",
  "memory_engine_search",
]);

const SUPPORTED_INVOCATION_MODES = Object.freeze([
  "gateway_rpc",
  "agent_model",
  "unknown",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function flattenToolIds(report) {
  if (!isObject(report) || !Array.isArray(report.groups)) return [];
  const ids = [];
  for (const group of report.groups) {
    if (!isObject(group) || !Array.isArray(group.tools)) continue;
    for (const tool of group.tools) {
      if (!isObject(tool)) continue;
      const id = typeof tool.id === "string" ? tool.id.trim() : "";
      if (id) ids.push(id);
    }
  }
  return uniqueSorted(ids);
}

function parseMetadata(row) {
  if (!isObject(row)) return null;
  if (isObject(row.metadata_json)) return row.metadata_json;
  if (typeof row.metadata_json === "string") {
    try {
      const parsed = JSON.parse(row.metadata_json);
      return isObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  if (isObject(row.metadata)) return row.metadata;
  return row;
}

function countObservedToolSurfaces(observations) {
  const counts = Object.fromEntries(REQUIRED_EXECUTION_SURFACES.map(surface => [surface, 0]));
  let channelErrorObservationCount = 0;
  let invalidObservationCount = 0;
  let nonCanonicalObservationCount = 0;
  let unsupportedSchemaVersionCount = 0;
  let nonExecutedObservationCount = 0;

  for (const row of Array.isArray(observations) ? observations : []) {
    const metadata = parseMetadata(row);
    if (!metadata) {
      invalidObservationCount += 1;
      continue;
    }
    const surface = typeof metadata.surface === "string" ? metadata.surface.trim() : "";
    if (!REQUIRED_EXECUTION_SURFACES.includes(surface)) continue;
    const expectedSource = `hybrid.${surface}`;
    if (row.event_type !== "hybrid_search_observation" || row.source !== expectedSource) {
      nonCanonicalObservationCount += 1;
      continue;
    }
    if (metadata.schema_version !== 1) {
      unsupportedSchemaVersionCount += 1;
      continue;
    }
    if (metadata.search_executed !== true) {
      nonExecutedObservationCount += 1;
      continue;
    }
    counts[surface] += 1;
    if (Number(metadata.channel_error_count || 0) > 0) channelErrorObservationCount += 1;
  }

  return {
    counts,
    observed: REQUIRED_EXECUTION_SURFACES.filter(surface => counts[surface] > 0),
    missing: REQUIRED_EXECUTION_SURFACES.filter(surface => counts[surface] === 0),
    channelErrorObservationCount,
    invalidObservationCount,
    nonCanonicalObservationCount,
    unsupportedSchemaVersionCount,
    nonExecutedObservationCount,
  };
}

function statusForCoverage(visible, required) {
  const found = required.filter(value => visible.includes(value));
  if (found.length === required.length) return "complete";
  if (found.length === 0) return "missing";
  return "partial";
}

function addIssue(list, code, details = {}) {
  if (list.some(issue => issue.code === code)) return;
  list.push({ code, ...details });
}

export function buildToolSurfaceRuntimeAccessAudit({
  catalog,
  effective,
  observations = [],
  invocationMode = "unknown",
  generatedAt = new Date(),
} = {}) {
  const normalizedInvocationMode = String(invocationMode || "unknown").trim().toLowerCase();
  if (!SUPPORTED_INVOCATION_MODES.includes(normalizedInvocationMode)) {
    throw new Error(`unsupported invocation mode: ${invocationMode}`);
  }

  const catalogTools = flattenToolIds(catalog);
  const effectiveTools = flattenToolIds(effective);
  const registeredTools = REQUIRED_REGISTERED_TOOLS.filter(tool => catalogTools.includes(tool));
  const missingRegisteredTools = REQUIRED_REGISTERED_TOOLS.filter(tool => !catalogTools.includes(tool));
  const effectiveVisibleTools = REQUIRED_REGISTERED_TOOLS.filter(tool => effectiveTools.includes(tool));
  const effectiveHiddenTools = REQUIRED_REGISTERED_TOOLS.filter(tool => !effectiveTools.includes(tool));
  const surfaceEvidence = countObservedToolSurfaces(observations);

  const registryStatus = statusForCoverage(registeredTools, REQUIRED_REGISTERED_TOOLS);
  const effectiveVisibilityStatus = statusForCoverage(effectiveVisibleTools, REQUIRED_REGISTERED_TOOLS);
  const invocationStatus = surfaceEvidence.missing.length === 0
    ? "complete"
    : surfaceEvidence.observed.length === 0
      ? "missing"
      : "partial";

  const violations = [];
  const evidenceGaps = [];
  const warnings = [];

  if (missingRegisteredTools.length > 0) {
    addIssue(violations, "required_registered_tools_missing", { tools: missingRegisteredTools });
  }
  if (surfaceEvidence.channelErrorObservationCount > 0) {
    addIssue(violations, "tool_surface_channel_errors_present", {
      count: surfaceEvidence.channelErrorObservationCount,
    });
  }
  if (surfaceEvidence.invalidObservationCount > 0) {
    addIssue(violations, "invalid_observation_input", { count: surfaceEvidence.invalidObservationCount });
  }
  if (surfaceEvidence.nonCanonicalObservationCount > 0) {
    addIssue(violations, "non_canonical_tool_observation", {
      count: surfaceEvidence.nonCanonicalObservationCount,
    });
  }
  if (surfaceEvidence.unsupportedSchemaVersionCount > 0) {
    addIssue(violations, "unsupported_observation_schema", {
      count: surfaceEvidence.unsupportedSchemaVersionCount,
    });
  }
  for (const surface of surfaceEvidence.missing) {
    addIssue(evidenceGaps, `surface_observation_missing:${surface}`);
  }
  if (surfaceEvidence.nonExecutedObservationCount > 0) {
    addIssue(evidenceGaps, "non_executed_tool_surface_observations", {
      count: surfaceEvidence.nonExecutedObservationCount,
    });
  }
  if (effectiveVisibilityStatus !== "complete") {
    addIssue(warnings, "model_effective_tool_set_filters_memory_engine", {
      profile: typeof effective?.profile === "string" ? effective.profile : null,
      hidden_tools: effectiveHiddenTools,
    });
  }
  if (normalizedInvocationMode === "gateway_rpc") {
    addIssue(warnings, "gateway_rpc_does_not_prove_model_visibility");
  }
  if (normalizedInvocationMode === "unknown") {
    addIssue(warnings, "invocation_mode_not_verified");
  }

  const productionSurfaceExecutionConfirmed = registryStatus === "complete"
    && invocationStatus === "complete"
    && violations.length === 0;
  const modelVisibilityConfirmed = effectiveVisibilityStatus === "complete";

  let status = "tool_surface_runtime_confirmed_model_visible";
  if (violations.length > 0) status = "tool_surface_runtime_blocked";
  else if (!productionSurfaceExecutionConfirmed) status = "tool_surface_registered_not_fully_executed";
  else if (!modelVisibilityConfirmed) status = "tool_surface_runtime_confirmed_effective_filtered";

  return {
    schema_version: 1,
    status,
    agent_id: typeof effective?.agentId === "string"
      ? effective.agentId
      : typeof catalog?.agentId === "string"
        ? catalog.agentId
        : null,
    effective_profile: typeof effective?.profile === "string" ? effective.profile : null,
    invocation_mode: normalizedInvocationMode,
    registry_status: registryStatus,
    effective_visibility_status: effectiveVisibilityStatus,
    invocation_status: invocationStatus,
    required_registered_tools: [...REQUIRED_REGISTERED_TOOLS],
    registered_tools: registeredTools,
    missing_registered_tools: missingRegisteredTools,
    effective_visible_tools: effectiveVisibleTools,
    effective_hidden_tools: effectiveHiddenTools,
    required_execution_surfaces: [...REQUIRED_EXECUTION_SURFACES],
    observed_tool_surfaces: surfaceEvidence.observed,
    missing_tool_surfaces: surfaceEvidence.missing,
    production_observed_by_surface: surfaceEvidence.counts,
    channel_error_observation_count: surfaceEvidence.channelErrorObservationCount,
    invalid_observation_count: surfaceEvidence.invalidObservationCount,
    non_canonical_observation_count: surfaceEvidence.nonCanonicalObservationCount,
    unsupported_schema_version_count: surfaceEvidence.unsupportedSchemaVersionCount,
    non_executed_observation_count: surfaceEvidence.nonExecutedObservationCount,
    production_surface_execution_confirmed: productionSurfaceExecutionConfirmed,
    model_visibility_confirmed: modelVisibilityConfirmed,
    stage1_tool_surface_coverage_ready: productionSurfaceExecutionConfirmed,
    violations,
    evidence_gaps: evidenceGaps,
    warnings,
    recommendation: violations.length > 0
      ? "keep_legacy_and_investigate"
      : productionSurfaceExecutionConfirmed
        ? "tool_surface_coverage_complete"
        : "collect_missing_tool_surface_evidence",
    evidence_boundary: {
      gateway_rpc_uses_registered_gateway_tool_dispatcher: normalizedInvocationMode === "gateway_rpc",
      gateway_rpc_proves_real_tool_execution_not_model_visibility: normalizedInvocationMode === "gateway_rpc",
      effective_tool_snapshot_is_authoritative_for_model_visibility: true,
      tool_surface_execution_does_not_authorize_stage2_by_itself: true,
      tool_surface_execution_does_not_authorize_legacy_removal: true,
    },
    generated_at: new Date(generatedAt).toISOString(),
  };
}

export {
  REQUIRED_EXECUTION_SURFACES,
  REQUIRED_REGISTERED_TOOLS,
  SUPPORTED_INVOCATION_MODES,
};
