import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
  CORE_CHUNK_TIME_MIGRATION_CONFIRM_TOKEN,
  CORE_CHUNK_TIME_MIGRATION_PROVENANCE_GATE,
  applyCoreChunkTimeMigration,
  inspectCoreChunkTimeMigration,
} from "../lib/db/core-chunk-time-migration.js";

test("migration apply is denied by provenance gate even with legacy tokens", () => {
  assert.throws(
    () => applyCoreChunkTimeMigration({
      confirmToken: CORE_CHUNK_TIME_MIGRATION_CONFIRM_TOKEN,
      confirmUnrecoverableEventAtNulls: "ALLOW_UNRECOVERABLE_EVENT_AT_NULLS",
    }),
    new RegExp(CORE_CHUNK_TIME_MIGRATION_PROVENANCE_GATE),
  );
});

test("migration dry-run remains available and writes no DB", () => {
  const root = mkdtempSync(resolve(tmpdir(), "event-at-migration-suspension-"));
  const core = new Database(resolve(root, "core.sqlite"));
  core.exec("CREATE TABLE chunks (id TEXT PRIMARY KEY, text TEXT, updated_at INTEGER)");
  core.close();
  const engine = new Database(resolve(root, "engine.sqlite"));
  engine.exec("CREATE TABLE memory_confidence (chunk_id TEXT PRIMARY KEY, category TEXT)");
  engine.close();
  const report = inspectCoreChunkTimeMigration({
    coreDbPath: resolve(root, "core.sqlite"),
    engineDbPath: resolve(root, "engine.sqlite"),
    sessionsDir: resolve(root, "missing-sessions"),
  });
  assert.equal(report.mode, "dry_run");
  assert.equal(report.writes_db, false);
});

test("migration CLI apply is denied by the same provenance gate", () => {
  const result = spawnSync(process.execPath, [
    "bin/migrate-core-chunk-times.js",
    "--apply",
    "--confirm-core-time-migration",
    CORE_CHUNK_TIME_MIGRATION_CONFIRM_TOKEN,
  ], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(CORE_CHUNK_TIME_MIGRATION_PROVENANCE_GATE));
});
