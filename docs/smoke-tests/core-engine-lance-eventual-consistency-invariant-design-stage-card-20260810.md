# Core→Engine→Lance Eventual-Consistency Invariant Design Stage Card — 2026-08-10

> Status: `FROZEN` — not committed and authorizes no implementation or runtime execution
>
> Repository HEAD before this card: `5a6c721020ea03b4b23de1f077797be4fd2fc19b`
>
> This is a product-design successor to the completed R3 propagation-obligation attribution stage. That stage closed `PASS_WITH_FINDINGS / NO_ENGINE_PROPAGATION_OBLIGATION / LANCE_NOT_REACHED` and established that the R3 natural recall miss was not a Core-indexing defect or retrieval-ranking defect: the fixed `session_flush` smart-add source became searchable in OpenClaw Core but had no automatic lifecycle obligation to become Engine-managed and therefore never acquired a Lance propagation subject.
>
> Sol has authorized continuation to the next stage. This card freezes that next design decision only. It does not authorize commit, coding, test mutation, runtime mutation, DB/index reconciliation, rollout, or AutoRecall enablement. Commit authorization and any later design-execution / implementation authorization remain separate.

## Stage purpose

Decide whether memory-engine should adopt an explicit lifecycle invariant that closes the demonstrated gap between OpenClaw native Core indexing and memory-engine managed retrieval state.

The design question is:

> When a memory source that memory-engine considers recall-eligible has already been indexed by OpenClaw Core, must memory-engine eventually reconcile the corresponding Core chunks into Engine `memory_confidence` and, when vector-eligible, into memory-engine LanceDB without requiring an unrelated explicit `memory_engine.add` or manual sync operation?

This stage is design-only. It must produce a bounded accepted design or retain the current explicit-propagation contract. It must not implement either choice.

## Proven problem statement

The completed R3 investigation established the following chain:

~~~text
workspace session_flush smart-add
        │
        │ PROVEN
        ▼
OpenClaw native Core index
        │
        │ PROVEN searchable before R3
        ▼
Core chunks for memory/smart-add/2026-07-31.md
        │
        │ NO AUTOMATIC memory-engine propagation obligation
        X
Engine memory_confidence
        │
        │ NOT REACHED for the fixed source
        ▼
memory-engine LanceDB
        │
        ▼
R3 vector retrieval
~~~

The natural question `8月值班表是哪天制作的？` had independent answer-bearing workspace evidence, while R3 retrieved only unrelated managed candidates.

The investigation specifically ruled out using this incident as justification for tuning:

- query shaping;
- FTS weights or lexical policy;
- vector similarity thresholds;
- fusion/reranking;
- `topK`;
- Card/gate rules;
- AutoRecall intent policy.

Those remain frozen.

## Current architecture facts

The following are `current_fact` for this design stage unless later exact source inspection contradicts them:

1. OpenClaw `memory-core` owns native memory indexing and standard `memory_search` / `memory_get`.
2. memory-engine is an enhancement/governance layer and does not own the OpenClaw memory slot.
3. memory-engine treats Core storage as read-only.
4. Engine DB owns memory-engine confidence and event lifecycle state.
5. LanceDB is memory-engine's vector store and is downstream of managed Engine identity.
6. `memory/smart-add` and `memory/episodes` are the existing memory-engine index-sync watch classes.
7. `session_flush` writes canonical `memory/smart-add/YYYY-MM-DD.md` and does not itself perform Core DB writes, generic Engine backfill, or Lance propagation.
8. OpenClaw native Core indexing may independently make that source searchable.
9. generic `backfillConfidenceForIndexedChunks()` can import missing eligible Core chunks into Engine confidence, but is currently tied to `syncIndexIfNeeded()` rather than a continuously enforced lifecycle invariant.
10. generic confidence backfill is bounded to 500 missing rows per invocation and orders eligible Core rows by `updated_at DESC`.
11. `memory_engine.add` has an immediate propagation path because it explicitly invokes sync/backfill and attempts a Lance write.
12. nightly checkpoint confidence writes target checkpoint-generated output and are not a generic backfill for pre-existing `session_flush` smart-add chunks.
13. `repairOrphanVectors()` can reconcile Engine-managed IDs into Lance but cannot create missing Engine confidence from Core.
14. current AutoRecall is disabled.
15. Candidate-Builder work remains deferred.

