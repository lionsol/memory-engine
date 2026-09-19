#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

import { buildQ5B3AnalysisPlanV1 } from "../lib/benchmark/q5-b3-fixed-pool-analysis-plan-v1.js";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function gitText(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function main() {
  const b0Path = arg("--b0") || "test/fixtures/q5-b0-real-fixed-pool-evidence-entry-v1.json";
  const b1Path = arg("--b1") || "test/fixtures/q5-b1-score-capture-manifest-v1.json";
  const b0Manifest = JSON.parse(readFileSync(b0Path, "utf8"));
  const b1Manifest = JSON.parse(readFileSync(b1Path, "utf8"));
  const plan = buildQ5B3AnalysisPlanV1({ b0Manifest, b1Manifest });
  return Object.freeze({
    status: "PASS",
    mode: "Q5_B3_FIXED_POOL_ANALYSIS_PLAN",
    source_commit: gitText(["rev-parse", "HEAD"]),
    worktree_clean: gitText(["status", "--porcelain"]) === "",
    provider_requests: 0,
    model_training_runs: 0,
    ...plan,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: "FAIL",
      code: error?.code || "Q5_B3_FAILED",
      message: String(error?.message || error),
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
