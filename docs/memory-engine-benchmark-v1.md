# memory-engine Benchmark v1

> Status: `H2 INSUFFICIENT / FULL EVALUATION NOT COMPLETED / PLANNER CONTRACT NOT DATASET-ROBUST / OFFLINE EXPERIMENT RECORDED / CLOSED; B5-I1 CONTRACT REPO-TESTED; B5-I2/I2a/I2b REPO-TESTED; B5-S1 v1 HISTORICAL / TIME PROVENANCE INCOMPLETE / NOT STRICT SEMANTIC A/B AUTHORITY; B5-S1-v2 PASS_WITH_FINDINGS / BASELINE FROZEN / CLOSED; B5 semantic v2 PASS_WITH_FINDINGS / OFFLINE BASELINE RECORDED / BASELINE FROZEN / CLOSED; B5 OVERALL PASS_WITH_FINDINGS / CROSS-DATASET GENERALIZATION RECORDED / CLOSED; B5-I3 SOURCE IMPLEMENTATION REPO-TESTED; B6-A1 PASS_WITH_FINDINGS / SOURCE INSPECTION COMPLETE; B6-I1 CLOSED; B6-I2a CLOSED; B6-I2 SOURCE IMPLEMENTATION REPO-TESTED / CLOSED; B6-I2b SOURCE IMPLEMENTATION REPO-TESTED / CLOSED; B6-I3-R2 PASS / DOCKER NATIVE DEPENDENCY PACKAGING FIXED; B6-I3-R3 SOURCE IMPLEMENTATION REPO-TESTED / DOCKER RUNTIME CLOSURE QUALIFIED; B6-I3 CLOSED; B6-S1 PASS / LOCAL SYNTHETIC QUALIFICATION CLOSED / NO REAL PROVIDER; B6-S2 OFFICIAL SMOKE NOT AUTHORIZED; B6-S3 FULL NOT AUTHORIZED`
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

At the B4 closeout checkpoint, `B5 LoCoMo = LATER / NOT STARTED`. B5-I1 has
since completed the dataset/metric contract; the retrieval baseline remains
not run. The next decision boundary is
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

At the RH1 closeout checkpoint, `H2-I1/I2 = REPO-TESTED`, `H2-S1 = PASS`,
and `H2-S2 = NEXT / NOT AUTHORIZED / NOT RUN`; H2 quality was then
`OPEN / NOT ADJUDICATED`. This is a historical checkpoint, superseded by the
H2 final closeout below. At that checkpoint `B5 LoCoMo = LATER / NOT STARTED`;
B5-I1 has since completed the dataset/metric contract, while retrieval remains
unrun. Do not start LTR
directly, do not modify production lexical heuristics from LongMemEval, and do
not treat Benchmark evidence as production authority. Any future retrieval
proposal informed by B4/RH1 failures requires LoCoMo or other cross-dataset
evidence before product-policy consideration.

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
authority. At the H2-D1 pre-sanity checkpoint, H2 quality was
`OPEN / NOT ADJUDICATED` and H2-S2 was `NEXT / NOT AUTHORIZED / NOT RUN`;
that checkpoint is historical and is superseded by the final failure closeout
below.

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
produced no complete result comparable with B4. B5-I1 is now
`REPO-TESTED / CONTRACT FROZEN`; its retrieval baseline remains `NOT RUN`.
H2 failure does not authorize production query
shaping, LTR, or lexical tuning. If multi-query work is resumed, it requires a
new independent hypothesis/profile contract with newly frozen variables and
gate; that future profile/H3 is currently `NOT AUTHORIZED / NOT STARTED`.
Benchmark evidence is not production authority.

## B5-I1 — LoCoMo dataset / metric contract

B5-I1 source implementation is **`REPO-TESTED / CONTRACT FROZEN`**. This
stage implements only the LoCoMo dataset normalizer, evidence policies,
dialog/session metric contract, validation CLI, and focused tests. It does not
implement a temporary Core/Engine or hybridSearch runner, call a provider, or
run a retrieval baseline. At that historical source-stage checkpoint B5 quality
adjudication was **`OPEN / NOT RUN`**; the completed B5 adjudication is recorded
below.

### Dataset authority and composition

| Field | Frozen value |
| --- | --- |
| Upstream repository | `https://github.com/snap-research/locomo` |
| Upstream repository commit | `3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376` |
| Dataset file commit | `cbfbc1dba6bc53d00625212a0f22d55ffee7c1fc` |
| Dataset path | `data/locomo10.json` |
| Dataset SHA-256 | `79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4` |
| License identity | `CC BY-NC 4.0 International` |
| Contract profile | `locomo_dialog_retrieval_contract_v1` |

The pinned dataset validates to `10` conversations, `272` sessions, `5,882`
turns, and `1,986` QA. Category totals are `1=282` multi-hop,
`2=321` temporal, `3=96` open-domain, `4=841` single-hop, and `5=446`
adversarial. All `5,882/5,882` turn identities match their containing
`session_<n>` and one-based turn position. Turn identity is scoped by
`{sample_id, dia_id}`; `dia_id` is not globally unique across conversations.

### Evidence policies and scoring units

The strict authority is `locomo_evidence_strict_v1`: empty, composite,
non-canonical, duplicate, malformed, and unmapped evidence are not silently
repaired. It records `1,972` scored and `14` skipped QA (`empty_evidence=4`,
format/mapping anomalies `10`). The separately named
`locomo_evidence_canonicalized_v1` sensitivity view performs only deterministic
composite expansion, numeric canonicalization, and set de-duplication; it
records `1,978` scored and `8` skipped QA. Its result is not interchangeable
with the strict authority.

The frozen skip-reason precedence is:
`evidence_missing` → `evidence_not_array` → `empty_evidence` →
`malformed_evidence` → `unmapped_evidence` → `composite_evidence` →
`noncanonical_evidence` → `duplicate_evidence`.

Evidence audit counts are: missing/null/non-array `0/0/0`, empty arrays `4`,
semicolon composites `1`, whitespace composites `3`, malformed items `2`,
non-canonical items `1`, unmapped items `2`, and one QA with one duplicate
evidence occurrence. Empty evidence is skipped, never treated as a retrieval
hit.

Dialog-level metrics are the primary contract: ranked targets are exact
`{sample_id, dia_id}` turns and use Recall-any/all and NDCG at
`@1/@3/@5/@10/@30/@50`. Session-level metrics are a separately labeled
compatibility projection. Dialog ranks project to sessions by preserving the
first occurrence and de-duplicating later turns from the same session. The
two ranking units and denominators must not be mixed.

The B5 adapter must enumerate actual `session_<n>` keys rather than assuming
the legacy `1..19` range. Corpus/search envelopes exclude answer, evidence,
category, and evaluator labels. Any later retrieval implementation must reuse
the existing temporary benchmark isolation and production hybridSearch seam;
this contract commit does not authorize provider, runtime, database, or
deployment work.

## B5-I2 — Isolated LoCoMo lexical retrieval runner

B5-I2 source implementation is **`REPO-TESTED`** and B5-I2a projection
hardening is **`REPO-TESTED`** under the historical independent profile
`production_hybrid_lexical_dialog_locomo_v1`. The runner and CLI materialize
one benchmark-owned temporary Core/Engine/FTS data plane per conversation,
reuse that corpus for all of the conversation's QA, and call the existing
production `hybridSearch()` adapter. The historical official LoCoMo retrieval
checkpoint recorded below is **`B5-S1 PASS_WITH_FINDINGS / BASELINE FROZEN /
CLOSED`**; its clock provenance is incomplete, so it is not strict semantic
A/B authority. At that historical checkpoint B5 overall was **`OPEN`** pending
the time-frozen v2 authority and later semantic comparison; the current B5
status is recorded in the B5-S3 closeout below.

The frozen dialog corpus projection is `locomo_dialog_projection_v1`:
`(<session_date_time>) <speaker>: <raw text>` is always the first line, and a
non-empty raw `blip_caption` adds a deterministic second line
`[shares <blip_caption>]`. `include_session_datetime=true` and
`blip_caption_policy=include_when_present` are profile identity fields, not
CLI or caller options. The source preserves raw speaker/text/date values and
never uses clean/compressed/generated text. Each result maps its benchmark
memory id back to `{sample_id, dia_id, session_id}` before dialog and
first-occurrence-deduplicated session projection scoring.

