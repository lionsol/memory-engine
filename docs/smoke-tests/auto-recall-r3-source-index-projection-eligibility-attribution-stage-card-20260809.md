# AutoRecall R3 Source→Index Projection Eligibility Attribution Stage Card — Post-Incident Rewrite — 2026-08-09

> Status: `FROZEN` — not committed and authorizes no execution
>
> Repository HEAD before this rewritten card: `8c2a65421a0f427544930281002cfec8bbfb4ff1`
>
> This file supersedes the earlier uncommitted pre-incident version at the same path. The earlier design attempt was stopped after a verification-shell defect accidentally launched `openclaw memory index`; no valid execution packet existed for that earlier card. The incident is historical evidence only and must not be erased or treated as a successful attribution run.
>
> Sol has authorized rebuilding the post-incident evidence boundary and rewriting this Stage Card. That authorization does not create execution authority. Commit authorization and execution authorization remain separate. Any later execution must bind the exact committed card, exact repository HEAD, exact Stage Card SHA256, exact fixed scope, and a finite execution count. Default: `MAX_EXECUTIONS=1`.

## Decision

For the independently answer-bearing source:

~~~text
memory/smart-add/2026-07-31.md
~~~

determine, under the exact R3-era source/index contract and uncontaminated historical evidence, whether the answer-bearing content should have entered the OpenClaw Core retrieval index before the R3 natural AutoRecall turn.

Choose exactly one primary attribution when evidence is sufficient:

~~~text
SOURCE_NOT_CORE_INDEX_ELIGIBLE
CORE_INDEX_ELIGIBLE_NO_TRIGGER_OR_OBLIGATION_PROVEN
CORE_PROJECTION_EXPECTED_BUT_MISSING_BEFORE_R3
CORE_PROJECTED_BEFORE_R3
~~~

If preserved historical evidence cannot support exactly one attribution without using the 20:49 incident refresh as a proxy for historical state, close `INSUFFICIENT_EVIDENCE`.

A separate downstream status may be reported only after the primary Core attribution is established:

~~~text
DOWNSTREAM_LANCE_NOT_REACHED
DOWNSTREAM_LANCE_TRIGGER_UNPROVEN
DOWNSTREAM_LANCE_EXPECTED_BUT_MISSING
DOWNSTREAM_LANCE_PRESENT
DOWNSTREAM_LANCE_NOT_NEEDED_FOR_PRIMARY_ATTRIBUTION
~~~

The downstream status is a finding, not a fifth primary attribution.

## User value

The prior R3 first-loss attribution closed `INSUFFICIENT_EVIDENCE` because the correct answer was independently established in workspace memory, but no defensible answer-bearing managed candidate identity could be proven in the R3 retrieval candidate space.

The next product question is narrower: whether the answer-bearing smart-add source belonged in the Core retrieval index before R3, and whether preserved evidence proves a projection opportunity or obligation that should have put it there.

This distinction matters because:

1. a source may be path-eligible but never receive a required sync trigger;
2. a Core projection failure is earlier than FTS/vector/fusion/gate loss;
3. OpenClaw Core indexing and memory-engine Lance projection are separate boundaries and must not be conflated;
4. the 20:49 accidental reindex proves current capability only and cannot prove historical R3 presence.

No source/index/retrieval repair may be designed before this attribution closes.

## Fixed historical subject

Primary source:

~~~text
/home/lionsol/.openclaw/workspace/memory/smart-add/2026-07-31.md
~~~

Observed source-file identity before the incident:

~~~text
birth=2026-08-01 03:30:00 +0800
mtime=2026-08-01 03:30:00 +0800
~~~

Answer-bearing content includes the July 31 interaction that records:

~~~text
8月值班表已生成
duty-schedule-august-2026.md
~~~

Independent corroborating artifact:

~~~text
/home/lionsol/.openclaw/workspace/duty-schedule-august-2026.md
birth=2026-07-31 09:35:46 +0800
mtime=2026-07-31 09:37:22 +0800
~~~

The root-level duty-schedule file is corroborating answer evidence only. Do not assume the root-level file itself is covered by the memory index watch contract.

Fixed R3 retrieval identity:

