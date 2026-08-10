# Session-Flush Bounded-Eventual Reconciliation Source-Implementation Stage Card — 2026-08-10

> Status: `FROZEN` — not committed; authorizes no coding, commit, runtime install, or real-data reconciliation
>
> Repository HEAD before this card: `92596bd9a20733816cd421437bd4348c78b6e5a0`
>
> Predecessor design Stage Card: `docs/smoke-tests/core-engine-lance-eventual-consistency-invariant-design-stage-card-20260810.md`
>
> Predecessor Stage Card SHA256: `db7e2d3bb32085d3ce8a477b895df50602b7c6a28c809d87438baf4cf7dec11f`
>
> Accepted design result: `PASS_WITH_FINDINGS / ADOPT_SESSION_FLUSH_EVENTUAL_MANAGED_INVARIANT / BOUNDED_EVENTUAL / PERIODIC_RECONCILIATION_ONLY`.
>
> Sol has authorized creation and freezing of this source-implementation Stage Card only. This card does not authorize Codex/source modification, commit, runtime installation, scheduler/config changes, Core/Engine/Lance mutation, or historical backlog reconciliation. Those require later separate authorization.

## 1. Stage decision

After separate coding authorization, implement the smallest source/test slice that makes the accepted lifecycle invariant executable in fixture/non-live form:

~~~text
eligible canonical session_flush Core chunk
        ↓
bounded periodic reconciliation
        ↓
Engine memory_confidence
        ↓
bounded periodic vector reconciliation
        ↓
Lance row
~~~

while preserving:

~~~text
OpenClaw Core = read-only authority
Engine = lifecycle authority
Lance = downstream derived vector state
retrieval path = no reconciliation mutation
~~~

The implementation stage must prove the source contract and tests only. It must not reconcile the current real databases.

## 2. Current facts this stage must preserve

### 2.1 Demonstrated lifecycle gap

The completed R3 attribution chain established:

~~~text
session_flush smart-add source
→ OpenClaw Core projection/searchability: PROVEN
→ automatic Engine propagation obligation in R3-era runtime: ABSENT
→ Lance: NOT REACHED for the fixed source
~~~

The fixed natural sample was:

~~~text
memory/smart-add/2026-07-31.md
~~~

and contained the August duty-schedule answer. This stage must not reopen that historical attribution.

### 2.2 Accepted design

The accepted design is now an `accepted_design`, not an implementation fact:

~~~text
Decision A = ADOPT_SESSION_FLUSH_EVENTUAL_MANAGED_INVARIANT
Decision B = BOUNDED_EVENTUAL
Decision C = PERIODIC_RECONCILIATION_ONLY
~~~

Initial provenance scope:

~~~text
memory/smart-add/%
Provenance: session_flush
Category: raw_log
~~~

Deferred from the first slice:

- manual provenance;
- agent_smart_add provenance;
- checkpoint-generated/generated-smart-add;
- episodes;
- unknown/migrated legacy provenance;
- broader watch-scope invariant;
- stale Core-ID cleanup;
- real historical reconciliation.

### 2.3 Existing source primitives

Current source already provides:

1. Core read-only compatibility through `openCoreDbReadonly()` / `withCoreDbReadonly()` and the `memory_index_chunks` → TEMP `chunks` compatibility view.
2. Engine isolated writable access through `withEngineDbIsolated()` / checkpoint DB wrappers.
3. `createBackfillConfidenceForIndexedChunks()` in `lib/index-sync-runtime.js`, including global existing-ID filtering and a 500-row write cap.
4. category/confidence policy in `lib/memory-confidence.js`, including `raw_log` initialization.
5. `repairOrphanVectors()` in `lib/checkpoint/orphan-repair.js`, which preserves Engine→Lance ordering but currently uses a global Lance scan and skips repair when Lance row count exceeds 1000.
6. canonical `session_flush` writer in `bin/flush-session-rawlog.js` with `Category: raw_log` and `Provenance: session_flush`.
7. checkpoint orchestration in `bin/session-checkpoint.js`, with current order `nightlyCheckpoint()` → `repairOrphanVectors()` → conflict resolution.
8. checkpoint runtime override seams in `lib/checkpoint/runtime.js`.
9. existing tests for index sync, session flush, checkpoint runtime/integration, Core read-only boundaries, and orphan repair.