The runner emits both frozen evidence views: strict
`locomo_evidence_strict_v1` (`1,972` scored / `14` skipped on the official
dataset) and canonicalized sensitivity
`locomo_evidence_canonicalized_v1` (`1,978` scored / `8` skipped). Dialog
metrics remain primary; session metrics are compatibility diagnostics. The
runner uses the existing lexical path and production hybrid fusion with an
empty benchmark-local vector backend and a disabled host memory-manager
fallback. Gold answers, evidence labels, and evaluator fields never enter
Core, Engine, FTS, or Search.

The CLI records exact git provenance, input dataset SHA, profile, corpus
ownership/reuse, and the two aggregate policies. It rejects dirty or
unresolvable repository provenance and never resolves live OpenClaw memory
paths. Focused tests cover ten-conversation corpus isolation/reuse, dynamic
session mapping, date/caption projection, gold isolation, fallback disabling,
and deterministic CLI injection. No provider, live database, runtime, or
deployment operation is authorized by this source stage.

### B5-I2a — Pre-baseline dialog projection hardening

B5-I2a is **`REPO-TESTED`**. The primary profile has no mutable corpus
variant: session date is always included and captions are included whenever a
non-empty `blip_caption` is present. The projection is independent of the
question, category, evidence, or evaluator labels. `answer`,
`adversarial_answer`, `evidence`, `category`, `img_url`, image-search query,
`observation`, `session_summary`, `event_summary`, and other evaluator-only
fields are excluded from Core, Engine, FTS, Search, and document metadata.

The pinned official dataset remains upstream commit
`3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376`, dataset SHA-256
`79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4`, and
license `CC BY-NC 4.0 International`. Its readonly caption audit found
`1,226` non-empty caption-bearing turns, `861` QA with evidence pointing to a
caption-bearing turn (`854` strict-scored and `858` sensitivity-scored), and
answer information in evidence turns classified as raw-only `477`,
caption-only `24`, both `9`, and neither `1,476`. These counts support the
fixed projection contract only; they do not create an answer-dependent
retrieval heuristic.

At the B5-I2a pre-baseline checkpoint the official retrieval baseline was
**`NOT RUN`** and quality adjudication was **`OPEN`**. B5-S1 is recorded in the
next section; no dataset, output, or temporary audit artifact is vendored, and
benchmark evidence is not production authority.

### B5-I2b — Benchmark time provenance hardening

B5-I2b is **`REPO-TESTED`**. The LoCoMo lexical CLI now accepts exactly one
`--benchmark-now-sec <positive-safe-integer>` value, rejects non-decimal,
non-positive, unsafe, duplicate, and missing values before starting the
dataset runner, and resolves the wall-clock default once before a dataset run.
The trusted camel-case `benchmarkNowSec` runner parameter is validated and is
passed unchanged to every conversation materializer and retrieval case. Both
`provenance.benchmark_now_sec` and `run.benchmark_now_sec` are authoritative
numeric fields and cannot be replaced by caller or profile provenance.

The initial B5-S1 attempt stopped before corpus materialization with
`ENVIRONMENT_FAILURE` at repository provenance resolution; its baseline was
not produced. B5-S1-R1 is recorded below as the completed baseline. No
provider, runtime, live database, or temporary artifact was used or vendored
in B5-I2b.

### B5-I2c — Search-clock seam and time-frozen lexical v2 source

B5-I2c is **`REPO-TESTED`**. The production `hybridSearch()` boundary now has
an optional, default-off `runtime.searchNowSec` seam. When absent, the
existing `Math.floor(Date.now() / 1000)` behavior remains; when present, a
positive safe integer is used for all ranking-related time calculations in
the request. Vector latency measurement continues to use its normal elapsed
clock and is not benchmark-time based.

The historical B5-S1 v1 profile and artifact remain unchanged and retain this
status:

```text
HISTORICAL LEXICAL EVIDENCE
TIME PROVENANCE INCOMPLETE
NOT STRICT SEMANTIC A/B AUTHORITY
```

The independent v2 source profile is
`production_hybrid_lexical_dialog_locomo_time_frozen_v2`, with clock contract
`locomo_materialization_and_search_fixed_v2`. Its required
`benchmark_now_sec`, materialization clock, and search/rerank clock are one
authoritative positive safe integer. Both `provenance` and `run` record the
three equal clocks, and every scoreable retrieval diagnostic records the exact
search clock. The v2 profile keeps the v1 corpus, projection, caption/date
policy, query, evidence policies, metrics, cutoffs, lexical/fusion/rerank
constants, vector-disabled backend, and host-manager-disabled policy.

The lexical v2 source and focused tests are **`REPO-TESTED`**. The completed
B5-S1-v2 execution is **`PASS_WITH_FINDINGS / BASELINE FROZEN / CLOSED`**;
the detailed execution authority, metrics, provenance, and semantic vector
gate freeze are recorded below. At that historical pre-S3 checkpoint B5
overall was **`OPEN`**. The semantic profile reserved for that next stage was
`production_hybrid_semantic_dialog_locomo_time_frozen_v2`; B5-I3 source
implementation is **`REPO-TESTED`**. The current semantic execution and B5
status are recorded in the B5-S3 closeout below.

#### B5-D1 append-only correction

The earlier B5-S1 record's `benchmark_now_sec` proves the materialization and
runner provenance value, but the v1 output did not record the resolved runtime
search clock for each `hybridSearch()` call. Existing output, logs, and file
mtimes cannot reconstruct that per-search wall-clock sequence exactly. The v1
record is therefore historical lexical evidence with **`TIME PROVENANCE
INCOMPLETE`**, not strict semantic A/B authority; its execution, metrics,
profile, source identity, and output SHA-256 remain preserved. Future semantic
comparison must first establish the independent v2 lexical authority and use
that authority as its lexical control. Accordingly, the six frozen semantic
gates are evaluated as **semantic v2 minus the new lexical v2 authority**, not
against the time-incomplete v1 artifact; their numerical thresholds are not
changed.

## B5-S1 — LoCoMo lexical full baseline (historical checkpoint)

### Execution history and authority

This section preserves the historical v1 execution, metrics, and evidence. It
is superseded as strict A/B authority because its resolved runtime search-clock
provenance was not recorded per search; it remains historical lexical evidence
with `TIME PROVENANCE INCOMPLETE`.

The initial B5-S1 execution was **`ENVIRONMENT_FAILURE`** at repository
provenance resolution. It did not enter corpus materialization or retrieval,
produced no baseline, and is not quality evidence. B5-S1-R1 was the authorized
single corrective execution: `execution=PASS`, `command_rc=0`, `retry=1/1`,
and no further retry.

The historical B5-S1 v1 record is:

| Field | Value |
| --- | --- |
| profile | `production_hybrid_lexical_dialog_locomo_v1` |
| source commit | `d45ea0de2b9b33a222118ed312c1ff74ca4e84d6` |
| repository provenance | `git`, clean |
| dataset | `/tmp/locomo10-pinned.json` |
| dataset SHA-256 | `79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4` |
| upstream commit | `3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376` |
| dataset file commit | `cbfbc1dba6bc53d00625212a0f22d55ffee7c1fc` |
| benchmark_now_sec | `1705066861` |
| top_k | `50` |
| output SHA-256 | `92248dc1d9134130904098491d93daabffda2cc40b66fbd26057705dfbe41d91` |
| output size | `31,205,211 bytes` |
| temporary output | `/tmp/memory-engine-benchmark-v1/b5-s1-r1-d45ea0de-locomo-lexical-output.json` |

The output is temporary evidence, not repository authority. Long-term
authority is the dataset SHA, upstream pin, profile, source commit, fixed
benchmark time, committed metrics, and adjudication.

### Frozen lexical profile and run shape

The profile uses `locomo_dialog_projection_v1` with the fixed document format
`(<session_date_time>) <speaker>: <raw text>` and an optional second line
`[shares <blip_caption>]` when the caption is non-empty. Session datetime is
included, caption policy is `include_when_present`, vector mode is
`disabled_empty_backend`, host-manager mode is `disabled`, and
`lexical_confidence_threshold=0`.

