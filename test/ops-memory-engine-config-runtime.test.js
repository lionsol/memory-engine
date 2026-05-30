import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

const helperPath = resolve(process.cwd(), "../../scripts/lib/memory-engine-config-runtime.js");
const helperModule = await import(helperPath);
const getSmartAddTimeZoneRuntime =
  helperModule.getSmartAddTimeZoneRuntime
  || helperModule.default?.getSmartAddTimeZoneRuntime;
assert.equal(typeof getSmartAddTimeZoneRuntime, "function");

test("getSmartAddTimeZoneRuntime prefers env over config", async () => {
  const prev = process.env.MEMORY_ENGINE_TIME_ZONE;
  process.env.MEMORY_ENGINE_TIME_ZONE = "America/Los_Angeles";
  try {
    const tz = await getSmartAddTimeZoneRuntime({
      cfg: {
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

test("getSmartAddTimeZoneRuntime uses memoryEngine config when env absent", async () => {
  const prev = process.env.MEMORY_ENGINE_TIME_ZONE;
  delete process.env.MEMORY_ENGINE_TIME_ZONE;
  try {
    const tz = await getSmartAddTimeZoneRuntime({
      cfg: {
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

test("getSmartAddTimeZoneRuntime falls back to Asia/Shanghai when config cannot be loaded", async () => {
  const prev = process.env.MEMORY_ENGINE_TIME_ZONE;
  delete process.env.MEMORY_ENGINE_TIME_ZONE;
  try {
    const tz = await getSmartAddTimeZoneRuntime({
      configPath: "/tmp/non-existent-openclaw-config.json",
    });
    assert.equal(tz, "Asia/Shanghai");
  } finally {
    if (prev === undefined) delete process.env.MEMORY_ENGINE_TIME_ZONE;
    else process.env.MEMORY_ENGINE_TIME_ZONE = prev;
  }
});
