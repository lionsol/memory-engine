# B8-A7.4 Sustained Runtime Authorization Tooling

> **Status: B8-A7.4 CLOSED / READY FOR SEPARATE SUSTAINED RUNTIME AUTHORIZATION DECISION**
>
> The implementation review is closed. This tooling remains dry-run and report-only. It does not authorize or start the B8-A7 sustained runtime window. B8-B remains not authorized.

## Purpose

A7.1–A7.3 established evidence identity, continuity/origin classification, and the read-only health/rollback decision contract. A7.4 closes the operational tooling gaps required to construct a machine-readable authorization plan without changing the real runtime.

Implemented components:

```text
runtime/source parity report generator
effective Hybrid runtime config report generator
AutoRecall product-health report generator
plugin-owned scheduled tool healthcheck gateway method
epoch projection with explicit blocking rejections
natural traffic forecast audit
active-memory runtime-boundary report using OpenClaw default-enabled semantics
plugin-owned loaded-runtime preflight binding host version/build/config/boundary
exact config-backup manifest binding path/bytes/effective fingerprint
sustained runtime authorization plan builder
one-cycle read-only production evidence monitor orchestrator
post-rollback report verifier for exact restore, probes, parity, and A5 smoke
enabled-without-epoch config fail-closed validation
```

## Continuing Authorization Boundary

A7.4 does not authorize:

- editing real OpenClaw configuration;
- installing or reloading the plugin;
- enabling `productionEvidenceWindow`;
- creating a real evidence epoch;
- enabling sustained AutoRecall;
- keeping KG or Recent in `full_fail_closed`;
- creating a cron or scheduler;
- executing rollback;
- entering B8-B;
- pushing, tagging, or releasing.

## 1. Runtime/Source Parity

Generate a canonical parity report from the same runtime dependency closure used by observation identity:

```bash
~/.local/node24/bin/node \
  bin/build-runtime-source-parity-report.js \
  --source-root /home/lionsol/.openclaw/workspace/plugins/memory-engine \
  --runtime-root <install.installPath-from-openclaw-inspect> \
  --checked-at <canonical-UTC-ISO> \
  --out /tmp/memory-engine-a7/runtime-parity.json \
  --pretty
```

The installed runtime path must come from:

```bash
openclaw plugins inspect memory-engine --runtime --json
```

The generator does not run install or reload. It reports file-path differences without persisting source bytes or secrets.

Required healthy result:

```text
source_runtime_equal=true
difference_count=0
runtime_build_identity=<sha256>
```

## 2. AutoRecall Product Health

Build product health from read-only Engine DB telemetry and an explicit human quality review:

```bash
~/.local/node24/bin/node \
  bin/build-auto-recall-product-health-report.js \
  --db ~/.openclaw/memory/memory-engine/memory-engine.sqlite \
  --quality-review /tmp/memory-engine-a7/quality-review.json \
  --checked-at <canonical-UTC-ISO> \
  --out /tmp/memory-engine-a7/product-health.json \
  --pretty
```

The report checks:

```text
complete recall traces
error or timeout evidence
injection backed by an allowed gate decision
reinforcement eligibility
hard-denied artifact injection
p95 and maximum AutoRecall latency
quality-review freshness and sample size
irrelevant/severe/user-reported bad injection counts
```

Missing, stale, invalid, or undersized quality review evidence returns:

```text
status=not_evaluated
```

The required sample is the latest 30 injections or every available injection when fewer than 30 exist. A review cannot claim more samples than the telemetry window contains. It must never default to healthy.

Quality-review schema:

```json
{
  "schema_version": 1,
  "reviewed_at": "2026-07-20T03:00:00.000Z",
  "sample_size": 30,
  "sampled_injection_keys": [
    "<trace_id>:<memory_id>"
  ],
  "irrelevant_count": 0,
  "severe_irrelevant_or_context_conflict_count": 0,
  "user_reported_bad_injection_count": 0
}
```

## 3. Scheduled Tool Healthcheck

The plugin registers the operator-scoped gateway method:

```text
memoryEngine.productionEvidenceHealthcheck
scope=operator.read
```

It is callable only when the effective production evidence window is enabled with a non-empty epoch, KG and Recent are both `full_fail_closed`, and sustained AutoRecall is enabled. The method executes a fixed, read-only query through both tool surfaces:

