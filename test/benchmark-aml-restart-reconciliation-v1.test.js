import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import lancedb from "@lancedb/lancedb";
import Database from "better-sqlite3";

import { createAmlAdapter } from "../lib/benchmark/aml-adapter-v1.js";
import {
  AML_RETAINED_REGISTRY_SCHEMA,
  createAmlDataPlaneRegistry,
  createAmlUserDataPlane,
  renderAmlAddDocument,
} from "../lib/benchmark/aml-data-plane-v1.js";
import {
  AML_SEMANTIC_BACKEND_SCHEMA,
  AML_SEMANTIC_VECTOR_MODE,
} from "../lib/benchmark/aml-semantic-backend-v1.js";

const FIXED_NOW_SEC = 1_700_000_000;
const USER_ID = "user-a";
const CHILD_EXIT = 71;

function request({ requestId = "req-1", userId = USER_ID, token = "reconcile-token" } = {}) {
  return {
    request_id: requestId,
    user_id: userId,
    session_id: `session-${userId}`,
    messages: [{
      role: "user",
      content: token,
      timestamp_ms: FIXED_NOW_SEC * 1000,
    }],
  };
}

function internalRequest(value) {
  return {
    ...value,
    messages: value.messages.map(message => ({
      role: message.role,
      content: message.content,
      timestamp_ms: message.timestamp_ms ?? message.timestamp ?? null,
    })),
  };
}

function vectorProvider(calls = []) {
  return async input => {
    calls.push(String(input));
    const vector = new Array(2560).fill(0);
    vector[0] = 1;
    return vector;
  };
}

function userRoot(root, userId = USER_ID) {
  return join(root, `user-${createHash("sha256").update(userId).digest("hex").slice(0, 24)}`);
}

function readState(root, userId = USER_ID) {
  const planeRoot = userRoot(root, userId);
  const engine = new Database(join(planeRoot, "engine.sqlite"), { readonly: true, fileMustExist: true });
  const core = new Database(join(planeRoot, "core.sqlite"), { readonly: true, fileMustExist: true });
  try {
    return {
      planeRoot,
      ledger: engine.prepare(`
        SELECT request_id, payload_sha256, session_id, memory_id, state,
          vector_required, created_at, updated_at
        FROM aml_add_requests
        ORDER BY request_id
      `).all(),
      confidence: engine.prepare(`
        SELECT chunk_id, initial_confidence, confidence, base_tau, category
        FROM memory_confidence
        ORDER BY chunk_id
      `).all(),
      chunks: core.prepare("SELECT id, path, source, text, updated_at FROM chunks ORDER BY id").all(),
      fts: core.prepare("SELECT id, text, path, source FROM chunks_fts ORDER BY id").all(),
    };
  } finally {
    engine.close();
    core.close();
  }
}

async function readVectorRows(vectorPath) {
  const connection = await lancedb.connect(vectorPath);
  let table = null;
  try {
    const names = await connection.tableNames();
    if (!names.includes("chunks")) return [];
    table = await connection.openTable("chunks");
    return await table.query().limit(20).toArray();
  } finally {
    if (table && typeof table.close === "function") await table.close();
    await connection.close();
  }
}

function crashChild({ root, stage, semantic = false, requestValue = request() }) {
  const dataPlaneUrl = pathToFileURL(resolve("lib/benchmark/aml-data-plane-v1.js")).href;
  const script = `
    import { createAmlDataPlaneRegistry } from ${JSON.stringify(dataPlaneUrl)};
    const [root, stage, semanticFlag] = process.argv.slice(1);
    const embeddingProvider = semanticFlag === "1"
      ? async () => { const vector = new Array(2560).fill(0); vector[0] = 1; return vector; }
      : null;
    const registry = createAmlDataPlaneRegistry({
      retainedRoot: root,
      embeddingProvider,
      nowSecProvider: () => ${FIXED_NOW_SEC},
      stageHook: async current => {
        if (current === stage) process.exit(${CHILD_EXIT});
      },
    });
    const plane = registry.getOrCreate(${JSON.stringify(requestValue.user_id)});
    await plane.add(${JSON.stringify(internalRequest(requestValue))});
  `;
  return spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script, root, stage, semantic ? "1" : "0"],
    {
      cwd: resolve("."),
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
}

