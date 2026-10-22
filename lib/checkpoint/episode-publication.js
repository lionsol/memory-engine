const fs = require("node:fs");
const { dirname } = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

function snapshotEpisode(path) {
  try {
    const stat = fs.lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("episode_not_regular");
    const bytes = fs.readFileSync(path);
    return Object.freeze({ exists: true, hash: createHash("sha256").update(bytes).digest("hex"),
      dev: stat.dev, ino: stat.ino, mode: stat.mode, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });
  } catch (error) {
    if (error.code === "ENOENT") return Object.freeze({ exists: false });
    throw error;
  }
}
function sameSnapshot(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function durableWrite(path, content, mode = 0o600) {
  const fd = fs.openSync(path, "wx", mode);
  try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

// Lock coordinates product writers; hash + inode/ctime detects observed external
// edits. POSIX rename is atomic but not CAS: non-cooperating writers can race the
// last check. Do not claim filesystem-wide exclusion or cross-store atomicity.
function publishEpisode(path, content, { expected = snapshotEpisode(path), unchanged = () => true, beforeCommit = () => {} } = {}) {
  fs.mkdirSync(dirname(path), { recursive: true });
  const lock = path + ".checkpoint.lock";
  const token = randomUUID();
  const temp = path + "." + token + ".tmp";
  const backup = path + "." + token + ".previous";
  const fd = fs.openSync(lock, "wx", 0o600);
  const result = { path, backup: null, published: false, cleanup_complete: true, cleanup_errors: [],
    protection: "cooperative_lock_version_check_atomic_publish" };
  let failure;
  try {
    if (!sameSnapshot(expected, snapshotEpisode(path))) throw new Error("episode_version_changed");
    if (!unchanged()) throw new Error("source_version_changed");
    durableWrite(temp, content, expected.exists ? expected.mode & 0o777 : 0o600);
    if (expected.exists) {
      durableWrite(backup, fs.readFileSync(path));
      result.backup = backup;
    }
    if (!unchanged()) throw new Error("source_version_changed");
    if (!sameSnapshot(expected, snapshotEpisode(path))) throw new Error("episode_version_changed");
    beforeCommit();
    if (expected.exists) fs.renameSync(temp, path);
    else {
      // No-clobber publication for an initially absent episode.
      fs.linkSync(temp, path);
    }
    result.published = true;
  } catch (error) {
    failure = error;
  } finally {
    // A cleanup error must neither erase the commit fact nor replace the
    // original pre-commit failure. Attempt every cleanup operation independently.
    for (const [operation, cleanup] of [
      ["remove_temp", () => { if (fs.existsSync(temp)) fs.unlinkSync(temp); }],
      ["close_lock", () => fs.closeSync(fd)],
      ["remove_lock", () => fs.unlinkSync(lock)],
    ]) {
      try { cleanup(); } catch (error) {
        result.cleanup_complete = false;
        result.cleanup_errors.push({ operation, code: error.code || "unknown" });
      }
    }
  }
  if (failure) {
    failure.publication = result;
    throw failure;
  }
  return result;
}
module.exports = { snapshotEpisode, publishEpisode };
