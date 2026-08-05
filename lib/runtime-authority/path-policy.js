const {
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  closeSync,
} = require("node:fs");
const { isAbsolute, normalize, relative, resolve, sep } = require("node:path");

function isContained(root, target) {
  return target === root || target.startsWith(`${root}${sep}`);
}

function lexicalPath(path) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0") || path.includes("\\")) throw new Error("absolute normalized path required");
  if (normalize(path) !== path || (path.length > 1 && path.endsWith("/")) || path.startsWith("//")) throw new Error("path alias rejected");
  return path;
}

function ancestorPaths(path) {
  const result = [];
  let current = resolve(path);
  while (current && current !== sep) {
    result.push(current);
    current = resolve(current, "..");
  }
  result.push(sep);
  return result.reverse();
}

class PathBroker {
  constructor({ allowedRoots = {}, deniedRoots = [], fs = null } = {}) {
    this.allowedRoots = Object.fromEntries(Object.entries(allowedRoots).map(([key, value]) => [key, lexicalPath(value)]));
    this.deniedRoots = deniedRoots.map(lexicalPath);
    this.fs = fs || {
      lstatSync, realpathSync, readFileSync, mkdirSync, openSync, closeSync,
    };
  }

  isDenied(path) {
    return this.deniedRoots.some(root => isContained(root, path));
  }

  rootFor(path) {
    return Object.entries(this.allowedRoots)
      .filter(([, root]) => isContained(root, path))
      .sort((left, right) => right[1].length - left[1].length)[0] || null;
  }

  checkAncestorSymlinks(path, stopAt) {
    const ancestors = ancestorPaths(path);
    for (const ancestor of ancestors) {
      if (ancestor === path) continue;
      let stats;
      try { stats = this.fs.lstatSync(ancestor); } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (stats.isSymbolicLink()) throw new Error(`ancestor symlink rejected:${ancestor}`);
      if (stats.isFile() && ancestor !== path) throw new Error(`file ancestor rejected:${ancestor}`);
    }
  }

  assert(path, { kind = "read", mustExist = true, type = null, root = null } = {}) {
    const lexical = lexicalPath(path);
    if (this.isDenied(lexical)) throw new Error(`denied path:${lexical}`);
    const selected = root ? [root, this.allowedRoots[root]] : this.rootFor(lexical);
    if (!selected || !selected[1] || !isContained(selected[1], lexical)) throw new Error(`unbound path:${lexical}`);
    const boundRoot = selected[1];
    try {
      const boundStats = this.fs.lstatSync(boundRoot);
      if (boundStats.isSymbolicLink()) throw new Error(`root symlink rejected:${boundRoot}`);
    } catch (error) {
      if (error.code !== "ENOENT" || mustExist) throw error;
    }
    this.checkAncestorSymlinks(lexical, boundRoot);
    if (mustExist) {
      const stats = this.fs.lstatSync(lexical);
      if (stats.isSymbolicLink()) throw new Error(`root or target symlink rejected:${lexical}`);
      if (type === "file" && !stats.isFile()) throw new Error(`regular file required:${lexical}`);
      if (type === "directory" && !stats.isDirectory()) throw new Error(`directory required:${lexical}`);
      if (type === "executable" && (!stats.isFile() || (stats.mode & 0o111) === 0)) throw new Error(`executable required:${lexical}`);
      if (stats.isFIFO() || stats.isSocket() || stats.isBlockDevice() || stats.isCharacterDevice()) throw new Error(`special file rejected:${lexical}`);
      const real = this.fs.realpathSync(lexical);
      const rootReal = this.fs.realpathSync(boundRoot);
      if (!isContained(rootReal, real)) throw new Error(`realpath escape:${lexical}`);
    } else {
      const existingParent = ancestorPaths(lexical).reverse().find(candidate => {
        try { this.fs.lstatSync(candidate); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
      });
      if (existingParent) {
        const realParent = this.fs.realpathSync(existingParent);
        const rootReal = this.fs.realpathSync(boundRoot);
        if (!isContained(rootReal, realParent)) throw new Error(`write parent escape:${lexical}`);
      }
    }
    if (kind === "write" && !["write", "create", "archive-destination", "sandbox-exposure"].includes(kind)) throw new Error("invalid write operation");
    return lexical;
  }

  assertRead(path, options = {}) { return this.assert(path, { ...options, kind: "read" }); }
  assertWrite(path, options = {}) { return this.assert(path, { ...options, kind: "write", mustExist: options.mustExist ?? false }); }
  assertExecutable(path) { return this.assert(path, { kind: "executable", type: "executable" }); }

  readFile(path, options = {}) { return this.fs.readFileSync(this.assertRead(path, { ...options, type: "file" })); }

  ensureDirectory(path, mode = 0o700, root = null) {
    this.assertWrite(path, { type: null, mustExist: false, root });
    mkdirSync(path, { recursive: true, mode });
    this.assert(path, { kind: "write", mustExist: true, type: "directory", root });
  }

  atomicCreate(path, bytes, mode = 0o600) {
    this.assertWrite(path, { mustExist: false });
    const fd = this.fs.openSync(path, "wx", mode);
    try { require("node:fs").writeFileSync(fd, bytes); } finally { this.fs.closeSync(fd); }
  }

  atomicRename(source, destination, options = {}) {
    this.assert(source, { ...options, kind: "write", mustExist: true });
    this.recheckBeforeMutation(destination, { ...options, mustExist: false });
    require("node:fs").renameSync(source, destination);
    return destination;
  }

  recheckBeforeMutation(path, options = {}) {
    const value = this.assert(path, { ...options, kind: "write" });
    if (options.mustExist === false) this.assert(path, { ...options, kind: "write", mustExist: false });
    return value;
  }

  validateOwnedParent(path) {
    const lexical = lexicalPath(path);
    if (this.isDenied(lexical)) throw new Error(`denied path:${lexical}`);
    const existing = [];
    for (const ancestor of ancestorPaths(lexical)) {
      try { existing.push([ancestor, this.fs.lstatSync(ancestor)]); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    for (const [ancestor, stats] of existing) {
      if (stats.isSymbolicLink()) throw new Error(`owned parent ancestor symlink rejected:${ancestor}`);
      if (!stats.isDirectory()) throw new Error(`owned parent ancestor not directory:${ancestor}`);
    }
    const current = existing.find(([ancestor]) => ancestor === lexical);
    if (current) {
      if (typeof process.getuid === "function" && current[1].uid !== process.getuid()) throw new Error(`owned parent owner mismatch:${lexical}`);
      if ((current[1].mode & 0o077) !== 0) throw new Error(`owned parent permissions mismatch:${lexical}`);
    }
    return lexical;
  }
}

module.exports = { PathBroker, isContained, lexicalPath };
