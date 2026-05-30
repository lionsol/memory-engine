import test from "node:test";
import assert from "node:assert/strict";
import { getSmartAddTimeZone } from "../lib/config/helpers.js";

test("getSmartAddTimeZone uses memoryEngine timezone config when env is absent", () => {
  const prev = process.env.MEMORY_ENGINE_TIME_ZONE;
  delete process.env.MEMORY_ENGINE_TIME_ZONE;
  try {
    const tz = getSmartAddTimeZone({
      config: {
        memoryEngine: {
          timezone: { business: "UTC" },
        },
      },
    });
    assert.equal(tz, "UTC");
  } finally {
    if (prev === undefined) delete process.env.MEMORY_ENGINE_TIME_ZONE;
    else process.env.MEMORY_ENGINE_TIME_ZONE = prev;
  }
});

test("getSmartAddTimeZone prefers MEMORY_ENGINE_TIME_ZONE env over config", () => {
  const prev = process.env.MEMORY_ENGINE_TIME_ZONE;
  process.env.MEMORY_ENGINE_TIME_ZONE = "America/Los_Angeles";
  try {
    const tz = getSmartAddTimeZone({
      config: {
        memoryEngine: {
          timezone: { business: "UTC" },
        },
      },
    });
    assert.equal(tz, "America/Los_Angeles");
  } finally {
    if (prev === undefined) delete process.env.MEMORY_ENGINE_TIME_ZONE;
    else process.env.MEMORY_ENGINE_TIME_ZONE = prev;
  }
});

