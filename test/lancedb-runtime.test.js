import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLanceDbRuntime } from "../lib/lancedb-runtime.js";

const silentLogger = Object.freeze({
  log() {},
  warn() {},
});

test("new LanceDB chunks table is empty after initialization", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-lancedb-runtime-"));
  try {
    const runtime = createLanceDbRuntime({ dbPath: root, logger: silentLogger });
    assert.equal(await runtime.ensureLanceDBReady(), true);

    const state = await runtime.getLanceDBRuntime({ timeoutMs: 5_000 });
    assert.equal(state.readyState, "ready");
    assert.ok(state.table);
    assert.equal(await state.table.countRows(), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reopening an existing LanceDB table preserves real rows without adding an initializer", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-lancedb-runtime-"));
  try {
    const first = createLanceDbRuntime({ dbPath: root, logger: silentLogger });
    assert.equal(await first.ensureLanceDBReady(), true);
    const firstState = await first.getLanceDBRuntime({ timeoutMs: 5_000 });
    await firstState.table.add([{
      id: "real-row",
      text: "real memory",
      vector: new Array(2560).fill(0.01),
      timestamp: 1,
    }]);
    assert.equal(await firstState.table.countRows(), 1);

    const second = createLanceDbRuntime({ dbPath: root, logger: silentLogger });
    assert.equal(await second.ensureLanceDBReady(), true);
    const secondState = await second.getLanceDBRuntime({ timeoutMs: 5_000 });
    assert.equal(await secondState.table.countRows(), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
