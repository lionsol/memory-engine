# AutoRecall R3 Core→Engine/Lance Propagation-Obligation Attribution Stage Card — 2026-08-09

> Status: `FROZEN` — not committed and authorizes no execution
>
> Repository HEAD before this card: `8998852cc7ff4baa419df10756df4755743b99eb`
>
> This card is a successor to the completed post-incident source→Core attribution stage. That prior stage closed `PASS_WITH_FINDINGS / CORE_PROJECTED_BEFORE_R3 / DOWNSTREAM_LANCE_TRIGGER_UNPROVEN`.
>
> Sol has authorized creation and freezing of this bounded read-only successor Stage Card. This authorization does not authorize commit or execution. Commit authorization and execution authorization remain separate. Any later execution must bind the exact committed Stage Card, exact Stage Card SHA256, exact Stage Card commit, exact repository HEAD, exact fixed historical scope, and finite execution count. Default: `MAX_EXECUTIONS=1`.

## Decision

For the fixed answer-bearing source:

~~~text
memory/smart-add/2026-07-31.md
~~~

whose OpenClaw Core projection before R3 is already proven, determine whether the R3-era memory-engine contract required or actually triggered propagation of the relevant Core chunks into:

~~~text
1. Engine memory_confidence
2. memory-engine LanceDB
~~~

before the fixed R3 natural AutoRecall turn.

The stage must identify the earliest unresolved propagation boundary without running any current sync, backfill, checkpoint, repair, retrieval, or mutation.

## Primary attribution — Core→Engine

Choose exactly one when evidence is sufficient:

~~~text
NO_ENGINE_PROPAGATION_OBLIGATION
ENGINE_PROPAGATION_TRIGGER_UNPROVEN
ENGINE_PROPAGATION_EXPECTED_BUT_MISSING
ENGINE_PROPAGATED_BEFORE_R3
~~~

If preserved evidence cannot distinguish the applicable primary attribution without recreating historical state, close `INSUFFICIENT_EVIDENCE`.

## Secondary attribution — Engine→Lance

Evaluate this only if `ENGINE_PROPAGATED_BEFORE_R3` is proven.

Choose exactly one:

~~~text
NO_LANCE_PROPAGATION_OBLIGATION
LANCE_PROPAGATION_TRIGGER_UNPROVEN
LANCE_PROJECTION_EXPECTED_BUT_MISSING
LANCE_PRESENT_BEFORE_R3
~~~

If the primary Core→Engine boundary is not cleared, report:

~~~text
LANCE_NOT_REACHED
~~~

and do not over-attribute the downstream layer.

## User value

The prior bounded analysis proved that the fixed smart-add source was already searchable through OpenClaw native `memory_search` before R3. Therefore the first loss is not workspace source→OpenClaw Core projection.

The unresolved question is narrower and structurally different:

- OpenClaw native Core indexing has its own lifecycle;
- memory-engine Engine confidence metadata has a separate lifecycle;
- memory-engine Lance vectors have another separate lifecycle;
- R3 vector retrieval depends on memory-engine Lance, not merely on OpenClaw native Core presence.

This stage decides whether the missing answer-bearing memory in R3 was caused by an unmet Core→Engine or Engine→Lance propagation obligation, or whether no such obligation existed for this source under the R3-era design.

No retrieval tuning or repair may be designed before this boundary is resolved.

## Fixed historical subject

Primary source:

~~~text
/home/lionsol/.openclaw/workspace/memory/smart-add/2026-07-31.md
~~~

Source availability:

~~~text
birth≈2026-08-01 03:30:00 +0800
mtime≈2026-08-01 03:30:00 +0800
~~~

Answer-bearing content includes:

~~~text
8月值班表已生成
duty-schedule-august-2026.md
~~~

Independent answer artifact:

~~~text
/home/lionsol/.openclaw/workspace/duty-schedule-august-2026.md
birth=2026-07-31 09:35:46 +0800
mtime=2026-07-31 09:37:22 +0800
~~~

The root-level duty-schedule file is corroborating answer evidence only. It is not the primary propagation subject.

## Proven pre-R3 Core boundary

The prior stage established an admissible Tier-A pre-incident native `memory_search` result:

~~~text
timestamp=2026-08-03 13:02:09 +0800
isError=false
path=memory/smart-add/2026-07-31.md
citation=memory/smart-add/2026-07-31.md#L2130-L2171
~~~

