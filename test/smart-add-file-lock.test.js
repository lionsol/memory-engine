import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import smartAddFileLock from "../lib/smart-add-file-lock.cjs";

const {
  SMART_ADD_FILE_LOCK_TIMEOUT,
  acquireSmartAddFileLock,
  acquireSmartAddFileLockAsync,
  lockPathFor,
  releaseSmartAddFileLock,
  tryReclaimStaleLock,
  withSmartAddFileLock,
} = smartAddFileLock;

function makeTarget() {
  const dir = mkdtempSync(resolve(tmpdir(), "memory-engine-lock-"));
  return {
    dir,
    filePath: resolve(dir, "smart-add.md"),
  };
}

function ownerFilePath(lockPath) {
  const ownerNames = readdirSync(lockPath).filter(name => /^owner-.+\.json$/u.test(name));
  assert.equal(ownerNames.length, 1);
  return resolve(lockPath, ownerNames[0]);
}

test("smart-add lock releases its owner marker when callback throws", () => {
  const { dir, filePath } = makeTarget();
  try {
    assert.throws(
      () => withSmartAddFileLock(filePath, () => { throw new Error("boom"); }),
      /boom/,
    );
    assert.equal(existsSync(lockPathFor(filePath)), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dead stale owner is reclaimed through its exact owner marker", () => {
  const { dir, filePath } = makeTarget();
  const lease = acquireSmartAddFileLock(filePath);
  const lockPath = lockPathFor(filePath);
  try {
    const ownerPath = ownerFilePath(lockPath);
    const metadata = JSON.parse(readFileSync(ownerPath, "utf8"));
    metadata.pid = 99999999;
    writeFileSync(ownerPath, JSON.stringify(metadata));
    const old = new Date(Date.now() - 5000);
    utimesSync(ownerPath, old, old);

    assert.equal(tryReclaimStaleLock(lockPath, 1000), true);
    assert.equal(existsSync(lockPath), false);
  } finally {
    releaseSmartAddFileLock(lease);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("live stale owner is never reclaimed", () => {
  const { dir, filePath } = makeTarget();
  const lease = acquireSmartAddFileLock(filePath);
  const lockPath = lockPathFor(filePath);
  try {
    const ownerPath = ownerFilePath(lockPath);
    const old = new Date(Date.now() - 5000);
    utimesSync(ownerPath, old, old);

    assert.equal(tryReclaimStaleLock(lockPath, 1000), false);
    assert.equal(existsSync(lockPath), true);
  } finally {
    releaseSmartAddFileLock(lease);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("malformed stale owner metadata fails closed instead of breaking a live lock", () => {
  const { dir, filePath } = makeTarget();
  const lease = acquireSmartAddFileLock(filePath);
  const lockPath = lockPathFor(filePath);
  try {
    const ownerPath = ownerFilePath(lockPath);
    writeFileSync(ownerPath, "{not-json");
    const old = new Date(Date.now() - 5000);
    utimesSync(ownerPath, old, old);

    assert.equal(tryReclaimStaleLock(lockPath, 1000), false);
    assert.equal(existsSync(lockPath), true);
  } finally {
    releaseSmartAddFileLock(lease);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("competing stale reapers can claim an owner only once", async () => {
  const { dir, filePath } = makeTarget();
  const lease = acquireSmartAddFileLock(filePath);
  const lockPath = lockPathFor(filePath);
  const barrierPath = resolve(dir, "reap.barrier");
  try {
    const ownerPath = ownerFilePath(lockPath);
    const metadata = JSON.parse(readFileSync(ownerPath, "utf8"));
    metadata.pid = 99999999;
    writeFileSync(ownerPath, JSON.stringify(metadata));
    const old = new Date(Date.now() - 5000);
    utimesSync(ownerPath, old, old);
    writeFileSync(barrierPath, "hold");

    const lockModulePath = resolve("lib/smart-add-file-lock.cjs");
    const childSource = `
      const { existsSync } = require("node:fs");
      const lock = require(process.argv[1]);
      const lockPath = process.argv[2];
      const barrierPath = process.argv[3];
      const cell = new Int32Array(new SharedArrayBuffer(4));
      while (existsSync(barrierPath)) Atomics.wait(cell, 0, 0, 2);
      process.stdout.write(String(lock.tryReclaimStaleLock(lockPath, 1000)));
    `;
    const children = Array.from({ length: 2 }, () => spawn(process.execPath, [
      "-e",
      childSource,
      lockModulePath,
      lockPath,
      barrierPath,
    ], { stdio: ["ignore", "pipe", "pipe"] }));

    await delay(40);
    rmSync(barrierPath, { force: true });
    const outcomes = await Promise.all(children.map(child => new Promise((resolveChild, rejectChild) => {
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", chunk => { stdout += chunk; });
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("error", rejectChild);
      child.on("close", code => {
        if (code !== 0) return rejectChild(new Error(`stale reaper exited ${code}: ${stderr}`));
        resolveChild(stdout.trim());
      });
    })));

    assert.deepEqual(outcomes.sort(), ["false", "true"]);
    assert.equal(existsSync(lockPath), false);
  } finally {
    releaseSmartAddFileLock(lease);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("waiter can finish cleanup after a holder crashes with a claim marker", () => {
  const { dir, filePath } = makeTarget();
  const lease = acquireSmartAddFileLock(filePath);
  const lockPath = lockPathFor(filePath);
  try {
    const ownerPath = ownerFilePath(lockPath);
    const claimPath = resolve(lockPath, "claim-simulated-crash.json");
    renameSync(ownerPath, claimPath);

    assert.equal(tryReclaimStaleLock(lockPath, 1000), true);
    assert.equal(existsSync(lockPath), false);
  } finally {
    releaseSmartAddFileLock(lease);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("old holder cannot release a replacement lock at the same path", () => {
  const { dir, filePath } = makeTarget();
  const first = acquireSmartAddFileLock(filePath);
  const lockPath = lockPathFor(filePath);
  try {
    rmSync(lockPath, { recursive: true, force: true });
    const replacement = acquireSmartAddFileLock(filePath);
    try {
      assert.equal(releaseSmartAddFileLock(first), false);
      assert.equal(existsSync(lockPath), true);
      assert.equal(existsSync(replacement.ownerPath), true);
    } finally {
      releaseSmartAddFileLock(replacement);
    }
  } finally {
    releaseSmartAddFileLock(first);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("async lock wait keeps the event loop responsive", async () => {
  const { dir, filePath } = makeTarget();
  const holder = acquireSmartAddFileLock(filePath);
  let timerFiredAt = null;
  try {
    const timer = delay(15).then(() => { timerFiredAt = Date.now(); });
    let rejectedAt = null;
    await assert.rejects(
      acquireSmartAddFileLockAsync(filePath, { waitMs: 80, retryMs: 5 }),
      error => {
        rejectedAt = Date.now();
        return error?.code === SMART_ADD_FILE_LOCK_TIMEOUT;
      },
    );
    assert.notEqual(timerFiredAt, null);
    assert.equal(timerFiredAt < rejectedAt, true);
    await timer;
  } finally {
    releaseSmartAddFileLock(holder);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ambiguous lock directory fails closed and exposes bounded timeout diagnostics", async () => {
  const { dir, filePath } = makeTarget();
  const holder = acquireSmartAddFileLock(filePath);
  const lockPath = lockPathFor(filePath);
  try {
    writeFileSync(resolve(lockPath, "owner-extra.json"), JSON.stringify({
      token: "extra",
      pid: 99999999,
    }));

    await assert.rejects(
      acquireSmartAddFileLockAsync(filePath, { waitMs: 25, retryMs: 5 }),
      error => {
        assert.equal(error?.code, SMART_ADD_FILE_LOCK_TIMEOUT);
        assert.equal(error?.lockRecordState, "ambiguous");
        assert.equal(error?.lockOwnerRecordCount, 2);
        assert.equal(error?.lockClaimRecordCount, 0);
        assert.equal(error?.lockOwnerMetadataValid, null);
        return true;
      },
    );
    assert.equal(existsSync(lockPath), true);
  } finally {
    releaseSmartAddFileLock(holder);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lock timeout exposes bounded diagnostic context", async () => {
  const { dir, filePath } = makeTarget();
  const holder = acquireSmartAddFileLock(filePath);
  try {
    await assert.rejects(
      acquireSmartAddFileLockAsync(filePath, { waitMs: 25, retryMs: 5 }),
      error => {
        assert.equal(error?.code, SMART_ADD_FILE_LOCK_TIMEOUT);
        assert.equal(error?.path, filePath);
        assert.equal(error?.lockPath, lockPathFor(filePath));
        assert.equal(Number.isFinite(error?.waitedMs), true);
        assert.equal(error.waitedMs >= 25, true);
        assert.equal(Number.isFinite(error?.lockAgeMs), true);
        assert.equal(error?.lockRecordState, "owner");
        assert.equal(error?.lockOwnerRecordCount, 1);
        assert.equal(error?.lockClaimRecordCount, 0);
        assert.equal(error?.lockOwnerMetadataValid, true);
        return true;
      },
    );
  } finally {
    releaseSmartAddFileLock(holder);
    rmSync(dir, { recursive: true, force: true });
  }
});
