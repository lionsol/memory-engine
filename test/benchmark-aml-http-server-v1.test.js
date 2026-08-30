import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import lancedb from "@lancedb/lancedb";
import Database from "better-sqlite3";

import { createAmlAdapter } from "../lib/benchmark/aml-adapter-v1.js";
import { createAmlHttpServer } from "../lib/benchmark/aml-http-server-v1.js";

const FIXED_NOW_SEC = 1_700_000_000;

function temporaryRoot(prefix = "memory-engine-aml-http-test-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function vectorFor(input) {
  const vector = new Array(2560).fill(0);
  vector[0] = createHash("sha256").update(String(input)).digest()[0] / 255;
  vector[1] = 1;
  return vector;
}

function fakeAdapter({ add = null, search = null, close = null } = {}) {
  return {
    add: add || (async request => ({
      success: true,
      request_id: request.request_id,
      user_id: request.user_id,
      session_id: request.session_id,
    })),
    search: search || (async () => ({
      data: [
        { id: "memory-1", content: "first", score: 0.9 },
        { id: "memory-2", content: "second", score: 0.8 },
      ],
    })),
    close: close || (async () => {}),
  };
}

function addBody(overrides = {}) {
  return {
    request_id: "request-1",
    user_id: "user-1",
    session_id: "session-1",
    messages: [{ role: "user", content: "transport memory" }],
    ...overrides,
  };
}

function searchBody(overrides = {}) {
  return {
    user_id: "user-1",
    query: "transport memory",
    top_k: 5,
    ...overrides,
  };
}

async function httpJson(server, {
  method = "GET",
  path = "/health",
  body = undefined,
  headers = {},
} = {}) {
  const address = server.address();
  const payload = body === undefined ? "" : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: "127.0.0.1",
      port: address.port,
      path,
      method,
      headers: {
        ...(body === undefined ? {} : {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        }),
        ...headers,
      },
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let parsed = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {}
        resolve({ status: response.statusCode, headers: response.headers, body: parsed, raw });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function startServer(adapter, options = {}) {
  const server = createAmlHttpServer({
    adapter,
    host: "127.0.0.1",
    port: 0,
    authMode: "none",
    ...options,
  });
  await server.start();
  return server;
}

async function assertInvalidSearchItem(item, forbiddenText = null) {
  const server = await startServer(fakeAdapter({
    search: async () => ({ data: [item] }),
  }));
  try {
    const result = await httpJson(server, {
      method: "POST",
      path: "/search",
      body: searchBody(),
    });
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { detail: { reason: "adapter_search_response_invalid" } });
    if (forbiddenText) assert.equal(result.raw.includes(forbiddenText), false);
  } finally {
    await server.close();
  }
}

test("health is unauthenticated and exposes only the minimal status body", async () => {
  const adapter = fakeAdapter();
  const server = await startServer(adapter, { authMode: "auto", memorySystemKey: "secret-key" });
  try {
    const result = await httpJson(server, { path: "/health" });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { status: "ok" });
    assert.equal(result.raw, '{"status":"ok"}');
  } finally {
    await server.close();
  }
});
test("auto authentication accepts Bearer, Token, and X-Api-Key without logging credentials", async () => {
  const adapter = fakeAdapter();
  const logged = [];
  const server = await startServer(adapter, {
    authMode: "auto",
    memorySystemKey: "secret-key",
    logger: (...args) => logged.push(args),
  });
  try {
    for (const headers of [
      { Authorization: "Bearer secret-key" },
      { Authorization: "Token secret-key" },
      { "X-Api-Key": "secret-key" },
    ]) {
      const result = await httpJson(server, {
        method: "POST",
        path: "/search",
        body: searchBody(),
        headers,
      });
      assert.equal(result.status, 200);
      assert.deepEqual(Object.keys(result.body), ["data"]);
    }
    assert.equal(JSON.stringify(logged).includes("secret-key"), false);
  } finally {
    await server.close();
  }
});