The run built one conversation-owned temporary Core/Engine/FTS corpus for each
of `10` conversations (`10` corpora), reused each corpus for its
conversation's QA, and recorded `1,986` cases / `1,978` retrieval cases with
`1,978` corpus-reuse searches. Dialog identity is `{sample_id, dia_id}`;
session results are first-occurrence-deduplicated diagnostics. Gold and other
evaluator-only fields did not enter corpus materialization, FTS, or Search.

Evidence policies remain:

- strict `locomo_evidence_strict_v1`: `1,972` scored / `14` skipped;
- sensitivity `locomo_evidence_canonicalized_v1`: `1,978` scored / `8` skipped.

Dialog is the primary metric level. Session projection is compatibility
diagnostic only.

### Strict primary dialog metrics

| Metric | @1 | @3 | @5 | @10 | @30 | @50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Recall-any | 0.152637 | 0.229716 | 0.271805 | 0.321501 | 0.395030 | 0.423935 |
| Recall-all | 0.130832 | 0.190669 | 0.226166 | 0.261156 | 0.314909 | 0.330629 |
| NDCG-any | 0.152637 | 0.183247 | 0.198344 | 0.211939 | 0.228017 | 0.232523 |

Additional strict diagnostics:

- MRR is `0.207487`, derived from `first_relevant_rank` with zero for
  zero-hit cases; MRR is not emitted by the existing evaluator schema.
- mean first relevant rank is `7.986842` over the evaluator's scored hit
  ranks; it is not an average rank for cases with no hit.
- zero-hit cases: `1,136 / 1,972`;
- All@10 failures: `1,457 / 1,972`;
- mean retrieval latency: `14.504059 ms`;
- total corpus build latency: `719.309045 ms`;
- total retrieval latency: `28,689.028318 ms`;
- mean corpus dialogs: `588.2`;
- retrieval latency distribution: min `4.197203 ms`, p50 `14.284229 ms`,
  p95 `18.781005 ms`, max `53.328561 ms`.

### Strict category findings at @10

| Category | Cases | Scored | Skipped | Recall-any@10 | Recall-all@10 | NDCG-any@10 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Multi-hop | 282 | 277 | 5 | 0.296029 | 0.014440 | 0.093270 |
| Temporal | 321 | 320 | 1 | 0.446875 | 0.403125 | 0.328383 |
| Open-domain | 96 | 89 | 7 | 0.269663 | 0.123596 | 0.133507 |
| Single-hop | 841 | 840 | 1 | 0.305952 | 0.292857 | 0.223366 |
| Adversarial | 446 | 446 | 0 | 0.286996 | 0.280269 | 0.196224 |

Multi-hop @50 remains weak: Recall-any `0.472924`, Recall-all `0.043321`.

### Session compatibility diagnostic

The dialog ranking projected to sessions by first occurrence and deduplicated
in rank order gives Recall-any@10 `0.744929`, Recall-all@10 `0.639452`, and
NDCG-any@10 `0.477762`. This is not an independent session retriever. The top
10 unique sessions can consume more than 10 dialog ranks, and these values
must not be compared directly with LongMemEval session-level metrics.

### Sensitivity finding

Canonicalized sensitivity dialog metrics are Recall-any@10 `0.321031`,
Recall-all@10 `0.260870`, NDCG-any@10 `0.211802`, Recall-any@50 `0.423155`,
and Recall-all@50 `0.330131`. Derived MRR is `0.207363`, zero-hit cases are
`1,141 / 1,978`, and All@10 failures are `1,462 / 1,978`. Relative to strict,
the @10 deltas are `-0.000470` / `-0.000287` / `-0.000137` for any/all/NDCG,
and the @50 Recall-any/Recall-all deltas are `-0.000780` / `-0.000497`.
All differences are below `0.001` in magnitude; the low score is not caused
by evidence canonicalization.

### B5-S1 adjudication (historical checkpoint)

The historical execution and evidence state is preserved as:

```text
B5-S1 execution = PASS
B5-S1 quality = PASS_WITH_FINDINGS
B5-S1 final = OFFLINE LEXICAL BASELINE RECORDED / BASELINE FROZEN / CLOSED
B5 overall = OPEN (at this historical checkpoint; superseded by B5-S3)
```

The findings are that dialog-level lexical retrieval is weak overall, Top 50
still has substantial zero-hit coverage loss, and multi-hop is the clearest
weak category. Temporal is strongest and the session datetime projection has
practical value, but multi-evidence coverage and dialog ranking remain
unsolved. These results are benchmark evidence only and do not authorize
production lexical-heuristic changes or runtime policy.

## B5-S1-v2 — LoCoMo time-frozen lexical baseline

### Execution authority and provenance

B5-S1-v2 execution is **`PASS`** with `RC=0` under the independent profile
`production_hybrid_lexical_dialog_locomo_time_frozen_v2` at source commit
`b4a53522bba7a1314b2c99f1fd566872e6e5e8d4`. The pinned dataset SHA-256 is
`79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4`,
`top_k=50`, and `benchmark_now_sec = materialization_now_sec =
search_now_sec = 1705066861`.

| Field | Value |
| --- | --- |
| output | `/tmp/memory-engine-benchmark-v1/b5-s1-v2-b4a53522-locomo-lexical-output.json` |
| output SHA-256 | `9d6c4c02a5fff3841f98552f5d7ee087c57448bc8a917606a047ac395e222f06` |
| output size | `31,280,002 bytes` |
| execution log | `/tmp/memory-engine-benchmark-v1/b5-s1-v2-b4a53522.log` |
| log SHA-256 | `7b066eea1c314f9e93d84deb86cb1087a8b5c1c8e5b25c40e1bc04caf5b86af7` |
| RC | `0` |

The output, log, and return-code marker are temporary artifacts under
`/tmp/memory-engine-benchmark-v1/` and are not vendored. Long-term authority
is the committed repository/dataset/profile/clock provenance, the metrics and
invariants below, and this adjudication.

### Denominators and strict dialog metrics

The strict evidence view is `1,972` scored / `14` skipped. The sensitivity
retrieval view is `1,978` scored / `8` skipped. Strict dialog primary metrics
are:

| Metric | Value |
| --- | ---: |
| Recall-any@1 | `0.1546653144` |
| Recall-any@5 | `0.2728194726` |
| Recall-any@10 | `0.3220081136` |
| Recall-any@50 | `0.4239350913` |
| Recall-all@5 | `0.2276876268` |
| Recall-all@10 | `0.2621703854` |
| Recall-all@50 | `0.3306288032` |
| NDCG-any@10 | `0.2135986258` |
| MRR | `0.2093299195` |
| mean first relevant rank | `7.9629186603` |
| zero-hit@50 | `1,136 / 1,972` |
| All@10 failures | `1,455 / 1,972` |
| mean retrieval latency | `15.4559368468 ms` |
| corpus build latency total | `754.702548 ms` |
| retrieval latency total | `30,571.843083 ms` |

Every scoreable retrieval diagnostic recorded `search_now_sec=1705066861`;
missing diagnostics were `0` and clock mismatches were `0`.

### Lexical confidence and frozen semantic vector gate

The sensitivity lexical-confidence distribution contains `1,978` finite
values: min `0.3571`, max `0.6900`, mean `0.5010601112`, p50 `0.5063`, p90
`0.5563`, p95 `0.5786`, and p99 `0.6275`. Values below `0.7` are `1,978`;
values equal to or above `0.7` are `0`.

This distribution now freezes the semantic v2 vector invariant:

```text
vector_attempted_count = 1,978
vector_skipped_count = 0
vector_error_count = 0
host-manager fallback count = 0
```

For every semantic v2 attempted case, `vector_backend=lancedb`,
`vector_stage=lancedb_search`, and `vector_in_fusion=true` are required. Any
official vector-skipped case must use
`skip_reason=lexical_confidence_threshold_met` and must not execute query
embedding or vector search. Silent lexical-only degradation is forbidden.
The current lexical v2 distribution produces no vector-skipped cases; the
frozen semantic contract nevertheless retains the skip behavior requirement.

