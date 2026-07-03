import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  shouldUseAutoRecallCardRuntime,
} from "../auto-recall.js";

const CANARY_PLAN = new URL("../docs/auto-recall-card-runtime-canary-plan.md", import.meta.url);
const MANIFEST = new URL("../openclaw.plugin.json", import.meta.url);

function readPlan() {
  return readFileSync(CANARY_PLAN, "utf8");
}

function readManifest() {
  return JSON.parse(readFileSync(MANIFEST, "utf8"));
}

test("card runtime canary plan exists", () => {
  assert.equal(existsSync(CANARY_PLAN), true);
});

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
  assert.match(cardFirstRuntime.properties.enabled.description, /experimental edi-only card-first/i);
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

test("runtime switch remains edi-only even after schema exposes config", () => {
  const config = { cardFirstRuntime: { enabled: true } };
  assert.equal(shouldUseAutoRecallCardRuntime(config, { agentId: "edi" }), true);
  assert.equal(shouldUseAutoRecallCardRuntime(config, { agentId: "task-planner" }), false);
  assert.equal(shouldUseAutoRecallCardRuntime(config, { agentId: "codex" }), false);
  assert.equal(shouldUseAutoRecallCardRuntime({}, { agentId: "edi" }), false);
});

test("canary plan is explicitly opt-in local-only and avoids broad rollout", () => {
  const doc = readPlan();

  assert.match(doc, /P5 opt-in canary plan/i);
  assert.match(doc, /local-only canary/i);
  assert.match(doc, /does not enable card-first runtime by default/i);
  assert.match(doc, /does not recommend broad rollout/i);
  assert.match(doc, /Keep `cardFirstRuntime\.enabled=false` after the first canary/i);
  assert.match(doc, /experiment-only/i);
});

test("canary plan documents non-goals and safety boundaries", () => {
  const doc = readPlan();

  for (const required of [
    "Do not enable card-first runtime for `task-planner`",
    "Do not enable card-first runtime for Codex CLI",
    "Do not enable active-memory and memory-engine autoRecall together",
    "Do not change retrieval ranking",
    "Do not call `memory_engine_get` automatically",
    "Do not inject full memory content",
    "Do not reinforce memory from card rendering",
  ]) {
    assert.match(doc, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
});

test("canary plan includes schema sample and rollback config", () => {
  const doc = readPlan();

  assert.match(doc, /"autoRecall"/);
  assert.match(doc, /"cardFirstRuntime"/);
  assert.match(doc, /"enabled": true/);
  assert.match(doc, /"enabled": false/);
  assert.match(doc, /Immediate config rollback/i);
  assert.match(doc, /remove `cardFirstRuntime` from local config/i);
});

test("canary plan includes preflight commands and event inspection SQL", () => {
  const doc = readPlan();

  for (const required of [
    "node bin/run-auto-recall-card-runtime-smoke.js --json",
    "test/auto-recall-debug-metadata.snapshot.test.js",
    "test/auto-recall-runtime-gate.test.js",
    "SELECT",
    "FROM memory_events",
    "event_type = 'auto_recall_debug'",
    "event_type = 'memory_injected'",
    "json_extract(metadata_json, '$.card_first_runtime_enabled')",
    "json_extract(metadata_json, '$.auto_recall_disclosure_mode')",
    "json_extract(metadata_json, '$.disclosure_mode')",
  ]) {
    assert.match(doc, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("canary plan defines pass and fail criteria", () => {
  const doc = readPlan();

  assert.match(doc, /## Pass criteria/);
  assert.match(doc, /## Fail criteria/);
  assert.match(doc, /card_first_runtime_enabled=true appears only in `edi` interactive user turns/i);
  assert.match(doc, /generic long-input rewrite\/summarize prompts still skip recall/i);
  assert.match(doc, /raw-log-like and tool-output-like card summaries are withheld/i);
  assert.match(doc, /card-first runs for `task-planner`, Codex CLI, missing agent id/i);
  assert.match(doc, /full raw memory body, stack trace, timestamped raw log, or tool output appears/i);
  assert.match(doc, /reinforcement happens without an explicit cited memory id/i);
});

test("canary plan includes decision record template", () => {
  const doc = readPlan();

  for (const required of [
    "Decision record template",
    "Canary config:",
    "Prompt count:",
    "Observed card_first_runtime_enabled events:",
    "Observed memory_card disclosure events:",
    "Citation quality:",
    "Unexpected reinforcement:",
    "Decision: keep experiment disabled / repeat canary / expand edi canary / reject card-first default",
  ]) {
    assert.match(doc, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
