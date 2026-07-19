# Full Fail-Closed Production Evidence Window

> **Status: B8-A7.1 review fixes implemented / review pending; B8-A7.2 not started; sustained runtime window not authorized**
>
> Stage 4 controlled runtime verification is closed and passed. This runbook defines the additional governance required before keeping KG and Recent in `full_fail_closed` long enough to support the B8-B removal gate.

## Purpose

The Stage 4 controlled run proved runtime wiring, exact rollout markers, three canonical production surfaces, fallback suppression, and rollback. It did not prove that one reviewed deployment can remain healthy under sustained production traffic.

The long-window target remains:

```text
minimum_window_days=30
minimum_observations=500
minimum_surface_observations=100
fallback_events=0
invalid_provenance_observation_count=0
unknown_surface_events=0
unsupported_schema_version_events=0
```

These volume thresholds are necessary but not sufficient. A 30-day timestamp span can currently mix deployments, hide long observation gaps, or count operator-generated tool probes as if they were natural production traffic.

## Current Authorization

Authorized now:

- design and implement evidence-governance tooling;
- add observation metadata and report-only evaluators;
- add tests, documentation, and dry-run audit CLIs;
- use synthetic fixtures and temporary report files;
- inspect repository code and static configuration contracts.

Not authorized now:

- keep KG or Recent in `full_fail_closed` for a sustained production window;
- keep `autoRecall.enabled=true` or expand `agentAllowlist` for 30 days;
- change model-visible tool policy to manufacture tool traffic;
- schedule repeated gateway probes and count them as natural production evidence;
- modify real memory content, confidence, indexes, Core DB, or Engine DB beyond ordinary runtime telemetry;
- begin B8-B legacy fallback removal.

## A7.1 Evidence Epoch and Deployment Identity

Every canonical observation counted in a sustained window must identify the deployment that produced it.

Required observation fields:

```text
evidence_epoch_id
runtime_build_identity
rollout_config_fingerprint
```

The implementation must satisfy:

- `evidence_epoch_id` is explicit, non-empty, and stable for one authorized window;
- `runtime_build_identity` is derived from installed runtime source, not only package version;
- `rollout_config_fingerprint` covers rollout-sensitive configuration, including AutoRecall gate and KG/Recent modes;
- the observation provenance validator rejects missing or malformed identity fields when evaluating an A7 window;
- the long-window evaluator requires one epoch, one runtime build identity, and one rollout config fingerprint;
- a plugin reinstall, source change, or rollout-sensitive config change starts a new epoch;
- post-change restoration does not merge the earlier and later observations into one continuous epoch.

The existing observation schema may remain backward compatible, but pre-A7 rows must not satisfy an A7 production window.

The plugin configuration owns the epoch declaration:

```json
{
  "productionEvidenceWindow": {
    "enabled": false,
    "epochId": "<operator-authorized-epoch>"
  }
}
```

`enabled=false` records ordinary observations with `production_evidence_enabled=false` and no epoch. `enabled=true` without a non-empty `epochId` is invalid A7 evidence. The runtime build identity is a SHA-256 fingerprint of the installed runtime files and the rollout config fingerprint is a canonical JSON SHA-256 fingerprint; neither raw source, raw config, secrets, or prompt content is persisted.

The identity audit is report-only and accepts only one epoch, one runtime build identity, and one rollout config fingerprint across canonical production surfaces. A gateway restart may continue the same epoch when runtime and rollout config are unchanged. A reinstall, runtime-source change, or rollout-sensitive configuration change requires a new epoch. Restoring a temporary change does not merge observations from before and after that change. Mixed identities, missing identity fields, disabled evidence, and invalid provenance are not A7-ready.

## A7.2 Window Continuity and Traffic Origin

A first-to-last timestamp span alone does not prove sustained operation.

The evaluator must report at least:

```text
active_utc_days
maximum_observation_gap_hours
active_days_by_surface
first_observed_at_by_surface
last_observed_at_by_surface
```

Before runtime authorization, explicit continuity thresholds must be reviewed and encoded. The evaluator must prevent observations concentrated only at the beginning and end of the period from satisfying the 30-day requirement.

