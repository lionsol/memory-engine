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