```text
memory_engine_search
memory_engine_action_search
```

Before each internal execution, the plugin-owned registry records:

```text
traffic_origin=scheduled_healthcheck
source=scheduled_healthcheck_wrapper
agent/session/tool-call identity present
run identity absent
```

The method never emits an AutoRecall scheduled healthcheck. Scheduled healthchecks remain outside the natural denominator.

The gateway method is implemented but has not been installed, reloaded, or invoked against the real runtime in A7.4.

Quality review is auditable rather than count-only. `sampled_injection_keys` must contain unique exact `trace_id:memory_id` keys, its length must equal `sample_size`, every key must exist in the current product-health window, and it must cover the most recent 30 injections or all available injections when fewer than 30 exist. A legacy review that only declares `sample_size` returns `not_evaluated`.

## 4. Raw Export and Epoch Projection

First export the complete bounded raw observation set. Do not pre-filter by epoch:

```bash
~/.local/node24/bin/node \
  bin/export-hybrid-search-observations.js \
  --db ~/.openclaw/memory/memory-engine/memory-engine.sqlite \
  --since <authorized-at> \
  --until <as-of> \
  --format jsonl \
  --out /tmp/memory-engine-a7/raw-hybrid-observations.jsonl
```

Then project one exact baseline:

```bash
~/.local/node24/bin/node \
  bin/project-production-evidence-epoch.js \
  --observations /tmp/memory-engine-a7/raw-hybrid-observations.jsonl \
  --baseline /tmp/memory-engine-a7/baseline.json \
  --as-of <canonical-UTC-ISO> \
  --selected-out /tmp/memory-engine-a7/canonical-epoch-observations.jsonl \
  --report-out /tmp/memory-engine-a7/epoch-projection.json \
  --pretty
```

The projection does not silently discard blockers. Mixed epoch/build/config, invalid provenance, unknown surfaces, disabled evidence, pre-authorization rows, and future rows remain in the projection report with row identifiers and rejection reasons.

The raw export remains authoritative.

## 5. Natural Traffic Forecast

Audit historical canonical observations before considering a real window:

```bash
~/.local/node24/bin/node \
  bin/audit-natural-traffic-forecast.js \
  --observations <historical-observations.jsonl> \
  --as-of <canonical-UTC-ISO> \
  --out /tmp/memory-engine-a7/natural-traffic-forecast.json \
  --pretty
```

Default startup forecast thresholds:

```text
lookback_days=30
projection_days=30
minimum_history_days=30
minimum_projected_total_natural_observations=600
minimum_projected_memory_engine_search_observations=120
minimum_projected_memory_engine_action_search_observations=120
minimum_tool_surface_active_days=15
maximum_tool_surface_gap_hours=72
```

The following never count:

```text
operator verification probe
scheduled healthcheck
unknown origin
CLI observation
invalid provenance or origin evidence
```

A blocked forecast means do not start A7. Do not change tool-selection prompts or manufacture traffic to satisfy the denominator.

## 6. Effective Runtime Config Report

Generate the current normalized Hybrid runtime configuration through the same resolver used by the plugin:

```bash
~/.local/node24/bin/node \
  bin/build-effective-hybrid-runtime-config-report.js \
  --config <openclaw-config-snapshot.json> \
  --checked-at <canonical-UTC-ISO> \
  --out /tmp/memory-engine-a7/effective-config-report.json \
  --pretty
```

The report contains a timestamp, validity/errors, normalized non-secret effective configuration, and the canonical rollout fingerprint. Raw host configuration and unrelated secrets are excluded. Canary token values are replaced with counts. An invalid report cannot be used to build an authorization plan.

## 7. Runtime Boundary Report

Build a reduced, secret-free boundary report from the real OpenClaw config snapshot:

```bash
~/.local/node24/bin/node \
  bin/build-sustained-runtime-boundary-report.js \
  --config <openclaw-config-snapshot.json> \
  --checked-at <canonical-UTC-ISO> \
  --out /tmp/memory-engine-a7/runtime-boundary.json \
  --pretty
```

The resolver matches OpenClaw active-memory's actual semantics: absent or unspecified `enabled` fields mean active-memory is enabled. A clean report therefore requires an explicit `false` at either the plugin-entry or plugin-config boundary. Malformed configuration is invalid rather than assumed safe. The output contains only status, booleans, resolution, timestamp, and blockers; it does not copy raw config or secrets.

