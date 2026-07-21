import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("A7.4 tooling exposes every report-only authorization component", () => {
  for (const path of [
    "bin/build-runtime-source-parity-report.js",
    "bin/build-effective-hybrid-runtime-config-report.js",
    "bin/build-auto-recall-product-health-report.js",
    "bin/project-production-evidence-epoch.js",
    "bin/audit-natural-traffic-forecast.js",
    "bin/build-sustained-runtime-authorization-plan.js",
    "bin/build-sustained-runtime-boundary-report.js",
    "bin/build-sustained-runtime-config-backup-manifest.js",
    "bin/finalize-sustained-runtime-activation-baseline.js",
    "bin/run-production-evidence-monitor-cycle.js",
    "bin/verify-sustained-runtime-rollback.js",
    "lib/recall/hybrid/production-evidence-healthcheck-gateway.js",
    "lib/recall/hybrid/sustained-runtime-preflight-gateway.js",
    "lib/recall/hybrid/sustained-runtime-config-backup.js",
    "lib/recall/hybrid/sustained-runtime-activation-baseline.js",
    "lib/recall/hybrid/sustained-runtime-rollback-verification.js",
    "lib/recall/hybrid/effective-runtime-config-report.js",
    "lib/recall/hybrid/sustained-runtime-boundary.js",
  ]) {
    assert.equal(source(path).length > 0, true, path);
  }
});

test("monitor cycle is read-only and does not install, reload, schedule, or edit config", () => {
  const cycle = source("bin/run-production-evidence-monitor-cycle.js");
  assert.match(cycle, /exportObservations/);
  assert.match(cycle, /loadProductEventsFromDb/);
  assert.match(cycle, /buildRuntimeSourceParityReport/);
  assert.match(cycle, /evaluateProductionEvidenceHealth/);
  assert.match(cycle, /DEFAULT_SUSTAINED_MONITOR_THRESHOLDS/);
  assert.match(cycle, /runtimePreflight/);
  assert.match(cycle, /openclaw_config_file_sha256/);
  assert.match(cycle, /baseline_not_active/);
  assert.doesNotMatch(cycle, /plugins install|plugins reload|config set|cron create|scheduler create|execSync|spawnSync/);
});

