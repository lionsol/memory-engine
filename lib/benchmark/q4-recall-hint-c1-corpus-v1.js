export const Q4_RECALL_HINT_C1_CORPUS_SCHEMA = "memory_engine_q4_recall_hint_corpus_v1";
export const Q4_RECALL_HINT_C1_CORPUS_VERSION = "q4c1-fresh-synthetic-v1";

const ENTITY_PROJECTS = Object.freeze([
  "AtlasPlugin", "BeaconPlugin", "CinderPlugin", "DriftPlugin",
  "EmberPlugin", "FjordPlugin", "GrovePlugin", "HarborPlugin",
  "IndigoPlugin", "JuniperPlugin", "KestrelPlugin", "LumenPlugin",
]);
const TEMPORAL_PROJECTS = Object.freeze([
  "MeridianStore", "NimbusStore", "OrbitStore", "PrismStore",
  "QuartzStore", "RillStore", "SolaceStore", "TundraStore",
  "UmberStore", "ValeStore", "WillowStore", "XenonStore",
]);
const MULTI_PROJECTS = Object.freeze([
  "AlderIndex", "BirchIndex", "CedarIndex", "DuneIndex",
  "ElmIndex", "FernIndex", "GlacierIndex", "HeathIndex",
  "IrisIndex", "JadeIndex", "KnollIndex", "LotusIndex",
]);
const PROTECTION_PROJECTS = Object.freeze([
  "MosaicRunner", "NovaRunner", "OpalRunner", "PineRunner",
  "QuillRunner", "RowanRunner", "SageRunner", "ThistleRunner",
  "UmamiRunner", "VelaRunner", "WrenRunner", "ZephyrRunner",
]);

const ENTITY_QUERIES = Object.freeze([
  "那个插件最后用了什么回退策略？",
  "What fallback did that plugin finally use?",
  "那个组件后来采用了哪种查找规则？",
  "Which lookup rule did that plugin settle on?",
]);
const ENTITY_DECISIONS = Object.freeze([
  "exact-match first, then a unique literal prefix; ambiguity fails closed",
  "canonical lookup first, then bounded local fallback; missing identity stays missing",
  "literal exact ID first, then unique-prefix resolution; wildcard characters stay literal",
  "exact canonical key first, then one deterministic alias; multiple aliases are rejected",
  "exact chunk identity first, then a unique short prefix; ambiguous matches are rejected",
  "exact memory identity first, then one verified compatibility key; collisions are never guessed",
  "direct lookup first, then one bounded fallback query; fallback never changes authority",
  "exact project key first, then a unique normalized key; duplicates fail closed",
  "canonical ID first, then a unique literal prefix; fuzzy matching is disabled",
  "exact resolver first, then one deterministic compatibility path; unresolved stays missing",
  "exact identifier when present, otherwise one unique prefix; missing stays missing",
  "canonical match first, then a unique bounded prefix; ambiguity returns an error",
]);

const MULTI_QUERIES = Object.freeze([
  "当时为什么选那个方案，有什么限制？",
  "Why did we choose that option, and what limitation remained?",
  "那个方案的选择理由和已知限制分别是什么？",
  "What was the rationale for that design and its known limitation?",
]);
const MULTI_RATIONALES = Object.freeze([
  "it preserved deterministic lexical fallback during vector outages",
  "it bounded candidate generation while keeping the original query",
  "it reused one canonical projection path instead of adding a second disclosure path",
  "it improved ranking without changing candidate authority",
  "it kept exact identity semantics while allowing bounded compatibility",
  "it preserved isolated Core and Engine ownership during retrieval",
  "it limited planner influence to candidate expansion",
  "it kept the serving budget fixed at top3",
  "it allowed explicit reranking with atomic control fallback",
  "it retained the original retrieval path when the experimental layer failed",
  "it reused existing vector fusion instead of introducing a new ranking stack",
  "it kept runtime authority separate from source implementation",
]);
const MULTI_LIMITS = Object.freeze([
  "multi-evidence questions can still miss one required evidence item at top3",
  "extra query expansion can displace a useful original-query candidate",
  "candidate generation can still miss evidence outside the bounded depth",
  "ranking cannot recover evidence that never enters the candidate pool",
  "ambiguous context still needs a caller-supplied entity anchor",
  "isolated reads do not by themselves solve multi-hop evidence composition",
  "query expansion adds latency and extra embedding or search calls",
  "a fixed top3 budget cannot contain more than three independent evidence items",
  "provider nondeterminism can change low-ranked membership",
  "fallback preserves correctness but can forfeit the experimental quality gain",
  "RRF fusion does not guarantee preservation of every original-query candidate",
  "the design does not authorize AutoRecall or deployment by itself",
]);

