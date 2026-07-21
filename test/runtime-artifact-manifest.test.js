import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildRuntimeArtifactManifest } = require("../bin/runtime-artifact-manifest-lib.js");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "runtime-artifact-manifest-"));
  mkdirSync(join(root, "lib"), { mode: 0o700 });
  writeFileSync(join(root, "index.js"), "export default 1;\n", { mode: 0o400 });
  writeFileSync(join(root, "lib", "data.json"), '{"ok":true}\n', { mode: 0o400 });
  linkSync(join(root, "index.js"), join(root, "index-copy.js"));
  symlinkSync("../index.js", join(root, "lib", "index-link.js"));
  chmodSync(join(root, "lib"), 0o500);
  chmodSync(root, 0o500);
  return root;
}

function cleanup(root) {
  chmodSync(root, 0o700);
  chmodSync(join(root, "lib"), 0o700);
  rmSync(root, { recursive: true, force: true });
}

test("artifact identity is deterministic and covers mode, symlink, and hardlink structure", () => {
  const root = fixture();
  try {
    const first = buildRuntimeArtifactManifest({ rootDir: root, checkedAt: "2026-07-21T10:00:00.000Z" });
    const second = buildRuntimeArtifactManifest({ rootDir: root, checkedAt: "2026-07-21T11:00:00.000Z" });
    assert.equal(first.valid, true);
    assert.equal(first.identity, second.identity);
    assert.equal(first.file_count, 3);
    assert.equal(first.directory_count, 2);
    assert.equal(first.symlink_count, 1);
    assert.equal(first.hardlink_group_count, 1);
    assert.equal(first.external_hardlink_reference_count, 0);
    assert.equal(first.external_symlink_count, 0);
    assert.equal(first.writable_file_count, 0);
    assert.equal(first.writable_directory_count, 0);
    assert.equal(first.entries.find(entry => entry.path === "index.js").hardlink_group !== null, true);
    assert.equal(first.entries.find(entry => entry.path === "lib/index-link.js").resolved_within_root, true);
  } finally {
    cleanup(root);
  }
});

test("artifact identity changes on content, mode, and symlink target changes", () => {
  const root = fixture();
  try {
    const initial = buildRuntimeArtifactManifest({ rootDir: root }).identity;
    chmodSync(join(root, "index.js"), 0o600);
    const modeChanged = buildRuntimeArtifactManifest({ rootDir: root });
    assert.notEqual(modeChanged.identity, initial);
    assert.equal(modeChanged.writable_file_count, 2);

    chmodSync(join(root, "lib", "data.json"), 0o600);
    writeFileSync(join(root, "lib", "data.json"), '{"ok":false}\n');
    chmodSync(join(root, "lib", "data.json"), 0o400);
    const contentChanged = buildRuntimeArtifactManifest({ rootDir: root });
    assert.notEqual(contentChanged.identity, modeChanged.identity);

    chmodSync(join(root, "lib"), 0o700);
    rmSync(join(root, "lib", "index-link.js"));
    symlinkSync("data.json", join(root, "lib", "index-link.js"));
    chmodSync(join(root, "lib"), 0o500);
    const targetChanged = buildRuntimeArtifactManifest({ rootDir: root });
    assert.notEqual(targetChanged.identity, contentChanged.identity);
  } finally {
    cleanup(root);
  }
});

test("external symlinks and external hardlink references fail closed", () => {
  const parent = mkdtempSync(join(tmpdir(), "runtime-artifact-boundary-"));
  const root = join(parent, "artifact");
  mkdirSync(root, { mode: 0o700 });
  const outside = join(parent, "outside.txt");
  writeFileSync(outside, "outside\n", { mode: 0o600 });
  symlinkSync(outside, join(root, "outside-link"));
  linkSync(outside, join(root, "outside-hardlink"));
  try {
    const report = buildRuntimeArtifactManifest({ rootDir: root });
    assert.equal(report.valid, false);
    assert.equal(report.identity, null);
    assert.equal(report.external_symlink_count, 1);
    assert.equal(report.external_hardlink_reference_count, 1);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("CLI writes a mode-0600 manifest and rejects unknown arguments", () => {
  const root = fixture();
  const outputRoot = mkdtempSync(join(tmpdir(), "runtime-artifact-output-"));
  const output = join(outputRoot, "manifest.json");
  try {
    const cli = spawnSync(process.execPath, [
      "bin/build-runtime-artifact-manifest.js",
      "--root",
      root,
      "--checked-at",
      "2026-07-21T10:00:00.000Z",
      "--out",
      output,
      "--pretty",
    ], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(existsSync(output), true);
    const report = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(report.valid, true);
    assert.equal(report.checked_at, "2026-07-21T10:00:00.000Z");

    const rejected = spawnSync(process.execPath, [
      "bin/build-runtime-artifact-manifest.js",
      "--unknown",
    ], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /unknown argument/);
  } finally {
    cleanup(root);
    rmSync(outputRoot, { recursive: true, force: true });
  }
});
