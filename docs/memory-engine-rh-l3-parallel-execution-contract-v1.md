# memory-engine RH-L3 Parallel Execution Qualification Contract v1

Status: `RH-L3-A SOURCE QUALIFIED / RH-L3-B LOCAL PARALLEL EXECUTION QUALIFIED / RH-L3-C NOT STARTED / RUNTIME NOT AUTHORIZED`

## 1. Purpose

RH-L3 separates parallel vector execution qualification from Recall Hint generation qualification.

RH-L2 established:

- trusted OpenClaw tool-factory context binding is real-host verified;
- Recall Hint provider execution can run inside an exact-session canary;
- live Hint generation may legally return `empty_hint`.

RH-L3 does not evaluate whether an LLM generates useful Hint expansions. It evaluates whether memory-engine correctly executes a valid bounded expansion plan.

## 2. Scope

RH-L3 verifies:

```
Expansion Contract
        |
        v
Parallel Vector Executor
        |
        v
Fusion / Ranking / Projection
```

RH-L3 does not authorize:

- AutoRecall enablement;
- default explicit-search changes;
- production behavior changes;
- live memory mutation;
- provider quality claims.

## 3. RH-L3-A Expansion Contract

Input is a frozen synthetic canonical-planner fixture. RH-L3-A does not introduce a second planner; it calls the production `buildRecallHintVectorQueryPlan` implementation and verifies its output against a frozen identity.

Canonical fixture:

```json
{
  "fixture_id": "rh-l3-a-cedarindex-v1",
  "query": "CedarIndex design decision",
  "hint": {
    "version": "recall_hint_v1",
    "project": "CedarIndex",
    "entities": ["CedarIndex"],
    "query_facets": ["rationale", "limitations"]
  }
}
```

Frozen planner output:

```text
Q0 = CedarIndex design decision
Q1 = CedarIndex design decision rationale project:CedarIndex entities:CedarIndex
Q2 = CedarIndex design decision limitations project:CedarIndex entities:CedarIndex
```

Required invariants:

- original query is preserved separately from expansion queries;
- original query is bounded to 240 code points for RH-L3 qualification;
- expansion count is 1..2, canonical fixture count is exactly 2;
- each expansion is bounded to the production 512-code-point limit;
- empty expansion is rejected;
- duplicate expansion or duplicate original/expansion identity is rejected;
- canonical exact expansion identity is frozen.

Acceptance evidence:

```
expansion_plan.valid=true
original_query_count=1
expansion_query_count=2
total_query_count=3
provider_requests=0
```

## 4. RH-L3-B Parallel Vector Execution

The qualification target is execution, not configuration.

A PASS requires real fan-out:

```
Q0 original
Q1 expansion-1
Q2 expansion-2
```

Evidence contract:

```json
{
  "vector_execution_mode": "parallel",
  "queries_submitted": 3,
  "queries_completed": 3,
  "parallel_execution": true
}
```

Required evidence:

- query identifiers;
- submission count;
- completion count;
- vector execution mode;
- fusion input count.

## 5. RH-L3-C Fusion Qualification

Verify that parallel retrieval results correctly enter:

```
Hybrid Fusion
      |
      v
Ranking
      |
      v
Canonical Projection
```

Failure cases:

- expansion result dropped;
- duplicate collapse corruption;
- original query overwritten;
- internal execution metadata exposed through user projection.

## 6. Execution Layers

### Layer 1: Source Unit

No provider and no live runtime.

Validates expansion planning and parallel planner contracts.

### Layer 2: Local Integration

Temporary benchmark state only:

- temporary DB;
- temporary vector/cache state;
- controlled backend.

Validates deterministic fan-out and merge.

### Layer 3: Real Host Qualification

Separate authorization required.

Validates OpenClaw runtime execution only.

## 7. Authorization Boundary

RH-L3 design approval does not authorize:

- deployment;
- config mutation;
- provider egress;
- live DB/LanceDB mutation;
- push/tag.

A runtime qualification requires a separate Owner authorization packet.

## 8. Relationship to RH-L2

RH-L2 conclusion:

```
trusted context        PASS
provider execution     PASS
parallel execution     NOT QUALIFIED
```

RH-L3 exists because these are independent properties.

The RH-L2-C2 transaction is consumed evidence and cannot be replayed. Its final observation (`memory_events.id=620`) was exact-session admitted but returned `empty_hint`, `expansion_count=0`, and no `vector_query_execution`; it therefore remains `STOPPED / NO PARALLEL EVIDENCE`.

