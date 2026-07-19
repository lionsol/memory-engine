# Full Fail-Closed Production Evidence Window

> **Status: B8-A7.3 CLOSED / READY FOR A7 RUNTIME AUTHORIZATION REVIEW; sustained runtime window not authorized**
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

B8-A7.2 is closed after final review of implementation checkpoint `47389d3`. The origin registry uses only the typed `before_tool_call` fields (`agentId`, `sessionKey`, `sessionId`, `runId`, `toolName`, and `toolCallId`); gateway probe classification derives only from host-generated `http-`/`rpc-` IDs; origin evidence shape/source and validity are checked; per-surface leading, trailing, and internal gaps are enforced; and structural readiness cannot be bypassed with zero thresholds.

The final guard fixes run TTL cleanup before collision detection, so a legitimate `toolCallId` may be reused after expiry while same-lifetime duplicates remain fail closed. Agent, probe, and scheduled-healthcheck registry writes share the same TTL, collision, and capacity semantics. The CLI validates decoded threshold JSON before merging overrides, and the CLI plus evaluator share one threshold contract that rejects primitive documents, arrays, unknown fields, invalid ratios, non-integer count thresholds, and negative values.

The evaluator refuses `continuity_ready` for missing natural denominator evidence or missing production surfaces regardless of test threshold overrides. Operator probes and scheduled healthchecks remain outside the natural denominator, and ambiguous origin remains a blocker.

Historical review record: implementation checkpoint `59a4f3e` was not review-closed because the original resolver assumed `trigger`, `toolExecutionSource`, and `invocationSource` in `before_tool_call`; checkpoint `eec0f91` removed those assumptions and closed the four original findings; checkpoint `47389d3` closed the TTL cleanup-order and primitive thresholds JSON findings.

Historical status label: `B8-A7.2 IMPLEMENTED / REVIEW CHANGES REQUIRED`.

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

The A7.3 implementation is report-only and combines the existing identity, continuity, fallback-window, and full-rollout evidence builders. It additionally validates one active authorized baseline, runtime/source parity, product-health status, scheduled-healthcheck freshness, and wall-clock freshness at an explicit `asOf`. Its statuses are `healthy_collecting`, `insufficient_evidence`, `blocked_rollback_required`, and `ready_for_removal_gate`; the last status only permits a separate removal-gate review and does not authorize sustained runtime or code deletion.

Implementation checkpoint `b725dd5` is not review-closed. Final review found that `authorized_at` is not used to bound the evaluated observation window, so pre-authorization evidence can satisfy the 30-day and volume thresholds. Timestamps later than `asOf` produce negative age values that are treated as fresh, and the baseline, parity, product-health, and CLI `asOf` validators accept non-canonical `Date.parse()` inputs rather than canonical UTC ISO. The scheduled-healthcheck freshness path also accepts evidence with `source=scheduled_healthcheck_wrapper` even when the agent, session, and tool-call presence fields show that the trusted registry could not have produced a valid healthcheck.

Required fixes are fail closed: observations before `authorized_at` or after `asOf` must not enter any A7 denominator and must create explicit stop conditions for the active epoch; baseline authorization, parity, product-health, healthcheck, observation, and `asOf` timestamps must use one canonical UTC ISO contract and satisfy `authorized_at <= timestamp <= asOf`; negative age must never be fresh; and scheduled-healthcheck evidence must match the trusted resolver's required identity fields before it can satisfy monitor freshness.

Checkpoint `3dcd55c` binds every child evaluator to the same `authorized_at <= completed_at <= asOf` observation partition. The monitor exposes authorized-window and out-of-window counts, classifies future evidence separately from stale evidence, and requires scheduled healthchecks to carry the registration-owned wrapper source plus agent, session, and tool-call identity presence.

Final review found three remaining contract defects. First, `validateHybridTrafficOriginEvidence()` accepts `scheduled_healthcheck` on `auto_recall`, while the trusted resolver routes AutoRecall only through `before_prompt_build`; a forged AutoRecall healthcheck can therefore satisfy freshness and produce `ready_for_removal_gate`. Second, the exact canonical UTC ISO helper trims surrounding whitespace and accepts the trimmed value. Third, the summary fields are internally inconsistent: `monitor_freshness_status` can be `fresh` while a production surface is stale, and `runtime_parity_status` can be `fresh` while source/runtime drift is an active stop condition. These checks remain report-only and do not authorize a sustained runtime window.

The current status is `B8-A7.3 REVIEW FIXES IMPLEMENTED / FINAL REVIEW CHANGES REQUIRED`. The sustained runtime window remains `NOT AUTHORIZED`, and B8-B remains `NOT AUTHORIZED`.

The final review fixes require scheduled-healthcheck evidence to use a tool production surface, reject surrounding whitespace in canonical timestamps, and separate parity/product health from their freshness statuses. Monitor freshness now aggregates the overall observation, every production surface, healthcheck, parity report, and product-health report; `ready_for_removal_gate` requires all corresponding health and freshness fields to be clean.

Final review accepted implementation checkpoint `cc88825`. The shared origin validator now matches the trusted resolver's surface contract, canonical timestamps require exact UTC millisecond ISO with no surrounding whitespace, runtime parity health is distinct from report freshness, product-health freshness is explicit, and monitor freshness includes the overall observation plus every production surface, healthcheck, parity, and product-health report. A forged AutoRecall scheduled healthcheck cannot satisfy freshness or removal readiness.

Independent Node 24 validation passed 57 focused tests, static-check for 467 files, the A5 safety smoke at 10/10, and the full 1597-test suite with 1589 passed, 0 failed, and 8 skipped. `code-review-graph 2.3.7` reported risk 0.55, zero affected stored flows, and five helper-level test-gap hints covered by direct tests or adversarial checks.

The current status is `B8-A7.3 CLOSED / READY FOR A7 RUNTIME AUTHORIZATION REVIEW`. This authorizes only a separate review of the sustained-runtime configuration, thresholds, monitoring cadence, and rollback plan. The sustained runtime window remains `NOT AUTHORIZED`, and B8-B remains `NOT AUTHORIZED`.

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

B8-A7.1 is closed after final review of implementation checkpoint `caf4373`. The accepted identity contract covers the local runtime dependency closure, requires all declared runtime files in filesystem and injected-entry validation paths, rejects duplicate or symlinked runtime paths, and fingerprints the same normalized effective AutoRecall/KG/Recent/retrieval configuration used by runtime behavior. Malformed higher-priority configuration fails closed and supported Recent token compatibility is preserved.

A7.2 continuity and traffic-origin evidence is closed after final review of implementation checkpoint `47389d3`; its historical closeout label is `B8-A7.2 CLOSED / READY FOR A7.3`. This authorized only implementation of A7.3 read-only health monitoring and stop/rollback contract. It does not authorize enabling `productionEvidenceWindow`, keeping either channel in `full_fail_closed`, enabling sustained AutoRecall, or starting the 30-day runtime window.

The preceding review labels remain historical evidence. The current authorization boundary is `B8-A7.3 CLOSED / READY FOR A7 RUNTIME AUTHORIZATION REVIEW`; `B8-A7 sustained runtime window NOT AUTHORIZED` and `B8-B NOT AUTHORIZED` remain unchanged.

Historical A7.1 closeout state: `B8-A7.1 CLOSED / READY FOR A7.2`.

B8-B remains `NOT AUTHORIZED` throughout A7 implementation and evidence collection.
