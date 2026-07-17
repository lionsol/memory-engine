import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import {
  commandActionParams,
  executeMemoryEngineCommand,
} from "../lib/services/memory-engine-cli-service.js";
import { resolveEngineDbPath } from "../lib/db/engine-db.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = resolve(repoRoot, "bin", "memory-engine-cli.js");
const { parseCliArgs } = createRequire(import.meta.url)(cliPath);

test("service maps CLI commands to the existing action executor", async () => {
  const calls = [];
  const runtime = {
    executeAction: async (toolCallId, params) => {
      calls.push({ toolCallId, params });
      return { success: true, params };
    },
  };

  const result = await executeMemoryEngineCommand("search", {
    query: "hello",
    topK: 5,
  }, runtime);

  assert.equal(result.success, true);
  assert.deepEqual(calls, [{
    toolCallId: "memory-engine-cli",
    params: {
      action: "search",
      text: "hello",
      top_k: 5,
    },
  }]);
});

test("command mapping preserves add and status inputs without DB access", () => {
  assert.deepEqual(commandActionParams("add", {
    text: "用户偏好 使用中文",
    category: "preference",
    protected: true,
  }), {
    action: "add",
    text: "用户偏好 使用中文",
    category: "preference",
    protected: true,
  });
  assert.deepEqual(commandActionParams("status"), { action: "status" });
});

test("CLI parser maps search argv without splitting the query", () => {
  assert.deepEqual(parseCliArgs([
    "search",
    "hello",
    "用户偏好 使用中文",
    "--top-k",
    "5",
  ]), {
    command: "search",
    options: {
      dbPath: null,
      query: "hello 用户偏好 使用中文",
      topK: 5,
    },
  });
});

test("service propagates action failures as structured CLI errors", async () => {
  const result = await executeMemoryEngineCommand("search", { query: "broken", topK: 5 }, {
    executeAction: async () => {
      throw new Error("fake service failure");
    },
  });

  assert.deepEqual(result, { error: "fake service failure" });
});

test("status does not initialize LanceDB", async () => {
  let readyCalls = 0;
  let actionCalls = 0;
  const result = await executeMemoryEngineCommand("status", {}, {
    ensureLancedbReady: async () => {
      readyCalls += 1;
    },
    executeAction: async () => {
      actionCalls += 1;
      return {
        confidence_tracked: 0,
        archived: 0,
        protected: 0,
        conflicted: 0,
        by_category: [],
      };
    },
  });

  assert.equal(result.error, undefined);
  assert.equal(readyCalls, 0);
  assert.equal(actionCalls, 1);
});

test("search still initializes LanceDB", async () => {
  let readyCalls = 0;
  let actionCalls = 0;
  const result = await executeMemoryEngineCommand("search", { query: "hello", topK: 5 }, {
    ensureLancedbReady: async () => {
      readyCalls += 1;
    },
    executeAction: async () => {
      actionCalls += 1;
      return { results: [], pool: 0 };
    },
  });

  assert.equal(result.error, undefined);
  assert.equal(readyCalls, 1);
  assert.equal(actionCalls, 1);
});

test("Engine DB resolver keeps explicit and legacy environment precedence", () => {
  const keys = ["ENGINE_DB_PATH", "MEMORY_ENGINE_DB_PATH", "MEMORY_ENGINE_DB"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    process.env.ENGINE_DB_PATH = "/tmp/engine.sqlite";
    process.env.MEMORY_ENGINE_DB_PATH = "/tmp/path.sqlite";
    process.env.MEMORY_ENGINE_DB = "/tmp/legacy.sqlite";

    assert.equal(resolveEngineDbPath({ engineDbPath: "/tmp/explicit.sqlite" }), "/tmp/explicit.sqlite");
    assert.equal(resolveEngineDbPath(), "/tmp/engine.sqlite");

    delete process.env.ENGINE_DB_PATH;
    assert.equal(resolveEngineDbPath(), "/tmp/path.sqlite");

    delete process.env.MEMORY_ENGINE_DB_PATH;
    assert.equal(resolveEngineDbPath(), "/tmp/legacy.sqlite");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("CLI adapter no longer contains DB orchestration or business implementation", () => {
  const source = readFileSync(cliPath, "utf8");
  for (const pattern of [
    /better-sqlite3/i,
    /memory_confidence/i,
    /ATTACH DATABASE/i,
    /main\.sqlite/i,
    /withBothDbs/i,
    /\bchunks\b/i,
    /\bhybrid\b/i,
    /embedding/i,
    /\bRRF\b/i,
    /\bFTS\b/i,
    /\bKG search\b/i,
  ]) {
    assert.doesNotMatch(source, pattern, `CLI must not contain ${pattern}`);
  }
  assert.match(source, /lib\/services\/memory-engine-cli-service\.js/);
  assert.match(source, /process\.argv/);
  assert.match(source, /JSON\.stringify/);
  assert.match(source, /process\.exitCode/);
});
