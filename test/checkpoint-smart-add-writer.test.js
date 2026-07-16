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

function likeOnlyInput() {
  return "alphaBeta gammaDelta epsilonZeta";
}

function likeOnlyStoredText(suffix = "") {
  return `xxalphaBetaxx yygammaDeltayy zzepsilonZetazz ${suffix}`.trim();
}

function createFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-smart-add-writer-"));
  const workspaceDir = resolve(root, "workspace");
  const smartAddDir = resolve(root, "memory", "smart-add");
  const generatedSmartAddDir = resolve(root, "memory", "generated-smart-add");
  const coreDbPath = resolve(root, "core.sqlite");
  const engineDbPath = resolve(root, "engine.sqlite");
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(smartAddDir, { recursive: true });
  mkdirSync(generatedSmartAddDir, { recursive: true });

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

  return { workspaceDir, smartAddDir, generatedSmartAddDir, coreDbPath, engineDbPath };
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

function insertEngineConfidence(engineDbPath, { chunkId, isArchived = false }) {
  const db = new Database(engineDbPath);
  try {
    db.prepare("INSERT INTO memory_confidence (chunk_id, is_archived) VALUES (?, ?)").run(
      chunkId,
      isArchived ? 1 : 0,
    );
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
  writeFileSync(resolve(fixture.generatedSmartAddDir, "2026-06-18.md"), [
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
    generatedSmartAddDir: fixture.generatedSmartAddDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    const fps = smartAddWriter.readSmartAddFingerprints("2026-06-18", {
      provenance: smartAddWriter.SMART_ADD_PROVENANCE.CHECKPOINT_GENERATED,
    });
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

test("appendSmartAdd writes header for new file and keeps entry format", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    generatedSmartAddDir: fixture.generatedSmartAddDir,
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

  const content = readFileSync(resolve(fixture.generatedSmartAddDir, "2026-06-18.md"), "utf8");
  assert.match(content, /^# Smart Added Memory\n\n/);
  assert.match(content, /<!-- smart-add-fingerprint: [a-f0-9]{64} -->/);
  assert.match(content, /## entry_1/);
  assert.match(content, /Category: raw_log/);
  assert.match(content, /Provenance: checkpoint_generated/);
  assert.match(content, /kg_data: \{"a":1\}/);
  assert.match(content, /hello world/);
});

test("appendSmartAdd does not repeat header for existing file", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    generatedSmartAddDir: fixture.generatedSmartAddDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    smartAddWriter.appendSmartAdd("hello world", "raw_log", { entryId: "entry_1" });
    smartAddWriter.appendSmartAdd("another body", "preference", { entryId: "entry_2" });
  });

  const content = readFileSync(resolve(fixture.generatedSmartAddDir, "2026-06-18.md"), "utf8");
  assert.equal((content.match(/^# Smart Added Memory$/gm) || []).length, 1);
  assert.match(content, /\n<!-- smart-add-fingerprint: [a-f0-9]{64} -->\n## entry_2/);
});

test("appendSmartAdd returns null on fingerprint duplicate", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    generatedSmartAddDir: fixture.generatedSmartAddDir,
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
    generatedSmartAddDir: fixture.generatedSmartAddDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    smartAddWriter.appendSmartAdd("hello world", "raw_log", { entryId: "entry_1" });
    assert.equal(smartAddWriter.isDuplicate("hello world", "raw_log", {
      provenance: smartAddWriter.SMART_ADD_PROVENANCE.CHECKPOINT_GENERATED,
    }), true);
  });
});

test("isDuplicate returns true for an active duplicate in core and engine", async () => {
  const fixture = createFixture();
  insertCoreChunk(fixture.coreDbPath, {
    id: "dup-active",
    path: "memory/smart-add/2026-06-17.md",
    text: "hello world duplicate body",
  });
  insertEngineConfidence(fixture.engineDbPath, { chunkId: "dup-active" });

  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    generatedSmartAddDir: fixture.generatedSmartAddDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    assert.equal(smartAddWriter.isDuplicate("hello world duplicate body", "raw_log"), true);
  });
});

test("isDuplicate returns false when no duplicate matches exist", async () => {
  const fixture = createFixture();
  insertCoreChunk(fixture.coreDbPath, {
    id: "other-text",
    path: "memory/smart-add/2026-06-17.md",
    text: "completely unrelated body",
  });
  insertEngineConfidence(fixture.engineDbPath, { chunkId: "other-text" });

  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    generatedSmartAddDir: fixture.generatedSmartAddDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    assert.equal(smartAddWriter.isDuplicate("hello world duplicate body", "raw_log"), false);
  });
});

