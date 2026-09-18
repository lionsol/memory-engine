#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

import { runRhL3FusionProjectionV1 } from "../lib/benchmark/rh-l3-fusion-projection-v1.js";

function gitText(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export async function main() {
  const sourceCommit = gitText(["rev-parse", "HEAD"]);
  const worktreeClean = gitText(["status", "--porcelain"]) === "";
  const execution = await runRhL3FusionProjectionV1({ sourceCommit });
  const result = {
    status: execution.execution.status,
    mode: "RH_L3_C_LOCAL_FUSION_RANKING_PROJECTION",
    source_commit: sourceCommit,
    worktree_clean: worktreeClean,
    contract_sha256: execution.contract_sha256,
    execution_binding_sha256: execution.execution_binding_sha256,
    upstream_rh_l3_b: execution.upstream_rh_l3_b,
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
      code: error?.code || "RH_L3_C_EXECUTION_FAILED",
      message: String(error?.message || error),
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
