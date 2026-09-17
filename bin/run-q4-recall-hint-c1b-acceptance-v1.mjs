#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { buildQ4RecallHintC1FreshCorpusV1 } from "../lib/benchmark/q4-recall-hint-c1-corpus-v1.js";
import { buildQ4RecallHintC1BAcceptanceContractV1 } from "../lib/benchmark/q4-recall-hint-c1b-acceptance-contract-v1.js";
import { runQ4RecallHintC1BAcceptanceV1 } from "../lib/benchmark/q4-recall-hint-c1b-acceptance-execution-v1.js";
import {
  createQ4RecallHintC1BSiliconFlowSemanticProvidersV1,
  q4RecallHintC1BRetrievalEffectCredentialPreflightV1,
} from "../lib/benchmark/q4-recall-hint-c1b-siliconflow-retrieval-effect-v1.js";
import {
  createQ4RecallHintC1BSiliconFlowTransportV1,
  q4RecallHintC1BSiliconFlowCredentialPreflightV1,
} from "../lib/benchmark/q4-recall-hint-c1b-siliconflow-transport-v1.js";

function fail(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseArgs(argv) {
  const args = { preflight: false, executionBinding: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--preflight") args.preflight = true;
    else if (token === "--execution-binding") {
      const value = argv[index + 1];
      if (!value) throw fail("Q4_C1B_ACCEPTANCE_CLI_EXECUTION_BINDING_REQUIRED");
      args.executionBinding = value.trim();
      index += 1;
    } else throw fail("Q4_C1B_ACCEPTANCE_CLI_ARG_UNKNOWN", `Unknown argument: ${token}`);
  }
  if (args.preflight && args.executionBinding) throw fail("Q4_C1B_ACCEPTANCE_CLI_MODE_CONFLICT");
  if (!args.preflight && !args.executionBinding) throw fail("Q4_C1B_ACCEPTANCE_CLI_EXECUTION_BINDING_REQUIRED");
  return args;
}

function gitText(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function sourceIdentity() {
  const commit = gitText(["rev-parse", "HEAD"]);
  if (gitText(["status", "--porcelain"]) !== "") throw fail("Q4_C1B_ACCEPTANCE_SOURCE_WORKTREE_NOT_CLEAN");
  return Object.freeze({ commit, worktree_clean: true });
}

function transactionPaths(sourceCommit, baseDir = tmpdir()) {
  const root = join(baseDir, "memory-engine-q4-c1b-acceptance-v1", sourceCommit);
  return Object.freeze({
    root,
    attempt_path: join(root, "attempt.json"),
    result_path: join(root, "result.json"),
  });
}

function atomicWriteJson(path, value, { exclusive = true } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  if (exclusive && existsSync(path)) throw fail("Q4_C1B_ACCEPTANCE_OUTPUT_ALREADY_EXISTS");
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    ...(exclusive ? { flag: "wx" } : {}),
  });
  renameSync(temporary, path);
}

function writeAttemptMarker(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if (error?.code === "EEXIST") throw fail("Q4_C1B_ACCEPTANCE_ATTEMPT_ALREADY_EXISTS");
    throw error;
  }
}

function safeError(error, paths = null) {
  return {
    status: "STOPPED",
    code: typeof error?.code === "string" ? error.code : "Q4_C1B_ACCEPTANCE_EXECUTION_FAILED",
    message: String(error?.message || "Q4-C1b acceptance execution failed").slice(0, 300),
    phase: typeof error?.q4_acceptance_phase === "string" ? error.q4_acceptance_phase : null,
    usage: error?.q4_acceptance_usage || null,
    retry_policy: "NO_RETRY_NO_RESUME_NO_REPLAY",
    attempt_path: paths?.attempt_path || null,
    result_path: paths?.result_path || null,
  };
}