## Existing ownership constraints

Any accepted design must preserve:

~~~text
OpenClaw Core = source/index authority for native memory search
memory-engine Core access = read-only
Engine DB = memory-engine lifecycle metadata authority
LanceDB = memory-engine vector-derived state
~~~

The design must not solve the gap by allowing direct memory-engine writes into Core-owned tables.

## Decision A — lifecycle invariant

Choose exactly one design disposition:

~~~text
RETAIN_EXPLICIT_PROPAGATION
ADOPT_SESSION_FLUSH_EVENTUAL_MANAGED_INVARIANT
ADOPT_WATCH_SCOPE_EVENTUAL_MANAGED_INVARIANT
INSUFFICIENT_DESIGN_EVIDENCE
~~~

### `RETAIN_EXPLICIT_PROPAGATION`

Keep the current contract: a Core-indexed source becomes Engine-managed only when an explicit memory-engine operation happens to trigger sync/backfill.

Use only if the design review establishes that automatic eventual reconciliation would create unacceptable ownership, latency, pollution, or lifecycle ambiguity and that native Core / memory-engine managed-corpus divergence is intentional.

If selected, the R3 miss is accepted as expected behavior under the product architecture, and future AutoRecall expectations must explicitly exclude unmanaged native-Core memories.

### `ADOPT_SESSION_FLUSH_EVENTUAL_MANAGED_INVARIANT`

Adopt the narrowest corrective invariant:

> Eligible Core chunks derived from canonical `session_flush` smart-add sources must eventually become Engine-managed and, when vector-eligible, Lance-reconciled.

Other smart-add provenance classes remain under their existing propagation semantics unless separately approved.

This option directly addresses the demonstrated R3 gap while minimizing scope.

### `ADOPT_WATCH_SCOPE_EVENTUAL_MANAGED_INVARIANT`

Adopt a broader invariant aligned with the existing generic backfill watch scope:

> Every memory-engine-eligible Core chunk under `memory/smart-add/%` or `memory/episodes/%` must eventually have a corresponding Engine lifecycle row, and every vector-eligible active Engine row must eventually have the required Lance representation.

Eligibility gates must still exclude content that memory-engine intentionally does not manage or recall.

This is broader than the demonstrated `session_flush` gap and therefore requires stronger design justification.

### `INSUFFICIENT_DESIGN_EVIDENCE`

Use if the stage cannot choose a lifecycle invariant without first resolving a product requirement that is genuinely missing and cannot safely be inferred from existing architecture/governance.

Do not use this merely because implementation details remain open; implementation details may be deferred after the invariant itself is decided.

## Decision B — convergence semantics

If either eventual-managed invariant is selected, freeze the semantic contract independently of the implementation trigger.

The minimum convergence model must define:

~~~text
eligible Core chunk
    → eventually Engine-managed
active/vector-eligible Engine row
    → eventually Lance-reconciled
~~~

The stage must decide whether convergence is:

~~~text
BEST_EFFORT_EVENTUAL
BOUNDED_EVENTUAL
~~~

### `BEST_EFFORT_EVENTUAL`

The system is expected to converge when a reconciliation opportunity occurs, but no bounded age/attempt guarantee is part of the product contract.

This is simpler but may reproduce long-lived blind spots like R3 if no reconciliation opportunity occurs.

### `BOUNDED_EVENTUAL`

The product contract requires a finite reconciliation opportunity so eligible Core chunks cannot remain unmanaged indefinitely.

This does not require hard real-time propagation. The bound may be expressed as a scheduled lifecycle opportunity rather than wall-clock SLA, for example:

~~~text
within the next successful lifecycle reconciliation cycle
~~~

The design stage must not invent an arbitrary minutes/hours SLA unless existing product requirements justify one.

## Decision C — reconciliation trigger family

If an eventual invariant is selected, choose the preferred trigger family at design level. This is not implementation authorization.

