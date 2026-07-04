import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

async function importAudit(tag = Date.now()) {
  return import(`../lib/quality/smart-add-propagation-audit.js?audit=${tag}`);
}

function createFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "smart-add-propagation-audit-"));
  const memoryDir = resolve(root, "memory");
  const smartAddDir = resolve(memoryDir, "smart-add");
  const episodesDir = resolve(memoryDir, "episodes");
  const coreDbPath = resolve(root, "main.sqlite");
  mkdirSync(smartAddDir, { recursive: true });
  mkdirSync(episodesDir, { recursive: true });
  const db = new Database(coreDbPath);
  try {
    db.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        text TEXT,
        updated_at INTEGER
      );
      CREATE TABLE chunks_fts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        text TEXT
      );
    `);
  } finally {
    db.close();
  }
  return { root, memoryDir, smartAddDir, episodesDir, coreDbPath };
}

function insertChunk(coreDbPath, { id, path, text = "", updatedAt = 1 }) {
  const db = new Database(coreDbPath);
  try {
    db.prepare("INSERT INTO chunks (id, path, text, updated_at) VALUES (?, ?, ?, ?)").run(id, path, text, updatedAt);
    db.prepare("INSERT INTO chunks_fts (path, text) VALUES (?, ?)").run(path, text);
  } finally {
    db.close();
  }
}

test("audit flags suspicious smart-add and episode targets and reports stale indexed chunks", async () => {
  const fixture = createFixture();
  writeFileSync(resolve(fixture.root, "MEMORY.md"), "2026-06-10 fixed opencode provider env: prefix\n", "utf8");
  writeFileSync(resolve(fixture.smartAddDir, "2026-06-24.md"), [
    "# Smart Added Memory",
    "",
    "## 2026-06-23_episodic_nightly_generated_091523",
    "",
    "Category: episodic",
    "",
    "修复了 memory-engine 配置兼容性问题",
    "",
    "## 2026-06-24T1930_raw_log_ab39d09f",
    "",
    "Category: raw_log",
    "",
    "User: 昨天做了什么",
    "Assistant: 发现 opencode provider 的 apiKey 缺了 env:前缀，smart-add 被污染。",
    "",
  ].join("\n"));
  writeFileSync(resolve(fixture.episodesDir, "2026-06-25.md"), [
    "# Episode: 2026-06-25",
    "",
    "今天处理了 opencode provider 的 apiKey 缺失 env:前缀问题。",
    "",
  ].join("\n"));
  insertChunk(fixture.coreDbPath, {
    id: "chunk-smart-1",
    path: "memory/smart-add/2026-06-24.md",
    text: "OpenCode provider env: prefix issue",
    updatedAt: 10,
  });
  insertChunk(fixture.coreDbPath, {
    id: "chunk-episode-1",
    path: "memory/episodes/2026-06-25.md",
    text: "opencode provider env prefix issue",
    updatedAt: 11,
  });

  const audit = await importAudit();
  const report = audit.runSmartAddPropagationAudit({
    rootDir: fixture.root,
    memoryDir: fixture.memoryDir,
    coreDbPath: fixture.coreDbPath,
  });

  assert.equal(report.suspected_wrong_date_smart_add.length, 1);
  assert.equal(report.suspected_wrong_date_smart_add[0].path, "memory/smart-add/2026-06-24.md");
  assert.equal(report.suspected_wrong_date_smart_add[0].source_date_candidate, "2026-06-23");
  assert.equal(report.suspected_wrong_date_smart_add[0].target_date_polluted, "2026-06-24");
  assert.equal(report.suspected_wrong_date_smart_add[0].detection_context, "file_level_topic_with_cross_day_generated_entry");
  assert.equal(report.suspected_propagated_episode.length, 1);
  assert.equal(report.suspected_propagated_episode[0].path, "memory/episodes/2026-06-25.md");
  assert.equal(report.remediation.stale_index_cleanup_candidates.length, 2);
  assert.equal(report.summary.stale_index_cleanup_chunk_count, 2);
});

test("audit skips clean canonical checkpoint episode even when recap discusses old pollution terms", async () => {
  const fixture = createFixture();
  writeFileSync(resolve(fixture.episodesDir, "2026-06-27.md"), [
    "# Episode: 2026-06-27",
    "",
    "targetDate: 2026-06-27",
    "generatedAt: 2026-06-27T19:35:39.162Z",
    "timeZone: Asia/Shanghai",
    "category: episodic",
    "source_type: checkpoint_llm",
    "smartAddPath: memory/smart-add/2026-06-27.md",
    "smartAddInputPolicy: trusted_only:manual,agent_smart_add",
    "smartAddIncluded: 0",
    "smartAddSkippedUnknownProvenance: 32",
    "smartAddSkippedCheckpointGenerated: 0",
    "rawLogIncluded: 83",
    "rawLogSkippedOutOfTargetDate: 0",
    "evidenceDateFilter: targetDate=2026-06-27; raw_log=created_at bounded to targetDate",
    "",
    "今天确认 opencode provider 配置修复实际发生在 2026-06-10，而不是 2026-06-24 / 2026-06-25。",
    "并继续审计 memory/smart-add/2026-06-24.md 和 memory/episodes/2026-06-25.md。",
    "",
  ].join("\n"), "utf8");

  const audit = await importAudit();
  const report = audit.runSmartAddPropagationAudit({
    rootDir: fixture.root,
    memoryDir: fixture.memoryDir,
    coreDbPath: fixture.coreDbPath,
  });

  assert.equal(report.suspected_propagated_episode.length, 0);
  assert.equal(report.skipped_canonical_checkpoint_episode.length, 1);
  assert.equal(report.skipped_canonical_checkpoint_episode[0].path, "memory/episodes/2026-06-27.md");
  assert.equal(report.skipped_canonical_checkpoint_episode[0].reason, "canonical_checkpoint_raw_log_first_episode");
});

test("CLI --json writes audit report", () => {
  const fixture = createFixture();
  writeFileSync(resolve(fixture.smartAddDir, "2026-06-24.md"), [
    "# Smart Added Memory",
    "",
    "## 2026-06-23_episodic_nightly_generated_091523",
    "",
    "Category: episodic",
    "",
    "opencode env: issue",
    "",
  ].join("\n"));
  const outPath = resolve(fixture.root, "reports", "smart-add-propagation-audit.json");
  const result = spawnSync(process.execPath, [
    resolve(process.cwd(), "bin/audit-smart-add-propagation.js"),
    "--json",
    "--root-dir", fixture.root,
    "--memory-dir", fixture.memoryDir,
    "--core-db-path", fixture.coreDbPath,
    "--out", outPath,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.equal(existsSync(outPath), true);
  const parsed = JSON.parse(readFileSync(outPath, "utf8"));
  assert.equal(parsed.summary.suspected_wrong_date_smart_add, 1);
});
