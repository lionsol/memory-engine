import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildToolSurfaceRuntimeAccessAudit,
} from "../lib/recall/hybrid/tool-surface-runtime-access-audit.js";

const CATALOG = new URL("./fixtures/tool-surface-catalog-memory-engine.json", import.meta.url);
const EFFECTIVE_FILTERED = new URL("./fixtures/tool-surface-effective-coding-filtered.json", import.meta.url);
const OBSERVATIONS = new URL("./fixtures/tool-surface-runtime-observations.jsonl", import.meta.url);

function readJson(url) {
  return JSON.parse(readFileSync(url, "utf8"));
}

function readJsonl(url) {
  return readFileSync(url, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function effectiveVisible() {
  const effective = readJson(EFFECTIVE_FILTERED);
  effective.groups.push({
    id: "plugin:memory-engine",
    source: "plugin",
    pluginId: "memory-engine",
    tools: [
      { id: "memory_engine" },
      { id: "memory_engine_get" },
      { id: "memory_engine_search" },
    ],
  });
  return effective;
}

test("gateway RPC evidence confirms real tool surfaces while model visibility stays filtered", () => {
  const report = buildToolSurfaceRuntimeAccessAudit({
    catalog: readJson(CATALOG),
    effective: readJson(EFFECTIVE_FILTERED),
    observations: readJsonl(OBSERVATIONS),
    invocationMode: "gateway_rpc",
    generatedAt: "2026-07-18T15:15:00.000Z",
  });

  assert.equal(report.status, "tool_surface_runtime_confirmed_effective_filtered");
  assert.equal(report.registry_status, "complete");
  assert.equal(report.effective_visibility_status, "missing");
  assert.equal(report.invocation_status, "complete");
  assert.equal(report.production_surface_execution_confirmed, true);
  assert.equal(report.model_visibility_confirmed, false);
  assert.equal(report.stage1_tool_surface_coverage_ready, true);
  assert.equal(report.non_canonical_observation_count, 0);
  assert.deepEqual(report.production_observed_by_surface, {
    memory_engine_action_search: 1,
    memory_engine_search: 1,
  });
  assert.ok(report.warnings.some(issue => issue.code === "model_effective_tool_set_filters_memory_engine"));
  assert.ok(report.warnings.some(issue => issue.code === "gateway_rpc_does_not_prove_model_visibility"));
  assert.equal(report.evidence_boundary.gateway_rpc_uses_registered_gateway_tool_dispatcher, true);
  assert.equal(report.evidence_boundary.tool_surface_execution_does_not_authorize_stage2_by_itself, true);
});

test("model-visible tool set and complete execution produce the strongest status", () => {
  const report = buildToolSurfaceRuntimeAccessAudit({
    catalog: readJson(CATALOG),
    effective: effectiveVisible(),
    observations: readJsonl(OBSERVATIONS),
    invocationMode: "agent_model",
  });

  assert.equal(report.status, "tool_surface_runtime_confirmed_model_visible");
  assert.equal(report.effective_visibility_status, "complete");
  assert.equal(report.model_visibility_confirmed, true);
  assert.equal(report.production_surface_execution_confirmed, true);
  assert.equal(report.warnings.length, 0);
});

test("missing one surface stays incomplete without becoming a safety violation", () => {
  const report = buildToolSurfaceRuntimeAccessAudit({
    catalog: readJson(CATALOG),
    effective: readJson(EFFECTIVE_FILTERED),
    observations: readJsonl(OBSERVATIONS).slice(0, 1),
    invocationMode: "gateway_rpc",
  });

  assert.equal(report.status, "tool_surface_registered_not_fully_executed");
  assert.equal(report.invocation_status, "partial");
  assert.equal(report.production_surface_execution_confirmed, false);
  assert.deepEqual(report.missing_tool_surfaces, ["memory_engine_action_search"]);
  assert.ok(report.evidence_gaps.some(issue => issue.code === "surface_observation_missing:memory_engine_action_search"));
  assert.equal(report.violations.length, 0);
});

test("missing registration, unsupported schema, or channel errors block the audit", () => {
  const catalog = readJson(CATALOG);
  catalog.groups[0].tools = catalog.groups[0].tools.filter(tool => tool.id !== "memory_engine_search");
  const observations = readJsonl(OBSERVATIONS);
  const firstMetadata = JSON.parse(observations[0].metadata_json);
  observations[0].metadata_json = JSON.stringify({
    ...firstMetadata,
    schema_version: 2,
  });
  const secondMetadata = JSON.parse(observations[1].metadata_json);
  observations[1].metadata_json = JSON.stringify({
    ...secondMetadata,
    channel_error_count: 1,
  });

  const report = buildToolSurfaceRuntimeAccessAudit({
    catalog,
    effective: readJson(EFFECTIVE_FILTERED),
    observations,
    invocationMode: "gateway_rpc",
  });

  assert.equal(report.status, "tool_surface_runtime_blocked");
  assert.equal(report.production_surface_execution_confirmed, false);
  assert.ok(report.violations.some(issue => issue.code === "required_registered_tools_missing"));
  assert.ok(report.violations.some(issue => issue.code === "unsupported_observation_schema"));
  assert.ok(report.violations.some(issue => issue.code === "tool_surface_channel_errors_present"));
});

test("metadata-only or wrong-source rows cannot impersonate canonical tool observations", () => {
  const observations = readJsonl(OBSERVATIONS);
  const metadataOnly = JSON.parse(observations[0].metadata_json);
  const wrongSource = {
    ...observations[1],
    source: "hybrid.auto_recall",
  };

  const report = buildToolSurfaceRuntimeAccessAudit({
    catalog: readJson(CATALOG),
    effective: readJson(EFFECTIVE_FILTERED),
    observations: [metadataOnly, wrongSource],
    invocationMode: "gateway_rpc",
  });

  assert.equal(report.status, "tool_surface_runtime_blocked");
  assert.equal(report.production_surface_execution_confirmed, false);
  assert.equal(report.non_canonical_observation_count, 2);
  assert.ok(report.violations.some(issue => issue.code === "non_canonical_tool_observation"));
  assert.deepEqual(report.missing_tool_surfaces, [
    "memory_engine_action_search",
    "memory_engine_search",
  ]);
});

test("non-executed observations cannot satisfy production surface coverage", () => {
  const observations = readJsonl(OBSERVATIONS);
  const metadata = JSON.parse(observations[0].metadata_json);
  observations[0].metadata_json = JSON.stringify({ ...metadata, search_executed: false });

  const report = buildToolSurfaceRuntimeAccessAudit({
    catalog: readJson(CATALOG),
    effective: readJson(EFFECTIVE_FILTERED),
    observations,
    invocationMode: "gateway_rpc",
  });

  assert.equal(report.production_surface_execution_confirmed, false);
  assert.equal(report.non_executed_observation_count, 1);
  assert.ok(report.evidence_gaps.some(issue => issue.code === "non_executed_tool_surface_observations"));
});

test("unsupported invocation modes fail explicitly", () => {
  assert.throws(
    () => buildToolSurfaceRuntimeAccessAudit({ invocationMode: "direct_wrapper" }),
    /unsupported invocation mode/,
  );
});