test("isDuplicate returns true for archived-only FTS matches", async () => {
  const fixture = createFixture();
  insertCoreChunk(fixture.coreDbPath, {
    id: "dup-archived",
    path: "memory/smart-add/2026-06-17.md",
    text: "archived duplicate body",
  });
  insertEngineConfidence(fixture.engineDbPath, { chunkId: "dup-archived", isArchived: true });

  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    generatedSmartAddDir: fixture.generatedSmartAddDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    assert.equal(smartAddWriter.isDuplicate("archived duplicate body", "raw_log"), true);
  });
});

test("isDuplicate returns true when archived and active duplicates coexist", async () => {
  const fixture = createFixture();
  insertCoreChunk(fixture.coreDbPath, {
    id: "dup-archived",
    path: "memory/smart-add/2026-06-17.md",
    text: "mixed duplicate body",
  });
  insertCoreChunk(fixture.coreDbPath, {
    id: "dup-active",
    path: "memory/smart-add/2026-06-17.md",
    text: "mixed duplicate body",
  });
  insertEngineConfidence(fixture.engineDbPath, { chunkId: "dup-archived", isArchived: true });
  insertEngineConfidence(fixture.engineDbPath, { chunkId: "dup-active" });

  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    generatedSmartAddDir: fixture.generatedSmartAddDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    assert.equal(smartAddWriter.isDuplicate("mixed duplicate body", "raw_log"), true);
  });
});

test("isDuplicate returns true for FTS matches without any engine row", async () => {
  const fixture = createFixture();
  insertCoreChunk(fixture.coreDbPath, {
    id: "no-engine-row",
    path: "memory/smart-add/2026-06-17.md",
    text: "orphan duplicate body",
  });

  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    generatedSmartAddDir: fixture.generatedSmartAddDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    assert.equal(smartAddWriter.isDuplicate("orphan duplicate body", "raw_log"), true);
  });
});

test("isDuplicate short-circuits after FTS hit and does not require the Engine path", async () => {
  const fixture = createFixture();
  insertCoreChunk(fixture.coreDbPath, {
    id: "fts-short-circuit",
    path: "memory/smart-add/2026-06-17.md",
    text: "fts short circuit body",
  });

  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    generatedSmartAddDir: fixture.generatedSmartAddDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: resolve(fixture.workspaceDir, "missing-engine.sqlite"),
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    assert.equal(smartAddWriter.isDuplicate("fts short circuit body", "raw_log"), true);
  });
});

test("isDuplicate ignores eligible engine rows whose core chunks are missing", async () => {
  const fixture = createFixture();
  insertEngineConfidence(fixture.engineDbPath, { chunkId: "missing-core-row" });

  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    generatedSmartAddDir: fixture.generatedSmartAddDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    assert.equal(smartAddWriter.isDuplicate("missing core duplicate body", "raw_log"), false);
  });
});

test("isDuplicate returns false for empty engine eligibility set on a LIKE-only input", async () => {
  const fixture = createFixture();
  insertCoreChunk(fixture.coreDbPath, {
    id: "core-only",
    path: "memory/smart-add/2026-06-17.md",
    text: likeOnlyStoredText("core-only"),
  });

  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    generatedSmartAddDir: fixture.generatedSmartAddDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    assert.equal(smartAddWriter.isDuplicate(likeOnlyInput(), "raw_log"), false);
  });
});

test("isDuplicate returns false when core is empty", async () => {
  const fixture = createFixture();
  insertEngineConfidence(fixture.engineDbPath, { chunkId: "engine-only" });

  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    generatedSmartAddDir: fixture.generatedSmartAddDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    assert.equal(smartAddWriter.isDuplicate("engine-only duplicate body", "raw_log"), false);
  });
});

test("isDuplicate returns false for LIKE-only archived duplicates", async () => {
  const fixture = createFixture();
  insertCoreChunk(fixture.coreDbPath, {
    id: "archived-like-1",
    path: "memory/smart-add/a.md",
    text: likeOnlyStoredText("archived-like-1"),
  });
  insertCoreChunk(fixture.coreDbPath, {
    id: "archived-like-2",
    path: "memory/smart-add/b.md",
    text: likeOnlyStoredText("archived-like-2"),
  });
  insertEngineConfidence(fixture.engineDbPath, { chunkId: "archived-like-1", isArchived: true });
  insertEngineConfidence(fixture.engineDbPath, { chunkId: "archived-like-2", isArchived: true });

  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    generatedSmartAddDir: fixture.generatedSmartAddDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    assert.equal(smartAddWriter.isDuplicate(likeOnlyInput(), "raw_log"), false);
  });
});

test("isDuplicate returns false for LIKE-only matches without engine rows", async () => {
  const fixture = createFixture();
  insertCoreChunk(fixture.coreDbPath, {
    id: "missing-engine-1",
    path: "memory/smart-add/a.md",
    text: likeOnlyStoredText("missing-engine-1"),
  });
  insertCoreChunk(fixture.coreDbPath, {
    id: "missing-engine-2",
    path: "memory/smart-add/b.md",
    text: likeOnlyStoredText("missing-engine-2"),
  });

  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    generatedSmartAddDir: fixture.generatedSmartAddDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    assert.equal(smartAddWriter.isDuplicate(likeOnlyInput(), "raw_log"), false);
  });
});

