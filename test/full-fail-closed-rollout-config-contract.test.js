import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const MANIFEST = new URL("../openclaw.plugin.json", import.meta.url);
const INDEX = new URL("../index.js", import.meta.url);

const ALLOWED_MODES = [
  "legacy_fallback",
  "shadow_fail_closed",
  "fail_closed_canary",
  "full_fail_closed",
];

function readManifest() {
  return JSON.parse(readFileSync(MANIFEST, "utf8"));
}

function assertCanarySchema(schema) {
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.default, {
    enabled: false,
    agentIds: [],
    sessionIds: [],
  });
  assert.equal(schema.properties.enabled.type, "boolean");
  assert.equal(schema.properties.enabled.default, false);
  for (const key of ["agentIds", "sessionIds"]) {
    assert.equal(schema.properties[key].type, "array");
    assert.deepEqual(schema.properties[key].default, []);
    assert.equal(schema.properties[key].uniqueItems, true);
    assert.equal(schema.properties[key].items.type, "string");
    assert.equal(schema.properties[key].items.minLength, 1);
  }
}

test("manifest exposes explicit fail-closed modes with legacy defaults", () => {
  const manifest = readManifest();
  const properties = manifest.configSchema.properties;

  assert.equal(manifest.configSchema.additionalProperties, false);
  for (const key of ["kgFailClosedMode", "recentFailClosedMode"]) {
    assert.equal(properties[key].type, "string");
    assert.deepEqual(properties[key].enum, ALLOWED_MODES);
    assert.equal(properties[key].default, "legacy_fallback");
    assert.match(properties[key].description, /all Hybrid Search production surfaces/i);
    assert.match(properties[key].description, /controlled rollout runbook/i);
  }
});

test("manifest exposes disabled-by-default trusted canary allowlists", () => {
  const properties = readManifest().configSchema.properties;
  assertCanarySchema(properties.kgFailClosedCanary);
  assertCanarySchema(properties.recentFailClosedCanary);
});

test("runtime reads official top-level plugin config before legacy compatibility locations", () => {
  const source = readFileSync(INDEX, "utf8");
  for (const key of [
    "kgFailClosedMode",
    "kgFailClosedCanary",
    "recentFailClosedMode",
    "recentFailClosedCanary",
  ]) {
    assert.match(source, new RegExp(
      `api\\.pluginConfig\\?\\.${key}[\\s\\S]*?autoRecallConfig\\.${key}[\\s\\S]*?pluginEntryConfig\\?\\.${key}`,
    ));
  }
  assert.match(source, /api\.pluginConfig\?\.autoRecall/);
});

test("official config controls remain outside autoRecall schema", () => {
  const properties = readManifest().configSchema.properties;
  const autoRecallProperties = properties.autoRecall.properties;

  for (const key of [
    "kgFailClosedMode",
    "kgFailClosedCanary",
    "recentFailClosedMode",
    "recentFailClosedCanary",
  ]) {
    assert.ok(Object.hasOwn(properties, key), `${key} must be top-level plugin config`);
    assert.equal(Object.hasOwn(autoRecallProperties, key), false, `${key} must not be presented as AutoRecall-only`);
  }
});