## 3. Non-negotiable implementation invariants

### 3.1 Core ownership

No implementation may write OpenClaw Core tables.

All Core access for reconciliation must use the existing read-only compatibility layer.

No direct Core schema migration or OpenClaw memory-index modification is allowed.

### 3.2 Identity chain

Propagation identity must remain:

~~~text
Core chunk id
    ↔ Engine memory_confidence.chunk_id
    ↔ Lance row id
~~~

Text similarity is not an authoritative identity mechanism.

### 3.3 Engine-before-Lance ordering

The implementation must preserve:

~~~text
Core eligible
    ↓
Engine managed
    ↓
Lance vectorized
~~~

No direct Core→Lance path is allowed.

### 3.4 Retrieval-path isolation

No AutoRecall/hybrid/search/get path may invoke reconciliation.

No source change may add DB/vector writes to pre-retrieval or retrieval code.

### 3.5 Idempotence

Repeated reconciliation of the same Core chunk must not:

- duplicate Engine rows;
- reset `confidence`;
- reset `initial_confidence`;
- reset `hit_count`;
- clear `is_archived`;
- clear `is_protected`;
- clear `conflict_flag`;
- duplicate an existing valid Lance row.

Existing Engine lifecycle state always wins over re-observed Core source state.

## 4. Exact first-slice eligibility contract

### 4.1 Path

Only Core chunks whose path matches:

~~~text
memory/smart-add/%.md
~~~

are candidates for this first reconciliation slice.

`memory/generated-smart-add/%`, `memory/episodes/%`, root memory files, dreaming paths, and all other paths are excluded.

### 4.2 Canonical block provenance

Eligibility must be derived from the canonical smart-add source file, not inferred from chunk text.

The implementation must parse canonical smart-add blocks with at least:

~~~text
entryId
category
provenance
startLine
endLine
~~~

A block is first-slice eligible only when:

~~~text
provenance === "session_flush"
category === "raw_log"
~~~

Case normalization for metadata keys/values may reuse current parser conventions, but unknown/missing provenance is not eligible.

### 4.3 Core line-range mapping

A Core chunk is first-slice eligible only when its complete inclusive line range:

~~~text
[start_line, end_line]
~~~

is fully contained inside exactly one eligible canonical `session_flush` block in the same file.

This intentionally fails closed for the first slice.

Examples:

- chunk fully inside one `session_flush/raw_log` block → eligible;
- chunk fully inside manual/agent/unknown block → excluded;
- chunk spans `session_flush` and another provenance block → ambiguous/excluded;
- chunk spans two canonical blocks, even if both currently appear to be `session_flush` → ambiguous/excluded in the first slice;
- chunk cannot be mapped because source file or line metadata is unavailable → ambiguous/excluded.

The implementation must count ambiguous chunks separately from ordinary non-session-flush exclusions.

### 4.4 R3 sample sanity condition

The current canonical `memory/smart-add/2026-07-31.md` source has the demonstrated answer-bearing lines 80–108 inside the block beginning at line 3 with:

~~~text
Category: raw_log
Provenance: session_flush
~~~

This is a source-shape sanity check only. The current post-incident Core chunk ID must not be used as historical attribution evidence.

Fixture tests must include an analogous shape and prove that an answer-bearing chunk wholly inside the block is eligible.

## 5. Core→Engine reconciliation contract

### 5.1 Dedicated periodic reconciliation surface

The first implementation must introduce or expose one dedicated internal operation with semantics equivalent to:

~~~text
reconcileSessionFlushManagedState()
~~~

The exact function/file name may vary only if the resulting boundary remains equally explicit and testable.

It must not reuse `memory_engine.add` as the lifecycle trigger.

### 5.2 Selection order and starvation prevention

The existing generic backfill orders missing Core rows by `updated_at DESC`.

That ordering must not be reused for the accepted bounded-eventual periodic invariant because a persistent backlog plus continuing new writes could starve older rows.

The dedicated `session_flush` reconciliation must select missing eligible Core rows deterministically in:

~~~text
updated_at ASC,
id ASC
~~~

