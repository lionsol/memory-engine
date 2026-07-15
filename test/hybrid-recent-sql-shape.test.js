import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildIsolatedRecentLikeSql,
  ISOLATED_RECENT_FALLBACK_SQL,
  ISOLATED_RECENT_SCORED_SQL,
} from "../lib/recall/hybrid/recent-access.js";

const channelSource = readFileSync(
  new URL("../lib/recall/hybrid/channels/recent.js", import.meta.url),
  "utf8",
);
const accessSource = readFileSync(
  new URL("../lib/recall/hybrid/recent-access.js", import.meta.url),
  "utf8",
);

test("Recent isolated archived exclusion has one production SQL template source and three generated branch shapes", () => {
  const templateJsonEachCount = [...accessSource.matchAll(/json_each\(\?\)\s+AS\s+archived/g)].length;
  const templateNotInCount = [...accessSource.matchAll(/c\.id\s+NOT\s+IN\s*\(\s*SELECT\s+CAST\(archived\.value\s+AS\s+TEXT\)\s+FROM\s+json_each\(\?\)\s+AS\s+archived\s*\)/gms)].length;
  const templateNotExistsCount = [...accessSource.matchAll(/NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+json_each\(\?\)\s+AS\s+archived/gs)].length;
  const channelJsonEachCount = [...channelSource.matchAll(/json_each\(\?\)\s+AS\s+archived/g)].length;
  const channelNotInCount = [...channelSource.matchAll(/c\.id\s+NOT\s+IN/g)].length;
  const materializedCount = [...accessSource.matchAll(/MATERIALIZED/g)].length + [...channelSource.matchAll(/MATERIALIZED/g)].length;
  const tempCount = [...accessSource.matchAll(/\bTEMP\b/g)].length + [...channelSource.matchAll(/\bTEMP\b/g)].length;

  assert.equal(templateJsonEachCount, 1);
  assert.equal(templateNotInCount, 1);
  assert.equal(templateNotExistsCount, 0);
  assert.equal(channelJsonEachCount, 0);
  assert.equal(channelNotInCount, 0);
  assert.equal(materializedCount, 0);
  assert.equal(tempCount, 0);

  for (const sql of [
    buildIsolatedRecentLikeSql(2),
    ISOLATED_RECENT_SCORED_SQL,
    ISOLATED_RECENT_FALLBACK_SQL,
  ]) {
    assert.equal(sql.includes("c.id NOT IN"), true);
    assert.equal(sql.includes("SELECT CAST(archived.value AS TEXT)"), true);
    assert.equal(sql.includes("FROM json_each(?) AS archived"), true);
    assert.equal(sql.includes("ORDER BY c.updated_at DESC, c.id ASC"), true);
    assert.equal(sql.includes("NOT EXISTS"), false);
  }
});