Consider exactly these families:

~~~text
WRITE_PATH_PROPAGATION_ONLY
PERIODIC_RECONCILIATION_ONLY
WRITE_PATH_PLUS_PERIODIC_RECONCILIATION
PRE_RETRIEVAL_RECONCILIATION
~~~

### `WRITE_PATH_PROPAGATION_ONLY`

Each canonical memory writer is responsible for propagating newly written eligible content through Core→Engine→Lance.

Benefits:

- low reconciliation lag;
- clear causal ownership.

Risks:

- duplicates propagation logic across writers;
- `session_flush`, checkpoint, manual smart-add, migration, and future writers may drift;
- Core indexing is asynchronous/owned externally, so a writer may not yet have stable Core chunk IDs when it returns.

### `PERIODIC_RECONCILIATION_ONLY`

A dedicated bounded maintenance path compares eligible Core chunks against Engine and Lance and converges missing state.

Benefits:

- centralizes lifecycle semantics;
- naturally repairs missed writer-side propagation;
- compatible with Core read-only ownership.

Risks:

- delayed availability;
- requires idempotence, batching, telemetry, and failure recovery.

### `WRITE_PATH_PLUS_PERIODIC_RECONCILIATION`

Use a fast path when a writer can safely obtain stable Core IDs, plus an idempotent periodic reconciliation safety net.

Benefits:

- lower normal lag;
- eventual repair if the fast path fails.

Risks:

- more moving parts;
- duplicate-trigger semantics must be idempotent.

### `PRE_RETRIEVAL_RECONCILIATION`

Run reconciliation before AutoRecall/hybrid retrieval.

This option should be presumed disfavored unless evidence proves it is necessary because it would put potentially expensive index/DB/vector mutation on the latency-sensitive retrieval path and could couple retrieval availability to embedding/index health.

The stage must explicitly justify this option if selected.

## Required eligibility semantics

An eventual-managed invariant must not mean "all Core chunks become managed".

The design must preserve eligibility and governance boundaries. At minimum it must distinguish:

- path eligibility;
- provenance eligibility;
- archived/quarantined state;
- dreaming/generated diagnostic artifacts;
- suspected tool output / denied artifact classes;
- duplicate or stale records where lifecycle policy explicitly excludes management;
- memory-engine-owned managed rows versus external/native candidates.

The design must reuse existing eligibility concepts where possible rather than create a second independent classification system.

## Identity contract

The invariant must be identity-based, not text-similarity-based.

Preferred relationship:

~~~text
Core chunk id
    ↔ Engine memory_confidence.chunk_id
    ↔ Lance row id
~~~

Text similarity may be used for diagnostics but must not be the authoritative propagation identity.

If Core rechunking changes IDs, the eventual-consistency design must treat stale Engine/Lance IDs as lifecycle reconciliation work rather than silently preserving duplicate identities forever.

Detailed stale-ID cleanup is not part of this stage.

## Idempotence requirement

Any accepted eventual reconciliation design must be idempotent:

- existing Engine rows are not duplicated;
- existing valid Lance rows are not duplicated;
- retry after partial failure is safe;
- a Core chunk can be observed repeatedly without repeated confidence reset;
- reconciliation must not overwrite reinforcement/confidence history merely because a row already exists;
- archive/quarantine policy must not be undone by reconciliation.

This is a required design invariant, not an optional implementation optimization.

## Confidence initialization semantics

This stage must decide only the ownership rule, not tune confidence values.

For newly imported Core chunks, implementation should reuse existing category/provenance initialization policy unless a later stage proves that policy is inadequate.

Do not use this stage to change:

- category confidence constants;
- decay tau;
- reinforcement rules;
- conflict penalties;
- recall thresholds.

## Lance reconciliation semantics

If eventual Engine management is adopted, Lance must remain downstream of Engine eligibility.

Required direction:

~~~text
Core eligible
    ↓
Engine managed / lifecycle-authorized
    ↓
Lance vector-eligible
~~~

Do not adopt direct Core→Lance propagation that bypasses Engine lifecycle state.

