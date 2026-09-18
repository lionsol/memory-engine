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

import {
  Q5_FIXED_POOL_SCORE_CAPTURE_RETRY_POLICY,
  buildQ5FixedPoolScoreCapturePreflightV1,
  readQ5FixedPoolScoreCaptureFixtureV1,
  runQ5FixedPoolScoreCaptureV1,
} from "../lib/benchmark/q5-fixed-pool-score-capture-v1.js";

function fail(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseArgs(argv) {
  const args = {
    mode: null,
    fixture: resolve("test/fixtures/q5-fixed-candidate-q4-derived-v1.json"),
    outDir: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--preflight") args.mode = "preflight";
    else if (token === "--execute") args.mode = "execute";
    else if (token === "--fixture") {
      const value = argv[index + 1];
      if (!value) throw fail("Q5_SCORE_CAPTURE_CLI_FIXTURE_REQUIRED");
      args.fixture = resolve(value);
      index += 1;
    } else if (token === "--out-dir") {
      const value = argv[index + 1];
      if (!value) throw fail("Q5_SCORE_CAPTURE_CLI_OUT_DIR_REQUIRED");
      args.outDir = resolve(value);
      index += 1;
    } else {
      throw fail("Q5_SCORE_CAPTURE_CLI_ARG_UNKNOWN", `Unknown argument: ${token}`);
    }
  }
  if (!args.mode) throw fail("Q5_SCORE_CAPTURE_CLI_MODE_REQUIRED");
  return args;
}

function gitText(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function sourceIdentity() {
  const commit = gitText(["rev-parse", "HEAD"]);
  if (gitText(["status", "--porcelain"]) !== "") {
    throw fail("Q5_SCORE_CAPTURE_SOURCE_WORKTREE_NOT_CLEAN");
  }
  return Object.freeze({ commit, worktree_clean: true });
}

function safeError(error) {
  return String(error?.message || "Q5 score capture failed")
    .replace(/authorization\s*:\s*bearer\s+[^\s]+/giu, "authorization: bearer [redacted]")
    .replace(/bearer\s+[^\s]+/giu, "bearer [redacted]")
    .replace(/(api[_-]?key|token|secret)\s*[=:]\s*[^\s,;]+/giu, "$1=[redacted]")
    .slice(0, 300);
}

function atomicWriteJson(path, value, { replace = false } = {}) {
  if (!replace && existsSync(path)) throw fail("Q5_SCORE_CAPTURE_OUTPUT_ALREADY_EXISTS");
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, path);
}

export async function main(argv = process.argv.slice(2), { env = process.env } = {}) {
  const args = parseArgs(argv);
  const source = sourceIdentity();
  const fixture = readQ5FixedPoolScoreCaptureFixtureV1(args.fixture);
  const preflight = buildQ5FixedPoolScoreCapturePreflightV1({
    fixture,
    sourceCommit: source.commit,
    env,
  });
  const root = args.outDir || join(
    tmpdir(),
    "memory-engine-q5-fixed-pool-rerank-score-capture-v1",
    source.commit,
  );
  const attemptPath = join(root, "attempt.json");
  const resultPath = join(root, "result.json");
  const stopPath = join(root, "stop.json");

  if (args.mode === "preflight") {
    return Object.freeze({
      ...preflight,
      output_dir: root,
      attempt_path: attemptPath,
      result_path: resultPath,
    });
  }

  if (existsSync(attemptPath) || existsSync(resultPath) || existsSync(stopPath)) {
    throw fail("Q5_SCORE_CAPTURE_TRANSACTION_ALREADY_CONSUMED");
  }

  const attempt = {
    status: "CONSUMED",
    execution_status: "STARTED",
    source_commit: source.commit,
    worktree_clean: true,
    fixture_sha256: fixture.fixture_sha256,
    planned_provider_calls: preflight.planned_provider_calls,
    provider_attempts_started: 0,
    retry_policy: Q5_FIXED_POOL_SCORE_CAPTURE_RETRY_POLICY,
    provider: preflight.provider,
    model: preflight.model,
    revision: preflight.revision,
    embedding_calls: 0,
    hint_producer_calls: 0,
    model_training_runs: 0,
  };
  atomicWriteJson(attemptPath, attempt);

  let lastAttempt = 0;
  try {
    const result = await runQ5FixedPoolScoreCaptureV1({
      fixture,
      sourceCommit: source.commit,
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
      output_dir: root,
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
      code: typeof error?.code === "string" ? error.code : "Q5_SCORE_CAPTURE_EXECUTION_FAILED",
      message: safeError(error),
      source_commit: source.commit,
      fixture_sha256: fixture.fixture_sha256,
      provider_attempts_started: lastAttempt,
      planned_provider_calls: preflight.planned_provider_calls,
      retry_policy: Q5_FIXED_POOL_SCORE_CAPTURE_RETRY_POLICY,
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
      code: error?.code || "Q5_SCORE_CAPTURE_EXECUTION_FAILED",
      message: safeError(error),
      retry_policy: Q5_FIXED_POOL_SCORE_CAPTURE_RETRY_POLICY,
      replay_authorized: false,
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
