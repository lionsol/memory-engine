#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { loadFrozenInputs } from "./run-locomo-chunk-rerank-v1.mjs";
import { validateC1AExecutionPacket } from "../lib/benchmark/c1a-execution-packet.js";
import { prepareC1ALocomoQualification } from "../lib/benchmark/c1a-locomo-qualification.js";
import { executeC1ALocomoQualification } from "../lib/benchmark/c1a-qualification-execution.js";
import {
  createSiliconFlowHttpsTransport,
  createSiliconFlowRerankAdapter,
} from "../lib/recall/rerank/siliconflow-rerank-adapter.js";

export const C1A_DEFAULT_FROZEN_ROOT = "/home/lionsol/.openclaw/workspace/q3-locomo-v1.2/runs/q3-locomo-chunk-fts-rerank-v1";

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readJsonl(path) {
  const text = readFileSync(path, "utf8").trim();
  return text === "" ? [] : text.split(/\n/u).map(line => JSON.parse(line));
}

function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function resolveGitIdentity(repositoryRoot) {
  const commit = spawnSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (commit.status !== 0) throw fail("C1A_GIT_COMMIT_UNAVAILABLE");
  const status = spawnSync("git", ["-C", repositoryRoot, "status", "--porcelain"], { encoding: "utf8" });
  if (status.status !== 0) throw fail("C1A_GIT_STATUS_UNAVAILABLE");
  return {
    sourceCommit: commit.stdout.trim(),
    worktreeClean: status.stdout.trim() === "",
  };
}

export function prepareC1AFromFrozen({
  frozenRoot,
  repositoryRoot,
  egressDecision,
  qualificationSourceIdentity = null,
  loadFrozen = loadFrozenInputs,
  readTurnRows = root => readJsonl(join(root, "input", "chunk-material", "turn-chunk-map.jsonl")),
} = {}) {
  const frozen = loadFrozen(frozenRoot, repositoryRoot);
  const turnRows = readTurnRows(frozenRoot);
  return prepareC1ALocomoQualification({
    frozen,
    turnRows,
    egressDecision,
    qualificationSourceIdentity,
  });
}

export function createC1APacer({
  min_interval_ms: minIntervalMs,
  token_window_ms: tokenWindowMs,
  max_estimated_tokens_per_window: maxEstimatedTokensPerWindow,
} = {}, {
  now = Date.now,
  sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms)),
} = {}) {
  if (!Number.isSafeInteger(minIntervalMs) || minIntervalMs < 0
      || !Number.isSafeInteger(tokenWindowMs) || tokenWindowMs <= 0
      || !Number.isSafeInteger(maxEstimatedTokensPerWindow) || maxEstimatedTokensPerWindow <= 0) {
    throw fail("C1A_PACING_POLICY_INVALID");
  }
  let lastStartedAt = null;
  let tokenEvents = [];

  return async ({ estimated_request_tokens: estimatedTokens } = {}) => {
    if (!Number.isSafeInteger(estimatedTokens) || estimatedTokens < 0) {
      throw fail("C1A_PACING_ESTIMATED_TOKENS_INVALID");
    }
    if (estimatedTokens > maxEstimatedTokensPerWindow) {
      throw fail("C1A_PACING_SINGLE_REQUEST_EXCEEDS_TOKEN_WINDOW");
    }

    while (true) {
      const current = now();
      tokenEvents = tokenEvents.filter(event => current - event.startedAt < tokenWindowMs);
      const tokenSum = tokenEvents.reduce((sum, event) => sum + event.tokens, 0);
      const intervalWait = lastStartedAt === null
        ? 0
        : Math.max(0, minIntervalMs - (current - lastStartedAt));
      let tokenWait = 0;
      if (tokenSum + estimatedTokens > maxEstimatedTokensPerWindow) {
        let remaining = tokenSum;
        for (const event of tokenEvents) {
          remaining -= event.tokens;
          if (remaining + estimatedTokens <= maxEstimatedTokensPerWindow) {
            tokenWait = Math.max(0, event.startedAt + tokenWindowMs - current);
            break;
          }
        }
      }
      const waitMs = Math.max(intervalWait, tokenWait);
      if (waitMs <= 0) break;
      await sleep(waitMs);
    }

    const startedAt = now();
    tokenEvents = tokenEvents.filter(event => startedAt - event.startedAt < tokenWindowMs);
    tokenEvents.push({ startedAt, tokens: estimatedTokens });
    lastStartedAt = startedAt;
  };
}

