#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

function parseArgs(argv) {
  const args = {
    root: process.env.Q3_LOCOMO_CHUNK_RERANK_ROOT || "/home/lionsol/.openclaw/workspace/q3-locomo-v1.2/runs/q3-locomo-chunk-fts-rerank-v1",
  };
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
    console.log("Usage: node bin/status-locomo-chunk-rerank-v1.mjs [--root <experiment-root>]");
    return;
  }
  const root = resolve(args.root);
  const statePath = join(root, "state", "runner-state.json");
  if (!existsSync(statePath)) {
    console.log(JSON.stringify({ root, state_path: statePath, state: "missing" }, null, 2));
    return;
  }
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const phase = state.phases?.main ?? { expected: 0, results: [] };
  const confirmed = phase.results.filter(result => result.completion_confirmed === true);
  console.log(JSON.stringify({
    schema: state.schema,
    root,
    state_path: statePath,
    status: state.status,
    stop: state.stop,
    inflight: state.inflight ? {
      attempt: state.inflight.attempt,
      ordinal: state.inflight.ordinal,
      question_id: state.inflight.question_id,
      request_id: state.inflight.request_id,
    } : null,
    budget: state.budget,
    phase: {
      expected: phase.expected,
      confirmed: confirmed.length,
      applied: confirmed.filter(result => result.status === "applied" || result.status === "bypassed_empty_text_tail").length,
      bypassed: confirmed.filter(result => result.status === "bypassed").length,
    },
    last_request_started_at_ms: state.last_request_started_at_ms,
    updated_at: state.updated_at,
  }, null, 2));
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(`STATUS_READ_FAILED ${error?.message || error}`);
  process.exitCode = 1;
}
