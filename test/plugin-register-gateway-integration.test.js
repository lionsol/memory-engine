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

test("plugin register warns once before registering product surfaces for invalid config", async (t) => {
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
  const validationWarnings = [];
  const startupEvents = [];

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
    const commands = [];
    const apiConfig = false;
    const api = {
      config: apiConfig,
      pluginConfig: "private-secret-value",
      runtime: {
        version: "test-openclaw-runtime",
        config: { current: () => apiConfig },
      },
      logger: {
        warn(message) {
          startupEvents.push("logger.warn");
          validationWarnings.push(message);
        },
      },
      registerGatewayMethod(name, handler, options) {
        gatewayMethods.set(name, { handler, options });
      },
      registerMemoryPromptSupplement() {},
      registerTool(tool, options) {
        startupEvents.push("registerTool");
        tools.push(options?.name || tool.name);
      },
      registerCommand(command) {
        startupEvents.push("registerCommand");
        assert.equal(arguments.length, 1);
        assert.equal(typeof command, "object");
        assert.notEqual(command, null);
        assert.equal(Array.isArray(command), false);
        commands.push(command);
      },
      on(name) {
        startupEvents.push(`on:${name}`);
        hooks.push(name);
      },
    };

    plugin.register(api);
    await new Promise(resolve => setTimeout(resolve, 100));

    assert.equal(validationWarnings.length, 1);
    assert.match(validationWarnings[0], /MEMORY_ENGINE_CONFIG_INVALID/);
    assert.match(validationWarnings[0], /fallback_applied=true/);
    assert.match(validationWarnings[0], /error_count=2/);
    assert.match(validationWarnings[0], /invalid_object:apiConfig/);
    assert.match(validationWarnings[0], /invalid_object:pluginConfig/);
    assert.equal(validationWarnings[0].includes("private-secret-value"), false);
    assert.equal(startupEvents[0], "logger.warn");
    assert.deepEqual([...gatewayMethods.keys()], []);
    assert.deepEqual(tools.sort(), ["memory_engine", "memory_engine_get", "memory_engine_search"]);
    assert.deepEqual(hooks, ["before_tool_call"]);
    assert.deepEqual(commands.map(command => command.name), ["memory-disclosure"]);
    assert.equal(commands[0].description, "Owner-authenticated preview and exact attestation management for disclosure cards.");
    assert.equal(commands[0].requireAuth, true);
    assert.deepEqual(commands[0].requiredScopes, ["operator.write"]);
    assert.equal(commands[0].exposeSenderIsOwner, true);
    assert.equal(commands[0].acceptsArgs, true);
    assert.equal(typeof commands[0].handler, "function");
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
