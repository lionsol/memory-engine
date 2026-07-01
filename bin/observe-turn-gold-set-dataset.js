#!/usr/bin/env node

const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const DEFAULT_DATASET = "test/fixtures/auto-recall-turn-gold-set.seed.jsonl";

function printHelp() {
  console.log(`Observe AutoRecall turn gold-set dataset growth

Usage:
  node bin/observe-turn-gold-set-dataset.js [options]

Options:
  --dataset <path>   JSONL dataset path, default: ${DEFAULT_DATASET}
  --name <name>      Dataset display name, default: seed
  --no-freeze        Do not apply seed freeze contract
  --json             Print JSON report, default
  --help             Show this help

Notes:
  - Read-only dataset freeze and growth observation
  - Does not mutate dataset, DB, memory files, runtime, rules, or reports
  - Does not call LLM, retrieval, injection, or reinforcement
`);
}

function parseArgs(argv = []) {
  const options = {
    dataset: DEFAULT_DATASET,
    name: "seed",
    freeze: true,
    json: true,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "help") {
      options.help = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--no-freeze") {
      options.freeze = false;
      continue;
    }
    if (arg === "--dataset") {
      const value = argv[i + 1];
      if (!value) throw new Error("--dataset requires a path");
      options.dataset = value;
      i += 1;
      continue;
    }
    if (arg === "--name") {
      const value = argv[i + 1];
      if (!value) throw new Error("--name requires a value");
      options.name = value;
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

async function observe(options) {
  const {
    TURN_GOLD_SET_SEED_FREEZE,
    observeTurnGoldSetDataset,
  } = await import("../lib/recall/auto-recall-dataset-observation.js");
  const datasetPath = resolve(process.cwd(), options.dataset);
  const content = readFileSync(datasetPath, "utf8");
  const frozen = options.freeze ? TURN_GOLD_SET_SEED_FREEZE : null;
  const report = observeTurnGoldSetDataset(content, { datasetName: options.name, frozen });
  return { datasetPath, report };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      printHelp();
      return 0;
    }
    const { datasetPath, report } = await observe(options);
    console.log(JSON.stringify({ dataset: datasetPath, ...report }, null, 2));
    return report.summary.observation_status === "stable" ? 0 : 1;
  } catch (error) {
    console.error(String(error?.message || error));
    return 1;
  }
}

module.exports = {
  DEFAULT_DATASET,
  parseArgs,
  observe,
  main,
};

if (process.argv[1] && /observe-turn-gold-set-dataset\.js$/.test(process.argv[1])) {
  main().then(code => {
    process.exitCode = code;
  });
}