function parseArgs(argv) {
  const [command, ...tokens] = argv;
  const args = {
    command,
    frozenRoot: C1A_DEFAULT_FROZEN_ROOT,
    repositoryRoot: process.cwd(),
    egressDecision: null,
    output: null,
    manifest: null,
    packet: null,
    executionRoot: null,
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--root") args.frozenRoot = tokens[++index];
    else if (token === "--repo") args.repositoryRoot = tokens[++index];
    else if (token === "--egress-decision") args.egressDecision = tokens[++index];
    else if (token === "--output") args.output = tokens[++index];
    else if (token === "--manifest") args.manifest = tokens[++index];
    else if (token === "--packet") args.packet = tokens[++index];
    else if (token === "--execution-root") args.executionRoot = tokens[++index];
    else if (token === "--help" || token === "-h") args.help = true;
    else throw fail("C1A_CLI_ARGUMENT_UNKNOWN", { token });
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    "  node bin/run-c1a-qualification-v1.mjs prepare --root <frozen-root> --repo <repo> --egress-decision ALLOW --output <manifest.json>",
    "  node bin/run-c1a-qualification-v1.mjs execute-provider --root <frozen-root> --repo <repo> --manifest <manifest.json> --packet <execution-packet.json> --execution-root <dir>",
    "",
    "prepare never calls a provider. execute-provider requires a separately authorized, exact-bound execution packet; the packet does not itself create Owner authority.",
  ].join("\n");
}

function safeEvidenceName(phase, index, caseId) {
  const safeId = String(caseId).replace(/[^a-zA-Z0-9_.:-]/gu, "_").slice(0, 140);
  return `${phase}-${String(index).padStart(4, "0")}-${safeId}.json`;
}

