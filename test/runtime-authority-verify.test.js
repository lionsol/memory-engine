import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prepareRuntimeAuthority } from "../lib/runtime-authority/prepare.js";
import { verifyAuthority } from "../lib/runtime-authority/verify.js";
import { claimPath } from "../lib/runtime-authority/evidence.js";
import { fakeToolInspector, makeFixture, successfulHooks, writePlan } from "./runtime-authority-fixtures.js";

test("verify never treats an incomplete injected authority as self-verifying", async () => {
  const fixture = makeFixture();
  try {
    writePlan(fixture);
    await assert.rejects(() => prepareRuntimeAuthority({ planPath: fixture.planPath, toolInspector: fakeToolInspector, hooks: successfulHooks(), sandbox: { probe: () => ({ available: true }) } }), /authority completeness/);
    assert.equal(existsSync(join(fixture.plan.persistent_parent, fixture.plan.run_id)), false);
    assert.equal(JSON.parse(readFileSync(claimPath(fixture.plan.persistent_parent, fixture.plan.run_id), "utf8")).outcome, "FAILED");
  } finally { fixture.cleanup(); }
});

test("verify rejects non-directory or symlink authority roots", () => {
  const fixture = makeFixture();
  try {
    writePlan(fixture);
    assert.throws(() => verifyAuthority({ authorityRoot: fixture.planPath }), /authority root/);
    const linked = join(fixture.root, "linked-authority");
    symlinkSync(fixture.planPath, linked);
    assert.throws(() => verifyAuthority({ authorityRoot: linked }), /authority root/);
  } finally { fixture.cleanup(); }
});

test("verify rejects an authority with missing role-bearing sections", () => {
  const fixture = makeFixture();
  const authorityRoot = join(fixture.plan.persistent_parent, fixture.plan.run_id);
  try {
    mkdirSync(authorityRoot, { recursive: true, mode: 0o700 });
    writeFileSync(join(authorityRoot, "authority.json"), JSON.stringify({ schema: "memory-engine-runtime-authority-v1", published: true }), { mode: 0o600 });
    assert.throws(() => verifyAuthority({ authorityRoot }), /authority key set mismatch|authority completeness/);
  } finally { fixture.cleanup(); }
});
