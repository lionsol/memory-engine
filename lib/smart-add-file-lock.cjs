const {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");

const SMART_ADD_FILE_LOCK_TIMEOUT = "SMART_ADD_FILE_LOCK_TIMEOUT";
const DEFAULT_WAIT_MS = 2000;
const DEFAULT_RETRY_MS = 10;
const DEFAULT_STALE_MS = 30000;
const OWNER_FILE_PREFIX = "owner-";
const CLAIM_FILE_PREFIX = "claim-";
const RECORD_FILE_SUFFIX = ".json";
const SLEEP_CELL = new Int32Array(new SharedArrayBuffer(4));

function sleepSync(ms) {
  if (ms <= 0) return;
  Atomics.wait(SLEEP_CELL, 0, 0, ms);
}

function lockPathFor(filePath) {
  return `${filePath}.memory-engine.lock`;
}

function recordPath(lockPath, prefix, token) {
  return join(lockPath, `${prefix}${token}${RECORD_FILE_SUFFIX}`);
}

function ownerPathFor(lockPath, token) {
  return recordPath(lockPath, OWNER_FILE_PREFIX, token);
}

function claimPathFor(lockPath, token) {
  return recordPath(lockPath, CLAIM_FILE_PREFIX, token);
}

function readLockRecord(lockPath) {
  let names;
  try {
    names = readdirSync(lockPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }

  const owners = names.filter(name => name.startsWith(OWNER_FILE_PREFIX) && name.endsWith(RECORD_FILE_SUFFIX));
  const claims = names.filter(name => name.startsWith(CLAIM_FILE_PREFIX) && name.endsWith(RECORD_FILE_SUFFIX));
  let state;
  let name;
  let prefix;
  if (owners.length === 1 && claims.length === 0) {
    state = "owner";
    name = owners[0];
    prefix = OWNER_FILE_PREFIX;
  } else if (owners.length === 0 && claims.length === 1) {
    state = "claim";
    name = claims[0];
    prefix = CLAIM_FILE_PREFIX;
  } else {
    return null;
  }

  const token = name.slice(prefix.length, -RECORD_FILE_SUFFIX.length);
  const path = join(lockPath, name);
  let metadata = null;
  try {
    metadata = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // The record filename remains the identity even if diagnostics metadata is damaged.
  }
  let mtimeMs;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  return {
    metadata,
    mtimeMs,
    path,
    state,
    token,
  };
}

function isValidOwnerMetadata(record) {
  return record?.state === "owner"
    && record.metadata
    && typeof record.metadata === "object"
    && record.metadata.token === record.token
    && Number.isSafeInteger(Number(record.metadata.pid))
    && Number(record.metadata.pid) > 0;
}

function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "EPERM") return true;
    if (error?.code === "ESRCH") return false;
    return true;
  }
}

function lockAgeMs(lockPath, now = Date.now()) {
  try {
    const record = readLockRecord(lockPath);
    if (record && Number.isFinite(record.mtimeMs)) return Math.max(0, now - record.mtimeMs);
    return Math.max(0, now - statSync(lockPath).mtimeMs);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return null;
  }
}

