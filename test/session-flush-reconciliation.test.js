import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const checkpoint = require("../bin/session-checkpoint.js");
const orphanRepair = require("../lib/checkpoint/orphan-repair.js");
const stableIdentity = require("../lib/db/stable-memory-identity.cjs");
const isolatedDbs = require("../lib/db/isolated-dbs.js");
const {
  MAX_ENGINE_INSERTS_PER_CYCLE,
  collectEligibleSessionFlushCoreRows,
  parseCanonicalSmartAddBlocks,
  reconcileSessionFlushManagedState,
} = require("../lib/checkpoint/session-flush-reconciliation.js");
const { MAX_LANCE_WRITES_PER_CYCLE } = require("../lib/checkpoint/orphan-repair.js");

function createFixture({ sourceFiles = {}, coreRows = [], confidenceRows = [] } = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-session-flush-reconcile-"));
  const workspaceDir = resolve(root, "workspace");
  const memoryDir = resolve(workspaceDir, "memory");
  const lancedbDir = resolve(root, "lancedb");
  const coreDbPath = resolve(root, "core.sqlite");
  const engineDbPath = resolve(root, "engine.sqlite");
  const configJsonPath = resolve(root, "openclaw.json");

  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(lancedbDir, { recursive: true });
  writeFileSync(configJsonPath, JSON.stringify({ models: { providers: { siliconflow: { apiKey: "fixture-key" } } } }));

  for (const [relativePath, content] of Object.entries(sourceFiles)) {
    const path = resolve(workspaceDir, relativePath);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }

  const core = new Database(coreDbPath);
  core.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      source TEXT NOT NULL,
      hash TEXT,
      text TEXT,
      updated_at INTEGER,
      start_line INTEGER,
      end_line INTEGER
    )
  `);
  const insertCore = core.prepare(
    "INSERT INTO chunks (id, path, source, hash, text, updated_at, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const row of coreRows) {
    insertCore.run(
      row.id,
      row.path,
      row.source ?? row.path,
      row.hash ?? null,
      row.text ?? "fixture text",
      row.updated_at ?? 1,
      row.start_line ?? null,
      row.end_line ?? null,
    );
  }
  core.close();

  const engine = new Database(engineDbPath);
  engine.exec(`
    CREATE TABLE memory_confidence (
      chunk_id TEXT PRIMARY KEY,
      initial_confidence REAL NOT NULL DEFAULT 0.5,
      confidence REAL NOT NULL DEFAULT 0.5,
      last_confidence_update INTEGER,
      base_tau REAL NOT NULL DEFAULT 7.0,
      hit_count INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      is_protected INTEGER NOT NULL DEFAULT 0,
      conflict_flag INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'raw_log',
      kg_data TEXT
    )
  `);
  const insertConfidence = engine.prepare(`
    INSERT INTO memory_confidence
      (chunk_id, initial_confidence, confidence, last_confidence_update,
       base_tau, hit_count, is_archived, is_protected, conflict_flag, category, kg_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of confidenceRows) {
    insertConfidence.run(
      row.chunk_id,
      row.initial_confidence ?? 0.5,
      row.confidence ?? 0.5,
      row.last_confidence_update ?? 1,
      row.base_tau ?? 7,
      row.hit_count ?? 0,
      row.is_archived ?? 0,
      row.is_protected ?? 0,
      row.conflict_flag ?? 0,
      row.category ?? "raw_log",
      row.kg_data ?? null,
    );
  }
  engine.close();

  return {
    root,
    workspaceDir,
    memoryDir,
    lancedbDir,
    coreDbPath,
    engineDbPath,
    configJsonPath,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function withFixtureRuntime(fixture, fn, overrides = {}) {
  return checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    memoryDir: fixture.memoryDir,
    lancedbDir: fixture.lancedbDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    configJsonPath: fixture.configJsonPath,
    timeZone: "Asia/Shanghai",
    now: () => 1700000000000,
    syncCoreMemoryIndex: async ({ targetDate }) => completeCoreIndexResult(targetDate),
    ...overrides,
  }, fn);
}

function completeCoreIndexResult(targetDate) {
  return {
    ok: true,
    index_invocation: { status: "succeeded", via: "isolated_fixture" },
    target_date_coverage: {
      status: "complete",
      target_date: targetDate,
      path: `memory/smart-add/${targetDate}.md`,
      required_fingerprints: 1,
      matched_fingerprints: 1,
      missing_fingerprints: 0,
    },
  };
}

function readEngineRows(fixture, where = "1 = 1", params = []) {
  const db = new Database(fixture.engineDbPath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare(`SELECT * FROM memory_confidence WHERE ${where} ORDER BY chunk_id`).all(...params);
  } finally {
    db.close();
  }
}

function readCoreRows(fixture) {
  const db = new Database(fixture.coreDbPath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare("SELECT * FROM chunks ORDER BY id").all();
  } finally {
    db.close();
  }
}

function withPatchedRequireCache(moduleId, fakeExports, fn) {
  const resolved = require.resolve(moduleId);
  const previous = require.cache[resolved];
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: fakeExports };
  const finish = () => {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  };
  try {
    const result = fn();
    if (result && typeof result.then === "function") return result.finally(finish);
    finish();
    return result;
  } catch (error) {
    finish();
    throw error;
  }
}

function makeBlocksSource() {
  const lines = ["# Smart Added Memory", ""];
  const ranges = {};
  const addBlock = (id, category, provenance, body) => {
    const startLine = lines.length + 1;
    lines.push(`## ${id}`, "", `Category: ${category}`);
    if (provenance !== null) lines.push(`Provenance: ${provenance}`);
    lines.push("", ...String(body).split("\n"), "");
    ranges[id] = { startLine, endLine: lines.length };
  };
  addBlock("session_entry", "raw_log", "session_flush", "session answer-bearing body");
  addBlock("manual_entry", "raw_log", "manual", "manual body");
  addBlock("agent_entry", "raw_log", "agent_smart_add", "agent body");
  addBlock("unknown_entry", "raw_log", null, "unknown body");
  return { content: `${lines.join("\n")}\n`, ranges };
}

function makeR3ShapedSource() {
  const lines = [
    "# Smart Added Memory",
    "",
    "## 2026-07-31T1930_raw_log_4bfc8d0c",
    "",
    "Category: raw_log",
    "Provenance: session_flush",
    "<!-- smart-add-fingerprint: b5df6dd6fdd1991631e2b3eb51d24ba342c0ba7c -->",
    "",
    "**User:** 制作7月值班表",
    "",
    "**Assistant:** 7月的值班表其实已经做好了。",
    "",
    "- 7月无法定假期，共 19 个值班日",
    "- 分配：Sol 5 天、郭兵 5 天、朱建新 4 天、麻卫东 5 天",
    "- 今天是 7月31日，按规则今天是制8月表的日子",
    "",
    "要不要我现在制作8月值班表？",
    "",
    "**User:** 把7月值班表发出来",
    "",
    "**Assistant:** 7月值班表如下：",
    "",
    "# 📋 2026年7月值班表",
    "",
    "**轮班顺序:** Sol → 郭兵 → 朱建新 → 麻卫东（循环）",
    "**规则:** 每天一人，周末及公休假期休息",
    "",
    "## 公共假期",
    "",
    "7月无法定公共假期。",
    "",
    "## 值班安排",
  ];
  while (lines.length < 67) lines.push(`| schedule row ${lines.length + 1} |`);
  lines.push("## 每人值班次数");
  while (lines.length < 79) lines.push(`| summary row ${lines.length + 1} |`);
  for (let line = 80; line <= 108; line += 1) lines.push(`answer-bearing line ${line}`);
  lines.push("", "", "## 后续值班表", "", "continuation after answer region");
  return {
    content: `${lines.join("\n")}\n`,
    answerRange: { startLine: 80, endLine: 108 },
  };
}

function makeNestedCanonicalEntriesSource() {
  const lines = ["# Smart Added Memory", ""];
  const addEntry = ({ id, category, provenance, body }) => {
    const startLine = lines.length + 1;
    lines.push(
      `## ${id}`,
      "",
      `Category: ${category}`,
      `Provenance: ${provenance}`,
      "<!-- smart-add-fingerprint: 0123456789abcdef0123456789abcdef -->",
      "",
      ...body,
      "",
    );
    return {
      startLine,
      endLine: lines.length,
      bodyStartLine: startLine + 6,
    };
  };

  const first = addEntry({
    id: "first_session_flush",
    category: "raw_log",
    provenance: "session_flush",
    body: [
      "first entry body before headings",
      "",
      "## First body section",
      "first section content",
      "",
      "## Second body section",
      "| key | value |",
      "| --- | --- |",
      "| answer | remains in first entry |",
    ],
  });
  const second = addEntry({
    id: "second_manual",
    category: "preference",
    provenance: "manual",
    body: ["second entry body"],
  });
  return { content: `${lines.join("\n")}\n`, first, second };
}

function makeBulkSource() {
  return {
    content: [
      "# Smart Added Memory",
      "",
      "## bulk_entry",
      "",
      "Category: raw_log",
      "Provenance: session_flush",
      "",
      "bulk body",
      "",
    ].join("\n"),
    range: { startLine: 8, endLine: 8 },
  };
}

