import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import {
  AML_ADAPTER_VERSION,
  AML_SEARCH_OPTIONS_POLICY,
  AML_UPSTREAM_COMMIT,
  createAmlAdapter,
  normalizeAmlAddRequest,
  normalizeAmlSearchRequest,
} from "../lib/benchmark/aml-adapter-v1.js";
import {
  AML_SEARCH_EVIDENCE_SURFACE,
  createAmlDataPlaneRegistry,
  createAmlUserDataPlane,
  renderAmlAddDocument,
} from "../lib/benchmark/aml-data-plane-v1.js";

const FIXED_NOW_SEC = 1_700_000_000;

function addRequest(overrides = {}) {
  return {
    request_id: "req-1",
    user_id: "user-a",
    session_id: "session-a",
    messages: [
      {
        role: "user",
        content: "The benchmark retrieval token is osakafact.",
        timestamp: 1_699_999_000_000,
      },
    ],
    ...overrides,
  };
}

function searchRequest(overrides = {}) {
  return {
    user_id: "user-a",
    query: "osakafact",
    top_k: 5,
    ...overrides,
  };
}

function rowCount(path, table) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  } finally {
    db.close();
  }
}

test("AML public request validators normalize timestamps and keep options outside the query", () => {
  const add = normalizeAmlAddRequest(addRequest());
  assert.equal(add.messages[0].timestamp_ms, 1_699_999_000_000);
  assert.equal(Object.hasOwn(add.messages[0], "timestamp"), false);

  const emptyContent = normalizeAmlAddRequest(addRequest({
    messages: [{ role: "user", content: "" }],
  }));
  assert.equal(emptyContent.messages[0].content, "");
  assert.throws(
    () => normalizeAmlAddRequest(addRequest({ messages: [{ role: "user", content: 7 }] })),
    /aml_add_message_0_content_must_be_string/,
  );

  const search = normalizeAmlSearchRequest(searchRequest({
    options: ["alpha", "beta"],
  }));
  assert.equal(search.query, "osakafact");
  assert.deepEqual(search.options, ["alpha", "beta"]);
  assert.equal(AML_SEARCH_OPTIONS_POLICY, "accepted_but_not_injected_into_query");
});

test("AML Add projection preserves message order, role, and supplied timestamp", () => {
  const request = normalizeAmlAddRequest(addRequest({
    messages: [
      { role: "user", content: "first", timestamp: 1000 },
      { role: "assistant", content: "second" },
      { role: "user", content: "third", timestamp: 3000 },
    ],
  }));
  assert.equal(
    renderAmlAddDocument(request),
    "(1000) user: first\nassistant: second\n(3000) user: third",
  );
});

test("AML Add is synchronously searchable through production hybridSearch", async () => {
  const adapter = createAmlAdapter({ nowSecProvider: () => FIXED_NOW_SEC });
  try {
    const added = await adapter.add(addRequest());
    assert.deepEqual(added, {
      success: true,
      request_id: "req-1",
      user_id: "user-a",
      session_id: "session-a",
    });

    const result = await adapter.search(searchRequest());
    assert.equal(result.data.length, 1);
    assert.match(result.data[0].content, /osakafact/);
    assert.equal(typeof result.data[0].id, "string");
    assert.equal(result.data[0].id.length, 64);
    assert.equal(Number.isFinite(result.data[0].score), true);
    assert.equal(Object.hasOwn(result, "debug"), false);
  } finally {
    await adapter.close();
  }
});

test("same request_id plus identical payload is idempotent, including concurrent retry", async () => {
  const adapter = createAmlAdapter({ nowSecProvider: () => FIXED_NOW_SEC });
  try {
    await Promise.all([
      adapter.add(addRequest()),
      adapter.add(addRequest()),
    ]);
    const plane = adapter.registry.get("user-a");
    assert.equal(rowCount(plane.corePath, "chunks"), 1);
    assert.equal(rowCount(plane.enginePath, "memory_confidence"), 1);
    assert.equal(rowCount(plane.enginePath, "aml_add_requests"), 1);
  } finally {
    await adapter.close();
  }
});

