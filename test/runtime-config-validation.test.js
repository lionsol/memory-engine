import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createRuntimeConfigValidationStatus,
  emitRuntimeConfigValidationWarning,
} from "../lib/runtime/config-validation.js";
import { createMemoryEngineRuntimeAssembly } from "../lib/runtime/assembly.js";

function createAssembly(pluginConfig = {}) {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-runtime-config-validation-"));
  return {
    root,
    assembly: createMemoryEngineRuntimeAssembly({
      pluginConfig,
      pathOverrides: {
        homeDir: root,
        workspaceDir: join(root, "workspace"),
        coreDbPath: join(root, "core.sqlite"),
        engineDbPath: join(root, "engine.sqlite"),
        lancedbDir: join(root, "lancedb"),
      },
      env: {},
    }),
  };
}

test("validation status deduplicates and sorts internal errors without exposing config", () => {
  const status = createRuntimeConfigValidationStatus({
    valid: false,
    errors: [
      "invalid_top_k:autoRecall.topK",
      "invalid_boolean:autoRecall.enabled",
      "invalid_top_k:autoRecall.topK",
    ],
  });

  assert.deepEqual(status, {
    code: "MEMORY_ENGINE_CONFIG_INVALID",
    valid: false,
    fallback_applied: true,
    error_count: 2,
    errors: [
      "invalid_boolean:autoRecall.enabled",
      "invalid_top_k:autoRecall.topK",
    ],
  });
  assert.equal(Object.isFrozen(status), true);
  assert.equal(Object.isFrozen(status.errors), true);
});

test("validation status replaces non-code error payloads with a bounded code", () => {
  const status = createRuntimeConfigValidationStatus({
    valid: false,
    errors: ["private-secret-value", "invalid_mode:recentFailClosedMode"],
  });

  assert.deepEqual(status.errors, ["invalid_mode:recentFailClosedMode", "invalid_runtime_config"]);
  assert.equal(JSON.stringify(status).includes("private-secret-value"), false);
});

test("invalid startup validation emits one bounded logger warning", () => {
  const { root, assembly } = createAssembly({
    autoRecall: {
      enabled: "private-secret-value",
      agentAllowlist: ["private-agent", 4],
    },
  });
  const warnings = [];
  const consoleWarnings = [];
  try {
    const emitted = emitRuntimeConfigValidationWarning(assembly.config.validation, {
      logger: { warn: message => warnings.push(message) },
      consoleWarn: message => consoleWarnings.push(message),
    });

    assert.equal(emitted, true);
    assert.equal(warnings.length, 1);
    assert.equal(consoleWarnings.length, 0);
    assert.match(warnings[0], /MEMORY_ENGINE_CONFIG_INVALID/);
    assert.match(warnings[0], /fallback_applied=true/);
    assert.match(warnings[0], /error_count=2/);
    assert.match(warnings[0], /invalid_array:autoRecall\.agentAllowlist/);
    assert.match(warnings[0], /invalid_boolean:autoRecall\.enabled/);
    assert.equal(warnings[0].includes("private-secret-value"), false);
    assert.equal(warnings[0].includes("private-agent"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("valid or absent optional config emits no invalid-config warning", () => {
  const warnings = [];
  const consoleWarnings = [];
  const status = createRuntimeConfigValidationStatus({ valid: true, errors: [] });

  assert.equal(emitRuntimeConfigValidationWarning(status, {
    logger: { warn: message => warnings.push(message) },
    consoleWarn: message => consoleWarnings.push(message),
  }), false);
  assert.deepEqual(warnings, []);
  assert.deepEqual(consoleWarnings, []);
});

test("missing logger uses console warning exactly once", () => {
  const warnings = [];
  const status = createRuntimeConfigValidationStatus({
    valid: false,
    errors: ["invalid_mode:recentFailClosedMode"],
  });

  assert.equal(emitRuntimeConfigValidationWarning(status, {
    consoleWarn: message => warnings.push(message),
  }), true);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /MEMORY_ENGINE_CONFIG_INVALID/);
  assert.match(warnings[0], /fallback_applied=true/);
  assert.match(warnings[0], /error_count=1/);
  assert.match(warnings[0], /invalid_mode:recentFailClosedMode/);
});

test("plugin startup validation warning precedes storage and Lance initialization", () => {
  const source = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  const warningPosition = source.indexOf("emitRuntimeConfigValidationWarning(assembly.config.validation");
  const storagePosition = source.indexOf("withEngineDbWritable(db => ensureMemoryEngineTables");
  const lancePosition = source.indexOf("void ensureLanceDBReady()");

  assert.ok(warningPosition >= 0);
  assert.ok(storagePosition > warningPosition);
  assert.ok(lancePosition > warningPosition);
});
