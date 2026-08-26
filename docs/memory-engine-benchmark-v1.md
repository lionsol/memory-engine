# memory-engine Benchmark v1

> Status: `B2 LONGMEMEVAL ISOLATED RETRIEVAL RUNNER IMPLEMENTED / OFFLINE ONLY`
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

## B2 — isolated LongMemEval retrieval runner

Implemented by:

- `lib/benchmark/longmemeval-retrieval-runner-v1.js`
- `bin/run-longmemeval-retrieval-v1.js`
- `test/benchmark-longmemeval-retrieval-runner-v1.test.js`

The first retrieval profile is `production_hybrid_lexical_session_v1`. For each
non-abstention question it creates a fresh temporary Core SQLite database, a
fresh temporary Engine SQLite database, and a benchmark-only FTS index, then
calls the production `hybridSearch()` implementation through its isolated DB
boundary. No active OpenClaw or memory-engine path is reused.

For comparability with LongMemEval's built-in session-granularity retrieval,
each indexed document is one history session containing the concatenated user
turns only. The original session timestamp is retained as ranking metadata by
mapping its offset from `question_date` onto the benchmark run clock. Lifecycle
confidence is neutral and equal across sessions so B2 measures retrieval and
ranking rather than memory-decay policy.

B2 deliberately does **not** fabricate a semantic embedding backend. Vector is
represented by a deterministic empty backend; the profile therefore measures
memory-engine's production lexical/fusion/canonical-result path, not full hybrid
semantic quality. A real embedding profile is a later benchmark step and must
be reported under a different profile identity.

LongMemEval's `_abs` questions are skipped from retrieval aggregates, matching
the official retrieval evaluation policy. Standard metrics above the actual
retrieval depth are reported as `null`, never silently copied from a shallower
cutoff.

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

The validation CLI reports case/session/turn/evidence counts and normalized
question-type composition.

Run the B2 isolated retrieval profile:

```bash
node bin/run-longmemeval-retrieval-v1.js \
  --input /path/to/longmemeval_s_cleaned.json \
  --top-k 50 \
  --output /tmp/memory-engine-longmemeval-s-v1.json
```

A bounded smoke can use `--limit N`. Without `--json`, stdout contains dataset
provenance, run parameters, and the aggregate summary; `--output` stores the
full per-case result. Every file-backed run records the input filename and
SHA-256.

## Dataset provenance

LongMemEval is maintained at `xiaowu0162/LongMemEval`. The public benchmark
contains 500 questions and covers information extraction, multi-session
reasoning, knowledge updates, temporal reasoning, and abstention. Benchmark v1
must record the exact input-file SHA-256 for every scored run; dataset contents
must not be vendored into this repository by default.

## Next benchmark boundary — first scored LongMemEval run

B2 source is implemented, but no official LongMemEval score is claimed until a
released cleaned dataset file is supplied and its exact SHA-256 is recorded.
The first scored run should use `longmemeval_s_cleaned.json`, `top_k=50`, and
this B2 profile. `longmemeval_oracle.json` is not a retrieval-quality benchmark
because it contains only evidence sessions; LongMemEval_M is a later scale run.

After the lexical session baseline is recorded, the next source decision is whether
to add a **real semantic/vector profile** using memory-engine's actual embedding
backend. It must have a distinct profile identity so lexical-only and full-hybrid
scores are never conflated.

Answer-generation and LLM-judge quality remain a separate measurement layer so
retrieval changes are not confounded with answering-model changes.

## Later compatibility target — AML

AML's public protocol assigns the participant only two operations: Add and
Search; the platform controls answer generation and scoring. B1's neutral
Add/Search envelopes intentionally preserve that separation so a later AML
adapter can reuse the same memory-system boundary without changing core
benchmark semantics.
