import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

test("console telemetry API route response snapshot is stable", async () => {
  const source = readFileSync(new URL("../console/routes/telemetry.js", import.meta.url), "utf8");
  const transformed = source
    .replace(/^import[^\n]*\n/m, "")
    .replace("export function handleTelemetryApi", "function handleTelemetryApi");
  const context = {
    latencySeries: () => [{ latency_ms: 12 }],
    recallTelemetry: () => ({ totals: { completed: 1 }, byHour: [], timezone: "Asia/Shanghai" }),
    writeTelemetry: () => [{ event_type: "memory_created" }],
  };
  vm.runInNewContext(`${transformed}\nthis.__handleTelemetryApi = handleTelemetryApi;`, context);
  const handleTelemetryApi = context.__handleTelemetryApi;

  const result = handleTelemetryApi({
    method: "GET",
    parts: ["api", "telemetry", "recall"],
    searchParams: new URLSearchParams(),
  });

  assert.equal(
    JSON.stringify(result, null, 2),
    `{
  "status": 200,
  "body": {
    "totals": {
      "completed": 1
    },
    "byHour": [],
    "timezone": "Asia/Shanghai"
  }
}`
  );
});
