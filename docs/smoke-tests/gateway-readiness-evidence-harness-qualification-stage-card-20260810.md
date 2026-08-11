# Gateway Readiness Evidence Harness Qualification Stage Card — 2026-08-10

## Decision

Can a bounded, read-only harness classify OpenClaw Gateway readiness as `READY`, `NOT_READY`, or `UNKNOWN` from explicit connectivity evidence, without treating `openclaw gateway status` shell rc, systemd/runtime-active state, or warm-up text as the readiness verdict?

This stage qualifies only the evidence mechanism that blocked reconciliation runtime qualification retry R2.

It is **not** candidate runtime retry R3.

## User value

Retry R2 proved that shell rc=0 and `Runtime: running` can coexist with `Connectivity probe: failed`, `ECONNREFUSED 127.0.0.1:18789`, and a non-listening Gateway port.

A deterministic readiness gate prevents another install/rollback cycle from being repeated merely because service-active state was mistaken for connectivity readiness.

## Authority and lineage

Expected repository authority at Stage Card creation:

~~~text
repo=/home/lionsol/.openclaw/workspace/plugins/memory-engine
HEAD=f0cb0a308455a369ea757a2fa38ccf50623ed9cc
worktree=clean
~~~

Prior lineage:

~~~text
source implementation=ac0e5f054551847e724be504bae80947abd7d675
retry R2 outcome=INSUFFICIENT_EVIDENCE
runtime qualification lineage=CLOSED_INSUFFICIENT_EVIDENCE
drift review=SPLIT
~~~

The unresolved blocker is evidence semantics only:

~~~text
service/runtime active != Gateway connectivity ready
shell rc=0 != Gateway connectivity ready
~~~

No product defect is proven by this gap.

## In scope

Exactly three items:

1. Freeze deterministic `READY` / `NOT_READY` / `UNKNOWN` single-sample semantics.
2. Qualify them against the frozen negative retry-R2 fixture, one positive live R2 read-only sample, and one incomplete/ambiguous fixture.
3. Qualify bounded polling: maximum 12 attempts, 2-second interval, with only explicit `NOT_READY` retryable inside the poll budget.

## Verdict contract

### READY

Return `READY` only when the same sample explicitly establishes:

~~~text
Runtime: running
Connectivity probe: ok
listening/port evidence consistent with readiness
~~~

Shell rc=0 without explicit connectivity success is insufficient.

### NOT_READY

Return `NOT_READY` on explicit connectivity failure/non-listening evidence, including the frozen retry-R2 shape:

~~~text
Runtime: running
Warm-up
Connectivity probe: failed
ECONNREFUSED 127.0.0.1:18789
port not listening yet
~~~

`Runtime: running` does not override connectivity failure.

Expected frozen negative-fixture verdict:

~~~text
NOT_READY
~~~

### UNKNOWN

Return `UNKNOWN` when evidence is incomplete, contradictory, unparsable, or lacks an explicit connectivity verdict sufficient for `READY` or `NOT_READY`.

Examples:

- runtime state with no connectivity probe result;
- truncated connectivity evidence;
- explicit success and failure evidence in the same sample;
- only shell rc/service-active state with no explicit connectivity evidence.

Expected ambiguous-fixture verdict:

~~~text
UNKNOWN
~~~

`UNKNOWN` is fail-closed and must never be inferred or promoted to `READY`.

### Deterministic precedence

1. contradictory explicit success/failure evidence => `UNKNOWN`;
2. explicit connectivity failure/non-listening evidence => `NOT_READY`;
3. explicit connectivity success + readiness-consistent listening evidence + running runtime => `READY`;
4. otherwise => `UNKNOWN`.

## Positive live R2 sample

A later separately authorized harness execution may capture one bounded read-only live R2 readiness sample.

Required positive semantics:

~~~text
Runtime: running
Connectivity probe: ok
listening/port evidence consistent with readiness
~~~

Expected verdict:

~~~text
READY
~~~

The sample must not require Gateway restart, plugin installation, checkpoint/data access, retrieval traffic, or configuration changes.

## Bounded polling

Later separately authorized execution may poll under exactly:

~~~text
MAX_ATTEMPTS=12
INTERVAL_SECONDS=2
~~~

Rules:

1. `READY` terminates successfully.
2. `NOT_READY` may retry only while attempts remain.
3. `UNKNOWN` terminates fail-closed.
4. Attempt exhaustion without `READY` remains non-ready; it does not trigger recovery.
5. Polling never mutates Gateway/runtime/config/data.

The polling budget is evidence collection, not a recovery mechanism.

## Harness boundary

No production source/test/config change is authorized.

During later separately authorized execution, the classifier may be an ephemeral shell function or equivalent bounded in-process logic. Only bounded private `/tmp` fixture/evidence files are allowed.

Do not create a persistent harness script, CLI, package command, config object, service, scheduler, ledger, table, queue, state machine, or OpenSpec change.

## Strict non-goals / forbidden scope

Do not:

