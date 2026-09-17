# memory-engine Q4 — Recall Hint v1

Status: `Q4-A CONTRACT FROZEN / Q4-B SOURCE CLOSED / Q4-C0 CLOSED / Q4-C1a V2 CORPUS + MANIFEST FROZEN / BASELINE ELIGIBILITY PASS / Q4-C1b DEVELOPMENT PRODUCER EXECUTION PASS / DEVELOPMENT RETRIEVAL-EFFECT PASS / CANDIDATE RECOVERY CONFIRMED / ACCEPTANCE NOT AUTHORIZED`

## 1. Product question

Q4 asks whether bounded query understanding can recover candidate evidence that the original user wording misses without turning query understanding into a new recall authority.

Recall Hint v1 is therefore **candidate-expansion metadata only**. It may add bounded retrieval queries and later support soft weighting, but it cannot decide whether recall runs, suppress the original query, hard-filter candidates, grant disclosure authority, choose final topK, or write memory/confidence state.

Q4 v1 does not claim to solve all multi-hop failures. Candidate expansion may recover missing evidence; top3 capacity, set-aware evidence selection, and answer reasoning remain separate problems.

## 2. Q4-A scope

Q4-A freezes only:

1. the Hint data contract;
2. the explicit-search consumption seam;
3. reuse boundaries for the existing bounded multi-query vector path;
4. candidate/call budgets and fallback invariants.

Q4-A does **not** add a real planner, provider call, benchmark run, live configuration, AutoRecall integration, DB/LanceDB mutation, or deployment.

### Q4-B implementation status

Q4-B is now source-implemented with fake/injected providers only. The source adds the v1 validator/normalizer, deterministic bounded Hint-to-query planner, explicit-search-only provider injection, `recall_hint_v1` vector-plan mode, bounded structured debug, and explicit forwarding of the plan into `hybridSearch()`. The historical H2 exactly-two expansion contract remains unchanged.

Acceptance review found and repaired two source gaps before closure: a stale `boundedMultiQueryEnabled` identifier in the embedding-unavailable branch, and Q4's initial inheritance of H2 all-or-nothing vector failure semantics. `recall_hint_v1` now falls back to the original-query vector path when its plan or expansion execution fails, while historical H2 retains its prior behavior. Focused Q4 tests pass `11/11`; affected Hybrid/runtime/tool/AutoRecall regressions pass `86/86`.

No real provider request, runtime/config mutation, DB/LanceDB mutation, deployment, or AutoRecall Hint integration occurred. The injected Q4-B provider seam uses a local bounded timeout only for source testing; a future real-provider adapter must own an abortable/deadline-bound transport before Q4-C/provider execution is considered.

## 3. v1 Hint contract

```js
{
  version: "recall_hint_v1",
  project?: string,
  entities?: string[],
  time_relation?: {
    relation: "before" | "after" | "during" | "latest" | "earliest",
    anchor?: string
  },
  query_facets?: string[]
}
```

Bounds:

- `project`: at most 96 code points;
- `entities`: at most 4 values, each at most 96 code points;
- `time_relation.anchor`: at most 96 code points;
- `query_facets`: at most 2 values, each at most 120 code points;
- unknown fields are rejected by the validator;
- empty/whitespace-only optional values normalize away;
- an otherwise valid empty Hint is allowed and means “no expansion”.

`memory_kind`, episode, expected evidence count, date ranges, and other future fields are deliberately excluded from v1 until a concrete consumer exists.

## 4. Producer input boundary

A future Hint producer may consume only:

- the current explicit-search query; and
- explicitly supplied bounded context from the caller.

It must not scan the full session, memory corpus, hidden system/developer content, tool traces, or arbitrary conversation history on its own.

Bounded caller context may later include short structured values such as an active project name or recent entity names. Q4-A does not define a host adapter for that context and Q4-B may begin with query-only fake providers.

## 5. Field semantics

### `project`

Adds a soft project/entity term to expansion queries. It is never a path filter, namespace filter, or disclosure scope.

### `entities`

Adds explicit entity names useful for resolving underspecified references such as “那个插件”. Entity hints are soft query terms only and do not authorize graph traversal or hard entity matching.

### `time_relation`

Expresses a relation such as “before migration” or “latest configuration”. The producer must not invent an exact date when the input/context provides no date evidence. In v1 the relation is serialized only into expansion-query text; it does not become a hard timestamp predicate.