~~~text
agentId=main
sessionId=ce1e425c-10f0-4393-8d76-75ec390dd58f
traceId=f283b4ef-45bd-42f7-99a0-1c088b980354
R3 events=191..195
Engine created_at event 191=2026-08-09 11:09:57
local equivalent≈2026-08-09 19:09:57 +0800
~~~

No other natural turn or source may replace this subject.

## Historical incident boundary

### Incident

During Stage Card verification at approximately `2026-08-09 20:49 +0800`, a shell command used for document checking contained backtick command substitution and accidentally launched:

~~~text
openclaw memory index
~~~

The spawned `openclaw-memory` process began at approximately `20:49:16 +0800`, wrote the agent-specific OpenClaw Core index, and later exited on its own. Sol's subsequent `kill -TERM` returned `No such process` because the process had already exited.

The pre-incident card flow was stopped immediately after the mutation was detected.

### Confirmed incident impact

Post-incident read-only closeout established:

- repository HEAD remained `8c2a65421a0f427544930281002cfec8bbfb4ff1`;
- memory-engine Engine DB remained at `35` confidence rows and `memory_events` max id `195`;
- memory-engine LanceDB did not receive a new version from the incident;
- the mutated object was the agent-specific OpenClaw Core DB:
  `~/.openclaw/agents/main/agent/openclaw-agent.sqlite`;
- post-incident Core integrity check returned `ok`;
- post-incident Core revision was observed as `120207`;
- the refreshed Core now contains `memory/smart-add/2026-07-31.md`, `memory/episodes/2026-07-31.md`, and an answer-bearing smart-add chunk;
- no rollback was performed.

### Post-incident answer-bearing Core chunk

The accidental refresh produced a current Core chunk:

~~~text
id=a990da16fd31ab1a5a569f4b599a02c848e811d2071e85356ef4da4c70667e29
path=memory/smart-add/2026-07-31.md
lines=80..108
~~~

whose text contains the August-duty-schedule generation record.

This chunk is **POST-INCIDENT CAPABILITY EVIDENCE ONLY**.

It may prove that the current OpenClaw memory-index implementation can project the fixed smart-add source into an answer-bearing Core chunk under the post-incident environment. It must not be used to prove:

- that this exact chunk ID existed before R3;
- that an equivalent Core chunk existed before R3;
- that R3 historical Core state contained the source;
- that a pre-R3 sync occurred;
- that memory-engine Lance should already have contained the same ID.

## Evidence authority tiers

### Tier A — admissible historical attribution evidence

Tier A may support the primary attribution directly:

1. preserved R3 Engine events `191..195`;
2. pre-incident source timestamps and source content;
3. exact Git/source contract applicable to R3, provided relevant contract files are proven unchanged across the required interval;
4. preserved pre-R3 scheduler/CLI/service/session logs that directly evidence a Core index sync trigger or completion;
5. pre-incident read-only observations captured before `20:49:16 +0800`, with their limitations stated;
6. memory-engine Lance version history and scalar-only historical views that predate the incident;
7. Engine confidence timestamps and identities that predate the incident.

### Tier B — post-incident capability evidence

Tier B may explain capability but may not prove R3 historical state:

- current agent Core `memory_index_*` rows after the 20:49 refresh;
- current answer-bearing Core chunk `a990da16...`;
- current source/index metadata and revision produced by the refresh;
- current Core FTS/vector presence derived from that refresh.

Tier B can support statements such as `source is projectable by the current Core indexer`, but not `source was projected before R3`.

### Tier C — explanatory implementation evidence

Current or historical source code may explain contracts and trigger semantics, but cannot replace runtime evidence that a historical trigger actually ran.

Use Tier C only to answer questions such as:

- which paths are watched;
- what operation performs Core projection;
- whether AutoRecall automatically invokes index sync;
- how Engine confidence backfill relates to Core chunks;
- how Lance orphan repair relates to Engine confidence rows.

## Frozen contract facts already established

Pre-rewrite inspection established the following structural facts, subject to exact R3-era Git verification during execution:

1. `INDEX_SYNC_WATCH_DIRS` includes:

~~~text
memory/smart-add
memory/episodes
~~~