test("explicit authentication schemes reject other schemes and missing keys", async () => {
  for (const [mode, good, bad] of [
    ["bearer", { Authorization: "Bearer secret-key" }, { Authorization: "Token secret-key" }],
    ["token", { Authorization: "Token secret-key" }, { Authorization: "Bearer secret-key" }],
    ["x-api-key", { "X-Api-Key": "secret-key" }, { Authorization: "Bearer secret-key" }],
  ]) {
    const server = await startServer(fakeAdapter(), { authMode: mode, memorySystemKey: "secret-key" });
    try {
      assert.equal((await httpJson(server, {
        method: "POST", path: "/search", body: searchBody(), headers: good,
      })).status, 200);
      const badResult = await httpJson(server, {
        method: "POST", path: "/search", body: searchBody(), headers: bad,
      });
      assert.equal(badResult.status, 401);
      assert.deepEqual(badResult.body, { detail: { reason: "authentication_required" } });
      assert.equal((await httpJson(server, {
        method: "POST", path: "/search", body: searchBody(),
      })).status, 401);
    } finally {
      await server.close();
    }
  }
});

test("valid Add and Search use exact AML response envelopes and preserve result order", async () => {
  const calls = [];
  const adapter = fakeAdapter({
    add: async request => {
      calls.push(["add", request]);
      return {
        success: true,
        request_id: request.request_id,
        user_id: request.user_id,
        session_id: request.session_id,
      };
    },
    search: async request => {
      calls.push(["search", request]);
      return { data: [
        { id: "z", content: "z-content", score: 0.3 },
        { id: "a", content: "a-content", score: 0.2 },
      ] };
    },
  });
  const server = await startServer(adapter);
  try {
    const addResult = await httpJson(server, { method: "POST", path: "/add", body: addBody() });
    assert.equal(addResult.status, 200);
    assert.deepEqual(addResult.body, {
      success: true,
      request_id: "request-1",
      user_id: "user-1",
      session_id: "session-1",
    });
    const searchResult = await httpJson(server, { method: "POST", path: "/search", body: searchBody() });
    assert.equal(searchResult.status, 200);
    assert.deepEqual(searchResult.body, {
      data: [
        { id: "z", content: "z-content", score: 0.3 },
        { id: "a", content: "a-content", score: 0.2 },
      ],
    });
    assert.deepEqual(calls.map(([kind]) => kind), ["add", "search"]);
  } finally {
    await server.close();
  }
});

test("stable route, JSON, schema, conflict, and size errors do not expose raw details", async () => {
  const adapter = fakeAdapter({
    add: async request => {
      if (request.request_id === "conflict") throw new Error("aml_request_id_payload_conflict");
      throw new Error("aml_add_request_unknown_field:gold_answer");
    },
  });
  const server = await startServer(adapter);
  try {
    const malformed = await httpJson(server, { method: "POST", path: "/add" });
    assert.equal(malformed.status, 400);
    assert.deepEqual(malformed.body, { detail: { reason: "malformed_json" } });

    const schema = await httpJson(server, { method: "POST", path: "/add", body: { gold_answer: "secret" } });
    assert.equal(schema.status, 422);
    assert.deepEqual(schema.body, { detail: { reason: "adapter_schema_validation" } });
    assert.equal(JSON.stringify(schema.body).includes("gold_answer"), false);

    const conflict = await httpJson(server, {
      method: "POST", path: "/add", body: addBody({ request_id: "conflict" }),
    });
    assert.equal(conflict.status, 422);
    assert.deepEqual(conflict.body, { detail: { reason: "aml_request_id_payload_conflict" } });

    assert.equal((await httpJson(server, { path: "/missing" })).status, 404);
    assert.equal((await httpJson(server, { method: "GET", path: "/add" })).status, 405);

    const oversized = await httpJson(server, {
      method: "POST",
      path: "/add",
      body: { value: "x".repeat(2 * 1024 * 1024 + 1) },
    });
    assert.equal(oversized.status, 413);
    assert.deepEqual(oversized.body, { detail: { reason: "request_body_too_large" } });
  } finally {
    await server.close();
  }
});

