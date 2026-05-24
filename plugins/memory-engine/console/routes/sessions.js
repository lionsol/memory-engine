import { getSession, getTrace, listSessions, recentTraces } from "../services/recall-trace-service.js";

export function handleSessionApi({ method, parts, searchParams }) {
  if (method !== "GET") return null;
  if (parts.length === 2) return { status: 200, body: listSessions({ limit: Number(searchParams.get("limit")) || 50 }) };
  if (parts.length === 3) {
    const session = getSession(decodeURIComponent(parts[2]));
    return session ? { status: 200, body: session } : { status: 404, body: { error: "session not found" } };
  }
  if (parts.length === 4 && parts[3] === "trace") {
    return { status: 200, body: recentTraces({ limit: Number(searchParams.get("limit")) || 50 }) };
  }
  return null;
}

export function handleTraceApi({ method, parts }) {
  if (method !== "GET" || parts.length !== 3) return null;
  return { status: 200, body: getTrace(decodeURIComponent(parts[2])) };
}