Therefore:

~~~text
workspace smart-add source
    ↓
OpenClaw Core projection
    ↓
OpenClaw native searchable Core state
~~~

is already proven before R3.

This successor stage must not reopen that conclusion unless new immutable evidence directly contradicts it. Current or post-incident Core state is not needed to prove the Core boundary again.

## Fixed R3 identity

~~~text
agentId=main
sessionId=ce1e425c-10f0-4393-8d76-75ec390dd58f
traceId=f283b4ef-45bd-42f7-99a0-1c088b980354
R3 events=191..195
R3 event 191 local time≈2026-08-09 19:09:57 +0800
~~~

Historical attribution interval for this stage begins no later than the proven Core-searchable state:

~~~text
2026-08-03 13:02:09 +0800
~~~

and ends at R3 event 191:

~~~text
2026-08-09 19:09:57 +0800
~~~

Earlier source-availability evidence from `2026-08-01 03:30 +0800` may be used when required to interpret lifecycle behavior.

## Post-incident contamination boundary

At approximately:

~~~text
2026-08-09 20:49:16 +0800
~~~

a verification-shell defect accidentally launched OpenClaw native memory indexing and refreshed the agent-specific Core index.

The incident did not mutate:

- repository source;
- memory-engine Engine events `191..195`;
- Engine confidence count at incident closeout;
- memory-engine Lance version history.

Post-incident Core chunks, including the current answer-bearing chunk `a990da16...`, are capability evidence only and must not be used to prove pre-R3 Engine or Lance propagation.

## Required propagation model

Execution must treat these boundaries independently:

~~~text
fixed smart-add source
        ↓
OpenClaw Core projection                 PROVEN BEFORE R3
        ↓
Core answer/source chunks
        ↓
Engine confidence propagation            PRIMARY DECISION
        ↓
Engine memory_confidence rows
        ↓
Lance orphan/vector propagation          SECONDARY DECISION
        ↓
memory-engine Lance rows
        ↓
R3 vector channel
~~~

Do not collapse `Core indexed`, `Engine managed`, and `Lance vectorized` into one state.

## Frozen contract facts already established

The following structural facts were established by bounded source inspection and must be revalidated against the exact execution HEAD only if necessary:

### A. Generic Engine backfill path

`lib/index-sync-runtime.js` implements `backfillConfidenceForIndexedChunks()`.

It reads Core chunks only from:

~~~text
memory/smart-add/%
memory/episodes/%
~~~

filters out chunk IDs already present in Engine `memory_confidence`, orders by Core `updated_at DESC`, and inserts at most:

~~~text
CONFIDENCE_BACKFILL_LIMIT=500
~~~

new Engine confidence rows per invocation.

`syncIndexIfNeeded()` calls this backfill:

- after successful manager Core sync;
- when the local sync state is already `fresh`;
- and in the manager-unavailable fallback path.

Therefore an invocation of `syncIndexIfNeeded()` can create Engine confidence even when it does not perform a new Core index mutation.

### B. Runtime call sites for generic backfill

At the frozen source tree, the only direct non-test runtime call to `syncIndexIfNeeded(...)` found in source is the `memory_engine.add` flow:

~~~text
lib/tools/memory-engine-actions.js
syncRunner: () => syncIndexIfNeeded("memory_engine.add")
~~~

The default CLI runtime wires its sync function to forced `runMemoryIndexSync`, but source inspection must still prove an actual command/action path invoked it before treating that as a historical propagation trigger.

Native OpenClaw `memory_search` success proves OpenClaw Core searchability. It does **not** by itself prove memory-engine `syncIndexIfNeeded()` or Engine backfill execution.

AutoRecall/hybrid retrieval does not itself provide a proven generic Engine backfill call site.

### C. `memory_engine.add` immediate propagation path

For memories created through `memory_engine.add`, the action:

1. appends a smart-add record;
2. invokes its sync runner;
3. identifies Core chunks under the newly written file that are not yet in `memory_confidence`;
4. inserts Engine confidence rows;
5. attempts a Lance write for the first newly identified chunk.

The fixed `memory/smart-add/2026-07-31.md` source was produced through checkpoint/session-flush aggregation, not proven to have been created through `memory_engine.add`.