function preflightPayload({ source, contract, paths, credential }) {
  return {
    status: "PASS",
    mode: "PREFLIGHT_ONLY",
    source_commit: source.commit,
    worktree_clean: source.worktree_clean,
    execution_binding_sha256: contract.execution_binding_sha256,
    scope: contract.scope,
    manifest_sha256: contract.manifest_sha256,
    acceptance_sha256: contract.acceptance_sha256,
    case_count: contract.case_count,
    candidate_depth: contract.candidate_depth,
    top_k: contract.top_k,
    execution_policy: contract.execution_policy,
    baseline_eligibility: contract.baseline_eligibility,
    producer: contract.producer,
    embedding: contract.embedding,
    rerank: contract.rerank,
    cost_binding: contract.cost_binding,
    egress: contract.egress,
    mutation: contract.mutation,
    credential_env: credential.credential_env,
    credential_available: credential.available,
    attempt_path: paths.attempt_path,
    result_path: paths.result_path,
  };
}

export async function main(argv = process.argv.slice(2), {
  env = process.env,
  source = null,
  baseDir = tmpdir(),
  producerTransportFactory = createQ4RecallHintC1BSiliconFlowTransportV1,
  semanticProvidersFactory = createQ4RecallHintC1BSiliconFlowSemanticProvidersV1,
  execute = runQ4RecallHintC1BAcceptanceV1,
} = {}) {
  const args = parseArgs(argv);
  const resolvedSource = source || sourceIdentity();
  if (!resolvedSource?.worktree_clean || typeof resolvedSource?.commit !== "string" || !resolvedSource.commit.trim()) {
    throw fail("Q4_C1B_ACCEPTANCE_SOURCE_IDENTITY_INVALID");
  }
  const corpus = buildQ4RecallHintC1FreshCorpusV1();
  const contract = buildQ4RecallHintC1BAcceptanceContractV1({
    corpus,
    sourceCommit: resolvedSource.commit,
  });
  const paths = transactionPaths(resolvedSource.commit, baseDir);
  const producerCredential = q4RecallHintC1BSiliconFlowCredentialPreflightV1({ env });
  const semanticCredential = q4RecallHintC1BRetrievalEffectCredentialPreflightV1({ env });
  if (producerCredential.credential_env !== semanticCredential.credential_env) {
    throw fail("Q4_C1B_ACCEPTANCE_CREDENTIAL_BINDING_MISMATCH");
  }
  const preflight = preflightPayload({
    source: resolvedSource,
    contract,
    paths,
    credential: semanticCredential,
  });
  if (args.preflight) return preflight;

  if (args.executionBinding !== contract.execution_binding_sha256) {
    throw fail("Q4_C1B_ACCEPTANCE_EXECUTION_BINDING_MISMATCH");
  }
  if (existsSync(paths.attempt_path)) throw fail("Q4_C1B_ACCEPTANCE_ATTEMPT_ALREADY_EXISTS");
  if (existsSync(paths.result_path)) throw fail("Q4_C1B_ACCEPTANCE_OUTPUT_ALREADY_EXISTS");

  const producerTransport = producerTransportFactory({ packet: contract.producer_packet, env });
  const semanticProviders = semanticProvidersFactory({ contract, env });
  writeAttemptMarker(paths.attempt_path, {
    schema: "memory_engine_q4_recall_hint_c1b_acceptance_attempt_v1",
    source_commit: resolvedSource.commit,
    execution_binding_sha256: contract.execution_binding_sha256,
    max_executions: 1,
    retry_policy: "NO_RETRY_NO_RESUME_NO_REPLAY",
    state: "CONSUMED",
  });

  try {
    const result = await execute({
      corpus,
      sourceCommit: resolvedSource.commit,
      executionBindingSha256: contract.execution_binding_sha256,
      producerTransport,
      embeddingProvider: semanticProviders.embeddingProvider,
      rerankAdapter: semanticProviders.rerankAdapter,
    });
    const output = {
      ...preflight,
      mode: "ACCEPTANCE_EXECUTION",
      status: result.status,
      stop_phase: result.stop_phase,
      baseline_eligibility_result: result.baseline_eligibility,
      producer_usage: result.producer_usage,
      producer_summary: result.producer_summary || null,
      semantic_usage: result.semantic_usage,
      evaluation: result.evaluation,
      result_sha256: result.result_sha256 || null,
    };
    atomicWriteJson(paths.result_path, output);
    return output;
  } catch (error) {
    const failure = {
      ...preflight,
      ...safeError(error, paths),
      mode: "ACCEPTANCE_EXECUTION",
    };
    if (!existsSync(paths.result_path)) atomicWriteJson(paths.result_path, failure);
    error.q4_acceptance_result_path = paths.result_path;
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
