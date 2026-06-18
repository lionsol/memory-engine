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
  assert.equal(typeof runtime.configJsonPath, "string");
  assert.equal(typeof runtime.timeZone, "string");
  assert.equal(typeof runtime.now, "function");
});
