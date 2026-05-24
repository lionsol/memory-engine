import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initConsoleStorage } from "./services/db.js";
import { overviewSnapshot, recentTraces } from "./services/recall-trace-service.js";
import { listMemories } from "./services/memory-service.js";
import { recallTelemetry } from "./services/telemetry-service.js";
import { conflictMetrics, overviewMetrics, retrievalMetrics } from "./services/metrics-service.js";
import { handleSessionApi, handleTraceApi } from "./routes/sessions.js";
import { handleMemoryApi } from "./routes/memories.js";
import { handleTelemetryApi } from "./routes/telemetry.js";
import { handleMetricsApi } from "./routes/metrics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const viewsDir = path.join(__dirname, "views");
const port = Number(process.env.MEMORY_CONSOLE_PORT || 8787);
const host = process.env.MEMORY_CONSOLE_HOST || "127.0.0.1";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function render(name, data = {}) {
  const layout = fs.readFileSync(path.join(viewsDir, "layout.ejs"), "utf8");
  const page = fs.readFileSync(path.join(viewsDir, `${name}.ejs`), "utf8");
  const json = jsonForScript(data);
  return layout
    .replaceAll("{{title}}", escapeHtml(data.title || "Memory Console Lite"))
    .replaceAll("{{active}}", escapeHtml(data.active || "dashboard"))
    .replace("{{content}}", page)
    .replace("{{data}}", json);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, body) {
  send(res, status, JSON.stringify(body, null, 2), { "content-type": "application/json; charset=utf-8" });
}

function serveStatic(res, pathname) {
  const rel = pathname.replace(/^\/public\/?/, "");
  const file = path.normalize(path.join(publicDir, rel));
  if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const ext = path.extname(file);
  const type = ext === ".css" ? "text/css" : ext === ".js" ? "text/javascript" : "application/octet-stream";
  send(res, 200, fs.readFileSync(file), { "content-type": `${type}; charset=utf-8` });
  return true;
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  let result = null;
  if (parts[0] === "api" && parts[1] === "sessions") result = handleSessionApi({ method: req.method, parts, searchParams: url.searchParams });
  if (parts[0] === "api" && parts[1] === "traces") result = handleTraceApi({ method: req.method, parts, searchParams: url.searchParams });
  if (parts[0] === "api" && parts[1] === "memories") result = await handleMemoryApi({ req, method: req.method, parts, searchParams: url.searchParams });
  if (parts[0] === "api" && parts[1] === "telemetry") result = handleTelemetryApi({ method: req.method, parts, searchParams: url.searchParams });
  if (parts[0] === "api" && parts[1] === "metrics") result = handleMetricsApi({ method: req.method, parts, searchParams: url.searchParams });
  if (!result) return false;
  sendJson(res, result.status, result.body);
  return true;
}

function routePage(pathname) {
  if (pathname === "/") return { view: "dashboard", active: "dashboard", title: "Dashboard", data: { ...overviewSnapshot(), telemetry: recallTelemetry() } };
  if (pathname === "/sessions") return { view: "session-trace", active: "sessions", title: "Session Trace", data: { traces: recentTraces({ limit: 100 }) } };
  if (pathname === "/memories") return { view: "memory-inspector", active: "memories", title: "Memory Inspector", data: { memories: listMemories({ limit: 100 }) } };
  if (pathname === "/telemetry") return { view: "telemetry", active: "telemetry", title: "Telemetry", data: recallTelemetry() };
  if (pathname === "/metrics") return { view: "metrics", active: "metrics", title: "Metrics", data: { overview: overviewMetrics(), retrieval: retrievalMetrics(), conflicts: conflictMetrics() } };
  return null;
}

export async function createServer() {
  initConsoleStorage();
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);
      if (url.pathname.startsWith("/public/") && serveStatic(res, url.pathname)) return;
      if (url.pathname.startsWith("/api/") && await handleApi(req, res, url)) return;
      const page = routePage(url.pathname);
      if (page) return send(res, 200, render(page.view, { title: page.title, active: page.active, payload: page.data }), { "content-type": "text/html; charset=utf-8" });
      send(res, 404, "Not found", { "content-type": "text/plain; charset=utf-8" });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
  });
}

if (process.argv.includes("--check")) {
  initConsoleStorage();
  console.log("Memory Console Lite check ok");
} else {
  const server = await createServer();
  server.listen(port, host, () => {
    console.log(`Memory Console Lite running at http://${host}:${port}/`);
  });
}
