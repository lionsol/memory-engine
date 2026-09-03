import test from "node:test";
import assert from "node:assert/strict";

import {
  runRealRecentPerformanceProbe,
  runRecentPerformanceProbe,
} from "../lib/recall/hybrid/recent-performance-probe.js";

test("recent performance probe keeps synthetic mode available without a legacy Core attachment", async () => {
  const synthetic = await runRecentPerformanceProbe({
    limits: [20],
    batchSizes: [16],
    warmupCount: 0,
    repetitionCount: 1,
    productionShape: {
      totalRows: 32,
      activeRows: 8,
      episodeRows: 4,
      idLength: 32,
    },
  });
  assert.notEqual(synthetic.mode, "real");
  assert.equal(Boolean(synthetic.topology?.legacy?.database_names?.includes("core")), false);
});

test("real recent performance probe retires attached-Core capability before opening databases", async () => {
  await assert.rejects(
    runRealRecentPerformanceProbe({
      coreDbPath: "/does/not/exist/core.sqlite",
      engineDbPath: "/does/not/exist/engine.sqlite",
    }),
    error => error?.code === "LEGACY_ATTACHED_CORE_RETIRED",
  );

  await assert.rejects(
    runRecentPerformanceProbe({ mode: "real" }),
    error => error?.code === "LEGACY_ATTACHED_CORE_RETIRED",
  );
});
