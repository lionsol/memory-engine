# memory-engine Benchmark v1

> Status: `H2 INSUFFICIENT / FULL EVALUATION NOT COMPLETED / PLANNER CONTRACT NOT DATASET-ROBUST / OFFLINE EXPERIMENT RECORDED / CLOSED`
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

## RH1 — query-side embedding instruction profile

RH1-S2 execution is `PASS`. The hypothesis adjudication is `INSUFFICIENT`, and
the final state is `OFFLINE EXPERIMENT RECORDED / CLOSED`. The independent
profile `production_hybrid_semantic_query_instruction_session_v1` changed only
the vector query embedding input: the fixed instruction was prepended to the
exact production vector query input. Corpus/document embedding, lexical/FTS/KG/
recent query inputs, production `hybridSearch()` fusion, and the frozen B3/B4
contracts remained unchanged.

### RH1 provenance and execution invariants

| Field | Recorded value |
| --- | --- |
| Profile | `production_hybrid_semantic_query_instruction_session_v1` |
| Source commit | `d2d2fbd7e8eba77cd416923f44815e1289d4d7df` |
| Dataset SHA-256 | `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442` |
| Provider / model | `SiliconFlow` / `Qwen/Qwen3-Embedding-4B` |
| Model revision | `unavailable/unpinned` |
| Embedding dimension | `2560` |
| Canonical projection | `v1` / `2000` chars |
| `top_k` / `lexicalConfidenceThreshold` | `50` / `0.7` |
| Instruction version | `query_embedding_instruction_v1` |
| Instruction text | `Instruct: Given a memory retrieval query, retrieve relevant past conversation passages that provide the context needed to answer the query` |
| Instruction SHA-256 | `e3440313f1178547f222be0bae9e1071cfdabaad86188f8c6af6e94f7b049f41` |
| Formatting contract | `query_embedding_input = query_instruction_text + LF + "Query:" + exact production vector query input received by generateEmbedding; no trailing LF` |
| Document instruction | `none` |
| Cases | `500` total / `419` scored / `81` skipped |
| Output SHA-256 | `fd102cf0983d0189855496111059158a04db1a7010b8d4f7dbce9294effc3fd6` |
| Final cache SHA-256 | `ba721b841e3ab71eebba9191e939fab1d23c7f56f74822d8e68c6e4c63e365f6` |

The official exclusions remained `30` `official_retrieval_abstention` cases
and `51` `official_retrieval_no_user_target` cases. RH1 recorded `19,933`
corpus embeddings and `419` query embeddings, `418` provider calls and
`19,934` cache hits (`20,352` total embedding operations), and vector
attempted/skipped/error counts of `419/0/0`. Every scored case used LanceDB
`lancedb_search`, entered fusion, and was not vector-skipped. The RH1-owned
SQLite cache ended with `16,792` entries: the frozen B4 cache's `16,373`
entries plus `419` instruction-formatted query embeddings.

The output JSON and SQLite cache remain in a temporary directory outside the
repository and are not vendored. Long-term authority is the dataset SHA-256,
profile identity, source commit, committed metrics, and this adjudication; the
temporary artifacts are not repository authority.

### B4 → RH1 overall comparison

| Metric | B4 semantic | RH1 query-instruction | Delta |
| --- | ---: | ---: | ---: |
| Recall-any@1 | 0.5465 | 0.5489 | +0.0024 |
| Recall-any@5 | 0.8138 | 0.8234 | +0.0095 |
| Recall-any@10 | 0.9189 | 0.9260 | +0.0072 |
| Recall-any@50 | 1.0000 | 1.0000 | +0.0000 |
| Recall-all@5 | 0.5227 | 0.5298 | +0.0072 |
| Recall-all@10 | 0.6826 | 0.6897 | +0.0072 |
| Recall-all@50 | 0.9976 | 0.9976 | +0.0000 |
| NDCG-any@10 | 0.6552 | 0.6625 | +0.0073 |
| NDCG-any@50 | 0.7029 | 0.7084 | +0.0055 |
| Mean retrieval latency | 205.1074 ms | 270.0795 ms | +64.9720 ms / 1.3168× |

