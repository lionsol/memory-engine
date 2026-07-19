import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  buildRuntimeBuildIdentity,
  collectRuntimeBuildFiles,
} from "../lib/version/runtime-build-identity.js";

function fixtureRoot() {
  const root = mkdtempSync(resolve(tmpdir(), "runtime-build-identity-"));
  mkdirSync(resolve(root, "lib"));
  mkdirSync(resolve(root, "docs"));
  mkdirSync(resolve(root, "test"));
  writeFileSync(resolve(root, "index.js"), "export const entry = 1;\n");
  writeFileSync(resolve(root, "openclaw.plugin.json"), "{}\n");
  writeFileSync(resolve(root, "package.json"), "{\"type\":\"module\"}\n");
  writeFileSync(resolve(root, "lib/runtime.js"), "export const runtime = 1;\n");
  writeFileSync(resolve(root, "docs/note.md"), "docs\n");
  writeFileSync(resolve(root, "test/fixture.js"), "test\n");
  return root;
}

test("runtime identity is stable across traversal order and ignores docs/tests", () => {
  const root = fixtureRoot();
  const first = buildRuntimeBuildIdentity({ rootDir: root });
  const collected = collectRuntimeBuildFiles({ rootDir: root });
  const second = buildRuntimeBuildIdentity({ rootDir: root, fileEntries: [...collected.entries].reverse() });
  assert.equal(first.valid, true);
  assert.equal(first.identity, second.identity);
  writeFileSync(resolve(root, "docs/note.md"), "changed docs\n");
  writeFileSync(resolve(root, "test/fixture.js"), "changed test\n");
  assert.equal(buildRuntimeBuildIdentity({ rootDir: root }).identity, first.identity);
});

test("runtime file additions, changes, and deletions change identity", () => {
  const root = fixtureRoot();
  const initial = buildRuntimeBuildIdentity({ rootDir: root });
  writeFileSync(resolve(root, "lib/new-runtime.js"), "export const added = true;\n");
  const added = buildRuntimeBuildIdentity({ rootDir: root });
  assert.notEqual(added.identity, initial.identity);
  writeFileSync(resolve(root, "lib/runtime.js"), "export const runtime = 2;\n");
  const changed = buildRuntimeBuildIdentity({ rootDir: root });
  assert.notEqual(changed.identity, added.identity);
});

test("missing required entry and escaping symlink are explicit invalid results", () => {
  const root = fixtureRoot();
  writeFileSync(resolve(root, "index.js"), "");
  const missing = buildRuntimeBuildIdentity({
    rootDir: root,
    fileEntries: [{ path: "openclaw.plugin.json", content: "{}" }],
  });
  assert.equal(missing.valid, false);
  assert.ok(missing.errors.some(error => error.startsWith("missing_required_file:index.js")));

  const outside = mkdtempSync(resolve(tmpdir(), "runtime-build-outside-"));
  writeFileSync(resolve(outside, "escaped.js"), "export const escaped = true;\n");
  symlinkSync(resolve(outside, "escaped.js"), resolve(root, "lib/escaped.js"));
  const escaped = buildRuntimeBuildIdentity({ rootDir: root });
  assert.equal(escaped.valid, false);
  assert.ok(escaped.errors.some(error => error.startsWith("symlink_escapes_root:")));
});
