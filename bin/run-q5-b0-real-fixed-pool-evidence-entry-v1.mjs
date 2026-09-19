#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

import { loadFrozenInputs } from "./run-locomo-chunk-rerank-v1.mjs";
import {
  buildC1ALocomoQualificationCases,
} from "../lib/benchmark/c1a-locomo-qualification.js";
import {
  buildQ5B0EvidenceEntryManifestV1,
} from "../lib/benchmark/q5-b0-real-fixed-pool-evidence-entry-v1.js";

const DEFAULT_ROOT =
  "/home/lionsol/.openclaw/workspace/q3-locomo-v1.2/runs/q3-locomo-chunk-fts-rerank-v1";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readJsonl(path) {
  const text = readFileSync(path, "utf8").trim();
  return text === "" ? [] : text.split(/\n/u).map(line => JSON.parse(line));
}

function gitText(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function main() {
  const root = resolve(arg("--root") || DEFAULT_ROOT);
  const output = arg("--output");
  const repositoryRoot = resolve(arg("--repo") || process.cwd());
  const frozen = loadFrozenInputs(root, repositoryRoot);
  const turnRows = readJsonl(join(root, "input", "chunk-material", "turn-chunk-map.jsonl"));
  const material = buildC1ALocomoQualificationCases({
    frozen,
    turnRows,
    egressDecision: "UNKNOWN",
  });
  const manifest = buildQ5B0EvidenceEntryManifestV1({
    material,
    sourceIdentity: frozen.material_identity,
  });
  const result = Object.freeze({
    status: "PASS",
    mode: "Q5_B0_REAL_FIXED_POOL_EVIDENCE_ENTRY",
    source_commit: gitText(["rev-parse", "HEAD"]),
    worktree_clean: gitText(["status", "--porcelain"]) === "",
    provider_requests: 0,
    model_training_runs: 0,
    manifest,
  });
  if (output) writeFileSync(resolve(output), `${JSON.stringify(manifest, null, 2)}\n`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = main();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: "FAIL",
      code: error?.code || "Q5_B0_FAILED",
      message: String(error?.message || error),
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
