import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  dateStrInTimeZone,
} from "../date-utils.js";

const require = createRequire(import.meta.url);
const businessTime = require("../lib/business-time.cjs");
const binDateUtils = require("../bin/date-utils.js");
const checkpointDate = require("../lib/checkpoint/date.js");
const checkpointRawLog = require("../lib/checkpoint/raw-log.js");

const BUSINESS_TIME_CLI = resolve("bin/resolve-business-time.js");

function makeRoot(prefix = "memory-engine-business-time-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("business timezone resolution follows explicit, env, config, then default precedence", () => {
  const config = { timezone: { business: "Asia/Singapore" } };

  assert.equal(
    businessTime.resolveBusinessTimeZone({ config, env: {} }),
    "Asia/Singapore",
  );
  assert.equal(
    businessTime.resolveBusinessTimeZone({
      config,
      env: { MEMORY_ENGINE_TIME_ZONE: "America/Los_Angeles" },
    }),
    "America/Los_Angeles",
  );
  assert.equal(
    businessTime.resolveBusinessTimeZone({
      config,
      env: { MEMORY_ENGINE_TIME_ZONE: "America/Los_Angeles" },
      explicitTimeZone: "UTC",
    }),
    "UTC",
  );
  assert.equal(
    businessTime.resolveBusinessTimeZone({ config: {}, env: {} }),
    "Asia/Shanghai",
  );
  assert.equal(
    businessTime.resolveBusinessTimeZone({
      config,
      env: { MEMORY_ENGINE_TIME_ZONE: "  " },
      explicitTimeZone: "",
    }),
    "Asia/Singapore",
  );
});

test("invalid highest-priority timezone values fail closed without fallback", () => {
  assert.throws(
    () => businessTime.resolveBusinessTimeZone({
      config: { timezone: { business: "Asia/Singapore" } },
      env: { MEMORY_ENGINE_TIME_ZONE: "UTC" },
      explicitTimeZone: "Not/AZone",
    }),
    error => error?.code === "INVALID_BUSINESS_TIME_ZONE",
  );
  assert.throws(
    () => businessTime.resolveBusinessTimeZone({
      config: { timezone: { business: "Asia/Singapore" } },
      env: { MEMORY_ENGINE_TIME_ZONE: "Not/AZone" },
    }),
    error => error?.code === "INVALID_BUSINESS_TIME_ZONE",
  );
  assert.throws(
    () => businessTime.resolveBusinessTimeZone({
      config: { timezone: { business: "Not/AZone" } },
      env: {},
    }),
    error => error?.code === "INVALID_BUSINESS_TIME_ZONE",
  );
});

test("all date adapters use the same business-date result", () => {
  const instant = "2026-05-26T16:30:00.000Z";
  const expected = "2026-05-27";

  assert.equal(businessTime.businessDateFromInstant(instant, "Asia/Singapore"), expected);
  assert.equal(dateStrInTimeZone(0, "Asia/Singapore", instant), expected);
  assert.equal(binDateUtils.dateStrInTimeZone(0, "Asia/Singapore", instant), expected);
  assert.equal(checkpointDate.dateStringInTimeZone(instant, "Asia/Singapore"), expected);
  assert.equal(checkpointDate.shiftDateString(expected, -1), "2026-05-26");
});

test("invalid instants and business dates have stable fail-closed errors", () => {
  assert.throws(
    () => businessTime.businessDateFromInstant(new Date("invalid"), "UTC"),
    error => error?.code === "INVALID_BUSINESS_INSTANT",
  );
  assert.throws(
    () => businessTime.shiftBusinessDate("2026-02-30", 1),
    error => error?.code === "INVALID_BUSINESS_DATE",
  );
  assert.throws(
    () => checkpointDate.dateStringInTimeZone("not-an-instant", "UTC"),
    error => error?.code === "INVALID_BUSINESS_INSTANT",
  );
});

