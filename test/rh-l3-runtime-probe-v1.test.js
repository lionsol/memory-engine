import test from "node:test";
import assert from "node:assert/strict";

import {
  RH_L3_RUNTIME_PROBE_ID_V1,
  RH_L3_RUNTIME_PROBE_QUERY_V1,
  resolveRhL3RuntimeProbeV1,
} from "../lib/recall/hint/rh-l3-runtime-probe-v1.js";

test("RH-L3 runtime probe returns the frozen two-expansion plan only for exact id and query", () => {
  const applied = resolveRhL3RuntimeProbeV1({
    probeId: RH_L3_RUNTIME_PROBE_ID_V1,
    query: RH_L3_RUNTIME_PROBE_QUERY_V1,
  });

  assert.equal(applied.applied, true);
  assert.equal(applied.reason, "probe_applied");
  assert.deepEqual(applied.vectorQueryPlan, {
    mode: "recall_hint_v1",
    queries: [
      "CedarIndex design decision rationale project:CedarIndex entities:CedarIndex",
      "CedarIndex design decision limitations project:CedarIndex entities:CedarIndex",
    ],
  });
  assert.deepEqual(applied.hint, {
    version: "recall_hint_v1",
    project: "CedarIndex",
    entities: ["CedarIndex"],
    query_facets: ["rationale", "limitations"],
  });

  const wrongId = resolveRhL3RuntimeProbeV1({
    probeId: "wrong",
    query: RH_L3_RUNTIME_PROBE_QUERY_V1,
  });
  assert.equal(wrongId.applied, false);
  assert.equal(wrongId.reason, "probe_id_not_allowed");

  const wrongQuery = resolveRhL3RuntimeProbeV1({
    probeId: RH_L3_RUNTIME_PROBE_ID_V1,
    query: "CedarIndex design decision ",
  });
  assert.equal(wrongQuery.applied, false);
  assert.equal(wrongQuery.reason, "probe_query_mismatch");
});
