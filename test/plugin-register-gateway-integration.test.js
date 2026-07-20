import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const ORIGINAL_HOME = homedir();
const OPENCLAW_ROOT = process.env.OPENCLAW_PACKAGE_ROOT
  || join(ORIGINAL_HOME, ".local", "lib", "node_modules", "openclaw");
const OPENCLAW_PLUGIN_ENTRY = join(OPENCLAW_ROOT, "dist", "plugin-sdk", "plugin-entry.js");
const OPENCLAW_MEMORY_RUNTIME = join(OPENCLAW_ROOT, "dist", "plugin-sdk", "memory-core-engine-runtime.js");

function installOpenClawResolveHook() {
  const replacements = new Map([
    ["openclaw/plugin-sdk/plugin-entry", OPENCLAW_PLUGIN_ENTRY],
    ["openclaw/plugin-sdk/memory-core-engine-runtime", OPENCLAW_MEMORY_RUNTIME],
  ]);
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const replacement = replacements.get(specifier);
      if (!replacement) return nextResolve(specifier, context);
      return {
        url: pathToFileURL(replacement).href,
        shortCircuit: true,
      };
    },
  });
}

function createCoreDb(path) {
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
  } finally {
    db.close();
  }
}

test("plugin register wires both operator-read evidence gateways through the loaded host SDK", async (t) => {
  if (!existsSync(OPENCLAW_PLUGIN_ENTRY) || !existsSync(OPENCLAW_MEMORY_RUNTIME)) {
    t.skip(`OpenClaw plugin SDK unavailable under ${OPENCLAW_ROOT}`);
    return;
  }

  const root = mkdtempSync(join(tmpdir(), "memory-engine-register-integration-"));
  const previous = {
    HOME: process.env.HOME,
    MEMORY_ENGINE_DB_PATH: process.env.MEMORY_ENGINE_DB_PATH,
    MEMORY_ENGINE_CORE_DB: process.env.MEMORY_ENGINE_CORE_DB,
  };
  const originalLog = console.log;
  const logs = [];

  try {
    process.env.HOME = root;
    process.env.MEMORY_ENGINE_DB_PATH = join(root, "engine.sqlite");
    process.env.MEMORY_ENGINE_CORE_DB = join(root, "core.sqlite");
    mkdirSync(join(root, ".openclaw", "workspace"), { recursive: true });
    createCoreDb(process.env.MEMORY_ENGINE_CORE_DB);
    const config = {
      plugins: {
        entries: {
          "active-memory": { enabled: false },
          "memory-engine": { enabled: true, config: {} },
        },
      },
    };
    writeFileSync(join(root, ".openclaw", "openclaw.json"), JSON.stringify(config), "utf8");
    console.log = (...args) => logs.push(args.join(" "));

    installOpenClawResolveHook();
    const { default: plugin } = await import("../index.js");

    const gatewayMethods = new Map();
    const tools = [];
    const hooks = [];
    const apiConfig = {
      plugins: {
        entries: {
          "active-memory": { enabled: false },
          "memory-engine": { enabled: true, config: {} },
        },
      },
    };
    const api = {
      config: apiConfig,
      pluginConfig: {},
      runtime: {
        version: "test-openclaw-runtime",
        config: { current: () => apiConfig },
      },
      logger: { warn() {} },
      registerGatewayMethod(name, handler, options) {
        gatewayMethods.set(name, { handler, options });
      },
      registerMemoryPromptSupplement() {},
      registerTool(tool) {
        tools.push(tool.name);
      },
      on(name) {
        hooks.push(name);
      },
    };

    plugin.register(api);
    await new Promise(resolve => setTimeout(resolve, 100));

    assert.deepEqual([...gatewayMethods.keys()].sort(), [
      "memoryEngine.productionEvidenceHealthcheck",
      "memoryEngine.sustainedRuntimePreflight",
    ]);
    assert.equal(
      gatewayMethods.get("memoryEngine.sustainedRuntimePreflight").options.scope,
      "operator.read",
    );
    assert.equal(
      gatewayMethods.get("memoryEngine.productionEvidenceHealthcheck").options.scope,
      "operator.read",
    );
    assert.deepEqual(tools.sort(), ["memory_engine", "memory_engine_get", "memory_engine_search"]);
    assert.deepEqual(hooks, ["before_tool_call"]);

    let response = null;
    await gatewayMethods.get("memoryEngine.sustainedRuntimePreflight").handler({
      respond(ok, result, error) {
        response = { ok, result, error };
      },
    });
    assert.equal(response.ok, true);
    assert.equal(response.error, undefined);
    assert.equal(response.result.status, "clean");
    assert.equal(response.result.openclaw_runtime_version, "test-openclaw-runtime");
    assert.equal(response.result.runtime_boundary.active_memory_enabled, false);
  } finally {
    console.log = originalLog;
    if (previous.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = previous.HOME;
    if (previous.MEMORY_ENGINE_DB_PATH === undefined) delete process.env.MEMORY_ENGINE_DB_PATH;
    else process.env.MEMORY_ENGINE_DB_PATH = previous.MEMORY_ENGINE_DB_PATH;
    if (previous.MEMORY_ENGINE_CORE_DB === undefined) delete process.env.MEMORY_ENGINE_CORE_DB;
    else process.env.MEMORY_ENGINE_CORE_DB = previous.MEMORY_ENGINE_CORE_DB;
    rmSync(root, { recursive: true, force: true });
  }
});