test("backend failures map to 503 and unexpected failures map to sanitized 500", async () => {
  const server = await startServer(fakeAdapter({
    search: async () => { throw new Error("aml_semantic_vector_search: authorization: Bearer top-secret"); },
  }));
  try {
    const backend = await httpJson(server, { method: "POST", path: "/search", body: searchBody() });
    assert.equal(backend.status, 503);
    assert.deepEqual(backend.body, { detail: { reason: "backend_unavailable" } });
    assert.equal(JSON.stringify(backend.body).includes("top-secret"), false);
  } finally {
    await server.close();
  }

  const errors = [];
  const unexpectedServer = await startServer(fakeAdapter({
    search: async () => { throw new Error("unexpected secret=do-not-leak"); },
  }), { logger: (...args) => errors.push(args) });
  try {
    const unexpected = await httpJson(unexpectedServer, { method: "POST", path: "/search", body: searchBody() });
    assert.equal(unexpected.status, 500);
    assert.deepEqual(unexpected.body, { detail: { reason: "internal_error" } });
    assert.equal(JSON.stringify(unexpected.body).includes("do-not-leak"), false);
    assert.equal(JSON.stringify(errors).includes("do-not-leak"), false);
  } finally {
    await unexpectedServer.close();
  }
});

test("malformed adapter outputs fail closed before HTTP 200", async () => {
  const addServer = await startServer(fakeAdapter({
    add: async request => ({ success: true, request_id: request.request_id }),
  }));
  try {
    const result = await httpJson(addServer, { method: "POST", path: "/add", body: addBody() });
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { detail: { reason: "adapter_add_response_invalid" } });
  } finally {
    await addServer.close();
  }

  const searchServer = await startServer(fakeAdapter({
    search: async () => ({ data: [{ id: "", content: "invalid" }] }),
  }));
  try {
    const result = await httpJson(searchServer, { method: "POST", path: "/search", body: searchBody() });
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { detail: { reason: "adapter_search_response_invalid" } });
  } finally {
    await searchServer.close();
  }
});

test("Search rejects unknown item keys instead of disclosing adapter internals", async () => {
  await assertInvalidSearchItem(
    { id: "m1", content: "memory", diagnostics: { secret: "do-not-leak" } },
    "do-not-leak",
  );
  await assertInvalidSearchItem(
    { id: "m1", content: "memory", provenance: { provider: "internal" } },
    "internal",
  );
  await assertInvalidSearchItem({ id: "m1", content: "memory", extra: "unknown" }, "unknown");
});

test("Search accepts the exact legal item shapes and finite created_at values", async () => {
  const data = [
    { id: "bare", content: "bare memory" },
    { id: "scored", content: "scored memory", score: 0.5 },
    { id: "text-time", content: "text time", created_at: "2026-08-30T00:00:00Z" },
    { id: "numeric-time", content: "numeric time", created_at: 1_700_000_000 },
    { id: "null-time", content: "null time", created_at: null },
  ];
  const server = await startServer(fakeAdapter({ search: async () => ({ data }) }));
  try {
    const result = await httpJson(server, {
      method: "POST",
      path: "/search",
      body: searchBody({ top_k: data.length }),
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { data });
  } finally {
    await server.close();
  }
});

test("Search rejects non-finite score and created_at numbers", async () => {
  for (const field of ["score", "created_at"]) {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      await assertInvalidSearchItem({ id: "m1", content: "memory", [field]: value });
    }
  }
});

test("close stops accepting work and waits for an in-flight Add before closing the adapter", async () => {
  let startedResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  let releaseResolve;
  const release = new Promise(resolve => { releaseResolve = resolve; });
  let adapterClosed = false;
  const adapter = fakeAdapter({
    add: async request => {
      startedResolve();
      await release;
      return {
        success: true,
        request_id: request.request_id,
        user_id: request.user_id,
        session_id: request.session_id,
      };
    },
    close: async () => { adapterClosed = true; },
  });
  const server = await startServer(adapter);
  const requestPromise = httpJson(server, { method: "POST", path: "/add", body: addBody() });
  await started;
  const closePromise = server.close();
  await Promise.resolve();
  assert.equal(adapterClosed, false);
  releaseResolve();
  const result = await requestPromise;
  await closePromise;
  assert.equal(result.status, 200);
  assert.equal(adapterClosed, true);
  await server.close();
});

