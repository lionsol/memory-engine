import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  buildRuntimeBuildIdentity,
  collectRuntimeBuildFiles,
  ROOT_RUNTIME_FILES,
} from "../lib/version/runtime-build-identity.js";

function fixtureRoot() {
  const root = mkdtempSync(resolve(tmpdir(), "runtime-build-identity-"));
  mkdirSync(resolve(root, "lib"));
  mkdirSync(resolve(root, "docs"));
  mkdirSync(resolve(root, "test"));
  writeFileSync(resolve(root, "index.js"), "export const entry = 1;\n");
  writeFileSync(resolve(root, "openclaw.plugin.json"), "{}\n");
  writeFileSync(resolve(root, "package.json"), "{\"type\":\"module\"}\n");
  for (const file of ROOT_RUNTIME_FILES) {
    writeFileSync(resolve(root, file), `export const ${file.replaceAll("-", "_").replace(".js", "")} = 1;\n`);
  }
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
  unlinkSync(resolve(root, "lib/new-runtime.js"));
  const deleted = buildRuntimeBuildIdentity({ rootDir: root });
  assert.notEqual(deleted.identity, changed.identity);
  writeFileSync(resolve(root, "package.json"), "{\"type\":\"module\",\"revision\":2}\n");
  const packageChanged = buildRuntimeBuildIdentity({ rootDir: root });
  assert.notEqual(packageChanged.identity, deleted.identity);
});

test("root runtime dependencies are hashed and required", () => {
  const root = fixtureRoot();
  const initial = buildRuntimeBuildIdentity({ rootDir: root });
  for (const file of ROOT_RUNTIME_FILES) {
    writeFileSync(resolve(root, file), `export const changed = "${file}";\n`);
    const changed = buildRuntimeBuildIdentity({ rootDir: root });
    assert.notEqual(changed.identity, initial.identity, file);
    writeFileSync(resolve(root, file), `export const ${file.replaceAll("-", "_").replace(".js", "")} = 1;\n`);
  }

  const missingPath = ROOT_RUNTIME_FILES[0];
  unlinkSync(resolve(root, missingPath));
  const missing = buildRuntimeBuildIdentity({ rootDir: root });
  assert.equal(missing.valid, false);
  assert.ok(missing.errors.some(error => error.startsWith(`missing_runtime_file:${missingPath}`)));
});

test("root runtime symlinks fail closed and docs/tests remain outside identity", () => {
  const root = fixtureRoot();
  const initial = buildRuntimeBuildIdentity({ rootDir: root });
  writeFileSync(resolve(root, "docs/note.md"), "changed docs\n");
  writeFileSync(resolve(root, "test/fixture.js"), "changed test\n");
  assert.equal(buildRuntimeBuildIdentity({ rootDir: root }).identity, initial.identity);

  const file = ROOT_RUNTIME_FILES[0];
  const source = resolve(root, file);
  const target = resolve(root, "runtime-target.js");
  writeFileSync(target, "export const target = true;\n");
  unlinkSync(source);
  symlinkSync(target, source);
  const symlinked = buildRuntimeBuildIdentity({ rootDir: root });
  assert.equal(symlinked.valid, false);
  assert.ok(symlinked.errors.includes(`runtime_symlink_not_allowed:${file}`));
});

test("missing required entries are explicit invalid results", () => {
  const root = fixtureRoot();
  for (const file of ["index.js", "openclaw.plugin.json", "package.json"]) {
    unlinkSync(resolve(root, file));
    const missing = buildRuntimeBuildIdentity({ rootDir: root });
    assert.equal(missing.valid, false, file);
    assert.ok(missing.errors.some(error => error.startsWith(`missing_required_file:${file}`)), file);
    writeFileSync(resolve(root, file), file === "index.js" ? "export const entry = 1;\n" : "{}\n");
  }
});

test("required and runtime-scope symlinks fail closed", () => {
  const root = fixtureRoot();
  for (const file of ["index.js", "openclaw.plugin.json", "package.json"]) {
    const source = resolve(root, file);
    const target = resolve(root, `target-${file}`);
    writeFileSync(target, readFileForTest(source));
    unlinkSync(source);
    symlinkSync(target, source);
    const result = buildRuntimeBuildIdentity({ rootDir: root });
    assert.equal(result.valid, false, file);
    assert.ok(result.errors.some(error => error.startsWith(`missing_required_file:${file}`)), file);
    unlinkSync(source);
    writeFileSync(source, file === "index.js" ? "export const entry = 1;\n" : "{}\n");
  }

  const internalFileTarget = resolve(root, "lib/internal-target.js");
  writeFileSync(internalFileTarget, "export const internal = 1;\n");
  symlinkSync(internalFileTarget, resolve(root, "lib/internal-link.js"));
  const internalFile = buildRuntimeBuildIdentity({ rootDir: root });
  assert.equal(internalFile.valid, false);
  assert.ok(internalFile.errors.some(error => error === "runtime_symlink_not_allowed:lib/internal-link.js"));

  const outside = mkdtempSync(resolve(tmpdir(), "runtime-build-outside-"));
  writeFileSync(resolve(outside, "escaped.js"), "export const escaped = true;\n");
  symlinkSync(resolve(outside, "escaped.js"), resolve(root, "lib/escaped.js"));
  const escaped = buildRuntimeBuildIdentity({ rootDir: root });
  assert.equal(escaped.valid, false);
  assert.ok(escaped.errors.some(error => error.startsWith("symlink_escapes_root:")));

  const outsideDirectory = mkdtempSync(resolve(tmpdir(), "runtime-build-outside-dir-"));
  writeFileSync(resolve(outsideDirectory, "nested.js"), "export const nested = true;\n");
  symlinkSync(outsideDirectory, resolve(root, "lib/escaped-directory"), "dir");
  const escapedDirectory = buildRuntimeBuildIdentity({ rootDir: root });
  assert.equal(escapedDirectory.valid, false);
  assert.ok(escapedDirectory.errors.some(error => error.startsWith("symlink_escapes_root:lib/escaped-directory")));
});

function readFileForTest(path) {
  return path.endsWith("index.js") ? "export const entry = 1;\n" : "{}\n";
}