const PROTECTION_FACTS = Object.freeze([
  ["What retry budget did MosaicRunner use after the timeout fix?", "2 attempts"],
  ["NovaRunner 的 checkpoint 间隔最终固定为多少？", "30 seconds"],
  ["What exact candidate depth does OpalRunner use for explicit rerank?", "20 candidates"],
  ["PineRunner 最终的 topK 是多少？", "3"],
  ["What hard deadline did QuillRunner use for the bounded adapter?", "2500 ms"],
  ["RowanRunner 的最大额外查询数量是多少？", "2"],
  ["What fallback policy does SageRunner use when the experimental layer fails?", "original-query retrieval"],
  ["ThistleRunner 的显式查询候选池上限是多少？", "20"],
  ["What is UmamiRunner's final serving budget?", "top 3 results"],
  ["VelaRunner 的 provider 每个 case 最多调用几次？", "1 call"],
  ["What query-plan mode name does WrenRunner use?", "recall_hint_v1"],
  ["ZephyrRunner 的保护样本要求是什么？", "zero Recall-all regression"],
]);

function entityCases() {
  return ENTITY_PROJECTS.map((project, index) => {
    const n = index + 1;
    const evidenceId = `mem-entity-${String(n).padStart(2, "0")}`;
    return {
      case_id: `q4c1-entity-${String(n).padStart(2, "0")}`,
      family: "entity_reference",
      query: ENTITY_QUERIES[index % ENTITY_QUERIES.length],
      bounded_context: { active_project: project, recent_entities: [project] },
      gold_evidence_ids: [evidenceId],
      memory_records: [{
        id: evidenceId,
        text: `${project} final decision: ${ENTITY_DECISIONS[index]}.`,
      }],
    };
  });
}

function temporalCases() {
  return TEMPORAL_PROJECTS.map((project, index) => {
    const n = index + 1;
    const beforeId = `mem-temporal-${String(n).padStart(2, "0")}-before`;
    const afterId = `mem-temporal-${String(n).padStart(2, "0")}-after`;
    const wantsBefore = index % 2 === 0;
    return {
      case_id: `q4c1-temporal-${String(n).padStart(2, "0")}`,
      family: "temporal_relation",
      query: wantsBefore
        ? (index % 4 === 0 ? "迁移之前用的是什么存储模式？" : "What configuration did it use before the migration?")
        : (index % 4 === 1 ? "What configuration did it use after the migration?" : "迁移之后用的是什么存储模式？"),
      bounded_context: {
        active_project: project,
        recent_entities: [project],
        temporal_anchor: `${project} migration`,
      },
      gold_evidence_ids: [wantsBefore ? beforeId : afterId],
      memory_records: [
        {
          id: beforeId,
          text: `Before the ${project} migration, ${project} used one shared attached SQLite store for canonical and derived state.`,
        },
        {
          id: afterId,
          text: `After the ${project} migration, ${project} used physically isolated Core and Engine stores with explicit read boundaries.`,
        },
      ],
    };
  });
}

function multiFacetCases() {
  return MULTI_PROJECTS.map((project, index) => {
    const n = index + 1;
    const rationaleId = `mem-multi-${String(n).padStart(2, "0")}-rationale`;
    const limitId = `mem-multi-${String(n).padStart(2, "0")}-limit`;
    return {
      case_id: `q4c1-multi-${String(n).padStart(2, "0")}`,
      family: "multi_facet",
      query: MULTI_QUERIES[index % MULTI_QUERIES.length],
      bounded_context: { active_project: project, recent_entities: [project] },
      gold_evidence_ids: [rationaleId, limitId],
      memory_records: [
        { id: rationaleId, text: `${project} selection rationale: ${MULTI_RATIONALES[index]}.` },
        { id: limitId, text: `${project} known limitation: ${MULTI_LIMITS[index]}.` },
      ],
    };
  });
}

function protectionCases() {
  return PROTECTION_PROJECTS.map((project, index) => {
    const n = index + 1;
    const evidenceId = `mem-protection-${String(n).padStart(2, "0")}`;
    const [query, answer] = PROTECTION_FACTS[index];
    return {
      case_id: `q4c1-protection-${String(n).padStart(2, "0")}`,
      family: "protection",
      query,
      bounded_context: {},
      gold_evidence_ids: [evidenceId],
      memory_records: [{ id: evidenceId, text: `${project} explicit configuration: ${answer}.` }],
    };
  });
}

export function buildQ4RecallHintC1FreshCorpusV1() {
  return {
    schema: Q4_RECALL_HINT_C1_CORPUS_SCHEMA,
    corpus_version: Q4_RECALL_HINT_C1_CORPUS_VERSION,
    purpose: "fresh targeted synthetic corpus for Recall Hint development/acceptance split; no provider outputs included",
    cases: [
      ...entityCases(),
      ...temporalCases(),
      ...multiFacetCases(),
      ...protectionCases(),
    ],
  };
}
