#!/usr/bin/env node

let runtime;
let shuttingDown = false;

function stableError(error) {
  const code = String(error?.code || error?.message || "aml_service_start_failed");
  return code.replace(/authorization\s*:\s*bearer\s+[^\s]+/gi, "authorization: bearer [redacted]")
    .replace(/bearer\s+[^\s]+/gi, "bearer [redacted]")
    .replace(/(api[_-]?key|token|secret)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 160);
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await runtime?.close();
    process.exitCode = 0;
  } catch (error) {
    process.stderr.write(`${stableError(error)}\n`);
    process.exitCode = 1;
  }
}

(async () => {
  try {
    const { createAmlServiceRuntime } = await import("../lib/benchmark/aml-service-runtime-v1.js");
    runtime = createAmlServiceRuntime();
    process.once("SIGTERM", () => { void shutdown(); });
    process.once("SIGINT", () => { void shutdown(); });
    await runtime.start();
  } catch (error) {
    process.stderr.write(`${stableError(error)}\n`);
    process.exitCode = 1;
  }
})();