function claimExactRecord(lockPath, record) {
  const claimPath = claimPathFor(lockPath, randomUUID());
  try {
    renameSync(record.path, claimPath);
    return claimPath;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function finishClaimedLock(lockPath, record) {
  const claimPath = claimExactRecord(lockPath, record);
  if (!claimPath) return false;
  rmSync(lockPath, { recursive: true, force: true });
  return true;
}

function tryReclaimStaleLock(lockPath, staleMs, now = Date.now()) {
  const record = readLockRecord(lockPath);
  if (!record) return false;

  // A claim marker means the protected critical section is already over and a
  // previous holder/reaper only failed to finish directory removal. Any waiter
  // may atomically claim that exact marker and complete the cleanup.
  if (record.state === "claim") return finishClaimedLock(lockPath, record);

  const ageMs = Math.max(0, now - record.mtimeMs);
  if (ageMs <= staleMs) return false;
  if (!isValidOwnerMetadata(record)) return false;
  const ownerPid = Number(record.metadata.pid);
  if (isProcessAlive(ownerPid)) return false;

  const claimPath = claimExactRecord(lockPath, record);
  if (!claimPath) return false;
  rmSync(lockPath, { recursive: true, force: true });
  return true;
}

function createLease(filePath, lockPath) {
  const token = randomUUID();
  const pendingPath = `${lockPath}.pending-${process.pid}-${token}`;
  mkdirSync(pendingPath);
  try {
    writeFileSync(ownerPathFor(pendingPath, token), JSON.stringify({
      token,
      pid: process.pid,
      createdAt: new Date().toISOString(),
    }), { encoding: "utf8", flag: "wx" });

    // Never replace a legacy/foreign directory. Current-version locks are
    // published only after their owner marker exists, so an acquired lock is
    // visible atomically as a complete directory.
    if (existsSync(lockPath)) return null;
    try {
      renameSync(pendingPath, lockPath);
    } catch (error) {
      if (error?.code === "EEXIST" || error?.code === "ENOTEMPTY") return null;
      throw error;
    }
    return {
      filePath,
      lockPath,
      ownerPath: ownerPathFor(lockPath, token),
      released: false,
      token,
    };
  } finally {
    if (existsSync(pendingPath)) rmSync(pendingPath, { recursive: true, force: true });
  }
}

function tryAcquireLease(filePath) {
  const lockPath = lockPathFor(filePath);
  if (existsSync(lockPath)) return null;
  return createLease(filePath, lockPath);
}

function releaseSmartAddFileLock(lease) {
  if (!lease || lease.released) return false;
  lease.released = true;
  const record = {
    path: lease.ownerPath,
    state: "owner",
    token: lease.token,
  };
  const claimPath = claimExactRecord(lease.lockPath, record);
  if (!claimPath) return false;
  rmSync(lease.lockPath, { recursive: true, force: true });
  return true;
}

function lockDiagnostics(lockPath) {
  try {
    const names = readdirSync(lockPath);
    const ownerRecordCount = names.filter(
      name => name.startsWith(OWNER_FILE_PREFIX) && name.endsWith(RECORD_FILE_SUFFIX),
    ).length;
    const claimRecordCount = names.filter(
      name => name.startsWith(CLAIM_FILE_PREFIX) && name.endsWith(RECORD_FILE_SUFFIX),
    ).length;
    const record = readLockRecord(lockPath);
    const recordState = record?.state
      ?? (ownerRecordCount === 0 && claimRecordCount === 0 ? "empty" : "ambiguous");
    return {
      recordState,
      ownerRecordCount,
      claimRecordCount,
      ownerMetadataValid: record?.state === "owner"
        ? isValidOwnerMetadata(record)
        : null,
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        recordState: "missing",
        ownerRecordCount: 0,
        claimRecordCount: 0,
        ownerMetadataValid: null,
      };
    }
    return {
      recordState: "unreadable",
      ownerRecordCount: null,
      claimRecordCount: null,
      ownerMetadataValid: null,
    };
  }
}

function timeoutError(filePath, lockPath, startedAt) {
  const now = Date.now();
  const diagnostics = lockDiagnostics(lockPath);
  const timeout = new Error("smart-add file lock timed out");
  timeout.code = SMART_ADD_FILE_LOCK_TIMEOUT;
  timeout.path = filePath;
  timeout.lockPath = lockPath;
  timeout.waitedMs = Math.max(0, now - startedAt);
  timeout.lockAgeMs = lockAgeMs(lockPath, now);
  timeout.lockRecordState = diagnostics.recordState;
  timeout.lockOwnerRecordCount = diagnostics.ownerRecordCount;
  timeout.lockClaimRecordCount = diagnostics.claimRecordCount;
  timeout.lockOwnerMetadataValid = diagnostics.ownerMetadataValid;
  return timeout;
}

function normalizeOptions(options = {}) {
  return {
    waitMs: Number.isFinite(options.waitMs) ? Math.max(0, options.waitMs) : DEFAULT_WAIT_MS,
    retryMs: Number.isFinite(options.retryMs) ? Math.max(1, options.retryMs) : DEFAULT_RETRY_MS,
    staleMs: Number.isFinite(options.staleMs) ? Math.max(1000, options.staleMs) : DEFAULT_STALE_MS,
  };
}

function acquireSmartAddFileLock(filePath, options = {}) {
  const { waitMs, retryMs, staleMs } = normalizeOptions(options);
  const lockPath = lockPathFor(filePath);
  const startedAt = Date.now();

  while (true) {
    const lease = tryAcquireLease(filePath);
    if (lease) return lease;
    tryReclaimStaleLock(lockPath, staleMs);
    if (Date.now() - startedAt >= waitMs) throw timeoutError(filePath, lockPath, startedAt);
    sleepSync(retryMs);
  }
}

async function acquireSmartAddFileLockAsync(filePath, options = {}) {
  const { waitMs, retryMs, staleMs } = normalizeOptions(options);
  const lockPath = lockPathFor(filePath);
  const startedAt = Date.now();

  while (true) {
    const lease = tryAcquireLease(filePath);
    if (lease) return lease;
    tryReclaimStaleLock(lockPath, staleMs);
    if (Date.now() - startedAt >= waitMs) throw timeoutError(filePath, lockPath, startedAt);
    await delay(retryMs);
  }
}

function withSmartAddFileLock(filePath, fn, options = {}) {
  const lease = acquireSmartAddFileLock(filePath, options);
  try {
    return fn();
  } finally {
    releaseSmartAddFileLock(lease);
  }
}

async function withSmartAddFileLockAsync(filePath, fn, options = {}) {
  const lease = await acquireSmartAddFileLockAsync(filePath, options);
  try {
    return await fn();
  } finally {
    releaseSmartAddFileLock(lease);
  }
}

module.exports = {
  SMART_ADD_FILE_LOCK_TIMEOUT,
  acquireSmartAddFileLock,
  acquireSmartAddFileLockAsync,
  lockPathFor,
  releaseSmartAddFileLock,
  tryReclaimStaleLock,
  withSmartAddFileLock,
  withSmartAddFileLockAsync,
};
