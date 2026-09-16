#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { loadFrozenInputs } from "./run-locomo-chunk-rerank-v1.mjs";
import { createC1APacer } from "./run-c1a-qualification-v1.mjs";
import {
  buildC1ALocomoQualificationCases,
  C1A_LOCOMO_SOURCE_PROFILE,
} from "../lib/benchmark/c1a-locomo-qualification.js";
import {
  buildC1AV2QualificationManifest,
  C1A_V2_ACCEPTANCE_THRESHOLDS,
} from "../lib/benchmark/c1a-qualification-v2-contract.js";
import {
  buildC1AV2ExecutionPacket,
  C1A_V2_EXPECTED_PRIOR_OBSERVED_MANIFEST_SHA256,
  validateC1AV2ExecutionPacket,
} from "../lib/benchmark/c1a-qualification-v2-execution-packet.js";
import { executeC1AV2LocomoQualification } from "../lib/benchmark/c1a-qualification-v2-execution.js";
import { preflightC1AQualificationCase } from "../lib/benchmark/c1a-qualification-runner.js";
import {
  QWEN3_UTF8_BYTE_TOKEN_UPPER_BOUND_ID,
  SILICONFLOW_RERANK_ENDPOINT,
  SILICONFLOW_RERANK_LIMITS,
  SILICONFLOW_RERANK_MODEL_0_6B,
  SILICONFLOW_RERANK_PROVIDER,
  qwen3Utf8ByteTokenUpperBound,
  createSiliconFlowHttpsTransport,
  createSiliconFlowRerankAdapter,
} from "../lib/recall/rerank/siliconflow-rerank-adapter.js";

export const C1A_V2_DEFAULT_FROZEN_ROOT = "/home/lionsol/.openclaw/workspace/q3-locomo-v1.2/runs/q3-locomo-chunk-fts-rerank-v1";
export const C1A_V2_LOCOMO_QUALIFICATION_PROFILE = "r3_c1a_locomo_fts20_canonical_qwen3_0_6b_holdout_v2";

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

export function resolveC1AV2GitIdentity(repositoryRoot) {
  const commit = spawnSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (commit.status !== 0) throw fail("C1A_V2_GIT_COMMIT_UNAVAILABLE");
  const status = spawnSync("git", ["-C", repositoryRoot, "status", "--porcelain"], { encoding: "utf8" });
  if (status.status !== 0) throw fail("C1A_V2_GIT_STATUS_UNAVAILABLE");
  return {
    sourceCommit: commit.stdout.trim(),
    worktreeClean: status.stdout.trim() === "",
  };
}

export function prepareC1AV2FromFrozen({
  frozenRoot,
  repositoryRoot,
  observedManifest,
  egressDecision,
  qualificationSourceIdentity = null,
  expectedPriorObservedManifestSha256 = C1A_V2_EXPECTED_PRIOR_OBSERVED_MANIFEST_SHA256,
  tokenCounter = qwen3Utf8ByteTokenUpperBound,
  loadFrozen = loadFrozenInputs,
  readTurnRows = root => readJsonl(join(root, "input", "chunk-material", "turn-chunk-map.jsonl")),
} = {}) {
  if (egressDecision !== "ALLOW") throw fail("C1A_V2_PREPARE_EGRESS_ALLOW_REQUIRED");
  if (observedManifest?.manifest_sha256 !== expectedPriorObservedManifestSha256) {
    throw fail("C1A_V2_PREPARE_PRIOR_MANIFEST_NOT_FROZEN_M2");
  }
  const frozen = loadFrozen(frozenRoot, repositoryRoot);
  const turnRows = readTurnRows(frozenRoot);
  const material = buildC1ALocomoQualificationCases({ frozen, turnRows, egressDecision });
  material.qualification_profile = C1A_V2_LOCOMO_QUALIFICATION_PROFILE;

  const eligibilityByCase = Object.fromEntries(material.cases.map(item => {
    const candidateEgress = Object.fromEntries(item.candidates.map(candidate => [candidate.id, candidate.egress]));
    const preflight = preflightC1AQualificationCase({
      query: item.query,
      candidates: item.candidates,
      controlOrder: item.control_order,
      queryEgress: item.query_egress,
      candidateEgress,
      tokenCounter,
    });
    return [item.case_id, preflight.eligible];
  }));

  const manifest = buildC1AV2QualificationManifest({
    cases: material.cases,
    eligibilityByCase,
    observedManifest,
    profile: {
      ...material.profile,
      provider: {
        provider: SILICONFLOW_RERANK_PROVIDER,
        model: SILICONFLOW_RERANK_MODEL_0_6B,
        endpoint: SILICONFLOW_RERANK_ENDPOINT,
        revision: null,
      },
      token_preflight: {
        counter_id: QWEN3_UTF8_BYTE_TOKEN_UPPER_BOUND_ID,
        ...SILICONFLOW_RERANK_LIMITS,
      },
      acceptance_thresholds: { ...C1A_V2_ACCEPTANCE_THRESHOLDS },
    },
    sourceIdentity: {
      qualification_source: qualificationSourceIdentity,
      source_profile: C1A_LOCOMO_SOURCE_PROFILE,
      qualification_profile: C1A_V2_LOCOMO_QUALIFICATION_PROFILE,
      egress_decision: egressDecision,
      evidence_limitations: material.evidence_limitations,
      frozen_material_identity: frozen.material_identity ?? null,
      frozen_input_hashes: frozen.hashes ?? null,
    },
  });
  return { material, manifest, eligibilityByCase };
}