## 9. RH-L3-A source qualification result

RH-L3-A was implemented as a benchmark/source contract only. No production planner, runtime config, provider adapter, live DB or live LanceDB behavior was changed.

Qualified source:

```text
7b2f9338d4e55ce8809ab598054720c70f7e5b7d
```

Clean-source CLI result:

```text
status = PASS
mode = RH_L3_A_EXPANSION_CONTRACT_QUALIFICATION
worktree_clean = true
provider_requests = 0

contract_sha256 =
58ef649fa303ddff5c79be0e0c9c6bb4e9b454b0698c7cd10f3e587bbc6f17f2

execution_binding_sha256 =
ae80f15735b9c9f8b6541061af4b69646f01113879adb28d1f1e76164e331226

fixture_sha256 =
346efb8983d46d27fe1b9a538b25d2fc2315c275e3bdc2573173de61efe7e0d4

plan_sha256 =
49f37a0054636c6dfce26c95929115615038f25e91702621f3e2700d5baa2462

result_sha256 =
f5e2d878fb5323af9fa2a857e7188eca360a2e5ac12a6efa1cc37644dc33d242
```

Focused RH-L3-A / Recall Hint / Hybrid / RH-L1 regression passed `50/50`; static check passed `819` files; test-integrity scanned `369` files with `0` invalid; strict OpenSpec passed `12/12`; `git diff --check` passed. CodeGraph found one directly affected test file and a five-symbol impact cone around the new contract builder; code-review-graph reported `0` affected stored flows, `0` test gaps and risk `0.00`.

RH-L3-A is therefore **SOURCE QUALIFIED**.

## 10. RH-L3-B local parallel vector execution result

RH-L3-B reuses the exact RH-L3-A fixture and plan identities and drives the production `collectVectorCandidates` path with `recallHintVectorExecutionMode=parallel` against a controlled local embedding/vector backend. No provider, live runtime, live DB or live LanceDB is involved.

The controlled backend uses a three-party barrier at both embedding and vector-search stages. A sequential executor would block at the first barrier and fail; PASS therefore requires structural sibling overlap rather than timing-based inference.

Qualified source:

```text
e4400ade955960d006367b5108f6b0da1377819e
```

Clean-source CLI result:

```text
status = PASS
mode = RH_L3_B_LOCAL_PARALLEL_VECTOR_EXECUTION
worktree_clean = true
provider_requests = 0

contract_sha256 =
dcb9f45fce0761a49c2e62bcf2fb83ea030a6982ec54c5f5179868b082c7b22b

execution_binding_sha256 =
4ec698a554608d3951c615165a8a372ba82576b33f8ada709a32b083a914ea3f

upstream_fixture_sha256 =
346efb8983d46d27fe1b9a538b25d2fc2315c275e3bdc2573173de61efe7e0d4

upstream_plan_sha256 =
49f37a0054636c6dfce26c95929115615038f25e91702621f3e2700d5baa2462

result_sha256 =
c8666d9bb2e455f37376f2a904a60923d6f02423624808eb51d011d78cc15ff5
```

Execution evidence:

```text
vector_execution_mode = parallel
queries_submitted = 3
queries_completed = 3
embedding_submitted/completed = 3/3
search_submitted/completed = 3/3
max_active_embeddings = 3
max_active_searches = 3
fusion_input_query_count = 3
fusion_input_candidate_counts = [2,2,2]
raw_row_count = 6
unique_candidate_count = 4
fused_candidate_ids =
  shared
  original-only
  rationale-only
  limitations-only
```

This qualifies local parallel fan-out and complete vector-level fusion input on the frozen plan. It does not yet qualify full Hybrid Fusion -> Ranking -> Canonical Projection behavior; that is RH-L3-C.

Focused RH-L3/Recall Hint/Hybrid/RH-L1 regression passed `53/53`; static check passed `821` files; test-integrity scanned `370` files with `0` invalid; strict OpenSpec passed `12/12`; `git diff --check` passed. CodeGraph found one directly affected test file and a five-symbol impact cone around the execution runner; code-review-graph reported `0` affected stored flows, `0` test gaps and risk `0.00`.

Live state remains unchanged: the installed extension is still `bd4b177...`, `recallHintRuntimeCanary` is absent, and RH-L3-B is not deployed.

RH-L3-C local fusion/ranking/projection qualification is the next boundary. Real-host runtime qualification remains separately authorized.