function makeLanceStub({
  existingIds = [],
  totalRows = null,
  failAddIds = [],
  schemaColumns = ["id", "text", "vector", "timestamp"],
  vectorDimension = 3,
  existingFingerprints = {},
} = {}) {
  const ids = new Set(existingIds);
  const addedIds = [];
  const addedRows = [];
  const countRowsCalls = [];
  const selectCalls = [];
  const failSet = new Set(failAddIds);
  const rowsById = new Map([...ids].map(id => [id, {
    id,
    ...(Object.hasOwn(existingFingerprints, id) ? { embedding_fingerprint: existingFingerprints[id] } : {}),
  }]));
  const table = {
    async schema() {
      return {
        fields: schemaColumns.map(name => ({
          name,
          ...(name === "vector" ? { type: { listSize: vectorDimension } } : {}),
        })),
      };
    },
    async countRows() {
      countRowsCalls.push(true);
      return totalRows ?? ids.size;
    },
    query() {
      let predicate = "";
      const query = {
        where(value) {
          predicate = String(value);
          return query;
        },
        select(columns) {
          selectCalls.push([...columns]);
          return query;
        },
        limit() {
          return query;
        },
        async toArray() {
          const requested = [...predicate.matchAll(/'((?:''|[^'])*)'/g)]
            .map(match => match[1].replace(/''/g, "'"));
          return requested.filter(id => ids.has(id)).map(id => {
            const row = rowsById.get(id) || { id };
            return Object.fromEntries(Object.entries(row).filter(([key]) => selectCalls.at(-1)?.includes(key)));
          });
        },
      };
      return query;
    },
    async add(rows) {
      for (const row of rows) {
        if (failSet.has(row.id)) throw new Error(`add failed for ${row.id}`);
        if (ids.has(row.id)) throw new Error(`duplicate ${row.id}`);
        ids.add(row.id);
        addedIds.push(row.id);
        addedRows.push(row);
        rowsById.set(row.id, row);
      }
    },
  };
  return {
    exports: {
      connect: async () => ({ openTable: async () => table }),
    },
    state: { ids, addedIds, addedRows, countRowsCalls, selectCalls, rowsById },
  };
}

function scopedLance(fixture, engineResult, lancedb, options = {}) {
  const repairOptions = {
    scope: "session_flush",
    trigger: "nightly_checkpoint",
    eligibleCoreRows: engineResult.eligibleCoreRows,
    embedText: options.embedText || (async () => [0.1, 0.2, 0.3]),
  };
  if (options.getCanonicalMemoriesByIds) {
    repairOptions.getCanonicalMemoriesByIds = options.getCanonicalMemoriesByIds;
  }
  if (options.now) repairOptions.now = options.now;
  return withFixtureRuntime(fixture, () => withPatchedRequireCache(
    "@lancedb/lancedb",
    lancedb.exports,
    () => orphanRepair.repairOrphanVectors(repairOptions),
  ));
}

test("session_flush eligibility is deterministic, provenance-scoped, and fail-closed", async () => {
  const source = makeBlocksSource();
  const path = "memory/smart-add/2026-08-10.md";
  const fixture = createFixture({
    sourceFiles: { [path]: source.content },
    coreRows: [
      { id: "eligible", path, start_line: source.ranges.session_entry.startLine + 5, end_line: source.ranges.session_entry.endLine - 1, updated_at: 1 },
      { id: "manual", path, start_line: source.ranges.manual_entry.startLine + 5, end_line: source.ranges.manual_entry.endLine - 1, updated_at: 2 },
      { id: "agent", path, start_line: source.ranges.agent_entry.startLine + 5, end_line: source.ranges.agent_entry.endLine - 1, updated_at: 3 },
      { id: "unknown", path, start_line: source.ranges.unknown_entry.startLine + 5, end_line: source.ranges.unknown_entry.endLine, updated_at: 4 },
      { id: "cross-boundary", path, start_line: source.ranges.session_entry.startLine + 5, end_line: source.ranges.manual_entry.startLine, updated_at: 5 },
      { id: "missing-lines", path, start_line: null, end_line: null, updated_at: 6 },
      { id: "missing-source", path: "memory/smart-add/missing.md", start_line: 1, end_line: 2, updated_at: 7 },
      { id: "generated", path: "memory/generated-smart-add/2026-08-10.md", start_line: 1, end_line: 2, updated_at: 8 },
      { id: "episode", path: "memory/episodes/2026-08-10.md", start_line: 1, end_line: 2, updated_at: 9 },
    ],
  });
  try {
    const result = await withFixtureRuntime(fixture, () => reconcileSessionFlushManagedState({ nowSec: 123 }));
    assert.equal(result.eligible_core_examined, 7);
    assert.equal(result.eligible_session_flush, 1);
    assert.equal(result.excluded_non_session_flush, 5);
    assert.equal(result.ambiguous_chunk_count, 3);
    assert.equal(result.unmappable_chunk_count, 2);
    assert.deepEqual(result.eligibleCoreRows.map(row => row.id), ["eligible"]);
    assert.equal(result.engine_inserted, 1);
    assert.equal(result.stable_identity_state, "unmigrated");
    assert.equal(result.engine_converged, false);
  } finally {
    fixture.cleanup();
  }
});

test("target-date input can converge while historical ambiguity remains a reported backlog", async () => {
  const source = makeBlocksSource();
  const historicalPath = "memory/smart-add/2026-08-09.md";
  const targetPath = "memory/smart-add/2026-08-10.md";
  const fixture = createFixture({
    sourceFiles: {
      [historicalPath]: source.content,
      [targetPath]: source.content,
    },
    coreRows: [
      {
        id: "historical-ambiguous",
        path: historicalPath,
        start_line: source.ranges.session_entry.startLine + 5,
        end_line: source.ranges.manual_entry.startLine,
        updated_at: 1,
      },
      {
        id: "target-complete",
        path: targetPath,
        start_line: source.ranges.session_entry.startLine + 5,
        end_line: source.ranges.session_entry.endLine - 1,
        updated_at: 2,
      },
    ],
  });
  try {
    const result = await withFixtureRuntime(fixture, () => reconcileSessionFlushManagedState({
      targetDate: "2026-08-10",
      nowSec: 123,
    }));
    assert.equal(result.engine_converged, false);
    assert.equal(result.target_date_input_complete, true);
    assert.equal(result.target_date_backlog_remaining, 0);
    assert.equal(result.historical_ambiguous_chunk_count, 1);
  } finally {
    fixture.cleanup();
  }
});

test("target-date reconciliation shares the raw-log timestamp candidate set, not the filename date", async () => {
  const source = makeBlocksSource();
  const oldFilenamePath = "memory/smart-add/2026-08-01.md";
  const targetFilenamePath = "memory/smart-add/2026-08-10.md";
  const fixture = createFixture({
    sourceFiles: {
      [oldFilenamePath]: source.content,
      [targetFilenamePath]: source.content,
    },
    coreRows: [
      {
        id: "timestamp-target-old-file",
        path: oldFilenamePath,
        start_line: source.ranges.session_entry.startLine + 5,
        end_line: source.ranges.session_entry.endLine - 1,
        updated_at: 1,
      },
      {
        id: "filename-target-outside-window",
        path: targetFilenamePath,
        start_line: source.ranges.session_entry.startLine + 5,
        end_line: source.ranges.manual_entry.startLine,
        updated_at: 2,
      },
    ],
  });
  try {
    const core = new Database(fixture.coreDbPath);
    core.exec("ALTER TABLE chunks ADD COLUMN event_at INTEGER");
    core.prepare("UPDATE chunks SET event_at = ? WHERE id = ?").run(
      Date.parse("2026-08-10T09:00:00+08:00") / 1000,
      "timestamp-target-old-file",
    );
    core.prepare("UPDATE chunks SET event_at = ? WHERE id = ?").run(
      Date.parse("2026-08-09T09:00:00+08:00") / 1000,
      "filename-target-outside-window",
    );
    core.close();

    const result = await withFixtureRuntime(fixture, () => reconcileSessionFlushManagedState({
      targetDate: "2026-08-10",
      nowSec: 123,
    }));
    assert.deepEqual(result.eligibleCoreRows.map(row => row.id), ["timestamp-target-old-file"]);
    assert.deepEqual(result.target_date_candidate_ids, ["timestamp-target-old-file"]);
    assert.equal(result.target_date_core_examined, 1);
    assert.equal(result.target_date_eligible_session_flush, 1);
    assert.equal(result.target_date_input_complete, true);
    assert.equal(result.target_date_backlog_remaining, 0);
  } finally {
    fixture.cleanup();
  }
});