async function destroyRegistry(registry, root) {
  if (registry) {
    await registry.destroy();
  } else {
    rmSync(root, { recursive: true, force: true });
  }
}

test("retained registry preserves the durable pending ordering and reconciles crash A", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-aml-i2b-a-"));
  let registry = null;
  try {
    const crashed = crashChild({ root, stage: "after_pending_commit" });
    assert.equal(crashed.status, CHILD_EXIT, crashed.stderr);

    const pending = readState(root);
    assert.equal(pending.ledger.length, 1);
    assert.equal(pending.ledger[0].state, "pending");
    assert.equal(pending.ledger[0].vector_required, 0);
    assert.equal(pending.confidence.length, 1);
    assert.equal(pending.confidence[0].confidence, 0);
    assert.equal(pending.confidence[0].initial_confidence > 0, true);
    assert.equal(pending.confidence[0].base_tau > 0, true);
    assert.equal(typeof pending.confidence[0].category, "string");
    assert.equal(pending.chunks.length, 0);
    assert.equal((await readVectorRows(join(pending.planeRoot, "lancedb"))).length, 0);

    registry = createAmlDataPlaneRegistry({
      retainedRoot: root,
      nowSecProvider: () => FIXED_NOW_SEC,
    });
    const plane = registry.get(USER_ID);
    assert.ok(plane, "retained user must be lazily discoverable");
    const retried = await plane.add(internalRequest(request()));
    assert.equal(retried.deduped, false);

    const ready = readState(root);
    assert.equal(ready.ledger[0].state, "ready");
    assert.equal(ready.confidence[0].confidence, ready.confidence[0].initial_confidence);
    assert.equal(ready.chunks.length, 1);
    assert.equal(ready.fts.length, 1);
    assert.equal(existsSync(root), true, "close must preserve an explicit retained root");
  } finally {
    await destroyRegistry(registry, root);
  }
});

test("crash B keeps pending Core invisible and retries with deterministic Core/FTS repair", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-aml-i2b-b-"));
  let registry = null;
  try {
    const requestValue = request({ token: "pending-repair-token" });
    const crashed = crashChild({ root, stage: "after_core_commit", requestValue });
    assert.equal(crashed.status, CHILD_EXIT, crashed.stderr);
    const beforeRepair = readState(root);
    assert.equal(beforeRepair.ledger[0].state, "pending");
    assert.equal(beforeRepair.confidence[0].confidence, 0);
    assert.equal(beforeRepair.chunks.length, 1);
    assert.equal(beforeRepair.fts.length, 1);

    registry = createAmlDataPlaneRegistry({
      retainedRoot: root,
      nowSecProvider: () => FIXED_NOW_SEC,
    });
    const plane = registry.get(USER_ID);
    const hidden = await plane.search({
      user_id: USER_ID,
      query: "pending-repair-token",
      top_k: 5,
    });
    assert.deepEqual(hidden.data, [], "confidence=0 pending Core must not be disclosed");

    const core = new Database(join(beforeRepair.planeRoot, "core.sqlite"));
    try {
      core.prepare("UPDATE chunks SET text = ? WHERE id = ?").run("tampered", beforeRepair.chunks[0].id);
      core.prepare("DELETE FROM chunks_fts WHERE id = ?").run(beforeRepair.chunks[0].id);
    } finally {
      core.close();
    }

    const retried = await plane.add(internalRequest(requestValue));
    assert.equal(retried.deduped, false);
    const afterRepair = readState(root);
    assert.equal(afterRepair.ledger[0].state, "ready");
    assert.equal(afterRepair.chunks.length, 1);
    assert.equal(afterRepair.fts.length, 1);
    assert.equal(afterRepair.chunks[0].text, renderAmlAddDocument(internalRequest(requestValue)));
    assert.equal(afterRepair.fts[0].text, afterRepair.chunks[0].text);
  } finally {
    await destroyRegistry(registry, root);
  }
});

