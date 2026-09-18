#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

import { buildQ4RecallHintC1FreshCorpusV1 } from "../lib/benchmark/q4-recall-hint-c1-corpus-v1.js";
import { buildRhL1PerformanceContractV1 } from "../lib/benchmark/rh-l1-performance-contract-v1.js";
import { runRhL1LanceDbEquivalenceV1 } from "../lib/benchmark/rh-l1-lancedb-equivalence-v1.js";

function gitText(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export async function main() {
  const sourceCommit = gitText(["rev-parse", "HEAD"]);
  const worktreeClean = gitText(["status", "--porcelain"]) === "";
  const corpus = buildQ4RecallHintC1FreshCorpusV1();
  const contract = buildRhL1PerformanceContractV1({ corpus, sourceCommit });
  const execution = await runRhL1LanceDbEquivalenceV1({ corpus, contract });
  const result = {
    status: execution.status,
    mode: "RH_L1_E2_FROZEN_EMBEDDING_REAL_LANCEDB_EQUIVALENCE",
    source_commit: sourceCommit,
    worktree_clean: worktreeClean,
    performance_contract_sha256: contract.contract_sha256,
    target_plans_sha256: contract.target_plans_sha256,
    execution,
  };
  return {
    ...result,
    result_sha256: sha256(JSON.stringify(result)),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== "PASS") process.exitCode = 1;
  }).catch(error => {
    process.stderr.write(`${JSON.stringify({
      status: "FAIL",
      code: error?.code || "RH_L1_E2_EXECUTION_FAILED",
      message: String(error?.message || error),
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