## 8. Exact Config Backup Manifest

Before a future activation, create an independent exact byte-for-byte backup of the real OpenClaw config outside the repository, restrict it to the owner, then bind both files to a reduced manifest:

```bash
cp --preserve=mode,timestamps <live-openclaw-config.json> <exact-openclaw-config-backup.json>
chmod 600 <exact-openclaw-config-backup.json>

~/.local/node24/bin/node \
  bin/build-sustained-runtime-config-backup-manifest.js \
  --live-config <live-openclaw-config.json> \
  --config-backup <exact-openclaw-config-backup.json> \
  --created-at <canonical-UTC-ISO> \
  --out /tmp/memory-engine-a7/config-backup-manifest.json \
  --pretty
```

The manifest records both absolute paths, byte counts, SHA-256 values, exact-byte equality, effective-config fingerprint, legacy KG/Recent modes, disabled AutoRecall/evidence state, and active-memory boundary. It never copies or prints raw config content. The backup must be a distinct regular file—not the live path, a hardlink, or a symlink—with no group/other permissions. Authorization requires the manifest to be no more than one hour old, prove exact equality to the live config, and match the loaded runtime preflight fingerprint exactly.

## 9. Loaded Runtime Preflight

The installed plugin exposes the operator-scoped gateway method:

```text
memoryEngine.sustainedRuntimePreflight
scope=operator.read
```

After a future reviewed install/reload, capture the report from the loaded runtime:

```bash
openclaw gateway call memoryEngine.sustainedRuntimePreflight \
  --params '{}' \
  --json \
  > /tmp/memory-engine-a7/runtime-preflight.json
```

The preflight binds the loaded OpenClaw version, exact live config-file path/SHA-256/byte count, installed plugin runtime-build identity, loaded effective Hybrid config fingerprint, sanitized effective config, and live active-memory boundary in one timestamped report. The plugin reads the configured OpenClaw file itself; the raw file hash is the primary host-config identity, while the semantic object fingerprint is retained as an additional drift signal. The final authorization plan accepts this runtime-owned report rather than trusting separately handwritten config/boundary JSON. Preflight evidence older than one hour is rejected. The offline effective-config and boundary CLIs remain dry-run cross-checks.

## 10. Authorization Plan Builder

Build a proposed plan from a fresh clean runtime preflight, clean source/runtime parity report, and ready traffic forecast:

```bash
~/.local/node24/bin/node \
  bin/build-sustained-runtime-authorization-plan.js \
  --runtime-preflight /tmp/memory-engine-a7/runtime-preflight.json \
  --runtime-parity /tmp/memory-engine-a7/runtime-parity.json \
  --traffic-forecast /tmp/memory-engine-a7/natural-traffic-forecast.json \
  --config-backup-manifest /tmp/memory-engine-a7/config-backup-manifest.json \
  --authorized-at <canonical-UTC-ISO> \
  --head <reviewed-git-commit> \
  --agent edi \
  --top-k 3 \
  --timeout-ms 4000 \
  --out /tmp/memory-engine-a7/authorization-plan.json \
  --pretty
```

Evidence epoch format:

```text
b8-a7-sustained-<UTC_TIMESTAMP>-<HEAD7>-r<NN>
```

Example:

```text
b8-a7-sustained-20260720T030000Z-15923c5-r01
```

Plan decisions:

```text
blocked
ready_for_operator_approval
authorized_plan_ready
```

`authorized_plan_ready` means only that all technical checks and explicit approval fields are present in the plan. The builder does not apply the plan.

The plan separates two different objects:

```text
proposed_effective_config
  normalized evidence/fingerprint snapshot; never write this object into OpenClaw config

config_application_plan.patch
  manifest-valid merge patch for plugins.entries.memory-engine.config
```

`proposed_effective_config` contains derived fields such as `hybridRetrieval` and is not a plugin configuration document. Only `config_application_plan.patch` is eligible for a future reviewed config mutation. The plan emits only an inactive `baseline_template`; it cannot itself start an evidence window. A post-apply runtime preflight must reproduce `expected_effective_rollout_config_fingerprint` before a separate finalizer may emit the active baseline.

Required approvals:

```text
kg_full_fail_closed
recent_full_fail_closed
auto_recall_enabled
agent_allowlist
top_k
timeout_ms
evidence_epoch
scheduled_healthcheck
hourly_health_monitor
report_scheduler
automatic_rollback
```

