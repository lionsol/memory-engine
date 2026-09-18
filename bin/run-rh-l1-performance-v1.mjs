#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { buildQ4RecallHintC1FreshCorpusV1 } from "../lib/benchmark/q4-recall-hint-c1-corpus-v1.js";
import { createQ4RecallHintC1BSemanticSessionV1 } from "../lib/benchmark/q4-recall-hint-c1b-semantic-session-v1.js";
import {
  createQ4RecallHintC1BSiliconFlowSemanticProvidersV1,
  q4RecallHintC1BRetrievalEffectCredentialPreflightV1,
} from "../lib/benchmark/q4-recall-hint-c1b-siliconflow-retrieval-effect-v1.js";
import { buildRhL1PerformanceContractV1 } from "../lib/benchmark/rh-l1-performance-contract-v1.js";
import { runRhL1PerformanceQualificationV1 } from "../lib/benchmark/rh-l1-performance-execution-v1.js";

function fail(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function gitText(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function sourceIdentity() {
  const commit = gitText(["rev-parse", "HEAD"]);
  if (gitText(["status", "--porcelain"]) !== "") throw fail("RH_L1_SOURCE_WORKTREE_NOT_CLEAN");
  return Object.freeze({ commit, worktree_clean: true });
}

function parseArgs(argv) {
  const args = { preflight: false, executionBinding: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--preflight") args.preflight = true;
    else if (token === "--execution-binding") {
      const value = argv[index + 1];
      if (!value) throw fail("RH_L1_EXECUTION_BINDING_REQUIRED");
      args.executionBinding = value;
      index += 1;
    } else throw fail("RH_L1_CLI_ARG_UNKNOWN", `Unknown argument: ${token}`);
  }
  if (args.preflight && args.executionBinding) throw fail("RH_L1_CLI_MODE_CONFLICT");
  return args;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function atomicWriteJson(path, value, { exclusive = false } = {}) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (exclusive) {
    const fd = openSync(path, "wx", 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8" });
    } finally {
      closeSync(fd);
    }
    return;
  }
  if (existsSync(path)) throw fail("RH_L1_OUTPUT_ALREADY_EXISTS");
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

function pathsFor(sourceCommit) {
  const root = join(tmpdir(), "memory-engine-rh-l1-performance-v1", sourceCommit);
  return Object.freeze({
    root,
    attempt: join(root, "attempt.json"),
    result: join(root, "result.json"),
  });
}

function preflightPayload({ source, contract, credential, paths }) {
  return Object.freeze({
    status: "PASS",
    mode: "PREFLIGHT_ONLY",
    source_commit: source.commit,
    worktree_clean: source.worktree_clean,
    contract_sha256: contract.contract_sha256,
    execution_binding_sha256: contract.execution_binding_sha256,
    scope: contract.scope,
    quality_claim_scope: contract.quality_claim_scope,
    producer_requests: contract.producer_requests,
    target_plans_sha256: contract.target_plans_sha256,
    target_case_count: contract.target_case_count,
    target_expansion_count: contract.target_expansion_count,
    arm_order: contract.arm_order,
    total_budget: contract.total_budget,
    gates: contract.gates,
    embedding: contract.session_contract.embedding,
    rerank: contract.session_contract.rerank,
    egress: contract.egress,
    mutation: contract.mutation,
    retry_policy: contract.retry_policy,
    credential_env: credential.credential_env,
    credential_available: credential.available,
    attempt_path: paths.attempt,
    result_path: paths.result,
  });
}

function safeError(error, context = {}) {
  return {
    status: "STOPPED",
    mode: "PERFORMANCE_QUALIFICATION",
    code: typeof error?.code === "string" ? error.code : "RH_L1_EXECUTION_FAILED",
    message: String(error?.message || "RH-L1 execution failed").slice(0, 300),
    source_commit: context.sourceCommit || null,
    execution_binding_sha256: context.executionBinding || null,
    usage: error?.rh_l1_usage || null,
    retry_policy: "NO_RETRY_NO_RESUME_NO_REPLAY",
  };
}

export async function main(argv = process.argv.slice(2), { env = process.env } = {}) {
  const args = parseArgs(argv);
  const source = sourceIdentity();
  const corpus = buildQ4RecallHintC1FreshCorpusV1();
  const contract = buildRhL1PerformanceContractV1({ corpus, sourceCommit: source.commit });
  const credential = q4RecallHintC1BRetrievalEffectCredentialPreflightV1({ env });
  const paths = pathsFor(source.commit);
  const preflight = preflightPayload({ source, contract, credential, paths });
  if (args.preflight) return preflight;

  if (args.executionBinding !== contract.execution_binding_sha256) {
    throw fail("RH_L1_EXECUTION_BINDING_MISMATCH");
  }
  if (existsSync(paths.attempt) || existsSync(paths.result)) {
    throw fail("RH_L1_TRANSACTION_ALREADY_CONSUMED");
  }

  atomicWriteJson(paths.attempt, {
    schema: "memory_engine_rh_l1_performance_attempt_v1",
    source_commit: source.commit,
    execution_binding_sha256: contract.execution_binding_sha256,
    max_executions: 1,
    retry_policy: contract.retry_policy,
    state: "CONSUMED",
  }, { exclusive: true });

  try {
    const sequentialProviders = createQ4RecallHintC1BSiliconFlowSemanticProvidersV1({
      contract: contract.session_contract,
      env,
    });
    const parallelProviders = createQ4RecallHintC1BSiliconFlowSemanticProvidersV1({
      contract: contract.session_contract,
      env,
    });
    const execution = await runRhL1PerformanceQualificationV1({
      corpus,
      contract,
      sessionFactory: createQ4RecallHintC1BSemanticSessionV1,
      sequentialEmbeddingProvider: sequentialProviders.embeddingProvider,
      sequentialRerankAdapter: sequentialProviders.rerankAdapter,
      parallelEmbeddingProvider: parallelProviders.embeddingProvider,
      parallelRerankAdapter: parallelProviders.rerankAdapter,
    });
    const resultSha256 = sha256(JSON.stringify({
      source_commit: source.commit,
      contract_sha256: contract.contract_sha256,
      execution,
    }));
    const result = {
      ...preflight,
      mode: "PERFORMANCE_QUALIFICATION",
      status: execution.status,
      execution,
      result_sha256: resultSha256,
    };
    atomicWriteJson(paths.result, result);
    return result;
  } catch (error) {
    const stopped = {
      ...preflight,
      ...safeError(error, {
        sourceCommit: source.commit,
        executionBinding: contract.execution_binding_sha256,
      }),
    };
    if (!existsSync(paths.result)) atomicWriteJson(paths.result, stopped);
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch(error => {
    process.stderr.write(`${JSON.stringify(safeError(error), null, 2)}\n`);
    process.exitCode = 1;
  });
}