test("isDuplicate returns true when LIKE-only active matches reach the threshold of two", async () => {
  const fixture = createFixture();
  insertCoreChunk(fixture.coreDbPath, {
    id: "like-active-1",
    path: "memory/smart-add/a.md",
    text: likeOnlyStoredText("like-active-1"),
  });
  insertCoreChunk(fixture.coreDbPath, {
    id: "like-active-2",
    path: "memory/smart-add/b.md",
    text: likeOnlyStoredText("like-active-2"),
  });
  insertEngineConfidence(fixture.engineDbPath, { chunkId: "like-active-1" });
  insertEngineConfidence(fixture.engineDbPath, { chunkId: "like-active-2" });

  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    generatedSmartAddDir: fixture.generatedSmartAddDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    assert.equal(smartAddWriter.isDuplicate(likeOnlyInput(), "raw_log"), true);
  });
});

test("isDuplicate finds a LIKE-only duplicate when matches are split across batches", async () => {
  const fixture = createFixture();
  for (let index = 0; index < 700; index += 1) {
    const id = `chunk-${String(index).padStart(4, "0")}`;
    const text = index === 499 || index === 650
      ? likeOnlyStoredText(id)
      : `other body ${index}`;
    insertCoreChunk(fixture.coreDbPath, {
      id,
      path: `memory/smart-add/${id}.md`,
      text,
    });
    insertEngineConfidence(fixture.engineDbPath, { chunkId: id });
  }

  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    generatedSmartAddDir: fixture.generatedSmartAddDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    assert.equal(smartAddWriter.isDuplicate(likeOnlyInput(), "raw_log"), true);
  });
});

test("isDuplicate returns false when only one LIKE-only match exists across all batches", async () => {
  const fixture = createFixture();
  for (let index = 0; index < 700; index += 1) {
    const id = `chunk-${String(index).padStart(4, "0")}`;
    const text = index === 650 ? likeOnlyStoredText(id) : `other body ${index}`;
    insertCoreChunk(fixture.coreDbPath, {
      id,
      path: `memory/smart-add/${id}.md`,
      text,
    });
    insertEngineConfidence(fixture.engineDbPath, { chunkId: id });
  }

  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    generatedSmartAddDir: fixture.generatedSmartAddDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    assert.equal(smartAddWriter.isDuplicate(likeOnlyInput(), "raw_log"), false);
  });
});

test("isDuplicate keeps the current token-based matching normalization behavior", async () => {
  const fixture = createFixture();
  insertCoreChunk(fixture.coreDbPath, {
    id: "normalized-active",
    path: "memory/smart-add/2026-06-17.md",
    text: "Alpha beta gamma delta",
  });
  insertEngineConfidence(fixture.engineDbPath, { chunkId: "normalized-active" });

  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    generatedSmartAddDir: fixture.generatedSmartAddDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    assert.equal(smartAddWriter.isDuplicate("Alpha, beta! gamma? delta.", "raw_log"), true);
  });
});

test("isDuplicate uses readonlyEngine dual-handle path and no attached schema references", () => {
  const source = readFileSync(resolve("lib/checkpoint/smart-add-writer.js"), "utf8");
  assert.doesNotMatch(source, /chunks_db\./);
  assert.doesNotMatch(source, /withMeDb\s*\(/);
  assert.doesNotMatch(source, /ATTACH DATABASE/);
  assert.doesNotMatch(source, /patchWriteGuards/);
  assert.match(source, /withDb\s*\(/);
  assert.match(source, /withCheckpointDbs\s*\(/);
  assert.match(source, /readonlyEngine:\s*true/);
  assert.match(source, /SMART_ADD_DUPLICATE_BATCH_SIZE/);
});

test("isDuplicate returns false on DB error", async () => {
  const fixture = createFixture();
  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    generatedSmartAddDir: fixture.generatedSmartAddDir,
    coreDbPath: resolve(fixture.workspaceDir, "missing-core.sqlite"),
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    assert.equal(smartAddWriter.isDuplicate("hello world", "raw_log"), false);
  });
});

test("resolveOutputTarget sends checkpoint_generated output to generated-smart-add path", async () => {
  const fixture = createFixture();
  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    generatedSmartAddDir: fixture.generatedSmartAddDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    const target = smartAddWriter.resolveOutputTarget({
      provenance: smartAddWriter.SMART_ADD_PROVENANCE.CHECKPOINT_GENERATED,
    });
    assert.equal(target.fileRel, "memory/generated-smart-add/2026-06-18.md");
  });
});
