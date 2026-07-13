import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyRecentSqliteId,
  evaluateRecentTextIdInvariant,
  inspectRecentIsolationTopology,
  resolveRecentAccessDecision,
} from "../lib/recall/hybrid/recent-access.js";

test("classifyRecentSqliteId preserves TEXT-only semantics without stringifying non-text values", () => {
  assert.deepEqual(classifyRecentSqliteId("chunk-1"), {
    storage_class: "text",
    text: true,
  });
  assert.deepEqual(classifyRecentSqliteId(Buffer.from("blob")), {
    storage_class: "blob",
    text: false,
  });
  assert.deepEqual(classifyRecentSqliteId(null), {
    storage_class: "null",
    text: false,
  });
  assert.deepEqual(classifyRecentSqliteId(42), {
    storage_class: "number",
    text: false,
  });
});

test("evaluateRecentTextIdInvariant passes only when both snapshots are all TEXT", () => {
  const passed = evaluateRecentTextIdInvariant({
    engineRows: [{ chunk_id: "engine-1" }],
    coreRows: [{ id: "core-1" }],
  });
  assert.equal(passed.passed, true);
  assert.equal(passed.reason, "text_id_invariant_passed");

  const engineFailed = evaluateRecentTextIdInvariant({
    engineRows: [{ chunk_id: Buffer.from("blob") }],
    coreRows: [{ id: "core-1" }],
  });
  assert.equal(engineFailed.passed, false);
  assert.equal(engineFailed.reason, "engine_non_text_id");
  assert.equal(engineFailed.engine.storage_classes.blob, 1);

  const coreFailed = evaluateRecentTextIdInvariant({
    engineRows: [{ chunk_id: "engine-1" }],
    coreRows: [{ id: null }],
  });
  assert.equal(coreFailed.passed, false);
  assert.equal(coreFailed.reason, "core_non_text_id");
  assert.equal(coreFailed.core.storage_classes.null, 1);

  const bothFailed = evaluateRecentTextIdInvariant({
    engineRows: [{ chunk_id: 42 }],
    coreRows: [{ id: 1.5 }],
  });
  assert.equal(bothFailed.passed, false);
  assert.equal(bothFailed.reason, "engine_and_core_non_text_id");
  assert.equal(bothFailed.engine.storage_classes.other, 1);
  assert.equal(bothFailed.core.storage_classes.other, 1);
});

test("evaluateRecentTextIdInvariant fails closed for invalid snapshots", () => {
  const invalid = evaluateRecentTextIdInvariant({
    engineRows: null,
    coreRows: [{ id: "core-1" }],
  });
  assert.equal(invalid.passed, false);
  assert.equal(invalid.reason, "invalid_id_snapshot");
});

test("inspectRecentIsolationTopology requires readonly main-only Core and Engine handles", () => {
  const valid = inspectRecentIsolationTopology({
    withCoreDb: run => run({
      readonly: true,
      prepare: () => ({ all: () => [{ name: "main" }] }),
    }),
    withEngineDb: run => run({
      readonly: true,
      prepare: () => ({ all: () => [{ name: "main" }] }),
    }),
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.reason, null);

  const invalid = inspectRecentIsolationTopology({
    withCoreDb: run => run({
      readonly: true,
      prepare: () => ({ all: () => [{ name: "main" }, { name: "core" }] }),
    }),
    withEngineDb: run => run({
      readonly: false,
      prepare: () => ({ all: () => [{ name: "main" }] }),
    }),
  });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.reason, "isolated_recent_invalid_topology");
});

test("resolveRecentAccessDecision distinguishes disabled, guard fallback, and isolated modes", () => {
  const invariant = evaluateRecentTextIdInvariant({
    engineRows: [{ chunk_id: "engine-1" }],
    coreRows: [{ id: "core-1" }],
  });
  const topology = inspectRecentIsolationTopology({
    withCoreDb: run => run({
      readonly: true,
      prepare: () => ({ all: () => [{ name: "main" }] }),
    }),
    withEngineDb: run => run({
      readonly: true,
      prepare: () => ({ all: () => [{ name: "main" }] }),
    }),
  });

  assert.deepEqual(
    resolveRecentAccessDecision({
      isolatedRecentCapability: false,
      invariant,
      topology,
    }),
    {
      requested: false,
      mode: "legacy",
      fallback_reason: "capability_disabled",
    },
  );

  assert.equal(
    resolveRecentAccessDecision({
      isolatedRecentCapability: true,
      invariant: evaluateRecentTextIdInvariant({
        engineRows: [{ chunk_id: Buffer.from("blob") }],
        coreRows: [{ id: "core-1" }],
      }),
      topology,
    }).fallback_reason,
    "isolated_recent_engine_id_invariant_failed",
  );

  assert.equal(
    resolveRecentAccessDecision({
      isolatedRecentCapability: true,
      invariant,
      topology: { valid: false, reason: "isolated_recent_provider_unavailable" },
    }).fallback_reason,
    "isolated_recent_provider_unavailable",
  );

  assert.deepEqual(
    resolveRecentAccessDecision({
      isolatedRecentCapability: true,
      invariant,
      topology,
    }),
    {
      requested: true,
      mode: "isolated",
      fallback_reason: null,
    },
  );
});