Therefore the `memory_engine.add` immediate-propagation guarantee must **not** be applied to the fixed source unless preserved history proves an actual relevant `memory_engine.add` invocation whose generic backfill covered the fixed source.

### D. Nightly checkpoint confidence path

`bin/session-checkpoint.js` writes checkpoint-generated structured memories and episode summary through a checkpoint-generated target.

`lib/checkpoint/confidence-writer.js` resolves the most recent Core chunk for the supplied `fileRel` and writes Engine confidence for that chunk.

For checkpoint-generated structured output, the runtime supplies the generated checkpoint file path rather than treating the raw/session-flush smart-add file as a generic full-file backfill target.

Therefore a nightly checkpoint completing does **not**, by itself, prove that all already-indexed chunks in `memory/smart-add/2026-07-31.md` received Engine confidence.

### E. Lance orphan repair path

`lib/checkpoint/orphan-repair.js`:

1. reads non-archived Engine `memory_confidence.chunk_id` rows;
2. reads existing Lance IDs;
3. computes IDs present in Engine confidence but missing in Lance;
4. looks up the corresponding Core chunk text;
5. embeds and adds the missing row to Lance.

This mechanism cannot create a Lance row for a Core chunk that never obtained an Engine `memory_confidence` row.

The nightly checkpoint calls `repairOrphanVectors()` after `nightlyCheckpoint()`.

Therefore the Lance obligation depends on the Engine-confidence boundary first.

### F. No relevant contract drift detected

Bounded Git inspection found no changes to the relevant propagation-contract files between candidate-provenance implementation commit:

~~~text
1cd183ff12d055ba5c5ecd4bd0d9d1b98cdff23b
~~~

and the current Stage Card base HEAD:

~~~text
8998852cc7ff4baa419df10756df4755743b99eb
~~~

for the inspected files:

- `lib/index-sync-runtime.js`
- `lib/checkpoint/orphan-repair.js`
- `bin/session-checkpoint.js`
- `lib/tools/memory-engine-actions.js`
- `lib/services/memory-engine-cli-service.js`
- `lib/recall/hybrid/runtime-context.js`
- `lib/recall/hybrid-search.js`

Execution must still bind the exact committed card/HEAD and stop on unexpected drift.

## Known uncontaminated historical findings

Prior bounded work established before the 20:49 Core-index incident:

1. R3 vector provenance had four bounded IDs.
2. All four uniquely expanded through Engine confidence to full managed IDs.
3. Exact Lance reads showed all four candidates were unrelated to the August duty schedule.
4. R3 FTS/lexical candidate counts were zero.
5. The only final R3 candidate was unrelated and was later rejected by the AutoRecall gate.
6. Lance historical versions `14..43` contained no answer-bearing August-duty-schedule row.
7. Engine confidence history after the proven Core-searchable time showed only one known update around `2026-08-03 21:15:15 +0800`, ID prefix `620da616...`, whose Lance text was unrelated runtime-smoke/baseline material.
8. These findings do not prove whether a qualifying generic backfill should have covered the fixed source.

## In scope

Only the following are in scope:

1. determine whether the R3-era contract imposed any generic Core→Engine propagation obligation for an already-indexed smart-add source that was not created through `memory_engine.add`;
2. identify every preserved historical `syncIndexIfNeeded`, equivalent memory-engine sync/backfill, `memory_engine.add`, CLI add/sync, checkpoint confidence, maintenance, or other exact propagation trigger between the proven Core-searchable time and R3;
3. for each candidate trigger, determine whether its contract would actually cover the fixed source's relevant Core chunks, considering path eligibility, the 500-row backfill cap, ordering, existing Engine IDs, and source timing;
4. determine whether an answer-bearing or source-traceable Engine `memory_confidence` row existed before R3;
5. only if Engine propagation before R3 is proven, determine whether a Lance propagation obligation/trigger existed after that Engine row and before R3;
6. compare preserved Lance history with the exact answer-bearing/source-traceable Engine ID when possible;
7. assign one primary attribution and one secondary attribution where applicable, or close `INSUFFICIENT_EVIDENCE`;
8. state at most one smallest next product decision without implementing it.

## Non-goals

Do not:

