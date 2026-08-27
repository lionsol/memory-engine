# memory-engine Benchmark v1

> Status: `B4 PASS_WITH_FINDINGS / OFFLINE BASELINE RECORDED / BASELINE FROZEN / CLOSED`
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
each indexed document is one history-session corpus occurrence containing the
user-side turn contents joined with spaces, matching upstream `process_item_flat_index()`.
Official empty-string turn contents are valid and contribute no tokens. Duplicate
source session ids remain distinct corpus occurrences and may occupy distinct
ranking positions; benchmark chunk identity therefore includes the occurrence
index while evaluation maps each result back to its original source session id.
The original session timestamp is retained as ranking metadata by mapping its
offset from `question_date` onto the benchmark run clock. Lifecycle confidence
is neutral and equal across sessions so B2 measures retrieval and ranking rather
than memory-decay policy.

B2 deliberately does **not** fabricate a semantic embedding backend. Vector is
represented by a deterministic empty backend; the profile therefore measures
memory-engine's production lexical/fusion/canonical-result path, not full hybrid
semantic quality. A real embedding profile is a later benchmark step and must
be reported under a different profile identity.

The aggregate follows LongMemEval's official retrieval exclusions: `_abs`
questions are skipped first, and non-abstention instances with no user-side
`has_answer=true` target are also skipped. Standard metrics above the actual
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

## B3 — first official LongMemEval-S lexical baseline

B3 is `PASS_WITH_FINDINGS / OFFLINE BASELINE RECORDED` on the released cleaned
LongMemEval-S file with SHA-256
`d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`,
`top_k=50`, and profile `production_hybrid_lexical_session_v1`.

The validated file contains 500 cases, 23,867 session occurrences, 246,750 turns,
and 948 evidence-session labels. There are 30 abstention cases and 72 cases with
no user-side retrieval target; because 21 overlap, the official aggregate scores
419 cases and skips 81 (`30` abstention first, then `51` additional no-user-target).

Overall retrieval baseline:

| Metric | @1 | @5 | @10 | @50 |
| --- | ---: | ---: | ---: | ---: |
| Recall-any | 0.5107 | 0.7876 | 0.9045 | 0.9952 |
| Recall-all | 0.1289 | 0.4821 | 0.6372 | 0.9761 |
| NDCG-any | 0.5107 | 0.5755 | 0.6256 | 0.6778 |

Mean production-`hybridSearch()` latency inside the benchmark data plane was
9.49 ms over the 419 scored cases, with a mean 47.57 session occurrences per
case. This is an offline lexical/fusion baseline, not a full semantic Hybrid
score; the empty vector backend produced no semantic candidates.

Question-family findings are asymmetric. `knowledge-update` is strongest
(`recall_any@1=0.8056`, `ndcg_any@10=0.8191`), while
`single-session-preference` is weakest (`recall_any@1=0.1000`,
`ndcg_any@10=0.3457`). Multi-session and temporal cases show high any-evidence
recall by @10 (`0.9174` and `0.8976`) but materially lower all-evidence recall
(`0.4628` and `0.5276`), identifying multi-evidence coverage as a major lexical
baseline limitation.

The full per-case output is intentionally not vendored. Its recorded output
SHA-256 is `c6ee9d9dc5cd366e4e19673f9b2d55603e8fbdb04634f3f918257bf00d97ca27`.
`longmemeval_oracle.json` remains unsuitable as a retrieval-quality baseline
because it contains only evidence sessions; LongMemEval-M remains a later scale
run.

## B4 — real semantic/vector profile and final adjudication

B4-S2 execution is `PASS`. The final quality adjudication is
`PASS_WITH_FINDINGS`, and the final state is
`OFFLINE BASELINE RECORDED / BASELINE FROZEN / CLOSED`. The semantic
interpretation is `USEFUL BUT INSUFFICIENT`: the semantic channel improves
retrieval evidence overall, but does not establish production or runtime
qualification and does not resolve the preference or multi-evidence coverage
gaps.

### B4 provenance

| Field | Recorded value |
| --- | --- |
| Profile | `production_hybrid_semantic_session_v1` |
| Source commit | `b640c3547622a646d8962e27b20f0d5ac5a13cc1` |
| Dataset SHA-256 | `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442` |
| Provider / model | `SiliconFlow` / `Qwen/Qwen3-Embedding-4B` |
| Model revision | `unavailable/unpinned` |
| Embedding dimension | `2560` |
| Canonical projection | `v1` / `2000` chars |
| `top_k` | `50` |
| `lexicalConfidenceThreshold` | `0.7` |
| Cases | `500` total / `419` scored / `81` skipped |
| Output SHA-256 | `de62cf40fe21485bf99a4f17129efa6097938a29ace8e88b78b2c2ca90c86cb8` |
| Final cache SHA-256 | `c1b8f292e8e2b95581f09b4526e2ce4c38517c9cfc1b93e0ffbde4b261319db2` |

