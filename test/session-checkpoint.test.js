import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { pathToFileURL } from "url";
import { detectOpenClawRuntime } from "./helpers/openclaw-runtime.js";
import { buildSmartAddFingerprint } from "../smart-add-fingerprint.js";
import { runMemoryIndexSync, runMemoryIndexSyncCli } from "../session-checkpoint.js";

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

test("appendSmartAdd dedupes by fingerprint before writing", { skip: SKIP_IF_NO_OPENCLAW }, async () => {
  const dir = makeTmpDir();
  const filePath = resolve(dir, "2026-05-26.md");
  const payload = {
    fileDir: dir,
    filePath,
    entryId: "20260526T000000_raw_log",
    category: "raw_log",
    isProtected: false,
    text: "duplicate text",
    fingerprint: buildSmartAddFingerprint("duplicate text", "raw_log", false),
  };

  const first = await appendSmartAdd(payload);
  const second = await appendSmartAdd({ ...payload, entryId: "20260526T000001_raw_log" });

  assert.equal(first.appended, true);
  assert.equal(second.appended, false);
  assert.equal(second.reason, "fingerprint");
});

test("appendSmartAdd serializes concurrent process writers around fingerprint dedupe", async () => {
  const dir = makeTmpDir();
  const filePath = resolve(dir, "2026-05-26.md");
  const barrierPath = resolve(dir, "start.barrier");
  writeFileSync(barrierPath, "hold");
  const moduleUrl = pathToFileURL(resolve("smart-add.js")).href;
  const childSource = `
    import { existsSync } from "node:fs";
    import { setTimeout as delay } from "node:timers/promises";
    const [moduleUrl, fileDir, filePath, entryId, barrierPath] = process.argv.slice(1);
    const { appendSmartAdd } = await import(moduleUrl);
    while (existsSync(barrierPath)) await delay(2);
    const result = await appendSmartAdd({
      fileDir,
      filePath,
      entryId,
      category: "raw_log",
      isProtected: false,
      text: "concurrent duplicate text",
      syncCli: false,
    });
    process.stdout.write(JSON.stringify(result));
  `;

  const children = Array.from({ length: 8 }, (_, index) => spawn(process.execPath, [
    "--input-type=module",
    "-e",
    childSource,
    moduleUrl,
    dir,
    filePath,
    `20260526T0000${String(index).padStart(2, "0")}_raw_log`,
    barrierPath,
  ], {
    cwd: resolve("."),
    stdio: ["ignore", "pipe", "pipe"],
  }));

  await new Promise(resolveDelay => setTimeout(resolveDelay, 80));
  rmSync(barrierPath, { force: true });

  const results = await Promise.all(children.map(child => new Promise((resolveChild, rejectChild) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", rejectChild);
    child.on("close", code => {
      if (code !== 0) {
        rejectChild(new Error(`concurrent smart-add child exited ${code}: ${stderr}`));
        return;
      }
      resolveChild(JSON.parse(stdout));
    });
  })));

  assert.equal(results.filter(result => result.appended === true).length, 1);
  assert.equal(results.filter(result => result.appended === false && result.reason === "fingerprint").length, 7);
  const content = readFileSync(filePath, "utf8");
  assert.equal((content.match(/smart-add-fingerprint:/g) || []).length, 1);
  assert.equal((content.match(/^## /gm) || []).length, 1);
  assert.equal(existsSync(`${filePath}.memory-engine.lock`), false);
});

test("agent and checkpoint smart-add writers share the same file lock boundary", () => {
  const agentSource = readFileSync(resolve("smart-add.js"), "utf8");
  const checkpointSource = readFileSync(resolve("lib/checkpoint/smart-add-writer.js"), "utf8");
  assert.match(agentSource, /withSmartAddFileLockAsync\(filePath/);
  assert.match(checkpointSource, /withSmartAddFileLock\(filePath/);
});

test("appendSmartAdd keeps legacy text fallback dedupe when no fingerprint exists", { skip: SKIP_IF_NO_OPENCLAW }, async () => {
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

  const result = await appendSmartAdd({
    fileDir: dir,
    filePath,
    entryId: "20260526T000002_raw_log",
    category: "raw_log",
    isProtected: false,
    text: "legacy body text",
    fingerprint: buildSmartAddFingerprint("legacy body text", "raw_log", false),
  });

  assert.equal(result.appended, false);
  assert.equal(result.reason, "legacy-text");
  const content = readFileSync(filePath, "utf8");
  assert.equal((content.match(/## /g) || []).length, 1);
});

test("appendSmartAdd prefers injected async syncRunner over CLI fallback", { skip: SKIP_IF_NO_OPENCLAW }, async () => {
  const dir = makeTmpDir();
  const filePath = resolve(dir, "2026-05-26.md");
  let syncRunnerCalls = 0;
  let cliCalls = 0;

  const result = await appendSmartAdd({
    fileDir: dir,
    filePath,
    entryId: "20260526T000003_raw_log",
    category: "raw_log",
    isProtected: false,
    text: "runner-backed sync",
    fingerprint: buildSmartAddFingerprint("runner-backed sync", "raw_log", false),
    syncCli: true,
    syncRunner: async ({ force, quiet }) => {
      syncRunnerCalls += 1;
      return { ok: true, mode: "in-process", force, quiet };
    },
    syncCliRunner: () => {
      cliCalls += 1;
      return { ok: true, mode: "cli" };
    },
  });

  assert.equal(result.appended, true);
  assert.equal(result.sync?.ok, true);
  assert.equal(result.sync?.mode, "in-process");
  assert.equal(syncRunnerCalls, 1);
  assert.equal(cliCalls, 0);
});

test("runMemoryIndexSync falls back to CLI only when in-process runner is unavailable", async () => {
  let cliCalls = 0;
  const result = await runMemoryIndexSync({
    force: true,
    quiet: true,
    loadRunner: async () => ({}),
    syncCliRunner: ({ force, quiet }) => {
      cliCalls += 1;
      return { ok: true, mode: "cli-fallback", force, quiet };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "cli-fallback");
  assert.equal(result.fallback_from, "in-process");
  assert.equal(cliCalls, 1);
  assert.match(String(result.in_process_error || ""), /not available/i);
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