test("scheduled healthcheck is plugin-owned, operator scoped, and restricted to tool surfaces", () => {
  const gateway = source("lib/recall/hybrid/production-evidence-healthcheck-gateway.js");
  const index = source("index.js");
  assert.match(gateway, /memoryEngine\.productionEvidenceHealthcheck/);
  assert.match(gateway, /operator\.read/);
  assert.match(gateway, /memory_engine_search/);
  assert.match(gateway, /memory_engine_action_search/);
  assert.match(gateway, /healthcheckRunId/);
  assert.doesNotMatch(gateway, /surface:\s*["']auto_recall["']/);
  assert.match(index, /registerProductionEvidenceHealthcheckGateway/);
});

test("runtime preflight is plugin-owned, operator scoped, and reads the live host config", () => {
  const gateway = source("lib/recall/hybrid/sustained-runtime-preflight-gateway.js");
  const index = source("index.js");
  assert.match(gateway, /memoryEngine\.sustainedRuntimePreflight/);
  assert.match(gateway, /operator\.read/);
  assert.match(gateway, /api\.runtime\?\.config\?\.current/);
  assert.match(gateway, /openclaw_runtime_version/);
  assert.match(gateway, /openclaw_config_file_sha256/);
  assert.match(gateway, /readFileSync/);
  assert.match(index, /registerSustainedRuntimePreflightGateway/);
});

test("authorization plan remains dry-run and requires explicit approvals", () => {
  const authorization = source("lib/recall/hybrid/sustained-runtime-authorization.js");
  assert.match(authorization, /ready_for_operator_approval/);
  assert.match(authorization, /authorized_plan_ready/);
  assert.match(authorization, /dry_run_only/);
  assert.match(authorization, /operator_approval_required/);
  assert.match(authorization, /runtime_preflight_report_missing/);
  assert.match(authorization, /baseline_template/);
  assert.match(authorization, /config_application_plan/);
  assert.doesNotMatch(authorization, /writeFileSync|plugins install|config set/);
});

test("activation finalizer is read-only and is the sole active-baseline gate", () => {
  const finalizer = source("lib/recall/hybrid/sustained-runtime-activation-baseline.js");
  const cli = source("bin/finalize-sustained-runtime-activation-baseline.js");
  assert.match(finalizer, /baseline_template/);
  assert.match(finalizer, /active_baseline_ready/);
  assert.match(finalizer, /activation_evidence_epoch_mismatch/);
  assert.match(finalizer, /activation_runtime_source_parity_drift/);
  assert.match(finalizer, /authorization_plan_stale/);
  assert.match(finalizer, /authorization_plan_proposed_config_fingerprint_mismatch/);
  assert.match(finalizer, /activation_openclaw_config_file_path_mismatch/);
  assert.match(finalizer, /sustained_runtime_activation_finalizer/);
  assert.doesNotMatch(finalizer, /writeFileSync|mutateConfig|replaceConfig|plugins install|config set/);
  assert.doesNotMatch(cli, /mutateConfigFile|replaceConfigFile|plugins\s+install|config\s+(?:set|patch|apply)|execSync|spawnSync/);
});

test("rollback verifier consumes the real A5 schema and never executes rollback", () => {
  const verifier = source("lib/recall/hybrid/sustained-runtime-rollback-verification.js");
  assert.match(verifier, /generated_at/);
  assert.match(verifier, /synthetic_in_memory_safety_smoke/);
  assert.match(verifier, /openclaw_config_file_sha256/);
  assert.match(verifier, /activation_baseline_report_missing/);
  assert.match(verifier, /validateAuthorizationPlanForActivation/);
  assert.match(source("bin/verify-sustained-runtime-rollback.js"), /--activation-baseline/);
  assert.doesNotMatch(verifier, /writeFileSync|mutateConfig|replaceConfig|plugins install|config set|execSync|spawnSync/);
});

test("active evidence starts only after finalization and A7.4 closes without runtime authorization", () => {
  const monitor = source("lib/recall/hybrid/production-evidence-health-monitor.js");
  const projection = source("lib/recall/hybrid/production-evidence-epoch-export.js");
  const cycle = source("bin/run-production-evidence-monitor-cycle.js");
  assert.match(monitor, /baselineEvidenceStart/);
  assert.match(monitor, /observation_before_evidence_start/);
  assert.match(projection, /observation_before_evidence_start/);
  assert.match(cycle, /since:\s*evidenceStartedAt/);
  const tooling = source("docs/smoke-tests/sustained-runtime-authorization-tooling.md");
  const window = source("docs/smoke-tests/full-fail-closed-production-evidence-window.md");
  const ledger = source("docs/hybrid-fail-closed-rollout-status.md");
  const combined = `${tooling}\n${window}\n${ledger}`;
  assert.match(combined, /B8-A7\.4(?:=|\s+)CLOSED\s*\/\s*READY FOR SEPARATE SUSTAINED RUNTIME AUTHORIZATION DECISION/i);
  assert.match(combined, /B8-A7 sustained runtime window(?:=|\s+)NOT AUTHORIZED/i);
  assert.match(combined, /B8-B(?: removal)?(?:=|\s+)NOT AUTHORIZED/i);
  assert.doesNotMatch(combined, /B8-A7 sustained runtime window(?:=|\s+)(?:AUTHORIZED|ACTIVE)/i);
});

test("the first real-environment authorization decision is fail-closed and auditable", () => {
  const decision = source("docs/smoke-tests/sustained-runtime-authorization-decision-20260720.md");
  const ledger = source("docs/hybrid-fail-closed-rollout-status.md");
  assert.match(decision, /AUTHORIZATION WITHHELD\s*\/\s*REMEDIATION REQUIRED/i);
  assert.match(decision, /source_runtime_equal=false/);
  assert.match(decision, /difference_count=25/);
  assert.match(decision, /NODE_MODULE_VERSION=137/);
  assert.match(decision, /active_memory_enabled=true/);
  assert.match(decision, /natural_observation_count=0/);
  assert.match(decision, /status=not_evaluated/);
  assert.match(decision, /No authorization plan, active baseline, evidence epoch, or runtime mutation may be produced/i);
  assert.match(
    ledger,
    /B8-A7 sustained runtime authorization WITHHELD\s*\/\s*(?:PERSONAL PROFILE\s+)?REMEDIATION REQUIRED/i,
  );
  assert.match(decision, /B8-A7 sustained runtime window=NOT AUTHORIZED/i);
  assert.match(decision, /B8-B removal=NOT AUTHORIZED/i);
});