If embedding is unavailable, Engine convergence may succeed while Lance convergence remains pending. The design should support a recoverable pending-vector state or equivalent observable condition without treating Engine insertion as failed.

Exact schema changes, if any, are deferred to implementation design and are not authorized here.

## Batch/backlog semantics

The existing generic backfill limit of 500 rows proves that reconciliation may require multiple cycles.

An accepted eventual invariant must therefore distinguish:

~~~text
one reconciliation invocation completed
≠
backlog fully converged
~~~

The design must require observable backlog/progress semantics sufficient to know whether eligible missing Core rows remain after a cycle.

It must not require a new ledger or state machine unless later implementation analysis proves that existing DB queries/telemetry are insufficient.

## Failure semantics

The design must prefer fail-open for agent response availability and fail-closed for falsely claiming lifecycle convergence.

Examples:

- reconciliation provider failure must not prevent unrelated normal chat response;
- failed vector embedding must not falsely mark Lance as converged;
- partial Engine insertion must be observable and retryable;
- a maintenance cycle may report incomplete without corrupting existing managed state.

No new runtime behavior is authorized by this statement.

## Telemetry requirement

If an eventual invariant is adopted, implementation must expose bounded observability for at least:

- eligible Core chunks examined;
- new Engine rows inserted;
- Engine rows already present;
- rows excluded by eligibility policy;
- remaining Engine backlog after bounded batch, if determinable;
- Lance rows added;
- Lance rows already present;
- Lance propagation failures/pending count;
- trigger/reason for the reconciliation cycle.

Do not introduce high-cardinality permanent telemetry unless necessary. Existing event/report surfaces should be reused where practical.

## Retrieval-path constraint

This design stage must preserve the current retrieval freeze.

No eventual-consistency choice may itself change:

- retrieval query formation;
- FTS/vector/recent channel construction;
- channel weights;
- ranking/fusion;
- gate thresholds;
- card rendering;
- topK;
- AutoRecall intent gate;
- answer generation policy.

The purpose is to make the managed corpus complete according to its lifecycle contract, not to tune retrieval around missing data.

## OpenClaw ownership constraint

The design must not require:

- writing OpenClaw Core tables directly;
- replacing `memory-core`;
- shadowing `memory_search` / `memory_get`;
- taking ownership of `plugins.slots.memory`;
- modifying OpenClaw's native memory schema.

A reconciliation implementation may read Core through the existing compatibility/read-only layer.

## Candidate-Builder boundary

Candidate-Builder remains deferred.

This stage must not reinterpret missing managed state as a Candidate-Builder problem and must not reopen publication/timeout diagnosis.

The lifecycle invariant should be correct independently of Candidate-Builder.

## Migration/backfill boundary

Adopting an invariant does not automatically authorize a one-time historical backfill of the current real database.

Implementation must be separated into at least:

~~~text
design acceptance
→ source implementation/tests
→ bounded non-live validation
→ separately authorized real-data reconciliation
~~~

No current Core/Engine/Lance mutation belongs in this design stage.

## Required design analysis

A later separately authorized execution of this Stage Card must remain read-only and answer:

1. Which lifecycle disposition best matches the stated memory-engine product goal and current Core/Engine ownership model?
2. What exact source/provenance scope should the invariant cover initially?
3. Should convergence be best-effort or bounded-eventual?
4. Which trigger family provides the smallest reliable implementation surface?
5. Can existing `backfillConfidenceForIndexedChunks()` and `repairOrphanVectors()` be reused safely, or do their current semantics require a bounded refactor?
6. How should the 500-row cap expose remaining backlog without creating a new state machine prematurely?
7. How should partial Engine/Lance failure remain retryable and observable?
8. What minimum tests would prove the invariant without touching real DB/index state?
9. What is explicitly deferred from the first implementation slice?

## Preferred design principle

The stage should prefer the smallest architecture that satisfies all of:

~~~text
Core remains read-only
managed corpus eventually converges
retrieval path stays latency-safe
reconciliation is idempotent
partial failure is retryable
historical backlog is bounded/observable
no duplicate eligibility system
no broad retrieval tuning
~~~

