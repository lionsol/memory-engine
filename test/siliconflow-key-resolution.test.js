import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { hybridSearch } from "../lib/recall/hybrid-search.js";
import { generateEmbedding, resolveSFKey } from "../lib/siliconflow-runtime.js";

function makeDbForVector() {
  return {
    prepare(sql) {
      const q = String(sql);
      return {
        all() {
          if (q.includes("SELECT chunk_id") && q.includes("FROM memory_confidence")) {
            return [{
              chunk_id: "chunk-1234567890abcdef",
              confidence: 0.82,
              last_confidence_update: 0,
              base_tau: 7,
              hit_count: 3,
              is_protected: 0,
              conflict_flag: 0,
              category: "raw_log",
              is_archived: 0,
            }];
          }
          return [];
        },
      };
    },
  };
}

function makeRequestImpl({ statusCode = 200, body = null, onRequest } = {}) {
  const responseBody = body ?? JSON.stringify({ data: [{ embedding: [0.11, 0.22, 0.33] }] });
  return (url, options, onResponse) => {
    if (typeof onRequest === "function") onRequest(url, options);
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = statusCode;
      onResponse(res);
      process.nextTick(() => {
        res.emit("data", responseBody);
        res.emit("end");
      });
    };
    return req;
  };
}

test("resolveSFKey returns key from cfg first", () => {
  const cfg = {
    models: {
      providers: {
        siliconflow: {
          apiKey: "cfg-key-123",
        },
      },
    },
  };
  const key = resolveSFKey({ cfg, env: {} });
  assert.equal(key, "cfg-key-123");
});

test("generateEmbedding works with cfg key without reading ~/.openclaw/openclaw.json", async () => {
  const cfg = {
    models: {
      providers: {
        siliconflow: {
          apiKey: "cfg-key-456",
        },
      },
    },
  };
  let readFileCalled = false;
  let authHeader = "";
  const embedding = await generateEmbedding("hello world", {
    cfg,
    env: {},
    readFile: () => {
      readFileCalled = true;
      throw new Error("should not read config file");
    },
    requestImpl: makeRequestImpl({
      onRequest: (_url, options) => {
        authHeader = String(options?.headers?.Authorization || "");
      },
    }),
  });

  assert.deepEqual(embedding, [0.11, 0.22, 0.33]);
  assert.equal(readFileCalled, false);
  assert.equal(authHeader, "Bearer cfg-key-456");
});

test("resolveSFKey falls back to env and openclaw.json file", () => {
  const envKey = resolveSFKey({
    cfg: null,
    env: {
      SILICONFLOW_API_KEY: "env-key-1",
    },
    readFile: () => {
      throw new Error("env hit should avoid file read");
    },
  });
  assert.equal(envKey, "env-key-1");

  const fileKey = resolveSFKey({
    cfg: null,
    env: {},
    homeDir: "/tmp/fake-home",
    readFile: () => JSON.stringify({
      models: {
        providers: {
          siliconflow: {
            apiKey: "file-key-2",
          },
        },
      },
    }),
  });
  assert.equal(fileKey, "file-key-2");
});

test("hybridSearch exposes missing SiliconFlow key without sensitive leakage in vector_error", async () => {
  const result = await hybridSearch("query", { topK: 3 }, {
    cfg: { memory: { backend: "sqlite" } },
    withDb: fn => fn(makeDbForVector()),
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    getLancedbTable: () => ({
      search: () => ({
        limit: () => ({
          execute: async () => [],
        }),
      }),
    }),
    generateEmbedding: text => generateEmbedding(text, {
      cfg: null,
      env: {},
      readFile: () => {
        throw new Error("config missing");
      },
      requestImpl: makeRequestImpl(),
    }),
    getMemorySearchManager: async () => ({
      manager: {
        search: async () => ({ entries: [{ id: "chunk-1234567890abcdef", text: "fallback vector text", similarity: 0.91 }] }),
      },
    }),
  });

  assert.equal(result?.debug?.vector_stage, "embedding");
  assert.equal(result?.debug?.vector_error, "SiliconFlow API key not found");
  assert.equal(String(result?.debug?.vector_error || "").includes("cfg-key"), false);
  assert.equal(String(result?.debug?.vector_error || "").includes("sk-"), false);
});