export async function runC1AQualificationCli(argv = process.argv.slice(2), {
  prepareFromFrozen = prepareC1AFromFrozen,
  executeQualification = executeC1ALocomoQualification,
  adapterFactory = createSiliconFlowRerankAdapter,
  transportFactory = createSiliconFlowHttpsTransport,
  gitIdentity = resolveGitIdentity,
  env = process.env,
} = {}) {
  const args = parseArgs(argv);
  if (args.help || !args.command) return { help: usage() };
  const frozenRoot = resolve(args.frozenRoot);
  const repositoryRoot = resolve(args.repositoryRoot);

  if (args.command === "prepare") {
    if (!args.output) throw fail("C1A_PREPARE_OUTPUT_REQUIRED");
    if (args.egressDecision !== "ALLOW") {
      throw fail("C1A_PREPARE_EGRESS_ALLOW_REQUIRED");
    }
    const identity = gitIdentity(repositoryRoot);
    if (identity.worktreeClean !== true) throw fail("C1A_PREPARE_SOURCE_WORKTREE_NOT_CLEAN");
    const prepared = prepareFromFrozen({
      frozenRoot,
      repositoryRoot,
      egressDecision: args.egressDecision,
      qualificationSourceIdentity: {
        source_commit: identity.sourceCommit,
        worktree_clean: true,
      },
    });
    atomicWriteJson(resolve(args.output), prepared.manifest);
    return {
      command: "prepare",
      provider_calls: 0,
      manifest_sha256: prepared.manifest.manifest_sha256,
      population: prepared.manifest.population,
      egress_decision: args.egressDecision,
    };
  }

  if (args.command !== "execute-provider") throw fail("C1A_CLI_COMMAND_INVALID");
  if (!args.manifest || !args.packet || !args.executionRoot) throw fail("C1A_EXECUTE_ARGUMENTS_REQUIRED");

  const manifest = readJson(resolve(args.manifest));
  const packet = readJson(resolve(args.packet));
  const executionRoot = resolve(args.executionRoot);
  const identity = gitIdentity(repositoryRoot);
  const binding = validateC1AExecutionPacket({
    packet,
    manifest,
    sourceCommit: identity.sourceCommit,
    worktreeClean: identity.worktreeClean,
    executionRoot,
  });

  const prepared = prepareFromFrozen({
    frozenRoot,
    repositoryRoot,
    egressDecision: "ALLOW",
    qualificationSourceIdentity: {
      source_commit: identity.sourceCommit,
      worktree_clean: true,
    },
  });
  if (prepared.manifest.manifest_sha256 !== manifest.manifest_sha256
      || sha256Json(prepared.manifest) !== sha256Json(manifest)) {
    throw fail("C1A_EXECUTION_REGENERATED_MANIFEST_MISMATCH");
  }

  const apiKey = env[binding.api_key_env];
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) throw fail("C1A_EXECUTION_API_KEY_UNAVAILABLE");

  const startedPath = join(executionRoot, "execution-started.json");
  if (existsSync(startedPath)) throw fail("C1A_EXECUTION_PACKET_ALREADY_CONSUMED");
  mkdirSync(join(executionRoot, "evidence"), { recursive: true, mode: 0o700 });
  atomicWriteJson(startedPath, {
    schema: "memory_engine_r3_c1a_execution_started_v1",
    source_commit: binding.source_commit,
    manifest_sha256: binding.manifest_sha256,
    provider: binding.provider,
    model: binding.model,
    endpoint: binding.endpoint,
    execution_count_consumed: 1,
  });

  const adapter = adapterFactory({
    apiKey: apiKey.trim(),
    transport: transportFactory(),
    model: binding.model,
    endpoint: binding.endpoint,
  });
  const pacer = createC1APacer(binding.pacing);
  let evidenceIndex = 0;
  const onEvidence = async ({ phase, evidence }) => {
    evidenceIndex += 1;
    atomicWriteJson(
      join(executionRoot, "evidence", safeEvidenceName(phase, evidenceIndex, evidence.case_id)),
      evidence,
    );
  };

  try {
    const result = await executeQualification({
      packet,
      manifest,
      material: prepared.material,
      sourceCommit: identity.sourceCommit,
      worktreeClean: identity.worktreeClean,
      adapter,
      pacer,
      onEvidence,
    });
    atomicWriteJson(join(executionRoot, "execution-result.json"), result);
    atomicWriteJson(join(executionRoot, "execution-finished.json"), {
      schema: "memory_engine_r3_c1a_execution_finished_v1",
      source_commit: binding.source_commit,
      manifest_sha256: binding.manifest_sha256,
      pass: result.score.pass,
      provider_calls: result.batch.budget.requests,
      execution_count_consumed: 1,
    });
    return {
      command: "execute-provider",
      result: "completed",
      pass: result.score.pass,
      provider_calls: result.batch.budget.requests,
      manifest_sha256: binding.manifest_sha256,
    };
  } catch (error) {
    atomicWriteJson(join(executionRoot, "execution-stopped.json"), {
      schema: "memory_engine_r3_c1a_execution_stopped_v1",
      source_commit: binding.source_commit,
      manifest_sha256: binding.manifest_sha256,
      error_code: typeof error?.code === "string" ? error.code : "C1A_EXECUTION_UNCLASSIFIED_STOP",
      execution_count_consumed: 1,
    });
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runC1AQualificationCli().then(result => {
    if (result.help) console.log(result.help);
    else console.log(JSON.stringify(result));
  }).catch(error => {
    console.error(`C1A_QUALIFICATION_STOPPED ${error?.code || "C1A_EXECUTION_ERROR"}`);
    process.exitCode = 1;
  });
}
