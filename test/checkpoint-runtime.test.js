import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const checkpoint = require("../bin/session-checkpoint.js");
const { getRuntime } = require("../lib/checkpoint/runtime.js");

test("withRuntime exposes engineDbPath and timeZone overrides inside callback", async () => {
  await checkpoint.withRuntime({
    engineDbPath: "/tmp/engine-phase2.sqlite",
    timeZone: "UTC",
  }, async () => {
    const runtime = getRuntime();
    assert.equal(runtime.engineDbPath, "/tmp/engine-phase2.sqlite");
    assert.equal(runtime.timeZone, "UTC");
  });
});

test("withRuntime restores previous runtime after callback throws", async () => {
  const before = getRuntime();

  await assert.rejects(
    checkpoint.withRuntime({
      engineDbPath: "/tmp/runtime-throw.sqlite",
      timeZone: "UTC",
    }, async () => {
      const runtime = getRuntime();
      assert.equal(runtime.engineDbPath, "/tmp/runtime-throw.sqlite");
      assert.equal(runtime.timeZone, "UTC");
      throw new Error("boom");
    }),
    /boom/,
  );

  const after = getRuntime();
  assert.equal(after.engineDbPath, before.engineDbPath);
  assert.equal(after.timeZone, before.timeZone);
});

test("nested withRuntime preserves merge semantics", async () => {
  await checkpoint.withRuntime({
    engineDbPath: "/tmp/outer-engine.sqlite",
    timeZone: "Asia/Tokyo",
  }, async () => {
    const outer = getRuntime();
    assert.equal(outer.engineDbPath, "/tmp/outer-engine.sqlite");
    assert.equal(outer.timeZone, "Asia/Tokyo");

    await checkpoint.withRuntime({
      timeZone: "UTC",
    }, async () => {
      const inner = getRuntime();
      assert.equal(inner.engineDbPath, "/tmp/outer-engine.sqlite");
      assert.equal(inner.timeZone, "UTC");
    });

    const restored = getRuntime();
    assert.equal(restored.engineDbPath, "/tmp/outer-engine.sqlite");
    assert.equal(restored.timeZone, "Asia/Tokyo");
  });
});

test("getRuntime default fields remain available", () => {
  const runtime = getRuntime();

  assert.equal(typeof runtime.workspaceDir, "string");
  assert.equal(typeof runtime.memoryDir, "string");
  assert.equal(typeof runtime.smartAddDir, "string");
  assert.equal(typeof runtime.episodesDir, "string");
  assert.equal(typeof runtime.sessionsDir, "string");
  assert.equal(typeof runtime.coreDbPath, "string");
  assert.equal(typeof runtime.engineDbPath, "string");
  assert.equal(typeof runtime.lancedbDir, "string");
  assert.equal(typeof runtime.configJsonPath, "string");
  assert.equal(typeof runtime.timeZone, "string");
  assert.equal(typeof runtime.now, "function");
  assert.equal(runtime.dbOptions.coreDbPath, runtime.coreDbPath);
  assert.equal(runtime.dbOptions.engineDbPath, runtime.engineDbPath);
  assert.equal(runtime.checkpointLegacyDailyMirror, false);
  assert.equal(Object.isFrozen(runtime), true);
  assert.equal(Object.isFrozen(runtime.descriptor), true);
  assert.equal(Object.isFrozen(runtime.descriptor.paths), true);
  assert.equal(Object.isFrozen(runtime.dbOptions), true);
});

test("one checkpoint runtime scope reuses one immutable descriptor", async () => {
  await checkpoint.withRuntime({
    coreDbPath: "/tmp/descriptor-core.sqlite",
    engineDbPath: "/tmp/descriptor-engine.sqlite",
    lancedbDir: "/tmp/descriptor-lancedb",
  }, async () => {
    const first = getRuntime();
    await Promise.resolve();
    const second = getRuntime();

    assert.equal(second.descriptor, first.descriptor);
    assert.equal(second.dbOptions, first.dbOptions);
    assert.equal(second.coreDbPath, "/tmp/descriptor-core.sqlite");
    assert.equal(second.engineDbPath, "/tmp/descriptor-engine.sqlite");
    assert.equal(second.lancedbDir, "/tmp/descriptor-lancedb");
  });
});

test("concurrent checkpoint runtime scopes do not leak overrides", async () => {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const [left, right] = await Promise.all([
    checkpoint.withRuntime({
      engineDbPath: "/tmp/concurrent-left.sqlite",
      timeZone: "UTC",
    }, async () => {
      await delay(20);
      const runtime = getRuntime();
      return { engineDbPath: runtime.engineDbPath, timeZone: runtime.timeZone };
    }),
    checkpoint.withRuntime({
      engineDbPath: "/tmp/concurrent-right.sqlite",
      timeZone: "Asia/Tokyo",
    }, async () => {
      const first = getRuntime();
      await delay(30);
      const second = getRuntime();
      assert.equal(second.descriptor, first.descriptor);
      return { engineDbPath: second.engineDbPath, timeZone: second.timeZone };
    }),
  ]);

  assert.deepEqual(left, {
    engineDbPath: "/tmp/concurrent-left.sqlite",
    timeZone: "UTC",
  });
  assert.deepEqual(right, {
    engineDbPath: "/tmp/concurrent-right.sqlite",
    timeZone: "Asia/Tokyo",
  });
});
