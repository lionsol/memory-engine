import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMemoryEngineRuntimeAssembly } from "../lib/runtime/assembly.js";
import { createDefaultCliRuntime } from "../lib/services/memory-engine-cli-service.js";

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

    assembly.database.withDb(db => {
      db.exec("CREATE TABLE runtime_assembly_probe (value TEXT)");
      db.prepare("INSERT INTO runtime_assembly_probe (value) VALUES (?)").run("pinned");
      assert.equal(db.prepare("SELECT id FROM core.chunks").get().id, "pinned-core");
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
      });
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
