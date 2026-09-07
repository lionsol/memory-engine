#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

function parseArgs(argv) {
  const args = { root: process.env.Q3_LOCOMO_ROOT || "/tmp/q3-locomo-v1.2" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") args.root = argv[++index];
    else if (argv[index] === "--help" || argv[index] === "-h") args.help = true;
    else throw new Error(`unknown_argument:${argv[index]}`);
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log("Usage: node bin/status-locomo-rerank-v1.js [--root <experiment-root>]");
    return;
  }
  const root = resolve(args.root);
  const statePath = join(root, "state", "runner-state.json");
  if (!existsSync(statePath)) {
    console.log(JSON.stringify({ root, state_path: statePath, state: "missing" }, null, 2));
    return;
  }
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const summary = {
    schema: state.schema,
    root,
    state_path: statePath,
    status: state.status,
    stop: state.stop,
    inflight: state.inflight ? {
      attempt: state.inflight.attempt,
      phase: state.inflight.phase,
      key: state.inflight.key,
      request_id: state.inflight.request_id,
    } : null,
    budget: state.budget,
    phases: Object.fromEntries(Object.entries(state.phases).map(([phase, value]) => [phase, {
      expected: value.expected,
      valid: value.results.filter(result => result.validation_ok === true).length,
    }])),
    last_request_started_at: state.last_request_started_at,
    updated_at: state.updated_at,
  };
  console.log(JSON.stringify(summary, null, 2));
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(`STATUS_READ_FAILED ${error?.message || error}`);
  process.exitCode = 1;
}
