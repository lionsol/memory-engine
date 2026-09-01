import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSmoke, assertSmokeResult } from "../lib/runtime-authority/native-smoke-helper.cjs";
import { assertNativeSmoke } from "../lib/runtime-authority/stage-handlers.js";
import { prepareRuntimeAuthority } from "../lib/runtime-authority/prepare.js";
import { claimPath } from "../lib/runtime-authority/evidence.js";
import { fakeToolInspector, makeFixture, successfulHooks, writePlan } from "./runtime-authority-fixtures.js";

function moduleRoot() {
  const root = mkdtempSync(join(tmpdir(), "runtime-authority-native-smoke-"));
  writeFileSync(join(root, "package.json"), "{}\n", { mode: 0o600 });
  return root;
}

test("missing or unloadable native modules reject the smoke", async () => {
  const root = moduleRoot();
  try {
    await assert.rejects(() => runSmoke({ mode: "sqlite", root, requireModule: () => { const error = new Error("missing"); error.code = "MODULE_NOT_FOUND"; throw error; } }));
    await assert.rejects(() => runSmoke({ mode: "lancedb", root, requireModule: () => { throw new Error("load failure"); } }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("native smoke result contract rejects unavailable and non-ok results", () => {
  for (const result of [null, { ok: true, available: false }, { ok: false, available: true }, { ok: false, available: false }]) {
    assert.throws(() => assertSmokeResult(result, "synthetic"), /did not prove/);
    assert.throws(() => assertNativeSmoke(result, "synthetic"), /did not prove/);
  }
});

test("available=false consumes prepare claim and never publishes final", async () => {
  const fixture = makeFixture();
  try {
    writePlan(fixture);
    const hooks = successfulHooks();
    hooks.CANDIDATE_VERIFIED = () => assertNativeSmoke({ ok: true, available: false }, "candidate sqlite");
    await assert.rejects(() => prepareRuntimeAuthority({ planPath: fixture.planPath, toolInspector: fakeToolInspector, hooks, sandbox: { probe: () => ({ available: true }) } }), /did not prove/);
    assert.equal(existsSync(join(fixture.plan.persistent_parent, fixture.plan.run_id)), false);
    assert.equal(JSON.parse(readFileSync(claimPath(fixture.plan.persistent_parent, fixture.plan.run_id), "utf8")).outcome, "FAILED");
  } finally { fixture.cleanup(); }
});
