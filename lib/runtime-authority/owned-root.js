const {
  chmodSync, copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync,
} = require("node:fs");
const { dirname, join, relative } = require("node:path");

function ensureDirectoryMode(path, mode = 0o700) {
  mkdirSync(path, { recursive: true, mode });
  chmodSync(path, mode);
  return path;
}

function copyTreePreservingHardlinks(source, destination, { sourceRoot = source, inodeMap = new Map() } = {}) {
  const stats = lstatSync(source);
  if (stats.isSymbolicLink()) {
    symlinkSync(require("node:fs").readlinkSync(source), destination);
    return;
  }
  if (stats.isDirectory()) {
    try {
      const destinationStats = lstatSync(destination);
      if (!destinationStats.isDirectory() || destinationStats.isSymbolicLink()) throw new Error(`owned copy destination is not directory:${destination}`);
    } catch (error) {
      if (error.code === "ENOENT") mkdirSync(destination, { mode: stats.mode & 0o7777 });
      else throw error;
    }
    chmodSync(destination, stats.mode & 0o7777);
    for (const entry of readdirSync(source)) copyTreePreservingHardlinks(join(source, entry), join(destination, entry), { sourceRoot, inodeMap });
    return;
  }
  if (!stats.isFile()) throw new Error(`owned copy rejects special entry:${relative(sourceRoot, source)}`);
  const key = `${stats.dev}:${stats.ino}`;
  const existing = inodeMap.get(key);
  if (existing) require("node:fs").linkSync(existing, destination);
  else { copyFileSync(source, destination); inodeMap.set(key, destination); }
  chmodSync(destination, stats.mode & 0o7777);
}

function makeRemovable(path) {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink()) return;
  chmodSync(path, (stats.mode & 0o7777) | 0o700);
  if (stats.isDirectory()) for (const entry of readdirSync(path, { withFileTypes: true })) makeRemovable(join(path, entry.name));
}

class OwnedRoot {
  constructor({ root, broker, rootKey = "persistent_parent" } = {}) {
    this.root = root;
    this.broker = broker;
    this.rootKey = rootKey;
    this.broker.assertRead(root, { root: rootKey, type: "directory" });
  }

  path(path) {
    this.broker.assertRead(path, { root: this.rootKey });
    if (!(path === this.root || path.startsWith(`${this.root}/`))) throw new Error(`owned root escape:${path}`);
    return path;
  }

  mutation(path, { mustExist = false, type = null } = {}) {
    this.broker.recheckBeforeMutation(path, { root: this.rootKey, mustExist, type });
    if (!(path === this.root || path.startsWith(`${this.root}/`))) throw new Error(`owned root escape:${path}`);
    return path;
  }

  mkdir(path, mode = 0o700) { this.mutation(path); return ensureDirectoryMode(path, mode); }
  write(path, bytes, mode = 0o600) { this.mutation(path); ensureDirectoryMode(dirname(path)); writeFileSync(path, bytes, { mode }); chmodSync(path, mode); return path; }
  copyFile(source, destination, mode = null) {
    this.broker.assertRead(source, { root: this.broker.rootFor(source)?.[0] || undefined, type: "file" });
    this.mutation(destination);
    ensureDirectoryMode(dirname(destination));
    copyFileSync(source, destination);
    if (mode !== null) chmodSync(destination, mode);
    return destination;
  }
  copyTree(source, destination) { this.broker.assertRead(source, { type: "directory" }); this.mutation(destination); copyTreePreservingHardlinks(source, destination); return destination; }
  rename(source, destination) { this.mutation(source, { mustExist: true }); this.mutation(destination); renameSync(source, destination); return destination; }
  publish(destination) {
    if (typeof this.broker.validateOwnedParent === "function") this.broker.validateOwnedParent(destination);
    this.broker.recheckBeforeMutation(destination, { root: this.rootKey, mustExist: false });
    if (destination === this.root || !destination.startsWith(`${this.root.slice(0, this.root.lastIndexOf("/"))}/`)) throw new Error(`owned publication escape:${destination}`);
    renameSync(this.root, destination);
    return destination;
  }
  remove(path) { this.mutation(path, { mustExist: true }); makeRemovable(path); rmSync(path, { recursive: true, force: true }); }
  chmod(path, mode) { this.mutation(path, { mustExist: true }); chmodSync(path, mode); }
  freeze(path) {
    this.mutation(path, { mustExist: true });
    chmodSync(path, lstatSync(path).mode & ~0o222);
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) this.freeze(child);
      else if (entry.isFile()) this.chmod(child, lstatSync(child).mode & ~0o222);
    }
  }
}

function validatePersistentParent(broker, path) {
  if (typeof broker.validateOwnedParent === "function") return broker.validateOwnedParent(path);
  broker.recheckBeforeMutation(path, { root: "persistent_parent", mustExist: false });
  return path;
}

function createOwnedDirectory(path, broker, { mode = 0o700, root = "persistent_parent" } = {}) {
  broker.recheckBeforeMutation(path, { root, mustExist: false });
  mkdirSync(path, { recursive: false, mode });
  chmodSync(path, mode);
  broker.assertRead(path, { root, type: "directory" });
  return path;
}

module.exports = { OwnedRoot, ensureDirectoryMode, copyTreePreservingHardlinks, validatePersistentParent, createOwnedDirectory, makeRemovable };