### `query_facets`

Represents at most two independent retrieval aspects, for example “选择理由” and “限制”. Facets may produce separate expansion queries so multiple evidence aspects can enter the candidate pool.

## 6. Query-plan invariant

The original user query is always retained and searched.

A normalized Hint may produce **0..2 additional queries**. Therefore a Q4 v1 vector search executes at most three query searches in total:

```text
1 original query
+ 0..2 expansion queries
= 1..3 total vector queries
```

Expansion normalization rules:

- trim whitespace;
- enforce a bounded query length;
- remove empty expansions;
- remove exact duplicates;
- remove expansions equal to the original query;
- duplicate/empty expansion output is a legal no-op, not a whole-plan failure.

No valid expansion means the existing original-query retrieval path is used unchanged.

## 7. Existing multi-query reuse

The current vector channel already provides useful reusable machinery:

- multiple embedding/search executions;
- per-query candidate collection;
- ID deduplication;
- deterministic tie breaking;
- bounded RRF fusion;
- final vector candidate bounding;
- debug counters/hashes.

However the historical H2 input contract must **not** be promoted unchanged. Its current `vectorQueryPlan` handling requires exactly two distinct non-empty planner queries in addition to the original query, and rejects the whole plan when either expansion is empty, duplicated, or equals the production query. H2 was closed as `INSUFFICIENT` after that strict contract failed on the official dataset.

Q4-B should preserve historical H2 compatibility and introduce an explicit Q4 mode, for example:

```js
{
  mode: "recall_hint_v1",
  queries: [/* 1..2 normalized expansion queries */]
}
```

The existing legacy/H2 shape can keep its frozen strict behavior for historical benchmark reproducibility. Q4 mode accepts 1..2 expansions; zero expansions should result in no plan being passed.

## 8. Explicit-search-only seam

Q4-B should attach Hint generation/consumption at the explicit `memory_engine_search` runner, not inside shared `hybridSearch()` policy.

Current call shape:

```text
memory_engine_search
  -> createSearchRunner()
  -> buildHybridSearchRuntime()
  -> hybridSearch()
```

Planned Q4-B shape:

```text
memory_engine_search
  -> optional injected RecallHint provider (fake in Q4-B)
  -> validate/normalize RecallHint
  -> build bounded recall_hint_v1 vector query plan
  -> buildHybridSearchRuntime(..., { vectorQueryPlan })
  -> hybridSearch()
```

`buildHybridSearchRuntime()` currently forwards explicit-search rerank overrides but not `vectorQueryPlan`; Q4-B may add this one explicit override.

AutoRecall also consumes `hybridSearch()`. It must remain unchanged during Q4-A/B: no Hint provider call, no new vector query plan, and no additional provider/network cost on normal chat turns.

## 9. Candidate and cost budgets

Q4 v1 keeps the current downstream product comparison conditions:

- final explicit-search `topK = 3` unless caller requests another already-valid bounded value;
- explicit rerank candidate depth remains `20`;
- existing reranker/provider configuration is unchanged;
- final vector candidate count remains bounded by the existing vector-channel limit;
- Hint adds at most two vector embedding/search calls;
- Q4-B uses fake/injected Hint providers only and adds zero real planner/provider calls.

Query expansion does not guarantee preservation of every original-query candidate. Q4-C must explicitly measure cases where expanded fusion displaces a previously useful original-query candidate.

## 10. Failure and authority rules

Any Hint failure is fail-open to **original retrieval**, not fail-open to broader authority:

- provider absent -> original query only;
- provider throws -> original query only;
- malformed Hint -> original query only;
- empty Hint -> original query only;
- all expansions deduplicate away -> original query only;
- expansion query embedding/search failure -> preserve the existing vector-path fallback contract; do not grant new fallback authority.

Hint output cannot:

- grant or deny recall;
- bypass structural/runtime gates;
- hard-filter FTS/KG/Recent/vector candidates;
- grant Owner/disclosure capability;
- set final ordering directly;
- modify confidence/reinforcement;
- persist Hint data as memory.

## 11. Q4-B source task

Q4-B is a source-only seam with fake providers. Expected implementation surface:

