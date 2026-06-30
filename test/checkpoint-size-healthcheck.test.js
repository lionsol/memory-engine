import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const healthcheck = require("../bin/checkpoint-size-healthcheck.js");

test("resolveDefaults keeps requested default checkpoint-size parameters", () => {
  const resolved = healthcheck.resolveDefaults(healthcheck.parseArgs([]), {});

  assert.equal(resolved.provider, "siliconflow");
  assert.equal(resolved.chars, 22000);
  assert.equal(resolved.maxTokens, 1024);
  assert.equal(resolved.timeoutMs, 120000);
  assert.equal(resolved.model, "deepseek-ai/DeepSeek-V3.2");
});

test("provider validation accepts siliconflow and deepseek, rejects others", () => {
  assert.equal(healthcheck.resolveDefaults({ provider: "siliconflow" }, {}).provider, "siliconflow");
  assert.equal(healthcheck.resolveDefaults({ provider: "deepseek" }, {}).provider, "deepseek");
  assert.throws(
    () => healthcheck.resolveDefaults({ provider: "other" }, {}),
    /provider must be one of: siliconflow, deepseek/,
  );
});

test("buildSyntheticPrompt reaches requested size and stays synthetic", () => {
  const prompt = healthcheck.buildSyntheticPrompt(2400, {
    targetDate: "2026-06-30",
    label: "nightly-health",
  });

  assert.ok(prompt.length >= 2400);
  assert.match(prompt, /source: synthetic_checkpoint_healthcheck/);
  assert.match(prompt, /\[synthetic entry 1\]/);
  assert.doesNotMatch(prompt, /memory\/episodes|\.jsonl\.reset|raw_log DB|~\/\.openclaw/i);
});

test("buildLogEntry includes required fields and truncates responsePreview to 120 chars", () => {
  const entry = healthcheck.buildLogEntry({
    timestamp: "2026-06-30T03:30:00.000Z",
    label: "nightly",
    targetDate: "2026-06-29",
    provider: "siliconflow",
    model: "deepseek-ai/DeepSeek-V3.2",
    chars: 22000,
    maxTokens: 1024,
    timeoutMs: 120000,
    ok: true,
    durationMs: 12345,
    message: "request completed",
    error: null,
    responseText: "x".repeat(500),
  });

  assert.deepEqual(Object.keys(entry), [
    "timestamp",
    "label",
    "targetDate",
    "provider",
    "model",
    "chars",
    "maxTokens",
    "timeoutMs",
    "ok",
    "durationMs",
    "message",
    "error",
    "responsePreview",
  ]);
  assert.equal(entry.ok, true);
  assert.equal(entry.error, null);
  assert.equal(entry.responsePreview.length, 120);
});

test("buildLogEntry records failures with bounded preview", () => {
  const entry = healthcheck.buildLogEntry({
    timestamp: "2026-06-30T03:30:00.000Z",
    label: "nightly",
    targetDate: null,
    provider: "deepseek",
    model: "deepseek-chat",
    chars: 22000,
    maxTokens: 1024,
    timeoutMs: 120000,
    ok: false,
    durationMs: 456,
    message: "request failed",
    error: "timeout",
    responseText: "",
  });

  assert.equal(entry.ok, false);
  assert.equal(entry.error, "timeout");
  assert.equal(entry.responsePreview, "");
});

test("resolveDefaults chooses provider-specific default model", () => {
  const siliconflow = healthcheck.resolveDefaults({ provider: "siliconflow" }, {});
  const deepseek = healthcheck.resolveDefaults({ provider: "deepseek" }, {});

  assert.equal(siliconflow.model, "deepseek-ai/DeepSeek-V3.2");
  assert.equal(deepseek.model, "deepseek-chat");
});

test("runHealthcheck uses synthetic prompt and writes structured success log entry without real API", async () => {
  let receivedPrompt = "";
  let receivedOptions = null;
  let receivedLogPath = "";
  let receivedEntry = null;

  const result = await healthcheck.runHealthcheck({
    provider: "siliconflow",
    chars: 2600,
    maxTokens: 1024,
    timeoutMs: 120000,
    label: "synthetic-test",
    targetDate: "2026-06-29",
  }, {
    env: { MEMORY_ENGINE_CHECKPOINT_SIZE_HEALTH_LOG: "/tmp/checkpoint-size-health.log" },
    llmCompleteImpl: async (prompt, _systemPrompt, options) => {
      receivedPrompt = prompt;
      receivedOptions = options;
      return "{\"episode_summary\":\"ok\"}";
    },
    appendJsonLineImpl: (logPath, entry) => {
      receivedLogPath = logPath;
      receivedEntry = entry;
    },
  });

  assert.equal(result.ok, true);
  assert.ok(receivedPrompt.length >= 2600);
  assert.match(receivedPrompt, /synthetic_checkpoint_healthcheck/);
  assert.equal(receivedOptions.provider, "siliconflow");
  assert.equal(receivedOptions.model, "deepseek-ai/DeepSeek-V3.2");
  assert.equal(receivedLogPath, "/tmp/checkpoint-size-health.log");
  assert.equal(receivedEntry.ok, true);
  assert.equal(receivedEntry.provider, "siliconflow");
});
