# memory-engine Benchmark v1

> Status: `B1 LONGMEMEVAL DATASET ADAPTER IMPLEMENTED / OFFLINE ONLY`
>
> Benchmark v1 is an evaluation harness, not a production runtime mode. It must
> not write the active OpenClaw Core database, memory-engine Engine database,
> live LanceDB, user memory files, configuration, or disclosure authority state.

## Goal

Provide a repeatable, version-comparable measurement surface for memory-engine
that is independent of the project's development fixtures.

Benchmark v1 separates three evidence tiers:

1. **Tier 1 — Internal regression**: existing frozen fixtures and holdouts remain
   regression/safety evidence. They are not treated as independent external
   quality evidence after they have influenced implementation decisions.
2. **Tier 2 — Public offline benchmark**: LongMemEval is the first external
   dataset. LoCoMo may be added after the LongMemEval path is stable.
3. **Tier 3 — External controlled evaluation**: Agent Memory Leaderboard (AML)
   is a later Add/Search compatibility target. Formal AML scores remain governed
   by AML's own evaluation contract.

## B1 — LongMemEval dataset adapter

Implemented by:

- `lib/benchmark/longmemeval-v1.js`
- `bin/benchmark-longmemeval-v1.js`
- `test/benchmark-longmemeval-v1.test.js`

The adapter accepts the public LongMemEval JSON shape and produces a normalized
case with:

- question id and normalized capability type;
- question text and question date;
- timestamped history sessions and turns;
- evidence-session ids and turn-level evidence labels kept as evaluator-only
  metadata;
- explicit abstention classification for `_abs` cases.

It also emits two neutral envelopes that can later be consumed by an isolated
memory adapter:

- per-session **Add** envelopes with stable user/session/source identities;
- one **Search** envelope containing only the query, scope, date, and `top_k`.

Gold answers and evidence ids are never copied into the Search envelope.

### Retrieval metrics

B1 defines deterministic session-level metrics from retrieved source-session
identities. For upstream compatibility it implements LongMemEval-style
`recall_any@k`, `recall_all@k`, and `ndcg_any@k` at the standard
`k={1,3,5,10,30,50}` cutoffs. It also keeps fractional session recall,
session precision, any/all evidence hit, and first-evidence reciprocal rank as
memory-engine diagnostics.

Abstention cases remain explicitly marked and must not be silently mixed into a
retrieval aggregate. Any future aggregate report must state its inclusion/
exclusion policy and benchmark variant.

QA answer correctness is deliberately not implemented in B1. LongMemEval's
official answer evaluator may be used later on hypotheses produced under a
separately frozen answering-model contract.

## CLI

Validate and summarize a downloaded LongMemEval dataset without writing any
memory-engine runtime data:

```bash
node bin/benchmark-longmemeval-v1.js --input /path/to/longmemeval_s_cleaned.json
```

Machine-readable output:

```bash
node bin/benchmark-longmemeval-v1.js --input /path/to/longmemeval_s_cleaned.json --json
```

The CLI reports case/session/turn/evidence counts and normalized question-type
composition. It does not run retrieval yet.

## Dataset provenance

LongMemEval is maintained at `xiaowu0162/LongMemEval`. The public benchmark
contains 500 questions and covers information extraction, multi-session
reasoning, knowledge updates, temporal reasoning, and abstention. Benchmark v1
must record the exact input-file SHA-256 for every scored run; dataset contents
must not be vendored into this repository by default.

## Next implementation boundary — B2

B2 should add an **isolated temporary memory-engine data plane** that:

1. converts B1 Add envelopes into benchmark-only Core/Engine/index state;
2. reuses production retrieval semantics rather than a benchmark-specific
   ranking heuristic;
3. maps retrieved memory ids back to source session ids for B1 metrics.

B2 must use temporary benchmark-owned paths and must not reuse the active
`~/.openclaw/memory/main.sqlite`, Engine DB, LanceDB, smart-add files, or active
OpenClaw Gateway runtime.

The first B2 score should report retrieval metrics only. Answer-generation and
LLM-judge quality are a separate measurement layer so retrieval changes are not
confounded with answering-model changes.

## Later compatibility target — AML

AML's public protocol assigns the participant only two operations: Add and
Search; the platform controls answer generation and scoring. B1's neutral
Add/Search envelopes intentionally preserve that separation so a later AML
adapter can reuse the same memory-system boundary without changing core
benchmark semantics.
