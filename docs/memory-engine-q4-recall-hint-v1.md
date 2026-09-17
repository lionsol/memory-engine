# memory-engine Q4 — Recall Hint v1

Status: `Q4-A CONTRACT FROZEN / Q4-B SOURCE CLOSED / Q4-C0 CLOSED / Q4-C1a V2 CORPUS + MANIFEST FROZEN / BASELINE ELIGIBILITY PASS / Q4-C1b PROVIDER CONTRACT FROZEN / PROVIDER SELECTION + REAL EXECUTION NOT AUTHORIZED`

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

The C1b producer contract is now source-frozen without selecting or calling a real provider. The provider/model/endpoint have no source default: an execution packet must bind them explicitly together with the frozen v2 manifest and a clean source commit. The producer sees only the current query plus the C1 bounded caller context; gold IDs, memory text, retrieval results, full session content and tool traces remain explicit egress denials.

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
- absolute experiment cost ceiling: `$1.00`; the selected execution packet must bind an equal or lower exact cost cap plus explicit input/output token prices;
- one frozen acceptance execution, with `acceptance_replay_count=0`.

The source includes only an injected producer executor and fake-transport tests. It contains no provider HTTP implementation, API-key resolution, `fetch()`, or network side effect. Development output may still be used to adjust the producer before acceptance begins, but any prompt/schema/model/query-plan/gate change after formal acceptance starts invalidates that acceptance run.

Real provider selection, execution-packet authorization, data egress, Q4-C1b Hint-on execution, AutoRecall integration, live deployment, and runtime/config changes require separate Owner authorization.