The output and SQLite embedding cache remain in temporary paths outside the
repository and are not repository authority. Long-term authority is the
dataset SHA-256, profile identity, source commit, committed metrics, and this
adjudication record. The full output JSON, SQLite cache, dataset, and temporary
logs are intentionally not vendored.

Official exclusions skipped 30 `official_retrieval_abstention` cases and 51
`official_retrieval_no_user_target` cases. B4 recorded 16,319 provider calls
and 4,033 cache hits, with 419 vector attempts, zero vector skips, and zero
vector errors. Corpus build latency was 3,056,787.49 ms. Every scored case
used `lancedb` at `lancedb_search`, entered fusion, and was not vector-skipped.

### B3 → B4 overall comparison

| Metric | B3 lexical | B4 semantic | Delta |
| --- | ---: | ---: | ---: |
| Recall-any@1 | 0.5107 | 0.5465 | +0.0358 |
| Recall-any@5 | 0.7876 | 0.8138 | +0.0263 |
| Recall-any@10 | 0.9045 | 0.9189 | +0.0143 |
| Recall-all@5 | 0.4821 | 0.5227 | +0.0406 |
| Recall-all@10 | 0.6372 | 0.6826 | +0.0453 |
| NDCG-any@10 | 0.6256 | 0.6552 | +0.0297 |
| Mean retrieval latency | 9.49 ms | 205.11 ms | +195.62 ms / 21.61× |

B4 additionally recorded Recall-any@50 `1.0000`, Recall-all@50 `0.9976`,
and NDCG-any@50 `0.7029`. Case-level comparison across first relevant rank,
Recall-any@5, and Recall-all@10 was `85` improved, `8` regressed, and `326`
unchanged (`419` scored cases; no mixed cases).

### Family findings

- **`single-session-preference`** (`30` cases): Any@5 `0.4000 → 0.4667`
  (`+0.0667`), Any@10 `0.5667 → 0.5667` (`+0.0000`), and NDCG@10
  `0.3457 → 0.3678` (`+0.0221`). First relevant rank was improved in 8
  cases and regressed in 1. This improves ordering inside the top ten but
  does not improve top-ten coverage.
- **`multi-session`** (`121` cases): All@5 improved by `+0.0083`, and All@10
  `0.4628 → 0.4793` (`+0.0165`). First relevant rank improved in 19 cases
  and regressed in 0; only 2 cases newly found all evidence by @10. Ranking
  improves more clearly than multi-evidence coverage.
- **`temporal-reasoning`** (`127` cases): All@5 improved by `+0.0472`, and
  All@10 `0.5276 → 0.6220` (`+0.0945`). First relevant rank improved in 38
  cases and regressed in 6; All@10 improved in 13 and regressed in 1. This
  is the clearest semantic-channel coverage gain.
- **`knowledge-update`** (`72` cases): Any@1 `0.8056 → 0.8472` and NDCG@10
  `0.8191 → 0.8658`.

Across the scored cases, first relevant rank was improved in `73` cases,
regressed in `8`, and unchanged in `338`; Recall-any@5 improved in `12` and
regressed in `1`; Recall-all@10 improved in `20` and regressed in `1`. The
combined strict-dominance result is `85 / 8 / 326` improved/regressed/
unchanged.

### Next benchmark boundary and route branching

`B5 LoCoMo = LATER / NOT STARTED`. The next decision boundary is
`retrieval architecture hypothesis review`, not production tuning. Candidate
directions only (none is an accepted implementation) are:

- query decomposition;
- multi-query retrieval;
- temporal query expansion;
- Recall Hint;
- entity expansion;
- iterative/multi-hop retrieval.

Do not directly start LTR. Do not modify production lexical heuristics from
LongMemEval results. Any proposal designed from B4 failures makes subsequent
LongMemEval results development/regression evidence only; product policy still
requires LoCoMo or other cross-dataset evidence. Benchmark evidence is not
production authority, and B5 does not authorize production tuning.

Answer-generation and LLM-judge quality remain a separate measurement layer so
retrieval changes are not confounded with answering-model changes.

## Later compatibility target — AML

AML's public protocol assigns the participant only two operations: Add and
Search; the platform controls answer generation and scoring. B1's neutral
Add/Search envelopes intentionally preserve that separation so a later AML
adapter can reuse the same memory-system boundary without changing core
benchmark semantics.
