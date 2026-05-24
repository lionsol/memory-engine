import { conflictMetrics, overviewMetrics, retrievalMetrics } from "../services/metrics-service.js";

export function handleMetricsApi({ method, parts }) {
  if (method !== "GET" || parts.length !== 3) return null;
  if (parts[2] === "overview") return { status: 200, body: overviewMetrics() };
  if (parts[2] === "retrieval") return { status: 200, body: retrievalMetrics() };
  if (parts[2] === "conflicts") return { status: 200, body: conflictMetrics() };
  return null;
}
