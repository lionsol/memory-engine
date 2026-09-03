import test from "node:test";
import assert from "node:assert/strict";

const cliModulePromise = import("../bin/audit-isolated-recent-shadow.js");

test("retired Recent shadow CLI keeps help and parser contracts", async () => {
  const { auditIsolatedRecentShadow, parseArgs, usage } = await cliModulePromise;
  assert.match(usage(), /read-only/);
  const parsed = parseArgs([
    "--json",
    "--core-db", "core.sqlite",
    "--engine-db", "engine.sqlite",
    "--query", "alpha",
    "--derive-limit", "10",
  ]);
  assert.equal(parsed.json, true);
  assert.deepEqual(parsed.queries, ["alpha"]);
  assert.equal(parsed.deriveLimit, 10);
  const help = await auditIsolatedRecentShadow(["--help"]);
  assert.equal(help.exitCode, 0);
  assert.match(help.output, /Usage:/);
});

test("retired Recent shadow CLI fails closed before opening requested databases", async () => {
  const { auditIsolatedRecentShadow } = await cliModulePromise;
  await assert.rejects(
    auditIsolatedRecentShadow([
      "--query", "alpha",
      "--core-db", "/does/not/exist/core.sqlite",
      "--engine-db", "/does/not/exist/engine.sqlite",
    ]),
    error => error?.code === "LEGACY_ATTACHED_CORE_RETIRED",
  );
});

test("retired Recent shadow CLI still rejects mutation flags during parsing", async () => {
  const { auditIsolatedRecentShadow } = await cliModulePromise;
  await assert.rejects(
    auditIsolatedRecentShadow(["--apply"]),
    error => String(error?.message || error).includes("read-only"),
  );
});
