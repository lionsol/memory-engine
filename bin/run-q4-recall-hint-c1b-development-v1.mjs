#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { buildQ4RecallHintC1FreshCorpusV1 } from "../lib/benchmark/q4-recall-hint-c1-corpus-v1.js";
import {
  assertQ4RecallHintC1FrozenIdentityV1,
  buildQ4RecallHintC1ManifestV1,
} from "../lib/benchmark/q4-recall-hint-c1-manifest-v1.js";
import {
  buildQ4RecallHintC1BDevelopmentAuthorizationV1,
  runQ4RecallHintC1BDevelopmentV1,
} from "../lib/benchmark/q4-recall-hint-c1b-development-execution-v1.js";
import { buildQ4RecallHintC1BSiliconFlowPacketV1 } from "../lib/benchmark/q4-recall-hint-c1b-siliconflow-v4flash-v1.js";
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
  const result = { preflight: false, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--preflight") {
      result.preflight = true;
    } else if (arg === "--out") {
      const next = argv[index + 1];
      if (!next) throw fail("Q4_C1B_DEV_CLI_OUT_REQUIRED");
      result.out = resolve(next);
      index += 1;
    } else {
      throw fail("Q4_C1B_DEV_CLI_ARG_UNKNOWN", `Unknown argument: ${arg}`);
    }
  }
  return result;
}

function gitText(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function sourceIdentity() {
  const commit = gitText(["rev-parse", "HEAD"]);
  const status = gitText(["status", "--porcelain"]);
  if (status !== "") throw fail("Q4_C1B_DEV_SOURCE_WORKTREE_NOT_CLEAN");
  return { commit, worktree_clean: true };
}

function readProgress(path) {
  if (!existsSync(path)) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw fail("Q4_C1B_DEV_PROGRESS_FILE_INVALID");
  }
  return parsed;
}

function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

function safeError(error, progressPath) {
  return {
    status: "STOP",
    code: typeof error?.code === "string" ? error.code : "Q4_C1B_DEV_EXECUTION_FAILED",
    message: String(error?.message || "development execution failed").slice(0, 300),
    progress_path: progressPath,
  };
}

export async function main(argv = process.argv.slice(2), { env = process.env } = {}) {
  const args = parseArgs(argv);
  const source = sourceIdentity();
  const corpus = buildQ4RecallHintC1FreshCorpusV1();
  const manifest = buildQ4RecallHintC1ManifestV1(corpus);
  assertQ4RecallHintC1FrozenIdentityV1(corpus);
  const packet = buildQ4RecallHintC1BSiliconFlowPacketV1({
    manifest,
    sourceCommit: source.commit,
  });
  const authorization = buildQ4RecallHintC1BDevelopmentAuthorizationV1({
    packet,
    manifest,
    sourceCommit: source.commit,
  });
  const credential = q4RecallHintC1BSiliconFlowCredentialPreflightV1({ env });
  const progressPath = args.out || join(
    tmpdir(),
    "memory-engine-q4-c1b-development-v1",
    source.commit,
    "progress.json",
  );

  const preflight = {
    status: "PASS",
    mode: args.preflight ? "PREFLIGHT_ONLY" : "DEVELOPMENT_EXECUTION",
    source_commit: source.commit,
    worktree_clean: true,
    manifest_sha256: manifest.manifest_sha256,
    development_sha256: manifest.development_sha256,
    provider: packet.provider,
    model: packet.model,
    endpoint: packet.endpoint,
    prompt_sha256: packet.prompt_sha256,
    output_schema_sha256: packet.output_schema_sha256,
    credential_env: credential.credential_env,
    credential_available: credential.available,
    max_provider_requests: authorization.max_provider_requests,
    max_acceptance_requests: authorization.max_acceptance_requests,
    max_input_tokens: authorization.max_input_tokens,
    max_output_tokens: authorization.max_output_tokens,
    max_cost: authorization.max_cost,
    billing_currency: authorization.billing_currency,
    deadline_ms: authorization.deadline_ms,
    progress_path: progressPath,
  };
  if (args.preflight) return preflight;

  const existingProgress = readProgress(progressPath);
  const transport = createQ4RecallHintC1BSiliconFlowTransportV1({ packet, env });
  const result = await runQ4RecallHintC1BDevelopmentV1({
    corpus,
    manifest,
    packet,
    sourceCommit: source.commit,
    transport,
    existingProgress,
    onProgress: progress => atomicWriteJson(progressPath, progress),
  });
  return {
    ...preflight,
    status: result.progress.status,
    usage: result.progress.usage,
    summary: result.progress.summary,
    result_sha256: result.progress.result_sha256,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch(error => {
    const args = (() => {
      try { return parseArgs(process.argv.slice(2)); } catch { return { out: null }; }
    })();
    const fallbackPath = args.out || null;
    process.stderr.write(`${JSON.stringify(safeError(error, fallbackPath), null, 2)}\n`);
    process.exitCode = 1;
  });
}
