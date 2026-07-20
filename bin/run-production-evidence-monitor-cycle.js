#!/usr/bin/env node

const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { exportObservations, serializeRows } = require("./export-hybrid-search-observations.js");
const { loadProductEventsFromDb } = require("./build-auto-recall-product-health-report.js");

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} expects a value`);
  return value;
}

function parseArgs(argv = []) {
  const options = {
    db: null,
    baseline: null,
    sourceRoot: null,
    runtimeRoot: null,
    runtimePreflight: null,
    qualityReview: null,
    outputDir: null,
    asOf: undefined,
    continuityThresholds: null,
    monitorThresholds: null,
    productThresholds: null,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--pretty") options.pretty = true;
    else if (arg === "--db") { options.db = readValue(argv, index, arg); index += 1; }
    else if (arg === "--baseline") { options.baseline = readValue(argv, index, arg); index += 1; }
    else if (arg === "--source-root") { options.sourceRoot = readValue(argv, index, arg); index += 1; }
    else if (arg === "--runtime-root") { options.runtimeRoot = readValue(argv, index, arg); index += 1; }
    else if (arg === "--runtime-preflight") { options.runtimePreflight = readValue(argv, index, arg); index += 1; }
    else if (arg === "--quality-review") { options.qualityReview = readValue(argv, index, arg); index += 1; }
    else if (arg === "--output-dir") { options.outputDir = readValue(argv, index, arg); index += 1; }
    else if (arg === "--as-of") { options.asOf = readValue(argv, index, arg); index += 1; }
    else if (arg === "--continuity-thresholds") { options.continuityThresholds = readValue(argv, index, arg); index += 1; }
    else if (arg === "--monitor-thresholds") { options.monitorThresholds = readValue(argv, index, arg); index += 1; }
    else if (arg === "--product-thresholds") { options.productThresholds = readValue(argv, index, arg); index += 1; }
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help) {
    for (const [flag, value] of [
      ["--db", options.db],
      ["--baseline", options.baseline],
      ["--source-root", options.sourceRoot],
      ["--runtime-root", options.runtimeRoot],
      ["--runtime-preflight", options.runtimePreflight],
      ["--quality-review", options.qualityReview],
      ["--output-dir", options.outputDir],
    ]) if (!value) throw new Error(`${flag} is required`);
  }
  return options;
}

function loadObject(path, label) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
    return value;
  } catch (error) {
    throw new Error(`failed to read ${label}: ${error.message}`);
  }
}

function writeJson(path, value, pretty) {
  writeFileSync(path, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, "utf8");
}

function exitCode(status) {
  if (status === "ready_for_removal_gate") return 0;
  if (status === "healthy_collecting" || status === "insufficient_evidence") return 1;
  if (status === "blocked_rollback_required") return 2;
  return 64;
}

function usage() {
  return `Usage:\n  node bin/run-production-evidence-monitor-cycle.js\n    --db <engine.sqlite> --baseline <baseline.json>\n    --source-root <repository-root> --runtime-root <installed-runtime-root>\n    --runtime-preflight <runtime-preflight.json>\n    --quality-review <quality-review.json> --output-dir <directory>\n    [--as-of <canonical-UTC-ISO>]\n    [--continuity-thresholds <json>] [--monitor-thresholds <json>]\n    [--product-thresholds <json>] [--pretty]\n\nOne read-only cycle exports raw evidence, builds parity and product-health reports, projects the selected epoch, and runs the A7.3 monitor. It does not invoke the scheduled healthcheck, edit configuration, reload runtime, or perform rollback.`;
}

async function runProductionEvidenceMonitorCycle(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage(), summary: null };
  const asOf = options.asOf || new Date().toISOString();
  const baseline = loadObject(options.baseline, "baseline");
  const qualityReview = loadObject(options.qualityReview, "quality review");
  const runtimePreflight = loadObject(options.runtimePreflight, "runtime preflight");
  const [
    { canonicalIsoTimestamp },
    { buildRuntimeSourceParityReport },
    { buildAutoRecallProductHealthReport },
    { projectProductionEvidenceEpoch },
    { baselineEvidenceStart, evaluateProductionEvidenceHealth, validateBaseline },
    { DEFAULT_SUSTAINED_MONITOR_THRESHOLDS, validateRuntimePreflightForAuthorization },
  ] = await Promise.all([
    import("../lib/recall/hybrid/hybrid-observation-provenance.js"),
    import("../lib/version/runtime-source-parity.js"),
    import("../lib/recall/hybrid/auto-recall-product-health.js"),
    import("../lib/recall/hybrid/production-evidence-epoch-export.js"),
    import("../lib/recall/hybrid/production-evidence-health-monitor.js"),
    import("../lib/recall/hybrid/sustained-runtime-authorization.js"),
  ]);
  if (!canonicalIsoTimestamp(asOf)) throw new Error("--as-of expects a canonical UTC ISO timestamp");
  const baselineValidation = validateBaseline(baseline);
  if (!baselineValidation.valid || baseline.active !== true) {
    const codes = baselineValidation.errors.map(item => item?.code || String(item));
    throw new Error(`--baseline must be a finalized active baseline: ${codes.join(",") || "baseline_not_active"}`);
  }
  const evidenceStartedAt = baselineEvidenceStart(baseline);

  const observations = exportObservations({
    db: options.db,
    since: evidenceStartedAt,
    until: asOf,
    format: "jsonl",
    surfaces: [],
  });
  const runtimeParity = buildRuntimeSourceParityReport({
    sourceRoot: options.sourceRoot,
    runtimeRoot: options.runtimeRoot,
    checkedAt: asOf,
  });
  const preflightReview = validateRuntimePreflightForAuthorization(runtimePreflight, asOf);
  const runtimeBoundary = runtimePreflight.runtime_boundary || null;
  const preflightBlockers = [...preflightReview.blockers];
  if (baseline.active !== true) preflightBlockers.push({ code: "baseline_not_active" });
  if (typeof baseline.activated_at !== "string" || !canonicalIsoTimestamp(baseline.activated_at)) {
    preflightBlockers.push({ code: "baseline_activated_at_invalid" });
  } else if (Date.parse(baseline.activated_at) > Date.parse(asOf)) {
    preflightBlockers.push({ code: "baseline_activation_from_future" });
  }
  if (runtimePreflight.runtime_build_identity !== baseline.runtime_build_identity) {
    preflightBlockers.push({ code: "runtime_preflight_baseline_build_identity_mismatch" });
  }
  if (runtimePreflight.rollout_config_fingerprint !== baseline.rollout_config_fingerprint) {
    preflightBlockers.push({ code: "runtime_preflight_baseline_config_fingerprint_mismatch" });
  }
  if (typeof baseline.openclaw_config_file_path !== "string" || !baseline.openclaw_config_file_path.trim()) {
    preflightBlockers.push({ code: "baseline_openclaw_config_file_path_invalid" });
  } else if (runtimePreflight.openclaw_config_file_path !== baseline.openclaw_config_file_path) {
    preflightBlockers.push({ code: "runtime_preflight_baseline_openclaw_config_file_path_mismatch" });
  }
  if (!/^[a-f0-9]{64}$/.test(String(baseline.openclaw_config_file_sha256 || ""))) {
    preflightBlockers.push({ code: "baseline_openclaw_config_file_sha256_invalid" });
  } else if (runtimePreflight.openclaw_config_file_sha256 !== baseline.openclaw_config_file_sha256) {
    preflightBlockers.push({ code: "runtime_preflight_baseline_openclaw_config_file_sha256_mismatch" });
  }
  if (!Number.isInteger(baseline.openclaw_config_file_byte_count) || baseline.openclaw_config_file_byte_count <= 0) {
    preflightBlockers.push({ code: "baseline_openclaw_config_file_byte_count_invalid" });
  } else if (runtimePreflight.openclaw_config_file_byte_count !== baseline.openclaw_config_file_byte_count) {
    preflightBlockers.push({ code: "runtime_preflight_baseline_openclaw_config_file_byte_count_mismatch" });
  }
  if (!/^[a-f0-9]{64}$/.test(String(baseline.openclaw_config_fingerprint || ""))) {
    preflightBlockers.push({ code: "baseline_openclaw_config_fingerprint_invalid" });
  } else if (runtimePreflight.openclaw_config_fingerprint !== baseline.openclaw_config_fingerprint) {
    preflightBlockers.push({ code: "runtime_preflight_baseline_openclaw_config_fingerprint_mismatch" });
  }
  if (runtimeParity.runtime_build_identity !== runtimePreflight.runtime_build_identity) {
    preflightBlockers.push({ code: "runtime_preflight_parity_identity_mismatch" });
  }
  if (typeof baseline.openclaw_runtime_version !== "string" || !baseline.openclaw_runtime_version.trim()) {
    preflightBlockers.push({ code: "baseline_openclaw_runtime_version_missing" });
  } else if (runtimePreflight.openclaw_runtime_version !== baseline.openclaw_runtime_version) {
    preflightBlockers.push({ code: "openclaw_runtime_version_mismatch" });
  }
  const runtimeConfig = preflightReview.config;
  if (runtimeConfig?.kgFailClosedMode !== "full_fail_closed") preflightBlockers.push({ code: "runtime_preflight_kg_mode_mismatch" });
  if (runtimeConfig?.recentFailClosedMode !== "full_fail_closed") preflightBlockers.push({ code: "runtime_preflight_recent_mode_mismatch" });
  if (runtimeConfig?.autoRecall?.enabled !== true) preflightBlockers.push({ code: "runtime_preflight_auto_recall_disabled" });
  if (runtimeConfig?.productionEvidenceWindow?.enabled !== true) preflightBlockers.push({ code: "runtime_preflight_evidence_window_disabled" });
  if (runtimeConfig?.productionEvidenceWindow?.epochId !== baseline.evidence_epoch_id) {
    preflightBlockers.push({ code: "runtime_preflight_epoch_mismatch" });
  }
  const productHealthBase = buildAutoRecallProductHealthReport({
    events: loadProductEventsFromDb(options.db),
    qualityReview,
    thresholds: options.productThresholds ? loadObject(options.productThresholds, "product thresholds") : undefined,
    checkedAt: asOf,
  });
  const productHealth = preflightBlockers.length === 0
    ? productHealthBase
    : {
      ...productHealthBase,
      status: "rollback_required",
      blockers: [...new Set([
        ...(productHealthBase.blockers || []),
        ...preflightBlockers.map(item => item?.code || String(item)),
      ])],
    };
  const projection = projectProductionEvidenceEpoch({ observations, baseline, asOf });
  const health = evaluateProductionEvidenceHealth({
    observations,
    baseline,
    runtimeParity,
    productHealth,
    continuityThresholds: options.continuityThresholds ? loadObject(options.continuityThresholds, "continuity thresholds") : undefined,
    monitorThresholds: options.monitorThresholds
      ? loadObject(options.monitorThresholds, "monitor thresholds")
      : DEFAULT_SUSTAINED_MONITOR_THRESHOLDS,
    asOf,
  });

  const outputDir = resolve(options.outputDir);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "raw-hybrid-observations.jsonl"), serializeRows(observations, "jsonl"), "utf8");
  writeFileSync(resolve(outputDir, "canonical-epoch-observations.jsonl"), serializeRows(projection.selectedRows, "jsonl"), "utf8");
  writeJson(resolve(outputDir, "runtime-parity.json"), runtimeParity, options.pretty);
  writeJson(resolve(outputDir, "runtime-preflight.json"), runtimePreflight, options.pretty);
  writeJson(resolve(outputDir, "runtime-boundary.json"), runtimeBoundary, options.pretty);
  writeJson(resolve(outputDir, "product-health.json"), productHealth, options.pretty);
  writeJson(resolve(outputDir, "epoch-projection.json"), projection.report, options.pretty);
  writeJson(resolve(outputDir, "health.json"), health, options.pretty);
  const summary = {
    schema_version: 1,
    as_of: asOf,
    status: health.status,
    rollback_required: health.rollback_required,
    output_directory: outputDir,
    raw_observation_count: observations.length,
    canonical_epoch_observation_count: projection.selectedRows.length,
    epoch_projection_status: projection.report.status,
    runtime_parity_status: health.runtime_parity_status,
    runtime_preflight_status: runtimePreflight.status,
    runtime_preflight_blocker_count: preflightBlockers.length,
    openclaw_runtime_version: runtimePreflight.openclaw_runtime_version || null,
    runtime_boundary_status: runtimeBoundary?.status || "missing",
    active_memory_enabled: runtimeBoundary?.active_memory_enabled ?? null,
    product_health_status: health.product_health_status,
    monitor_freshness_status: health.monitor_freshness_status,
    stop_condition_count: health.stop_conditions.length,
    monitor_thresholds: health.thresholds?.monitor || null,
  };
  writeJson(resolve(outputDir, "cycle-summary.json"), summary, options.pretty);
  return {
    exitCode: exitCode(health.status),
    output: `${JSON.stringify(summary, null, options.pretty ? 2 : 0)}\n`,
    summary,
  };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await runProductionEvidenceMonitorCycle(argv);
    process.stdout.write(result.output);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 64;
  }
}

module.exports = { parseArgs, runProductionEvidenceMonitorCycle, main };

if (require.main === module) main();
