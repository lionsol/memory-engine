#!/usr/bin/env node

const { readFileSync } = require("node:fs");
const { loadObservationReports } = require("./lib/observation-report-input.js");

function readFlagValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flagName} expects a value`);
  return value;
}

function loadJsonObject(path, label) {
  if (!path || typeof path !== "string") throw new Error(`${label} path is required`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`failed to read ${label}: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed;
}

function parseArgs(argv = []) {
  const options = {
    catalogPath: null,
    effectivePath: null,
    observationPaths: [],
    invocationMode: "unknown",
    pretty: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--pretty") options.pretty = true;
    else if (arg === "--catalog") {
      options.catalogPath = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--effective") {
      options.effectivePath = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--observations") {
      options.observationPaths.push(readFlagValue(argv, index, arg));
      index += 1;
    } else if (arg === "--invocation-mode") {
      options.invocationMode = readFlagValue(argv, index, arg);
      index += 1;
    } else throw new Error(`unknown argument: ${arg}`);
  }

  if (!options.help && !options.catalogPath) throw new Error("--catalog is required");
  if (!options.help && !options.effectivePath) throw new Error("--effective is required");
  if (!options.help && options.observationPaths.length === 0) throw new Error("--observations is required");
  if (!options.help && !["gateway_rpc", "agent_model", "unknown"].includes(options.invocationMode)) {
    throw new Error("--invocation-mode must be gateway_rpc, agent_model, or unknown");
  }
  return options;
}

function usage() {
  return `Usage:
  node bin/audit-tool-surface-runtime-access.js
      --catalog <tools-catalog.json>
      --effective <tools-effective.json>
      --observations <observations.json|observations.jsonl> [repeatable]
      [--invocation-mode <gateway_rpc|agent_model|unknown>]
      [--pretty]

Capture the gateway reports with:
  openclaw gateway call tools.catalog --params '{"agentId":"main","includePlugins":true}' --json
  openclaw gateway call tools.effective --params '{"agentId":"main","sessionKey":"agent:main:main"}' --json

This command reads JSON/JSONL reports only. It never connects to the gateway, invokes a tool, opens a database, or changes tool policy.`;
}

function exitCodeForReport(report) {
  if (report?.status === "tool_surface_runtime_blocked") return 3;
  if (report?.production_surface_execution_confirmed === true) return 0;
  if (report?.status === "tool_surface_registered_not_fully_executed") return 1;
  return 4;
}

async function auditToolSurfaceRuntimeAccess(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage(), report: null };

  const catalog = loadJsonObject(options.catalogPath, "tools.catalog report");
  const effective = loadJsonObject(options.effectivePath, "tools.effective report");
  const observations = loadObservationReports(options.observationPaths);
  const { buildToolSurfaceRuntimeAccessAudit } = await import(
    "../lib/recall/hybrid/tool-surface-runtime-access-audit.js"
  );
  const report = buildToolSurfaceRuntimeAccessAudit({
    catalog,
    effective,
    observations,
    invocationMode: options.invocationMode,
  });
  return {
    exitCode: exitCodeForReport(report),
    output: JSON.stringify(report, null, options.pretty ? 2 : 0),
    report,
  };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await auditToolSurfaceRuntimeAccess(argv);
    process.stdout.write(`${result.output}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 4;
  }
}

if (require.main === module) main();

module.exports = {
  auditToolSurfaceRuntimeAccess,
  exitCodeForReport,
  loadJsonObject,
  parseArgs,
  usage,
};
