import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { detectOpenClawRuntime } from "./helpers/openclaw-runtime.js";
import { buildSmartAddFingerprint } from "../smart-add-fingerprint.js";
import { runMemoryIndexSyncCli } from "../session-checkpoint.js";

const OPENCLAW_RUNTIME = await detectOpenClawRuntime();
let appendSmartAdd = null;
let readSmartAddFingerprints = null;
if (OPENCLAW_RUNTIME.available) {
  ({ appendSmartAdd, readSmartAddFingerprints } = await import("../session-checkpoint.js"));
}
const SKIP_IF_NO_OPENCLAW = OPENCLAW_RUNTIME.available ? false : OPENCLAW_RUNTIME.reason;

function makeTmpDir() {
  return mkdtempSync(resolve(tmpdir(), "memory-engine-smart-add-"));
}

test("readSmartAddFingerprints reads fingerprint comments", { skip: SKIP_IF_NO_OPENCLAW }, () => {
  const dir = makeTmpDir();
  const filePath = resolve(dir, "2026-05-26.md");
  writeFileSync(filePath, [
    "# Smart Added Memory",
    "",
    "## e1",
    "",
    "Category: raw_log",
    "<!-- smart-add-fingerprint: abcdef1234567890 -->",
    "",
    "hello",
    "",
  ].join("\n"));

  const fingerprints = readSmartAddFingerprints(filePath);
  assert.equal(fingerprints.has("abcdef1234567890"), true);
});

test("appendSmartAdd dedupes by fingerprint before writing", { skip: SKIP_IF_NO_OPENCLAW }, () => {
  const dir = makeTmpDir();
  const filePath = resolve(dir, "2026-05-26.md");
  const payload = {
    fileDir: dir,
    filePath,
    entryId: "20260526T000000_raw_log",
    category: "raw_log",
    isProtected: false,
    text: "duplicate text",
    fingerprint: "1111222233334444",
  };

  const first = appendSmartAdd(payload);
  const second = appendSmartAdd({ ...payload, entryId: "20260526T000001_raw_log" });

  assert.equal(first.appended, true);
  assert.equal(second.appended, false);
  assert.equal(second.reason, "fingerprint");
});

test("appendSmartAdd keeps legacy text fallback dedupe when no fingerprint exists", { skip: SKIP_IF_NO_OPENCLAW }, () => {
  const dir = makeTmpDir();
  const filePath = resolve(dir, "2026-05-26.md");
  writeFileSync(filePath, [
    "# Smart Added Memory",
    "",
    "## old_entry",
    "",
    "Category: raw_log",
    "",
    "legacy body text",
    "",
  ].join("\n"));

  const result = appendSmartAdd({
    fileDir: dir,
    filePath,
    entryId: "20260526T000002_raw_log",
    category: "raw_log",
    isProtected: false,
    text: "legacy body text",
    fingerprint: "aaaabbbbccccdddd",
  });

  assert.equal(result.appended, false);
  assert.equal(result.reason, "legacy-text");
  const content = readFileSync(filePath, "utf8");
  assert.equal((content.match(/## /g) || []).length, 1);
});

test("buildSmartAddFingerprint normalizes LF and CRLF equivalently", () => {
  const a = buildSmartAddFingerprint("line1\nline2\n", "raw_log", false);
  const b = buildSmartAddFingerprint("line1\r\nline2\r\n", "raw_log", false);
  const c = buildSmartAddFingerprint("line1\rline2\r", "raw_log", false);
  assert.equal(a, b);
  assert.equal(a, c);
});

test("buildSmartAddFingerprint normalizes category case", () => {
  const a = buildSmartAddFingerprint("same text", "Episodic", false);
  const b = buildSmartAddFingerprint("same text", "episodic", false);
  assert.equal(a, b);
});

test("buildSmartAddFingerprint keeps protected flag distinct", () => {
  const a = buildSmartAddFingerprint("same text", "episodic", false);
  const b = buildSmartAddFingerprint("same text", "episodic", true);
  assert.notEqual(a, b);
});

test("runMemoryIndexSyncCli returns ok=true with real runner output", () => {
  const calls = [];
  const result = runMemoryIndexSyncCli({
    force: true,
    quiet: true,
    spawnSyncImpl: (...args) => {
      calls.push(args);
      return { status: 0, stdout: "{\"reason\":\"cli-sync\"}\n", stderr: "" };
    },
    nodeExecPath: "/fake/node",
    scriptPath: "/fake/scripts/sync-memory-index.js",
    cwd: "/fake/project",
    env: { TEST_ENV: "1" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "{\"reason\":\"cli-sync\"}\n");
  assert.equal(result.stderr, "");
  assert.equal("error" in result, false);
  assert.deepEqual(calls, [[
    "/fake/node",
    ["/fake/scripts/sync-memory-index.js", "--force"],
    { cwd: "/fake/project", env: { TEST_ENV: "1" }, encoding: "utf8" },
  ]]);
});

test("runMemoryIndexSyncCli returns ok=false and error on non-zero exit", () => {
  const result = runMemoryIndexSyncCli({
    quiet: true,
    spawnSyncImpl: () => ({ status: 1, stdout: "partial\n", stderr: "sync failed\n" }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "partial\n");
  assert.equal(result.stderr, "sync failed\n");
  assert.equal(result.error, "sync failed");
});

test("runMemoryIndexSyncCli does not report fake success when runner provides no success status", () => {
  const result = runMemoryIndexSyncCli({
    quiet: true,
    spawnSyncImpl: () => ({ stdout: "", stderr: "" }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, null);
  assert.match(result.error, /status unknown/i);
});
