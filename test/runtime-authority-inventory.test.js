import test from "node:test";
import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, linkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { buildTypedEntryInventory, compareTypedEntryInventories } from "../lib/runtime-authority/inventory.js";
import { copyTreePreservingHardlinks } from "../lib/runtime-authority/owned-root.js";

function candidateFixture() {
  const root = mkdtempSync(join("/tmp", "runtime-authority-inventory-"));
  mkdirSync(join(root, "node_modules", ".bin"), { recursive: true, mode: 0o700 });
  mkdirSync(join(root, "node_modules", "pkg", "bin"), { recursive: true, mode: 0o700 });
  writeFileSync(join(root, "node_modules", "pkg", "bin", "cli.js"), "#!/usr/bin/env node\n", { mode: 0o500 });
  writeFileSync(join(root, "node_modules", "pkg", "bin", "other.js"), "module.exports=1;\n", { mode: 0o500 });
  for (const name of ["cli", "pkg-cli", "tool", "tool-alt"]) symlinkSync("../pkg/bin/cli.js", join(root, "node_modules", ".bin", name));
  writeFileSync(join(root, "node_modules", "pkg", "hard-a"), "hardlink\n", { mode: 0o400 });
  linkSync(join(root, "node_modules", "pkg", "hard-a"), join(root, "node_modules", "pkg", "hard-b"));
  return root;
}

test("typed candidate inventory accepts npm-style internal symlinks and hardlink topology", () => {
  const root = candidateFixture();
  try {
    const inventory = buildTypedEntryInventory(root);
    assert.equal(inventory.entries.filter(entry => entry.type === "symlink").length, 4);
    assert.ok(inventory.hardlink_groups.some(group => group.paths.length === 2));
    assert.equal(compareTypedEntryInventories(inventory, JSON.parse(JSON.stringify(inventory))), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("typed inventory rejects external, dangling, tampered symlinks and empty directories", () => {
  const root = candidateFixture();
  try {
    const external = join(root, "node_modules", ".bin", "external");
    symlinkSync("/tmp", external);
    assert.throws(() => buildTypedEntryInventory(root), /external_symlink/);
    unlinkSync(external);
    const buildLinks = join(root, "node_modules", "better-sqlite3", "build", "node_gyp_bins");
    mkdirSync(buildLinks, { recursive: true, mode: 0o700 });
    symlinkSync("/usr/bin/python3", join(buildLinks, "python3"));
    assert.throws(() => buildTypedEntryInventory(root), /external_symlink/);
    rmSync(join(root, "node_modules", "better-sqlite3"), { recursive: true, force: true });
    const dangling = join(root, "node_modules", ".bin", "dangling");
    symlinkSync("../missing", dangling);
    assert.throws(() => buildTypedEntryInventory(root), /dangling_symlink/);
    unlinkSync(dangling);
    const before = buildTypedEntryInventory(root);
    unlinkSync(join(root, "node_modules", ".bin", "tool-alt"));
    symlinkSync("../pkg/bin/other.js", join(root, "node_modules", ".bin", "tool-alt"));
    const after = buildTypedEntryInventory(root);
    assert.equal(compareTypedEntryInventories(before, after), false);
    mkdirSync(join(root, "empty"));
    assert.throws(() => buildTypedEntryInventory(root), /unexpected empty directory/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("typed inventory contains regular file size/hash and symlink resolution state", () => {
  const root = candidateFixture();
  try {
    const inventory = buildTypedEntryInventory(root);
    const file = inventory.entries.find(entry => entry.path.endsWith("cli.js"));
    const link = inventory.entries.find(entry => entry.path.endsWith("/.bin/cli"));
    assert.equal(file.size, readFileSync(join(root, file.path)).byteLength);
    assert.match(file.sha256, /^[0-9a-f]{64}$/);
    assert.equal(link.resolved_within_root, true);
    assert.equal(link.symlink_resolution_state, "within_root");
    assert.equal(lstatSync(join(root, link.path)).isSymbolicLink(), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("owned R0 copy preserves internal hardlink topology", () => {
  const source = candidateFixture();
  const destination = mkdtempSync(join("/tmp", "runtime-authority-r0-copy-"));
  try {
    copyTreePreservingHardlinks(source, destination);
    const sourceInventory = buildTypedEntryInventory(source);
    const destinationInventory = buildTypedEntryInventory(destination);
    assert.equal(compareTypedEntryInventories(sourceInventory, destinationInventory), true);
  } finally { rmSync(source, { recursive: true, force: true }); rmSync(destination, { recursive: true, force: true }); }
});