- run `memory_engine add`;
- run any memory index/sync command;
- run `syncIndexIfNeeded`;
- run confidence backfill;
- run session checkpoint;
- run orphan-vector repair;
- run nightly maintenance;
- run current or synthetic memory retrieval;
- submit a new OpenClaw prompt;
- replay R3;
- enable AutoRecall;
- change `topK`, thresholds, weights, query shaping, fusion, Card/gate policy, projection size, provenance limits, or channel behavior;
- mutate Core DB, Engine DB, LanceDB, FTS, KG, config, sessions, memory files, runtime, Gateway, scheduler, or service state;
- use post-incident Core rows as proof of pre-R3 Engine or Lance state;
- infer an Engine ID from text similarity alone when deterministic identity is unavailable;
- create or execute a repair;
- create an OpenSpec change;
- reopen Candidate-Builder or provider-timeout work;
- commit, tag, push, or start a successor stage without separate authorization.

## Historical trigger rules

### Qualifying Core→Engine trigger

A Core→Engine trigger is proven only by preserved evidence that a real runtime path executed before R3 and that path invoked or was contractually equivalent to Engine confidence backfill for already-indexed smart-add/episode Core chunks.

Examples that may qualify only with execution evidence:

- `memory_engine.add` whose sync runner actually ran;
- explicit memory-engine sync/index CLI path that also performs Engine backfill;
- a direct invocation of `syncIndexIfNeeded()`;
- another exact R3-era lifecycle path proven to call `backfillConfidenceForIndexedChunks()`.

The following do **not** qualify by themselves:

- OpenClaw native `memory_search`;
- OpenClaw Core watcher indexing;
- Gateway startup;
- a successful native Core search hit;
- nightly checkpoint completion;
- orphan repair completion;
- existence of the smart-add file;
- current post-incident Core presence.

### Trigger coverage

A trigger counts as an obligation for the fixed source only when evidence proves that the fixed source's relevant Core chunk(s) were within that trigger's effective backfill set.

Because generic backfill has a 500-row limit and orders missing eligible Core rows by `updated_at DESC`, do not assume that every invocation covered every eligible historical chunk.

Coverage may be proven by:

- preserved sync/backfill result metadata naming the source/chunk;
- point-in-time Core ordering plus Engine-existing set sufficient to deterministically place the relevant chunk within the first 500 missing rows;
- an immutable Engine row timestamp/identity traceable to the source;
- another deterministic historical record.

If trigger execution is proven but coverage cannot be established, primary attribution remains `ENGINE_PROPAGATION_TRIGGER_UNPROVEN` unless stronger evidence resolves it.

## Engine identity rules

To select `ENGINE_PROPAGATED_BEFORE_R3`, execution must prove at least one pre-R3 Engine `memory_confidence.chunk_id` that is deterministically traceable to the fixed source.

Acceptable identity evidence includes:

- an immutable pre-R3 native Core chunk ID from the fixed source matched exactly to Engine confidence;
- a preserved pre-R3 report/event containing both Core source identity and Engine chunk ID;
- deterministic chunk-ID derivation only if the exact R3 implementation and source bytes make the identity unique and reproducible without mutation;
- another equivalent immutable mapping.

Do not use the post-incident answer-bearing Core ID `a990da16...` as proof that the same ID existed in Engine before R3.

Do not infer identity from matching text alone when duplicate or rechunked content remains possible.

## Lance trigger rules

Lance evaluation begins only after a source-traceable Engine row is proven.

A qualifying Engine→Lance trigger may include:

- a nightly checkpoint execution after the Engine row existed, because the frozen contract calls `repairOrphanVectors()` after nightly checkpoint;
- another preserved direct orphan-repair execution;
- an exact `memory_engine.add` direct Lance write when the proven Engine row is one of that action's newly created chunks;
- another exact R3-era Lance projection path proven to cover the ID.

A nightly checkpoint that occurred **before** the Engine row existed cannot satisfy the Lance obligation for that row.

A checkpoint after the Engine row existed still requires evidence that orphan repair was reached rather than the process stopping before Step 2.5.

If orphan repair was reached, an answer-bearing/source-traceable Engine ID missing from the corresponding post-repair Lance historical state can support `LANCE_PROJECTION_EXPECTED_BUT_MISSING`, subject to embedding/provider failure evidence and any explicit fail-open semantics.

## Attribution rules

### `NO_ENGINE_PROPAGATION_OBLIGATION`

