import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const checkpoint = require("../bin/session-checkpoint.js");
const checkpointConfig = require("../lib/checkpoint/config.js");

function makeFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-checkpoint-config-"));
  const workspaceDir = resolve(root, "workspace");
  const credentialsDir = resolve(root, "credentials");
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(credentialsDir, { recursive: true });
  return {
    workspaceDir,
    configJsonPath: resolve(root, "openclaw.json"),
    credentialsDir,
  };
}

async function withEnv(name, value, fn) {
  const prev = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
  }
}

test("getConfig reads JSON from runtime configJsonPath", async () => {
  const fixture = makeFixture();
  writeFileSync(fixture.configJsonPath, JSON.stringify({
    models: { providers: { siliconflow: { apiKey: "sf-from-config" } } },
  }));

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    configJsonPath: fixture.configJsonPath,
  }, async () => {
    const config = checkpointConfig.getConfig();
    assert.equal(config.models.providers.siliconflow.apiKey, "sf-from-config");
  });
});

test("getConfig returns {} when config file is missing", async () => {
  const fixture = makeFixture();

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    configJsonPath: resolve(fixture.workspaceDir, "missing-openclaw.json"),
  }, async () => {
    assert.deepEqual(checkpointConfig.getConfig(), {});
  });
});

test("getConfig returns {} when config file JSON is invalid", async () => {
  const fixture = makeFixture();
  writeFileSync(fixture.configJsonPath, "{ invalid json");

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    configJsonPath: fixture.configJsonPath,
  }, async () => {
    assert.deepEqual(checkpointConfig.getConfig(), {});
  });
});

test("getSFKey reads apiKey from config", async () => {
  const fixture = makeFixture();
  writeFileSync(fixture.configJsonPath, JSON.stringify({
    models: { providers: { siliconflow: { apiKey: "sf-secret" } } },
  }));

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    configJsonPath: fixture.configJsonPath,
  }, async () => {
    assert.equal(checkpointConfig.getSFKey(), "sf-secret");
  });
});

test("getSFBaseUrl returns default when config is absent", async () => {
  const fixture = makeFixture();

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    configJsonPath: resolve(fixture.workspaceDir, "no-config.json"),
  }, async () => {
    assert.equal(checkpointConfig.getSFBaseUrl(), "https://api.siliconflow.cn/v1");
  });
});

test("getDSKey prefers credentials file over config and env", async () => {
  const fixture = makeFixture();
  writeFileSync(resolve(fixture.credentialsDir, "deepseek-api-key"), "ds-from-file\n");
  writeFileSync(fixture.configJsonPath, JSON.stringify({
    models: { providers: { deepseek: { apiKey: "ds-from-config" } } },
  }));

  await withEnv("DEEPSEEK_API_KEY", "ds-from-env", async () => {
    await checkpoint.withRuntime({
      workspaceDir: fixture.workspaceDir,
      configJsonPath: fixture.configJsonPath,
    }, async () => {
      assert.equal(checkpointConfig.getDSKey(), "ds-from-file");
    });
  });
});

test("getDSKey prefers config over env when credentials file is absent", async () => {
  const fixture = makeFixture();
  writeFileSync(fixture.configJsonPath, JSON.stringify({
    models: { providers: { deepseek: { apiKey: "ds-from-config" } } },
  }));

  await withEnv("DEEPSEEK_API_KEY", "ds-from-env", async () => {
    await checkpoint.withRuntime({
      workspaceDir: fixture.workspaceDir,
      configJsonPath: fixture.configJsonPath,
    }, async () => {
      assert.equal(checkpointConfig.getDSKey(), "ds-from-config");
    });
  });
});

test("getDSBaseUrl returns default when config is absent", async () => {
  const fixture = makeFixture();

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    configJsonPath: resolve(fixture.workspaceDir, "no-config.json"),
  }, async () => {
    assert.equal(checkpointConfig.getDSBaseUrl(), "https://api.deepseek.com");
  });
});