The primary Recall-any@5 delta is `+0.0095`, below the pre-frozen overall
threshold of `+0.0100`; therefore RH1 is `INSUFFICIENT`. The direction is
small and positive overall, but it is not a production-quality or production
policy result.

### RH1 family findings

- **`single-session-preference`** (`30` cases): Any@5 `0.4667 → 0.4333`
  (`-0.0333`), Any@10 `0.5667 → 0.5667` (`+0.0000`), and NDCG@10
  `0.3678 → 0.3640` (`-0.0038`). First relevant rank improved in 2 cases
  and regressed in 2. No top-ten coverage problem was resolved.
- **`multi-session`** (`121` cases): Any@10 improved `0.9174 → 0.9256`
  (`+0.0083`), while All@5 and All@10 were unchanged at `0.2893` and
  `0.4793`; NDCG@10 moved `0.5503 → 0.5518` (`+0.0015`). First relevant
  rank improved in 11 cases and regressed in 2; no additional case found
  all evidence by @10. Multi-session all-evidence coverage remains unresolved.
- **`temporal-reasoning`** (`127` cases): All@5 `0.3858 → 0.4016`
  (`+0.0157`), All@10 `0.6220 → 0.6457` (`+0.0236`), and NDCG@10
  `0.5868 → 0.6029` (`+0.0161`). First relevant rank improved in 18 cases
  and regressed in 1; 3 cases newly found all evidence by @10. This is the
  clearest RH1 directionally positive family result.
- **`knowledge-update`** (`72` cases): Any@1 remained `0.8472 → 0.8472`
  (`+0.0000`), All@5 moved `0.8333 → 0.8611` (`+0.0278`), and NDCG@10
  moved `0.8658 → 0.8787` (`+0.0129`). First relevant rank improved in 1
  case and regressed in 0; All@10 added no newly complete case.
- **`single-session-user`** (`64` cases): the reported Any/All/NDCG metrics
  and first relevant rank were unchanged.

Across the `419` scored cases, first relevant rank was improved in `32`,
regressed in `5`, and unchanged in `382`; Recall-any@5 improved in `5`,
regressed in `1`, and was unchanged in `413`; Recall-all@10 improved in `3`,
regressed in `0`, and was unchanged in `416`. Combined strict dominance was
`34 / 5 / 380` improved/regressed/unchanged, with no mixed cases.