## 11. Post-Apply Activation Baseline Finalization

After a separately authorized operator applies `config_application_plan.patch` and reloads through the verified OpenClaw path, capture a fresh loaded-runtime preflight and a fresh parity report. Then finalize the baseline:

```bash
~/.local/node24/bin/node \
  bin/finalize-sustained-runtime-activation-baseline.js \
  --authorization-plan /tmp/memory-engine-a7/authorization-plan.json \
  --runtime-preflight <post-apply-runtime-preflight.json> \
  --runtime-parity <post-apply-runtime-parity.json> \
  --activated-at <canonical-UTC-ISO> \
  --out /tmp/memory-engine-a7/activation-baseline-report.json \
  --pretty
```

The finalizer is read-only. It emits `baseline.active=true` only when the authorization plan itself is no more than one hour old, still internally consistent, has no technical or approval blockers, retains the exact required approval list, and still binds the proposed effective config, merge patch, fingerprint report, pre-activation backup, and pre-activation runtime preflight to one artifact chain. The post-apply preflight must read the same live OpenClaw config path authorized by the backup manifest. KG and Recent must both be full fail-closed, AutoRecall and the exact epoch must be active, loaded build/config/OpenClaw identities must match the plan, active-memory must remain disabled, raw config-file identity must be valid, and source/runtime parity must be clean. Preflight and parity must be no more than one hour old.

The `baseline` object inside the finalizer report is the only baseline accepted by the monitor cycle. It carries `activation_source=sustained_runtime_activation_finalizer` and the authorization-plan timestamp. A blocked finalizer means immediate rollback; do not begin evidence collection from `baseline_template`, a hand-written active baseline, or a stale authorization plan.

## 12. One Read-Only Monitor Cycle

After a future runtime authorization and successful baseline finalization, one cycle can generate all reports without mutating the runtime:

```bash
~/.local/node24/bin/node \
  bin/run-production-evidence-monitor-cycle.js \
  --db ~/.openclaw/memory/memory-engine/memory-engine.sqlite \
  --baseline <activation-baseline-report.baseline.json> \
  --source-root /home/lionsol/.openclaw/workspace/plugins/memory-engine \
  --runtime-root <installed-runtime-root> \
  --runtime-preflight <fresh-runtime-preflight.json> \
  --quality-review <quality-review.json> \
  --output-dir /tmp/memory-engine-a7/cycle-<timestamp> \
  --as-of <canonical-UTC-ISO> \
  --pretty
```

Generated files:

```text
raw-hybrid-observations.jsonl
canonical-epoch-observations.jsonl
runtime-parity.json
runtime-preflight.json
runtime-boundary.json
product-health.json
epoch-projection.json
health.json
cycle-summary.json
```

The cycle does not invoke gateway methods. A future scheduler must capture a fresh runtime preflight and invoke the plugin-owned scheduled healthcheck before the monitor cycle. Every cycle verifies finalized-baseline provenance, preflight freshness, exact config-file path/SHA-256/byte count, semantic config identity, OpenClaw version, plugin build identity, source/runtime parity, rollout fingerprint, active epoch/full modes, AutoRecall enablement, and active-memory boundary. Any mismatch or invalid boundary is promoted into product-health rollback status.

The evidence clock begins at `baseline.activated_at`, not at the earlier operator approval time in `authorized_at`. DB export, epoch projection, continuity, identity, fallback, full-rollout, healthcheck freshness, parity freshness, and product-health freshness all use that same post-finalization lower bound. Observations created after approval but before activation finalization are explicit `observation_before_evidence_start` blockers and cannot contribute to the 30-day window. A scheduled healthcheck satisfies freshness only when one shared `healthcheck_run_id` produced canonical observations for both `memory_engine_search` and `memory_engine_action_search`; a partial run never counts. When no explicit monitor-threshold file is supplied, the cycle uses the reviewed sustained defaults (`72/14/14/14` hours), not the A7.3 generic `26`-hour defaults.

Exit semantics remain:

```text
0 ready_for_removal_gate
1 healthy_collecting or insufficient_evidence
2 blocked_rollback_required
64 input or report-generation failure
```

Exit `2` and `64` require immediate rollback under the approved runtime plan.

## 13. Post-Rollback Verification

