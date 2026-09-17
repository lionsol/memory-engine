import { createHash } from "node:crypto";

import { buildRecallHintVectorQueryPlan } from "../recall/hint/recall-hint-query-plan.js";
import { validateRecallHintV1 } from "../recall/hint/recall-hint-v1.js";
import { buildQ4RecallHintC1ManifestV1 } from "./q4-recall-hint-c1-manifest-v1.js";

export const Q4_C1B_DEVELOPMENT_HINTS_SCHEMA = "memory_engine_q4_recall_hint_c1b_development_hints_v1";
export const Q4_C1B_DEVELOPMENT_SOURCE_COMMIT = "6e86192acb77839fa50e92ac5f5ba22cc63daa29";
export const Q4_C1B_DEVELOPMENT_PROVIDER_RESULT_SHA256 = "c13eef93f369f56c3fc254718479cd4bbaca55a34adecd0726ba7f3ebd3359c5";

const RAW_HINTS = [
  ["q4c1-entity-01", "entity_reference", { version: "recall_hint_v1", project: "AtlasPlugin", entities: ["AtlasPlugin"], query_facets: ["回退策略"] }],
  ["q4c1-entity-05", "entity_reference", { version: "recall_hint_v1", project: "EmberPlugin", entities: ["EmberPlugin"], query_facets: ["回退策略"] }],
  ["q4c1-entity-08", "entity_reference", { version: "recall_hint_v1", project: "HarborPlugin", entities: ["HarborPlugin"], query_facets: ["lookup rule", "settled on"] }],
  ["q4c1-entity-12", "entity_reference", { version: "recall_hint_v1", project: "LumenPlugin", entities: ["LumenPlugin"], query_facets: ["lookup rule", "plugin"] }],
  ["q4c1-multi-03", "multi_facet", { version: "recall_hint_v1", project: "CedarIndex", entities: ["CedarIndex"], query_facets: ["方案选择理由", "已知限制"] }],
  ["q4c1-multi-06", "multi_facet", { version: "recall_hint_v1", project: "FernIndex", entities: ["FernIndex"], query_facets: ["option selection rationale", "remaining limitation"] }],
  ["q4c1-multi-07", "multi_facet", { version: "recall_hint_v1", project: "GlacierIndex", entities: ["GlacierIndex"], query_facets: ["方案选择理由", "已知限制"] }],
  ["q4c1-multi-09", "multi_facet", { version: "recall_hint_v1", project: "IrisIndex", entities: ["IrisIndex"], query_facets: ["方案选择", "限制条件"] }],
  ["q4c1-protection-04", "protection", { version: "recall_hint_v1" }],
  ["q4c1-protection-05", "protection", { version: "recall_hint_v1" }],
  ["q4c1-protection-08", "protection", { version: "recall_hint_v1" }],
  ["q4c1-protection-10", "protection", { version: "recall_hint_v1" }],
  ["q4c1-temporal-06", "temporal_relation", { version: "recall_hint_v1", project: "RillStore", entities: ["RillStore"], time_relation: { relation: "after", anchor: "RillStore migration" }, query_facets: ["configuration"] }],
  ["q4c1-temporal-08", "temporal_relation", { version: "recall_hint_v1", project: "TundraStore", entities: ["TundraStore"], time_relation: { relation: "after", anchor: "TundraStore migration" }, query_facets: ["存储模式"] }],
  ["q4c1-temporal-11", "temporal_relation", { version: "recall_hint_v1", project: "WillowStore", entities: ["WillowStore"], time_relation: { relation: "before", anchor: "WillowStore migration" }, query_facets: ["configuration"] }],
  ["q4c1-temporal-12", "temporal_relation", { version: "recall_hint_v1", project: "XenonStore", entities: ["XenonStore"], time_relation: { relation: "after", anchor: "XenonStore migration" }, query_facets: ["storage mode", "post-migration"] }],
];

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function buildQ4RecallHintC1BDevelopmentHintsV1(corpus) {
  const manifest = buildQ4RecallHintC1ManifestV1(corpus);
  const expectedIds = manifest.development.map(row => row.case_id);
  const caseById = new Map(corpus.cases.map(row => [row.case_id, row]));
  const rows = RAW_HINTS.map(([caseId, family, rawHint]) => {
    const record = caseById.get(caseId);
    if (!record) throw fail(`Q4_C1B_DEV_HINT_CASE_MISSING:${caseId}`);
    if (record.family !== family) throw fail(`Q4_C1B_DEV_HINT_FAMILY_MISMATCH:${caseId}`);
    const validation = validateRecallHintV1(rawHint);
    if (!validation.valid) throw fail(`Q4_C1B_DEV_HINT_INVALID:${caseId}`);
    const plan = buildRecallHintVectorQueryPlan(record.query, validation.normalized);
    return {
      case_id: caseId,
      family,
      hint: validation.normalized,
      query_plan: plan,
    };
  });
  const ids = rows.map(row => row.case_id);
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) throw fail("Q4_C1B_DEV_HINT_SPLIT_MISMATCH");
  const body = {
    schema: Q4_C1B_DEVELOPMENT_HINTS_SCHEMA,
    source_commit: Q4_C1B_DEVELOPMENT_SOURCE_COMMIT,
    provider_result_sha256: Q4_C1B_DEVELOPMENT_PROVIDER_RESULT_SHA256,
    manifest_sha256: manifest.manifest_sha256,
    development_sha256: manifest.development_sha256,
    rows,
  };
  return Object.freeze({
    ...body,
    rows: Object.freeze(rows.map(row => Object.freeze(row))),
    hints_sha256: sha256(JSON.stringify(body)),
  });
}

export function summarizeQ4RecallHintC1BDevelopmentHintsV1(snapshot) {
  if (!snapshot || snapshot.schema !== Q4_C1B_DEVELOPMENT_HINTS_SCHEMA || !Array.isArray(snapshot.rows)) {
    throw fail("Q4_C1B_DEV_HINT_SNAPSHOT_INVALID");
  }
  const expansionCount = snapshot.rows.reduce((sum, row) => sum + Number(row.query_plan?.queries?.length || 0), 0);
  const emptyCount = snapshot.rows.filter(row => Object.keys(row.hint || {}).length === 1).length;
  return Object.freeze({
    case_count: snapshot.rows.length,
    expansion_query_count: expansionCount,
    empty_hint_count: emptyCount,
  });
}
