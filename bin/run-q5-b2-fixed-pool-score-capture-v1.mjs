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

import { loadFrozenInputs } from "./run-locomo-chunk-rerank-v1.mjs";
import { buildC1ALocomoQualificationCases } from "../lib/benchmark/c1a-locomo-qualification.js";
import {
  Q5_B2_RETRY_POLICY,
  buildQ5B2PreflightV1,
  runQ5B2ScoreCaptureV1,
} from "../lib/benchmark/q5-b2-fixed-pool-score-capture-v1.js";

const DEFAULT_ROOT =
  "/home/lionsol/.openclaw/workspace/q3-locomo-v1.2/runs/q3-locomo-chunk-fts-rerank-v1";
const DEFAULT_MANIFEST = "test/fixtures/q5-b1-score-capture-manifest-v1.json";

function fail(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function readJsonl(path) {
  const text = readFileSync(path, "utf8").trim();
  return text === "" ? [] : text.split(/\n/u).map(line => JSON.parse(line));
}

function parseArgs(argv) {
  const args = {
    mode: null,
    root: DEFAULT_ROOT,
    manifest: DEFAULT_MANIFEST,
    outDir: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--preflight") args.mode = "preflight";
    else if (token === "--execute") args.mode = "execute";
    else if (token === "--root") args.root = argv[++index];
    else if (token === "--manifest") args.manifest = argv[++index];
    else if (token === "--out-dir") args.outDir = argv[++index];
    else throw fail("Q5_B2_CLI_ARG_UNKNOWN", `Unknown argument: ${token}`);
  }
  if (!args.mode) throw fail("Q5_B2_CLI_MODE_REQUIRED");
  return args;
}

function gitText(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function sourceIdentity({ requireClean }) {
  const commit = gitText(["rev-parse", "HEAD"]);
  const clean = gitText(["status", "--porcelain"]) === "";
  if (requireClean && !clean) throw fail("Q5_B2_SOURCE_WORKTREE_NOT_CLEAN");
  return Object.freeze({ commit, clean });
}

function safeError(error) {
  return String(error?.message || "Q5-B2 score capture failed")
    .replace(/authorization\s*:\s*bearer\s+[^\s]+/giu, "authorization: bearer [redacted]")
    .replace(/bearer\s+[^\s]+/giu, "bearer [redacted]")
    .replace(/(api[_-]?key|token|secret)\s*[=:]\s*[^\s,;]+/giu, "$1=[redacted]")
    .slice(0, 300);
}

function atomicWriteJson(path, value, { replace = false } = {}) {
  if (!replace && existsSync(path)) throw fail("Q5_B2_OUTPUT_ALREADY_EXISTS");
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, path);
}

function loadMaterial(root, repositoryRoot) {
  const frozen = loadFrozenInputs(root, repositoryRoot);
  const turnRows = readJsonl(join(root, "input", "chunk-material", "turn-chunk-map.jsonl"));
  return buildC1ALocomoQualificationCases({
    frozen,
    turnRows,
    egressDecision: "UNKNOWN",
  });
}

export async function main(argv = process.argv.slice(2), { env = process.env } = {}) {
  const args = parseArgs(argv);
  const repositoryRoot = process.cwd();
  const identity = sourceIdentity({ requireClean: args.mode === "execute" });
  const root = resolve(args.root);
  const manifest = JSON.parse(readFileSync(resolve(args.manifest), "utf8"));
  const material = loadMaterial(root, repositoryRoot);
  const preflight = buildQ5B2PreflightV1({
    manifest,
    material,
    sourceCommit: identity.commit,
    env,
  });

  const outputRoot = args.outDir
    ? resolve(args.outDir)
    : join(tmpdir(), "memory-engine-q5-b2-fixed-pool-score-capture-v1", identity.commit);
  const attemptPath = join(outputRoot, "attempt.json");
  const resultPath = join(outputRoot, "result.json");
  const stopPath = join(outputRoot, "stop.json");

  if (args.mode === "preflight") {
    return Object.freeze({
      ...preflight,
      worktree_clean: identity.clean,
      output_dir: outputRoot,
      attempt_path: attemptPath,
      result_path: resultPath,
    });
  }

  if (existsSync(attemptPath) || existsSync(resultPath) || existsSync(stopPath)) {
    throw fail("Q5_B2_TRANSACTION_ALREADY_CONSUMED");
  }

  const attempt = {
    status: "CONSUMED",
    execution_status: "STARTED",
    source_commit: identity.commit,
    worktree_clean: true,
    source_b1_manifest_sha256: manifest.manifest_sha256,
    planned_provider_calls: preflight.planned_provider_calls,
    provider_attempts_started: 0,
    retry_policy: Q5_B2_RETRY_POLICY,
    provider: preflight.provider,
    model: preflight.model,
    revision: preflight.revision,
    embedding_calls: 0,
    candidate_generation_runs: 0,
    hint_producer_calls: 0,
    model_training_runs: 0,
  };
  atomicWriteJson(attemptPath, attempt);

  let lastAttempt = 0;
  try {
    const result = await runQ5B2ScoreCaptureV1({
      manifest,
      material,
      sourceCommit: identity.commit,
      env,
      onProviderAttempt: ({ attempt: providerAttempt }) => {
        lastAttempt = providerAttempt;
        atomicWriteJson(attemptPath, {
          ...attempt,
          provider_attempts_started: providerAttempt,
        }, { replace: true });
      },
    });

    atomicWriteJson(resultPath, {
      ...preflight,
      mode: result.mode,
      provider_attempts: result.provider_attempts,
      provider_successes: result.provider_successes,
      provider_attempt_cap: result.provider_attempt_cap,
      provider_usage: result.provider_usage,
      packet: result.packet,
      packet_sha256: result.packet.packet_sha256,
      output_dir: outputRoot,
      retry_policy: result.retry_policy,
    });
    atomicWriteJson(attemptPath, {
      ...attempt,
      execution_status: "PASS",
      provider_attempts_started: result.provider_attempts,
      provider_successes: result.provider_successes,
      packet_sha256: result.packet.packet_sha256,
      result_path: resultPath,
    }, { replace: true });
    return JSON.parse(readFileSync(resultPath, "utf8"));
  } catch (error) {
    const stop = {
      status: "STOPPED",
      code: typeof error?.code === "string" ? error.code : "Q5_B2_EXECUTION_FAILED",
      message: safeError(error),
      source_commit: identity.commit,
      source_b1_manifest_sha256: manifest.manifest_sha256,
      provider_attempts_started: lastAttempt,
      planned_provider_calls: preflight.planned_provider_calls,
      retry_policy: Q5_B2_RETRY_POLICY,
      replay_authorized: false,
    };
    atomicWriteJson(stopPath, stop);
    atomicWriteJson(attemptPath, {
      ...attempt,
      execution_status: "STOPPED",
      provider_attempts_started: lastAttempt,
      stop_path: stopPath,
    }, { replace: true });
    throw Object.assign(error instanceof Error ? error : new Error(stop.message), {
      q5_stop: stop,
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch(error => {
    process.stderr.write(`${JSON.stringify(error?.q5_stop || {
      status: "STOPPED",
      code: error?.code || "Q5_B2_EXECUTION_FAILED",
      message: safeError(error),
      retry_policy: Q5_B2_RETRY_POLICY,
      replay_authorized: false,
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