test("disk-backed request idempotency survives reopening the same temporary user data plane", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-aml-reopen-test-"));
  const request = normalizeAmlAddRequest(addRequest());
  try {
    const first = createAmlUserDataPlane({
      root,
      userId: "user-a",
      nowSecProvider: () => FIXED_NOW_SEC,
    });
    const initial = await first.add(request);
    assert.equal(initial.deduped, false);
    await first.close();

    const reopened = createAmlUserDataPlane({
      root,
      userId: "user-a",
      nowSecProvider: () => FIXED_NOW_SEC,
    });
    const retry = await reopened.add(request);
    assert.equal(retry.deduped, true);
    assert.equal(retry.memory_id, initial.memory_id);
    assert.equal(rowCount(reopened.enginePath, "aml_add_requests"), 1);
    await reopened.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("same request_id plus different payload fails closed", async () => {
  const adapter = createAmlAdapter({ nowSecProvider: () => FIXED_NOW_SEC });
  try {
    await adapter.add(addRequest());
    await assert.rejects(
      () => adapter.add(addRequest({
        messages: [{ role: "user", content: "different payload" }],
      })),
      /aml_request_id_payload_conflict/,
    );
    const plane = adapter.registry.get("user-a");
    assert.equal(rowCount(plane.corePath, "chunks"), 1);
    assert.equal(rowCount(plane.enginePath, "aml_add_requests"), 1);
  } finally {
    await adapter.close();
  }
});

test("different AML users receive physically distinct data planes and cannot leak lexical results", async () => {
  const adapter = createAmlAdapter({ nowSecProvider: () => FIXED_NOW_SEC });
  try {
    await adapter.add(addRequest({
      request_id: "req-a",
      user_id: "user-a",
      messages: [{ role: "user", content: "userauniquexyz" }],
    }));
    await adapter.add(addRequest({
      request_id: "req-b",
      user_id: "user-b",
      session_id: "session-b",
      messages: [{ role: "user", content: "userbuniqueqrs" }],
    }));

    const planeA = adapter.registry.get("user-a");
    const planeB = adapter.registry.get("user-b");
    assert.notEqual(planeA.root, planeB.root);
    assert.notEqual(planeA.corePath, planeB.corePath);
    assert.notEqual(planeA.enginePath, planeB.enginePath);
    assert.notEqual(planeA.vectorPath, planeB.vectorPath);

    const cross = await adapter.search({
      user_id: "user-b",
      query: "userauniquexyz",
      top_k: 10,
    });
    assert.deepEqual(cross, { data: [] });
  } finally {
    await adapter.close();
  }
});

test("unknown AML user returns empty data without allocating a data plane", async () => {
  const adapter = createAmlAdapter({ nowSecProvider: () => FIXED_NOW_SEC });
  try {
    assert.equal(adapter.registry.size, 0);
    const result = await adapter.search({ user_id: "unknown", query: "anything", top_k: 10 });
    assert.deepEqual(result, { data: [] });
    assert.equal(adapter.registry.size, 0);
  } finally {
    await adapter.close();
  }
});

test("Search options never enter the vector query input", async () => {
  const queryInputs = [];
  const adapter = createAmlAdapter({
    nowSecProvider: () => FIXED_NOW_SEC,
    vectorBackendFactory: () => ({
      table: {
        search() {
          return {
            limit() {
              return {
                async execute() {
                  return [];
                },
              };
            },
          };
        },
      },
      async generateEmbedding(text) {
        queryInputs.push(text);
        return [1, 0];
      },
      async addCanonicalMemory() {},
    }),
  });
  try {
    await adapter.add(addRequest({
      messages: [{ role: "user", content: "unrelated memory text" }],
    }));
    await adapter.search({
      user_id: "user-a",
      query: "question-only-vector-token",
      options: ["do-not-inject-option-token"],
      top_k: 5,
    });
    assert.deepEqual(queryInputs, ["question-only-vector-token"]);
  } finally {
    await adapter.close();
  }
});

test("vector backend factory is instantiated independently per user", async () => {
  const created = [];
  const adapter = createAmlAdapter({
    nowSecProvider: () => FIXED_NOW_SEC,
    vectorBackendFactory: ({ userId, vectorPath }) => {
      created.push({ userId, vectorPath });
      return {
        table: {
          search() {
            return { limit: () => ({ execute: async () => [] }) };
          },
        },
        async generateEmbedding() {
          return [1];
        },
        async addCanonicalMemory() {},
      };
    },
  });
  try {
    await adapter.add(addRequest({ request_id: "a", user_id: "user-a" }));
    await adapter.add(addRequest({ request_id: "b", user_id: "user-b" }));
    assert.equal(created.length, 2);
    assert.notEqual(created[0].vectorPath, created[1].vectorPath);
    assert.deepEqual(new Set(created.map(item => item.userId)), new Set(["user-a", "user-b"]));
  } finally {
    await adapter.close();
  }
});

test("B6-I1 Search freezes the current 240-character production evidence surface", async () => {
  const adapter = createAmlAdapter({ nowSecProvider: () => FIXED_NOW_SEC });
  try {
    const longText = `surface-token ${"x".repeat(400)}`;
    await adapter.add(addRequest({
      messages: [{ role: "user", content: longText }],
    }));
    const result = await adapter.search({ user_id: "user-a", query: "surface-token", top_k: 5 });
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].content.length <= 240, true);
    assert.equal(AML_SEARCH_EVIDENCE_SURFACE, "production_hybrid_text_240_v1");
  } finally {
    await adapter.close();
  }
});