2. `collectIndexedFiles()` scans Markdown files under those watch directories.
3. confidence backfill selects Core chunks under `memory/smart-add/%` and `memory/episodes/%`.
4. `syncIndexIfNeeded()` delegates Core projection to the shared OpenClaw memory manager, then backfills Engine confidence from resulting Core chunks.
5. AutoRecall/hybrid retrieval does **not** itself invoke `syncIndexIfNeeded()` before search.
6. memory-engine Lance population is a separate downstream mechanism. The checkpoint orphan-vector repair reads Engine `memory_confidence`, looks for missing IDs in Lance, reads corresponding Core chunk text, generates an embedding, and adds missing Lance rows.
7. the nightly checkpoint calls orphan-vector repair after nightly checkpoint generation, but the inspected checkpoint path does not itself establish that OpenClaw Core index sync runs immediately before orphan repair.

These structural facts do not prove that a qualifying historical sync actually occurred.

## Required projection model

Execution must reason about the following boundaries separately:

~~~text
workspace smart-add source
    ↓
OpenClaw Core source scan / memory index sync
    ↓
OpenClaw Core chunk + FTS/vector index
    ↓
memory-engine Engine confidence backfill
    ↓
memory-engine Lance orphan/vector projection
    ↓
R3 retrieval channels
~~~

Do not collapse these into a single `indexed/not indexed` boolean.

For the primary attribution, the decisive question is the earliest Core boundary. Downstream Lance status is secondary unless Core projection before R3 is proven.

## In scope

Only the following are in scope:

1. verify that the fixed smart-add source was path/class eligible for the R3-era OpenClaw Core index contract;
2. establish whether preserved evidence proves an actual or contractually required Core projection trigger after source availability (`2026-08-01 03:30 +0800`) and before R3 event `191` (`2026-08-09 19:09:57 +0800`);
3. determine whether Tier A evidence proves the source was or was not projected into Core before R3;
4. only if needed, classify the downstream Engine/Lance projection status without treating post-incident Core rows as historical candidates;
5. choose one primary attribution or close `INSUFFICIENT_EVIDENCE`;
6. identify at most one smallest next product decision without implementing it.

## Non-goals

Do not:

- run any memory-index command, including OpenClaw memory index, sync-memory-index, manager sync, syncIndexIfNeeded, checkpoint, confidence backfill, orphan repair, or repair command;
- run live or synthetic retrieval;
- submit a new OpenClaw prompt or replay the R3 question;
- enable AutoRecall or modify OpenClaw configuration;
- mutate Core DB, Engine DB, LanceDB, FTS, vector tables, KG, sessions, memory files, runtime installation, service state, or source;
- use the post-incident chunk `a990da16...` as an R3 historical candidate ID;
- compare current retrieval results with R3 as if they were point-in-time equivalents;
- rebuild, compact, optimize, vacuum, restore, delete, add, checkout-write, or repair any index;
- run commands embedded inside shell quoting, backticks, command substitution, eval, or generated scripts;
- reopen Candidate-Builder diagnosis;
- tune query shaping, FTS/vector/recent collection, fusion/ranking, thresholds, topK, Card/gate rules, capture, checkpoint, or provenance;
- design a source/index fix before attribution closes;
- commit, tag, push, create an OpenSpec change, or execute a successor stage without separate owner authorization.

## Safe execution mechanics

Because the previous design attempt was stopped by a shell-verification defect, execution mechanics are part of the gate:

- prefer direct file reads and SQLite readonly queries;
- shell commands must contain no backticks, command substitution, eval, heredocs, generated scripts, or index/sync command strings that could execute accidentally;
- use fixed literal paths and readonly flags where supported;
- Lance historical inspection may use read-only table version APIs only; restore the reader view to the original/latest version before closeout;
- if a requested verification cannot be expressed safely without risking an index or retrieval action, stop rather than improvise.

## Attribution rules

### `SOURCE_NOT_CORE_INDEX_ELIGIBLE`

Use only if the exact R3-era source/config contract proves that `memory/smart-add/2026-07-31.md` was outside the intended Core indexed source set.

Do not use this result merely because the source was absent from a mutable Core snapshot.

### `CORE_INDEX_ELIGIBLE_NO_TRIGGER_OR_OBLIGATION_PROVEN`

Use when:

