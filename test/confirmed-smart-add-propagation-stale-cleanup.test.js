import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  CONFIRMED_SMART_ADD_PROPAGATION_STALE_CLEANUP_CONFIRM_TOKEN,
  applyConfirmedSmartAddPropagationStaleChunkCleanup,
  collectConfirmedSmartAddPropagationStaleChunksDryRun,
} from "../lib/quality/confirmed-smart-add-propagation-stale-cleanup.js";

function createFixture({ withConfidenceTable = true } = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "confirmed-smart-add-stale-cleanup-"));
  const memoryDir = resolve(root, "memory");
  const smartAddDir = resolve(memoryDir, "smart-add");
  const quarantineDir = resolve(memoryDir, "quarantined-smart-add-propagation");
  const coreDbPath = resolve(root, "main.sqlite");
  const engineDbPath = resolve(root, "memory-engine.sqlite");
  mkdirSync(smartAddDir, { recursive: true });
  mkdirSync(quarantineDir, { recursive: true });

  writeFileSync(resolve(smartAddDir, "2026-06-24.md"), [
    "# Smart Added Memory",
    "",
    "## 2026-06-24T1930_raw_log_ab39d09f",
    "",
    "Category: raw_log",
    "",
    "这里是 clean raw_log transcript。",
    "OpenCode provider 仍在讨论中，但这不是 confirmed stale generated block。",
    "",
  ].join("\n"), "utf8");

  const coreDb = new Database(coreDbPath);
  try {
    coreDb.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'memory',
        start_line INTEGER NOT NULL DEFAULT 1,
        end_line INTEGER NOT NULL DEFAULT 1,
        hash TEXT NOT NULL DEFAULT 'hash',
        model TEXT NOT NULL DEFAULT 'model',
        text TEXT NOT NULL DEFAULT 'body',
        embedding TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL DEFAULT 1
      );
      CREATE VIRTUAL TABLE chunks_fts USING fts5(
        text,
        id UNINDEXED,
        path UNINDEXED,
        source UNINDEXED,
        model UNINDEXED,
        start_line UNINDEXED,
        end_line UNINDEXED
      );
    `);
  } finally {
    coreDb.close();
  }

  const engineDb = new Database(engineDbPath);
  try {
    if (withConfidenceTable) {
      engineDb.exec(`
        CREATE TABLE memory_confidence (
          chunk_id TEXT PRIMARY KEY,
          confidence REAL DEFAULT 0.5,
          category TEXT DEFAULT 'raw_log',
          is_archived INTEGER DEFAULT 0
        );
      `);
    }
  } finally {
    engineDb.close();
  }

  return { root, memoryDir, smartAddDir, quarantineDir, coreDbPath, engineDbPath };
}

function insertChunk(coreDbPath, { id, path, text }) {
  const db = new Database(coreDbPath);
  try {
    db.prepare(`
      INSERT INTO chunks (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
      VALUES (?, ?, 'memory', 1, 1, ?, 'mock', ?, '[]', 1)
    `).run(id, path, `hash-${id}`, text);
    db.prepare(`
      INSERT INTO chunks_fts (text, id, path, source, model, start_line, end_line)
      VALUES (?, ?, ?, 'memory', 'mock', 1, 1)
    `).run(text, id, path);
  } finally {
    db.close();
  }
}

function insertConfidence(engineDbPath, chunkId) {
  const db = new Database(engineDbPath);
  try {
    db.prepare(`
      INSERT INTO memory_confidence (chunk_id, confidence, category, is_archived)
      VALUES (?, 0.5, 'raw_log', 0)
    `).run(chunkId);
  } finally {
    db.close();
  }
}

function countById(dbPath, tableName, idColumn, id) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return Number(db.prepare(`SELECT COUNT(*) AS c FROM ${tableName} WHERE ${idColumn} = ?`).get(id)?.c || 0);
  } finally {
    db.close();
  }
}

function writeQuarantineLog(quarantineDir, entries) {
  writeFileSync(
    resolve(quarantineDir, "quarantine-log.jsonl"),
    entries.map(entry => JSON.stringify(entry)).join("\n") + "\n",
    "utf8",
  );
}

function defaultOptions(fixture) {
  return {
    rootDir: fixture.root,
    memoryDir: fixture.memoryDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    confirmedPaths: ["memory/smart-add/2026-06-24.md"],
  };
}

test("dry-run does not modify DB and reports only confirmed stale markers", () => {
  const fixture = createFixture();
  insertChunk(fixture.coreDbPath, {
    id: "stale-prefix",
    path: "memory/smart-add/2026-06-24.md",
    text: "## 2026-06-23_episodic_nightly_generated_091523\n污染块",
  });
  insertChunk(fixture.coreDbPath, {
    id: "stale-fingerprint",
    path: "memory/smart-add/2026-06-24.md",
    text: "fingerprint 87c081ed 传播污染",
  });
  insertChunk(fixture.coreDbPath, {
    id: "clean-opencode",
    path: "memory/smart-add/2026-06-24.md",
    text: "clean raw_log transcript mentions OpenCode and OPENCODE_API_KEY but no stale marker",
  });
  insertConfidence(fixture.engineDbPath, "stale-prefix");
  insertConfidence(fixture.engineDbPath, "stale-fingerprint");
  insertConfidence(fixture.engineDbPath, "clean-opencode");

  writeQuarantineLog(fixture.quarantineDir, [
    {
      source_path: "memory/smart-add/2026-06-24.md",
      block_id: "2026-06-23_episodic_nightly_generated_091523",
      fingerprint: "3f503661019b1bb39b52571773a6e39eed6d77b6e270edefc8500f7d567df567",
      review_status: "manual_confirmed",
    },
    {
      source_path: "memory/smart-add/2026-06-24.md",
      block_id: "2026-06-24_episodic_nightly_generated_151036",
      fingerprint: "87c081eddbd6037e8f19c755ccdcc677c6b214b46092fb668541e58a0dc29a35",
      review_status: "manual_confirmed",
    },
  ]);

  const report = collectConfirmedSmartAddPropagationStaleChunksDryRun(defaultOptions(fixture));

  assert.equal(report.confirmed_stale_chunk_count, 2);
  assert.equal(report.confirmed_stale_fts_row_count, 2);
  assert.deepEqual(report.affected_paths, ["memory/smart-add/2026-06-24.md"]);
  assert.deepEqual(report.matched_markers, ["2026-06-23_", "87c081ed"]);
  assert.deepEqual(report.would_delete_chunk_ids, ["stale-fingerprint", "stale-prefix"]);
  assert.equal(report.clean_keyword_residuals_ignored.length, 1);
  assert.equal(report.clean_keyword_residuals_ignored[0].chunk_id, "clean-opencode");
  assert.equal(countById(fixture.coreDbPath, "chunks", "id", "stale-prefix"), 1);
  assert.equal(countById(fixture.engineDbPath, "memory_confidence", "chunk_id", "stale-prefix"), 1);
});

test("missing quarantine evidence blocks deletion even when marker exists in DB", () => {
  const fixture = createFixture();
  insertChunk(fixture.coreDbPath, {
    id: "stale-prefix",
    path: "memory/smart-add/2026-06-24.md",
    text: "## 2026-06-23_episodic_nightly_generated_091523\n污染块",
  });

  const report = collectConfirmedSmartAddPropagationStaleChunksDryRun(defaultOptions(fixture));

  assert.equal(report.confirmed_stale_chunk_count, 0);
  assert.equal(report.blocked_paths.length, 1);
  assert.match(report.blocked_paths[0].reasons.join(","), /missing_quarantine_evidence/);
});

test("apply deletes only confirmed stale markers and preserves same-path clean OpenCode raw_log chunk", () => {
  const fixture = createFixture();
  insertChunk(fixture.coreDbPath, {
    id: "stale-prefix",
    path: "memory/smart-add/2026-06-24.md",
    text: "## 2026-06-23_preference_nightly_generated_091523\n错误日期块",
  });
  insertChunk(fixture.coreDbPath, {
    id: "stale-87",
    path: "memory/smart-add/2026-06-24.md",
    text: "fingerprint 87c081ed propagated generated block",
  });
  insertChunk(fixture.coreDbPath, {
    id: "stale-3f",
    path: "memory/smart-add/2026-06-24.md",
    text: "fingerprint 3f503661 propagated generated block",
  });
  insertChunk(fixture.coreDbPath, {
    id: "clean-opencode",
    path: "memory/smart-add/2026-06-24.md",
    text: "clean raw_log transcript mentions OpenCode and OPENCODE_API_KEY but no confirmed stale marker",
  });
  insertConfidence(fixture.engineDbPath, "stale-prefix");
  insertConfidence(fixture.engineDbPath, "stale-87");
  insertConfidence(fixture.engineDbPath, "stale-3f");
  insertConfidence(fixture.engineDbPath, "clean-opencode");

  writeQuarantineLog(fixture.quarantineDir, [
    {
      source_path: "memory/smart-add/2026-06-24.md",
      block_id: "2026-06-23_preference_nightly_generated_091523",
      fingerprint: "04b981e98c18a75a0ff42257fd894d959634e57b5c2819b8a92928bc0e842ba9",
      review_status: "manual_confirmed",
    },
    {
      source_path: "memory/smart-add/2026-06-24.md",
      block_id: "2026-06-23_episodic_nightly_generated_091523",
      fingerprint: "3f503661019b1bb39b52571773a6e39eed6d77b6e270edefc8500f7d567df567",
      review_status: "manual_confirmed",
    },
    {
      source_path: "memory/smart-add/2026-06-24.md",
      block_id: "2026-06-24_episodic_nightly_generated_151036",
      fingerprint: "87c081eddbd6037e8f19c755ccdcc677c6b214b46092fb668541e58a0dc29a35",
      review_status: "manual_confirmed",
    },
  ]);

  const result = applyConfirmedSmartAddPropagationStaleChunkCleanup({
    ...defaultOptions(fixture),
    confirm: CONFIRMED_SMART_ADD_PROPAGATION_STALE_CLEANUP_CONFIRM_TOKEN,
  });

  assert.equal(existsSync(result.backup_path), true);
  assert.equal(result.deleted_chunk_count, 3);
  assert.equal(result.deleted_fts_row_count, 3);
  assert.equal(result.deleted_confidence_row_count, 3);
  assert.equal(result.post_apply_confirmed_stale_chunk_count, 0);
  assert.equal(result.post_apply_confirmed_stale_fts_row_count, 0);
  assert.equal(result.post_apply_marker_residual_counts.chunk_rows, 0);
  assert.equal(result.post_apply_marker_residual_counts.fts_rows, 0);
  assert.equal(countById(fixture.coreDbPath, "chunks", "id", "stale-prefix"), 0);
  assert.equal(countById(fixture.coreDbPath, "chunks_fts", "id", "stale-87"), 0);
  assert.equal(countById(fixture.engineDbPath, "memory_confidence", "chunk_id", "stale-3f"), 0);
  assert.equal(countById(fixture.coreDbPath, "chunks", "id", "clean-opencode"), 1);
  assert.equal(countById(fixture.coreDbPath, "chunks_fts", "id", "clean-opencode"), 1);
  assert.equal(countById(fixture.engineDbPath, "memory_confidence", "chunk_id", "clean-opencode"), 1);
});

test("dry-run ignores same-path clean OpenCode raw_log chunk without confirmed marker", () => {
  const fixture = createFixture();
  insertChunk(fixture.coreDbPath, {
    id: "clean-opencode",
    path: "memory/smart-add/2026-06-24.md",
    text: "raw_log transcript with OpenCode and OPENCODE_API_KEY only",
  });

  const report = collectConfirmedSmartAddPropagationStaleChunksDryRun(defaultOptions(fixture));

  assert.equal(report.confirmed_stale_chunk_count, 0);
  assert.equal(report.clean_keyword_residuals_ignored.length, 1);
  assert.equal(report.clean_keyword_residuals_ignored[0].chunk_id, "clean-opencode");
});

test("apply does not create orphan confidence when memory_confidence table exists", () => {
  const fixture = createFixture();
  insertChunk(fixture.coreDbPath, {
    id: "stale-prefix",
    path: "memory/smart-add/2026-06-24.md",
    text: "## 2026-06-23_episodic_nightly_generated_091523\n污染块",
  });
  insertConfidence(fixture.engineDbPath, "stale-prefix");
  writeQuarantineLog(fixture.quarantineDir, [
    {
      source_path: "memory/smart-add/2026-06-24.md",
      block_id: "2026-06-23_episodic_nightly_generated_091523",
      fingerprint: "3f503661019b1bb39b52571773a6e39eed6d77b6e270edefc8500f7d567df567",
      review_status: "manual_confirmed",
    },
  ]);

  const result = applyConfirmedSmartAddPropagationStaleChunkCleanup({
    ...defaultOptions(fixture),
    confirm: CONFIRMED_SMART_ADD_PROPAGATION_STALE_CLEANUP_CONFIRM_TOKEN,
  });

  assert.equal(result.memory_confidence_cleanup_strategy, "deleted_matching_chunk_ids");
  assert.equal(countById(fixture.engineDbPath, "memory_confidence", "chunk_id", "stale-prefix"), 0);
});

test("apply reports confidence cleanup skipped when schema is not applicable", () => {
  const fixture = createFixture({ withConfidenceTable: false });
  insertChunk(fixture.coreDbPath, {
    id: "stale-prefix",
    path: "memory/smart-add/2026-06-24.md",
    text: "## 2026-06-23_episodic_nightly_generated_091523\n污染块",
  });
  writeQuarantineLog(fixture.quarantineDir, [
    {
      source_path: "memory/smart-add/2026-06-24.md",
      block_id: "2026-06-23_episodic_nightly_generated_091523",
      fingerprint: "3f503661019b1bb39b52571773a6e39eed6d77b6e270edefc8500f7d567df567",
      review_status: "manual_confirmed",
    },
  ]);

  const result = applyConfirmedSmartAddPropagationStaleChunkCleanup({
    ...defaultOptions(fixture),
    confirm: CONFIRMED_SMART_ADD_PROPAGATION_STALE_CLEANUP_CONFIRM_TOKEN,
  });

  assert.equal(result.deleted_chunk_count, 1);
  assert.equal(result.deleted_confidence_row_count, 0);
  assert.equal(result.memory_confidence_cleanup_strategy, "memory_confidence_missing_skip_confidence_cleanup");
  assert.equal(readFileSync(resolve(fixture.smartAddDir, "2026-06-24.md"), "utf8").includes("OpenCode"), true);
});