- add a pure `recall_hint_v1` validator/normalizer;
- add a pure Hint -> bounded query-plan builder;
- preserve historical H2 query-plan semantics under its existing shape;
- add `recall_hint_v1` mode to vector-plan resolution with 1..2 expansions;
- allow `buildHybridSearchRuntime()` to forward an explicit `vectorQueryPlan` override;
- add an optional injected RecallHint provider to explicit search only;
- add focused tests for empty, duplicate, malformed, timeout/throw, 1-expansion, 2-expansion, original-query preservation, and candidate-displacement visibility;
- do not add a real provider implementation or runtime config switch.

## 12. Q4-C acceptance contract

Q4-C compares Hint off/on using isolated development and acceptance sets under the same downstream retrieval/rerank settings. Q4-C is split into two bounded steps:

- **Q4-C0 — evaluation contract / zero-provider harness:** source-only evaluator, synthetic contract smoke, no product-quality claim;
- **Q4-C1 — isolated real-effect execution:** frozen development/acceptance manifests, real Hint producer if separately authorized, and no AutoRecall/runtime deployment.

### Q4-C0 implemented contract

`lib/benchmark/q4-recall-hint-evaluation-v1.js` reuses the frozen Q1 `scoreQ1EvidenceRankingAt3()` scorer and fixes:

- candidate depth at `20`;
- final evidence budget at `topK=3`;
- one Hint-producer call maximum per case;
- at most two additional embedding calls and two additional vector searches per case;
- pool evidence coverage and `POOL_MISS` accounting;
- Recall-any@3, Recall-all@3, NDCG@3 and evidence-coverage@3;
- paired improve/regress/unchanged transitions;
- end-to-end p95 latency;
- provider calls/tokens, extra vector work, and fallback rate;
- separate development, acceptance, family, and protection summaries.

Hint failures/fallbacks remain in aggregate statistics. The synthetic smoke is contract evidence only and is not Q4 quality evidence.

The technical stop conditions are deliberately narrow and frozen before a real producer is selected:

1. acceptance pool evidence coverage must not decrease;
2. acceptance `POOL_MISS` count must not increase;
3. acceptance Recall-any@3 and Recall-all@3 must not decrease;
4. paired Recall-all@3 improvements must exceed regressions;
5. protection samples must show no pool-coverage, `POOL_MISS`, Recall-any@3, or Recall-all@3 regression.

Latency and provider/token cost are always reported, but Q4-C0 does not invent a provider-specific SLA before a real producer exists. Q4-D will decide whether measured quality gain is worth the observed latency/cost.

### Q4-C1 split integrity

Before any real-effect execution, development and acceptance inputs must be frozen as separate manifests with exact SHA-256 identities. The development split may be used to repair implementation defects or tune the producer contract. Once the acceptance manifest is first read for scoring, it must not be used to tune prompts, Hint fields, thresholds, reranker settings, topK, candidate depth, or acceptance gates. Any such change requires a new acceptance set rather than re-labeling the old one as independent evidence.

Protection samples where the original query is already sufficient are mandatory. Existing Q3 datasets remain historical/regression evidence and must not be repeatedly tuned and then presented as independent Q4 generalization evidence.

Only three product questions matter:

1. **Candidate completeness:** fixed-depth gold evidence coverage and `POOL_MISS` changes;
2. **Final usefulness:** Recall-any@3, Recall-all@3, and paired improve/regress/unchanged counts;
3. **Cost:** end-to-end p95, added planner/embedding/search calls or tokens, and failure/fallback rate.

### Q4-C1a frozen corpus and manifest

Q4-C1a uses a fresh targeted synthetic retrieval corpus rather than reusing the Q0 `RANK_MISS` set as the primary Q4 sample. `RANK_MISS` already means the gold evidence entered the historical candidate pool, while Recall Hint's primary hypothesis is candidate recovery when underspecified wording causes evidence to miss the bounded pool.

The C1a corpus contains `48` cases and `72` synthetic memory records across four equal families (`12` each): `entity_reference`, `temporal_relation`, `multi_facet`, and `protection`. A fixed family-stratified salted-SHA256 policy assigns `4` cases per family to development and `8` per family to acceptance, producing `16` development and `32` acceptance cases without manual result-aware selection.

The first frozen corpus (`q4c1-fresh-synthetic-v1`) was invalidated before any Hint producer execution: a zero-provider lexical-control baseline preflight showed target-family headroom but only `6/8` acceptance protection cases in the depth-20 pool and `3/8` complete at top3. Because no Hint output had been generated or scored, C1a was repaired only at the corpus-validity boundary by making protection memory statements explicitly contain their already-specific query semantics. Target cases, case IDs, split salt/method, family counts, gold IDs, and Hint contract were unchanged. The superseding frozen corpus is `q4c1-fresh-synthetic-v2`.

