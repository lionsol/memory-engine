import test from "node:test";
import assert from "node:assert/strict";
import { addDaysLocal, dateStrInTimeZone, localDateKey } from "../date-utils.js";

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

test("dateStrInTimeZone returns business-date yesterday at Asia/Shanghai early morning checkpoint", () => {
  // 2026-05-27 03:30 CST == 2026-05-26T19:30:00.000Z
  const checkpointInstant = new Date("2026-05-26T19:30:00.000Z");
  const yesterdayBizDate = dateStrInTimeZone(-1, "Asia/Shanghai", checkpointInstant);
  assert.equal(yesterdayBizDate, "2026-05-26");
});

test("dateStrInTimeZone does not skip previous natural day due to UTC lag", () => {
  const checkpointInstant = new Date("2026-05-26T19:30:00.000Z");
  const utcYesterday = (() => {
    const d = new Date(checkpointInstant);
    d.setUTCDate(d.getUTCDate() - 1);
    return [
      d.getUTCFullYear(),
      String(d.getUTCMonth() + 1).padStart(2, "0"),
      String(d.getUTCDate()).padStart(2, "0"),
    ].join("-");
  })();

  const bizYesterday = dateStrInTimeZone(-1, "Asia/Shanghai", checkpointInstant);
  assert.equal(utcYesterday, "2026-05-25");
  assert.equal(bizYesterday, "2026-05-26");
  assert.notEqual(bizYesterday, utcYesterday);
});

test("dateStrInTimeZone keeps UTC date and business date aligned to their own calendars", () => {
  const instant = new Date("2026-05-26T19:30:00.000Z");
  assert.equal(dateStrInTimeZone(0, "UTC", instant), "2026-05-26");
  assert.equal(dateStrInTimeZone(0, "Asia/Shanghai", instant), "2026-05-27");
});