The latency comparison is descriptive only. RH1 reused the warm B4 corpus
cache (`19,934` hits versus B4's `4,033`) and made `418` instruction-query
provider calls, while B4 paid most corpus embedding calls. RH1 total corpus
build/retrieval latency was `20,558.4162 ms` / `113,163.2925 ms`, versus B4's
`3,056,787.4867 ms` / `85,940.0080 ms`; provider response variance and cache
state prevent treating the mean-latency delta as a causal performance result.

### RH1 route decision

`RH1 = CLOSED / INSUFFICIENT`. Query-side instruction wording will not be
adjusted against this LongMemEval result. The B4 profile remains frozen and
continues to be the semantic baseline authority; RH1 does not replace or alter
that baseline.

`H2-I1/I2 = REPO-TESTED`, `H2-S1 = PASS`, and `H2-S2 = NEXT / NOT
AUTHORIZED / NOT RUN`; H2 quality remains `OPEN / NOT ADJUDICATED`. `B5
LoCoMo = LATER / NOT STARTED`. Do not start LTR directly, do not modify
production lexical heuristics from LongMemEval, and do not treat Benchmark
evidence as production authority. Any future retrieval proposal informed by
B4/RH1 failures requires LoCoMo or other cross-dataset evidence before
product-policy consideration.

Answer-generation and LLM-judge quality remain a separate measurement layer so
retrieval changes are not confounded with answering-model changes.

## H2 — bounded multi-query semantic profile

H2-I1 is the source implementation authority at commit
`d47ef6b0e9f6277a5c4c0e0e9ba8a63f558fc0ee`
(`feat(benchmark): add bounded multi-query semantic profile`). H2-I2 is the
pre-sanity hardening authority at commit
`219dd4f335ac6cf4a481cdf422ff949e7a531fe6`
(`fix(benchmark): harden bounded multi-query sanity path`). The profile is
`production_hybrid_semantic_bounded_multi_query_session_v1` and its source
status is `REPO-TESTED / PRE-SANITY HARDENED`.

### H2-S1 execution and adjudication boundary

H2-S1 execution is `PASS` and the real-provider chain is `QUALIFIED`. The
single authorized sanity proves only that real planner → query-plan cache →
real embeddings → temporary LanceDB → three-query RRF → existing production
hybrid fusion can run end to end. It is not H2 quality evidence, production or
runtime qualification, production query-shaping authority, or deployment
authority. H2 quality remains `OPEN / NOT ADJUDICATED`, and H2-S2 is
`NEXT / NOT AUTHORIZED / NOT RUN`.

The one-case retrieval metrics were all `1` and are not interpreted as quality
evidence.

### H2-S1 provenance and invariants

| Field | Recorded value |
| --- | --- |
| Repository commit | `219dd4f335ac6cf4a481cdf422ff949e7a531fe6` |
| Dataset SHA-256 | `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442` |
| Profile | `production_hybrid_semantic_bounded_multi_query_session_v1` |
| Embedding provider / model | `SiliconFlow` / `Qwen/Qwen3-Embedding-4B` |
| Embedding revision / dimension | `unavailable/unpinned` / `2560` |
| Planner provider / model | `SiliconFlow` / `deepseek-ai/DeepSeek-V3.2` |
| Planner revision / temperature | `unavailable/unpinned` / `0` |
| Planner API path | `/v1/chat/completions` |
| Planner max tokens / timeout | `256` / `45000 ms` |
| Planner max response | `65536 bytes` |
| Planner prompt SHA-256 | `31b521f7d91b444f9dab3f67870a39b68ffc0adbae7ec5c6cbd45c7642c7a726` |
| Planner output schema SHA-256 | `ed0c250ed9b31c61e8e2683c541f9d31a0eee8bcb10a76dd103cda6ddd828ca1` |
| Query-plan cache | `memory_engine_benchmark_query_plan_cache_v2`, SQLite `user_version=2` |
| Vector query contract | exact production query + exactly 2 planner queries |
| Query-level fusion | RRF `k=60`, `memory_id` dedup, max semantic/similarity, then existing channel fusion |
| Cases | `1` total / `1` scored / `0` skipped |
| Question | `e47becba` / `single-session-user` |
| Corpus/query embeddings | `53` / `3` |
| Embedding provider calls/cache hits | `2` / `54` (`2 + 54 = 53 + 3 = 56`) |
| Planner provider calls/cache hits | `1` / `0` |
| Vector attempted/skipped/errors | `1 / 0 / 0` |
| Vector queries/searches | `3 / 3` |
| Vector raw/unique candidates | `150 / 50` |
| Per-query candidate counts | `50 / 50 / 50` |
| Vector backend/stage/in fusion | `lancedb` / `lancedb_search` / `true` |
| Planner latency | `2999.30 ms` |
| Corpus build/retrieval latency | `344.06 ms` / `737.76 ms` |

The output artifact is `/tmp/memory-engine-benchmark-v1/h2-s1-219dd4f-limit1-output.json`,
SHA-256 `37eaeaccf1be6548194921347db86ff1f7908db6bd49f4fe3383cb9aa0af8006`,
size `15824 bytes`. The H2 embedding cache is
`/tmp/memory-engine-benchmark-v1/h2-s1-219dd4f-limit1-embedding-cache.sqlite`,
SHA-256 `f5b7dff17e68aad70a560bd1dfac7efffe9e57b9069d6b428f616bfc075b0a96`,
with `16375` entries, dimension `2560`, and integrity `ok`. The H2 query-plan
cache is
`/tmp/memory-engine-benchmark-v1/h2-s1-219dd4f-limit1-query-plan-cache.sqlite`,
SHA-256 `1e1b2784f5a099932bc2c02dfce5a2558a5a3fdff1648f6abf2794e68ccdc5b3`,
with `1` entry, SQLite `user_version=2`, and integrity `ok`. The frozen B4
source cache remained unchanged at SHA-256
`c1b8f292e8e2b95581f09b4526e2ce4c38517c9cfc1b93e0ffbde4b261319db2`.

All output, cache, and temporary data-plane files remain in a temporary
directory and are not vendored. They are not repository authority; long-term
authority is the source commit, dataset SHA-256, committed provenance,
committed metrics, and adjudication.

### H2-S2 frozen evaluation gate

The comparison authority is the frozen B4 profile
`production_hybrid_semantic_session_v1` at source commit
`b640c3547622a646d8962e27b20f0d5ac5a13cc1`. H2 can be adjudicated
`SUFFICIENT` only if every condition below holds on the full run:

| Gate | Required condition |
| --- | --- |
| Overall all-evidence recall | Recall-all@10 delta `>= +0.0100` |
| Family all-evidence recall | At least one of `multi-session` or `temporal-reasoning` Recall-all@10 delta `>= +0.0150` |
| Overall any-evidence recall | Recall-any@5 delta `>= -0.0050` |
| Overall all-evidence recall at five | Recall-all@5 delta `>= -0.0050` |
| Overall ranking quality | NDCG-any@10 delta `>= -0.0050` |
| Case-level evidence coverage | Recall-all@10 improved case count `>` regressed case count |

If any condition fails, `H2 hypothesis = INSUFFICIENT`. Latency must be
recorded and compared but has no hard threshold in this gate. Even a
`SUFFICIENT` H2 result can only advance to LoCoMo or other cross-dataset
verification; it cannot directly enter production policy. B3, B4, and RH1
remain frozen, and Benchmark evidence is not production authority.

### H2 final failure closeout

H2-S2's initial foreground execution was interrupted: the terminal/window
disappeared, the benchmark process was later absent, and the full output was
absent. The provider-capable execution count was `1/1 consumed`; the resulting
cache state is partial-progress evidence, not a baseline. H2-S2-R1 had a
passing preflight, consumed the single provider-capable execution, and exited
with `COMMAND_RC=1` and no full output. Its classification is
`FAIL_CLOSED / PLANNER_OUTPUT_CONTRACT_VIOLATION`.

The H2 final status is **`INSUFFICIENT / FULL EVALUATION NOT COMPLETED /
PLANNER CONTRACT NOT DATASET-ROBUST / OFFLINE EXPERIMENT RECORDED / CLOSED`**.
The six numerical H2-S2 gate conditions are `NOT EVALUABLE`: no complete
output exists, so there are no valid H2 overall, family, or case-level quality
metrics. `INSUFFICIENT` follows from the incomplete full evaluation and the
real failure of the frozen planner contract on the official dataset; it is not
an after-the-fact numerical threshold adjudication.

### H2-S2 initial interruption evidence

The initial foreground H2-S2 execution consumed `1/1` provider-capable
execution. Its partial embedding cache was
`/tmp/memory-engine-benchmark-v1/h2-s1-219dd4f-limit1-embedding-cache.sqlite`,
SHA-256
`97d12935a8789ff01df87eedde935541a14c2e0335cc1587b4e5230b2b462eae`, size
`367063040 bytes`, with `16761` entries, dimension `2560`, and integrity `ok`.
Its query-plan cache was
`/tmp/memory-engine-benchmark-v1/h2-s1-219dd4f-limit1-query-plan-cache.sqlite`,
SHA-256
`93e82555355a25e4662acefca7215fde4272f9dd80c087bfa1102760c009519a`, size
`921600 bytes`, with `194` entries, schema
`memory_engine_benchmark_query_plan_cache_v2`, SQLite `user_version=2`, and
integrity `ok`. These are partial-progress artifacts, not a formal baseline.

### H2-S2-R1 failure evidence

R1 ran at repository commit `7c404efcf7a02c8867020a3ee8fe4c9fae1d8117`, on
`main` with a clean worktree, against dataset SHA-256
`d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`. The B4
comparison output authority has SHA-256
`de62cf40fe21485bf99a4f17129efa6097938a29ace8e88b78b2c2ca90c86cb8`.
Preflight passed; the provider-capable execution was `1/1 consumed`; command
RC was `1`; and the full output was absent.

Failure stage: `semantic_profile_planner_parse`. Exact failure:
`bounded_multi_query_planner_parse: planner query duplicates the production
query`. It occurred at dataset zero-based index `405` / scored one-based index
`382`, question `22d2cb42`, type `knowledge-update`, with question-input
SHA-256
`719823d31f3a2bc71b70ec0380c75b960068cd6e714fc5c69abef8dd71a27e86`.

The real planner returned at least one query identical to the exact production
query, which the frozen strict parser correctly rejected. This demonstrates
that the planner contract was not robust over the official dataset. It is not
classified as an environment failure, repository defect, or metrics
regression. Exact API call counts for requests that were not persisted are not
recorded or inferred.

### H2-S2-R1 final artifacts

The sanitized R1 log was
`/tmp/memory-engine-benchmark-v1/h2-s2-r1-7c404ef.log`, SHA-256
`e1bf1cb8042738e204905f1862e8cdcb7ca5c9aab8c50186cfc8d51e78d5083f`, size
`1301 bytes`; the RC record was
`/tmp/memory-engine-benchmark-v1/h2-s2-r1-7c404ef.rc` with value `1`.
The final embedding cache at the partial-progress path has SHA-256
`50e9f830d93e07b3b5d53d19c267af90ff4f55c3ed7b503e4d27f645fe3ba170`, size
`374845440 bytes`, `17118` entries, dimension `2560`, and integrity `ok`.
The final query-plan cache has SHA-256
`5ae8f0de090cb826f09778d4f363b3004d3b0fcf0be2ae9e78942ba37a91ab3c`, size
`1810432 bytes`, `381` entries, schema
`memory_engine_benchmark_query_plan_cache_v2`, SQLite `user_version=2`, and
integrity `ok`. R1 persisted `187` new query plans (`194 → 381`) and `357`
new embeddings (`16761 → 17118`). These counts describe only successful
persisted partial progress and do not imply complete request or provider-call
totals.

All output, logs, caches, and temporary data-plane files remain in the
temporary directory and are not vendored or baseline authority. The frozen B4
semantic baseline remains the comparison authority.

### H2 anti-drift route decision

H2-S2-R2 is **`DO NOT RUN / NOT AUTHORIZED`**. Do not loosen duplicate
rejection, add planner retries, hand-fill the failed case, modify the H2
prompt/parser/profile and call it the same H2, or reopen H2 in place. H2 has
produced no complete result comparable with B4. B5 LoCoMo remains
`LATER / NOT STARTED`; H2 failure does not authorize production query
shaping, LTR, or lexical tuning. If multi-query work is resumed, it requires a
new independent hypothesis/profile contract with newly frozen variables and
gate; that future profile/H3 is currently `NOT AUTHORIZED / NOT STARTED`.
Benchmark evidence is not production authority.

## Later compatibility target — AML

AML's public protocol assigns the participant only two operations: Add and
Search; the platform controls answer generation and scoring. B1's neutral
Add/Search envelopes intentionally preserve that separation so a later AML
adapter can reuse the same memory-system boundary without changing core
benchmark semantics.