test("crash C reuses the durable semantic vector without a second corpus provider call", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-aml-i2b-c-"));
  let registry = null;
  try {
    const requestValue = request({ token: "vector-durable-token" });
    const crashed = crashChild({ root, stage: "after_vector_commit", semantic: true, requestValue });
    assert.equal(crashed.status, CHILD_EXIT, crashed.stderr);
    const pending = readState(root);
    assert.equal(pending.ledger[0].state, "pending");
    assert.equal(pending.ledger[0].vector_required, 1);
    assert.equal(pending.chunks.length, 1);
    assert.equal(pending.fts.length, 1);
    assert.equal((await readVectorRows(join(pending.planeRoot, "lancedb"))).length, 1);

    const calls = [];
    registry = createAmlDataPlaneRegistry({
      retainedRoot: root,
      embeddingProvider: vectorProvider(calls),
      nowSecProvider: () => FIXED_NOW_SEC,
    });
    const plane = registry.get(USER_ID);
    const retried = await plane.add(internalRequest(requestValue));
    assert.equal(retried.deduped, false);
    assert.equal(calls.length, 0, "exact durable vector row must avoid a corpus provider call");
    const ready = readState(root);
    assert.equal(ready.ledger[0].state, "ready");
    assert.equal((await readVectorRows(join(ready.planeRoot, "lancedb"))).length, 1);
  } finally {
    await destroyRegistry(registry, root);
  }
});

test("crash D after READY is a deduped retry with one Core, Engine, and vector row", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-aml-i2b-d-"));
  let registry = null;
  try {
    const requestValue = request({ token: "ready-durable-token" });
    const crashed = crashChild({ root, stage: "after_ready_commit", semantic: true, requestValue });
    assert.equal(crashed.status, CHILD_EXIT, crashed.stderr);
    const initial = readState(root);
    assert.equal(initial.ledger[0].state, "ready");
    assert.equal(initial.confidence[0].confidence > 0, true);
    assert.equal(initial.chunks.length, 1);
    assert.equal((await readVectorRows(join(initial.planeRoot, "lancedb"))).length, 1);

    const calls = [];
    registry = createAmlDataPlaneRegistry({
      retainedRoot: root,
      embeddingProvider: vectorProvider(calls),
      nowSecProvider: () => FIXED_NOW_SEC,
    });
    const plane = registry.get(USER_ID);
    const retried = await plane.add(internalRequest(requestValue));
    assert.equal(retried.deduped, true);
    assert.equal(calls.length, 0);
    const final = readState(root);
    assert.equal(final.ledger.length, 1);
    assert.equal(final.chunks.length, 1);
    assert.equal((await readVectorRows(join(final.planeRoot, "lancedb"))).length, 1);
  } finally {
    await destroyRegistry(registry, root);
  }
});

test("mixed READY and PENDING state keeps READY searchable and never returns pending Core", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-aml-i2b-mixed-"));
  let registry = null;
  try {
    const pendingRequest = request({ requestId: "pending", token: "shared-visibility-token pending" });
    const crashed = crashChild({ root, stage: "after_core_commit", requestValue: pendingRequest });
    assert.equal(crashed.status, CHILD_EXIT, crashed.stderr);
    registry = createAmlDataPlaneRegistry({
      retainedRoot: root,
      nowSecProvider: () => FIXED_NOW_SEC,
    });
    const plane = registry.get(USER_ID);
    const readyRequest = request({ requestId: "ready", token: "shared-visibility-token ready" });
    await plane.add(internalRequest(readyRequest));
    const state = readState(root);
    const pendingId = state.ledger.find(row => row.request_id === "pending").memory_id;
    const readyId = state.ledger.find(row => row.request_id === "ready").memory_id;
    const result = await plane.search({ user_id: USER_ID, query: "shared-visibility-token", top_k: 5 });
    assert.equal(result.data.some(row => row.id === readyId), true);
    assert.equal(result.data.some(row => row.id === pendingId), false);
  } finally {
    await destroyRegistry(registry, root);
  }
});

