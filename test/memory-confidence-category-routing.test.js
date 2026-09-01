import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  autoRouteCategory,
  catParams,
} from "../lib/memory-confidence.js";
import { createMemoryEngineExecute } from "../lib/tools/memory-engine-actions.js";

test("automatic routing keeps technical artifacts out of preference", () => {
  const artifactCases = [
    "api_key=sk-example",
    "API-KEY: abc",
    "apikey: example-token",
    "access_token=example-token",
    "auth_token=example-token",
    "secret_key=example-token",
    "password=example-token",
    "passwd=example-token",
    "Bearer example-token",
    "voice_id=abc123",
    "/home/test/config.json",
    "./config/foo.yaml",
    "../foo/bar.json",
    "C:\\Users\\test\\config.json",
    "path=/home/test/config.json 已确定了",
    "0123456789abcdef0123456789abcdef",
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "model=qwen",
    "model: qwen",
    "API key 已确定了：example-token",
  ];

  for (const text of artifactCases) {
    assert.equal(autoRouteCategory(text), "raw_log", text);
  }
});

test("explicit preference language remains authoritative over artifact guards", () => {
  const preferenceCases = [
    "我喜欢深色模式",
    "我偏好使用 Qwen",
    "我习惯把项目放在 D 盘",
    "我一般使用英文界面",
    "以后都用这个模型",
    "我偏好把代码仓库放在 /data/projects",
    "我习惯使用 /opt/tools/foo",
    "我偏好模型 Qwen",
    "以后都使用 Qwen",
  ];

  for (const text of preferenceCases) {
    assert.equal(autoRouteCategory(text), "preference", text);
  }

  assert.equal(autoRouteCategory("记住这个设置"), "preference");
  assert.equal(autoRouteCategory("最终选择中文"), "preference");
});

test("explicit category remains authoritative before automatic routing", () => {
  assert.equal(
    autoRouteCategory("api_key=sk-example", { category: "preference" }),
    "preference",
  );
  assert.equal(
    autoRouteCategory("我喜欢深色模式", { category: "episodic" }),
    "episodic",
  );
  assert.equal(
    autoRouteCategory("我喜欢深色模式", { category: "raw_log" }),
    "raw_log",
  );
});

test("existing identity and temporary routing remains stable", () => {
  assert.equal(autoRouteCategory("我是律师"), "user_identity");
  assert.equal(autoRouteCategory("这只是临时测试"), "temporary");
  assert.equal(autoRouteCategory("普通运行日志"), "raw_log");
});

function createAddHarness() {
  let nextChunk = 0;
  let coreRows = [];
  const appended = [];
  const engineWrites = [];

  const execute = createMemoryEngineExecute({
    api: { config: {} },
    autoRouteCategory,
    dateStrInTimeZone: () => "2026-09-01",
    SMART_ADD_TIME_ZONE: "Asia/Shanghai",
    resolve: path.posix.resolve,
    WORKSPACE: "/tmp/ws",
    SMART_ADD_DIR: "memory/smart-add",
    buildSmartAddFingerprint: () => "fingerprint",
    appendSmartAdd: async options => {
      appended.push(options);
      nextChunk += 1;
      coreRows = [{ id: `chunk-${nextChunk}` }];
      return { appended: true, sync: { synced: true } };
    },
    syncIndexIfNeeded: async () => ({ synced: true }),
    catParams,
    withCoreDb: fn => fn({
      prepare(sql) {
        assert.equal(String(sql), "SELECT id FROM chunks WHERE path = ? ORDER BY id ASC");
        return { all: () => coreRows };
      },
    }),
    withEngineDb: fn => fn({
      prepare(sql) {
        const query = String(sql);
        if (query.includes("SELECT 1 FROM memory_confidence WHERE chunk_id = ?")) {
          return { get: () => undefined };
        }
        if (query.includes("INSERT INTO memory_confidence")) {
          return {
            run(...values) {
              engineWrites.push(values);
              return { changes: 1 };
            },
          };
        }
        throw new Error(`unexpected Engine SQL: ${query}`);
      },
      transaction(fn) {
        return () => fn();
      },
    }),
    getLancedbTable: () => null,
    generateEmbedding: async () => [],
    recordMemoryEvent: () => {},
    getMemorySearchManager: async () => ({ manager: null }),
    calcRealtimeConf: () => 0,
    existsSync: () => false,
    readFileSync: () => "",
    KG_PATH: "/tmp/ws/knowledge-graph.json",
    resolvePrefixes: () => [],
    batchReinforce: () => 0,
    CATEGORY_MAP: {},
    calcTau: () => 0,
  });

  return { execute, appended, engineWrites };
}

test("memory_engine add observes production automatic routing", async () => {
  const harness = createAddHarness();

  const artifactResult = await harness.execute("add-artifact", {
    action: "add",
    text: "api_key=sk-example",
  });
  const preferenceResult = await harness.execute("add-preference", {
    action: "add",
    text: "我偏好把代码仓库放在 /data/projects",
  });

  assert.equal(artifactResult.category, "raw_log");
  assert.equal(preferenceResult.category, "preference");
  assert.deepEqual(harness.appended.map(options => options.category), ["raw_log", "preference"]);
  assert.deepEqual(harness.engineWrites.map(values => values.at(-1)), ["raw_log", "preference"]);
});