order.

This ordering is part of the first-slice contract.

Do not alter the existing `memory_engine.add` fast-path ordering/behavior merely to implement this periodic path.

### 5.3 Engine write bound

Per periodic reconciliation cycle:

~~~text
MAX_ENGINE_INSERTS_PER_CYCLE = 500
~~~

This reuses the existing bounded write scale.

The result must distinguish:

~~~text
cycle completed
≠ backlog fully converged
~~~

### 5.4 Confidence initialization

For newly inserted first-slice rows:

~~~text
category = raw_log
isProtected = false
~~~

and initialization must reuse the existing category policy from `lib/memory-confidence.js` rather than introducing a second confidence constant.

No confidence/tau tuning is authorized.

### 5.5 Existing row preservation

If `memory_confidence.chunk_id` already exists, the reconciler must count it as existing and leave the row unchanged regardless of archive/conflict/category/history state.

The periodic path must use insert-if-missing semantics only.

### 5.6 Engine result contract

At minimum return/report:

~~~text
trigger
eligible_core_examined
eligible_session_flush
excluded_non_session_flush
ambiguous_chunk_count
engine_existing
engine_missing_before
engine_inserted
engine_backlog_remaining
engine_converged
~~~

Exact field naming may be adjusted for repository conventions, but these semantics must remain machine-testable.

`engine_converged=true` is allowed only when no eligible missing Engine rows remain after the cycle.

## 6. Reuse boundary for `createBackfillConfidenceForIndexedChunks()`

The implementation should reuse existing confidence insertion mechanics/policy where practical, but must not force the new periodic invariant through the generic path in a way that changes existing `memory_engine.add` behavior.

Acceptable implementation forms include:

1. factor a shared internal insert-missing-confidence primitive and keep separate selectors/orderings; or
2. boundedly generalize the existing backfill primitive with an explicit selector/order option while preserving the current default contract and all existing tests.

Not acceptable:

- copy/paste a second confidence policy with separate constants;
- silently change the generic default order from DESC to ASC;
- make AutoRecall/search call the generic backfill;
- broaden generic backfill to all Core paths.

If `lib/index-sync-runtime.js` is changed, all existing observable default behavior must remain covered by regression tests.

## 7. Engine→Lance reconciliation contract

### 7.1 Reuse `repairOrphanVectors()` mechanics

The implementation should reuse/refactor `lib/checkpoint/orphan-repair.js` rather than create an unrelated vector writer.

Required preserved mechanics:

- Engine row is authoritative eligibility input;
- Core text is read by exact chunk ID;
- embedding is derived from Core text;
- Lance row ID equals Engine/Core chunk ID;
- existing Lance row is not duplicated;
- embedding/write failure is retryable.

### 7.2 Scoped mode

`repairOrphanVectors()` may be extended with an optional scoped mode or equivalent internal primitive so the new periodic path can reconcile only eligible `session_flush` Engine IDs.

Existing no-argument behavior may remain for compatibility, but the new source implementation must not rely on the current `count > 1000 → skip all` behavior.

The new scoped path must remain valid when the Lance table contains more than 1000 total rows.

### 7.3 Lance ordering and write bound

For the first source slice, vector reconciliation must be deterministic and no-starvation.

Eligible active Engine rows should be considered oldest-first using their source/Core ordering when available, with chunk ID as deterministic tie-breaker.

Per cycle:

~~~text
MAX_LANCE_WRITES_PER_CYCLE = 10
~~~

This first-slice limit is intentionally conservative and grounded in the existing orphan-repair batch size. It is a source/runtime safety bound, not a permanent product tuning decision.

A later non-live/runtime stage may propose changing the cap, but this implementation authorization must not silently raise it.

### 7.4 Active/vector-eligible state

The first slice must not vectorize an Engine row when:

~~~text
is_archived != 0
~~~

Other existing retrieval/lifecycle policy remains unchanged. This stage does not create new content-quality eligibility or annotation gates.

Engine-managed state and AutoRecall-injection eligibility remain distinct concepts.

### 7.5 Partial failure

If Engine reconciliation succeeds but embedding/Lance write fails:

~~~text
Engine row remains valid
Lance remains pending
cycle must not claim Lance convergence
next periodic cycle may retry
~~~

