import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFixture } from "./runtime-authority-fixtures.test.js";
import { PathBroker } from "../lib/runtime-authority/path-policy.js";

test("path broker allows bound files and denies session, memory, and source dependencies", () => {
  const fixture = makeFixture();
  try {
    writeFileSync(join(fixture.plan.source_repo, "allowed"), "ok\n");
    const broker = new PathBroker({ allowedRoots: { source: fixture.plan.source_repo, home: fixture.plan.operator_home }, deniedRoots: [join(fixture.plan.operator_home, "sessions"), join(fixture.plan.operator_home, "memory"), join(fixture.plan.source_repo, "node_modules")] });
    assert.doesNotThrow(() => broker.assertRead(join(fixture.plan.source_repo, "allowed"), { type: "file" }));
    assert.throws(() => broker.assertRead(join(fixture.plan.operator_home, "sessions", "canary"), { mustExist: false }), /denied path/);
    assert.throws(() => broker.assertRead(join(fixture.plan.source_repo, "node_modules", "canary"), { mustExist: false }), /denied path/);
    assert.throws(() => broker.assertRead(`${fixture.plan.source_repo}/./allowed`), /path alias/);
  } finally { fixture.cleanup(); }
});

test("path broker rejects ancestor and root symlink escapes", () => {
  const fixture = makeFixture();
  try {
    const outside = join(fixture.root, "outside");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "secret"), "secret\n");
    const link = join(fixture.root, "link-root");
    symlinkSync(outside, link);
    const broker = new PathBroker({ allowedRoots: { link } });
    assert.throws(() => broker.assertRead(join(link, "secret")), /symlink|escape/);
  } finally { fixture.cleanup(); }
});

test("path broker selects the most-specific overlapping root and rejects arbitrary operator paths", () => {
  const fixture = makeFixture();
  try {
    const nested = join(fixture.plan.source_repo, "nested"); mkdirSync(nested); writeFileSync(join(nested, "value"), "ok\n");
    const broker = new PathBroker({ allowedRoots: { broad: fixture.root, specific: fixture.plan.source_repo }, deniedRoots: [fixture.plan.operator_home] });
    assert.equal(broker.rootFor(join(nested, "value"))[0], "specific");
    assert.throws(() => broker.assertRead(join(fixture.plan.operator_home, "arbitrary", "secret"), { mustExist: false }), /denied|unbound path/);
  } finally { fixture.cleanup(); }
});

test("path broker rejects an internal ancestor symlink even when it resolves inside the bound root", () => {
  const fixture = makeFixture();
  try {
    const real = join(fixture.plan.source_repo, "real"); const alias = join(fixture.plan.source_repo, "alias"); mkdirSync(real); writeFileSync(join(real, "value"), "ok\n"); symlinkSync(real, alias);
    const broker = new PathBroker({ allowedRoots: { source: fixture.plan.source_repo } });
    assert.throws(() => broker.assertRead(join(alias, "value")), /ancestor symlink/);
  } finally { fixture.cleanup(); }
});