test("AML adapter rejects out-of-contract fields and top_k above the frozen maximum", () => {
  assert.throws(
    () => normalizeAmlAddRequest({ ...addRequest(), gold_answer: "forbidden" }),
    /aml_add_request_unknown_field:gold_answer/,
  );
  assert.throws(
    () => normalizeAmlSearchRequest({ ...searchRequest(), top_k: 101 }),
    /aml_search_top_k_exceeds_100/,
  );
});

test("many AML users do not retain one SQLite handle set per data plane", async (t) => {
  const fdPath = "/proc/self/fd";
  if (!existsSync(fdPath)) {
    t.skip("fd accounting requires /proc/self/fd");
    return;
  }
  const before = readdirSync(fdPath).length;
  const registry = createAmlDataPlaneRegistry();
  try {
    for (let index = 0; index < 120; index += 1) {
      registry.getOrCreate(`fd-user-${index}`);
    }
    const after = readdirSync(fdPath).length;
    assert.equal(registry.size, 120);
    assert.equal(after - before < 24, true, `unexpected persistent fd growth: ${after - before}`);
  } finally {
    await registry.close();
  }
});

test("AML registry requires benchmark-owned temporary storage and cleans it on close", async () => {
  assert.throws(
    () => createAmlDataPlaneRegistry({ temporaryParent: resolve(".") }),
    /aml_temporary_root_required/,
  );

  const registry = createAmlDataPlaneRegistry({ temporaryParent: tmpdir() });
  const root = registry.root;
  assert.equal(existsSync(root), true);
  await registry.close();
  assert.equal(existsSync(root), false);
});

test("AML adapter exposes pinned source provenance without starting transport or execution", async () => {
  const adapter = createAmlAdapter({ nowSecProvider: () => FIXED_NOW_SEC });
  try {
    assert.equal(adapter.adapter_version, AML_ADAPTER_VERSION);
    assert.equal(adapter.upstream_commit, AML_UPSTREAM_COMMIT);
    assert.equal(adapter.evidence_surface, "production_hybrid_text_240_v1");
    assert.equal(typeof adapter.add, "function");
    assert.equal(typeof adapter.search, "function");
  } finally {
    await adapter.close();
  }
});
