import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { dateStrInTimeZone, DEFAULT_BUSINESS_TIME_ZONE } = require("../../../scripts/date-utils.js");

test("workspace session-checkpoint computes yesterday by Asia/Shanghai business day", () => {
  // 2026-05-27 03:30 CST == 2026-05-26T19:30:00.000Z
  const checkpointInstant = new Date("2026-05-26T19:30:00.000Z");
  const targetDate = dateStrInTimeZone(-1, DEFAULT_BUSINESS_TIME_ZONE, checkpointInstant);
  assert.equal(targetDate, "2026-05-26");
});
