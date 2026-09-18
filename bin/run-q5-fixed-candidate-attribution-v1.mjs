#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

import { analyzeQ5FixedCandidateFixtureV1 } from "../lib/benchmark/q5-fixed-candidate-attribution-v1.js";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function gitText(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function main() {
  const fixturePath = arg("--fixture");
  if (!fixturePath) throw new Error("usage: --fixture <path>");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const result = analyzeQ5FixedCandidateFixtureV1(fixture);
  return Object.freeze({
    status: "PASS",
    mode: "Q5_A_FIXED_CANDIDATE_ATTRIBUTION",
    source_commit: gitText(["rev-parse", "HEAD"]),
    worktree_clean: gitText(["status", "--porcelain"]) === "",
    ...result,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: "FAIL",
      code: error?.code || "Q5_ATTRIBUTION_FAILED",
      message: String(error?.message || error),
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
