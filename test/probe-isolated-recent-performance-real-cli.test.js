import test from "node:test";
import assert from "node:assert/strict";

import {
  parseArgs,
  probeIsolatedRecentPerformance,
  usage,
} from "../bin/probe-isolated-recent-performance.js";

test("Recent performance probe parser keeps synthetic/default and mutation contracts", async () => {
  assert.equal(parseArgs([]).mode, "synthetic");
  assert.equal(parseArgs(["--mode", "synthetic"]).mode, "synthetic");
  assert.match(usage(), /--mode synthetic\|real/);
  assert.throws(() => parseArgs(["--mode", "REAL"]), /unknown mode: REAL/);
  assert.throws(() => parseArgs(["--mode", "real"]), /real_mode_requires_explicit_core_and_engine_db/);
  assert.throws(
    () => parseArgs(["--mode", "synthetic", "--core-db", "core.sqlite", "--engine-db", "engine.sqlite"]),
    /db_paths_require_real_mode/,
  );
  const help = await probeIsolatedRecentPerformance(["--help"]);
  assert.equal(help.exitCode, 0);
  assert.match(help.output, /Default mode is synthetic/);
});

test("real-mode performance probe fails closed before opening caller paths", async () => {
  await assert.rejects(
    probeIsolatedRecentPerformance([
      "--mode", "real",
      "--core-db", "/does/not/exist/core.sqlite",
      "--engine-db", "/does/not/exist/engine.sqlite",
    ]),
    error => error?.code === "LEGACY_ATTACHED_CORE_RETIRED",
  );
});

test("real-mode performance probe preserves mutation-flag rejection", async () => {
  await assert.rejects(
    probeIsolatedRecentPerformance(["--apply"]),
    error => String(error?.message || error).includes("read-only"),
  );
});