test("business date ranges use real DST and non-integral-offset midnights", () => {
  const spring = businessTime.businessDateToUtcRange("2026-03-08", "America/New_York");
  const fall = businessTime.businessDateToUtcRange("2026-11-01", "America/New_York");
  const kathmandu = businessTime.businessDateToUtcRange("2026-05-27", "Asia/Kathmandu");

  assert.equal(new Date(spring.startMs).toISOString(), "2026-03-08T05:00:00.000Z");
  assert.equal(new Date(spring.endMs).toISOString(), "2026-03-09T04:00:00.000Z");
  assert.equal(spring.endMs - spring.startMs, 23 * 60 * 60 * 1000);
  assert.equal(fall.endMs - fall.startMs, 25 * 60 * 60 * 1000);
  assert.equal(new Date(kathmandu.startMs).toISOString(), "2026-05-26T18:15:00.000Z");

  assert.deepEqual(
    checkpointRawLog.getTargetDateRange("2026-03-08", "America/New_York"),
    spring,
  );
});

test("standalone checkpoint runtime resolves config-only business timezone", () => {
  const root = makeRoot("memory-engine-business-time-runtime-");
  const configPath = join(root, "openclaw.json");
  const runtimePath = resolve("lib/checkpoint/runtime.js");
  writeFileSync(configPath, JSON.stringify({
    memoryEngine: { timezone: { business: "Asia/Singapore" } },
  }));

  try {
    const result = spawnSync(process.execPath, ["-e", [
      `const runtime = require(${JSON.stringify(runtimePath)}).getRuntime();`,
      "console.log(JSON.stringify({ timeZone: runtime.timeZone }));",
    ].join("\n")], {
      cwd: resolve("."),
      env: {
        ...process.env,
        HOME: root,
        OPENCLAW_CONFIG_PATH: configPath,
        MEMORY_ENGINE_TIME_ZONE: "",
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 0, JSON.stringify({
      error: result.error?.message,
      stderr: result.stderr,
      stdout: result.stdout,
    }));
    assert.notEqual(result.stdout.trim(), "", JSON.stringify({
      status: result.status,
      error: result.error?.message,
      stderr: result.stderr,
      stdout: result.stdout,
    }));
    assert.deepEqual(JSON.parse(result.stdout), { timeZone: "Asia/Singapore" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("business-time CLI resolves a config-only timezone and deterministic date", () => {
  const root = makeRoot("memory-engine-business-time-cli-");
  const configPath = join(root, "openclaw.json");
  writeFileSync(configPath, JSON.stringify({
    memoryEngine: { timezone: { business: "Asia/Singapore" } },
  }));

  try {
    const env = {
      ...process.env,
      HOME: root,
      OPENCLAW_CONFIG_PATH: configPath,
      MEMORY_ENGINE_TIME_ZONE: "",
      TZ: "UTC",
    };
    const timezone = spawnSync(process.execPath, [BUSINESS_TIME_CLI, "--timezone"], {
      cwd: resolve("."),
      env,
      encoding: "utf8",
    });
    const yesterday = spawnSync(process.execPath, [
      BUSINESS_TIME_CLI,
      "--yesterday",
      "--now",
      "2026-05-26T16:30:00.000Z",
    ], {
      cwd: resolve("."),
      env,
      encoding: "utf8",
    });

    assert.equal(timezone.status, 0, JSON.stringify({
      error: timezone.error?.message,
      stderr: timezone.stderr,
      stdout: timezone.stdout,
    }));
    assert.equal(timezone.stdout.trim(), "Asia/Singapore", JSON.stringify({
      status: timezone.status,
      error: timezone.error?.message,
      stderr: timezone.stderr,
      stdout: timezone.stdout,
    }));
    assert.equal(yesterday.status, 0, JSON.stringify({
      error: yesterday.error?.message,
      stderr: yesterday.stderr,
      stdout: yesterday.stdout,
    }));
    assert.equal(yesterday.stdout.trim(), "2026-05-26", JSON.stringify({
      status: yesterday.status,
      error: yesterday.error?.message,
      stderr: yesterday.stderr,
      stdout: yesterday.stdout,
    }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