Frozen v2 identities:

```text
corpus_sha256      = 834a958fca9fafdd60aaec6d49d4dff2b5d7fa6ec1c2344bf6cc84e8710fad6f
development_sha256 = 787696c8081a4b06417a88f69e917ebb7b93880c0861abe8e43423858855e141
acceptance_sha256  = 6cfeafcfda817db68100efcf89d5be70f57d37c2eb34826b601f5b3a7fe5786e
manifest_sha256    = 8a9074dbccbc37f05ae6a26ee17dd810da641baa157cff02d4bf54719e2af247
```

The future producer packet exposes only `case_id`, the current `query`, and bounded caller context (`active_project`, up to four `recent_entities`, and optional `temporal_anchor`). Gold evidence IDs and corpus memory records are never part of producer input. Any corpus text, gold, split salt, query, bounded context, or producer-input drift changes the frozen manifest identity and fails the source contract.

Q4-C1b must execute a Hint-off baseline before any Hint producer result is scored. All acceptance `protection` cases must already have complete baseline pool coverage and `Recall-all@3=1`; otherwise they are not valid protection cases and execution stops before Hint-on scoring. Across each of the three target families, at least one acceptance case must exhibit baseline `POOL_MISS`; if a target family has `POOL_MISS=0`, that family has no observable candidate-recovery headroom and execution stops rather than manufacturing a quality claim.

The v2 zero-provider lexical-control preflight now passes this eligibility boundary. Acceptance contains `18/32` pool misses overall: `7/8` entity-reference, `4/8` temporal-relation, and `7/8` multi-facet cases miss at least one gold item from the bounded pool, while protection is `8/8` pool-complete and `8/8` Recall-all@3. This is corpus/headroom evidence only (`ZERO_PROVIDER_LEXICAL_CONTROL_PREFLIGHT_ONLY`), not Q4 product-quality evidence and not a substitute for the fixed real-provider baseline required for Hint-on comparison.

The C1a corpus is targeted synthetic product evidence. It is independent of Q3 tuning data, but it is not a claim of LongMemEval/LoCoMo or broad conversational generalization. Historical datasets may remain regression/development evidence only.

### Q4-C1b provider contract

The C1b producer contract remains provider-neutral at its generic boundary, while the selected experiment binding is frozen separately as SiliconFlow `deepseek-ai/DeepSeek-V4-Flash` at `https://api.siliconflow.cn/v1/chat/completions`. Development-only real egress has now executed under the frozen v2 manifest and clean source commit; acceptance egress remains unauthorized. The producer sees only the current query plus the C1 bounded caller context; gold IDs, memory text, retrieval results, full session content and tool traces remain explicit egress denials.

Frozen producer identity:

```text
prompt_version       = q4_recall_hint_producer_prompt_v1
prompt_sha256        = 377cde9a388a2ba0115a20eb4132c6edb207b98ccfd4f5116f8ce64cb59aec95
output_schema_sha256 = 237bf7f7b7601715f9030b134f725ff8cde4cf1d9392ec993d9b078f1661d5a2
manifest_sha256      = 8a9074dbccbc37f05ae6a26ee17dd810da641baa157cff02d4bf54719e2af247
```

The prompt instructs the producer to use only supplied input, never answer the user question, never invent missing context, omit unsupported Hint fields, and return strict `recall_hint_v1` JSON. An otherwise empty Hint (`{"version":"recall_hint_v1"}`) is valid. Output is revalidated through the same production Hint validator before scoring.

Frozen execution envelope:

- maximum provider requests: `48` total = `16` development + `32` acceptance;
- maximum input tokens: `2048` per request / `98,304` total;
- maximum output tokens: `256` per request / `12,288` total;
- maximum response size: `16,384` bytes;
- hard request deadline: `15,000ms` with `AbortSignal` supplied to the injected transport;
- temperature: `0`;
- cost accounting is currency-neutral in the generic packet (`billing_currency`, `input/output_price_per_million`, `max_cost`);
- the selected SiliconFlow binding uses `CNY`, non-discounted/non-cache-hit prices `¥3/M` input and `¥9/M` output, producing a theoretical full-envelope maximum of `¥0.405504` and a hard experiment cap of `¥0.50`;
- one frozen acceptance execution, with `acceptance_replay_count=0`.

