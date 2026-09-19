#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

import { evaluateQ5MarginConstrainedSelectionV1 } from "../lib/benchmark/q5-margin-constrained-selection-v1.js";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function gitText(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function main() {
  const fixturePath = arg("--fixture") || "test/fixtures/q5-fixed-candidate-q4-derived-v1.json";
  const scorePacketPath = arg("--score-packet")
    || "test/fixtures/q5-fixed-pool-rerank-score-capture-v1.json";
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const scorePacket = JSON.parse(readFileSync(scorePacketPath, "utf8"));
  const result = evaluateQ5MarginConstrainedSelectionV1({ fixture, scorePacket });
  return Object.freeze({
    status: "PASS",
    mode: "Q5_A6_MARGIN_CONSTRAINED_FIXED_POOL_SELECTION",
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
      code: error?.code || "Q5_A6_FAILED",
      message: String(error?.message || error),
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
