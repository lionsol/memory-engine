#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

import { buildRhL3ExpansionContractV1 } from "../lib/benchmark/rh-l3-expansion-contract-v1.js";

function gitText(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function main() {
  const sourceCommit = gitText(["rev-parse", "HEAD"]);
  const worktreeClean = gitText(["status", "--porcelain"]) === "";
  const contract = buildRhL3ExpansionContractV1({ sourceCommit });
  const result = {
    status: "PASS",
    mode: "RH_L3_A_EXPANSION_CONTRACT_QUALIFICATION",
    source_commit: sourceCommit,
    worktree_clean: worktreeClean,
    contract_sha256: contract.contract_sha256,
    execution_binding_sha256: contract.execution_binding_sha256,
    fixture_sha256: contract.fixture_sha256,
    plan_sha256: contract.plan_sha256,
    evaluation: contract.evaluation,
    plan: contract.plan,
    provider_requests: 0,
  };
  return Object.freeze({
    ...result,
    result_sha256: sha256(JSON.stringify(result)),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: "FAIL",
      code: error?.code || "RH_L3_A_EXECUTION_FAILED",
      message: String(error?.message || error),
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
