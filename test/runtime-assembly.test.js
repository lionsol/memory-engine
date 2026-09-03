import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMemoryEngineRuntimeAssembly } from "../lib/runtime/assembly.js";
import { createMemoryEngineConfigContext } from "../lib/runtime/config-context.js";
import { createDefaultCliRuntime } from "../lib/services/memory-engine-cli-service.js";
import { gateThresholdForCategory } from "../lib/memory-confidence.js";

function createCoreDb(path, id = null) {
  const db = new Database(path);
  try {
    db.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        path TEXT,
        text TEXT,
        updated_at INTEGER
      )
    `);
    if (id) {
      db.prepare("INSERT INTO chunks (id, path, text, updated_at) VALUES (?, ?, ?, ?)")
        .run(id, `memory/${id}.md`, id, 1);
    }
  } finally {
    db.close();
  }
}

function restoreEnv(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("runtime assembly resolves paths and effective config once per entrypoint", () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-runtime-assembly-"));
  const previousTimeZone = process.env.MEMORY_ENGINE_TIME_ZONE;
  try {
    delete process.env.MEMORY_ENGINE_TIME_ZONE;
    const assembly = createMemoryEngineRuntimeAssembly({
      apiConfig: {
        memoryEngine: {
          timezone: { business: "Asia/Singapore" },
        },
        plugins: {
          entries: {
            "memory-engine": {
              config: {
                recentFailClosedMode: "shadow_fail_closed",
              },
            },
          },
        },
      },
      pluginConfig: {
        kgFailClosedMode: "full_fail_closed",
      },
      pathOverrides: {
        homeDir: root,
        workspaceDir: join(root, "workspace"),
        coreDbPath: join(root, "core.sqlite"),
        engineDbPath: join(root, "engine", "engine.sqlite"),
        lancedbDir: join(root, "lancedb"),
        kgPath: join(root, "kg.json"),
      },
      dbOptions: {
        paths: {
          coreDbPath: join(root, "ignored-core.sqlite"),
          engineDbPath: join(root, "ignored-engine.sqlite"),
          engineDbDir: root,
        },
      },
      lancedbOptions: {
        dbPath: join(root, "ignored-lancedb"),
      },
    });

    assert.equal(assembly.paths.workspaceDir, join(root, "workspace"));
    assert.equal(assembly.descriptor.paths, assembly.paths);
    assert.equal(Object.isFrozen(assembly.descriptor), true);
    assert.equal(Object.isFrozen(assembly.paths), true);
    assert.equal(Object.isFrozen(assembly.descriptor.db), true);
    assert.equal(assembly.database.coreDbPath, join(root, "core.sqlite"));
    assert.equal(assembly.database.engineDbPath, join(root, "engine", "engine.sqlite"));
    assert.equal(assembly.paths.timeZone, "Asia/Singapore");
    assert.equal(assembly.config.smartAddTimeZone, "Asia/Singapore");
    assert.equal(assembly.config.effectiveRuntimeConfig.kgFailClosedMode, "full_fail_closed");
    assert.equal(assembly.config.effectiveRuntimeConfig.recentFailClosedMode, "shadow_fail_closed");
    assert.equal(assembly.lancedb.dbPath, join(root, "lancedb"));
    assert.equal(assembly.lancedb.readyTimeoutMs, 400);
  } finally {
    if (previousTimeZone === undefined) delete process.env.MEMORY_ENGINE_TIME_ZONE;
    else process.env.MEMORY_ENGINE_TIME_ZONE = previousTimeZone;
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime assembly exposes a frozen invalid-config validation status", () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-validation-status-invalid-"));
  try {
    const assembly = createMemoryEngineRuntimeAssembly({
      pluginConfig: {
        autoRecall: {
          enabled: "yes",
          topK: "not-a-number",
          agentAllowlist: ["edi", 7],
        },
      },
      pathOverrides: {
        homeDir: root,
        workspaceDir: join(root, "workspace"),
        coreDbPath: join(root, "core.sqlite"),
        engineDbPath: join(root, "engine.sqlite"),
        lancedbDir: join(root, "lancedb"),
      },
      env: {},
    });

    const validation = assembly.config.validation;
    assert.deepEqual(validation, {
      code: "MEMORY_ENGINE_CONFIG_INVALID",
      valid: false,
      fallback_applied: true,
      error_count: 3,
      errors: [
        "invalid_array:autoRecall.agentAllowlist",
        "invalid_boolean:autoRecall.enabled",
        "invalid_top_k:autoRecall.topK",
      ],
    });
    assert.equal(Object.isFrozen(validation), true);
    assert.equal(Object.isFrozen(validation.errors), true);
    assert.equal(assembly.config.effectiveRuntimeConfig.autoRecall.enabled, false);
    assert.equal(assembly.config.effectiveRuntimeConfig.autoRecall.topK, 5);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime assembly exposes a frozen valid-config validation status", () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-validation-status-valid-"));
  try {
    const assembly = createMemoryEngineRuntimeAssembly({
      pathOverrides: {
        homeDir: root,
        workspaceDir: join(root, "workspace"),
        coreDbPath: join(root, "core.sqlite"),
        engineDbPath: join(root, "engine.sqlite"),
        lancedbDir: join(root, "lancedb"),
      },
      env: {},
    });

    assert.deepEqual(assembly.config.validation, {
      code: "MEMORY_ENGINE_CONFIG_VALID",
      valid: true,
      fallback_applied: false,
      error_count: 0,
      errors: [],
    });
    assert.equal(Object.isFrozen(assembly.config.validation), true);
    assert.equal(Object.isFrozen(assembly.config.validation.errors), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime assembly gives AutoRecall category gates sanitized confidence defaults", () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-auto-recall-config-safety-"));
  try {
    const context = createMemoryEngineConfigContext({
      apiConfig: {
        config: {
          memoryEngine: {
            confidence: "bad",
          },
        },
      },
      pathOverrides: {
        homeDir: root,
        workspaceDir: join(root, "workspace"),
        coreDbPath: join(root, "core.sqlite"),
        engineDbPath: join(root, "engine.sqlite"),
        lancedbDir: join(root, "lancedb"),
      },
      env: {},
    });

    assert.equal(context.config.effectiveRuntimeConfig.valid, false);
    assert.equal(context.config.memoryEngineConfig.confidence.min, 0.15);
    assert.equal(Object.hasOwn(context.config.memoryEngineConfig.confidence, "0"), false);
    assert.deepEqual(
      gateThresholdForCategory("raw_log", null, context.config.memoryEngineConfig),
      { final_score_min: 0.05, min_coverage: null },
    );
    assert.deepEqual(
      gateThresholdForCategory("episodic", null, context.config.memoryEngineConfig),
      { final_score_min: 0.02, min_coverage: null },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("config context applies explicit, env, config, and default timezone precedence", () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-timezone-precedence-"));
  const pathOverrides = {
    homeDir: root,
    workspaceDir: join(root, "workspace"),
    coreDbPath: join(root, "core.sqlite"),
    engineDbPath: join(root, "engine.sqlite"),
    lancedbDir: join(root, "lancedb"),
  };
  const apiConfig = {
    memoryEngine: {
      timezone: { business: "Asia/Singapore" },
    },
  };

  try {
    const configOnly = createMemoryEngineConfigContext({
      apiConfig,
      pathOverrides,
      env: {},
    });
    assert.equal(configOnly.paths.timeZone, "Asia/Singapore");
    assert.equal(configOnly.config.smartAddTimeZone, "Asia/Singapore");

    const envOverride = createMemoryEngineConfigContext({
      apiConfig,
      pathOverrides,
      env: { MEMORY_ENGINE_TIME_ZONE: "America/Los_Angeles" },
    });
    assert.equal(envOverride.paths.timeZone, "America/Los_Angeles");
    assert.equal(envOverride.config.smartAddTimeZone, "America/Los_Angeles");

    const explicitOverride = createMemoryEngineConfigContext({
      apiConfig,
      pathOverrides: { ...pathOverrides, timeZone: "UTC" },
      env: { MEMORY_ENGINE_TIME_ZONE: "America/Los_Angeles" },
    });
    assert.equal(explicitOverride.paths.timeZone, "UTC");
    assert.equal(explicitOverride.config.smartAddTimeZone, "UTC");

    const defaulted = createMemoryEngineConfigContext({
      pathOverrides,
      env: {},
    });
    assert.equal(defaulted.paths.timeZone, "Asia/Shanghai");
    assert.equal(defaulted.config.smartAddTimeZone, "Asia/Shanghai");

    assert.throws(
      () => createMemoryEngineConfigContext({
        apiConfig: { memoryEngine: { timezone: { business: "Not/AZone" } } },
        pathOverrides,
        env: {},
      }),
      error => error?.code === "INVALID_BUSINESS_TIME_ZONE",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("DB runtime pins Core and Engine paths after assembly", () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-db-runtime-"));
  const coreDbPath = join(root, "core.sqlite");
  const engineDbPath = join(root, "engine", "engine.sqlite");
  const otherCoreDbPath = join(root, "other-core.sqlite");
  const otherEngineDbPath = join(root, "other-engine.sqlite");
  const keys = ["MEMORY_ENGINE_CORE_DB_PATH", "MEMORY_ENGINE_DB_PATH"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));

  try {
    createCoreDb(coreDbPath, "pinned-core");
    createCoreDb(otherCoreDbPath, "other-core");
    const assembly = createMemoryEngineRuntimeAssembly({
      pathOverrides: {
        coreDbPath,
        engineDbPath,
        lancedbDir: join(root, "lancedb"),
      },
    });

    process.env.MEMORY_ENGINE_CORE_DB_PATH = otherCoreDbPath;
    process.env.MEMORY_ENGINE_DB_PATH = otherEngineDbPath;

    assembly.database.withEngineDbWritable(db => {
      db.exec("CREATE TABLE runtime_assembly_probe (value TEXT)");
      db.prepare("INSERT INTO runtime_assembly_probe (value) VALUES (?)").run("pinned");
      assert.deepEqual(db.prepare("PRAGMA database_list").all().map(row => row.name), ["main"]);
    }, {
      coreDbPath: otherCoreDbPath,
      engineDbPath: otherEngineDbPath,
    });
    assembly.database.withCoreDb(db => {
      assert.equal(db.prepare("SELECT id FROM chunks").get().id, "pinned-core");
      assert.deepEqual(db.prepare("PRAGMA database_list").all().map(row => row.name), ["main"]);
    }, {
      coreDbPath: otherCoreDbPath,
      engineDbPath: otherEngineDbPath,
    });

    assert.equal(assembly.database.ensureWritable(), true);
    assert.equal(existsSync(engineDbPath), true);
    assert.equal(existsSync(otherEngineDbPath), false);

    const check = new Database(engineDbPath, { readonly: true, fileMustExist: true });
    try {
      assert.equal(check.prepare("SELECT value FROM runtime_assembly_probe").get().value, "pinned");
    } finally {
      check.close();
    }

    assembly.database.withCoreDb(db => {
      assert.equal(db.prepare("SELECT id FROM chunks").get().id, "pinned-core");
    }, { coreDbPath: otherCoreDbPath, engineDbPath: otherEngineDbPath });

    assembly.database.withHybridDbAccessScope(access => {
      assert.deepEqual(access.capabilities, {
        isolatedFts: true,
        isolatedKg: true,
        isolatedRecent: true,
        legacyFallbackAllowed: false,
      });
      assert.equal("withLegacyDb" in access, false);
      access.withCoreDb(db => {
        assert.equal(db.prepare("SELECT id FROM chunks").get().id, "pinned-core");
      });
    });
  } finally {
    restoreEnv(previous);
    rmSync(root, { recursive: true, force: true });
  }
});

test("default CLI runtime uses the shared config and storage assembly", () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-cli-assembly-"));
  try {
    const runtime = createDefaultCliRuntime({
      workspaceDir: join(root, "workspace"),
      coreDbPath: join(root, "core.sqlite"),
      dbPath: join(root, "engine.sqlite"),
      lancedbDir: join(root, "lancedb"),
      kgPath: join(root, "kg.json"),
      config: {
        plugins: {
          entries: {
            "memory-engine": {
              config: {
                kgFailClosedMode: "shadow_fail_closed",
                recentFailClosedMode: "full_fail_closed",
              },
            },
          },
        },
      },
    });

    assert.equal(runtime.engineDbPath, join(root, "engine.sqlite"));
    assert.equal(runtime.coreDbPath, join(root, "core.sqlite"));
    assert.equal(runtime.assembly.paths.smartAddDir, join(root, "workspace", "memory", "smart-add"));
    assert.equal(runtime.assembly.config.effectiveRuntimeConfig.kgFailClosedMode, "shadow_fail_closed");
    assert.equal(runtime.assembly.config.effectiveRuntimeConfig.recentFailClosedMode, "full_fail_closed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
