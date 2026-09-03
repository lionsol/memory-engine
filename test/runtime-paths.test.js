import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  resolveCoreDbPath,
  resolveEngineDbPath,
} from "../lib/db/db-paths.js";

const require = createRequire(import.meta.url);
const checkpointRuntime = require("../lib/checkpoint/runtime.js");
const {
  DEFAULT_TIME_ZONE,
  resolveMemoryEnginePaths,
} = require("../lib/runtime/paths.cjs");

function withEnv(overrides, run) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("shared runtime paths derive every default from one OpenClaw root", () => {
  const paths = resolveMemoryEnginePaths({ homeDir: "/tmp/sol-home" }, {});

  assert.equal(paths.openclawDir, "/tmp/sol-home/.openclaw");
  assert.equal(paths.workspaceDir, "/tmp/sol-home/.openclaw/workspace");
  assert.equal(paths.memoryDir, "/tmp/sol-home/.openclaw/workspace/memory");
  assert.equal(paths.smartAddDir, "/tmp/sol-home/.openclaw/workspace/memory/smart-add");
  assert.equal(paths.coreDbPath, "/tmp/sol-home/.openclaw/memory/main.sqlite");
  assert.equal(paths.engineDbPath, "/tmp/sol-home/.openclaw/memory/memory-engine/memory-engine.sqlite");
  assert.equal(paths.lancedbDir, "/tmp/sol-home/.openclaw/memory/lancedb");
  assert.equal(paths.configJsonPath, "/tmp/sol-home/.openclaw/openclaw.json");
  assert.equal(paths.timeZone, DEFAULT_TIME_ZONE);
});

test("shared runtime paths prefer the current agent Core store and retain legacy fallback", () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-paths-"));
  const currentCore = join(root, ".openclaw/agents/edi/agent/openclaw-agent.sqlite");
  try {
    const legacy = resolveMemoryEnginePaths({ homeDir: root, agentId: "edi" }, {});
    assert.equal(legacy.agentId, "edi");
    assert.equal(legacy.coreDbPath, join(root, ".openclaw/memory/main.sqlite"));
    assert.equal(legacy.sessionsDir, join(root, ".openclaw/agents/edi/sessions"));

    mkdirSync(join(root, ".openclaw/agents/edi/agent"), { recursive: true });
    writeFileSync(currentCore, "");
    const current = resolveMemoryEnginePaths({ homeDir: root, agentId: "edi" }, {});
    assert.equal(current.coreDbPath, currentCore);

    const envAgent = resolveMemoryEnginePaths({ homeDir: root }, {
      MEMORY_ENGINE_AGENT_ID: "edi",
    });
    assert.equal(envAgent.agentId, "edi");
    assert.equal(envAgent.coreDbPath, currentCore);

    const explicit = resolveMemoryEnginePaths({
      homeDir: root,
      agentId: "edi",
      coreDbPath: "/tmp/explicit-current-core.sqlite",
    }, {});
    assert.equal(explicit.coreDbPath, "/tmp/explicit-current-core.sqlite");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shared runtime paths use one documented environment precedence", () => {
  const paths = resolveMemoryEnginePaths({ homeDir: "/tmp/home" }, {
    OPENCLAW_HOME: "/tmp/openclaw-home",
    OPENCLAW_WORKSPACE: "/tmp/openclaw-workspace",
    MEMORY_ENGINE_WORKSPACE_DIR: "/tmp/memory-workspace",
    MEMORY_ENGINE_CORE_DB: "/tmp/core-legacy.sqlite",
    MEMORY_ENGINE_CORE_DB_PATH: "/tmp/core-specific.sqlite",
    CORE_DB_PATH: "/tmp/core-host.sqlite",
    MEMORY_ENGINE_DB: "/tmp/engine-legacy.sqlite",
    MEMORY_ENGINE_DB_PATH: "/tmp/engine-specific.sqlite",
    ENGINE_DB_PATH: "/tmp/engine-host.sqlite",
    MEMORY_ENGINE_LANCEDB_DIR: "/tmp/lancedb",
    MEMORY_ENGINE_SESSIONS_DIR: "/tmp/sessions",
    OPENCLAW_CONFIG_PATH: "/tmp/openclaw.json",
    MEMORY_ENGINE_KG_PATH: "/tmp/kg.json",
    MEMORY_ENGINE_TIME_ZONE: "Asia/Singapore",
  });

  assert.equal(paths.openclawDir, "/tmp/openclaw-home");
  assert.equal(paths.workspaceDir, "/tmp/memory-workspace");
  assert.equal(paths.memoryDir, "/tmp/memory-workspace/memory");
  assert.equal(paths.coreDbPath, "/tmp/core-specific.sqlite");
  assert.equal(paths.engineDbPath, "/tmp/engine-specific.sqlite");
  assert.equal(paths.lancedbDir, "/tmp/lancedb");
  assert.equal(paths.sessionsDir, "/tmp/sessions");
  assert.equal(paths.configJsonPath, "/tmp/openclaw.json");
  assert.equal(paths.kgPath, "/tmp/kg.json");
  assert.equal(paths.timeZone, "Asia/Singapore");
});

test("explicit path options override every environment alias", () => {
  const paths = resolveMemoryEnginePaths({
    homeDir: "/tmp/home",
    workspaceDir: "/tmp/explicit-workspace",
    coreDbPath: "/tmp/explicit-core.sqlite",
    engineDbPath: "/tmp/explicit-engine.sqlite",
    lancedbDir: "/tmp/explicit-lancedb",
  }, {
    MEMORY_ENGINE_WORKSPACE_DIR: "/tmp/env-workspace",
    CORE_DB_PATH: "/tmp/env-core.sqlite",
    ENGINE_DB_PATH: "/tmp/env-engine.sqlite",
    MEMORY_ENGINE_LANCEDB_DIR: "/tmp/env-lancedb",
  });

  assert.equal(paths.workspaceDir, "/tmp/explicit-workspace");
  assert.equal(paths.coreDbPath, "/tmp/explicit-core.sqlite");
  assert.equal(paths.engineDbPath, "/tmp/explicit-engine.sqlite");
  assert.equal(paths.lancedbDir, "/tmp/explicit-lancedb");
});