No new DB column/table is required for pending-vector state; it should be derivable from Engine eligible IDs minus Lance IDs.

### 7.6 Lance result contract

At minimum return/report:

~~~text
lance_eligible
lance_existing
lance_missing_before
lance_added
lance_failed
lance_backlog_remaining
lance_converged
~~~

`lance_converged=true` is allowed only when no eligible active Engine IDs remain absent from Lance.

## 8. Backlog semantics

No new ledger, queue, cursor table, scheduler state machine, or persistent reconciliation table is authorized.

Backlog must be derived from current authoritative state:

~~~text
eligible Core IDs - Engine IDs = Engine backlog

eligible active Engine IDs - Lance IDs = Lance backlog
~~~

Oldest-first processing provides no-starvation semantics across multiple periodic cycles.

A bounded write limit may leave `*_backlog_remaining > 0`; that is an incomplete but valid cycle, not an error.

## 9. Periodic lifecycle integration

### 9.1 Existing lifecycle opportunity

Do not add a new scheduler.

The accepted design uses the existing session-checkpoint periodic lifecycle opportunity.

The target orchestration after implementation must be semantically:

~~~text
flush checkpoint raw log (existing outer flow)
    ↓
nightlyCheckpoint()                    existing
    ↓
Core→Engine session_flush reconcile    new bounded step
    ↓
Engine→Lance scoped reconcile          new/refactored bounded step
    ↓
resolveConfigConflicts()               existing
~~~

### 9.2 Failure isolation

Reconciliation is maintenance work and must fail open for checkpoint/chat availability while failing closed for convergence claims.

A reconciliation exception/provider failure must:

- be logged/represented as incomplete;
- not roll back already valid Engine rows;
- not delete existing Lance rows;
- not falsely report convergence;
- not prevent later conflict resolution solely because a recoverable reconciliation step failed.

A programmer/invariant error may fail the targeted test stage, but runtime orchestration must not turn an embedding outage into false success.

### 9.3 LLM independence

Reconciliation must not depend on successful nightly LLM extraction.

If `nightlyCheckpoint()` returns a bounded timeout/skipped/no-data result and main orchestration continues, the reconciliation opportunity must still be reachable.

Do not redesign checkpoint extraction to achieve this.

## 10. Runtime seam

`lib/checkpoint/runtime.js` may gain explicit reconciliation runtime overrides/fallbacks so fixture/integration tests can prove ordering and failure behavior without opening real DBs or Lance.

Preferred shape is equivalent to:

~~~text
reconcileSessionFlushManagedState
repair/reconcile scoped session-flush vectors
~~~

Exact names may follow current runtime conventions.

Do not add config knobs for these functions in the first slice.

## 11. Telemetry/observability

The first implementation must expose bounded cycle summaries sufficient to answer:

- why the cycle ran;
- how many Core chunks were eligible;
- how many were excluded/ambiguous;
- how many Engine rows existed/inserted/remain;
- how many Lance rows existed/added/failed/remain;
- whether Engine and Lance each converged.

Prefer returned structured results plus concise checkpoint logs.

Do not add per-chunk permanent memory events or high-cardinality telemetry in the first slice unless an existing event contract already requires it.

## 12. Allowed source files after separate coding authorization

The implementation should remain within this bounded set unless the coder stops and requests scope expansion:

~~~text
lib/checkpoint/raw-log.js
lib/checkpoint/runtime.js
lib/checkpoint/orphan-repair.js
lib/index-sync-runtime.js
lib/memory-confidence.js                 read/reuse expected; modification only if strictly required for shared export
bin/session-checkpoint.js
~~~

One new internal module under one of these directories is allowed, preferably:

~~~text
lib/checkpoint/session-flush-reconciliation.js
~~~

or an equivalently scoped name.

No changes to AutoRecall/hybrid retrieval modules are authorized.

No config/schema/OpenSpec files are authorized.

## 13. Allowed test files after separate coding authorization

New/modified tests may be limited to:

~~~text
test/session-flush-reconciliation.test.js          new preferred
test/index-sync-runtime.test.js                    if shared backfill primitive changes
test/checkpoint-orphan-repair.test.js
test/checkpoint-runtime.test.js
test/session-checkpoint.integration.test.js
test/flush-session-rawlog-static.test.js           only if canonical block contract needs regression coverage
test/core-readonly-boundary-probe.test.js          only if ownership regression coverage is needed
~~~

No real runtime smoke or real DB fixture is authorized in this source stage.

## 14. Required fixture tests

At minimum the source implementation must prove all of the following with temp/fixture data:

### Eligibility

1. A Core chunk fully contained in one `session_flush/raw_log` block is eligible.
2. A current-R3-shaped answer chunk analogous to lines 80–108 is eligible.
3. Manual provenance is excluded.
4. Agent smart-add provenance is excluded.
5. Unknown/missing provenance is excluded.
6. Generated-smart-add path is excluded.
7. Episode path is excluded.
8. A chunk crossing a provenance/block boundary is ambiguous and excluded.
9. Missing/unreadable source mapping fails closed and is counted.

### Engine

10. Missing eligible row is inserted with existing `raw_log` category initialization policy.
11. Existing row is not rewritten even if archived/conflicted/reinforced.
12. More than 500 missing rows insert only the oldest 500.
13. A second cycle advances into the remaining backlog with deterministic order.
14. Continuing newer arrivals do not starve an older backlog row.
15. Engine backlog/converged counts are exact.
16. Core handle remains read-only.

### Lance

17. Existing Lance ID is not duplicated.
18. Missing active eligible Engine ID can be added by exact identity.
19. Archived Engine ID is not vectorized by the new scoped path.
20. More than 10 missing vectors add at most the oldest 10 in one cycle.
21. A later cycle advances the vector backlog without starvation.
22. Embedding failure leaves Engine state intact and reports Lance pending/failure.
23. Lance table with more than 1000 total rows does not cause the scoped reconciliation to skip all work.
24. Scoped reconciliation does not vectorize unrelated Engine IDs.

### Orchestration

25. Order is `nightlyCheckpoint → Engine reconcile → Lance reconcile → conflicts`.
26. Reconciliation remains reachable after bounded nightly timeout/skipped/no-data returns.
27. Recoverable Engine/Lance reconciliation failure does not falsely report convergence.
28. Retrieval/AutoRecall code has no new reconciliation call site.
29. No test opens or mutates the real Core, Engine, or Lance paths.

## 15. Required validation commands

After separate coding authorization and implementation, run at minimum:

~~~text
node --test test/session-flush-reconciliation.test.js
node --test test/index-sync-runtime.test.js test/checkpoint-orphan-repair.test.js test/checkpoint-runtime.test.js test/session-checkpoint.integration.test.js test/flush-session-rawlog-static.test.js
npm test
~~~

If repository convention provides a static/check command, run the existing canonical check as well.

Tests must use fixtures/temp directories only.

Do not run:

- `openclaw memory index`;
- memory-engine sync CLI against the real workspace;
- real `session-checkpoint.js`;
- real orphan repair;
- real embedding/Lance writes;
- live AutoRecall/retrieval.

## 16. Non-live validation contract

A passing source stage proves only:

~~~text
source implementation + fixture tests are correct
~~~

It does not prove:

~~~text
installed runtime uses the new code
real backlog is reconciled
R3 historical answer is now present in Engine/Lance
AutoRecall now answers the duty-schedule question
production performance is acceptable
~~~

Any installed-runtime/non-live validation must be a later separately authorized Stage Card.

Any real Core→Engine/Lance reconciliation must be a still later separately authorized operation.

## 17. Explicit deferrals

The first source implementation must not include:

- real database backfill;
- migration of historical legacy confidence;
- stale Engine/Lance ID deletion;
- broader `manual` / `agent_smart_add` / episodes invariant;
- generated-smart-add management;
- new content-quality classifier;
- AutoRecall eligibility changes;
- confidence/tau tuning;
- ranking/fusion/gate/topK changes;
- Candidate-Builder;
- new scheduler;
- queue/ledger/state-machine table;
- new config object or CLI surface;
- OpenSpec;
- multi-agent support;
- push/tag/release.

## 18. OpenSpec decision

For this first source slice:

~~~text
OpenSpec = NOT REQUIRED
~~~