1. the fixed smart-add source was Core-index eligible; and
2. preserved Tier A evidence does not prove an actual qualifying Core sync after source availability and before R3; and
3. the R3-era contract does not independently require such a sync to have occurred within that interval.

This result is **not an index defect finding**. It means source eligibility existed but historical projection opportunity/obligation remains unproven.

### `CORE_PROJECTION_EXPECTED_BUT_MISSING_BEFORE_R3`

Use only when all are proven from Tier A/Tier C evidence:

1. the source was Core-index eligible;
2. an actual qualifying Core sync occurred after source availability and before R3, or the exact R3 contract required one to have occurred;
3. that sync/obligation covered the fixed smart-add source;
4. admissible historical evidence shows no corresponding answer-bearing Core projection before R3.

Post-incident successful projection may be reported as a capability finding that strengthens the interpretation `the source is projectable`, but it cannot satisfy item 2 or item 4 by itself.

If selected, the earliest supported loss is source→Core projection/index availability. No retrieval tuning is authorized.

### `CORE_PROJECTED_BEFORE_R3`

Use only if Tier A evidence proves a defensible pre-R3 Core candidate identity or immutable pre-R3 Core/source-index record traceable to the fixed smart-add source.

The post-incident chunk `a990da16...` cannot satisfy this rule.

If selected, the Core boundary is cleared and downstream Engine/Lance status may become material.

## Downstream Lance rules

Only evaluate downstream status after the primary Core attribution is established.

### `DOWNSTREAM_LANCE_NOT_REACHED`

Use when Core projection is already proven missing, so downstream Lance projection cannot be the first boundary.

### `DOWNSTREAM_LANCE_TRIGGER_UNPROVEN`

Use when Core projection before R3 is proven, but preserved evidence does not prove an Engine-confidence/Lance projection trigger or obligation.

### `DOWNSTREAM_LANCE_EXPECTED_BUT_MISSING`

Use only when Core candidate presence, Engine-confidence eligibility, and a qualifying orphan/vector projection trigger or obligation are all proven before R3, while preserved Lance history shows the answer-bearing ID absent.

### `DOWNSTREAM_LANCE_PRESENT`

Use when a deterministic answer-bearing Lance row is proven in a pre-R3 historical Lance version.

### `DOWNSTREAM_LANCE_NOT_NEEDED_FOR_PRIMARY_ATTRIBUTION`

Use when the primary Core attribution already resolves the product question and a finer Lance determination would add scope without changing the next decision.

## Known uncontaminated historical findings

The prior bounded read-only attribution, completed before the 20:49 incident, established:

- R3 vector provenance contained four bounded IDs;
- all four bounded IDs uniquely expanded through Engine confidence to full managed IDs;
- exact Lance row reads showed all four R3 vector candidates were unrelated to the August duty schedule;
- memory-engine Lance versions `14..43` were available for historical scalar-only inspection;
- the final Lance version before R3 was version `43`;
- across historical Lance versions `14..43`, bounded text checks for the August-duty-schedule answer terms produced no answer-bearing row;
- R3 FTS/lexical candidate counts were zero and the only final candidate was unrelated;
- the unrelated final candidate was later rejected by the AutoRecall gate;
- these findings did not establish whether the smart-add source should have been projected into Core before R3.

These findings remain admissible because the later accidental OpenClaw Core refresh did not mutate Engine events or memory-engine Lance history.

## Historical-time rules

- Smart-add Core eligibility begins no earlier than observed source creation around `2026-08-01 03:30 +0800`.
- The root-level duty schedule proves the answer existed earlier but does not move the smart-add source availability time backward.
- The primary historical interval ends at R3 event `191`, approximately `2026-08-09 19:09:57 +0800`.
- The incident contamination boundary begins at approximately `2026-08-09 20:49:16 +0800`.
- Any Core row, revision, FTS/vector entry, source row, or candidate identity created or refreshed at/after the contamination boundary is Tier B capability evidence only.
- Evidence after R3 may prove a historical fact only when it contains an immutable record of an action that occurred before R3; current state alone is not enough.
- Do not infer `no historical Core projection` solely from pre-incident current absence unless trigger/timing evidence makes that inference defensible.

## Minimum evidence hierarchy

Use the minimum sufficient evidence, in this order:

