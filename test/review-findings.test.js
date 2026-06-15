import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMemoryEngineExecute } from "../lib/tools/memory-engine-actions.js";
import { batchReinforce, resolvePrefixes } from "../lib/memory-confidence.js";

test("hybrid search SQL uses bound LIMIT parameters and no silent catch blocks", () => {
  const source = readFileSync(new URL("../lib/recall/hybrid-search.js", import.meta.url), "utf8");

  assert.equal(/\bLIMIT\s+\$\{/.test(source), false);
  assert.equal(/\bcatch\s*\{\s*\}/.test(source), false);
});

test("disabled image_vision tool is not advertised or registered", () => {
  const manifest = JSON.parse(readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"));
  const indexSource = readFileSync(new URL("../index.js", import.meta.url), "utf8");

  assert.deepEqual(manifest.contracts.tools, ["memory_engine"]);
  assert.equal(indexSource.includes('name: "image_vision"'), false);
});

test("autoRecall hook does not emit verbose console debug logs by default", () => {
  const indexSource = readFileSync(new URL("../index.js", import.meta.url), "utf8");

  assert.equal(indexSource.includes("[memory-engine] autoRecall.debug"), false);
  assert.equal(indexSource.includes("[memory-engine] AUTO_RECALL_GATE_ACTIVE"), false);
  assert.equal(indexSource.includes("[memory-engine] supplement.injected"), false);
});

test("resolvePrefixes picks a deterministic newest active match per prefix", () => {
  const sqlSeen = [];
  const db = {
    prepare(sql) {
      sqlSeen.push(String(sql));
      return {
        all(prefix) {
          assert.equal(prefix, "abc");
          return [{ chunk_id: "abcdef-newest" }];
        },
      };
    },
  };

  assert.deepEqual(resolvePrefixes(db, ["abc"]), ["abcdef-newest"]);
  assert.match(sqlSeen[0], /is_archived\s*=\s*0/);
  assert.match(sqlSeen[0], /ORDER BY\s+last_confidence_update\s+DESC/i);
});

test("batchReinforce only updates active memories and clears stale conflict flags", () => {
  let sqlSeen = "";
  const calls = [];
  const stmt = {
    changes: 0,
    run(nowSec, id) {
      calls.push({ nowSec, id });
      this.changes = id === "active-id" ? 1 : 0;
    },
  };
  const db = {
    prepare(sql) {
      sqlSeen = String(sql);
      return stmt;
    },
    transaction(fn) {
      return fn;
    },
  };

  const changed = batchReinforce(db, ["active-id", "archived-id"], 1810000000);

  assert.equal(changed, 1);
  assert.match(sqlSeen, /conflict_flag\s*=\s*0/);
  assert.match(sqlSeen, /is_archived\s*=\s*0/);
  assert.deepEqual(calls, [
    { nowSec: 1810000000, id: "active-id" },
    { nowSec: 1810000000, id: "archived-id" },
  ]);
});

test("detect-conflicts ignores unrelated memories in the same category", async () => {
  const flagged = [];
  const execute = createMemoryEngineExecute({
    api: { config: {} },
    autoRouteCategory: () => "raw_log",
    dateStrInTimeZone: () => "2026-05-27",
    SMART_ADD_TIME_ZONE: "Asia/Shanghai",
    resolve: (...parts) => parts.join("/"),
    WORKSPACE: "/tmp/ws",
    SMART_ADD_DIR: "memory/smart-add",
    buildSmartAddFingerprint: () => "fingerprint",
    appendSmartAdd: () => ({ appended: true }),
    syncIndexIfNeeded: async () => ({}),
    catParams: () => ({ conf: 0.5, tau: 7 }),
    withDb: fn => fn({
      prepare(sql) {
        const query = String(sql);
        if (query.includes("FROM memory_confidence m1")) {
          return {
            all: () => [{
              id1: "old-theme-a",
              id2: "new-theme-b",
              category: "preference",
              c1: 0.2,
              c2: 0.9,
              h1: 0,
              h2: 8,
              text1: "user prefers vim keybindings and compact terminal output",
              text2: "project uses sqlite fts and lancedb vector recall",
            }],
          };
        }
        if (query.includes("UPDATE memory_confidence SET conflict_flag = 1")) {
          return {
            run: id => flagged.push(id),
          };
        }
        return { all: () => [], get: () => null, run: () => ({}) };
      },
      transaction: fn => fn,
    }),
    getLancedbTable: () => null,
    generateEmbedding: async () => [],
    recordMemoryEvent: () => {},
    getMemorySearchManager: async () => ({ manager: null }),
    calcRealtimeConf: () => 0,
    existsSync: () => false,
    readFileSync: () => "",
    KG_PATH: "/tmp/ws/knowledge-graph.json",
    resolvePrefixes: () => [],
    batchReinforce: () => 0,
    CATEGORY_MAP: {},
    calcTau: () => 0,
  });

  const result = await execute("t1", { action: "detect-conflicts" });

  assert.equal(result.flagged_as_conflict, 0);
  assert.deepEqual(flagged, []);
});
