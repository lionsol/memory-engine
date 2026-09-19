#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { loadFrozenInputs } from "./run-locomo-chunk-rerank-v1.mjs";
import { buildC1ALocomoQualificationCases } from "../lib/benchmark/c1a-locomo-qualification.js";
import { buildQ5B3AnalysisPlanV1 } from "../lib/benchmark/q5-b3-fixed-pool-analysis-plan-v1.js";
import { analyzeQ5B3DProductVisibleFeasibilityV1 } from "../lib/benchmark/q5-b3-product-visible-pair-set-feasibility-v1.js";

const DEFAULT_ROOT =
  "/home/lionsol/.openclaw/workspace/q3-locomo-v1.2/runs/q3-locomo-chunk-fts-rerank-v1";

function parseArgs(argv) {
  const args = {
    root: DEFAULT_ROOT,
    repo: process.cwd(),
    b0: "test/fixtures/q5-b0-real-fixed-pool-evidence-entry-v1.json",
    b1: "test/fixtures/q5-b1-score-capture-manifest-v1.json",
    b2: "test/fixtures/q5-b2-real-score-capture-v1.json",
    summary: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--root") args.root = argv[++index];
    else if (token === "--repo") args.repo = argv[++index];
    else if (token === "--b0") args.b0 = argv[++index];
    else if (token === "--b1") args.b1 = argv[++index];
    else if (token === "--b2") args.b2 = argv[++index];
    else if (token === "--summary") args.summary = true;
    else if (token === "--help" || token === "-h") args.help = true;
    else throw new Error(`Q5_B3_D_CLI_ARGUMENT_UNKNOWN:${token}`);
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonl(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  return text === "" ? [] : text.split(/\n/u).map(line => JSON.parse(line));
}

function usage() {
  return [
    "Usage:",
    "  node bin/run-q5-b3-product-visible-pair-set-feasibility-v1.mjs [--summary]",
    "    [--root <historical-frozen-root>] [--repo <repository-root>]",
    "    [--b0 <fixture>] [--b1 <fixture>] [--b2 <fixture>]",
    "",
    "Offline development+validation only. Uses one predeclared deterministic",
    "product-visible swap family. No provider/embedding/reranker/LLM calls,",
    "model training, final_evaluation consumption, runtime/config/DB/LanceDB",
    "mutation, deployment, push, or tag.",
  ].join("\n");
}

export function runQ5B3DProductVisibleFeasibilityCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) return { help: usage() };

  const repositoryRoot = path.resolve(args.repo);
  const frozenRoot = path.resolve(args.root);
  const b0 = readJson(path.resolve(repositoryRoot, args.b0));
  const b1 = readJson(path.resolve(repositoryRoot, args.b1));
  const b2 = readJson(path.resolve(repositoryRoot, args.b2));
  const plan = buildQ5B3AnalysisPlanV1({
    b0Manifest: b0,
    b1Manifest: b1,
  });

  const frozen = loadFrozenInputs(frozenRoot, repositoryRoot);
  const turnRows = readJsonl(
    path.join(frozenRoot, "input", "chunk-material", "turn-chunk-map.jsonl"),
  );
  const material = buildC1ALocomoQualificationCases({
    frozen,
    turnRows,
    egressDecision: "UNKNOWN",
  });

  const analysis = analyzeQ5B3DProductVisibleFeasibilityV1({
    analysisPlan: plan,
    b2Packet: b2,
    material,
  });

  if (args.summary) {
    return {
      schema: analysis.schema,
      source_b3_b_result_sha256: analysis.source_b3_b_result_sha256,
      source_plan_sha256: analysis.source_plan_sha256,
      source_b2_packet_sha256: analysis.source_b2_packet_sha256,
      result_sha256: analysis.result_sha256,
      development_config_count: analysis.development_config_count,
      development_safe_config_count: analysis.development_safe_config_count,
      selected_config: analysis.selected_config,
      development: analysis.development,
      best_unsafe_development: analysis.best_unsafe_development,
      validation: analysis.validation,
      validation_status: analysis.validation_status,
      validation_success: analysis.validation_success,
      branch_interpretation: analysis.branch_interpretation,
      final_evaluation_consumed: analysis.final_evaluation_consumed,
      provider_requests: analysis.provider_requests,
      embedding_requests: analysis.embedding_requests,
      reranker_requests: analysis.reranker_requests,
      llm_requests: analysis.llm_requests,
      model_training_runs: analysis.model_training_runs,
      statistical_ltr_selected: analysis.statistical_ltr_selected,
      learned_set_scorer_selected: analysis.learned_set_scorer_selected,
      runtime_mutation: analysis.runtime_mutation,
      validation_informed_retuning: analysis.validation_informed_retuning,
    };
  }
  return analysis;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = runQ5B3DProductVisibleFeasibilityCli();
    if (result.help) console.log(result.help);
    else console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  }
}
