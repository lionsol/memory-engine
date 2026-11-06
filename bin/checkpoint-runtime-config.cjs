#!/usr/bin/env node
"use strict";
// Read-only check for the cron wrapper: no flush, model request, DB or publication.
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const { getRuntime } = require("../lib/checkpoint/runtime");
const { resolveCodexSummaryConfig } = require("../lib/checkpoint/codex-summary.cjs");
function inspect() {
  const runtime = getRuntime(), transport = process.env.MEMORY_ENGINE_CHECKPOINT_DERIVED_TRANSPORT ?? "http";
  if (!["derived", "legacy"].includes(runtime.checkpointSummaryMode)) throw Error("derived_mode_invalid");
  if (!["http", "codex-cli"].includes(transport)) throw Error("derived_transport_invalid");
  const input = Number(process.env.MEMORY_ENGINE_CHECKPOINT_SUMMARY_INPUT_CHARS ?? 200000);
  const output = Number(process.env.MEMORY_ENGINE_CHECKPOINT_SUMMARY_OUTPUT_CHARS ?? 20000);
  if (![input, output].every(value => Number.isSafeInteger(value) && value > 0)) throw Error("derived_budget_invalid");
  let cli;
  if (runtime.checkpointSummaryMode === "derived" && transport === "codex-cli") {
    const cfg = resolveCodexSummaryConfig();
    const version = spawnSync(cfg.binary, ["--version"], { encoding: "utf8", timeout: 5000 });
    if (version.error || version.status !== 0) throw Error("derived_cli_unavailable");
    cli = { binary: cfg.binary, model: cfg.model, effort: cfg.effort,
      timeout_ms: cfg.timeoutMs, version: version.stdout.trim() };
  }
  return { status: "CONFIG_OK", entrypoint: resolve(__dirname, "session-checkpoint.js"),
    node: process.execPath, node_version: process.version, time_zone: runtime.timeZone,
    memory_dir: runtime.memoryDir, summary_mode: runtime.checkpointSummaryMode, transport,
    input_chars_per_batch: input, output_chars_per_batch: output, cli,
    proxy_env_keys: Object.keys(process.env).filter(key => /^(https?|all|no)_proxy$/i.test(key)),
    model_requests: 0, database_operations: 0, episode_writes: 0 };
}
if (require.main === module) {
  try { console.log(JSON.stringify(inspect(), null, 2)); }
  catch (error) { console.error(JSON.stringify({ status: "CONFIG_FAILED", error: error.code || error.message })); process.exitCode = 1; }
}
module.exports = { inspect };