Do not prefer architectural minimalism if it leaves the demonstrated permanent blind spot intact.

## In scope

Only:

- lifecycle invariant choice;
- initial source/provenance scope;
- convergence semantics;
- reconciliation trigger family;
- reuse/refactor boundary for existing backfill/orphan-repair primitives;
- idempotence/failure/telemetry requirements;
- minimum implementation slice and test contract.

## Non-goals

Do not:

- modify source code;
- modify tests;
- run current sync/index/backfill/checkpoint/orphan repair;
- mutate Core DB, Engine DB, LanceDB, config, sessions, memory files, services, scheduler, runtime installation, or Gateway;
- enable AutoRecall;
- perform real-data reconciliation;
- change confidence constants or decay;
- tune retrieval;
- redesign checkpoint extraction;
- redesign OpenClaw native memory indexing;
- reopen Candidate-Builder;
- add multi-agent scope;
- add new database tables, ledger, scheduler, queue, or state machine as a default design assumption;
- create OpenSpec unless a later implementation stage determines one is actually needed;
- commit, tag, push, or implement a successor stage without separate authorization.

## Evidence hierarchy for design execution

Use, in order:

1. this exact committed Stage Card and authority packet;
2. current architecture/source ownership contract;
3. completed R3 attribution evidence;
4. existing generic backfill and orphan-repair implementation;
5. existing scheduler/maintenance paths;
6. existing tests and lifecycle telemetry capabilities;
7. only then broader historical docs if needed.

No runtime mutation is needed to make this design decision.

## Required result record

A design execution report must state:

- exact Stage Card path/SHA/commit/HEAD;
- selected Decision A disposition;
- selected convergence semantics if applicable;
- selected trigger family if applicable;
- exact initial source/provenance eligibility scope;
- rationale tied to R3 evidence and architecture ownership;
- primitives to reuse unchanged;
- primitives requiring bounded refactor;
- idempotence contract;
- failure/retry contract;
- backlog/telemetry contract;
- minimum implementation slice;
- required tests;
- explicit deferrals;
- whether OpenSpec is needed or not;
- one next implementation authorization request, not executed.

## Pass criteria

The stage may close `PASS` or `PASS_WITH_FINDINGS` only when:

1. one lifecycle disposition is selected;
2. the choice closes or intentionally accepts the demonstrated R3 gap;
3. Core ownership/read-only boundary is preserved;
4. managed-corpus and Lance semantics remain ordered through Engine lifecycle state;
5. retrieval tuning remains frozen;
6. implementation scope is bounded enough for a separate coding authorization;
7. no runtime/data mutation occurs.

Use `INSUFFICIENT_EVIDENCE` if the product invariant itself cannot be selected.

Use `STOPPED` on authority drift or any attempted mutation.

## Stage outcomes

Use exactly one:

~~~text
PASS
PASS_WITH_FINDINGS
INSUFFICIENT_EVIDENCE
STOPPED
~~~

A passing design stage creates only an `accepted_design`. It must not be described as implemented until a later source/runtime stage proves implementation.

## Execution safety

A later design execution must be read-only:

- direct source/doc reads;
- bounded Git inspection;
- read-only test/source inventory if needed;
- no shell command whose purpose is sync/index/backfill/checkpoint/repair;
- no new OpenClaw prompt or live retrieval;
- no credential output;
- no DB/index writes.

Default finite design-execution count:

~~~text
MAX_EXECUTIONS=1
~~~

## Allowed mutation before commit authorization

Only this Stage Card Markdown file.

## Authorization boundary

This frozen card authorizes nothing by itself.

Commit requires separate explicit Sol authorization.

After commit, design execution requires separate explicit Sol authorization bound to:

- exact Stage Card path;
- exact Stage Card SHA256;
- exact Stage Card commit;
- exact repository HEAD;
- design-only scope;
- `MAX_EXECUTIONS=1` unless Sol explicitly grants another finite count.

Any content/SHA/HEAD/scope drift invalidates prior authorization.

After execution, report and stop. Do not automatically implement the accepted design.