The selected SiliconFlow request/response adapter binds `response_format={type:"json_object"}`, disables thinking for this bounded extraction task, maps provider `prompt_tokens/completion_tokens` into Q4 accounting, and deliberately excludes provider `reasoning_content` from the C1b result. The development execution layer uses the existing `SILICONFLOW_API_KEY` environment-variable name, exact endpoint/model matching, abortable HTTPS, atomic progress persistence, and ambiguous-inflight fail-closed resume. Development output may still be used to adjust the producer before acceptance begins, but any prompt/schema/model/query-plan/gate change after formal acceptance starts invalidates that acceptance run.

The selected pricing basis is the provider's 2026-09-01 DeepSeek-V4-Flash time-of-day schedule, frozen at the more expensive non-discounted interval so packet validity does not depend on execution hour. Provider model revision is `null` because the public API model identifier does not expose a revision-qualified ID.

Owner authorization dated 2026-09-17 now permits **development only** real-provider execution for the frozen SiliconFlow `deepseek-ai/DeepSeek-V4-Flash` binding. The authorized envelope is `16` development requests, `0` acceptance requests, at most `32,768` input tokens, `4,096` output tokens, `CNY 0.15` total cost, `15s` per-request deadline, `256` output tokens per request, `temperature=0`, and `enable_thinking=false`. Egress remains limited to current query plus bounded caller context; memory records, gold IDs, retrieval results, full session content and tool traces remain denied.

The source now includes a development-only execution guard, exact-env credential preflight, abortable HTTPS transport, atomic progress persistence, and fail-closed resume semantics. Progress writes `inflight_case_id` before egress; any restart with an ambiguous in-flight case stops instead of automatically reissuing that request. The runner records only validated RecallHint output, bounded expansion plans, latency and usage/cost accounting. It does not authorize or perform acceptance execution.

Because this authorization forbids external disclosure of synthetic memory text, the development run does not add remote embedding/rerank calls. It evaluates real Hint-producer validity, structured-field/expansion behavior, latency, tokens and cost. A production-equivalent candidate-recovery comparison that requires remote vectorization of the synthetic corpus would require a separate egress authorization; this development authorization does not imply it.

The execution packet requires a clean committed source identity. Development execution used source commit `6e86192acb77839fa50e92ac5f5ba22cc63daa29` after preflight confirmed the frozen manifest, provider/model/endpoint, prompt/schema hashes, credential binding and development-only budgets. Acceptance Hint-on execution, AutoRecall integration, live deployment, runtime/config mutation, DB/LanceDB mutation, push and tag remain unauthorized.

### Q4-C1b development producer result

The first authorized HTTP attempt for `q4c1-entity-01` failed with provider `HTTP 401` because the initially configured credential was not a SiliconFlow `sk-` key. No model usage or cost was returned. Owner then authorized one credential-failure retry, increasing the HTTP-attempt ceiling from `16` to `17` while preserving the successful-case limit (`16`), token budgets, `CNY 0.15` cost cap, egress scope and all other boundaries. The failed-attempt progress record was preserved; the retry run used a separate progress file rather than erasing the ambiguous in-flight evidence.

The retry-authorized development run completed `16/16` frozen development cases successfully with result SHA-256 `c13eef93f369f56c3fc254718479cd4bbaca55a34adecd0726ba7f3ebd3359c5`. All `16` outputs passed strict RecallHint validation. All `4/4` protection cases returned the empty Hint and generated zero expansions. All `12/12` target cases bound the supplied project/entity context; all `4/4` temporal cases preserved the correct before/after relation. The run produced `19` total expansion queries. Field counts were `project=12`, `entities=12`, `time_relation=4`, `query_facets=12`.

Successful-call usage was `5,296` input tokens and `564` output tokens for `CNY 0.020964`. Including the earlier credential-rejected attempt, total HTTP provider attempts were `17`; successful model calls remained `16`, and the failed attempt contributed no accounted model tokens or cost. Successful-call latency was approximately `538ms` minimum, `1,969ms` p50, `7,312ms` p95/maximum, and `3,142ms` mean, all within the frozen `15s` per-request deadline.

Development output contains a few low-specificity but bounded facets such as `plugin`, `settled on`, or `post-migration`; because every such expansion still retains the original query plus the supplied project/entity/temporal context, the development evidence does not justify changing the frozen prompt before retrieval-effect measurement. **Producer qualification is therefore PASS without prompt revision.**