test("config helpers do not leak key text in thrown errors", async () => {
  const fixture = makeFixture();
  writeFileSync(resolve(fixture.credentialsDir, "deepseek-api-key"), "super-secret-key\n");
  writeFileSync(fixture.configJsonPath, JSON.stringify({
    models: {
      providers: {
        siliconflow: { apiKey: "sf-super-secret" },
        deepseek: { apiKey: "ds-super-secret" },
      },
    },
  }));

  await withEnv("DEEPSEEK_API_KEY", "env-super-secret", async () => {
    await checkpoint.withRuntime({
      workspaceDir: fixture.workspaceDir,
      configJsonPath: fixture.configJsonPath,
    }, async () => {
      let errorText = "";
      try {
        checkpointConfig.getDSKey();
        checkpointConfig.getSFKey();
      } catch (error) {
        errorText = String(error?.message || error);
      }
      assert.doesNotMatch(errorText, /super-secret/);
    });
  });
});

test("resolveCheckpointProviders returns deepseek then siliconflow by default", () => {
  const warnings = [];
  const resolved = checkpointConfig.resolveCheckpointProviders({}, {
    warn: (message) => warnings.push(message),
  });

  assert.deepEqual(resolved, {
    primaryProvider: "deepseek",
    fallbackProvider: "siliconflow",
    warnings: [],
  });
  assert.deepEqual(warnings, []);
});

test("resolveCheckpointProviders supports env override", () => {
  const resolved = checkpointConfig.resolveCheckpointProviders({
    MEMORY_ENGINE_CHECKPOINT_PRIMARY_PROVIDER: "siliconflow",
    MEMORY_ENGINE_CHECKPOINT_FALLBACK_PROVIDER: "deepseek",
  }, null);

  assert.deepEqual(resolved, {
    primaryProvider: "siliconflow",
    fallbackProvider: "deepseek",
    warnings: [],
  });
});

test("resolveCheckpointProviders accepts fallback none", () => {
  const resolved = checkpointConfig.resolveCheckpointProviders({
    MEMORY_ENGINE_CHECKPOINT_FALLBACK_PROVIDER: "none",
  }, null);

  assert.deepEqual(resolved, {
    primaryProvider: "deepseek",
    fallbackProvider: "none",
    warnings: [],
  });
});

test("resolveCheckpointProviders preserves same primary and fallback provider", () => {
  const resolved = checkpointConfig.resolveCheckpointProviders({
    MEMORY_ENGINE_CHECKPOINT_PRIMARY_PROVIDER: "deepseek",
    MEMORY_ENGINE_CHECKPOINT_FALLBACK_PROVIDER: "deepseek",
  }, null);

  assert.deepEqual(resolved, {
    primaryProvider: "deepseek",
    fallbackProvider: "deepseek",
    warnings: [],
  });
});

test("resolveCheckpointProviders falls back invalid primary to default and records warning", () => {
  const warnings = [];
  const resolved = checkpointConfig.resolveCheckpointProviders({
    MEMORY_ENGINE_CHECKPOINT_PRIMARY_PROVIDER: "DeepSeek",
  }, {
    warn: (message) => warnings.push(message),
  });

  assert.equal(resolved.primaryProvider, "deepseek");
  assert.equal(resolved.fallbackProvider, "siliconflow");
  assert.equal(resolved.warnings.length, 1);
  assert.match(resolved.warnings[0], /Invalid MEMORY_ENGINE_CHECKPOINT_PRIMARY_PROVIDER/);
  assert.deepEqual(warnings, resolved.warnings);
});

test("resolveCheckpointProviders falls back invalid fallback to default and records warning", () => {
  const warnings = [];
  const resolved = checkpointConfig.resolveCheckpointProviders({
    MEMORY_ENGINE_CHECKPOINT_FALLBACK_PROVIDER: "SILICONFLOW",
  }, {
    warn: (message) => warnings.push(message),
  });

  assert.equal(resolved.primaryProvider, "deepseek");
  assert.equal(resolved.fallbackProvider, "siliconflow");
  assert.equal(resolved.warnings.length, 1);
  assert.match(resolved.warnings[0], /Invalid MEMORY_ENGINE_CHECKPOINT_FALLBACK_PROVIDER/);
  assert.deepEqual(warnings, resolved.warnings);
});

