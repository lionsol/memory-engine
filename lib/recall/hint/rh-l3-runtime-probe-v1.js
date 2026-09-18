import { buildRecallHintVectorQueryPlan } from "./recall-hint-query-plan.js";

export const RH_L3_RUNTIME_PROBE_ID_V1 = "rh_l3_canonical_v1";
export const RH_L3_RUNTIME_PROBE_QUERY_V1 = "CedarIndex design decision";

const RH_L3_RUNTIME_PROBE_HINT_V1 = Object.freeze({
  version: "recall_hint_v1",
  project: "CedarIndex",
  entities: Object.freeze(["CedarIndex"]),
  query_facets: Object.freeze(["rationale", "limitations"]),
});

const RH_L3_RUNTIME_PROBE_EXPECTED_EXPANSIONS_V1 = Object.freeze([
  "CedarIndex design decision rationale project:CedarIndex entities:CedarIndex",
  "CedarIndex design decision limitations project:CedarIndex entities:CedarIndex",
]);

function sameQueries(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export function resolveRhL3RuntimeProbeV1({ probeId, query } = {}) {
  if (probeId !== RH_L3_RUNTIME_PROBE_ID_V1) {
    return Object.freeze({
      applied: false,
      reason: "probe_id_not_allowed",
      vectorQueryPlan: null,
      hint: null,
    });
  }
  if (query !== RH_L3_RUNTIME_PROBE_QUERY_V1) {
    return Object.freeze({
      applied: false,
      reason: "probe_query_mismatch",
      vectorQueryPlan: null,
      hint: null,
    });
  }

  const vectorQueryPlan = buildRecallHintVectorQueryPlan(
    RH_L3_RUNTIME_PROBE_QUERY_V1,
    RH_L3_RUNTIME_PROBE_HINT_V1,
  );
  if (!vectorQueryPlan
      || vectorQueryPlan.mode !== "recall_hint_v1"
      || !sameQueries(vectorQueryPlan.queries, RH_L3_RUNTIME_PROBE_EXPECTED_EXPANSIONS_V1)) {
    return Object.freeze({
      applied: false,
      reason: "probe_plan_identity_mismatch",
      vectorQueryPlan: null,
      hint: null,
    });
  }

  return Object.freeze({
    applied: true,
    reason: "probe_applied",
    vectorQueryPlan,
    hint: RH_L3_RUNTIME_PROBE_HINT_V1,
  });
}
