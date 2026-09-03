import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  auditIsolatedRecentRolloutReadiness,
  parseArgs,
  usage,
} = require("../bin/audit-isolated-recent-rollout-readiness.js");

test("retired Recent rollout CLI keeps help and parser contracts", async () => {
  assert.match(usage(), /read-only/);
  const parsed = parseArgs([
    "--json",
    "--core-db", "core.sqlite",
    "--engine-db", "engine.sqlite",
    "--query", "alpha",
    "--derive-limit", "10",
    "--warmups", "0",
    "--repetitions", "1",
    "--concurrency-levels", "2,4",
  ]);
  assert.equal(parsed.json, true);
  assert.deepEqual(parsed.queries, ["alpha"]);
  assert.equal(parsed.deriveLimit, 10);
  assert.equal(parsed.warmups, 0);
  assert.equal(parsed.repetitions, 1);
  assert.deepEqual(parsed.concurrencyLevels, [2, 4]);
  const help = await auditIsolatedRecentRolloutReadiness(["--help"]);
  assert.equal(help.exitCode, 0);
  assert.match(help.output, /Usage:/);
});

test("retired Recent rollout CLI fails closed before opening requested databases", async () => {
  await assert.rejects(
    auditIsolatedRecentRolloutReadiness([
      "--query", "alpha",
      "--core-db", "/does/not/exist/core.sqlite",
      "--engine-db", "/does/not/exist/engine.sqlite",
    ]),
    error => error?.code === "LEGACY_ATTACHED_CORE_RETIRED",
  );
});

test("retired Recent rollout CLI still rejects mutation flags during parsing", async () => {
  await assert.rejects(
    auditIsolatedRecentRolloutReadiness(["--apply"]),
    error => String(error?.message || error).includes("read-only"),
  );
});