test("checkpoint sends target-date-complete input to LLM despite historical ambiguity", async () => {
  const source = makeBlocksSource();
  const historicalPath = "memory/smart-add/2026-08-09.md";
  const targetPath = "memory/smart-add/2026-08-10.md";
  const fixture = createFixture({
    sourceFiles: {
      [historicalPath]: source.content,
      [targetPath]: source.content,
    },
    coreRows: [
      {
        id: "historical-ambiguous-main",
        path: historicalPath,
        start_line: source.ranges.session_entry.startLine + 5,
        end_line: source.ranges.manual_entry.startLine,
        updated_at: 1,
      },
      {
        id: "target-complete-main",
        path: targetPath,
        start_line: source.ranges.session_entry.startLine + 5,
        end_line: source.ranges.session_entry.endLine - 1,
        updated_at: 2,
      },
    ],
  });
  let llmCalls = 0;
  const order = [];
  try {
    await withFixtureRuntime(fixture, () => checkpoint.main(["--target-date", "2026-08-10"]), {
      flushCheckpointRawLog: () => { order.push("flush"); return { ok: true }; },
      syncCoreMemoryIndex: async ({ targetDate }) => { order.push("core_index"); return completeCoreIndexResult(targetDate); },
      readCheckpointRawLogs: () => { order.push("collect"); return [{ source: "conversation", category: "raw_log", text: "**User:** hello" }]; },
      llmNightlyExtract: async input => {
        order.push("llm");
        llmCalls += 1;
        return require("./checkpoint-fact-fixture.cjs").factResponse(input);
      },
      reconcileSessionFlushManagedState: async options => {
        order.push("engine");
        return reconcileSessionFlushManagedState(options);
      },
      repairOrphanVectors: async () => ({ lance_added: 0, lance_converged: true }),
      resolveConfigConflicts: () => 0,
    });
    assert.equal(llmCalls, 1);
    assert.deepEqual(order, ["flush", "core_index", "engine", "collect", "llm"]);
  } finally {
    fixture.cleanup();
  }
});

test("R3-shaped answer-bearing lines 80-108 are eligible", async () => {
  const source = makeR3ShapedSource();
  const path = "memory/smart-add/2026-07-31.md";
  const fixture = createFixture({
    sourceFiles: { [path]: source.content },
    coreRows: [{
      id: "r3-shaped-answer",
      path,
      text: "answer-bearing fixture",
      updated_at: 1,
      start_line: source.answerRange.startLine,
      end_line: source.answerRange.endLine,
    }],
  });
  try {
    const result = await withFixtureRuntime(fixture, () => reconcileSessionFlushManagedState({ nowSec: 321 }));
    assert.equal(result.eligible_core_examined, 1);
    assert.equal(result.eligible_session_flush, 1);
    assert.deepEqual(result.eligibleCoreRows.map(row => row.id), ["r3-shaped-answer"]);
    assert.equal(result.excluded_non_session_flush, 0);
    assert.equal(result.ambiguous_chunk_count, 0);
    assert.equal(result.engine_inserted, 1);
    assert.equal(result.engine_converged, true);
  } finally {
    fixture.cleanup();
  }
});

