import { latencySeries, recallTelemetry, writeTelemetry } from "../services/telemetry-service.js";

export function handleTelemetryApi({ method, parts, searchParams }) {
  if (method !== "GET" || parts.length !== 3) return null;
  if (parts[2] === "latency") return { status: 200, body: latencySeries({ limit: Number(searchParams.get("limit")) || 120 }) };
  if (parts[2] === "recall") return { status: 200, body: recallTelemetry() };
  if (parts[2] === "write") return { status: 200, body: writeTelemetry() };
  return null;
}
