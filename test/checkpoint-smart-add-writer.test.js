import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const checkpoint = require("../bin/session-checkpoint.js");
const smartAddWriter = require("../lib/checkpoint/smart-add-writer.js");

function createFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-smart-add-writer-"));
  const workspaceDir = resolve(root, "workspace");
  const smartAddDir = resolve(root, "memory", "smart-add");
  const coreDbPath = resolve(root, "core.sqlite");
  const engineDbPath = resolve(root, "engine.sqlite");
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(smartAddDir, { recursive: true });

  const coreDb = new Database(coreDbPath);
  try {
    coreDb.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        text TEXT,
        updated_at INTEGER
      );
      CREATE VIRTUAL TABLE chunks_fts USING fts5(text);
    `);
  } finally {
    coreDb.close();
  }

  const engineDb = new Database(engineDbPath);
  try {
    engineDb.exec(`
      CREATE TABLE memory_confidence (
        chunk_id TEXT PRIMARY KEY,
        is_archived INTEGER NOT NULL DEFAULT 0
      )
    `);
  } finally {
    engineDb.close();
  }

  return { workspaceDir, smartAddDir, coreDbPath, engineDbPath };
}

function insertCoreChunk(coreDbPath, { id, path, text = "", updatedAt = 1 }) {
  const db = new Database(coreDbPath);
  try {
    db.prepare("INSERT INTO chunks (id, path, text, updated_at) VALUES (?, ?, ?, ?)").run(id, path, text, updatedAt);
    if (text) db.prepare("INSERT INTO chunks_fts (text) VALUES (?)").run(text);
  } finally {
    db.close();
  }
}

function insertEngineConfidence(engineDbPath, { chunkId }) {
  const db = new Database(engineDbPath);
  try {
    db.prepare("INSERT INTO memory_confidence (chunk_id, is_archived) VALUES (?, 0)").run(chunkId);
  } finally {
    db.close();
  }
}

test("mapToCategory keeps current mapping", () => {
  assert.equal(smartAddWriter.mapToCategory("profile"), "user_identity");
  assert.equal(smartAddWriter.mapToCategory("preference"), "preference");
  assert.equal(smartAddWriter.mapToCategory("entity"), "kg_node");
  assert.equal(smartAddWriter.mapToCategory("event"), "episodic");
  assert.equal(smartAddWriter.mapToCategory("case"), "episodic");
  assert.equal(smartAddWriter.mapToCategory("pattern"), "preference");
  assert.equal(smartAddWriter.mapToCategory("other"), "raw_log");
});

test("smartAddFingerprint is stable across CRLF and comments/title normalization", () => {
  const a = smartAddWriter.smartAddFingerprint({ raw: "## x\r\n<!-- c -->\r\nhello\r\n", category: "raw_log" });
  const b = smartAddWriter.smartAddFingerprint({ raw: "## y\nhello\n", category: "raw_log" });
  assert.equal(a, b);
});

test("readSmartAddFingerprints reads comment fingerprint", async () => {
  const fixture = createFixture();
  writeFileSync(resolve(fixture.smartAddDir, "2026-06-18.md"), [
    "# Smart Added Memory",
    "",
    "<!-- smart-add-fingerprint: abcdef1234567890 -->",
    "## e1",
    "",
    "Category: raw_log",
    "",
    "hello",
    "",
  ].join("\n"));

  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    const fps = smartAddWriter.readSmartAddFingerprints("2026-06-18");
    assert.equal(fps.has("abcdef1234567890"), true);
  });
});

test("readSmartAddFingerprints includes legacy entry fingerprint", async () => {
  const fixture = createFixture();
  writeFileSync(resolve(fixture.smartAddDir, "2026-06-18.md"), [
    "# Smart Added Memory",
    "",
    "## old_entry",
    "",
    "Category: raw_log",
    "",
    "legacy body text",
    "",
  ].join("\n"));

  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    const fps = smartAddWriter.readSmartAddFingerprints("2026-06-18");
    const expected = smartAddWriter.smartAddFingerprint({ raw: "## old_entry\n\nCategory: raw_log\n\nlegacy body text" });
    assert.equal(fps.has(expected), true);
  });
});

test("appendSmartAdd keeps current new-file entry format", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    const entryId = smartAddWriter.appendSmartAdd("hello world", "raw_log", {
      entryId: "entry_1",
      kg_data: "{\"a\":1}",
    });
    assert.equal(entryId, "entry_1");
  });

  const content = readFileSync(resolve(fixture.smartAddDir, "2026-06-18.md"), "utf8");
  assert.match(content, /<!-- smart-add-fingerprint: [a-f0-9]{64} -->/);
  assert.match(content, /## entry_1/);
  assert.match(content, /Category: raw_log/);
  assert.match(content, /kg_data: \{"a":1\}/);
  assert.match(content, /hello world/);
});

test("appendSmartAdd returns null on fingerprint duplicate", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    const first = smartAddWriter.appendSmartAdd("hello world", "raw_log", { entryId: "entry_1" });
    const second = smartAddWriter.appendSmartAdd("hello world", "raw_log", { entryId: "entry_2" });
    assert.equal(first, "entry_1");
    assert.equal(second, null);
  });
});

test("isDuplicate returns true when today's fingerprint matches", async () => {
  const fixture = createFixture();
  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    smartAddWriter.appendSmartAdd("hello world", "raw_log", { entryId: "entry_1" });
    assert.equal(smartAddWriter.isDuplicate("hello world", "raw_log"), true);
  });
});

test("isDuplicate returns false on DB error", async () => {
  const fixture = createFixture();
  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    coreDbPath: resolve(fixture.workspaceDir, "missing-core.sqlite"),
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    assert.equal(smartAddWriter.isDuplicate("hello world", "raw_log"), false);
  });
});