Every observation must also carry an auditable origin classification. The minimum distinction is:

```text
natural_user_turn
natural_agent_tool_call
operator_verification_probe
scheduled_healthcheck
unknown
```

Rules:

- `natural_user_turn` may count for the AutoRecall production denominator;
- a real agent-selected registered tool call may count as `natural_agent_tool_call`;
- operator verification probes and scheduled healthchecks remain useful safety evidence but must be reported separately;
- direct wrappers, CLI labels, manually inserted rows, and synthetic fixtures never count as production observations;
- `unknown` origin blocks A7 window approval;
- the policy must not silently treat HTTP `/tools/invoke` operator traffic as natural production use.

If a required tool surface cannot accumulate natural production traffic under the current tool-visibility policy, the removal gate remains insufficient. Do not manufacture the missing denominator by repeated probes.

## A7.3 Continuous Monitoring and Stop Conditions

A sustained full-mode window requires a read-only operational audit, not only an end-of-window report.

The audit must be able to evaluate one explicit `evidence_epoch_id` and return a machine-readable status such as:

```text
healthy_collecting
blocked_rollback_required
insufficient_evidence
ready_for_removal_gate
```

Immediate stop and rollback conditions include:

- any KG or Recent fallback marker;
- any channel error;
- invalid observation provenance;
- unknown production surface or unknown traffic origin;
- missing or unsupported observation schema;
- incomplete or mixed full markers;
- `scope_match` other than explicit `null` in full mode;
- mixed evidence epochs, runtime identities, or rollout config fingerprints;
- runtime/source parity drift;
- unexpected AutoRecall behavior requiring product rollback.

The monitor must remain read-only. It may recommend rollback and return a non-zero exit code, but it must not silently edit OpenClaw configuration.

## AutoRecall Product Boundary

Collecting 100 natural AutoRecall observations requires sustained AutoRecall enablement on an authorized agent. This changes user-facing behavior and is separate from proving Hybrid DB fallback safety.

Before A7 runtime authorization, the operator must explicitly approve:

```text
autoRecall.enabled=true
agentAllowlist value
topK and timeoutMs
quality/irrelevance stop conditions
final rollback configuration
```

Stage 4's temporary config override does not authorize a 30-day AutoRecall rollout.

## Evidence Evaluation Sequence

After A7.1–A7.3 are implemented and reviewed:

1. back up configuration and record the reviewed runtime fingerprint;
2. create a new unique evidence epoch;
3. enable only the explicitly authorized sustained configuration;
4. verify source/runtime parity and the first canonical observations;
5. run the read-only health audit throughout the window;
6. rollback immediately on any blocker;
7. export observations for exactly one epoch;
8. evaluate continuity, origins, fallback safety, markers, schema, and provenance;
9. run the existing full-rollout evidence evaluator;
10. run a fresh legacy-fallback removal-gate audit.

A7 completion does not itself authorize deletion. The next decision after a healthy window is a separate B8-B removal authorization review.

## Required Implementation Order

```text
B8-A7.1 evidence epoch and deployment identity
B8-A7.2 continuity and traffic-origin evidence
B8-A7.3 read-only health monitor and stop contract
B8-A7 runtime authorization review
B8-A7 sustained production evidence window
B8-B removal-gate review
```

B8-A7.1 review fixes are implemented but not review-closed. A7.2 has not started. The runtime identity now requires `package.json`, all runtime-scope symlinks fail closed, and the rollout config fingerprint is derived from the same normalized effective configuration used by AutoRecall and KG/Recent runtime resolution. This does not authorize enabling `productionEvidenceWindow`, keeping either channel in `full_fail_closed`, or starting the sustained runtime window.

The preceding gate record was `B8-A7.1 IMPLEMENTED / REVIEW CHANGES REQUIRED`; its authorization boundary was `B8-A7 design authorized; sustained runtime window not authorized`. Those phrases remain historical evidence, not the current review status.

B8-B remains `NOT AUTHORIZED` throughout A7 implementation and evidence collection.