test("checkpoint runtime delegates path construction to the shared resolver", async () => {
  await checkpointRuntime.withRuntime({
    homeDir: "/tmp/checkpoint-home",
    workspaceDir: "/tmp/checkpoint-workspace",
    coreDbPath: "/tmp/checkpoint-core.sqlite",
    engineDbPath: "/tmp/checkpoint-engine.sqlite",
    timeZone: "Asia/Singapore",
  }, async () => {
    const runtime = checkpointRuntime.getRuntime();
    assert.equal(runtime.workspaceDir, "/tmp/checkpoint-workspace");
    assert.equal(runtime.memoryDir, "/tmp/checkpoint-workspace/memory");
    assert.equal(runtime.smartAddDir, "/tmp/checkpoint-workspace/memory/smart-add");
    assert.equal(runtime.coreDbPath, "/tmp/checkpoint-core.sqlite");
    assert.equal(runtime.engineDbPath, "/tmp/checkpoint-engine.sqlite");
    assert.equal(runtime.timeZone, "Asia/Singapore");
  });
});

test("engine DB resolvers prefer memory-engine aliases over generic compatibility aliases", () => {
  withEnv({
    CORE_DB_PATH: "/tmp/core-host.sqlite",
    MEMORY_ENGINE_CORE_DB_PATH: "/tmp/core-specific.sqlite",
    MEMORY_ENGINE_CORE_DB: "/tmp/core-legacy.sqlite",
    ENGINE_DB_PATH: "/tmp/engine-host.sqlite",
    MEMORY_ENGINE_DB_PATH: "/tmp/engine-specific.sqlite",
    MEMORY_ENGINE_DB: "/tmp/engine-legacy.sqlite",
  }, () => {
    assert.equal(resolveCoreDbPath(), resolve("/tmp/core-specific.sqlite"));
    assert.equal(resolveEngineDbPath(), resolve("/tmp/engine-specific.sqlite"));
    assert.equal(resolveCoreDbPath({ coreDbPath: "/tmp/core-explicit.sqlite" }), resolve("/tmp/core-explicit.sqlite"));
    assert.equal(resolveEngineDbPath({ engineDbPath: "/tmp/engine-explicit.sqlite" }), resolve("/tmp/engine-explicit.sqlite"));
  });
});

test("checkpoint preserves its startup-time MEMORY_ENGINE_MEMORY_DIR compatibility override", () => {
  const modulePath = new URL("../lib/checkpoint/runtime.js", import.meta.url).pathname;
  const script = [
    `const runtime = require(${JSON.stringify(modulePath)}).getRuntime();`,
    "console.log(JSON.stringify({ memoryDir: runtime.memoryDir, smartAddDir: runtime.smartAddDir, episodesDir: runtime.episodesDir }));",
  ].join("\n");
  const result = spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    env: { ...process.env, MEMORY_ENGINE_MEMORY_DIR: "/tmp/checkpoint-memory" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    memoryDir: "/tmp/checkpoint-memory",
    smartAddDir: "/tmp/checkpoint-memory/smart-add",
    episodesDir: "/tmp/checkpoint-memory/episodes",
  });
});

test("plugin runtime constants resolve workspace, smart-add, KG, and LanceDB from one startup context", () => {
  const moduleUrl = new URL("../memory-manager-runtime.js", import.meta.url).href;
  const consoleDbUrl = new URL("../console/services/db.js", import.meta.url).href;
  const script = [
    `import * as runtime from ${JSON.stringify(moduleUrl)};`,
    `import * as consoleDb from ${JSON.stringify(consoleDbUrl)};`,
    "console.log(JSON.stringify({",
    "workspace: runtime.WORKSPACE,",
    "smartAdd: runtime.SMART_ADD_PATH,",
    "kg: runtime.KG_PATH,",
    "lancedb: runtime.LANCEDB_DIR,",
    "core: runtime.CORE_DB_PATH,",
    "engine: runtime.ENGINE_DB_PATH,",
    "consoleCore: consoleDb.CORE_PATH,",
    "consoleEngine: consoleDb.DB_PATH",
    "}));",
  ].join("\n");
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      OPENCLAW_HOME: "/tmp/runtime-openclaw",
      MEMORY_ENGINE_KG_PATH: "/tmp/runtime-kg.json",
      MEMORY_ENGINE_LANCEDB_DIR: "/tmp/runtime-lancedb",
      MEMORY_ENGINE_CORE_DB_PATH: "/tmp/runtime-core.sqlite",
      MEMORY_ENGINE_DB_PATH: "/tmp/runtime-engine.sqlite",
      CORE_DB_PATH: "/tmp/ignored-core.sqlite",
      ENGINE_DB_PATH: "/tmp/ignored-engine.sqlite",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    workspace: "/tmp/runtime-openclaw/workspace",
    smartAdd: "/tmp/runtime-openclaw/workspace/memory/smart-add",
    kg: "/tmp/runtime-kg.json",
    lancedb: "/tmp/runtime-lancedb",
    core: "/tmp/runtime-core.sqlite",
    engine: "/tmp/runtime-engine.sqlite",
    consoleCore: "/tmp/runtime-core.sqlite",
    consoleEngine: "/tmp/runtime-engine.sqlite",
  });
});
