#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { buildQ4RecallHintC1FreshCorpusV1 } from "../lib/benchmark/q4-recall-hint-c1-corpus-v1.js";
import { buildQ4RecallHintC1BDevelopmentHintsV1 } from "../lib/benchmark/q4-recall-hint-c1b-development-hints-v1.js";
import { buildQ4RecallHintC1BRetrievalEffectContractV1 } from "../lib/benchmark/q4-recall-hint-c1b-retrieval-effect-contract-v1.js";
import { runQ4RecallHintC1BRetrievalEffectV1 } from "../lib/benchmark/q4-recall-hint-c1b-retrieval-effect-execution-v1.js";
import {
  createQ4RecallHintC1BSiliconFlowRetrievalProvidersV1,
  q4RecallHintC1BRetrievalEffectCredentialPreflightV1,
} from "../lib/benchmark/q4-recall-hint-c1b-siliconflow-retrieval-effect-v1.js";

function fail(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseArgs(argv) {
  const args = { preflight: false, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--preflight") args.preflight = true;
    else if (token === "--out") {
      const value = argv[index + 1];
      if (!value) throw fail("Q4_C1B_RETRIEVAL_CLI_OUT_REQUIRED");
      args.out = resolve(value);
      index += 1;
    } else throw fail("Q4_C1B_RETRIEVAL_CLI_ARG_UNKNOWN", `Unknown argument: ${token}`);
  }
  return args;
}

function gitText(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function sourceIdentity() {
  const commit = gitText(["rev-parse", "HEAD"]);
  if (gitText(["status", "--porcelain"]) !== "") throw fail("Q4_C1B_RETRIEVAL_SOURCE_WORKTREE_NOT_CLEAN");
  return Object.freeze({ commit, worktree_clean: true });
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function atomicWriteJson(path, value) {
  if (existsSync(path)) throw fail("Q4_C1B_RETRIEVAL_OUTPUT_ALREADY_EXISTS");
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

function preflightPayload({ source, contract, outputPath, credential }) {
  return {
    status: "PASS",
    mode: "PREFLIGHT_ONLY",
    source_commit: source.commit,
    worktree_clean: source.worktree_clean,
    scope: contract.scope,
    quality_claim_scope: contract.quality_claim_scope,
    manifest_sha256: contract.manifest_sha256,
    development_sha256: contract.development_sha256,
    producer_result_sha256: contract.producer_result_sha256,
    development_hints_sha256: contract.development_hints_sha256,
    case_count: contract.case_count,
    acceptance_case_count: contract.acceptance_case_count,
    candidate_generation: contract.candidate_generation,
    candidate_depth: contract.candidate_depth,
    top_k: contract.top_k,
    embedding: contract.embedding,
    rerank: contract.rerank,
    producer: contract.producer,
    cost_binding: contract.cost_binding,
    credential_env: credential.credential_env,
    credential_available: credential.available,
    retry_policy: "NO_AUTOMATIC_RETRY_OR_RESUME",
    output_path: outputPath,
  };
}

function safeError(error, outputPath) {
  return {
    status: "STOP",
    code: typeof error?.code === "string" ? error.code : "Q4_C1B_RETRIEVAL_EXECUTION_FAILED",
    message: String(error?.message || "retrieval-effect execution failed").slice(0, 300),
    provider_usage: error?.q4_provider_usage || null,
    retry_policy: "NO_AUTOMATIC_RETRY_OR_RESUME",
    output_path: outputPath,
  };
}

export async function main(argv = process.argv.slice(2), { env = process.env } = {}) {
  const args = parseArgs(argv);
  const source = sourceIdentity();
  const corpus = buildQ4RecallHintC1FreshCorpusV1();
  const hints = buildQ4RecallHintC1BDevelopmentHintsV1(corpus);
  const contract = buildQ4RecallHintC1BRetrievalEffectContractV1({ corpus, hintSnapshot: hints });
  const credential = q4RecallHintC1BRetrievalEffectCredentialPreflightV1({ env });
  const outputPath = args.out || join(
    tmpdir(),
    "memory-engine-q4-c1b-retrieval-effect-v1",
    source.commit,
    "result.json",
  );
  const preflight = preflightPayload({ source, contract, outputPath, credential });
  if (args.preflight) return preflight;
  if (existsSync(outputPath)) throw fail("Q4_C1B_RETRIEVAL_OUTPUT_ALREADY_EXISTS");

  const providers = createQ4RecallHintC1BSiliconFlowRetrievalProvidersV1({ corpus, hintSnapshot: hints, env });
  const result = await runQ4RecallHintC1BRetrievalEffectV1({
    corpus,
    hintSnapshot: hints,
    embeddingProvider: providers.embeddingProvider,
    rerankAdapter: providers.rerankAdapter,
  });
  const resultSha256 = sha256(JSON.stringify({
    source_commit: source.commit,
    contract,
    provider_usage: result.provider_usage,
    evaluation: result.evaluation,
  }));
  const output = {
    ...preflight,
    mode: "DEVELOPMENT_RETRIEVAL_EFFECT_EXECUTION",
    provider_usage: result.provider_usage,
    evaluation: result.evaluation,
    result_sha256: resultSha256,
  };
  atomicWriteJson(outputPath, output);
  return output;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch(error => {
    const parsed = (() => {
      try { return parseArgs(process.argv.slice(2)); } catch { return { out: null }; }
    })();
    process.stderr.write(`${JSON.stringify(safeError(error, parsed.out), null, 2)}\n`);
    process.exitCode = 1;
  });
}
