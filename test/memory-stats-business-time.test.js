import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { getDefaultMemoryEngineConfig } from "../lib/config/defaults.js";

const require = createRequire(import.meta.url);
const businessTime = require("../lib/business-time.cjs");
const stats = require("../bin/memory-stats.js");

function makeRoot(prefix = "memory-engine-stats-business-time-") {
  return mkdtempSync(resolve(tmpdir(), prefix));
}

function createCoreDb(coreDbPath, rows) {
  const db = new Database(coreDbPath);
  try {
    db.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        source TEXT NOT NULL,
        model TEXT NOT NULL,
        embedding TEXT,
        updated_at INTEGER NOT NULL
      );
    `);
    const insert = db.prepare(`
      INSERT INTO chunks (id, path, source, model, embedding, updated_at)
      VALUES (?, ?, 'memory', 'fixture-model', '', ?)
    `);
    for (const row of rows) insert.run(row.id, row.path || `memory/${row.id}.md`, row.updatedAt);
  } finally {
    db.close();
  }
}

test("memory config default uses the shared business-time authority", () => {
  const defaults = getDefaultMemoryEngineConfig();
  assert.equal(defaults.timezone.business, businessTime.DEFAULT_BUSINESS_TIME_ZONE);

  const source = readFileSync(new URL("../lib/config/defaults.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /business:\s*["']Asia\/Shanghai["']/);
});

test("memory-stats resolves config, env, explicit, default, and invalid timezone values", () => {
  const root = makeRoot("memory-engine-stats-timezone-");
  const configJsonPath = resolve(root, "openclaw.json");
  const config = JSON.stringify({
    memoryEngine: { timezone: { business: "Asia/Singapore" } },
  });
  writeFileSync(configJsonPath, config);

  try {
    const base = { configJsonPath, homeDir: root, env: { MEMORY_ENGINE_TIME_ZONE: "" } };
    assert.equal(stats.resolveRuntime(base).timeZone, "Asia/Singapore");
    assert.equal(stats.resolveRuntime({
      ...base,
      env: { MEMORY_ENGINE_TIME_ZONE: "America/Los_Angeles" },
    }).timeZone, "America/Los_Angeles");
    assert.equal(stats.resolveRuntime({
      ...base,
      env: { MEMORY_ENGINE_TIME_ZONE: "America/Los_Angeles" },
      timeZone: "UTC",
    }).timeZone, "UTC");
    assert.equal(stats.resolveRuntime({
      ...base,
      configJsonPath: resolve(root, "missing.json"),
    }).timeZone, businessTime.DEFAULT_BUSINESS_TIME_ZONE);
    assert.throws(
      () => stats.resolveRuntime({
        ...base,
        configJsonPath,
        env: { MEMORY_ENGINE_TIME_ZONE: "Not/AZone" },
      }),
      error => error?.code === businessTime.INVALID_BUSINESS_TIME_ZONE,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("memory-stats date helper uses the injected business timezone, not host local time", () => {
  const instant = "2026-05-26T16:30:00.000Z";
  assert.equal(stats.todayDateStr(instant, "Asia/Shanghai"), "2026-05-27");
  assert.equal(stats.todayDateStr(instant, "Asia/Singapore"), "2026-05-27");
  assert.equal(stats.todayDateStr(instant, "UTC"), "2026-05-26");
});

test("yesterday_new uses an inclusive-exclusive previous business-day range", () => {
  const root = makeRoot();
  const coreDbPath = resolve(root, "core.sqlite");
  const engineDbPath = resolve(root, "engine", "engine.sqlite");
  const targetDate = "2026-06-18";
  const timeZone = "Asia/Shanghai";
  const range = businessTime.businessDateToUtcRange("2026-06-17", timeZone);
  createCoreDb(coreDbPath, [
    { id: "previous-start", updatedAt: range.startMs },
    { id: "previous-end-minus-one", updatedAt: range.endMs - 1 },
    { id: "exact-end", updatedAt: range.endMs },
  ]);

  try {
    const runtime = stats.resolveRuntime({
      coreDbPath,
      engineDbPath,
      workspaceDir: resolve(root, "workspace"),
      timeZone,
      env: { MEMORY_ENGINE_TIME_ZONE: "" },
    });
    stats.ensureStatsTable(runtime);
    const result = stats.collectWriteTriggers(targetDate, runtime);
    assert.equal(result.yesterdayNew, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("previous business-day range retains DST boundaries instead of assuming 24 hours", () => {
  const spring = stats.previousBusinessDayRange("2026-03-09", "America/New_York");
  const expected = businessTime.businessDateToUtcRange("2026-03-08", "America/New_York");
  assert.deepEqual(spring, expected);
  assert.equal(spring.endMs - spring.startMs, 23 * 60 * 60 * 1000);
});

test("explicit stats date remains authoritative in main", async () => {
  const root = makeRoot("memory-engine-stats-explicit-date-");
  const coreDbPath = resolve(root, "core.sqlite");
  const engineDbPath = resolve(root, "engine.sqlite");
  createCoreDb(coreDbPath, []);
  try {
    const result = await stats.main({
      coreDbPath,
      engineDbPath,
      workspaceDir: resolve(root, "workspace"),
      configJsonPath: resolve(root, "missing.json"),
      timeZone: "UTC",
      dateStr: "2026-01-02",
      now: "2026-09-02T00:30:00.000Z",
      env: { MEMORY_ENGINE_TIME_ZONE: "Asia/Tokyo" },
    });
    assert.equal(result.dateStr, "2026-01-02");
    assert.equal(result.runtime.timeZone, "UTC");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
