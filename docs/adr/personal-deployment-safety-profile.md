# ADR: Personal deployment safety profile for B8-A7

- Status: Accepted
- Date: 2026-07-21
- Decision scope: B8-A7-R6 Personal Deployment Safety Profile

## Context

memory-engine is a single-operator plugin used in one local OpenClaw deployment. Installation, upgrade, configuration, reload, backup, and rollback are initiated and observed by the same operator.

R2 through R5 evaluated a stricter platform-grade requirement: before plugin loading or discovery, an external control path must obtain a host-authoritative, no-load, no-discovery, crash-consistent proof of plugin installation and policy state. That analysis remains technically valid for multi-tenant, unattended, or independently controlled deployments.

The strict profile would require an OpenClaw host publisher, durable cross-storage publication state, an ordinary-file projection, and an early startup reconciliation barrier. It would also require an upstream OpenClaw change or a permanently maintained private fork.

For this personal deployment, the implementation and maintenance cost is disproportionate to the actual risk. The current operator can perform explicit install/reload checks, inspect the loaded runtime, keep backups, and stop high-risk features when state is uncertain.

## Decision

B8-A7 adopts a personal-deployment safety profile.

The current delivery path does not require:

```text
OpenClaw upstream pull request
OpenClaw private fork
OpenClaw source modification
host-published plugin metadata manifest
no-load/no-discovery authority proof
cross-storage publication journal
pre-discovery host reconciliation barrier
```

R4 and R5 remain accepted as the correct strict platform-grade architecture if that profile is reactivated. They are not current personal-deployment implementation prerequisites.

## Hard Safety Invariants

The lighter profile does not relax data-integrity boundaries.

These remain mandatory:

```text
OpenClaw core DB remains read-only to memory-engine
memory-engine DB remains separate
configuration and runtime changes require recoverable backups
installed runtime identity must match the reviewed source closure
unexpected symlinks, duplicate runtime paths, or undeclared files block authorization
Node/native-module ABI must be compatible with the Gateway runtime
active-memory must be explicitly disabled before memory-engine AutoRecall is enabled
required memory-engine Gateway methods and tool registrations must be present
focused tests, static checks, full tests, and fail-closed safety smoke must pass
legacy fallback remains available until the separate B8-B removal gate passes
```

## Accepted Evidence Sources

The personal profile may combine operator-controlled cold and runtime evidence:

```text
OpenClaw-supported plugin list or inspect output
persisted OpenClaw configuration snapshot and hash
installed runtime path, file inventory, and build identity
post-load Gateway runtime inspection
memory-engine operator-read preflight methods
focused and full test results
fail-closed safety smoke
explicit backup and rollback artifacts
```

These sources do not become a universal host authority contract. They are accepted only because one operator controls the deployment and observes every mutation.

Derived discovery is not accepted as proof by itself. It may appear in an operator diagnostic command, but authorization must also bind the installed runtime identity, effective configuration, and loaded Gateway registrations.

## Failure Behavior

Uncertainty no longer blocks all plugin loading. It blocks only the high-risk automated paths.

When identity, configuration, ABI, conflict state, or runtime registration cannot be proved:

```text
plugin management and diagnostics may remain available
manual search may remain available when its own dependencies are healthy
AutoRecall=disabled
automatic reinforcement=disabled
KG/Recent full modes=disabled
production evidence collection=disabled
sustained evidence epoch=not active
B8-B removal readiness=false
operator notification/report=required
```

This is a feature-level fail-closed model rather than a host-startup fail-closed model.

## Required Personal-Deployment Preflight

Before a sustained runtime window can be separately authorized, the operator must verify:

```text
1. Exact OpenClaw CLI and Gateway runtime identities are recorded.
2. Reviewed source commit and installed runtime closure have zero unexplained drift.
3. Native dependency ABI is compatible with the Gateway Node runtime.
4. OpenClaw reports memory-engine installed and enabled through a supported operator command.
5. active-memory is explicitly configured disabled and the effective state is confirmed.
6. Gateway runtime inspection shows the reviewed memory-engine methods and tools registered.
7. AutoRecall, KG full, Recent full, production evidence, scheduler, and epoch are still inactive before authorization.
8. Focused tests, static check, full suite, and A5 fail-closed smoke are green.
9. Configuration and installed-runtime rollback sources are complete and independently verified.
10. A separate authorization decision records the exact baseline and approved activation scope.
```

No single `plugins list`, `plugins inspect`, discovery result, or plugin self-report is sufficient by itself.

## Relationship to R4 and R5

R4 remains valid as an ownership statement:

```text
If a host-authoritative ordinary-file publication exists,
OpenClaw host core must own it.
```

R5 remains valid as a reference implementation design for the strict platform profile.

The personal profile changes their operational effect:

```text
strict platform profile:
  host publisher=required
  missing publisher=hard blocker

personal deployment profile:
  host publisher=optional future capability
  missing publisher=not a current blocker
  operator preflight plus post-load runtime evidence=accepted
```

The earlier SQLite, discovery, and startup-order audits remain historical technical evidence and must not be rewritten as if their findings were false.

## Authorization Boundary

```text
B8-A7-R4 strict host ownership architecture=PASSED / CLOSED / REFERENCE ONLY
B8-A7-R5 strict host publisher integration design=PASSED / CLOSED / REFERENCE ONLY
B8-A7-R6 personal deployment safety profile=ACCEPTED
OpenClaw upstream pull request=NOT REQUIRED / NOT PLANNED
OpenClaw private fork=NOT REQUIRED / NOT PLANNED
OpenClaw source modification=NOT AUTHORIZED
real host publisher=NOT REQUIRED FOR PERSONAL PROFILE
production manifest consumer=NOT REQUIRED FOR PERSONAL PROFILE
B8-A7 sustained runtime authorization=WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

## Consequences

- The current implementation effort returns to memory-engine and operator-run deployment verification.
- The strict R4/R5 design remains available if memory-engine later becomes multi-user, distributed, unattended, or externally managed.
- The historical 2026-07-20 authorization findings remain unresolved until the personal-deployment remediation runbook is executed and independently verified.
- This ADR does not authorize config mutation, plugin install/reload, Gateway restart, AutoRecall activation, a sustained evidence epoch, or B8-B removal.
