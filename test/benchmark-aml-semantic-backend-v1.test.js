import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import lancedb from "@lancedb/lancedb";
import Database from "better-sqlite3";

import { createAmlAdapter } from "../lib/benchmark/aml-adapter-v1.js";
import { createAmlUserDataPlane } from "../lib/benchmark/aml-data-plane-v1.js";
import {
  AML_SEMANTIC_BACKEND_SCHEMA,
  AML_SEMANTIC_VECTOR_MODE,
  createAmlSemanticBackend,
} from "../lib/benchmark/aml-semantic-backend-v1.js";
import {
  CANONICAL_VECTOR_PROJECTION_VERSION,
  CANONICAL_VECTOR_TEXT_MAX_CHARS,
  projectCanonicalMemoryToVectorProjection,
} from "../lib/canonical/vector-projection.js";

const FIXED_NOW_SEC = 1_700_000_000;

function vectorWith(value = 0) {
  const vector = new Array(2560).fill(0);
  vector[0] = value;
  return vector;
}

function canonicalMemory(memoryId, text) {
  return {
    memory_id: memoryId,
    canonical_id: memoryId,
    source: { text },
    content_ref: {
      content_hash: createHash("sha256").update(text).digest("hex"),
    },
  };
}

function validProvider(calls = [], valueFor = () => 1) {
  return async input => {
    calls.push(String(input));
    return vectorWith(valueFor(String(input)));
  };
}

function temporaryRoot(prefix = "memory-engine-aml-semantic-test-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function fakeResources({ provider, cacheGet = () => null, tableAdd = async () => {}, tableSearch = null } = {}) {
  const counts = {
    cacheOpen: 0,
    cacheClose: 0,
    tableClose: 0,
    connectionClose: 0,
  };
  const table = {
    query() {
      return {
        where() {
          return {
            limit() {
              return { toArray: async () => [] };
            },
          };
        },
      };
    },
    async add(rows) {
      await tableAdd(rows);
    },
    async delete() {},
    search(...args) {
      if (tableSearch) return tableSearch(...args);
      return { limit: () => ({ execute: async () => [] }) };
    },
    close() {
      counts.tableClose += 1;
    },
  };
  const connection = {
    async tableNames() {
      return ["chunks"];
    },
    async openTable() {
      return table;
    },
    close() {
      counts.connectionClose += 1;
    },
  };
  return {
    counts,
    embeddingCacheFactory() {
      counts.cacheOpen += 1;
      return {
        get: cacheGet,
        set() {},
        close() {
          counts.cacheClose += 1;
        },
      };
    },
    lancedbConnect: async () => connection,
    provider: provider || validProvider(),
  };
}

async function addCanonical(backend, memoryId = "memory-a", text = "semantic memory") {
  const memory = canonicalMemory(memoryId, text);
  const projection = projectCanonicalMemoryToVectorProjection(memory);
  return backend.addCanonicalMemory({
    canonicalMemory: memory,
    projection,
    timestamp: FIXED_NOW_SEC,
  });
}