1. exact committed Stage Card and authority preflight;
2. exact R3-era Git/source/config contract for Core path eligibility and trigger semantics;
3. immutable source creation/content evidence;
4. preserved scheduler/service/session/CLI records within the fixed historical interval;
5. pre-incident captured observations when available, clearly labeled as mutable-state observations;
6. Engine confidence timestamps and IDs;
7. pre-incident Lance historical versions and scalar-only rows;
8. post-incident Core only as Tier B capability evidence.

Do not run a current sync or retrieval to fill any historical gap.

## Required result record

The final report must state at minimum:

- exact Stage Card path, SHA256, commit, repository HEAD, and `MAX_EXECUTIONS`;
- incident contamination boundary;
- fixed source identity and source-availability time;
- fixed R3 trace/time identity;
- exact R3-era Core watch/index eligibility contract;
- exact R3-era Core projection trigger semantics;
- every qualifying pre-R3 projection trigger/obligation found, with timestamp and evidence source;
- whether each trigger is direct evidence, contractual obligation, or merely possible;
- primary attribution;
- downstream Lance status only if needed;
- explicit treatment of post-incident chunk `a990da16...` as capability-only evidence;
- one concise limitation statement;
- at most one smallest next product decision, not implemented;
- closeout proof that no index/retrieval/config/runtime/data mutation occurred during execution.

## Pass criteria

1. Source Core-index eligibility is established from the exact R3-era contract.
2. Projection trigger/obligation is directly evidenced or explicitly classified unproven.
3. Post-incident Core state is not used as historical R3 state.
4. One primary attribution follows from admissible evidence without live sync/retrieval or mutation.
5. Any downstream Lance finding respects the separate Core→Engine→Lance boundary.
6. Repository, runtime, config, DBs, indexes, sessions, and memory remain unchanged during execution.

If criteria 1–4 cannot support exactly one primary attribution, use `INSUFFICIENT_EVIDENCE`. If a stop condition is hit, use `STOPPED`.

## Stop conditions

Stop immediately if:

- any index/sync/backfill/checkpoint/repair command is proposed or accidentally starts;
- any Core/Engine/Lance/FTS/vector write is detected;
- a new prompt, live retrieval, synthetic query, or retrieval replay is proposed;
- the post-incident Core answer chunk is used as proof of pre-R3 candidate presence;
- historical trigger evidence is missing and a current execution is proposed to recreate it;
- a shell verification requires command substitution, backticks, eval, heredoc, generated script, or another unsafe construction;
- scope expands into broad memory-index coverage, Candidate-Builder, provider timeout, rollout, or another subsystem;
- a product fix is proposed before attribution closes;
- repository HEAD or Stage Card identity drifts from the execution packet.

## Allowed mutations

Before separate commit authorization:

- this rewritten Markdown Stage Card only.

During separately authorized execution:

- no product/runtime/config/data/index/session/memory mutation;
- bounded disposable analysis output only;
- if explicitly authorized, a redacted report may be written to:

~~~text
reports/auto-recall-r3-source-index-projection-eligibility-attribution/final-report.md
~~~

No source file, OpenClaw config, Core DB, Engine DB, LanceDB, FTS/vector index, session, memory file, service state, installation artifact, branch, tag, or release mutation is allowed.

## Stage outcomes

Use exactly one:

~~~text
PASS
PASS_WITH_FINDINGS
INSUFFICIENT_EVIDENCE
STOPPED
~~~

A `PASS` means the bounded source→Core projection attribution was answered. It does not mean a defect exists and does not authorize a repair.

## Authorization boundary

This frozen card authorizes nothing by itself.

After Sol separately authorizes commit, commit only this exact Stage Card unless Sol explicitly expands the commit scope.

Any later execution must be separately authorized by Sol and bind:

- exact committed Stage Card path;
- exact Stage Card SHA256;
- exact Stage Card commit;
- exact repository HEAD;
- fixed source and historical time window;
- post-incident contamination boundary;
- bounded read-only scope defined here;
- `MAX_EXECUTIONS=1` unless Sol explicitly chooses another finite count.

Any change to the card, HEAD, scope, contamination boundary, or consumed execution count invalidates the prior execution packet.

After execution, report and stop. Do not create, execute, or authorize a successor stage automatically.
