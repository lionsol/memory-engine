import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const viewSource = readFileSync(new URL("../console/views/metrics.ejs", import.meta.url), "utf8");
const chartSource = readFileSync(new URL("../console/public/charts.js", import.meta.url), "utf8");

test("metrics view exposes the Hybrid DB Isolation panel", () => {
  assert.match(viewSource, /Hybrid DB Isolation/);
  assert.match(viewSource, /data-hybrid-fallback-observability/);
});

test("metrics renderer wires and escapes Hybrid fallback observability", () => {
  assert.match(chartSource, /function renderHybridFallbackObservability\(/);
  assert.match(chartSource, /retrieval\.hybrid_fallback_observability/);
  assert.match(chartSource, /data-hybrid-fallback-observability/);
  assert.match(chartSource, /Observed Hybrid/);
  assert.match(chartSource, /Fully Isolated/);
  assert.match(chartSource, /Fallback Events/);
  assert.match(chartSource, /Fallback Rate/);
  assert.match(chartSource, /KG Fallback/);
  assert.match(chartSource, /Recent Fallback/);
  assert.match(chartSource, /Both Fallback/);
  assert.match(chartSource, /Partial Access/);
  assert.match(chartSource, /esc\(reason\)/);
  assert.match(chartSource, /No fallback reasons observed/);
  assert.match(chartSource, /All Observations by Surface/);
  assert.match(chartSource, /Production Denominator/);
  assert.match(chartSource, /Excluded \/ Non-production/);
  assert.match(chartSource, /KG Runtime Modes/);
  assert.match(chartSource, /Recent Runtime Modes/);
  assert.match(chartSource, /observed_by_surface/);
  assert.match(chartSource, /production_observed_by_surface/);
  assert.match(chartSource, /excluded_from_production_by_surface/);
  assert.match(chartSource, /Fallback rate denominator: successful Hybrid observations from production surfaces/);
  assert.match(chartSource, /missing one or both access modes count as partial coverage/);
});

test("metrics API route and reports remain unchanged", () => {
  const routeSource = readFileSync(new URL("../console/routes/metrics.js", import.meta.url), "utf8");
  const serverSource = readFileSync(new URL("../console/server.js", import.meta.url), "utf8");
  assert.match(routeSource, /retrievalMetrics\(\)/);
  assert.match(serverSource, /retrieval: retrievalMetrics\(\)/);
  assert.doesNotMatch(routeSource, /hybrid-fallback/);
  assert.doesNotMatch(serverSource, /hybrid-fallback/);
});
