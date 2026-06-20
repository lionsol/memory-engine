import test from "node:test";
import assert from "node:assert/strict";
import { detectOpenClawRuntime } from "./helpers/openclaw-runtime.js";

const syncCliModule = await import("../bin/sync-memory-index.js");
const runSyncMemoryIndex =
  syncCliModule.runSyncMemoryIndex
  || syncCliModule.default?.runSyncMemoryIndex;
const runOpenClawMemoryIndexCli =
  syncCliModule.runOpenClawMemoryIndexCli
  || syncCliModule.default?.runOpenClawMemoryIndexCli;

assert.equal(typeof runSyncMemoryIndex, "function");
assert.equal(typeof runOpenClawMemoryIndexCli, "function");

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
  await assert.rejects(
    runSyncMemoryIndex({
      force: true,
      getSharedMemoryManagerImpl: async () => ({
        manager: null,
        error: "openclaw runtime package unavailable; sync-memory-index requires the OpenClaw harness runtime or the openclaw plugin SDK package",
      }),
      openClawCliSyncImpl: async () => ({
        ok: false,
        error: "OpenClaw memory index is unavailable because memory search is disabled",
      }),
    }),
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
