import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyKgSqliteId,
  evaluateKgTextIdInvariant,
  resolveKgAccessDecision,
} from "../lib/recall/hybrid/kg-id-invariant.js";

test("classifyKgSqliteId identifies text, null, blob, and other values without string coercion", () => {
  assert.deepEqual(classifyKgSqliteId("chunk-1"), { storage_class: "text", text: true });
  assert.deepEqual(classifyKgSqliteId(null), { storage_class: "null", text: false });
  assert.deepEqual(classifyKgSqliteId(Buffer.from("blob")), { storage_class: "blob", text: false });
  assert.deepEqual(classifyKgSqliteId(1), { storage_class: "number", text: false });
});

test("evaluateKgTextIdInvariant passes for all-text snapshots and empty snapshots", () => {
  const textOnly = evaluateKgTextIdInvariant({
    engineRows: [{ chunk_id: "engine-1" }, { chunk_id: "engine-2" }],
    coreRows: [{ id: "core-1" }, { id: "core-2" }],
  });
  assert.equal(textOnly.passed, true);
  assert.equal(textOnly.reason, "text_id_invariant_passed");
  assert.equal(textOnly.engine.non_text_count, 0);
  assert.equal(textOnly.core.non_text_count, 0);

  const empty = evaluateKgTextIdInvariant({ engineRows: [], coreRows: [] });
  assert.equal(empty.passed, true);
  assert.equal(empty.reason, "text_id_invariant_passed");
});

test("evaluateKgTextIdInvariant fails closed for invalid snapshots", () => {
  const invalid = evaluateKgTextIdInvariant({ engineRows: null, coreRows: [] });
  assert.equal(invalid.passed, false);
  assert.equal(invalid.reason, "invalid_id_snapshot");
});

test("evaluateKgTextIdInvariant reports engine/core non-text reasons and storage classes", () => {
  const engineBlob = evaluateKgTextIdInvariant({
    engineRows: [{ chunk_id: Buffer.from("blob") }],
    coreRows: [{ id: "chunk-1" }],
  });
  assert.equal(engineBlob.passed, false);
  assert.equal(engineBlob.reason, "engine_non_text_id");
  assert.equal(engineBlob.engine.storage_classes.blob, 1);

  const engineNull = evaluateKgTextIdInvariant({
    engineRows: [{ chunk_id: null }],
    coreRows: [{ id: "chunk-1" }],
  });
  assert.equal(engineNull.passed, false);
  assert.equal(engineNull.reason, "engine_non_text_id");
  assert.equal(engineNull.engine.storage_classes.null, 1);

  const coreBlob = evaluateKgTextIdInvariant({
    engineRows: [{ chunk_id: "chunk-1" }],
    coreRows: [{ id: Buffer.from("blob") }],
  });
  assert.equal(coreBlob.passed, false);
  assert.equal(coreBlob.reason, "core_non_text_id");
  assert.equal(coreBlob.core.storage_classes.blob, 1);

  const both = evaluateKgTextIdInvariant({
    engineRows: [{ chunk_id: Buffer.from("blob") }],
    coreRows: [{ id: null }],
  });
  assert.equal(both.passed, false);
  assert.equal(both.reason, "engine_and_core_non_text_id");
});

test("resolveKgAccessDecision requires strict true capability and invariant pass", () => {
  const invariant = evaluateKgTextIdInvariant({
    engineRows: [{ chunk_id: "chunk-1" }],
    coreRows: [{ id: "chunk-1" }],
  });

  for (const capability of [undefined, null, false, 1, "true", {}]) {
    const decision = resolveKgAccessDecision({
      isolatedKgCapability: capability,
      invariant,
    });
    assert.deepEqual(decision, {
      requested: false,
      mode: "legacy",
      fallback_reason: "capability_disabled",
    }, String(capability));
  }

  const failed = resolveKgAccessDecision({
    isolatedKgCapability: true,
    invariant: evaluateKgTextIdInvariant({
      engineRows: [{ chunk_id: Buffer.from("blob") }],
      coreRows: [{ id: "chunk-1" }],
    }),
  });
  assert.deepEqual(failed, {
    requested: true,
    mode: "legacy",
    fallback_reason: "text_id_invariant_failed",
  });

  const enabled = resolveKgAccessDecision({
    isolatedKgCapability: true,
    invariant,
  });
  assert.deepEqual(enabled, {
    requested: true,
    mode: "isolated",
    fallback_reason: null,
  });
});