test("AML semantic backend freezes provenance and requires an injected provider", () => {
  const root = temporaryRoot();
  try {
    assert.throws(
      () => createAmlSemanticBackend({ root }),
      /aml_semantic_embedding_provider_required/,
    );
    const backend = createAmlSemanticBackend({
      root,
      embeddingProvider: validProvider(),
      embeddingBaseUrl: "https://user:secret@example.test/v1?token=hidden#fragment",
    });
    assert.equal(backend.schema, AML_SEMANTIC_BACKEND_SCHEMA);
    assert.equal(backend.vector_mode, AML_SEMANTIC_VECTOR_MODE);
    assert.deepEqual(backend.provenance, {
      semantic_backend_version: AML_SEMANTIC_BACKEND_SCHEMA,
      embedding_provider: "SiliconFlow",
      embedding_base_url_identity: "https://example.test/v1",
      embedding_model: "Qwen/Qwen3-Embedding-4B",
      embedding_model_revision: "unavailable/unpinned",
      embedding_dimension: 2560,
      canonical_vector_projection_version: CANONICAL_VECTOR_PROJECTION_VERSION,
      canonical_vector_text_max_chars: CANONICAL_VECTOR_TEXT_MAX_CHARS,
      embedding_cache_schema: "memory_engine_benchmark_embedding_cache_v1",
      vector_store: "lancedb",
      vector_mode: AML_SEMANTIC_VECTOR_MODE,
    });
    assert.equal(JSON.stringify(backend.provenance).includes("secret"), false);
    assert.equal(JSON.stringify(backend.provenance).includes("token"), false);
    return backend.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("actual temporary LanceDB materializes one exact canonical row and reuses it", async () => {
  const root = temporaryRoot();
  const calls = [];
  const backend = createAmlSemanticBackend({
    root,
    embeddingProvider: validProvider(calls),
  });
  try {
    const first = await addCanonical(backend, "memory-idempotent", "semantic memory only");
    const second = await addCanonical(backend, "memory-idempotent", "semantic memory only");
    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(calls.length, 1);

    const connection = await lancedb.connect(join(root, "lancedb"));
    const table = await connection.openTable("chunks");
    assert.equal(await table.countRows(), 1);
    const rows = await table.query().where("id = 'memory-idempotent'").limit(2).toArray();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].text, "semantic memory only");
    assert.equal(rows[0].vector.length, 2560);
    await table.close();
    await connection.close();
  } finally {
    await backend.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("production hybridSearch uses real temporary LanceDB and the public adapter hides diagnostics", async () => {
  const calls = [];
  const adapter = createAmlAdapter({
    nowSecProvider: () => FIXED_NOW_SEC,
    embeddingProvider: validProvider(calls, input =>
      input.includes("semantic-memory") || input.includes("semantic-query") ? 1 : 0),
  });
  try {
    await adapter.add({
      request_id: "semantic-add",
      user_id: "semantic-user",
      session_id: "semantic-session",
      messages: [{ role: "user", content: "semantic-memory-only-token" }],
    });
    const plane = adapter.registry.get("semantic-user");
    assert.equal(plane.vector_mode, AML_SEMANTIC_VECTOR_MODE);
    assert.equal(plane.vector_provenance.vector_store, "lancedb");

    const internal = await plane.search({
      user_id: "semantic-user",
      query: "semantic-query-only-token",
      top_k: 5,
    });
    assert.equal(internal.data.length, 1);
    assert.equal(internal.diagnostics.vector_backend, "lancedb");
    assert.equal(internal.diagnostics.vector_stage, "lancedb_search");
    assert.equal(internal.diagnostics.channels.includes("vector"), true);

    const callsAfterFirstSearch = calls.length;
    const repeated = await plane.search({
      user_id: "semantic-user",
      query: "semantic-query-only-token",
      top_k: 5,
    });
    assert.equal(repeated.data[0].id, internal.data[0].id);
    assert.equal(calls.length, callsAfterFirstSearch);
    assert.equal(plane.vector_provenance.embedding_cache_schema,
      "memory_engine_benchmark_embedding_cache_v1");

    const publicResult = await adapter.search({
      user_id: "semantic-user",
      query: "semantic-query-only-token",
      top_k: 5,
    });
    assert.deepEqual(Object.keys(publicResult), ["data"]);
    assert.equal(Object.hasOwn(publicResult, "diagnostics"), false);
  } finally {
    await adapter.close();
  }
});

test("per-user semantic LanceDB paths and embedding caches are physically isolated", async () => {
  const adapter = createAmlAdapter({
    nowSecProvider: () => FIXED_NOW_SEC,
    embeddingProvider: validProvider([], input => input.includes("user-a") ? 1 : 2),
  });
  try {
    await adapter.add({
      request_id: "a",
      user_id: "user-a",
      session_id: "session-a",
      messages: [{ role: "user", content: "user-a-only-memory" }],
    });
    await adapter.add({
      request_id: "b",
      user_id: "user-b",
      session_id: "session-b",
      messages: [{ role: "user", content: "user-b-only-memory" }],
    });
    const planeA = adapter.registry.get("user-a");
    const planeB = adapter.registry.get("user-b");
    assert.notEqual(planeA.root, planeB.root);
    assert.notEqual(planeA.vectorPath, planeB.vectorPath);
    assert.notEqual(join(planeA.root, "embedding-cache.sqlite"),
      join(planeB.root, "embedding-cache.sqlite"));
    const aResult = await planeA.search({ user_id: "user-a", query: "user-a-only-memory", top_k: 5 });
    const bResult = await planeB.search({ user_id: "user-b", query: "user-a-only-memory", top_k: 5 });
    assert.equal(aResult.data.length, 1);
    assert.equal(bResult.data.some(item => item.id === aResult.data[0].id), false);
  } finally {
    await adapter.close();
  }
});

test("persistent cache survives scoped close and restart, and stores no raw or gold fields", async () => {
  const root = temporaryRoot();
  const firstCalls = [];
  const first = createAmlSemanticBackend({ root, embeddingProvider: validProvider(firstCalls) });
  try {
    await first.withSearchRuntime(async ({ generateEmbedding }) => {
      await generateEmbedding("persistent-cache-query");
    });
    await first.close();

    const secondCalls = [];
    const second = createAmlSemanticBackend({ root, embeddingProvider: validProvider(secondCalls) });
    try {
      await second.withSearchRuntime(async ({ generateEmbedding }) => {
        await generateEmbedding("persistent-cache-query");
      });
      assert.equal(firstCalls.length, 1);
      assert.equal(secondCalls.length, 0);
      assert.equal(second.snapshotStats().embedding_cache_hits, 1);
    } finally {
      await second.close();
    }

    const database = new Database(join(root, "embedding-cache.sqlite"), { readonly: true });
    try {
      const rows = database.prepare("SELECT * FROM embedding_cache_entries").all();
      assert.equal(rows.length, 1);
      const serialized = JSON.stringify(rows);
      assert.equal(serialized.includes("persistent-cache-query"), false);
      assert.equal(serialized.includes("gold"), false);
      assert.equal(serialized.includes("answer"), false);
      assert.equal(rows[0].dimension, 2560);
    } finally {
      database.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("wrong dimension, non-finite vectors, provider errors, and cache errors fail closed", async () => {
  const cases = [
    {
      name: "wrong dimension",
      provider: async () => [1, 2],
      pattern: /aml_semantic_corpus_embedding_dimension/,
    },
    {
      name: "non-finite vector",
      provider: async () => {
        const vector = vectorWith(1);
        vector[10] = Number.NaN;
        return vector;
      },
      pattern: /aml_semantic_corpus_embedding_dimension/,
    },
    {
      name: "provider error",
      provider: async () => {
        throw new Error("provider token=should-not-leak");
      },
      pattern: /aml_semantic_corpus_embedding/,
    },
  ];
  for (const item of cases) {
    const root = temporaryRoot();
    const backend = createAmlSemanticBackend({ root, embeddingProvider: item.provider });
    try {
      await assert.rejects(() => addCanonical(backend), item.pattern);
    } catch (error) {
      assert.equal(String(error).includes("should-not-leak"), false, item.name);
    } finally {
      await backend.close();
      rmSync(root, { recursive: true, force: true });
    }
  }

  const queryRoot = temporaryRoot();
  const queryBackend = createAmlSemanticBackend({
    root: queryRoot,
    embeddingProvider: async () => [1, 2],
  });
  try {
    await assert.rejects(
      () => queryBackend.withSearchRuntime(async ({ generateEmbedding }) => {
        await generateEmbedding("query-with-wrong-dimension");
      }),
      /aml_semantic_query_embedding_dimension/,
    );
  } finally {
    await queryBackend.close();
    rmSync(queryRoot, { recursive: true, force: true });
  }

  const root = temporaryRoot();
  const resources = fakeResources({
    cacheGet: () => {
      throw new Error("cache gold=hidden");
    },
  });
  const backend = createAmlSemanticBackend({
    root,
    embeddingProvider: resources.provider,
    embeddingCacheFactory: resources.embeddingCacheFactory,
    lancedbConnect: resources.lancedbConnect,
  });
  try {
    await assert.rejects(() => addCanonical(backend), /aml_semantic_embedding_cache_read/);
    assert.equal(resources.counts.cacheClose, 1);
    assert.equal(resources.counts.tableClose, 1);
    assert.equal(resources.counts.connectionClose, 1);
  } finally {
    await backend.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Lance initialization, write, and search failures fail closed", async () => {
  const initRoot = temporaryRoot();
  const initBackend = createAmlSemanticBackend({
    root: initRoot,
    embeddingProvider: validProvider(),
    lancedbConnect: async () => {
      throw new Error("lancedb init failed");
    },
  });
  try {
    await assert.rejects(() => addCanonical(initBackend), /aml_semantic_vector_store_init/);
  } finally {
    await initBackend.close();
    rmSync(initRoot, { recursive: true, force: true });
  }

  const writeRoot = temporaryRoot();
  const writeResources = fakeResources({
    tableAdd: async () => {
      throw new Error("lancedb write failed");
    },
  });
  const writeBackend = createAmlSemanticBackend({
    root: writeRoot,
    embeddingProvider: writeResources.provider,
    embeddingCacheFactory: writeResources.embeddingCacheFactory,
    lancedbConnect: writeResources.lancedbConnect,
  });
  try {
    await assert.rejects(() => addCanonical(writeBackend), /aml_semantic_vector_write/);
    assert.equal(writeResources.counts.cacheClose, 1);
    assert.equal(writeResources.counts.tableClose, 1);
    assert.equal(writeResources.counts.connectionClose, 1);
  } finally {
    await writeBackend.close();
    rmSync(writeRoot, { recursive: true, force: true });
  }

  const searchRoot = temporaryRoot();
  const searchResources = fakeResources({
    tableSearch: () => {
      throw new Error("lancedb search failed");
    },
  });
  const searchBackend = createAmlSemanticBackend({
    root: searchRoot,
    embeddingProvider: searchResources.provider,
    embeddingCacheFactory: searchResources.embeddingCacheFactory,
    lancedbConnect: searchResources.lancedbConnect,
  });
  try {
    await assert.rejects(
      () => searchBackend.withSearchRuntime(async ({ table }) => {
        await table.search(vectorWith(1)).limit(1).execute();
      }),
      /aml_semantic_vector_search/,
    );
    assert.equal(searchResources.counts.cacheClose, 1);
    assert.equal(searchResources.counts.tableClose, 1);
    assert.equal(searchResources.counts.connectionClose, 1);
  } finally {
    await searchBackend.close();
    rmSync(searchRoot, { recursive: true, force: true });
  }
});

test("successful and failed operations close cache, table, and connection", async () => {
  const successRoot = temporaryRoot();
  const successResources = fakeResources();
  const successBackend = createAmlSemanticBackend({
    root: successRoot,
    embeddingProvider: successResources.provider,
    embeddingCacheFactory: successResources.embeddingCacheFactory,
    lancedbConnect: successResources.lancedbConnect,
  });
  try {
    await addCanonical(successBackend);
    assert.deepEqual(successResources.counts, {
      cacheOpen: 1,
      cacheClose: 1,
      tableClose: 1,
      connectionClose: 1,
    });
    await successBackend.withSearchRuntime(async () => "ok");
    assert.deepEqual(successResources.counts, {
      cacheOpen: 2,
      cacheClose: 2,
      tableClose: 2,
      connectionClose: 2,
    });
  } finally {
    await successBackend.close();
    rmSync(successRoot, { recursive: true, force: true });
  }

  const failureRoot = temporaryRoot();
  const failureResources = fakeResources({
    provider: async () => {
      throw new Error("add failure");
    },
  });
  const failureBackend = createAmlSemanticBackend({
    root: failureRoot,
    embeddingProvider: failureResources.provider,
    embeddingCacheFactory: failureResources.embeddingCacheFactory,
    lancedbConnect: failureResources.lancedbConnect,
  });
  try {
    await assert.rejects(() => addCanonical(failureBackend), /aml_semantic_corpus_embedding/);
    assert.deepEqual(failureResources.counts, {
      cacheOpen: 1,
      cacheClose: 1,
      tableClose: 1,
      connectionClose: 1,
    });
    await assert.rejects(
      () => failureBackend.withSearchRuntime(async () => {
        throw new Error("search callback failure");
      }),
      /aml_semantic_operation/,
    );
    assert.deepEqual(failureResources.counts, {
      cacheOpen: 2,
      cacheClose: 2,
      tableClose: 2,
      connectionClose: 2,
    });
  } finally {
    await failureBackend.close();
    rmSync(failureRoot, { recursive: true, force: true });
  }
});