Reason:

- no public API is added;
- no config schema is added;
- no DB schema is added;
- no memory slot ownership changes;
- no retrieval contract changes;
- implementation is an internal lifecycle reconciliation correction under an already accepted design.

If coding reveals that a new config/schema/public command is unavoidable, stop and return to design authorization instead of creating it automatically.

## 19. Stage execution boundary

This frozen Stage Card itself authorizes no coding.

A later coding execution requires separate explicit Sol authorization bound to:

- this exact committed Stage Card path;
- exact Stage Card SHA256;
- exact Stage Card commit;
- exact repository HEAD;
- allowed source/test scope above;
- source/fixture-only execution;
- finite `MAX_EXECUTIONS=1` unless Sol explicitly grants another finite count.

Codex CLI may be used only after that explicit coding authorization.

DevSpace remains read-only for source inspection unless Sol separately authorizes source work through the approved coder workflow.

## 20. Commit boundary

Even after a successful coding execution:

- implementation commit requires separate Sol authorization;
- runtime installation requires separate Sol authorization;
- real-data reconciliation requires separate Sol authorization;
- tag/push require separate authorization.

No success in one gate implies authorization for the next.

## 21. Implementation-stage outcomes

When later executed, use exactly one:

~~~text
PASS
PASS_WITH_FINDINGS
INSUFFICIENT_EVIDENCE
STOPPED
~~~

`PASS`/`PASS_WITH_FINDINGS` mean the source + fixture contract is implemented and validated only.

Use `STOPPED` if scope expansion, real-data access, retrieval mutation, or authority drift becomes necessary.

## 22. Source-stage pass criteria

A later implementation execution may pass only if:

1. eligibility is provenance + line-range deterministic and fail-closed;
2. R3-shaped fixture answer chunk is eligible;
3. Core remains read-only;
4. Engine insertion is idempotent and preserves existing lifecycle state;
5. Engine selection is oldest-first and bounded to 500;
6. Engine backlog is observable and no-starvation tests pass;
7. Lance remains downstream of Engine;
8. scoped Lance reconciliation works when total Lance rows exceed 1000;
9. Lance writes are oldest-first and bounded to 10 in this first slice;
10. partial embedding failure remains retryable;
11. checkpoint orchestration uses the periodic lifecycle opportunity without a new scheduler;
12. LLM extraction outcome does not gate reconciliation reachability;
13. retrieval modules remain unchanged;
14. targeted tests and full suite pass;
15. no real DB/index/runtime mutation occurs.

## 23. Safety stop conditions

Stop immediately if implementation requires any of the following without new authorization:

- Core write access;
- modifying OpenClaw native memory indexing;
- running a real sync/index/backfill/checkpoint/repair;
- reading secret values into logs;
- changing AutoRecall/hybrid retrieval behavior;
- direct Core→Lance vectorization;
- broadening provenance beyond `session_flush`;
- changing confidence constants/tau;
- creating a scheduler/config/schema/ledger/table;
- touching real Engine/Lance rows;
- using current post-incident Core IDs as historical proof;
- changing Stage Card content after execution authorization;
- commit/tag/push/runtime install.

## 24. Required implementation report

A later coding execution report must state:

- exact Stage Card path/SHA/commit/HEAD;
- exact changed files;
- exact eligibility implementation;
- exact Engine and Lance write caps;
- proof of oldest-first/no-starvation semantics;
- proof existing Engine rows are preserved;
- proof Core is read-only;
- proof `>1000` Lance total rows no longer suppress scoped work;
- orchestration order;
- targeted test results;
- full-suite result;
- `git diff --check`;
- worktree diff summary;
- explicit statement that no real DB/index/runtime operation ran;
- at most one next gate request.

## 25. Authorization state at freeze

~~~text
Stage Card = FROZEN
Stage Card commit = NOT AUTHORIZED
Coding execution = NOT AUTHORIZED
Implementation commit = NOT AUTHORIZED
Runtime install = NOT AUTHORIZED
Real-data reconciliation = NOT AUTHORIZED
Push/tag = NOT AUTHORIZED
MAX_EXECUTIONS = not consumed
~~~

After freezing this card, stop at the commit authorization gate.
