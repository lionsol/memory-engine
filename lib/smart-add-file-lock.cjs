const {
  mkdirSync,
  rmSync,
  statSync,
} = require("node:fs");

const SMART_ADD_FILE_LOCK_TIMEOUT = "SMART_ADD_FILE_LOCK_TIMEOUT";
const DEFAULT_WAIT_MS = 2000;
const DEFAULT_RETRY_MS = 10;
const DEFAULT_STALE_MS = 30000;
const SLEEP_CELL = new Int32Array(new SharedArrayBuffer(4));

function sleepSync(ms) {
  if (ms <= 0) return;
  Atomics.wait(SLEEP_CELL, 0, 0, ms);
}

function lockPathFor(filePath) {
  return `${filePath}.memory-engine.lock`;
}

function removeStaleLock(lockPath, staleMs, now = Date.now()) {
  try {
    const ageMs = now - statSync(lockPath).mtimeMs;
    if (ageMs <= staleMs) return false;
    rmSync(lockPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    return false;
  }
}

function acquireSmartAddFileLock(filePath, options = {}) {
  const waitMs = Number.isFinite(options.waitMs) ? Math.max(0, options.waitMs) : DEFAULT_WAIT_MS;
  const retryMs = Number.isFinite(options.retryMs) ? Math.max(1, options.retryMs) : DEFAULT_RETRY_MS;
  const staleMs = Number.isFinite(options.staleMs) ? Math.max(1000, options.staleMs) : DEFAULT_STALE_MS;
  const lockPath = lockPathFor(filePath);
  const startedAt = Date.now();

  while (true) {
    try {
      mkdirSync(lockPath);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        rmSync(lockPath, { recursive: true, force: true });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      removeStaleLock(lockPath, staleMs);
      if (Date.now() - startedAt >= waitMs) {
        const timeout = new Error("smart-add file lock timed out");
        timeout.code = SMART_ADD_FILE_LOCK_TIMEOUT;
        throw timeout;
      }
      sleepSync(retryMs);
    }
  }
}

function withSmartAddFileLock(filePath, fn, options = {}) {
  const release = acquireSmartAddFileLock(filePath, options);
  try {
    return fn();
  } finally {
    release();
  }
}

module.exports = {
  SMART_ADD_FILE_LOCK_TIMEOUT,
  acquireSmartAddFileLock,
  lockPathFor,
  withSmartAddFileLock,
};