After a future rollback has been executed by an explicitly authorized operator path, verify the supplied evidence without performing any mutation:

```bash
~/.local/node24/bin/node \
  bin/verify-sustained-runtime-rollback.js \
  --authorization-plan <authorized-plan.json> \
  --activation-baseline <activation-baseline-report.json> \
  --restored-config-manifest <manifest-for-restored-config.json> \
  --runtime-preflight <post-rollback-runtime-preflight.json> \
  --runtime-parity <post-rollback-runtime-parity.json> \
  --rollback-observations <post-rollback-tool-probes.jsonl> \
  --safety-smoke <post-rollback-a5-smoke.json> \
  --checked-at <canonical-UTC-ISO> \
  --out <rollback-verification.json> \
  --pretty
```

`rollback_verified` first requires the actual finalized activation-baseline report. The verifier revalidates the authorization plan as it existed at activation time and confirms that the active baseline came from the finalizer, matches the inactive template, uses the authorized live config path, and identifies the epoch being closed. It then requires the restored live config path/SHA-256/byte count and semantic/effective fingerprints to match the exact pre-activation backup, restore time to follow activation, legacy KG/Recent modes, disabled AutoRecall/evidence, clean active-memory boundary, unchanged OpenClaw/plugin build identity, clean source/runtime parity, one valid operator probe on each tool surface with no full/evidence residue, and a real-schema all-pass A5 safety smoke. A closed epoch is never reusable.

The verifier never restores config, reloads runtime, sends probes, or runs the smoke itself.

## 14. Config Fail-Closed Rule

Both effective config normalization and the manifest schema now reject:

```json
{
  "productionEvidenceWindow": {
    "enabled": true
  }
}
```

A non-empty `epochId` is required before enabled evidence can receive a valid rollout fingerprint.

## Review Closeout

A7.4 review confirmed:

- parity uses the installed runtime dependency closure;
- effective-config report reuses runtime resolution, is fresh, and excludes raw secrets/token values;
- product-health cannot default to healthy;
- runtime-boundary reproduces active-memory's default-enabled semantics and does not expose raw config;
- loaded-runtime preflight binds OpenClaw version, exact live config-file identity, plugin build, effective config fingerprint, and boundary with one timestamp;
- authorization and monitor cycles reject preflight older than one hour or internally inconsistent preflight reports;
- activation rejects stale or internally inconsistent authorization plans and binds the post-apply preflight to the exact authorized live config path;
- healthcheck provenance cannot be supplied by ordinary tool parameters;
- the gateway healthcheck remains limited to the two tool surfaces and a freshness-qualified run requires both surfaces under one run id;
- raw evidence remains available beside the epoch projection;
- probes and healthchecks cannot enter the forecast denominator;
- authorization plan binds an exact fresh independent config backup manifest, emits only an inactive baseline template, and never applies configuration;
- post-apply finalizer is the only path that can emit an active baseline and remains read-only;
- all epoch evidence begins at `activated_at`; approval-to-activation transition rows are blocked and excluded;
- monitor cycle is read-only and rejects unfinalized/hand-written baselines or config-file drift;
- rollback verifier requires the finalized activation artifact, exact config hash/fingerprint, both tool probes, clean parity/preflight, and all-pass A5 smoke;
- tests, static check, A5 smoke, and full suite pass.

Final validation:

```text
A7/A7.4 focused tests=171/171 passed
static check=506 files passed
A5 full fail-closed safety smoke=10/10 passed
full suite=1675 tests / 1667 passed / 0 failed / 8 skipped
host-SDK plugin registration integration=passed
code-review-graph parser=tree-sitter-javascript 0.25.0 from the project venv
code-review-graph full snapshot=406 files / 146 flows / 11 communities
code-review-graph affected stored flows=0
code-review-graph heuristic risk=0.85
```

The graph risk score is driven by high-centrality three-line helpers and callback nodes plus 118 per-function test-gap hints, including fixtures and private helpers. It did not identify an affected stored flow. The load-bearing authorization, activation, monitor, healthcheck, product-health, config-backup, and rollback paths have direct and end-to-end tests.

Current boundary:

```text
B8-A7.4=CLOSED / READY FOR SEPARATE SUSTAINED RUNTIME AUTHORIZATION DECISION
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

The next step is a fresh operator decision on real sustained runtime authorization. It is not automatic activation and not B8-B.
