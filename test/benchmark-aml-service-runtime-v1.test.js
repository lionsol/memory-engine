import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AML_DEFAULT_RETAINED_ROOT,
  AML_EMBEDDING_API_PATH,
  createAmlServiceRuntime,
  createSiliconFlowEmbeddingProvider,
  parseAmlServiceConfig,
} from "../lib/benchmark/aml-service-runtime-v1.js";

function root(prefix = "memory-engine-aml-service-test-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function envFor(retainedRoot, overrides = {}) {
  return {
    AML_HOST: "127.0.0.1",
    AML_PORT: "18080",
    AML_AUTH_MODE: "none",
    AML_RETAINED_ROOT: retainedRoot,
    ...overrides,
  };
}

test("service config freezes safe defaults and rejects invalid port/auth/retained roots", () => {
  const retainedRoot = root();
  try {
    const config = parseAmlServiceConfig({ env: envFor(retainedRoot), semanticEnabled: false });
    assert.equal(config.host, "127.0.0.1");
    assert.equal(config.port, 18080);
    assert.equal(config.maxTopK, 100);
    assert.equal(config.retainedRoot, retainedRoot);
    assert.equal(AML_DEFAULT_RETAINED_ROOT, "/tmp/memory-engine-aml-data");
    for (const port of ["0", "65536", "1.5", "1e3", "NaN", "-1"]) {
      assert.throws(
        () => parseAmlServiceConfig({ env: envFor(retainedRoot, { AML_PORT: port }), semanticEnabled: false }),
        /aml_service_port_invalid/,
      );
    }
    assert.throws(
      () => parseAmlServiceConfig({
        env: envFor(retainedRoot, { AML_AUTH_MODE: "basic" }),
        semanticEnabled: false,
      }),
      /aml_service_auth_mode_invalid/,
    );
    assert.throws(
      () => parseAmlServiceConfig({
        env: { ...envFor(retainedRoot), AML_RETAINED_ROOT: "/var/tmp/not-allowed" },
        semanticEnabled: false,
      }),
      /aml_service_retained_root_invalid/,
    );
  } finally {
    rmSync(retainedRoot, { recursive: true, force: true });
  }
});

test("auto authentication and semantic runtime require their env-only credentials", () => {
  const retainedRoot = root();
  try {
    assert.throws(
      () => parseAmlServiceConfig({
        env: envFor(retainedRoot, { AML_AUTH_MODE: "auto" }),
        semanticEnabled: false,
      }),
      /aml_service_auth_key_required/,
    );
    assert.throws(
      () => parseAmlServiceConfig({
        env: envFor(retainedRoot, { AML_MEMORY_SYSTEM_KEY: "memory-key" }),
        semanticEnabled: true,
      }),
      /aml_service_embedding_key_required/,
    );
    const noSemantic = parseAmlServiceConfig({
      env: envFor(retainedRoot),
      semanticEnabled: false,
    });
    assert.equal(noSemantic.semanticEnabled, false);
  } finally {
    rmSync(retainedRoot, { recursive: true, force: true });
  }
});

test("SiliconFlow provider wrapper uses injected requests, frozen path, and no credential provenance", async () => {
  const requests = [];
  const provider = createSiliconFlowEmbeddingProvider({
    apiKey: "secret-provider-key",
    baseUrl: "https://user:password@example.test/base?token=hidden#fragment",
    requestImpl: async request => {
      requests.push(request);
      return {
        statusCode: 200,
        body: JSON.stringify({ data: [{ embedding: new Array(2560).fill(0.25) }] }),
      };
    },
  });
  const vector = await provider.embed("exact embedding input");
  assert.equal(vector.length, 2560);
  assert.equal(provider.api_path, AML_EMBEDDING_API_PATH);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.pathname, "/v1/embeddings");
  assert.equal(requests[0].url.username, "");
  assert.equal(requests[0].url.password, "");
  assert.equal(requests[0].url.search, "");
  assert.equal(requests[0].url.hash, "");
  const body = JSON.parse(requests[0].body);
  assert.deepEqual(body, { model: "Qwen/Qwen3-Embedding-4B", input: "exact embedding input" });
  assert.equal(JSON.stringify(provider).includes("secret-provider-key"), false);
});

test("provider HTTP, malformed response, and request failures fail closed without raw secrets", async () => {
  const cases = [
    {
      name: "http error",
      response: { statusCode: 401, body: "authorization: Bearer secret-provider-key" },
      error: /aml_embedding_provider_request_failed/,
    },
    {
      name: "malformed body",
      response: { statusCode: 200, body: "not-json" },
      error: /aml_embedding_provider_response_invalid/,
    },
    {
      name: "missing embedding",
      response: { statusCode: 200, body: JSON.stringify({ data: [{}] }) },
      error: /aml_embedding_provider_response_invalid/,
    },
  ];
  for (const item of cases) {
    const provider = createSiliconFlowEmbeddingProvider({
      apiKey: "secret-provider-key",
      requestImpl: async () => item.response,
    });
    await assert.rejects(() => provider.embed("input"), item.error, item.name);
  }
  const requestFailure = createSiliconFlowEmbeddingProvider({
    apiKey: "secret-provider-key",
    requestImpl: async () => { throw new Error("authorization: Bearer secret-provider-key"); },
  });
  await assert.rejects(
    () => requestFailure.embed("input"),
    error => error.message === "aml_embedding_provider_request_failed" &&
      !error.message.includes("secret-provider-key"),
  );
});

test("service runtime passes parsed env authority to injected factories and closes through the server", async () => {
  const retainedRoot = root();
  const fakeAdapter = {
    async add() {},
    async search() { return { data: [] }; },
    async close() {},
  };
  let serverOptions;
  let started = false;
  let closed = false;
  try {
    const runtime = createAmlServiceRuntime({
      env: envFor(retainedRoot),
      semanticEnabled: false,
      adapter: fakeAdapter,
      serverFactory: options => {
        serverOptions = options;
        return {
          async start() { started = true; },
          async close() { closed = true; },
        };
      },
    });
    assert.equal(runtime.config.maxTopK, 100);
    assert.equal(serverOptions.host, "127.0.0.1");
    assert.equal(serverOptions.port, 18080);
    assert.equal(serverOptions.authMode, "none");
    assert.equal(serverOptions.adapter, fakeAdapter);
    await runtime.start();
    await runtime.close();
    assert.equal(started, true);
    assert.equal(closed, true);
  } finally {
    rmSync(retainedRoot, { recursive: true, force: true });
  }
});

test("injected semantic provider is a test seam and does not require a real key or network", async () => {
  const retainedRoot = root();
  let requests = 0;
  const fakeProvider = async () => {
    requests += 1;
    return new Array(2560).fill(0);
  };
  const fakeAdapter = {
    async add() {},
    async search() { return { data: [] }; },
    async close() {},
  };
  try {
    const runtime = createAmlServiceRuntime({
      env: envFor(retainedRoot),
      semanticEnabled: true,
      embeddingProvider: fakeProvider,
      adapter: fakeAdapter,
      serverFactory: () => ({ start: async () => {}, close: async () => {} }),
    });
    assert.equal(runtime.config.semanticEnabled, true);
    assert.equal(runtime.provider, fakeProvider);
    assert.equal(requests, 0);
    await runtime.close();
  } finally {
    rmSync(retainedRoot, { recursive: true, force: true });
  }
});