test("resolveCheckpointProviders treats empty strings as invalid", () => {
  const warnings = [];
  const resolved = checkpointConfig.resolveCheckpointProviders({
    MEMORY_ENGINE_CHECKPOINT_PRIMARY_PROVIDER: "",
    MEMORY_ENGINE_CHECKPOINT_FALLBACK_PROVIDER: "",
  }, {
    warn: (message) => warnings.push(message),
  });

  assert.deepEqual(resolved, {
    primaryProvider: "deepseek",
    fallbackProvider: "siliconflow",
    warnings,
  });
  assert.equal(warnings.length, 2);
});

test("resolveCheckpointLlmRequestConfig returns default request budget values", () => {
  const warnings = [];
  const resolved = checkpointConfig.resolveCheckpointLlmRequestConfig({}, {
    warn: (message) => warnings.push(message),
  });

  assert.deepEqual(resolved, {
    maxInputChars: 45000,
    maxTokens: 4096,
    timeoutMs: 120000,
    warnings: [],
  });
  assert.deepEqual(warnings, []);
});

test("resolveCheckpointLlmRequestConfig supports env override", () => {
  const resolved = checkpointConfig.resolveCheckpointLlmRequestConfig({
    MEMORY_ENGINE_CHECKPOINT_LLM_MAX_INPUT_CHARS: "30000",
    MEMORY_ENGINE_CHECKPOINT_LLM_MAX_TOKENS: "2048",
    MEMORY_ENGINE_CHECKPOINT_LLM_TIMEOUT_MS: "90000",
  }, null);

  assert.deepEqual(resolved, {
    maxInputChars: 30000,
    maxTokens: 2048,
    timeoutMs: 90000,
    warnings: [],
  });
});

test("resolveCheckpointLlmRequestConfig falls back invalid values to defaults with warnings", () => {
  const warnings = [];
  const resolved = checkpointConfig.resolveCheckpointLlmRequestConfig({
    MEMORY_ENGINE_CHECKPOINT_LLM_MAX_INPUT_CHARS: "0",
    MEMORY_ENGINE_CHECKPOINT_LLM_MAX_TOKENS: "-1",
    MEMORY_ENGINE_CHECKPOINT_LLM_TIMEOUT_MS: "abc",
  }, {
    warn: (message) => warnings.push(message),
  });

  assert.deepEqual(resolved, {
    maxInputChars: 45000,
    maxTokens: 4096,
    timeoutMs: 120000,
    warnings,
  });
  assert.equal(warnings.length, 3);
  assert.match(warnings[0], /MEMORY_ENGINE_CHECKPOINT_LLM_MAX_INPUT_CHARS/);
  assert.match(warnings[1], /MEMORY_ENGINE_CHECKPOINT_LLM_MAX_TOKENS/);
  assert.match(warnings[2], /MEMORY_ENGINE_CHECKPOINT_LLM_TIMEOUT_MS/);
});

test("resolveCheckpointLlmRequestConfig treats empty string as invalid", () => {
  const warnings = [];
  const resolved = checkpointConfig.resolveCheckpointLlmRequestConfig({
    MEMORY_ENGINE_CHECKPOINT_LLM_MAX_INPUT_CHARS: "",
    MEMORY_ENGINE_CHECKPOINT_LLM_MAX_TOKENS: "",
    MEMORY_ENGINE_CHECKPOINT_LLM_TIMEOUT_MS: "",
  }, {
    warn: (message) => warnings.push(message),
  });

  assert.deepEqual(resolved, {
    maxInputChars: 45000,
    maxTokens: 4096,
    timeoutMs: 120000,
    warnings,
  });
  assert.equal(warnings.length, 3);
});
