#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

import { buildQ5B1CaptureManifestV1 } from "../lib/benchmark/q5-b1-score-capture-manifest-v1.js";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function gitText(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function main() {
  const input = resolve(
    arg("--input") || "test/fixtures/q5-b0-real-fixed-pool-evidence-entry-v1.json",
  );
  const output = arg("--output");
  const b0Manifest = JSON.parse(readFileSync(input, "utf8"));
  const manifest = buildQ5B1CaptureManifestV1(b0Manifest);
  if (output) writeFileSync(resolve(output), `${JSON.stringify(manifest, null, 2)}\n`);
  return Object.freeze({
    status: "PASS",
    mode: "Q5_B1_SCORE_CAPTURE_MANIFEST",
    source_commit: gitText(["rev-parse", "HEAD"]),
    worktree_clean: gitText(["status", "--porcelain"]) === "",
    provider_requests: 0,
    model_training_runs: 0,
    manifest,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: "FAIL",
      code: error?.code || "Q5_B1_FAILED",
      message: String(error?.message || error),
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
