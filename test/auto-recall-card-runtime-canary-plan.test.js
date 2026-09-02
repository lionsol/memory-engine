import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  shouldUseAutoRecallCardRuntime,
} from "../auto-recall.js";

const MANIFEST = new URL("../openclaw.plugin.json", import.meta.url);

function readManifest() {
  return JSON.parse(readFileSync(MANIFEST, "utf8"));
}

test("plugin schema exposes cardFirstRuntime as disabled-by-default canary switch", () => {
  const manifest = readManifest();
  const autoRecall = manifest.configSchema.properties.autoRecall;
  const cardFirstRuntime = autoRecall.properties.cardFirstRuntime;

  assert.equal(autoRecall.additionalProperties, false);
  assert.equal(cardFirstRuntime.type, "object");
  assert.equal(cardFirstRuntime.additionalProperties, false);
  assert.deepEqual(cardFirstRuntime.default, { enabled: false });
  assert.equal(cardFirstRuntime.properties.enabled.type, "boolean");
  assert.equal(cardFirstRuntime.properties.enabled.default, false);
  assert.match(cardFirstRuntime.properties.enabled.description, /experimental AutoRecall-agent-gated card-first/i);
});

test("manifest defaults do not enable autoRecall or card-first runtime", () => {
  const manifest = readManifest();
  const autoRecall = manifest.configSchema.properties.autoRecall;

  assert.equal(autoRecall.default.enabled, false);
  assert.equal(autoRecall.default.topK, 3);
  assert.equal(autoRecall.default.timeoutMs, 8000);
  assert.equal(autoRecall.properties.enabled.default, false);
  assert.equal(autoRecall.properties.cardFirstRuntime.properties.enabled.default, false);
});

test("runtime switch inherits the AutoRecall agent allowlist after schema exposes config", () => {
  const config = { agentAllowlist: ["main"], cardFirstRuntime: { enabled: true } };
  assert.equal(shouldUseAutoRecallCardRuntime(config, { agentId: "main", allowed: true }), true);
  assert.equal(shouldUseAutoRecallCardRuntime(config, { agentId: "task-planner", allowed: true }), false);
  assert.equal(shouldUseAutoRecallCardRuntime(config, { agentId: "codex", allowed: true }), false);
  assert.equal(shouldUseAutoRecallCardRuntime(config, { agentId: "main", allowed: false }), false);
  assert.equal(shouldUseAutoRecallCardRuntime({}, { agentId: "edi" }), false);
});