test("semantic retained root reopens Search lazily, keeps users physically isolated, and does not allocate unknown users", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-aml-i2b-restart-"));
  let first = null;
  let second = null;
  try {
    const firstCalls = [];
    first = createAmlAdapter({
      retainedRoot: root,
      embeddingProvider: vectorProvider(firstCalls),
      nowSecProvider: () => FIXED_NOW_SEC,
    });
    await first.add({
      request_id: "a",
      user_id: "user-a",
      session_id: "session-a",
      messages: [{ role: "user", content: "user-a-restart-token" }],
    });
    await first.add({
      request_id: "b",
      user_id: "user-b",
      session_id: "session-b",
      messages: [{ role: "user", content: "user-b-restart-token" }],
    });
    const rootA = first.registry.get("user-a").root;
    const rootB = first.registry.get("user-b").root;
    assert.notEqual(rootA, rootB);
    assert.notEqual(join(rootA, "embedding-cache.sqlite"), join(rootB, "embedding-cache.sqlite"));
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    assert.equal(manifest.schema, AML_RETAINED_REGISTRY_SCHEMA);
    assert.equal(manifest.semantic_enabled, true);
    assert.equal(manifest.semantic_backend_version, AML_SEMANTIC_BACKEND_SCHEMA);
    assert.equal(manifest.vector_mode, AML_SEMANTIC_VECTOR_MODE);
    assert.equal(manifest.embedding_dimension, 2560);
    assert.equal(Object.keys(manifest).includes("api_key"), false);
    await first.close();
    assert.equal(existsSync(root), true);

    second = createAmlAdapter({
      retainedRoot: root,
      embeddingProvider: vectorProvider(),
      nowSecProvider: () => FIXED_NOW_SEC,
    });
    assert.equal(second.registry.size, 0);
    const unknown = await second.search({ user_id: "unknown-after-restart", query: "anything", top_k: 5 });
    assert.deepEqual(unknown, { data: [] });
    assert.equal(second.registry.size, 0);
    assert.equal(existsSync(userRoot(root, "unknown-after-restart")), false);

    const restored = await second.search({ user_id: "user-a", query: "user-a-restart-token", top_k: 5 });
    assert.equal(restored.data.length, 1);
    assert.match(restored.data[0].content, /user-a-restart-token/);
    const crossUser = await second.search({ user_id: "user-b", query: "user-a-restart-token", top_k: 5 });
    assert.equal(crossUser.data.some(row => row.id === restored.data[0].id), false);
  } finally {
    if (second) await second.close();
    if (first && !first.closed) await first.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("retained manifest mismatch and corrupt/future schema fail closed before stale vectors are used", async () => {
  const mismatchRoot = mkdtempSync(join(tmpdir(), "memory-engine-aml-i2b-manifest-mismatch-"));
  let first = null;
  let mismatch = null;
  try {
    first = createAmlDataPlaneRegistry({
      retainedRoot: mismatchRoot,
      embeddingProvider: vectorProvider(),
      embeddingBaseUrl: "https://semantic-a.example/v1",
      nowSecProvider: () => FIXED_NOW_SEC,
    });
    first.getOrCreate(USER_ID);
    await first.close();
    assert.throws(
      () => createAmlDataPlaneRegistry({
        retainedRoot: mismatchRoot,
        embeddingProvider: vectorProvider(),
        embeddingBaseUrl: "https://semantic-b.example/v1",
        nowSecProvider: () => FIXED_NOW_SEC,
      }),
      /aml_retained_manifest_incompatible/,
    );
  } finally {
    if (mismatch) await mismatch.destroy();
    if (first && !first.closed) await first.destroy();
    rmSync(mismatchRoot, { recursive: true, force: true });
  }

  const corruptRoot = mkdtempSync(join(tmpdir(), "memory-engine-aml-i2b-manifest-corrupt-"));
  let registry = null;
  try {
    registry = createAmlDataPlaneRegistry({ retainedRoot: corruptRoot, nowSecProvider: () => FIXED_NOW_SEC });
    registry.getOrCreate(USER_ID);
    await registry.close();
    writeFileSync(join(corruptRoot, "manifest.json"), JSON.stringify({ schema: "future-schema" }));
    assert.throws(
      () => createAmlDataPlaneRegistry({ retainedRoot: corruptRoot, nowSecProvider: () => FIXED_NOW_SEC }),
      /aml_retained_manifest_schema_invalid|aml_retained_manifest_identity_invalid/,
    );
  } finally {
    rmSync(corruptRoot, { recursive: true, force: true });
  }
});

test("legacy AML request ledger rows migrate deterministically to READY on reopen", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-aml-i2b-ledger-migration-"));
  let plane = null;
  try {
    const raw = {
      request_id: "legacy-request",
      user_id: USER_ID,
      session_id: "legacy-session",
      messages: [{ role: "user", content: "legacy-ledger-token", timestamp: FIXED_NOW_SEC * 1000 }],
    };
    plane = createAmlUserDataPlane({ root, userId: USER_ID, nowSecProvider: () => FIXED_NOW_SEC });
    const added = await plane.add(internalRequest(raw));
    await plane.close();

    const enginePath = join(root, "engine.sqlite");
    const engine = new Database(enginePath);
    try {
      engine.exec("DROP TABLE aml_add_requests");
      engine.exec(`
        CREATE TABLE aml_add_requests (
          request_id TEXT PRIMARY KEY,
          payload_sha256 TEXT NOT NULL,
          session_id TEXT NOT NULL,
          memory_id TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL
        )
      `);
      engine.prepare(`
        INSERT INTO aml_add_requests (request_id, payload_sha256, session_id, memory_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(raw.request_id, added.payload_sha256, raw.session_id, added.memory_id, FIXED_NOW_SEC);
    } finally {
      engine.close();
    }

    plane = createAmlUserDataPlane({ root, userId: USER_ID, nowSecProvider: () => FIXED_NOW_SEC });
    const retry = await plane.add(internalRequest(raw));
    assert.equal(retry.deduped, true);
    const migrated = new Database(enginePath, { readonly: true });
    try {
      const columns = migrated.prepare("PRAGMA table_info(aml_add_requests)").all().map(row => row.name);
      assert.equal(columns.includes("state"), true);
      assert.equal(columns.includes("vector_required"), true);
      assert.equal(columns.includes("updated_at"), true);
      const row = migrated.prepare("SELECT state, vector_required, updated_at FROM aml_add_requests").get();
      assert.deepEqual(row, { state: "ready", vector_required: 0, updated_at: FIXED_NOW_SEC });
    } finally {
      migrated.close();
    }
  } finally {
    if (plane && !plane.closed) await plane.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("ordinary semantic Add failures roll back a newly created pending state", async () => {
  const adapter = createAmlAdapter({
    embeddingProvider: async () => [1, 2],
    nowSecProvider: () => FIXED_NOW_SEC,
  });
  try {
    await assert.rejects(
      () => adapter.add({
        request_id: "ordinary-failure",
        user_id: USER_ID,
        session_id: "failure-session",
        messages: [{ role: "user", content: "ordinary-failure-token" }],
      }),
      /aml_semantic_corpus_embedding_dimension/,
    );
    const plane = adapter.registry.get(USER_ID);
    const state = readState(adapter.registry.root, USER_ID);
    assert.equal(state.ledger.length, 0);
    assert.equal(state.chunks.length, 0);
    assert.equal(plane.closed, false);
  } finally {
    await adapter.close();
  }
});