- stop/start/restart Gateway;
- install the reconciliation candidate or reinstall R2;
- mutate/rebuild candidate or rollback artifacts;
- modify product source/tests, `openclaw.json`, or cron;
- execute checkpoint, reconciliation, orphan repair, memory index/sync/backfill/reindex;
- access Core/Engine/Lance for validation;
- send retrieval, AutoRecall, memory-tool, H6, natural-canary, or synthetic retrieval traffic;
- persistently activate the candidate or perform real-data reconciliation;
- treat this stage as retry R3;
- reuse prior runtime-execution authorization.

## Allowed mutation

At freeze, the only repository mutation is:

~~~text
docs/smoke-tests/gateway-readiness-evidence-harness-qualification-stage-card-20260810.md
~~~

During later harness execution the repository is read-only; bounded `/tmp` fixture/evidence files are the only allowed temporary artifacts.

## Pass criteria

The stage may return `PASS` only if all three criteria hold.

1. **Deterministic verdicts:** negative retry-R2 fixture => `NOT_READY`; ambiguous fixture => `UNKNOWN`; positive live R2 sample => `READY`, with verdicts driven by explicit connectivity/listening evidence rather than shell rc or service-active state.
2. **Bounded polling:** `12 × 2s` maximum, success only on `READY`, retry only on `NOT_READY`, fail closed on `UNKNOWN`, and no time/rc-based promotion to readiness.
3. **Zero mutation:** no Gateway/plugin/config/cron/data/index/retrieval/checkpoint/reconciliation mutation or Core/Engine/Lance access.

`PASS_WITH_FINDINGS` is allowed only for a non-blocking formatting/logging observation that weakens none of the criteria.

`INSUFFICIENT_EVIDENCE` applies when the stage remains read-only/safe but a required readiness fact cannot be proven within the bounded evidence contract.

`STOPPED` applies on authority drift, forbidden-scope pressure, or unexpected mutation requirement.

## Stop conditions

Stop before or during live readiness inspection if:

- Stage Card/repository authority drifts or worktree is not clean at execution preflight;
- proving readiness would require Gateway stop/start/restart or plugin install/reinstall;
- proving readiness would require source/config/cron/checkpoint/data/index/retrieval/reconciliation access or mutation;
- evidence becomes `UNKNOWN`, contradictory, or unparsable;
- the bounded attempt budget expires without `READY`;
- another unrelated subsystem enters scope.

Do not repair, restart, reinstall, tune, or broaden scope inside this stage.

## Required later execution evidence

A separately authorized harness execution must report:

- exact Stage Card path/SHA/commit/HEAD and clean preflight;
- classifier rules;
- negative fixture + `NOT_READY` verdict;
- ambiguous fixture + `UNKNOWN` verdict;
- bounded live R2 sample + verdict;
- shell rc only as non-authoritative metadata if recorded;
- poll count/interval;
- proof of zero forbidden mutation/access;
- final stage outcome and at most one successor recommendation.

## Execution authorization boundary

This Stage Card creation/freeze does **not** authorize harness execution.

A later execution packet must bind:

~~~text
Stage Card path=docs/smoke-tests/gateway-readiness-evidence-harness-qualification-stage-card-20260810.md
Stage Card SHA256=<computed after freeze>
Stage Card commit=<exact commit containing this card>
Repository HEAD=<exact committed Stage Card HEAD>
MAX_EXECUTIONS=1
~~~

Any Stage Card content/commit, HEAD, scope, or execution-count drift invalidates that packet.

Do not reuse retry-R2 runtime execution authority.

## State semantics after PASS

A PASS establishes only:

~~~text
current_fact:
Gateway readiness can be adjudicated deterministically from explicit
connectivity/listening evidence under a bounded read-only harness.

runtime qualification retry R2 lineage:
remains CLOSED_INSUFFICIENT_EVIDENCE.

candidate runtime retry R3:
NOT EXECUTED / NOT AUTHORIZED by this stage.

persistent activation:
NOT AUTHORIZED.

real-data reconciliation:
NOT AUTHORIZED.
~~~

A PASS does not retroactively convert retry R2 into PASS.

## Successor boundary

After the harness qualification outcome, stop.

Do not automatically execute candidate runtime retry R3, reopen retry R2, install/persist the candidate, run real reconciliation, enable AutoRecall, run a natural canary, tune retrieval, create another verification substage, tag, or push.

Any later candidate runtime retry requires new explicit Sol authorization bound to its exact Stage Card/HEAD and finite execution count.

## Authorization state at freeze

~~~text
Gateway readiness Stage Card=FROZEN
Stage Card repository scope=ONE MARKDOWN FILE ONLY
Harness execution=NOT AUTHORIZED
Harness MAX_EXECUTIONS=not created/consumed
Gateway stop/start/restart=NOT AUTHORIZED
Candidate install=NOT AUTHORIZED
R2 reinstall=NOT AUTHORIZED
Candidate runtime retry R3=NOT AUTHORIZED
Product/config/cron/data/retrieval mutation=NOT AUTHORIZED
Persistent activation=NOT AUTHORIZED
Real-data reconciliation=NOT AUTHORIZED
AutoRecall enablement=NOT AUTHORIZED
Push/tag=NOT AUTHORIZED
~~~

After freeze and mechanical repository validation, stop at the separate harness-execution authorization gate.