function requireFiniteNumber(value, code) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw fail(code);
  return number;
}

function requireSafeInteger(value, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw fail(code);
  return number;
}

function parseArgs(argv) {
  const [command, ...tokens] = argv;
  const args = {
    command,
    frozenRoot: C1A_V2_DEFAULT_FROZEN_ROOT,
    repositoryRoot: process.cwd(),
    observedManifest: null,
    egressDecision: null,
    output: null,
    manifest: null,
    packet: null,
    packetOutput: null,
    executionRoot: null,
    maxCostUsd: null,
    inputPriceUsdPerMillion: null,
    pacingMinIntervalMs: null,
    pacingTokenWindowMs: null,
    pacingMaxEstimatedTokensPerWindow: null,
    rateLimitSource: null,
    apiKeyEnv: null,
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = () => {
      const value = tokens[++index];
      if (value === undefined) throw fail("C1A_V2_CLI_ARGUMENT_VALUE_REQUIRED", { token });
      return value;
    };
    if (token === "--root") args.frozenRoot = next();
    else if (token === "--repo") args.repositoryRoot = next();
    else if (token === "--observed-manifest") args.observedManifest = next();
    else if (token === "--egress-decision") args.egressDecision = next();
    else if (token === "--output") args.output = next();
    else if (token === "--manifest") args.manifest = next();
    else if (token === "--packet") args.packet = next();
    else if (token === "--packet-output") args.packetOutput = next();
    else if (token === "--execution-root") args.executionRoot = next();
    else if (token === "--max-cost-usd") args.maxCostUsd = next();
    else if (token === "--input-price-usd-per-million") args.inputPriceUsdPerMillion = next();
    else if (token === "--pacing-min-interval-ms") args.pacingMinIntervalMs = next();
    else if (token === "--pacing-token-window-ms") args.pacingTokenWindowMs = next();
    else if (token === "--pacing-max-estimated-tokens-per-window") args.pacingMaxEstimatedTokensPerWindow = next();
    else if (token === "--rate-limit-source") args.rateLimitSource = next();
    else if (token === "--api-key-env") args.apiKeyEnv = next();
    else if (token === "--help" || token === "-h") args.help = true;
    else throw fail("C1A_V2_CLI_ARGUMENT_UNKNOWN", { token });
  }
  return args;
}

function safeEvidenceName(phase, index, caseId) {
  const safeId = String(caseId).replace(/[^a-zA-Z0-9_.:-]/gu, "_").slice(0, 140);
  return `${phase}-${String(index).padStart(4, "0")}-${safeId}.json`;
}

function usage() {
  return [
    "Usage:",
    "  node bin/run-c1a-qualification-v2.mjs prepare --root <frozen-root> --repo <repo> --observed-manifest <m2-manifest.json> --egress-decision ALLOW --output <v2-manifest.json>",
    "  node bin/run-c1a-qualification-v2.mjs freeze-packet --repo <repo> --manifest <v2-manifest.json> --execution-root <dir> --max-cost-usd <n> --input-price-usd-per-million <n> --pacing-min-interval-ms <n> --pacing-token-window-ms <n> --pacing-max-estimated-tokens-per-window <n> --rate-limit-source <source> --api-key-env <ENV> --packet-output <packet.json>",
    "  node bin/run-c1a-qualification-v2.mjs validate --repo <repo> --manifest <v2-manifest.json> --packet <packet.json> [--execution-root <dir>]",
    "  node bin/run-c1a-qualification-v2.mjs execute-provider --root <frozen-root> --repo <repo> --observed-manifest <m2-manifest.json> --manifest <v2-manifest.json> --packet <packet.json> --execution-root <dir>",
    "",
    "prepare/freeze-packet/validate are zero-provider. execute-provider requires a separately authorized, exact-bound packet and consumes execution_count=1 before the first provider request.",
  ].join("\n");
}