test("actual HTTP → AML adapter → temporary LanceDB survives restart and preserves idempotency/isolation", async () => {
  const root = temporaryRoot("memory-engine-aml-http-e2e-");
  const calls = [];
  const embeddingProvider = async input => {
    calls.push(String(input));
    return vectorFor(input);
  };
  let firstAdapter;
  let secondAdapter;
  let firstServer;
  let secondServer;
  try {
    firstAdapter = createAmlAdapter({
      retainedRoot: root,
      embeddingProvider,
      nowSecProvider: () => FIXED_NOW_SEC,
    });
    firstServer = await startServer(firstAdapter);
    const addResult = await httpJson(firstServer, {
      method: "POST", path: "/add", body: addBody({ request_id: "e2e-request" }),
    });
    assert.equal(addResult.status, 200);
    const retryResult = await httpJson(firstServer, {
      method: "POST", path: "/add", body: addBody({ request_id: "e2e-request" }),
    });
    assert.equal(retryResult.status, 200);
    const searchResult = await httpJson(firstServer, {
      method: "POST", path: "/search", body: searchBody({ query: "transport memory" }),
    });
    assert.equal(searchResult.status, 200);
    assert.equal(searchResult.body.data.length > 0, true);
    assert.match(searchResult.body.data[0].content, /transport memory/);
    assert.deepEqual(Object.keys(searchResult.body), ["data"]);

    const firstPlane = firstAdapter.registry.get("user-1");
    const internal = await firstPlane.search(searchBody());
    assert.equal(internal.diagnostics.vector_backend, "lancedb");
    assert.equal(internal.diagnostics.vector_stage, "lancedb_search");
    assert.equal(internal.diagnostics.channels.includes("vector"), true);
    const firstCorePath = firstPlane.corePath;
    const firstEnginePath = firstPlane.enginePath;
    const firstVectorPath = firstPlane.vectorPath;
    const firstCachePath = firstPlane.vector_provenance ? join(firstPlane.root, "embedding-cache.sqlite") : null;
    await firstServer.close();
    assert.equal(existsSync(root), true);

    secondAdapter = createAmlAdapter({
      retainedRoot: root,
      embeddingProvider,
      nowSecProvider: () => FIXED_NOW_SEC,
    });
    secondServer = await startServer(secondAdapter);
    const restartSearch = await httpJson(secondServer, {
      method: "POST", path: "/search", body: searchBody(),
    });
    assert.equal(restartSearch.status, 200);
    assert.equal(restartSearch.body.data.length > 0, true);
    assert.equal(secondAdapter.registry.size, 1);
    const childrenBeforeUnknown = readdirSync(root).filter(name => name.startsWith("user-")).sort();
    const unknown = await httpJson(secondServer, {
      method: "POST", path: "/search", body: searchBody({ user_id: "unknown-user" }),
    });
    assert.deepEqual(unknown.body, { data: [] });
    assert.equal(secondAdapter.registry.size, 1);
    assert.deepEqual(readdirSync(root).filter(name => name.startsWith("user-")).sort(), childrenBeforeUnknown);

    const secondPlane = secondAdapter.registry.get("user-1");
    assert.equal(secondPlane.corePath, firstCorePath);
    assert.equal(secondPlane.enginePath, firstEnginePath);
    assert.equal(secondPlane.vectorPath, firstVectorPath);
    assert.equal(secondPlane.vector_provenance.vector_store, "lancedb");

    const core = new Database(firstCorePath, { readonly: true, fileMustExist: true });
    const engine = new Database(firstEnginePath, { readonly: true, fileMustExist: true });
    try {
      assert.equal(core.prepare("SELECT COUNT(*) AS count FROM chunks").get().count, 1);
      assert.equal(engine.prepare("SELECT COUNT(*) AS count FROM aml_add_requests").get().count, 1);
    } finally {
      core.close();
      engine.close();
    }
    const lance = await lancedb.connect(firstVectorPath);
    const table = await lance.openTable("chunks");
    assert.equal(await table.countRows(), 1);
    await table.close();
    await lance.close();
    assert.equal(calls.length, 2, "one corpus and one query provider call; retries/restart search use cache/row reuse");
    assert.equal(existsSync(firstCachePath), true);
  } finally {
    await firstServer?.close();
    await secondServer?.close();
    if (secondAdapter?.registry) await secondAdapter.registry.destroy();
    else if (firstAdapter?.registry) await firstAdapter.registry.destroy();
    rmSync(root, { recursive: true, force: true });
  }
});