### Clock-only comparison with historical v1

Relative to the historical time-incomplete v1 output, `434 / 1,978` retrieved
orders changed. First-rank comparison is `22 improved / 36 regressed /
1,920 unchanged`. The clock-only deltas are Recall-any@10 `+0.000507`,
Recall-all@10 `+0.001014`, NDCG-any@10 `+0.001660`, and Recall-any/Recall-all@50
`0`. These findings prove that clock correction changes ordering, but they do
not constitute retrieval-heuristic tuning or authorize production changes.

### B5-S1-v2 adjudication

```text
B5-S1-v2 execution = PASS
B5-S1-v2 quality = PASS_WITH_FINDINGS
B5-S1-v2 final = OFFLINE LEXICAL BASELINE RECORDED / BASELINE FROZEN / CLOSED
B5 overall = OPEN (at this historical checkpoint; superseded by B5-S3)
```

## B5 semantic A/B gate — frozen contract and completed evaluation

The future pair is `production_hybrid_lexical_dialog_locomo_time_frozen_v2`
and `production_hybrid_semantic_dialog_locomo_time_frozen_v2`. At the pre-run
design checkpoint, semantic v2 was recorded as
`NEXT / SOURCE IMPLEMENTATION REPO-TESTED / REAL-PROVIDER SANITY NOT RUN /
SEMANTIC FULL A/B NOT RUN / NOT AUTHORIZED`; that historical checkpoint is
superseded by the completed B5-S3 record below. The semantic v2 design
must hold the time-frozen lexical v2 authority fixed: upstream and dataset
pins, question set, strict/sensitivity policies and denominators, dialog corpus
unit and conversation isolation, `locomo_dialog_projection_v1`, session
datetime and caption policy, exact question text, `top_k=50`,
`benchmark_now_sec=1705066861`, metric implementation and cutoffs
`1,3,5,10,30,50`, category mapping, lexical/FTS path, production channel
fusion/ranking, and the gold-leakage boundary.

The only permitted semantic variables are a real embedding/vector channel, a
temporary conversation-owned LanceDB, and the production semantic activation
gate. The pre-frozen contract is SiliconFlow / `Qwen/Qwen3-Embedding-4B`,
revision `unavailable/unpinned`, dimension `2560`, Canonical vector projection
v1 with max `2000` chars, `lexicalConfidenceThreshold=0.7`, `vectorTopK=50`,
and forbidden host-manager fallback. Query instruction, rewriting,
multi-query, planner, LTR, lexical tuning, and benchmark-only ranking are
excluded.

Primary gates use strict dialog metrics and compare semantic v2 minus the
frozen B5-S1-v2 lexical authority. The six numerical thresholds and regression
guards below are unchanged.

| Gate | Required delta |
| --- | ---: |
| Overall Recall-any@10 | ≥ +0.0200 |
| Overall Recall-all@10 | ≥ +0.0200 |
| Overall NDCG-any@10 | ≥ +0.0200 |
| Overall Recall-any@50 | ≥ +0.0300 |
| Multi-hop Recall-any@10 | ≥ +0.0300 |
| Multi-hop Recall-all@10 | ≥ +0.0200 |

Regression guards: no overall strict dialog @5/@10/@50 metric may regress by
more than `0.0050`; temporal NDCG-any@10 and single-hop NDCG-any@10 may each
regress by no more than `0.0200`. Case-level comparison must report first
relevant rank, Recall-any@10, and Recall-all@10 with improved/regressed/
unchanged counts.

The completed B5-S1-v2 baseline freezes the semantic execution contract:

- exact repository, dataset, profile, and clock provenance;
- strict denominator `1,972` scored / `14` skipped;
- sensitivity/retrieval denominator `1,978` scored / `8` skipped;
- `vector_error_count = 0`;
- host-manager fallback is forbidden;
- no silent lexical-only degradation.

The semantic v2 vector gate is now frozen from the lexical v2 confidence
distribution:

```text
vector_attempted_count = 1,978
vector_skipped_count = 0
vector_error_count = 0
host-manager fallback count = 0
```

For every semantic v2 attempted case, `vector_backend=lancedb`,
`vector_stage=lancedb_search`, and `vector_in_fusion=true` are required. Any
official vector-skipped case must use
`skip_reason=lexical_confidence_threshold_met` and must not execute query
embedding or vector search. Silent lexical-only degradation remains forbidden.

A valid semantic execution must satisfy the frozen provenance, denominator,
vector, error, fallback, and no-degradation contract.

`USEFUL / PASS_WITH_FINDINGS` requires a valid execution, all regression
guards, at least four of six gates, at least two of the three overall @10
gates, and at least one multi-hop gate. Otherwise a valid execution is
`INSUFFICIENT`; any provenance, isolation, vector, or scoring invariant
failure is `INVALID / NOT ADJUDICABLE`. Latency, provider/cache counts, and
vector counts must be reported but have no hidden quality threshold. Session
projection and sensitivity remain diagnostics only. At that pre-run checkpoint
the semantic provider sanity and full run were not authorized; B5-S3 now
records the completed execution and adjudication below.

B5-I2c-D1 closeout: the time-frozen semantic successor was reserved at that
historical checkpoint as
`production_hybrid_semantic_dialog_locomo_time_frozen_v2`, and its lexical
control is now the independently materialized and searched
`production_hybrid_lexical_dialog_locomo_time_frozen_v2` authority recorded in
B5-S1-v2 above. The prior pre-baseline `NOT RUN` / `PENDING` state is
superseded; the historical B5-S1 v1 record, metrics, and time-provenance
limitation remain unchanged. The historical statement that no semantic source
implementation or provider run was authorized is superseded by the B5-I3 source
record and B5-S3 execution below.

### B5-I3 — time-frozen semantic v2 source implementation

B5-I3 source implementation is **`REPO-TESTED`** under the independent profile
`production_hybrid_semantic_dialog_locomo_time_frozen_v2`. The runner and CLI
use one conversation-owned temporary Core/Engine/FTS/LanceDB data plane, reuse
the existing low-level embedding-cache, Canonical vector projection, LanceDB,
and production `hybridSearch()` seams, and keep the lexical v2 baseline,
evidence policies, denominators, metrics, ranking, fusion, and projection
contracts unchanged. The fixed clock is bound equally to benchmark,
materialization, and search/rerank paths; the frozen vector invariant remains
attempted/skipped/error `1,978/0/0`, with LanceDB `lancedb_search`,
`vector_in_fusion=true`, zero host-manager fallback, and no silent
lexical-only degradation.

This source-stage record predates the completed real-provider run. The six
numerical gates and regression guards remain unchanged and compare semantic v2
against the frozen lexical v2 authority. Output, cache, vector, and temporary
data-plane artifacts are not vendored; committed source, provenance contract,
invariants, metrics, and adjudication are the long-term authority.

## B5-S3 — LoCoMo semantic v2 full baseline and closeout

### Execution authority and temporary artifacts

B5-S3 execution is **`PASS`** with `COMMAND_RC=0` under the independent
profile `production_hybrid_semantic_dialog_locomo_time_frozen_v2`, source commit
`dfb41ea866646cbe556e3e6c3c03782da52de216`, repository provenance `git`, and a
clean worktree. The pinned LoCoMo source is upstream commit
`3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376`; the dataset file commit is
`cbfbc1dba6bc53d00625212a0f22d55ffee7c1fc`; the license identity is
`CC BY-NC 4.0 International`; and the dataset SHA-256 is
`79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4`.

The run used `benchmark_now_sec = materialization_now_sec = search_now_sec =
1705066861`, `top_k=50`, and `vector_top_k=50`. Projection remained
`locomo_dialog_projection_v1` with session datetime included and
`include_when_present` captions. Embedding provenance was SiliconFlow /
`Qwen/Qwen3-Embedding-4B`, revision `unavailable/unpinned`, dimension `2560`,
Canonical vector projection v1 with a 2,000-character limit, and production
`lexicalConfidenceThreshold=0.7`. The vector data plane was temporary LanceDB;
host-manager fallback was forbidden.

All output, cache, log, and RC markers are temporary artifacts under
`/tmp/memory-engine-benchmark-v1/`; none is vendored. Their hashes and sizes
are:

| Artifact | Path | SHA-256 | Size / value |
| --- | --- | --- | ---: |
| output | `b5-s3-dfb41ea8-full-semantic-output.json` | `eb4b29c56435297f7a376f18647ca44cce4659b38a8b3fa1e980c853082b1829` | 32,273,813 bytes |
| embedding cache | `b5-s2-dfb41ea8-limit1-embedding-cache.sqlite` | `2d447d76585a3749955ba017f2a0e63468b643c561cabef3d46be8caa225c458` | 171,872,256 bytes |
| execution log | `b5-s3-dfb41ea8-full.log` | `65eade5b211693585624025dd737b33793adeae800971adecfe73e0d21ffaa59` | 39,194 bytes |
| RC marker | `b5-s3-dfb41ea8-full.rc` | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` | `0` |

The final embedding cache passed SQLite `integrity_check=ok`,
`user_version=1`, and contained `7,848` entries with dimensions `2560/2560`.
The run performed `5,882` corpus and `1,978` query embedding lookups
(`7,860` total), with `7,232` provider calls and `628` cache hits.

### Run shape and vector invariants

The run covered `1,986` cases and `1,978` retrieval cases across `10`
conversations, building exactly `10` conversation-owned temporary corpora with
`5,882` dialog rows. Same-conversation QA reused its corpus for `1,978`
searches; the mean corpus size was `588.2` dialogs. The strict evidence view
scored `1,972` and skipped `14`; the canonicalized sensitivity view scored
`1,978` and skipped `8`. Strict skipped reasons were `empty_evidence=4`,
`composite_evidence=4`, `unmapped_evidence=2`, `malformed_evidence=2`,
`duplicate_evidence=1`, and `noncanonical_evidence=1`. Sensitivity skipped
reasons were `empty_evidence=4`, `unmapped_evidence=2`, and
`malformed_evidence=2`.

The official vector invariant held for every retrieval case: attempted /
skipped / error = `1,978 / 0 / 0`; every case used
`vector_backend=lancedb`, `vector_stage=lancedb_search`, and
`vector_in_fusion=true`; host-manager fallback was `0`. No case silently
degraded to lexical-only retrieval. The dialog ranking remained primary;
session results were only first-occurrence-deduplicated compatibility
diagnostics.

### Strict primary dialog metrics

| Metric | @1 | @3 | @5 | @10 | @30 | @50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Recall-any | 0.2089249493 | 0.3012170385 | 0.3382352941 | 0.3919878296 | 0.5167342799 | 0.6435091278 |
| Recall-all | 0.1749492901 | 0.2510141988 | 0.2789046653 | 0.3174442191 | 0.4224137931 | 0.5289046653 |
| NDCG-any | 0.2089249493 | 0.2450006908 | 0.2574948831 | 0.2726391074 | 0.3009152306 | 0.3240737005 |

Additional strict dialog diagnostics are MRR `0.2762670443`, mean first
relevant rank `13.5200945626`, zero-hit@50 `703/1,972`, and All@10 failures
`1,346/1,972`. Sensitivity dialog metrics are:

| Metric | @1 | @3 | @5 | @10 | @30 | @50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Recall-any | 0.2087967644 | 0.3013144590 | 0.3382204247 | 0.3918099090 | 0.5166835187 | 0.6430738119 |
| Recall-all | 0.1749241658 | 0.2507583418 | 0.2785642063 | 0.3169868554 | 0.4216380182 | 0.5278058645 |
| NDCG-any | 0.2087967644 | 0.2449586527 | 0.2574149455 | 0.2725132318 | 0.3007741572 | 0.3238623789 |

Sensitivity MRR is `0.2762126448`, mean first relevant rank is
`13.5062893082`, zero-hit@50 is `706/1,978`, and All@10 failures are
`1,351/1,978`. Sensitivity minus strict deltas at @10 are
`-0.0001779206/-0.0004573637/-0.0001258755` for any/all/NDCG, and at @50
are `-0.0004353159/-0.0010988008/-0.0002113215` for any/all/NDCG.

The strict session compatibility diagnostic is Recall-any@10 `0.8017241379`,
Recall-all@10 `0.7008113590`, and NDCG-any@10 `0.5639414101`; it is not an
independent session retriever and must not be compared directly with
LongMemEval session-level metrics.

### Category findings

Strict dialog category results are:

| Category | Cases | Scored | Skipped | Recall-any@10 | Recall-all@10 | NDCG-any@10 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Multi-hop | 282 | 277 | 5 | 0.3610108303 | 0.0324909747 | 0.1329048993 |
| Temporal | 321 | 320 | 1 | 0.5093750000 | 0.4500000000 | 0.3944727750 |
| Open-domain | 96 | 89 | 7 | 0.3146067416 | 0.1235955056 | 0.1740059440 |
| Single-hop | 841 | 840 | 1 | 0.3940476190 | 0.3750000000 | 0.2960638561 |
| Adversarial | 446 | 446 | 0 | 0.3385650224 | 0.3295964126 | 0.2475744541 |

Multi-hop remains the clear multi-evidence weakness: Recall-all@10 is only
`0.0324909747` (up from lexical v2 `0.0144404332`) and Recall-all@50 is
`0.1155234657`. Temporal is the strongest semantic improvement at @10, while
single-hop and adversarial also improve over lexical v2. These are cross-dataset
retrieval findings, not production query-shaping authority.

### Semantic versus frozen lexical v2

The comparison authority is B5-S1-v2 profile
`production_hybrid_lexical_dialog_locomo_time_frozen_v2`, source commit
`b4a53522bba7a1314b2c99f1fd566872e6e5e8d4`, output SHA-256
`9d6c4c02a5fff3841f98552f5d7ee087c57448bc8a917606a047ac395e222f06`.
The strict dialog deltas are:

| Gate | Semantic − lexical v2 | Required | Result |
| --- | ---: | ---: | --- |
| Overall Recall-any@10 | +0.0699797160 | ≥ +0.0200 | PASS |
| Overall Recall-all@10 | +0.0552738337 | ≥ +0.0200 | PASS |
| Overall NDCG-any@10 | +0.0590404816 | ≥ +0.0200 | PASS |
| Overall Recall-any@50 | +0.2195740365 | ≥ +0.0300 | PASS |
| Multi-hop Recall-any@10 | +0.0685920578 | ≥ +0.0300 | PASS |
| Multi-hop Recall-all@10 | +0.0180505415 | ≥ +0.0200 | FAIL |

Thus the six numerical gates are `5/6 PASS`; Multi-hop Recall-all@10 is the
only unmet threshold. All regression guards pass: every overall strict dialog
@5/@10/@50 metric improved by more than the `-0.0050` guard, temporal
NDCG-any@10 improved by `+0.0649723194`, and single-hop NDCG-any@10 improved
by `+0.0706449149`.

Case-level comparison uses the `1,972` strict scoreable cases matched by
question identity. Lower finite first-rank is better; a no-hit rank is worse
than a finite rank. The explicitly labeled semantic improved / regressed /
unchanged counts are:

- First relevant rank: `801 improved / 46 regressed / 1,125 unchanged`.
- Recall-any@10: `141 improved / 3 regressed / 1,828 unchanged`.
- Recall-all@10: `110 improved / 1 regressed / 1,861 unchanged`.
- Recall-any@50: `436 improved / 3 regressed / 1,533 unchanged`.

Three-field strict dominance (all three no worse and at least one better) is
`659 improved / 46 regressed / 1,122 unchanged`, with `145` mixed cases.
The retrieved dialog order changed in `1,971/1,972` scoreable cases. The
latency and ranking changes are recorded as evidence, not tuning authorization.

Semantic mean retrieval latency is `364.761142 ms`, compared with lexical v2
`15.455937 ms`, approximately `23.60×`. Semantic total corpus-build latency is
`1,665,244.752032 ms` and total retrieval latency is `721,497.538846 ms`,
versus lexical v2 corpus-build `754.702548 ms` and retrieval `30,571.843083
ms`. Provider calls/cache hits were `7,232/628`. The latency increase is a
material caveat and has no hidden pass threshold in the frozen gate.

### B5 semantic v2 adjudication and route

```text
B5-S3 execution = PASS
B5 semantic v2 quality = PASS_WITH_FINDINGS
B5 semantic v2 = OFFLINE BASELINE RECORDED / BASELINE FROZEN / CLOSED
B5 overall = PASS_WITH_FINDINGS / CROSS-DATASET GENERALIZATION RECORDED / CLOSED
```

The result records useful semantic cross-dataset evidence while leaving a
material multi-hop all-evidence gap and a large latency cost. The lexical v2
baseline remains frozen; lexical v1 remains historical/time-incomplete; B3,
B4, RH1, and H2 historical decisions remain unchanged. Benchmark evidence is
not runtime or production authority and does not authorize production tuning,
query rewriting, multi-query retrieval, LTR, deployment, or configuration
changes. The output, cache, and log remain temporary artifacts rather than
repository authority; long-term authority is the committed source and dataset
provenance, metrics, invariants, and this adjudication.

B6-A1 is **`PASS_WITH_FINDINGS / SOURCE INSPECTION COMPLETE`** and B6-I1 is
**`CLOSED`**. B6-I2a is **`CLOSED`** and B6-I2 is now **`SOURCE IMPLEMENTATION
REPO-TESTED / CLOSED`** after retained-root restart and cross-store crash
reconciliation. B6-I3-R2 is **`PASS / DOCKER NATIVE DEPENDENCY PACKAGING
FIXED`**. B6-I3-R3 is **`SOURCE IMPLEMENTATION REPO-TESTED / DOCKER RUNTIME
CLOSURE QUALIFIED`** and B6-I3 is **`CLOSED`**. B6-S1 is **`PASS / LOCAL
SYNTHETIC QUALIFICATION CLOSED / NO REAL PROVIDER`** at source commit
`b2063f4531a5b0136de33ffee7e31c5235017028`; its historical Phase B and initial
Phase C packaging findings were closed by R2/R3 before the successful container
qualification. No AML hosted smoke, full evaluation, real provider run, public
endpoint, Docker submission, or leaderboard upload has started. B6-S2 official
smoke and B6-S3 full evaluation remain separately unauthorized.

## B6 — Agent Memory Leaderboard compatibility

B6 pins the public AML source authority to:

```text
repository = https://github.com/AML-memory/agent-memory-leaderboard
commit = 1b8142bfe0f20f1c5218d6b554aa0012de34e504
public repository license metadata = absent / unresolved
```

The public protocol assigns the participant only Add and Search; AML controls
answer generation, held-out evaluation, scoring, and orchestration. The public
repository does not expose the production benchmark corpus, held-out questions,
gold answers, private annotations, participant runs, or production service.
Formal AML evidence therefore remains controlled external evaluation and is not
a locally reproducible B3/B4/B5-style retrieval baseline.

### B6-I1 protocol and isolation adapter

Implemented by:

- `lib/benchmark/aml-adapter-v1.js`
- `lib/benchmark/aml-data-plane-v1.js`
- `test/benchmark-aml-adapter-v1.test.js`

The adapter freezes these boundaries:

```text
adapter_version = memory_engine_aml_adapter_v1
protocol_surface = public_add_search_v1
Add projection = aml_add_projection_v1
Search evidence surface = production_hybrid_text_240_v1
Search options policy = accepted_but_not_injected_into_query
max top_k = 100
host memory manager fallback = forbidden
```

B1's neutral Add/Search envelope remains the semantic bridge. AML Add messages
are deterministically projected in message order as optional millisecond
`timestamp`, `role`, and raw string `content`; an empty content string remains
legal rather than being rewritten or rejected, preserving the official
LongMemEval empty-turn compatibility already established by B1/B3. `request_id`,
`user_id`, evaluator metadata, answers, and gold are not inserted into searchable
text. The adapter uses production `autoRouteCategory()` and `catParams()` for
benchmark-owned Engine metadata while ingestion time and source-event time
remain distinct.

`request_id` is an Engine-backed idempotency key. An identical retry returns
success without a second memory; a reused `request_id` with a different
normalized payload fails closed. The ledger survives reopening the same retained
temporary user data plane. Add and Search are serialized per `user_id`, so a
successful Add is immediately searchable before its response is returned.

AML's sole Search isolation key is `user_id`, while production `hybridSearch()`
has no `user_id` filter. B6 therefore makes isolation a topology invariant:

```text
one AML user_id
= one temporary Core SQLite
+ one temporary Engine SQLite
+ one per-user LanceDB path/backend boundary
+ isolated production hybridSearch runtime per Search operation
```

No AML users share Core, Engine, vector path, or host-manager fallback. SQLite
writers/readers and Hybrid runtime handles are opened only for the active
Add/Search operation rather than retained for every registered user; a 120-user
focused test guards against linear persistent file-descriptor growth. All roots
must resolve below the operating-system temporary directory; live OpenClaw Core,
memory-engine Engine, live LanceDB, workspace memory files, and Gateway state
are outside the B6-I1 data plane.

B6 Search reuses production `hybridSearch()` ranking. The shared benchmark
runtime helper gained an optional `minConfidence` seam whose default remains
`0`, preserving B3-B5. B6 alone binds the production defaults
`confidence.min=0.15` and lexical semantic-activation gate `0.7`. Channel
candidate limits remain benchmark-owned so AML `top_k<=100` can be served; no
production lexical heuristic, ranking weight, token rule, vector gate, runtime
config, or live data is changed.

The first B6 baseline deliberately freezes the existing Hybrid result evidence
surface: `content` is the current maximum 240-character `result.text`, rank order
is preserved, and finite `final_score` becomes optional AML `score`. Full
Canonical source text is not substituted silently. A future full-evidence
projection would be a separately named hypothesis/profile, not a baseline
repair.

B6-I1 contains a per-user vector-backend factory seam and Canonical vector
projection boundary. It is now closed after repository testing; no real
embedding provider was configured or called by that stage.

### B6-I2a concrete semantic backend and bounded resource ownership

B6-I2a is **`SOURCE IMPLEMENTATION REPO-TESTED`**. The benchmark-owned
`aml-semantic-backend-v1` requires an explicitly injected embedding provider and
uses the frozen `memory_engine_benchmark_embedding_cache_v1` contract with
provider/model/base-URL identity, projection version, and input hashes. Each
Add/Search operation opens and closes its own SQLite cache, LanceDB connection,
and `chunks` table below the per-user temporary root; no handles are retained
merely because a user is registered. The installed LanceDB package is exercised
against the real temporary vector store in focused tests, while the provider is
always a deterministic 2,560-dimensional fake.

Canonical vector projection v1 remains the only document-to-vector projection.
Repeated canonical materialization reuses an exact row, inconsistent rows are
repaired deterministically, and all scoped Search results must report
`vector_backend=lancedb`, `vector_stage=lancedb_search`, and vector participation
in the existing production channel fusion. Per-user Core, Engine, LanceDB, and
embedding-cache paths are physically isolated; host memory-manager fallback is
forbidden. At the I2a checkpoint, B6-I2b was next for retained-root
restart/resume and cross-store crash reconciliation. B6-I3 HTTP/Docker transport follows later. No real provider or
official AML execution occurred.

AML eligibility confirmation and any hosted execution remain later
authorization boundaries. The semantic backend is benchmark-only and does not
change production retrieval semantics.

Repository verification at B6-I1 source state:

```text
B6 focused contract tests = 16/16 PASS (15 AML adapter + 1 shared-helper contract)
complete Benchmark v1 test family = 145 PASS / 4 SKIP / 0 FAIL
documentation/current-state focused validation = 7/7 PASS
static check = PASS / 728 files
Node = v24.19.0
```

The four skipped benchmark tests are unchanged external/official contract
conditions. B6-I1 did not call a provider or AML service and did not mutate any
live runtime/data plane.

Repository verification at B6-I2a source state:

```text
B6-I2a semantic backend focused tests = 8/8 PASS
complete Benchmark v1 test family = 153 PASS / 4 SKIP / 0 FAIL
documentation/current-state focused validation = 2/2 PASS
static check = PASS / 730 files
Node = v24.19.0
real provider = NOT CALLED
official AML execution = NOT RUN
```

The complete family was also checked one file at a time under Node 24 because
the aggregate `node --test` launcher intermittently reports the existing nested
LongMemEval CLI subprocess as failed without details; that CLI file passed in
an isolated rerun. The focused semantic backend suite passed all eight tests,
including real temporary LanceDB, cache persistence, per-user isolation, and
success/error close paths. No provider, AML service, or live runtime/data plane
was used.

### B6-I2b retained-root restart and cross-store crash reconciliation

B6-I2b is **`SOURCE IMPLEMENTATION REPO-TESTED`**, closing the larger B6-I2
source stage. AML Add now uses the durable ordering
`Engine PENDING (confidence=0) → Core/FTS ensure → semantic vector materialization
when required → Engine READY (production confidence)`. The `aml_add_requests`
ledger is extended in place with `state`, `vector_required`, and `updated_at`;
legacy rows without the new fields migrate deterministically to `READY`.
Same-request `READY` retries deduplicate, while `PENDING` retries reconcile the
Engine metadata, exact Core/FTS row, and exact vector row before one atomic
READY promotion. A payload change for an existing request remains fail-closed.
Ordinary failure cleanup removes a newly created request and its partial data;
a failed retry of an already durable PENDING request preserves that invisible
PENDING state for a later reconciliation attempt.

An explicit retained-root mode persists a benchmark-owned registry manifest and
per-user ownership marker below the operating-system temporary directory.
Manifest identity binds the AML data-plane schema, semantic backend/vector mode,
provider/base-URL/model/revision/dimension, Canonical projection, embedding-cache
schema, and `max_top_k`; corruption or incompatibility fails closed. Existing
users are lazily reopened after restart, unknown users do not allocate roots,
and `close()` preserves retained roots while the explicit test cleanup method
destroys them. LanceDB, SQLite embedding-cache, and Core/Engine handles remain
operation-scoped rather than retained per registered user.

The test-only stage hook terminates a Node child process after durable PENDING,
Core, vector, or READY boundaries. Reopen tests prove all four crash cases,
pending confidence-0 visibility filtering (including mixed READY/PENDING
search), deterministic Core/FTS repair, vector-row/cache reuse, semantic Search
after restart, physical cross-user isolation, manifest mismatch/corruption
fail-closed behavior, and legacy ledger migration. This is benchmark-local
source evidence: no production Hybrid semantics were changed, no crash journal
or restart state machine beyond this bounded reconciliation contract was added,
and no real provider or official AML execution occurred.

Repository verification at B6-I2b source state:

```text
B6-I2b retained-root/reconciliation focused tests = 9/9 PASS
B6-I1 adapter focused tests = 15/15 PASS
B6-I2a semantic backend focused tests = 8/8 PASS
complete Benchmark v1 family = 162 PASS / 4 SKIP / 0 FAIL
documentation/current-state focused validation = 2/2 PASS
static check = PASS / 731 files
Node = v24.19.0
real provider = NOT CALLED
official AML execution = NOT RUN
```

The aggregate benchmark launcher continues to expose the known intermittent
nested LongMemEval CLI subprocess environment failure; the exact CLI file
passed in isolation, and the family total above is the fresh file-by-file
Node 24 result. No temporary retained root, SQLite/LanceDB data, cache, log, or
provider artifact is part of repository authority.

### B6-I3 AML HTTP and Docker transport

B6-I3 is **`SOURCE IMPLEMENTATION REPO-TESTED / CLOSED`**. The benchmark-local
transport exposes only the frozen canonical paths `GET /health`, `POST /add`,
and `POST /search`, and delegates Add/Search validation, idempotency,
PENDING→READY ordering, isolation, and production `hybridSearch()` behavior to
the existing AML adapter. Health is an unauthenticated minimal `{"status":"ok"}`
response; Add and Search return only their canonical AML envelopes. HTTP body
size is bounded at 2 MiB, `top_k<=100` remains adapter-owned, authentication
supports the official Bearer/Token/X-Api-Key schemes with constant-time key
comparison, and stable errors never return request bodies, stacks, filesystem
paths, provider details, or credentials.

The service runtime uses an env-only `SILICONFLOW_API_KEY` boundary for the
frozen semantic identity (`SiliconFlow` / `Qwen/Qwen3-Embedding-4B` / 2,560
dimensions). Provider requests are injectable for tests and the source contains
no credential discovery from host configuration. Retained state remains under
the benchmark-owned `/tmp/memory-engine-aml-data` volume; graceful SIGTERM or
SIGINT shutdown stops acceptance, drains in-flight operations, closes the
adapter, and preserves the retained root for restart. The Docker image is
Node 24, runs as non-root `node`, exposes port 8080, mounts the retained root,
and includes a minimal `/health` HEALTHCHECK without copying tests, datasets,
reports, credentials, or database artifacts.

Focused transport coverage uses localhost, temporary retained roots, the actual
installed LanceDB package, and deterministic fake 2,560-dimensional embeddings.
It proves auth/error/output contracts, in-flight shutdown, HTTP idempotency,
restart-over-HTTP Search, unknown-user no-allocation, per-user isolation,
provider-wrapper fail-closed behavior, and Docker packaging invariants. The
transport source stage did not call a real provider, AML service, public
endpoint, official AML smoke/full evaluation, or live OpenClaw data plane.
B6-S1 remains **`NEXT / LOCAL SYNTHETIC HTTP/DOCKER QUALIFICATION / NO REAL
PROVIDER`**; B6-S2 official smoke and B6-S3 full evaluation remain
`NOT AUTHORIZED`. Benchmark evidence is not production or runtime authority.

Fresh source-stage verification recorded `9/9 PASS` for the HTTP transport,
`6/6 PASS` for service/provider runtime, `2/2 PASS` for Docker contracts, and
`179 PASS / 4 SKIP / 0 FAIL` for the complete Benchmark v1 family. Documentation
and current-state validation was `7/7 PASS`; the Node 24 static check passed
`737` files. The initial permitted local Docker build qualification was
attempted once but was blocked by the environment's inability to fetch
`node:24-bookworm-slim` metadata from Docker Hub; no container was started and
the failure did not qualify source or provider behavior. That historical
environment finding is separate from the later B6-S1 Phase B native-toolchain
finding recorded by B6-I3-R2.

### B6-I3-R1 Search response disclosure boundary

B6-I3-R1 hardens the Search response boundary while preserving the existing
`B6-I3 SOURCE IMPLEMENTATION REPO-TESTED / CLOSED` status. Each Search item now
has the exact enumerable allowlist `id`, `content`, `score`, and `created_at`;
`id` and `content` are required, while `score` and `created_at` are optional.
Unknown fields such as `diagnostics`, `provenance`, `debug`, `metadata`, or
`path` fail closed as `adapter_search_response_invalid` before HTTP 200 and are
never silently stripped. `score` and numeric `created_at` values must be finite;
the existing intentionally supported `created_at=null` shape remains valid.

The fresh HTTP focused suite is `12/12 PASS`; the complete Benchmark v1 family
is `182 PASS / 4 SKIP / 0 FAIL`. B6-S1 remains
`NEXT / LOCAL SYNTHETIC HTTP/DOCKER QUALIFICATION / NO REAL PROVIDER`, and
B6-S2/S3 remain `NOT AUTHORIZED`. No provider, AML official service, Docker
deployment, runtime/live data operation, or tag operation occurred.

### B6-I3-R2 Docker Native Dependency Builder Hardening

B6-S1 Phase A is **`PASS`**. The initial B6-S1 Phase B build was
**`FAIL_WITH_FINDINGS`**: the frozen `node:24-bookworm-slim` dependencies stage
ran `npm ci --omit=dev`, but `better-sqlite3@11.10.0` had no Node 24 prebuilt
binary and its `node-gyp` fallback could not find Python or the native build
toolchain. The bounded B6-I3-R2 correction adds `python3`, `make`, and `g++`
with `--no-install-recommends` before `npm ci`, then removes
`/var/lib/apt/lists/*`. Node, dependency versions, package-lock, LanceDB,
AML runtime/service, and production retrieval code remain unchanged.

The final runtime remains an independent `node:24-bookworm-slim` stage and
copies only the dependencies-stage `node_modules` plus the application files.
The Docker contract test proves the builder install/cleanup and runtime
boundary without unrelated-whitespace coupling; the runtime stage contains no
`apt-get install`. Node 24 verification passed the Docker contract, HTTP
`12/12`, service/provider runtime `6/6`, full Benchmark family
`182 PASS / 4 SKIP / 0 FAIL`, static check over `737` files, and
`git diff --check`. The real build
`memory-engine-aml:b6-i3-r2` passed; both `better-sqlite3` and
`@lancedb/lancedb` loaded as `NATIVE_RUNTIME_OK`, default container UID was
`1000`, and `python3`, `make`, `g++`, and apt-cache entries were absent from
the final image.

B6-I3-R2 is **`SOURCE IMPLEMENTATION REPO-TESTED / DOCKER BUILD QUALIFIED`**
and B6-I3 is **`CLOSED`**. B6-S1 is **`RETRY READY / PHASE B→D REMAINING`**;
this source/image acceptance does not execute or close B6-S1. B6-S2 official
smoke, B6-S3 full evaluation, real provider access, deployment, live runtime
data, and tagging/pushing remain out of scope and unauthorized.

### B6-I3-R3 Docker Runtime Module Closure Hardening

B6-I3-R2 is **`PASS / DOCKER NATIVE DEPENDENCY PACKAGING FIXED`** and
B6-S1 Phase B is **`PASS`**. The initial B6-S1 Phase C attempt was
**`FAIL_WITH_FINDINGS`**: the real AML container exited with
`ERR_MODULE_NOT_FOUND` because the runtime image omitted root `query-utils.js`,
which `lib/recall/hybrid-search.js` imports as `/app/query-utils.js`.

The bounded R3 correction adds `COPY query-utils.js ./` to the independent
runtime stage. The Docker contract freezes the complete minimal runtime COPY
surface as package manifests, `query-utils.js`, `bin/`, `lib/`, and the
dependencies-stage `node_modules`; `COPY . .` is forbidden. The R2
dependencies/runtime split and `USER node`, port, retained volume,
HEALTHCHECK, and CMD contracts remain unchanged.

Node 24 focused and full Benchmark verification passed. The rebuilt image
`memory-engine-aml:b6-i3-r3` passed `SERVICE_IMPORT_OK`,
`NATIVE_RUNTIME_OK`, and non-root UID validation. No real provider, official
AML execution, deployment, live runtime/data operation, or Gateway/config/plugin
change occurred.

B6-I3-R3 is **`SOURCE IMPLEMENTATION REPO-TESTED / DOCKER RUNTIME CLOSURE
QUALIFIED`** and B6-I3 is **`CLOSED`**. At this historical checkpoint B6-S1 was
**`RETRY READY / PHASE C→D REMAINING`**; the local synthetic qualification below
supersedes that retry-ready state.

### B6-S1 Local Synthetic HTTP/Docker Qualification

B6-S1 is **`PASS / CLOSED`** at repository source
`b2063f4531a5b0136de33ffee7e31c5235017028`. Phase A had already qualified the
host executable with a localhost deterministic fake embedding provider. After
R2/R3 closed the native dependency and runtime file-closure findings, the Docker
retry used the real `Dockerfile.aml` image, benchmark HTTP service, actual
temporary SQLite/LanceDB state, a dedicated local Docker network, a named
retained-state volume, and a deterministic local 2,560-dimensional fake
embedding endpoint. No real provider was contacted.

Phase C passed the external service boundary: `GET /health` returned
`{"status":"ok"}`; unauthenticated Search returned HTTP `401` with
`authentication_required`; Add succeeded; Search returned the added synthetic
memory; the deterministic fake provider had exactly `2` calls after Add plus
Search; retrying the same Add `request_id` returned the same success without a
third provider call; and Search for an unknown `user_id` returned `{"data":[]}`
while the retained root remained at exactly one user directory.

Phase D passed restart persistence. The first AML container stopped through
Docker SIGTERM handling with exit `0`. The named volume retained `manifest.json`,
per-user Core SQLite, Engine SQLite, `embedding-cache.sqlite`, and the user
manifest. A fresh second AML container started against the same volume and,
without re-Add, returned the same memory id/content/score. Fake-provider call
count remained `2`, proving persistent query-embedding cache reuse across the
container restart. The second container also stopped with exit `0`; before
cleanup the manifest and single user root still existed, after which the
synthetic containers, network, and volume were removed.

This closure is local synthetic qualification only. Real SiliconFlow provider
calls, official AML service/evaluation, public deployment, live OpenClaw
Core/Engine/LanceDB mutation, Gateway/config/plugin changes, and tag/push
operations were not performed. B6-I3 remains **`CLOSED`**. B6-S2 official AML
smoke and B6-S3 full evaluation remain **`NOT AUTHORIZED`**.

## Post-Benchmark product interpretation for memory-engine 1.1

The accepted post-1.0 interpretation is **memory-engine 1.1 — Recall Quality**.
Benchmark v1 remains offline evaluation evidence; it does not authorize a
production heuristic, vector gate, ranking weight, runtime configuration,
provider request, live data mutation, deployment, or tag.

B3 and B4 show that semantic/vector retrieval is useful but insufficient. On
LongMemEval-S, B3 lexical → B4 semantic moved Recall-any@5
`0.7876 → 0.8138`, Recall-all@5 `0.4821 → 0.5227`, Recall-all@10
`0.6372 → 0.6826`, and NDCG-any@10 `0.6256 → 0.6552`, while mean retrieval
latency moved `9.49 ms → 205.11 ms` (`~21.6×`). Semantic retrieval improves
some low-overlap queries but does not by itself close preference,
multi-session, temporal, multi-evidence, or small-topK ranking gaps.

The corrected B5 LoCoMo case-level comparison records:

| Metric | Improved | Regressed | Unchanged |
|---|---:|---:|---:|
| First relevant rank | 801 | 46 | 1,125 |
| Recall-any@10 | 141 | 3 | 1,828 |
| Recall-all@10 | 110 | 1 | 1,861 |
| Recall-any@50 | 436 | 3 | 1,533 |

This is broadly non-regressive cross-dataset evidence, but most cases are
unchanged and the useful gains are concentrated. It supports research into
selective semantic fallback, not unconditional production vector retrieval.
B6-S1 independently closes only the local synthetic AML HTTP/Docker data-plane
contract; B6-S2/S3 remain an optional evaluation branch and do not block 1.1.

### Small-budget product metrics

Future retrieval experiments add Recall-any@3, Recall-all@3, NDCG@3, first
relevant rank, answer-evidence coverage@3, cross-session complete-evidence
coverage, stale/conflicting evidence in top 3, unnecessary-recall and
context-pollution rates, and p50/p95 latency. Recall@50 and large candidate-pool
coverage remain diagnostics rather than standalone production success gates.
Gold evidence remains evaluator-only and must not enter memory Add, Search,
embedding, query planning, ranking, or answer prompts.

### Minimal channel ablation

The bounded matrix is:

| Profile | Decision purpose |
|---|---|
| Lexical only | Freeze the low-latency baseline |
| Vector only | Measure independent semantic capability |
| Lexical + Vector | Preserve the B4 hybrid comparison |
| Lexical + Metadata | Measure entity/project/temporal marginal value |
| Lexical + Session/Episode expansion | Measure multi-evidence recovery |
| Full candidate fusion | Test channel complementarity |
| Lexical → selective Vector fallback | Test quality/latency production candidate |

Each profile reports preference, multi-session, temporal, knowledge-update,
single-session-user, and single-session-preference families, plus @3 metrics,
first-rank and case-level deltas, p50/p95 latency, vector invocation rate, and
marginal gain per expensive call. Do not expand the core matrix into all `2^N`
channel combinations, broad embedding-model comparisons, unconditional
multi-query, large Recall Hint grids, or Recall@50-only comparisons.

Recall Hint remains a later independent experiment defined only as candidate
expansion and soft weighting metadata. It cannot grant recall, skip, or hard
filter authority. The original query is retained and hint failure falls back to
the original retrieval path. RH1 and H2 remain closed and are not rerun or
renamed to seek a passing threshold.