This result is not candidate-recovery evidence. The development authorization explicitly denied external disclosure of synthetic memory records and did not authorize remote embedding or rerank calls, so no production-equivalent Hint-off/Hint-on semantic retrieval comparison was performed. Q4 must not proceed to acceptance producer execution as if retrieval quality were already established; the next product evidence gap is a separately authorized development retrieval-effect measurement under a frozen semantic/rerank profile.

### Q4-C1b development retrieval-effect contract

The completed development Hint outputs are now frozen as source data rather than regenerated for retrieval-effect work. The producer result SHA-256 remains `c13eef93f369f56c3fc254718479cd4bbaca55a34adecd0726ba7f3ebd3359c5`; the normalized `case_id + validated Hint + deterministic query plan` fixture has SHA-256 `c6400bf9933271a48175b6a0be63533e71299b350fe6ba42ce04e69a2504c346`. The fixture contains exactly `16` development cases, `19` expansion queries and `4` empty protection Hints.

Recall Hint expansion is consumed only by the vector channel. Therefore a lexical Hint-on replay would test behavior that the product does not implement and is not valid Q4 evidence. The next valid development diagnostic freezes the production-aligned semantic/rerank path: SiliconFlow `Qwen/Qwen3-Embedding-4B` at dimension `2560`, canonical vector projection v1 with at most `2000` characters per memory, candidate depth `20`, final topK `3`, and the existing SiliconFlow `Qwen/Qwen3-Reranker-0.6B` profile (`4000` code points per candidate, `48000` total, `2500ms`). Baseline and Hint arms must use the same profile and one shared embedding cache.

For the frozen development outputs, the semantic request ceiling is `107` embedding requests: at most `72` synthetic corpus projection inputs + `16` original-query inputs + `19` Hint-expansion inputs. The Hint arm must reuse cached original-query embeddings rather than issuing a second original-query request. Rerank is bounded at `32` requests: at most `16` baseline + `16` Hint. Producer requests are `0`; acceptance cases are `0`.

Embedding egress may contain only synthetic canonical vector-projection text, development original queries and development Hint-expansion queries. Rerank egress may contain only the development original query and bounded canonical candidate text. Gold evidence IDs, case labels, acceptance cases, full session/tool traces and all live memory are denied. Only temporary benchmark Core/Engine/LanceDB/cache artifacts may be created; live Core/Engine/LanceDB and runtime/config mutation remain denied.

The retrieval-effect cost binding is now frozen in USD, matching the existing R3-C1 benchmark accounting convention against the same `api.siliconflow.cn` provider surface. Current SiliconFlow model-page pricing binds `Qwen/Qwen3-Embedding-4B` at `$0.02/M` input tokens and `Qwen/Qwen3-Reranker-0.6B` at `$0.01/M` input tokens; the latter is independently consistent with the project's prior R3-C1 0.6B observed billing. The budget is intentionally computed from API/adapter maximum token envelopes rather than the much shorter synthetic inputs: embedding `107 × 32,768 = 3,506,176` input tokens (`$0.07012352`), rerank `32 × 20 × 12,288 = 7,864,320` conservative pair tokens (`$0.07864320`), theoretical total `$0.14876672`, hard cap `$0.20`.

Candidate generation is also frozen rather than inferred at execution time: FTS + Vector enabled, KG/Recent disabled for this synthetic materialization, lexical-confidence threshold `0.7`, vector search depth `50`, bounded candidate depth `20`, final topK `3`. The execution harness uses the production `hybridSearch()` vector-plan/RRF path, canonical vector projection, shared exact-input embedding cache, and the existing offline canonical 0.6B rerank profile. It captures the depth-20 pool with a no-rerank search and the final top3 with an otherwise identical reranked search; the second search must hit the shared embedding cache and cannot increase provider embedding requests.

The source now includes an exact-credential SiliconFlow embedding adapter (`2560` dimensions, `15s` deadline, `512KiB` response cap), reuse of the established 0.6B rerank adapter, and a clean-source CLI preflight. Provider attempts are counted before egress; no automatic retry or resume is supported, so any interrupted/failed semantic run stops and requires a new Owner authorization before re-execution. None of this source work authorizes acceptance execution.

### Q4-C1b development retrieval-effect result

