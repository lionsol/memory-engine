export const Q4_RECALL_HINT_C2_HOLDOUT_CORPUS_SCHEMA = "memory_engine_q4_recall_hint_c2_holdout_corpus_v1";
export const Q4_RECALL_HINT_C2_HOLDOUT_CORPUS_VERSION = "q4c2-narrowed-fresh-holdout-v1";

const ENTITY_PROJECTS = Object.freeze([
  "AmberRelay", "BerylRelay", "CobaltRelay", "DeltaRelay",
  "EcruRelay", "FlintRelay", "GarnetRelay", "HelixRelay",
]);

const ENTITY_QUERIES = Object.freeze([
  "那个模块最后选了什么兼容策略？",
  "Which compatibility policy did that component end up using?",
  "那个服务最后采用了哪种回退规则？",
  "What fallback rule did that module finally settle on?",
]);

const ENTITY_DECISIONS = Object.freeze([
  "exact canonical identity first, then one verified legacy key; collisions return no result",
  "direct project binding first, then a unique normalized alias; ambiguous aliases fail closed",
  "exact resolver first, then one bounded compatibility lookup; missing remains missing",
  "canonical key first, then a single deterministic migration alias; multiple matches are rejected",
  "exact record identity first, then one verified short key; fuzzy matching stays disabled",
  "direct namespace lookup first, then a unique literal compatibility key; wildcard characters stay literal",
  "canonical binding first, then one bounded legacy route; fallback never changes authorization",
  "exact component ID first, then a unique normalized compatibility ID; duplicates fail closed",
]);

const MULTI_PROJECTS = Object.freeze([
  "IonLedger", "JasperLedger", "KryptonLedger", "MicaLedger",
  "NacreLedger", "OnyxLedger", "PyriteLedger", "SiennaLedger",
]);

const MULTI_QUERIES = Object.freeze([
  "当时为什么选那个实现，代价是什么？",
  "Why was that design selected, and what tradeoff remained?",
  "那个方案的选择理由和主要限制分别是什么？",
  "What justified that approach, and what limitation was left?",
]);

const MULTI_RATIONALES = Object.freeze([
  "it preserved deterministic original-query retrieval while adding bounded semantic expansion",
  "it kept candidate authority in retrieval instead of moving it into the planner",
  "it reused the canonical projection path instead of introducing a second memory representation",
  "it kept provider-backed ranking behind an explicit bounded adapter",
  "it maintained physical Core and Engine separation during benchmark retrieval",
  "it preserved the fixed final serving budget while expanding only the candidate pool",
  "it allowed semantic recovery without granting the Hint hard-filter authority",
  "it kept failure fallback on the original retrieval path rather than inventing replacement evidence",
]);

const MULTI_LIMITS = Object.freeze([
  "recovered candidates can still remain below the final top3 after reranking",
  "bounded expansion adds embedding and vector-search latency",
  "multi-evidence questions can still lose one required item in the serving budget",
  "cross-encoder ranking cannot recover evidence that never enters the bounded pool",
  "underspecified context still depends on the caller supplying a reliable entity anchor",
  "a fixed top3 budget cannot preserve every independently relevant evidence item",
  "provider scoring can reorder low-ranked candidates even when candidate coverage improves",
  "candidate expansion does not itself authorize AutoRecall, deployment, or disclosure",
]);

const PROTECTION_FACTS = Object.freeze([
  ["What exact topK does AuroraGuard use for final serving?", "3"],
  ["BasaltGuard 的候选深度固定为多少？", "20"],
  ["What maximum expansion count does CirrusGuard allow per query?", "2"],
  ["DahliaGuard 的 rerank deadline 是多少？", "2500 ms"],
  ["What embedding dimension does EchoGuard require?", "2560"],
  ["FableGuard 的失败回退路径是什么？", "original-query retrieval"],
  ["What vector search depth does GroveGuard use before final ranking?", "50"],
  ["HarborGuard 的保护样本要求是什么？", "no Recall-all regression"],
]);

function entityCases() {
  return ENTITY_PROJECTS.map((project, index) => {
    const n = index + 1;
    const suffix = String(n).padStart(2, "0");
    const evidenceId = `q4c2-mem-entity-${suffix}`;
    return {
      case_id: `q4c2-entity-${suffix}`,
      family: "entity_reference",
      query: ENTITY_QUERIES[index % ENTITY_QUERIES.length],
      bounded_context: { active_project: project, recent_entities: [project] },
      gold_evidence_ids: [evidenceId],
      memory_records: [{
        id: evidenceId,
        text: `${project} final compatibility decision: ${ENTITY_DECISIONS[index]}.`,
      }],
    };
  });
}

function multiFacetCases() {
  return MULTI_PROJECTS.map((project, index) => {
    const n = index + 1;
    const suffix = String(n).padStart(2, "0");
    const rationaleId = `q4c2-mem-multi-${suffix}-rationale`;
    const limitId = `q4c2-mem-multi-${suffix}-limit`;
    return {
      case_id: `q4c2-multi-${suffix}`,
      family: "multi_facet",
      query: MULTI_QUERIES[index % MULTI_QUERIES.length],
      bounded_context: { active_project: project, recent_entities: [project] },
      gold_evidence_ids: [rationaleId, limitId],
      memory_records: [
        { id: rationaleId, text: `${project} selection rationale: ${MULTI_RATIONALES[index]}.` },
        { id: limitId, text: `${project} remaining limitation: ${MULTI_LIMITS[index]}.` },
      ],
    };
  });
}

function protectionCases() {
  return PROTECTION_FACTS.map(([query, answer], index) => {
    const n = index + 1;
    const suffix = String(n).padStart(2, "0");
    const project = query.match(/([A-Z][A-Za-z]+Guard)/u)?.[1] || `ProtectionGuard${suffix}`;
    const evidenceId = `q4c2-mem-protection-${suffix}`;
    return {
      case_id: `q4c2-protection-${suffix}`,
      family: "protection",
      query,
      bounded_context: {},
      gold_evidence_ids: [evidenceId],
      memory_records: [{
        id: evidenceId,
        text: `${query} ${project} answer: ${answer}.`,
      }],
    };
  });
}

export function buildQ4RecallHintC2FreshHoldoutCorpusV1() {
  return {
    schema: Q4_RECALL_HINT_C2_HOLDOUT_CORPUS_SCHEMA,
    corpus_version: Q4_RECALL_HINT_C2_HOLDOUT_CORPUS_VERSION,
    purpose: "fresh independent acceptance-only holdout for narrowed Recall Hint candidate-recovery qualification; no C1 cases or provider outputs reused",
    cases: [
      ...entityCases(),
      ...multiFacetCases(),
      ...protectionCases(),
    ],
  };
}
