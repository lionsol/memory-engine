import test from "node:test";
import assert from "node:assert/strict";
import { addDaysLocal, localDateKey } from "../date-utils.js";

test("localDateKey returns local YYYY-MM-DD for provided Date", () => {
  const d = new Date(2026, 4, 26, 23, 59, 58);
  assert.equal(localDateKey(d), "2026-05-26");
});

test("addDaysLocal handles month rollover in local time", () => {
  const d = new Date(2026, 0, 31, 12, 0, 0);
  const next = addDaysLocal(d, 1);
  assert.equal(localDateKey(next), "2026-02-01");
});

test("localDateKey does not rely on UTC date part", () => {
  const d = new Date(2026, 4, 2, 0, 30, 0);
  const utcKey = [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
  ].join("-");
  assert.equal(localDateKey(d), "2026-05-02");
  assert.notEqual(localDateKey(d), utcKey);
});
