# memory-engine RH-L3 Parallel Execution Qualification Contract v1

Status: `DESIGN REVIEW / RUNTIME NOT AUTHORIZED`

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

Input is a frozen synthetic expansion fixture.

Example:

```json
{
  "query": "CedarIndex design decision",
  "expansions": [
    "CedarIndex rationale",
    "CedarIndex limitations"
  ]
}
```

Required invariants:

- original query is preserved;
- expansion count is bounded;
- empty expansion is rejected;
- duplicate expansion is rejected;
- total query length remains within runtime bounds.

Acceptance evidence:

```
expansion_plan.valid=true
original_query_count=1
expansion_query_count=2
total_query_count=3
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

The previous RH-L2-C2 transaction is consumed evidence and cannot be replayed.
