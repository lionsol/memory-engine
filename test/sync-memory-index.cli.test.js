import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { detectOpenClawRuntime } from "./helpers/openclaw-runtime.js";
import { collectIndexedFiles, readIndexedPathState } from "../lib/sync/index-sync.js";

const syncCliModule = await import("../bin/sync-memory-index.js");
const runSyncMemoryIndex =
  syncCliModule.runSyncMemoryIndex
  || syncCliModule.default?.runSyncMemoryIndex;
const runOpenClawMemoryIndexCli =
  syncCliModule.runOpenClawMemoryIndexCli
  || syncCliModule.default?.runOpenClawMemoryIndexCli;

assert.equal(typeof runSyncMemoryIndex, "function");
assert.equal(typeof runOpenClawMemoryIndexCli, "function");

function createIndexFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-index-coverage-"));
  const workspaceDir = resolve(root, "workspace");
  const smartAddDir = resolve(workspaceDir, "memory/smart-add");
  const dbPath = resolve(root, "core.sqlite");
  mkdirSync(smartAddDir, { recursive: true });
  const db = new Database(dbPath);
  db.exec("CREATE TABLE chunks (id TEXT PRIMARY KEY, path TEXT NOT NULL, text TEXT, updated_at INTEGER)");
  db.close();
  return {
    root,
    workspaceDir,
    dbPath,
    write(date, fingerprint) {
      writeFileSync(resolve(smartAddDir, `${date}.md`), [
        "# Smart Added Memory",
        "",
        `<!-- smart-add-fingerprint: ${fingerprint} -->`,
        `## entry-${date}`,
        "Category: raw_log",
        "Provenance: session_flush",
        "",
        "**User:** fixture-only content",
        "",
      ].join("\n"), "utf8");
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function makeIndexDependencies(fixture, manager) {
  return {
    collectIndexedFiles,
    readIndexedPathState,
    CORE_DB_PATH: fixture.dbPath,
    INDEX_SYNC_WATCH_DIRS: ["memory/smart-add"],
    WORKSPACE: fixture.workspaceDir,
    getSharedMemoryManager: async () => ({ manager, cfg: null, error: null }),
  };
}

test("sync-memory-index CLI module loads without requiring OpenClaw runtime at import time", () => {
  assert.equal(typeof runSyncMemoryIndex, "function");
});

test("getSharedMemoryManager returns a clear runtime dependency error when OpenClaw runtime is unavailable", async (t) => {
  const runtime = await detectOpenClawRuntime();
  if (runtime.available) {
    t.skip("OpenClaw runtime available in this environment");
    return;
  }

  const { getSharedMemoryManager } = await import("../memory-manager-runtime.js");
  const result = await getSharedMemoryManager({ purpose: "test", allowImplicit: false });
  assert.equal(result.manager, null);
  assert.match(
    String(result.error || ""),
    /openclaw runtime package unavailable; sync-memory-index requires the OpenClaw harness runtime or the openclaw plugin SDK package/i,
  );
});

test("sync-memory-index reports both manager and fallback errors when local runtime and OpenClaw CLI sync are unavailable", async () => {
  const result = await runSyncMemoryIndex({
      force: true,
      getSharedMemoryManagerImpl: async () => ({
        manager: null,
        error: "openclaw runtime package unavailable; sync-memory-index requires the OpenClaw harness runtime or the openclaw plugin SDK package",
      }),
      openClawCliSyncImpl: async () => ({
        ok: false,
        error: "OpenClaw memory index is unavailable because memory search is disabled",
      }),
    });
  assert.equal(result.ok, false);
  assert.equal(result.index_invocation.status, "failed");
  assert.match(
    result.index_invocation.error,
    /openclaw runtime package unavailable.*fallback openclaw memory index failed: OpenClaw memory index is unavailable because memory search is disabled/i,
  );
});

test("sync-memory-index can delegate to the sanctioned OpenClaw CLI sync path", async () => {
  const result = await runSyncMemoryIndex({
    force: true,
    getSharedMemoryManagerImpl: async () => ({
      manager: null,
      error: "openclaw runtime package unavailable; sync-memory-index requires the OpenClaw harness runtime or the openclaw plugin SDK package",
      cfg: null,
    }),
    openClawCliSyncImpl: async () => ({
      ok: true,
      delegated_to: "openclaw memory index --agent main --force",
      stdout: "reindexed",
      stderr: "",
    }),
  });

  assert.equal(result.sync_result?.delegated, true);
  assert.equal(result.sync_result?.via, "openclaw memory index");
  assert.equal(result.sync_result?.delegated_to, "openclaw memory index --agent main --force");
  assert.equal(result.manager_error?.includes("openclaw runtime package unavailable"), true);
});

test("sync-memory-index honors targetDate and verifies current target fingerprints, not chunk count", async () => {
  const fixture = createIndexFixture();
  const targetDate = "2026-08-10";
  const currentFingerprint = "a1b2c3d4e5f60718";
  fixture.write(targetDate, currentFingerprint);
  fixture.write("2026-08-11", "1111111111111111");
  const db = new Database(fixture.dbPath);
  let payload = null;
  const manager = {
    status: () => ({ workspaceDir: fixture.workspaceDir, dbPath: fixture.dbPath, dirty: false }),
    async sync(value) {
      payload = value;
      db.prepare("INSERT INTO chunks (id, path, text, updated_at) VALUES (?, ?, ?, ?)")
        .run("target", `memory/smart-add/${targetDate}.md`, `<!-- smart-add-fingerprint: ${currentFingerprint} -->`, 1);
    },
    close() { db.close(); },
  };
  try {
    const result = await runSyncMemoryIndex({
      targetDate,
      runtimeDepsImpl: async () => makeIndexDependencies(fixture, manager),
      getSharedMemoryManagerImpl: async () => ({ manager, cfg: null, error: null }),
    });
    assert.deepEqual(payload, { reason: "cli-sync" });
    assert.equal(result.index_invocation.status, "succeeded");
    assert.equal(result.target_date_coverage.status, "complete");
    assert.equal(result.target_date_coverage.target_date, targetDate);
    assert.equal(result.target_date_coverage.path, `memory/smart-add/${targetDate}.md`);
    assert.equal(result.target_date_coverage.required_fingerprints, 1);
    assert.equal(result.target_date_coverage.matched_fingerprints, 1);
    assert.equal(result.file_scan.total, 2);
    assert.equal(result.file_scan.target_date_limited, false);
    assert.equal(result.ok, true);
  } finally {
    fixture.cleanup();
  }
});

test("sync-memory-index keeps invocation success separate from failed post-read or stale target content", async () => {
  for (const scenario of ["post_read_error", "missing", "stale"]) {
    const fixture = createIndexFixture();
    const targetDate = "2026-08-10";
    const currentFingerprint = "a1b2c3d4e5f60718";
    fixture.write(targetDate, currentFingerprint);
    const db = new Database(fixture.dbPath);
    const manager = {
      status: () => ({ workspaceDir: fixture.workspaceDir, dbPath: fixture.dbPath, dirty: false }),
      async sync() {
        if (scenario === "missing") return;
        const indexedFingerprint = scenario === "stale" ? "1111111111111111" : currentFingerprint;
        db.prepare("INSERT INTO chunks (id, path, text, updated_at) VALUES (?, ?, ?, ?)")
          .run("target", `memory/smart-add/${targetDate}.md`, `<!-- smart-add-fingerprint: ${indexedFingerprint} -->`, 1);
      },
      close() { db.close(); },
    };
    try {
      const result = await runSyncMemoryIndex({
        targetDate,
        runtimeDepsImpl: async () => makeIndexDependencies(fixture, manager),
        getSharedMemoryManagerImpl: async () => ({ manager, cfg: null, error: null }),
        ...(scenario === "post_read_error" ? {
          readTargetIndexedContentEvidenceImpl: () => { throw new Error("fixture post-read failure"); },
        } : {}),
      });
      assert.equal(result.index_invocation.status, "succeeded", scenario);
      assert.equal(result.ok, false, scenario);
      assert.equal(result.target_date_coverage.status, scenario === "post_read_error"
        ? "read_error"
        : scenario === "missing" ? "missing" : "stale");
      if (scenario === "stale") {
        assert.equal(result.target_date_coverage.indexed_chunk_count, 1);
        assert.equal(result.target_date_coverage.missing_fingerprints, 1);
      }
    } finally {
      fixture.cleanup();
    }
  }
});
