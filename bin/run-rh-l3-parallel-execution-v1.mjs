#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

import { runRhL3ParallelExecutionV1 } from "../lib/benchmark/rh-l3-parallel-execution-v1.js";

function gitText(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export async function main() {
  const sourceCommit = gitText(["rev-parse", "HEAD"]);
  const worktreeClean = gitText(["status", "--porcelain"]) === "";
  const execution = await runRhL3ParallelExecutionV1({ sourceCommit });
  const result = {
    status: execution.execution.status,
    mode: "RH_L3_B_LOCAL_PARALLEL_VECTOR_EXECUTION",
    source_commit: sourceCommit,
    worktree_clean: worktreeClean,
    contract_sha256: execution.contract_sha256,
    execution_binding_sha256: execution.execution_binding_sha256,
    upstream_fixture_sha256: execution.upstream_fixture_sha256,
    upstream_plan_sha256: execution.upstream_plan_sha256,
    provider_requests: execution.provider_requests,
    execution: execution.execution,
  };
  return Object.freeze({
    ...result,
    result_sha256: sha256(JSON.stringify(result)),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== "PASS") process.exitCode = 1;
  }).catch(error => {
    process.stderr.write(`${JSON.stringify({
      status: "FAIL",
      code: error?.code || "RH_L3_B_EXECUTION_FAILED",
      message: String(error?.message || error),
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