Use only if the exact R3-era contract proves that an already-indexed smart-add source of this provenance/class had no automatic or required path into generic Engine confidence unless an explicit memory-engine add/sync action was invoked, and preserved history proves no such required invocation was part of the accepted lifecycle contract.

This is a design-gap finding, not a runtime failure finding.

### `ENGINE_PROPAGATION_TRIGGER_UNPROVEN`

Use when the source was eligible for generic backfill, but preserved evidence does not prove a qualifying trigger that covered the relevant Core chunk(s) between proven Core presence and R3.

This result means no runtime propagation defect is proven.

### `ENGINE_PROPAGATION_EXPECTED_BUT_MISSING`

Use only when all are proven:

1. a qualifying Core→Engine trigger executed or was contractually required;
2. the fixed source's relevant Core chunk was within the trigger's effective coverage;
3. preserved historical evidence shows no source-traceable Engine confidence row resulted before R3.

If selected, the earliest supported loss is Core→Engine propagation.

### `ENGINE_PROPAGATED_BEFORE_R3`

Use only when a source-traceable Engine confidence ID is proven before R3.

If selected, proceed to secondary Lance attribution.

### `NO_LANCE_PROPAGATION_OBLIGATION`

Use only if Engine propagation is proven but the exact R3-era contract imposes no automatic/required Lance propagation for that Engine row absent an explicit operation that was not part of the accepted lifecycle.

### `LANCE_PROPAGATION_TRIGGER_UNPROVEN`

Use when Engine propagation is proven but preserved evidence does not prove a later qualifying Lance trigger covering that ID before R3.

### `LANCE_PROJECTION_EXPECTED_BUT_MISSING`

Use only when:

1. Engine propagation is proven;
2. a qualifying Lance trigger executed after that Engine row existed;
3. the trigger contract covered that exact ID;
4. preserved post-trigger/pre-R3 Lance state lacks the ID or answer-bearing row;
5. no explicit expected fail-open/provider failure explains the absence without a propagation defect finding.

### `LANCE_PRESENT_BEFORE_R3`

Use only when the exact source-traceable Engine ID is present in a pre-R3 Lance historical version.

### `LANCE_NOT_REACHED`

Use whenever the primary Core→Engine boundary is not cleared.

## Evidence authority tiers

### Tier A — admissible historical attribution evidence

May directly support attribution:

- pre-R3 session/trajectory tool calls and tool results;
- pre-R3 scheduler/service/journal records;
- Engine DB row timestamps/IDs that predate R3;
- Engine events `191..195`;
- Lance version history and scalar-only historical reads that predate the 20:49 incident;
- immutable reports generated before the contamination boundary;
- Git/source contract proven applicable to R3.

### Tier B — post-incident capability evidence

May explain current capabilities but not prove historical propagation:

- current agent-specific Core rows after 20:49;
- current Core answer-bearing chunk IDs;
- current Core revision/FTS/vector state.

### Tier C — explanatory implementation evidence

May establish contract mechanics and obligation semantics, but cannot substitute for proof that a historical runtime trigger executed.

## Minimum evidence hierarchy

Use the minimum sufficient evidence in this order:

1. exact Stage Card authority preflight;
2. exact R3-era propagation source contract;
3. prior proven Core-searchable source record;
4. preserved historical memory-engine tool/CLI/session/scheduler executions;
5. Engine confidence timestamps and IDs;
6. checkpoint execution records only when needed for downstream Lance timing;
7. Lance historical versions and exact-ID scalar reads;
8. post-incident Core capability evidence only as a non-historical cross-check.

Do not recreate missing history by executing a current operation.

## Required execution sequence

A later authorized execution must remain bounded:

1. Verify exact card SHA, commit, HEAD, clean worktree, and execution count.
2. Verify no relevant contract drift.
3. Reuse the prior Tier-A proof that the source was Core-searchable before R3.
4. Search only the fixed historical interval for candidate Core→Engine propagation executions.
5. For each candidate, prove or reject effective coverage of the fixed source.
6. Attempt deterministic pre-R3 Engine identity mapping.
7. Assign the primary attribution.
8. Only if Engine propagation is proven, inspect later pre-R3 Lance triggers and exact-ID history.
9. Assign the secondary attribution or `LANCE_NOT_REACHED`.
10. Verify repository/runtime/config/data remain unchanged.
11. Report and stop.

Do not broaden to general index-health, all smart-add files, all missing confidence rows, or broad Lance reconciliation.