test("canonical boundaries ignore nested H2 headings and keep cross-entry chunks ambiguous", () => {
  const source = makeNestedCanonicalEntriesSource();
  const blocks = parseCanonicalSmartAddBlocks(source.content);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map(block => block.entryId), ["first_session_flush", "second_manual"]);
  assert.equal(blocks[0].category, "raw_log");
  assert.equal(blocks[0].provenance, "session_flush");
  assert.equal(blocks[1].category, "preference");
  assert.equal(blocks[1].provenance, "manual");
  assert.match(blocks[0].raw, /## First body section/);
  assert.match(blocks[0].raw, /## Second body section/);
  assert.equal(blocks[0].endLine, source.second.startLine - 1);

  const fixture = createFixture({
    sourceFiles: { "memory/smart-add/nested.md": source.content },
    coreRows: [
      {
        id: "nested-eligible",
        path: "memory/smart-add/nested.md",
        start_line: source.first.bodyStartLine,
        end_line: source.first.endLine - 1,
        updated_at: 1,
      },
      {
        id: "nested-manual",
        path: "memory/smart-add/nested.md",
        start_line: source.second.bodyStartLine,
        end_line: source.second.endLine - 1,
        updated_at: 2,
      },
      {
        id: "nested-cross-entry",
        path: "memory/smart-add/nested.md",
        start_line: source.first.bodyStartLine,
        end_line: source.second.bodyStartLine,
        updated_at: 3,
      },
    ],
  });
  try {
    const result = collectEligibleSessionFlushCoreRows({
      getRuntimeImpl: () => ({ workspaceDir: fixture.workspaceDir }),
      withCoreDb: fn => isolatedDbs.withCoreDbReadonly(fn, { coreDbPath: fixture.coreDbPath }),
    });
    assert.equal(result.eligible_core_examined, 3);
    assert.equal(result.eligible_session_flush, 1);
    assert.deepEqual(result.eligibleCoreRows.map(row => row.id), ["nested-eligible"]);
    assert.equal(result.excluded_non_session_flush, 1);
    assert.equal(result.ambiguous_chunk_count, 1);
    assert.equal(result.unmappable_chunk_count, 0);
  } finally {
    fixture.cleanup();
  }
});

test("generated-smart-add and episode paths are excluded even when their blocks say session_flush", async () => {
  const source = makeBlocksSource();
  const fixture = createFixture({
    sourceFiles: {
      "memory/generated-smart-add/generated.md": source.content,
      "memory/episodes/episode.md": source.content,
    },
    coreRows: [
      { id: "generated", path: "memory/generated-smart-add/generated.md", start_line: 5, end_line: 6, updated_at: 1 },
      { id: "episode", path: "memory/episodes/episode.md", start_line: 5, end_line: 6, updated_at: 2 },
    ],
  });
  try {
    const result = await withFixtureRuntime(fixture, () => reconcileSessionFlushManagedState({ nowSec: 1 }));
    assert.equal(result.eligible_core_examined, 0);
    assert.equal(result.eligible_session_flush, 0);
    assert.equal(result.excluded_non_session_flush, 2);
    assert.equal(result.engine_inserted, 0);
    assert.equal(result.engine_converged, true);
  } finally {
    fixture.cleanup();
  }
});

test("new Engine rows reuse raw_log initialization and existing lifecycle state is preserved", async () => {
  const source = makeBlocksSource();
  const path = "memory/smart-add/state.md";
  const eligible = source.ranges.session_entry;
  const fixture = createFixture({
    sourceFiles: { [path]: source.content },
    coreRows: [
      { id: "missing", path, start_line: eligible.startLine + 5, end_line: eligible.endLine - 1, updated_at: 1 },
      { id: "existing", path, start_line: eligible.startLine + 5, end_line: eligible.endLine - 1, updated_at: 2 },
    ],
    confidenceRows: [{
      chunk_id: "existing",
      initial_confidence: 0.91,
      confidence: 0.37,
      last_confidence_update: 88,
      base_tau: 91,
      hit_count: 7,
      is_archived: 1,
      is_protected: 1,
      conflict_flag: 1,
      category: "preference",
      kg_data: "{\"history\":true}",
    }],
  });
  try {
    const before = readEngineRows(fixture);
    const first = await withFixtureRuntime(fixture, () => reconcileSessionFlushManagedState({ nowSec: 999 }));
    assert.equal(first.engine_existing, 1);
    assert.equal(first.engine_inserted, 1);
    const inserted = readEngineRows(fixture, "chunk_id = ?", ["missing"])[0];
    assert.deepEqual({
      initial_confidence: inserted.initial_confidence,
      confidence: inserted.confidence,
      last_confidence_update: inserted.last_confidence_update,
      base_tau: inserted.base_tau,
      is_protected: inserted.is_protected,
      category: inserted.category,
    }, {
      initial_confidence: 0.5,
      confidence: 0.5,
      last_confidence_update: 999,
      base_tau: 7,
      is_protected: 0,
      category: "raw_log",
    });
    const second = await withFixtureRuntime(fixture, () => reconcileSessionFlushManagedState({ nowSec: 1000 }));
    assert.equal(second.engine_inserted, 0);
    assert.deepEqual(readEngineRows(fixture, "chunk_id = ?", ["existing"])[0], before[0]);
  } finally {
    fixture.cleanup();
  }
});

test("Engine reconciliation is capped at 500 and advances oldest backlog without starvation", async () => {
  assert.equal(MAX_ENGINE_INSERTS_PER_CYCLE, 500);
  const source = makeBulkSource();
  const path = "memory/smart-add/bulk.md";
  const coreRows = [];
  for (let i = 0; i <= 500; i += 1) {
    coreRows.push({
      id: `old-${String(i).padStart(3, "0")}`,
      path,
      start_line: source.range.startLine,
      end_line: source.range.endLine,
      updated_at: 1000 + i,
    });
  }
  for (let i = 0; i < 500; i += 1) {
    coreRows.push({
      id: `new-${String(i).padStart(3, "0")}`,
      path,
      start_line: source.range.startLine,
      end_line: source.range.endLine,
      updated_at: 2000 + i,
    });
  }
  const fixture = createFixture({ sourceFiles: { [path]: source.content }, coreRows });
  try {
    const first = await withFixtureRuntime(fixture, () => reconcileSessionFlushManagedState({ nowSec: 1 }));
    assert.equal(first.engine_inserted, 500);
    assert.equal(first.engine_backlog_remaining, 501);
    assert.equal(first.engine_converged, false);
    assert.equal(readEngineRows(fixture).some(row => row.chunk_id === "old-500"), false);

    const second = await withFixtureRuntime(fixture, () => reconcileSessionFlushManagedState({ nowSec: 2 }));
    assert.equal(second.engine_inserted, 500);
    assert.equal(second.engine_backlog_remaining, 1);
    assert.equal(readEngineRows(fixture).some(row => row.chunk_id === "old-500"), true);

    const third = await withFixtureRuntime(fixture, () => reconcileSessionFlushManagedState({ nowSec: 3 }));
    assert.equal(third.engine_inserted, 1);
    assert.equal(third.engine_backlog_remaining, 0);
    assert.equal(third.engine_converged, true);
  } finally {
    fixture.cleanup();
  }
});

test("Core access remains readonly and is closed before Engine writes", async () => {
  const source = makeBlocksSource();
  const path = "memory/smart-add/readonly.md";
  const range = source.ranges.session_entry;
  const fixture = createFixture({
    sourceFiles: { [path]: source.content },
    coreRows: [{ id: "readonly", path, start_line: range.startLine + 5, end_line: range.endLine - 1, updated_at: 1 }],
  });
  const events = [];
  try {
    const result = await withFixtureRuntime(fixture, () => reconcileSessionFlushManagedState({
      nowSec: 1,
      withCoreDb: fn => {
        events.push("core-open");
        const value = isolatedDbs.withCoreDbReadonly(fn, {
          coreDbPath: fixture.coreDbPath,
          engineDbPath: fixture.engineDbPath,
        });
        events.push("core-closed");
        return value;
      },
      withEngineDb: fn => {
        events.push("engine-open");
        const value = isolatedDbs.withEngineDbIsolated(fn, {
          coreDbPath: fixture.coreDbPath,
          engineDbPath: fixture.engineDbPath,
          readonly: false,
        });
        events.push("engine-closed");
        return value;
      },
    }));
    assert.equal(result.engine_inserted, 1);
    assert.deepEqual(events, ["core-open", "core-closed", "engine-open", "engine-closed"]);

    const core = new Database(fixture.coreDbPath, { readonly: true, fileMustExist: true });
    try {
      assert.throws(
        () => core.prepare("INSERT INTO chunks (id, path) VALUES ('blocked', 'memory/smart-add/a.md')").run(),
        error => error?.code === "SQLITE_READONLY",
      );
    } finally {
      core.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test("scoped Lance reconciliation is exact, active-only, oldest-first, and bounded at 10", async () => {
  assert.equal(MAX_LANCE_WRITES_PER_CYCLE, 10);
  const source = makeBulkSource();
  const path = "memory/smart-add/lance.md";
  const coreRows = [];
  for (let i = 0; i < 12; i += 1) {
    coreRows.push({
      id: `lance-${String(i).padStart(2, "0")}`,
      path,
      start_line: source.range.startLine,
      end_line: source.range.endLine,
      updated_at: 100 + i,
    });
  }
  const fixture = createFixture({
    sourceFiles: { [path]: source.content },
    coreRows,
    confidenceRows: [{ chunk_id: "unrelated-engine", is_archived: 0 }],
  });
  const lance = makeLanceStub({ existingIds: ["lance-00", "unrelated-engine"], totalRows: 1001 });
  try {
    const engine = await withFixtureRuntime(fixture, () => reconcileSessionFlushManagedState({ nowSec: 1 }));
    assert.equal(engine.engine_inserted, 12);
    const first = await scopedLance(fixture, engine, lance);
    assert.equal(first.lance_eligible, 12);
    assert.equal(first.lance_existing, 1);
    assert.equal(first.lance_missing_before, 11);
    assert.equal(first.lance_added, 10);
    assert.equal(first.lance_backlog_remaining, 1);
    assert.equal(first.lance_write_failed, 0);
    assert.equal(first.lance_operation_failed, 0);
    assert.equal(first.lance_limit_backlog_remaining, 1);
    assert.equal(first.lance_completion_state, "limit_backlog");
    assert.equal(first.lance_converged, false);
    // Use the real scoped repair result (including ok=false for capped
    // membership) at the checkpoint boundary, not a success-shaped stub.
    const summaryResult = await withFixtureRuntime(fixture, () => checkpoint.main([
      "--target-date", "2026-08-10",
    ]), {
      flushCheckpointRawLog: () => ({ ok: true }),
      reconcileSessionFlushManagedState: async () => ({
        ...engine, target_date_input_complete: true,
      }),
      readCheckpointRawLogs: () => [{
        source: "conversation", category: "raw_log", text: "**User:** controlled daily input",
      }],
      llmNightlyExtract: async input => require("./checkpoint-fact-fixture.cjs").factResponse(input),
      repairOrphanVectors: async () => first,
      resolveConfigConflicts: () => 0,
    });
    assert.equal(summaryResult.ok, true);
    assert.equal(summaryResult.businessStatus.summary_status, "valid_summary");
    assert.equal(summaryResult.businessStatus.vector_operation_status, "deferred_limit");
    assert.equal(summaryResult.businessStatus.vector_membership_complete, false);
    assert.equal(summaryResult.businessStatus.business_complete, false);
    assert.equal(summaryResult.businessStatus.vector_limit_backlog, 1);
    assert.deepEqual(lance.state.addedIds, [
      "lance-01", "lance-02", "lance-03", "lance-04", "lance-05",
      "lance-06", "lance-07", "lance-08", "lance-09", "lance-10",
    ]);
    assert.deepEqual(lance.state.countRowsCalls, []);
    assert.equal(lance.state.ids.has("unrelated-engine"), true);
    const second = await scopedLance(fixture, engine, lance);
    assert.equal(second.lance_added, 1);
    assert.equal(second.lance_existing, 11);
    assert.equal(second.lance_backlog_remaining, 0);
    assert.equal(second.lance_converged, true);
    assert.deepEqual(lance.state.addedIds, [
      "lance-01", "lance-02", "lance-03", "lance-04", "lance-05",
      "lance-06", "lance-07", "lance-08", "lance-09", "lance-10", "lance-11",
    ]);
  } finally {
    fixture.cleanup();
  }
});

test("scoped canonical batch failure counts capped backlog as unattempted, not failed", async () => {
  const source = makeBulkSource();
  const coreRows = Array.from({ length: 12 }, (_, index) => ({
    id: `batch-failure-${String(index).padStart(2, "0")}`,
    path: "memory/smart-add/batch-failure.md",
    start_line: source.range.startLine,
    end_line: source.range.endLine,
    updated_at: index + 1,
  }));
  const fixture = createFixture({
    sourceFiles: { "memory/smart-add/batch-failure.md": source.content },
    coreRows,
  });
  try {
    const engine = await withFixtureRuntime(fixture, () => reconcileSessionFlushManagedState({ nowSec: 10 }));
    const lance = makeLanceStub();
    const result = await scopedLance(fixture, engine, lance, {
      getCanonicalMemoriesByIds: ids => ({ ok: false, reason: "fixture_unavailable", results: [] }),
    });
    assert.equal(result.lance_failed, 10);
    assert.equal(result.lance_operation_failed, 10);
    assert.equal(result.lance_limit_backlog_remaining, 2);
    assert.equal(result.lance_backlog_remaining, 12);
    assert.equal(result.lance_membership_complete, false);
    assert.deepEqual(lance.state.addedIds, []);
  } finally {
    fixture.cleanup();
  }
});

test("scoped Lance uses stable entity_id and excludes unknown_legacy", async () => {
  const source = makeBlocksSource();
  const path = "memory/smart-add/stable-scope.md";
  const range = source.ranges.session_entry;
  const fixture = createFixture({
    sourceFiles: { [path]: source.content },
    coreRows: [{
      id: "stable-core-chunk",
      path,
      start_line: range.startLine + 5,
      end_line: range.endLine - 1,
      updated_at: 1,
    }],
  });
  try {
    const engineDb = new Database(fixture.engineDbPath);
    stableIdentity.ensureStableMemoryIdentityTables(engineDb, { addConfidenceColumns: true });
    engineDb.close();

    const engine = await withFixtureRuntime(fixture, () => reconcileSessionFlushManagedState({ nowSec: 10 }));
    assert.equal(engine.engine_inserted, 1);
    const active = readEngineRows(fixture)[0];
    assert.equal(typeof active.entity_id, "string");
    assert.ok(active.entity_id.length > 0);

    const lance = makeLanceStub();
    const first = await scopedLance(fixture, engine, lance, {
      getCanonicalMemoriesByIds: ids => ({
        ok: true,
        results: ids.map(id => ({
          memory_id: id,
          ok: true,
          memory: {
            memory_id: id,
            canonical_id: `canonical:${id}`,
            source: { text: `canonical-${id}` },
            content_ref: { content_hash: `sha256:${id}` },
          },
        })),
      }),
    });
    assert.equal(first.lance_added, 1);
    assert.deepEqual(lance.state.addedIds, [active.entity_id]);
    assert.equal(lance.state.ids.has("stable-core-chunk"), false);

    const engineDbAfter = new Database(fixture.engineDbPath);
    stableIdentity.transitionMemoryIdentity(engineDbAfter, active.entity_id, "unknown_legacy", { nowSec: 11 });
    engineDbAfter.close();
    const isolatedLance = makeLanceStub();
    let embeddingCalls = 0;
    const skipped = await scopedLance(fixture, engine, isolatedLance, {
      embedText: async () => {
        embeddingCalls += 1;
        return [0.1, 0.2, 0.3];
      },
    });
    assert.equal(skipped.lance_eligible, 0);
    assert.equal(skipped.lance_added, 0);
    assert.equal(embeddingCalls, 0);
    assert.deepEqual(isolatedLance.state.addedIds, []);
  } finally {
    fixture.cleanup();
  }
});

test("scoped membership recognizes legacy Core id and does not deduplicate by content hash", async () => {
  const source = makeBlocksSource();
  const path = "memory/smart-add/legacy-vector-id.md";
  const coreId = "legacy-core-vector-id";
  const fixture = createFixture({
    sourceFiles: { [path]: source.content },
    coreRows: [{
      id: coreId,
      path,
      start_line: source.ranges.session_entry.startLine + 5,
      end_line: source.ranges.session_entry.endLine - 1,
      updated_at: 1,
    }],
  });
  try {
    const engineDb = new Database(fixture.engineDbPath);
    stableIdentity.ensureStableMemoryIdentityTables(engineDb, { addConfidenceColumns: true });
    engineDb.close();
    const engine = await withFixtureRuntime(fixture, () => reconcileSessionFlushManagedState({ nowSec: 10 }));
    const entityId = readEngineRows(fixture)[0].entity_id;

    const legacyIdLance = makeLanceStub({ existingIds: [coreId] });
    const legacyIdResult = await scopedLance(fixture, engine, legacyIdLance, {
      getCanonicalMemoriesByIds: () => { throw new Error("existing legacy Core id must suppress a duplicate write"); },
    });
    assert.equal(legacyIdResult.lance_existing, 1);
    assert.equal(legacyIdResult.lance_added, 0);

    const bothIdsLance = makeLanceStub({ existingIds: [coreId, entityId] });
    const bothIdsResult = await scopedLance(fixture, engine, bothIdsLance, {
      getCanonicalMemoriesByIds: () => { throw new Error("either exact identity match must suppress another write"); },
    });
    assert.equal(bothIdsResult.lance_existing, 1);
    assert.equal(bothIdsResult.lance_added, 0);

    const unrelatedLance = makeLanceStub({ existingIds: ["unrelated-entity-same-content-hash"] });
    const unrelatedResult = await scopedLance(fixture, engine, unrelatedLance, {
      getCanonicalMemoriesByIds: ids => ({
        ok: true,
        results: ids.map(id => ({
          memory_id: id,
          ok: true,
          memory: {
            memory_id: id,
            canonical_id: `canonical:${id}`,
            source: { text: "same body is not identity" },
            content_ref: { content_hash: "identical-content-hash" },
          },
        })),
      }),
    });
    assert.equal(unrelatedResult.lance_added, 1);
    assert.deepEqual(unrelatedLance.state.addedIds, [entityId]);
  } finally {
    fixture.cleanup();
  }
});

test("scoped Lance projects old four-column rows and handles extended fingerprint schema conservatively", async () => {
  const source = makeBlocksSource();
  const path = "memory/smart-add/schema-projection.md";
  const coreId = "schema-projection-core";
  const fixture = createFixture({
    sourceFiles: { [path]: source.content },
    coreRows: [{
      id: coreId,
      path,
      start_line: source.ranges.session_entry.startLine + 5,
      end_line: source.ranges.session_entry.endLine - 1,
      updated_at: 1,
    }],
  });
  try {
    const engineDb = new Database(fixture.engineDbPath);
    stableIdentity.ensureStableMemoryIdentityTables(engineDb, { addConfidenceColumns: true });
    engineDb.close();
    const engine = await withFixtureRuntime(fixture, () => reconcileSessionFlushManagedState({ nowSec: 10 }));
    const entityId = readEngineRows(fixture)[0].entity_id;
    const extendedSchema = ["id", "text", "vector", "timestamp", "doc_uuid", "embedding_fingerprint"];

    const existingWithoutFingerprint = makeLanceStub({
      existingIds: [entityId],
      schemaColumns: extendedSchema,
      existingFingerprints: { [entityId]: "nonempty-but-untrusted" },
    });
    const alreadyPresent = await scopedLance(fixture, engine, existingWithoutFingerprint, {
      getCanonicalMemoriesByIds: () => { throw new Error("existing stable identity must not be duplicated"); },
    });
    assert.equal(alreadyPresent.fingerprint_verification, "unverified");
    assert.equal(alreadyPresent.fingerprint_verification_reason, "trusted_engine_fingerprint_missing");
    assert.equal(alreadyPresent.lance_membership_complete, true);
    assert.equal(alreadyPresent.lance_vector_validation_complete, false);
    assert.ok(existingWithoutFingerprint.state.selectCalls.some(columns => columns.includes("embedding_fingerprint")));
    assert.equal(alreadyPresent.lance_added, 0);

    const dimensionMismatch = makeLanceStub({ schemaColumns: extendedSchema });
    const mismatch = await scopedLance(fixture, engine, dimensionMismatch, {
      embedText: async () => [0.1, 0.2],
      getCanonicalMemoriesByIds: ids => ({
        ok: true,
        results: ids.map(id => ({
          memory_id: id,
          ok: true,
          memory: {
            memory_id: id,
            canonical_id: `canonical:${id}`,
            source: { text: "dimension check" },
            content_ref: { content_hash: "dimension-check-hash" },
          },
        })),
      }),
    });
    assert.equal(mismatch.lance_added, 0);
    assert.equal(mismatch.lance_operation_failed, 1);
    assert.equal(mismatch.lance_write_failed, 0);
    assert.equal(dimensionMismatch.state.addedRows.length, 0);

    const projectedOldSchema = makeLanceStub();
    const oldSchemaResult = await scopedLance(fixture, engine, projectedOldSchema, {
      getCanonicalMemoriesByIds: ids => ({
        ok: true,
        results: ids.map(id => ({
          memory_id: id,
          ok: true,
          memory: {
            memory_id: id,
            canonical_id: `canonical:${id}`,
            source: { text: "four column projection" },
            content_ref: { content_hash: "four-column-hash" },
          },
        })),
      }),
    });
    assert.equal(oldSchemaResult.fingerprint_verification, "unverified");
    assert.equal(oldSchemaResult.lance_membership_complete, true);
    assert.equal(oldSchemaResult.lance_vector_validation_complete, false);
    assert.deepEqual(Object.keys(projectedOldSchema.state.addedRows[0]).sort(), ["id", "text", "timestamp", "vector"]);

    const trustedVector = [0.1, 0.2, 0.3];
    const trustedFingerprint = stableIdentity.embeddingFingerprint(trustedVector);
    const updateIdentityFingerprint = fingerprint => {
      const db = new Database(fixture.engineDbPath);
      try {
        db.prepare("UPDATE memory_identity SET embedding_fingerprint = ? WHERE entity_id = ?")
          .run(fingerprint, entityId);
      } finally {
        db.close();
      }
    };
    updateIdentityFingerprint(trustedFingerprint);

    const verifiedExisting = makeLanceStub({
      existingIds: [entityId],
      schemaColumns: extendedSchema,
      existingFingerprints: { [entityId]: trustedFingerprint },
    });
    const verifiedExistingResult = await scopedLance(fixture, engine, verifiedExisting, {
      getCanonicalMemoriesByIds: () => { throw new Error("exact stable member should not be rewritten"); },
    });
    assert.equal(verifiedExistingResult.lance_membership_complete, true);
    assert.equal(verifiedExistingResult.lance_vector_validation_complete, true);
    assert.equal(verifiedExistingResult.lance_vector_validation_state, "verified");

    const conflictingExisting = makeLanceStub({
      existingIds: [entityId],
      schemaColumns: extendedSchema,
      existingFingerprints: { [entityId]: "different-fingerprint" },
    });
    const conflictingResult = await scopedLance(fixture, engine, conflictingExisting);
    assert.equal(conflictingResult.ok, false);
    assert.equal(conflictingResult.lance_membership_complete, true);
    assert.equal(conflictingResult.lance_vector_validation_state, "conflict");
    assert.equal(conflictingResult.lance_fingerprint_conflicts, 1);

    updateIdentityFingerprint(null);
    const extendedWrite = makeLanceStub({ schemaColumns: extendedSchema });
    const extendedResult = await scopedLance(fixture, engine, extendedWrite, {
      getCanonicalMemoriesByIds: ids => ({
        ok: true,
        results: ids.map(id => ({
          memory_id: id,
          ok: true,
          memory: {
            memory_id: id,
            canonical_id: `canonical:${id}`,
            source: { text: "extended schema write" },
            content_ref: { content_hash: "extended-schema-hash" },
          },
        })),
      }),
    });
    assert.equal(extendedResult.lance_added, 1);
    assert.equal(typeof extendedWrite.state.addedRows[0].embedding_fingerprint, "string");
    assert.equal(extendedResult.fingerprint_verification, "unverified");
    assert.equal(extendedResult.lance_membership_complete, true);
    assert.equal(extendedResult.lance_vector_validation_complete, false);

    updateIdentityFingerprint(trustedFingerprint);
    const verifiedWrite = makeLanceStub({ schemaColumns: extendedSchema });
    const verifiedWriteResult = await scopedLance(fixture, engine, verifiedWrite, {
      embedText: async () => trustedVector,
      getCanonicalMemoriesByIds: ids => ({
        ok: true,
        results: ids.map(id => ({
          memory_id: id,
          ok: true,
          memory: {
            memory_id: id,
            canonical_id: `canonical:${id}`,
            source: { text: "trusted extended schema write" },
            content_ref: { content_hash: "trusted-extended-schema-hash" },
          },
        })),
      }),
    });
    assert.equal(verifiedWriteResult.lance_vector_validation_complete, true);
    assert.equal(verifiedWriteResult.fingerprint_verification, "verified");
  } finally {
    fixture.cleanup();
  }
});

test("scoped Lance reports actual table.add failures separately from preparation failures", async () => {
  const source = makeBlocksSource();
  const path = "memory/smart-add/write-failure.md";
  const fixture = createFixture({
    sourceFiles: { [path]: source.content },
    coreRows: [{
      id: "write-fail",
      path,
      start_line: source.ranges.session_entry.startLine + 5,
      end_line: source.ranges.session_entry.endLine - 1,
      updated_at: 1,
    }],
  });
  try {
    const engine = await withFixtureRuntime(fixture, () => reconcileSessionFlushManagedState({ nowSec: 1 }));
    const lance = makeLanceStub({ failAddIds: ["write-fail"] });
    const result = await scopedLance(fixture, engine, lance, {
      getCanonicalMemoriesByIds: ids => ({
        ok: true,
        results: ids.map(id => ({
          memory_id: id,
          ok: true,
          memory: {
            memory_id: id,
            canonical_id: `canonical:${id}`,
            source: { text: "write failure" },
            content_ref: { content_hash: "write-failure-hash" },
          },
        })),
      }),
    });
    assert.equal(result.lance_write_failed, 1);
    assert.equal(result.lance_operation_failed, 0);
    assert.equal(result.lance_limit_backlog_remaining, 0);
    assert.equal(result.lance_completion_state, "write_failed");
  } finally {
    fixture.cleanup();
  }
});

test("post-migration confidence rows with NULL entity_id are repaired before scoped Lance", async () => {
  const source = makeBlocksSource();
  const path = "memory/smart-add/2026-08-10.md";
  const range = source.ranges.session_entry;
  const coreRows = [];
  const confidenceRows = [];
  for (let index = 0; index < 49; index += 1) {
    const id = `null-identity-${String(index).padStart(2, "0")}`;
    coreRows.push({
      id,
      path,
      start_line: range.startLine + 5,
      end_line: range.endLine - 1,
      updated_at: index + 1,
    });
    confidenceRows.push({ chunk_id: id });
  }
  const fixture = createFixture({ sourceFiles: { [path]: source.content }, coreRows, confidenceRows });
  try {
    const engineDb = new Database(fixture.engineDbPath);
    stableIdentity.ensureStableMemoryIdentityTables(engineDb, { addConfidenceColumns: true });
    engineDb.close();

    const engine = await withFixtureRuntime(fixture, () => reconcileSessionFlushManagedState({
      targetDate: "2026-08-10",
      nowSec: 10,
    }));
    assert.equal(engine.stable_identity_state, "migrated");
    assert.equal(engine.engine_missing_before, 0);
    assert.equal(engine.engine_identity_repaired, 49);
    assert.equal(engine.target_date_input_complete, true);
    const repaired = readEngineRows(fixture);
    assert.equal(repaired.length, 49);
    assert.equal(repaired.every(row => typeof row.entity_id === "string" && row.entity_id.length > 0), true);

    const lance = makeLanceStub();
    const scoped = await scopedLance(fixture, engine, lance, {
      getCanonicalMemoriesByIds: ids => ({
        ok: true,
        results: ids.map(id => ({
          memory_id: id,
          ok: true,
          memory: {
            memory_id: id,
            canonical_id: `canonical:${id}`,
            source: { text: `canonical-${id}` },
            content_ref: { content_hash: `sha256:${id}` },
          },
        })),
      }),
    });
    assert.equal(scoped.lance_added, 10);
    assert.equal(lance.state.addedIds.every(id => id.startsWith("null-identity-") === false), true);
    assert.equal(lance.state.addedIds.every(id => id.includes("-")), true);
    assert.equal(lance.state.ids.has("null-identity-00"), false);
  } finally {
    fixture.cleanup();
  }
});

test("partial stable identity schema fails closed before embedding or Lance writes", async () => {
  const source = makeBlocksSource();
  const path = "memory/smart-add/partial-schema.md";
  const fixture = createFixture({
    sourceFiles: { [path]: source.content },
    coreRows: [{
      id: "partial-core",
      path,
      start_line: source.ranges.session_entry.startLine + 5,
      end_line: source.ranges.session_entry.endLine - 1,
      updated_at: 1,
    }],
  });
  try {
    const engineDb = new Database(fixture.engineDbPath);
    engineDb.exec("ALTER TABLE memory_confidence ADD COLUMN entity_id TEXT");
    engineDb.exec("CREATE TABLE memory_identity (entity_id TEXT PRIMARY KEY)");
    engineDb.close();
    const engine = {
      eligibleCoreRows: [{ id: "partial-core", path, text: "partial" }],
      ok: true,
    };
    const lance = makeLanceStub();
    let embeddingCalls = 0;
    const result = await scopedLance(fixture, engine, lance, {
      embedText: async () => {
        embeddingCalls += 1;
        return [0.1, 0.2, 0.3];
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /schema incomplete/);
    assert.equal(embeddingCalls, 0);
    assert.deepEqual(lance.state.addedIds, []);
  } finally {
    fixture.cleanup();
  }
});

test("scoped Lance reconciliation resolves the selected ids through one canonical batch", async () => {
  const source = makeBulkSource();
  const path = "memory/smart-add/canonical-batch.md";
  const coreRows = [];
  for (let i = 0; i < 12; i += 1) {
    coreRows.push({
      id: `canonical-${String(i).padStart(2, "0")}`,
      path,
      text: `legacy fixture text ${i}`,
      start_line: source.range.startLine,
      end_line: source.range.endLine,
      updated_at: 100 + i,
    });
  }
  const fixture = createFixture({ sourceFiles: { [path]: source.content }, coreRows });
  const lance = makeLanceStub();
  const batchCalls = [];
  const embeddingInputs = [];
  try {
    const engine = await withFixtureRuntime(fixture, () => reconcileSessionFlushManagedState({ nowSec: 1 }));
    const first = await scopedLance(fixture, engine, lance, {
      getCanonicalMemoriesByIds: ids => {
        batchCalls.push(ids);
        return {
          ok: true,
          results: ids.map(id => ({
            memory_id: id,
            ok: true,
            memory: {
              memory_id: id,
              canonical_id: `cmem:core:${id}`,
              source: { text: `CANONICAL SOURCE ${id}` },
              content_ref: { content_hash: `sha256:${id}` },
            },
          })),
        };
      },
      embedText: async text => {
        embeddingInputs.push(text);
        return [0.1, 0.2, 0.3];
      },
    });

    assert.equal(batchCalls.length, 1);
    assert.equal(batchCalls[0].length, 10);
    assert.deepEqual(batchCalls[0], Array.from({ length: 10 }, (_, index) => (
      `canonical-${String(index).padStart(2, "0")}`
    )));
    assert.equal(first.lance_added, 10);
    assert.equal(first.lance_failed, 0);
    assert.equal(embeddingInputs.length, 10);
    assert.deepEqual(lance.state.addedIds, batchCalls[0]);
    assert.deepEqual(embeddingInputs, batchCalls[0].map(id => `CANONICAL SOURCE ${id}`));
  } finally {
    fixture.cleanup();
  }
});

test("scoped canonical failure skips only that id and keeps the sibling retryable", async () => {
  const source = makeBlocksSource();
  const path = "memory/smart-add/canonical-failure.md";
  const fixture = createFixture({
    sourceFiles: { [path]: source.content },
    coreRows: [
      {
        id: "canonical-fail",
        path,
        start_line: source.ranges.session_entry.startLine + 5,
        end_line: source.ranges.session_entry.endLine - 1,
        text: "legacy fail text",
      },
      {
        id: "canonical-ok",
        path,
        start_line: source.ranges.session_entry.startLine + 5,
        end_line: source.ranges.session_entry.endLine - 1,
        text: "legacy ok text",
      },
    ],
  });
  const lance = makeLanceStub();
  try {
    const engine = await withFixtureRuntime(fixture, () => reconcileSessionFlushManagedState({ nowSec: 1 }));
    const result = await scopedLance(fixture, engine, lance, {
      getCanonicalMemoriesByIds: ids => ({
        ok: true,
        results: ids.map(id => id === "canonical-fail"
          ? { memory_id: id, ok: false, memory: null, reason: "core_malformed" }
          : {
            memory_id: id,
            ok: true,
            memory: {
              memory_id: id,
              canonical_id: `cmem:core:${id}`,
              source: { text: "CANONICAL SIBLING TEXT" },
              content_ref: { content_hash: `sha256:${id}` },
            },
          }),
      }),
    });

    assert.equal(result.lance_added, 1);
    assert.equal(result.lance_failed, 1);
    assert.equal(result.lance_backlog_remaining, 1);
    assert.equal(result.lance_converged, false);
    assert.deepEqual(lance.state.addedIds, ["canonical-ok"]);
  } finally {
    fixture.cleanup();
  }
});

test("archived Engine rows are not vectorized and existing Lance IDs are not duplicated", async () => {
  const source = makeBlocksSource();
  const path = "memory/smart-add/archived.md";
  const range = source.ranges.session_entry;
  const fixture = createFixture({
    sourceFiles: { [path]: source.content },
    coreRows: [
      { id: "archived", path, start_line: range.startLine + 5, end_line: range.endLine - 1, updated_at: 1 },
      { id: "present", path, start_line: range.startLine + 5, end_line: range.endLine - 1, updated_at: 2 },
    ],
    confidenceRows: [
      { chunk_id: "archived", is_archived: 1 },
      { chunk_id: "present", is_archived: 0 },
    ],
  });
  const lance = makeLanceStub({ existingIds: ["present"] });
  try {
    const engine = await withFixtureRuntime(fixture, () => reconcileSessionFlushManagedState({ nowSec: 1 }));
    const result = await scopedLance(fixture, engine, lance);
    assert.equal(result.lance_eligible, 1);
    assert.equal(result.lance_existing, 1);
    assert.equal(result.lance_added, 0);
    assert.equal(result.lance_failed, 0);
    assert.equal(result.lance_converged, true);
    assert.deepEqual(lance.state.addedIds, []);
  } finally {
    fixture.cleanup();
  }
});

test("embedding failure preserves Engine state and leaves Lance work retryable", async () => {
  const source = makeBlocksSource();
  const path = "memory/smart-add/retry.md";
  const range = source.ranges.session_entry;
  const fixture = createFixture({
    sourceFiles: { [path]: source.content },
    coreRows: [
      { id: "retry-1", path, start_line: range.startLine + 5, end_line: range.endLine - 1, updated_at: 1 },
      { id: "retry-2", path, start_line: range.startLine + 5, end_line: range.endLine - 1, updated_at: 2 },
    ],
  });
  const lance = makeLanceStub();
  let calls = 0;
  try {
    const engine = await withFixtureRuntime(fixture, () => reconcileSessionFlushManagedState({ nowSec: 77 }));
    const first = await scopedLance(fixture, engine, lance, {
      embedText: async text => {
        calls += 1;
        if (calls === 1) throw new Error(`embedding unavailable for ${text}`);
        return [0.1, 0.2, 0.3];
      },
    });
    assert.equal(first.lance_added, 1);
    assert.equal(first.lance_failed, 1);
    assert.equal(first.lance_backlog_remaining, 1);
    assert.equal(first.lance_converged, false);
    const engineAfterFailure = readEngineRows(fixture);
    assert.deepEqual(engineAfterFailure.map(row => row.chunk_id), ["retry-1", "retry-2"]);
    assert.equal(engineAfterFailure.every(row => row.last_confidence_update === 77), true);

    const second = await scopedLance(fixture, engine, lance, {
      embedText: async () => [0.1, 0.2, 0.3],
    });
    assert.equal(second.lance_added, 1);
    assert.equal(second.lance_failed, 0);
    assert.equal(second.lance_backlog_remaining, 0);
    assert.equal(second.lance_converged, true);
  } finally {
    fixture.cleanup();
  }
});

test("scoped Lance labels truly empty input separately from a nonempty repair backlog", async () => {
  const fixture = createFixture();
  try {
    const lance = makeLanceStub();
    const result = await scopedLance(fixture, { eligibleCoreRows: [] }, lance);
    assert.equal(result.lance_input_state, "empty_input");
    assert.equal(result.lance_completion_state, "empty_input");
    assert.equal(result.lance_converged, true);
    assert.equal(lance.state.countRowsCalls.length, 0);
  } finally {
    fixture.cleanup();
  }
});

test("dry-run still flushes before reading but skips reconciliation and LLM", async () => {
  const fixture = createFixture();
  const calls = [];
  try {
    const result = await withFixtureRuntime(fixture, () => checkpoint.main([
      "--dry-run",
      "--target-date",
      "2026-08-10",
    ]), {
      flushCheckpointRawLog: () => {
        calls.push("flush");
        return { ok: true };
      },
      syncCoreMemoryIndex: async () => {
        calls.push("sync");
        throw new Error("dry-run must not invoke Core indexing");
      },
      readCheckpointRawLogs: () => {
        calls.push("collect");
        return [];
      },
      reconcileSessionFlushManagedState: async () => {
        calls.push("engine");
        throw new Error("dry-run must not reconcile Engine state");
      },
      llmNightlyExtract: async () => {
        calls.push("llm");
        throw new Error("dry-run must not invoke the model");
      },
    });
    assert.deepEqual(calls, ["flush", "collect"]);
    assert.deepEqual(result.flush, { performed: true, mayWriteSmartAddFiles: true });
  } finally {
    fixture.cleanup();
  }
});

test("checkpoint reaches reconciliation after no-data, skipped, and timeout nightly results", async () => {
  for (const scenario of ["no-data", "skipped", "timeout"]) {
    const fixture = createFixture();
    const order = [];
    try {
      const rawLogs = scenario === "no-data"
        ? []
        : scenario === "skipped"
          ? [{ source: "note", text: "note only", category: "raw_log" }]
          : [{ source: "conversation", text: "**User:** hello", category: "raw_log" }];
      const checkpointResult = await withFixtureRuntime(fixture, () => checkpoint.main(), {
        flushCheckpointRawLog: () => {
          order.push("flush");
          return { ok: true };
        },
        syncCoreMemoryIndex: async ({ targetDate }) => {
          order.push("sync");
          return completeCoreIndexResult(targetDate);
        },
        readCheckpointRawLogs: () => {
          order.push("collect");
          return rawLogs;
        },
        llmNightlyExtract: async () => {
          order.push("llm");
          if (scenario === "timeout") throw new Error("bounded timeout fixture");
          return { smart_memories: [], configs: [], episode_summary: "unused" };
        },
        reconcileSessionFlushManagedState: async () => {
          order.push("engine");
          return {
            eligibleCoreRows: [],
            engine_converged: true,
            target_date_input_complete: true,
            engine_identity_repaired: 49,
            engine_identity_missing_before: 49,
            engine_identity_missing_after: 0,
          };
        },
        repairOrphanVectors: async options => {
          assert.equal(options.scope, "session_flush");
          order.push("lance");
          return {
            lance_added: 0,
            lance_converged: true,
            lance_input_state: "empty_input",
            lance_completion_state: "empty_input",
          };
        },
        resolveConfigConflicts: () => {
          order.push("conflicts");
          return 0;
        },
      });
      const expected = scenario === "timeout"
        ? ["flush", "sync", "engine", "collect", "llm", "lance", "conflicts"]
        : ["flush", "sync", "engine", "collect", "lance", "conflicts"];
      assert.deepEqual(order, expected, scenario);
      assert.equal(checkpointResult.businessStatus.engine_identity_repaired, 49);
      assert.equal(checkpointResult.businessStatus.engine_identity_missing_before, 49);
      assert.equal(checkpointResult.businessStatus.engine_identity_missing_after, 0);
      assert.equal(checkpointResult.businessStatus.vector_completion, "empty_input");
      assert.equal(checkpointResult.businessStatus.status, scenario === "no-data"
        ? "empty_input"
        : scenario === "skipped" ? "placeholder_skipped" : "summary_invalid");
      assert.equal(checkpointResult.businessStatus.business_complete, false);
      if (scenario === "timeout") assert.equal(checkpointResult.ok, false);
    } finally {
      fixture.cleanup();
    }
  }
});

test("budget-clipped checkpoint reports input_incomplete instead of valid completion", async () => {
  const fixture = createFixture();
  let llmCalls = 0;
  const rawLogs = [{ source: "conversation", text: "**User:** covered portion", category: "raw_log" }];
  Object.defineProperty(rawLogs, "checkpointStats", {
    value: {
      budgetCoverageComplete: false,
      droppedByBudgetCount: 1,
      budgetTruncatedCount: 1,
      budgetUncoveredEntries: [{ entry_id: "session-entry", coverage: "truncated", original_chars: 90, included_chars: 60 }],
    },
  });
  try {
    const result = await withFixtureRuntime(fixture, () => checkpoint.main(["--target-date", "2026-08-10"]), {
      flushCheckpointRawLog: () => ({ ok: true }),
      syncCoreMemoryIndex: async ({ targetDate }) => completeCoreIndexResult(targetDate),
      reconcileSessionFlushManagedState: async () => ({
        eligibleCoreRows: [],
        target_date_input_complete: true,
        engine_converged: true,
      }),
      readCheckpointRawLogs: () => rawLogs,
      llmNightlyExtract: async () => {
        llmCalls += 1;
        return { smart_memories: [], configs: [], episode_summary: "must not be generated from clipped input" };
      },
      repairOrphanVectors: async () => ({
        ok: true,
        lance_converged: true,
        lance_membership_complete: true,
        lance_membership_state: "complete",
        lance_vector_validation_complete: false,
        lance_vector_validation_state: "unverified",
        lance_completion_state: "complete",
      }),
      resolveConfigConflicts: () => 0,
    });
    assert.equal(result.businessStatus.status, "input_incomplete");
    assert.equal(result.businessStatus.summary_status, "input_incomplete");
    assert.equal(result.businessStatus.business_complete, false);
    assert.equal(result.businessStatus.budget_coverage_complete, false);
    assert.equal(result.businessStatus.budget_uncovered_entries[0].entry_id, "session-entry");
    assert.equal(llmCalls, 0);
    assert.doesNotMatch(readFileSync(resolve(fixture.memoryDir, "episodes", "2026-08-10.md"), "utf8"), /must not be generated/);
  } finally {
    fixture.cleanup();
  }
});

test("Core index ingress failure blocks Engine and LLM completion", async () => {
  const fixture = createFixture();
  const calls = [];
  try {
    await assert.rejects(() => withFixtureRuntime(fixture, () => checkpoint.main(["--target-date", "2026-08-10"]), {
      flushCheckpointRawLog: () => { calls.push("flush"); return { ok: true }; },
      syncCoreMemoryIndex: async () => { calls.push("core_index"); throw new Error("index unavailable"); },
      reconcileSessionFlushManagedState: async () => {
        calls.push("engine");
        throw new Error("Engine must not run after Core ingress failure");
      },
      readCheckpointRawLogs: () => { calls.push("collect"); return []; },
      llmNightlyExtract: async () => { calls.push("llm"); throw new Error("LLM must not run"); },
    }), error => {
      assert.equal(error.businessStatus.status, "input_incomplete");
      assert.equal(error.businessStatus.core_ingestion, "failed");
      assert.match(error.message, /Core memory index ingress incomplete/);
      return true;
    });
    assert.deepEqual(calls, ["flush", "core_index", "collect"]);
  } finally {
    fixture.cleanup();
  }
});

test("Core query error preserves unknown target coverage counts and blocks Engine and LLM", async () => {
  const fixture = createFixture();
  const calls = [];
  const logs = [];
  const originalLog = console.log;
  const originalError = console.error;
  try {
    console.log = (...parts) => logs.push(parts.join(" "));
    console.error = (...parts) => logs.push(parts.join(" "));
    await assert.rejects(() => withFixtureRuntime(fixture, () => checkpoint.main(["--target-date", "2026-08-10"]), {
      flushCheckpointRawLog: () => { calls.push("flush"); return { ok: true }; },
      syncCoreMemoryIndex: async ({ targetDate }) => {
        calls.push("core_index");
        return {
          ok: false,
          index_invocation: { status: "succeeded", via: "isolated_fixture" },
          target_date_coverage: {
            status: "query_error",
            target_date: targetDate,
            path: `memory/smart-add/${targetDate}.md`,
            required_fingerprints: 4,
            matched_fingerprints: null,
            missing_fingerprints: null,
            reason: "target query failed",
          },
        };
      },
      reconcileSessionFlushManagedState: async () => {
        calls.push("engine");
        throw new Error("Engine must not run after Core query error");
      },
      readCheckpointRawLogs: () => { calls.push("collect"); return []; },
      llmNightlyExtract: async () => { calls.push("llm"); throw new Error("LLM must not run"); },
    }), error => {
      assert.equal(error.businessStatus.status, "input_incomplete");
      assert.equal(error.businessStatus.core_ingestion, "failed");
      assert.deepEqual(error.businessStatus.core_target_date_coverage_counts, {
        required_fingerprints: 4,
        matched_fingerprints: null,
        missing_fingerprints: null,
      });
      return true;
    });

    const coreLog = logs.find(line => line.startsWith("[checkpoint] Core index ingress "));
    const coreIngestion = JSON.parse(coreLog.slice("[checkpoint] Core index ingress ".length));
    assert.deepEqual({
      required_fingerprints: coreIngestion.target_date_coverage.required_fingerprints,
      matched_fingerprints: coreIngestion.target_date_coverage.matched_fingerprints,
      missing_fingerprints: coreIngestion.target_date_coverage.missing_fingerprints,
    }, {
      required_fingerprints: 4,
      matched_fingerprints: null,
      missing_fingerprints: null,
    });

    const businessLog = logs.find(line => line.startsWith("[checkpoint] Business status "));
    const businessStatus = JSON.parse(businessLog.slice("[checkpoint] Business status ".length));
    assert.deepEqual(businessStatus.core_target_date_coverage_counts, {
      required_fingerprints: 4,
      matched_fingerprints: null,
      missing_fingerprints: null,
    });
    assert.deepEqual(calls, ["flush", "core_index", "collect"]);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    fixture.cleanup();
  }
});

test("successful Core index invocation with failed target post-read blocks Engine reconciliation and LLM", async () => {
  for (const coverage of [
    { status: "read_error", reason: "target file post-read failed" },
    { status: "missing", reason: "target path has no indexed Core chunks" },
    { status: "stale", reason: "Core target path does not contain all current session_flush fingerprints" },
  ]) {
    const fixture = createFixture();
    const calls = [];
    try {
      await assert.rejects(() => withFixtureRuntime(fixture, () => checkpoint.main(["--target-date", "2026-08-10"]), {
        flushCheckpointRawLog: () => { calls.push("flush"); return { ok: true }; },
        syncCoreMemoryIndex: async ({ targetDate }) => {
          calls.push("core_index");
          return {
            ok: false,
            index_invocation: { status: "succeeded", via: "memory_manager" },
            target_date_coverage: {
              ...coverage,
              target_date: targetDate,
              path: `memory/smart-add/${targetDate}.md`,
              required_fingerprints: 1,
              matched_fingerprints: 0,
              missing_fingerprints: 1,
            },
          };
        },
        reconcileSessionFlushManagedState: async () => {
          calls.push("engine");
          throw new Error("Engine must not run without target Core coverage");
        },
        readCheckpointRawLogs: () => {
          calls.push("collect");
          return [{ source: "conversation", category: "raw_log", text: "fixture-only" }];
        },
        llmNightlyExtract: async () => {
          calls.push("llm");
          throw new Error("LLM must not run without target Core coverage");
        },
      }), error => {
        assert.equal(error.businessStatus.status, "input_incomplete");
        assert.equal(error.businessStatus.core_index_invocation, "succeeded");
        assert.equal(error.businessStatus.core_target_date_coverage, coverage.status);
        assert.match(error.message, /Core memory index ingress incomplete/);
        return true;
      });
      assert.deepEqual(calls, ["flush", "core_index", "collect"]);
    } finally {
      fixture.cleanup();
    }
  }
});

test("reconciliation failure is observable without claiming convergence or skipping conflicts", async () => {
  const fixture = createFixture();
  const order = [];
  try {
    await assert.rejects(() => withFixtureRuntime(fixture, () => checkpoint.main(), {
      readCheckpointRawLogs: () => [],
      flushCheckpointRawLog: () => {
        order.push("flush");
        return { ok: true };
      },
      reconcileSessionFlushManagedState: async () => {
        order.push("engine");
        throw new Error("engine maintenance unavailable");
      },
      repairOrphanVectors: async options => {
        assert.equal(options.scope, "session_flush");
        order.push("lance");
        return { lance_converged: false, lance_failed: 1 };
      },
      resolveConfigConflicts: () => {
        order.push("conflicts");
        return 0;
      },
    }), error => error?.code === "CHECKPOINT_INPUT_INCOMPLETE");
    assert.deepEqual(order, ["flush", "engine", "conflicts"]);
    const marker = readFileSync(resolve(fixture.memoryDir, "episodes", "2023-11-14.md"), "utf8");
    assert.match(marker, /session_flush reconciliation/);
    assert.match(marker, /engine maintenance unavailable/);
  } finally {
    fixture.cleanup();
  }
});

test("eligibility parser exposes canonical block boundaries and retrieval has no reconciliation call site", () => {
  const source = makeBlocksSource();
  const blocks = parseCanonicalSmartAddBlocks(source.content);
  assert.equal(blocks.find(block => block.entryId === "session_entry").provenance, "session_flush");
  assert.equal(blocks.find(block => block.entryId === "manual_entry").provenance, "manual");
  assert.ok(blocks.every(block => block.startLine <= block.endLine));

  const indexSource = readFileSync(resolve("index.js"), "utf8");
  assert.doesNotMatch(indexSource, /reconcileSessionFlushManagedState|scope:\s*["']session_flush/);
  assert.equal(existsSync(resolve("lib/recall/auto-recall-hook-lifecycle.js")), true);
});

test("scoped source and fixtures stay within the non-live test boundary", () => {
  const source = readFileSync(resolve("lib/checkpoint/session-flush-reconciliation.js"), "utf8");
  assert.match(source, /withCoreDbReadonly/);
  assert.match(source, /withEngineDbIsolated/);
  assert.doesNotMatch(source, /openclaw memory index|sync-memory-index|memory-engine sync/);
  assert.match(readFileSync(resolve("lib/checkpoint/orphan-repair.js"), "utf8"), /withEngineDbIsolated/);
});