Owner-authorized development semantic retrieval-effect execution completed once under clean source commit `4ee4374c31cd41149298b528958e60f42004dc37`. The run remained development-only (`16/16` cases, `0` acceptance), used `103/107` allowed embedding requests and exactly `32/32` rerank requests, and produced result identity `5d51c8258b5842de9be91b074af64931525ad6fd6fa64972326d8136a32fac89`. Its conservative provider-envelope cost upper bound was `$0.14614528`, below the frozen `$0.20` hard cap. No automatic retry/resume occurred.

The production-aligned semantic path shows a clear candidate-recovery effect. Development pool evidence coverage increased from `0.71875` to `0.96875`, and `POOL_MISS` fell from `6` to `1`: five of six baseline pool misses were recovered. Final top3 gains were positive but substantially smaller: Recall-any@3 `0.5000 -> 0.5625`, Recall-all@3 `0.3125 -> 0.3750`, NDCG@3 `0.39416085 -> 0.43359396`, and evidence coverage@3 `0.40625 -> 0.46875`. Paired final-quality transitions were `1 improved / 0 regressed / 15 unchanged` for Recall-any@3, Recall-all@3, NDCG@3 and evidence coverage@3. Hint-arm p95 latency was approximately `763.2ms` versus `644.8ms` baseline (`+118.4ms`).

The family split localizes the remaining limitation. Entity-reference pool coverage improved `0.75 -> 1.00` and Recall-any@3 `0.25 -> 0.50`; multi-facet pool coverage improved `0.625 -> 0.875` while Recall-any@3 stayed `0.75`; temporal-relation pool coverage improved `0.50 -> 1.00` while Recall-any@3 remained `0`. All `4/4` development protection cases remained pool-complete and top3-complete. The development evidence therefore supports **candidate recovery by Recall Hint**, while also showing that downstream reranking/final serving can prevent recovered candidates from entering the final top3. It does not justify tuning the producer, query plan, candidate depth, topK or reranker against the development split before acceptance.

The frozen Q4 technical stop conditions are acceptance conditions, so this development-only run reports them as `NOT_EVALUABLE` solely because `acceptance_split_empty`. That is expected scope behavior, not a product failure. Q4-C1b remains open until an independently authorized acceptance execution is completed; AutoRecall/runtime/config/live Core/Engine/LanceDB/deployment/push/tag remain outside this evidence.

### Q4-C1b next acceptance decision

The next bounded product decision is whether the frozen Recall Hint producer plus frozen semantic/rerank profile reproduces the development candidate-recovery benefit on the untouched `32`-case acceptance split without protection regressions. No development tuning is authorized before that decision.

An acceptance execution should be one frozen transaction with no human tuning boundary between producer output and semantic scoring. The existing producer contract permits at most `32` acceptance producer requests (`2048` input / `256` output tokens per request; acceptance-only maxima `65,536` input and `8,192` output tokens). At the selected SiliconFlow non-discounted rates this has a theoretical acceptance-producer ceiling of `CNY 0.270336`; a proposed execution hard cap is `CNY 0.30`.

For semantic scoring, the untouched acceptance split has `32` original queries and Recall Hint permits at most `2` expansion queries per case. A conservative acceptance semantic envelope is therefore at most `72` synthetic canonical corpus embeddings + `32` original-query embeddings + `64` expansion embeddings = `168` embedding requests, plus `32` baseline and `32` Hint rerank requests = `64` rerank requests. Using the same maximum-token accounting as development, that bounds embedding cost at `$0.11010048`, rerank cost at `$0.15728640`, theoretical semantic total at `$0.26738688`; a proposed semantic hard cap is `$0.30`. Exact request ceilings may be tightened after the acceptance Hint outputs are generated inside the same transaction, but must never be increased above these precommitted maxima.

Acceptance egress must retain the existing boundaries: producer sees only acceptance current query plus bounded caller context; embedding sees only the `72` synthetic canonical projection texts, acceptance original queries and generated bounded expansion queries; rerank sees only acceptance original query plus bounded synthetic canonical candidate text. Gold IDs, case labels, full sessions, tool traces and live memory remain denied. Only temporary benchmark DB/Lance/cache/progress artifacts are permitted. No automatic retry, resume, replay, prompt/schema/model/query-plan/gate change, runtime mutation, deployment, push or tag is part of this proposed packet. Execution still requires separate explicit Owner authorization bound to the exact clean source HEAD that contains the final acceptance harness.