## Required result record

The final execution result must state at minimum:

- exact Stage Card path;
- exact Stage Card SHA256;
- exact Stage Card commit;
- exact repository HEAD;
- `MAX_EXECUTIONS` and consumed count;
- fixed source and R3 identity;
- prior Core-projection proof reused;
- exact propagation contract applicable to the fixed source;
- every candidate Core→Engine trigger found in the fixed interval;
- whether each trigger actually executed;
- whether each trigger covered the fixed source considering the 500-row cap;
- any source-traceable Engine confidence ID and timestamp;
- primary attribution;
- if applicable, every qualifying Lance trigger after Engine propagation;
- exact Lance version/ID evidence;
- secondary attribution or `LANCE_NOT_REACHED`;
- one concise limitation statement;
- at most one smallest next product decision, not implemented.

## Pass criteria

The stage may close `PASS` or `PASS_WITH_FINDINGS` only when:

1. Core→Engine obligation semantics are established from exact R3-era contract;
2. historical trigger execution/coverage is either proven or explicitly shown unproven without mutation;
3. one primary attribution follows directly from the evidence;
4. Lance is evaluated only if Engine propagation is cleared;
5. no current sync/backfill/checkpoint/repair/retrieval was executed;
6. product/runtime/config/data/index state remains unchanged.

If primary attribution cannot be selected without unsupported historical inference, use `INSUFFICIENT_EVIDENCE`.

If any stop condition occurs, use `STOPPED`.

## Stop conditions

Stop immediately if:

- any memory index/sync/backfill/checkpoint/orphan-repair command is accidentally started;
- any current retrieval or new OpenClaw prompt is proposed as historical evidence;
- historical evidence can only be obtained by mutating or replaying the system;
- the executor attempts to use post-incident Core ID `a990da16...` as pre-R3 identity proof;
- trigger coverage is assumed despite the 500-row cap;
- Core→Engine and Engine→Lance are collapsed into one attribution;
- scope expands to broad memory quality cleanup, all orphan confidence, all Lance reconciliation, Candidate-Builder, provider diagnostics, or retrieval tuning;
- a source/config/DB/index/runtime mutation becomes necessary;
- repository HEAD or Stage Card SHA differs from the authorized execution packet.

## Execution safety mechanics

Because an earlier Stage Card verification shell accidentally triggered command substitution, any later execution must use mechanically safe read-only commands.

Requirements:

- no shell backtick command substitution;
- no `eval`;
- no heredoc-generated script;
- no generated executable script;
- no command whose nominal purpose is sync/index/backfill/checkpoint/repair;
- use direct `DevSpace.read` for source inspection where practical;
- use `sqlite3 -readonly` only for DB inspection;
- use bounded `rg`, `find`, `stat`, `journalctl`, `git`, and read-only JSON tools for historical evidence;
- if Lance historical checkout is needed, use only read-view checkout APIs and restore the reader view before closeout;
- never print credential values; redact secret-bearing config fields at query construction time.

## Allowed mutations

Before separate commit authorization:

~~~text
this Stage Card Markdown file only
~~~

During separately authorized execution:

~~~text
no product/runtime/config/data/index mutation
~~~

A later executor may create bounded disposable analysis output only if necessary. A persistent final report may be written only if separately requested or explicitly included in the execution packet.

No source, config, Core DB, Engine DB, LanceDB, session, memory file, service, scheduler, install artifact, branch, tag, release, or remote state mutation is authorized.

## Stage outcomes

Use exactly one:

~~~text
PASS
PASS_WITH_FINDINGS
INSUFFICIENT_EVIDENCE
STOPPED
~~~

`PASS` or `PASS_WITH_FINDINGS` answers the propagation-obligation attribution only. It does not authorize a fix.

## Authorization boundary

This frozen Stage Card authorizes nothing by itself.

Commit requires separate explicit Sol authorization.

After commit, execution requires another separate explicit Sol authorization bound to:

- exact Stage Card path;
- exact SHA256;
- exact Stage Card commit;
- exact repository HEAD;
- fixed historical source and R3 identity;
- scope defined by this card;
- finite execution count, default `MAX_EXECUTIONS=1`.

Any change to Stage Card content, SHA, HEAD, scope, or execution count invalidates a prior execution packet.

After execution, report and stop. Do not create, commit, or execute a successor stage automatically.
