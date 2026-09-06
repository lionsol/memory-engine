import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { buildLiteralPrefixGlob } from "../lib/id-prefix-resolution.js";

function queryPlan(db, sql, value) {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(value)
    .map(row => String(row.detail || ""))
    .join("\n");
}

test("literal prefix glob preserves SQLite wildcard characters as data", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE memory_confidence (chunk_id TEXT PRIMARY KEY)");
    const insert = db.prepare("INSERT INTO memory_confidence(chunk_id) VALUES (?)");
    for (const id of [
      "literal%id-target",
      "literalXid-other",
      "under_id-target",
      "underXid-other",
      "star*id-target",
      "starXid-other",
      "question?id-target",
      "questionXid-other",
      "bracket[id-target",
      "bracketXid-other",
    ]) insert.run(id);

    for (const [prefix, expected] of [
      ["literal%id-", "literal%id-target"],
      ["under_id-", "under_id-target"],
      ["star*id-", "star*id-target"],
      ["question?id-", "question?id-target"],
      ["bracket[id-", "bracket[id-target"],
    ]) {
      const rows = db.prepare([
        "SELECT chunk_id FROM memory_confidence",
        "WHERE chunk_id GLOB ?",
        "ORDER BY chunk_id ASC",
        "LIMIT 2",
      ].join(" ")).all(buildLiteralPrefixGlob(prefix));
      assert.deepEqual(rows.map(row => row.chunk_id), [expected], prefix);
    }
  } finally {
    db.close();
  }
});

test("parameterized literal-prefix GLOB uses primary-key indexes", () => {
  const db = new Database(":memory:");
  try {
    db.exec([
      "CREATE TABLE memory_confidence (chunk_id TEXT PRIMARY KEY)",
      "CREATE TABLE chunks (id TEXT PRIMARY KEY, text TEXT)",
    ].join(";"));

    const confidencePlan = queryPlan(
      db,
      "SELECT chunk_id FROM memory_confidence WHERE chunk_id GLOB ? ORDER BY chunk_id ASC LIMIT 2",
      buildLiteralPrefixGlob("abc"),
    );
    const chunksPlan = queryPlan(
      db,
      "SELECT id FROM chunks WHERE id GLOB ? ORDER BY id ASC LIMIT 2",
      buildLiteralPrefixGlob("abc"),
    );

    assert.match(confidencePlan, /SEARCH memory_confidence/u);
    assert.doesNotMatch(confidencePlan, /SCAN memory_confidence/u);
    assert.match(chunksPlan, /SEARCH chunks/u);
    assert.doesNotMatch(chunksPlan, /SCAN chunks/u);
  } finally {
    db.close();
  }
});