export async function runC1AV2QualificationCli(argv = process.argv.slice(2), {
  prepareFromFrozen = prepareC1AV2FromFrozen,
  executeQualification = executeC1AV2LocomoQualification,
  adapterFactory = createSiliconFlowRerankAdapter,
  transportFactory = createSiliconFlowHttpsTransport,
  pacerFactory = createC1APacer,
  gitIdentity = resolveC1AV2GitIdentity,
  expectedPriorObservedManifestSha256 = C1A_V2_EXPECTED_PRIOR_OBSERVED_MANIFEST_SHA256,
  env = process.env,
} = {}) {
  const args = parseArgs(argv);
  if (args.help || !args.command) return { help: usage() };
  const repositoryRoot = resolve(args.repositoryRoot);
  const identity = gitIdentity(repositoryRoot);

  if (args.command === "prepare") {
    if (!args.output || !args.observedManifest) throw fail("C1A_V2_PREPARE_ARGUMENTS_REQUIRED");
    if (args.egressDecision !== "ALLOW") throw fail("C1A_V2_PREPARE_EGRESS_ALLOW_REQUIRED");
    if (identity.worktreeClean !== true) throw fail("C1A_V2_PREPARE_SOURCE_WORKTREE_NOT_CLEAN");
    const observedManifest = readJson(resolve(args.observedManifest));
    const prepared = prepareFromFrozen({
      frozenRoot: resolve(args.frozenRoot),
      repositoryRoot,
      observedManifest,
      egressDecision: args.egressDecision,
      qualificationSourceIdentity: {
        source_commit: identity.sourceCommit,
        worktree_clean: true,
      },
      expectedPriorObservedManifestSha256,
    });
    atomicWriteJson(resolve(args.output), prepared.manifest);
    return {
      command: "prepare",
      provider_calls: 0,
      manifest_sha256: prepared.manifest.manifest_sha256,
      prior_observed_manifest_sha256: prepared.manifest.prior_observed_manifest_sha256,
      population: prepared.manifest.population,
      egress_decision: args.egressDecision,
    };
  }

  if (args.command === "freeze-packet") {
    if (!args.manifest || !args.packetOutput || !args.executionRoot
        || args.maxCostUsd === null || args.inputPriceUsdPerMillion === null
        || args.pacingMinIntervalMs === null || args.pacingTokenWindowMs === null
        || args.pacingMaxEstimatedTokensPerWindow === null
        || !args.rateLimitSource || !args.apiKeyEnv) {
      throw fail("C1A_V2_FREEZE_PACKET_ARGUMENTS_REQUIRED");
    }
    if (identity.worktreeClean !== true) throw fail("C1A_V2_FREEZE_PACKET_SOURCE_WORKTREE_NOT_CLEAN");
    const manifest = readJson(resolve(args.manifest));
    const executionRoot = resolve(args.executionRoot);
    const packet = buildC1AV2ExecutionPacket({
      manifest,
      sourceCommit: identity.sourceCommit,
      executionRoot,
      maxCostUsd: requireFiniteNumber(args.maxCostUsd, "C1A_V2_MAX_COST_INVALID"),
      inputPriceUsdPerMillion: requireFiniteNumber(
        args.inputPriceUsdPerMillion,
        "C1A_V2_INPUT_PRICE_INVALID",
      ),
      pacing: {
        min_interval_ms: requireSafeInteger(args.pacingMinIntervalMs, "C1A_V2_PACING_MIN_INTERVAL_INVALID"),
        token_window_ms: requireSafeInteger(args.pacingTokenWindowMs, "C1A_V2_PACING_TOKEN_WINDOW_INVALID"),
        max_estimated_tokens_per_window: requireSafeInteger(
          args.pacingMaxEstimatedTokensPerWindow,
          "C1A_V2_PACING_TOKEN_LIMIT_INVALID",
        ),
      },
      rateLimitSource: args.rateLimitSource,
      apiKeyEnv: args.apiKeyEnv,
      expectedPriorObservedManifestSha256,
    });
    atomicWriteJson(resolve(args.packetOutput), packet);
    return {
      command: "freeze-packet",
      provider_calls: 0,
      manifest_sha256: packet.manifest_sha256,
      packet_schema: packet.schema,
      max_provider_requests: packet.max_provider_requests,
      execution_root: packet.execution_root,
    };
  }

  if (args.command === "validate") {
    if (!args.manifest || !args.packet) throw fail("C1A_V2_VALIDATE_ARGUMENTS_REQUIRED");
    const manifest = readJson(resolve(args.manifest));
    const packet = readJson(resolve(args.packet));
    const binding = validateC1AV2ExecutionPacket({
      packet,
      manifest,
      sourceCommit: identity.sourceCommit,
      worktreeClean: identity.worktreeClean,
      executionRoot: args.executionRoot ? resolve(args.executionRoot) : null,
      expectedPriorObservedManifestSha256,
    });
    return {
      command: "validate",
      provider_calls: 0,
      valid: true,
      manifest_sha256: binding.manifest_sha256,
      prior_observed_manifest_sha256: binding.prior_observed_manifest_sha256,
      max_provider_requests: binding.max_provider_requests,
      model: binding.model,
    };
  }

  if (args.command === "execute-provider") {
    if (!args.observedManifest || !args.manifest || !args.packet || !args.executionRoot) {
      throw fail("C1A_V2_EXECUTE_ARGUMENTS_REQUIRED");
    }
    const observedManifest = readJson(resolve(args.observedManifest));
    const manifest = readJson(resolve(args.manifest));
    const packet = readJson(resolve(args.packet));
    const executionRoot = resolve(args.executionRoot);
    const binding = validateC1AV2ExecutionPacket({
      packet,
      manifest,
      sourceCommit: identity.sourceCommit,
      worktreeClean: identity.worktreeClean,
      executionRoot,
      expectedPriorObservedManifestSha256,
    });
    if (observedManifest.manifest_sha256 !== binding.prior_observed_manifest_sha256) {
      throw fail("C1A_V2_EXECUTION_OBSERVED_MANIFEST_MISMATCH");
    }

    const prepared = prepareFromFrozen({
      frozenRoot: resolve(args.frozenRoot),
      repositoryRoot,
      observedManifest,
      egressDecision: "ALLOW",
      qualificationSourceIdentity: {
        source_commit: identity.sourceCommit,
        worktree_clean: true,
      },
      expectedPriorObservedManifestSha256,
    });
    if (prepared.manifest.manifest_sha256 !== manifest.manifest_sha256
        || JSON.stringify(prepared.manifest) !== JSON.stringify(manifest)) {
      throw fail("C1A_V2_EXECUTION_REGENERATED_MANIFEST_MISMATCH");
    }

    const apiKey = env[binding.api_key_env];
    if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
      throw fail("C1A_V2_EXECUTION_API_KEY_UNAVAILABLE");
    }

    const startedPath = join(executionRoot, "execution-started.json");
    if (existsSync(startedPath)) throw fail("C1A_V2_EXECUTION_PACKET_ALREADY_CONSUMED");
    mkdirSync(join(executionRoot, "evidence"), { recursive: true, mode: 0o700 });
    atomicWriteJson(startedPath, {
      schema: "memory_engine_r3_c1a_execution_started_v2",
      source_commit: binding.source_commit,
      manifest_sha256: binding.manifest_sha256,
      prior_observed_manifest_sha256: binding.prior_observed_manifest_sha256,
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
    const pacer = pacerFactory(binding.pacing);
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
        schema: "memory_engine_r3_c1a_execution_finished_v2",
        source_commit: binding.source_commit,
        manifest_sha256: binding.manifest_sha256,
        prior_observed_manifest_sha256: binding.prior_observed_manifest_sha256,
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
        schema: "memory_engine_r3_c1a_execution_stopped_v2",
        source_commit: binding.source_commit,
        manifest_sha256: binding.manifest_sha256,
        prior_observed_manifest_sha256: binding.prior_observed_manifest_sha256,
        error_code: typeof error?.code === "string" ? error.code : "C1A_V2_EXECUTION_UNCLASSIFIED_STOP",
        execution_count_consumed: 1,
      });
      throw error;
    }
  }

  throw fail("C1A_V2_CLI_COMMAND_INVALID");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runC1AV2QualificationCli().then(result => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch(error => {
    process.stderr.write(`${error?.code ?? error?.message ?? "C1A_V2_CLI_FAILED"}\n`);
    process.exitCode = 1;
  });
}
