#!/usr/bin/env node

const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const DEFAULT_DATASET = "test/fixtures/auto-recall-policy-eval.v2b1.jsonl";

function parseArgs(argv = []) {
  const options = {
    dataset: DEFAULT_DATASET,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "help") {
      options.help = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--dataset") {
      const value = argv[index + 1];
      if (!value) throw new Error("--dataset requires a path");
      options.dataset = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`Evaluate the AutoRecall v2-B1 policy candidate offline

Usage:
  node bin/evaluate-auto-recall-policy-v2b1.js [options]

Options:
  --dataset <path>   JSONL dataset path, default: ${DEFAULT_DATASET}
  --json             Print the full bounded JSON report
  --help             Show this help

This command is read-only. It does not access DB, network, retrieval, memory,
LLM, runtime policy, or report files.
`);
}

function renderSummary(report, datasetPath) {
  const matrices = report.confusion_matrices;
  const diagnostics = report.diagnostics;
  const lines = [
    "# AutoRecall v2-B1 Offline Policy Evaluation",
    "",
    `- dataset: ${datasetPath}`,
    `- total: ${report.summary.total}`,
    `- expected_yes: ${report.summary.expected_yes}`,
    `- expected_no: ${report.summary.expected_no}`,
    `- validation: ${report.validation.valid ? "PASS" : "FAIL"}`,
    `- v1 accuracy: ${matrices.v1_current.accuracy}`,
    `- v2 oracle accuracy: ${matrices.v2_oracle_policy.accuracy}`,
    `- v2 runtime candidate accuracy: ${matrices.v2_runtime_candidate.accuracy}`,
    `- task_intent_mismatch_count: ${diagnostics.task_intent_mismatch_count}`,
    `- recall_intent_mismatch_count: ${diagnostics.recall_intent_mismatch_count}`,
    `- false_positive_reduced_count: ${diagnostics.false_positive_reduced_count}`,
    `- false_negative_added_count: ${diagnostics.false_negative_added_count}`,
    "",
    "Read-only side effects: none",
    "",
  ];
  return lines.join("\n");
}

async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      printHelp();
      return 0;
    }

    const { evaluateAutoRecallPolicyDatasetJsonl, AUTO_RECALL_POLICY_EVALUATION_DATASET_CONTRACT } = await import(
      "../lib/recall/auto-recall-policy-evaluation.js"
    );
    const datasetPath = resolve(process.cwd(), options.dataset);
    const content = readFileSync(datasetPath, "utf8");
    const report = evaluateAutoRecallPolicyDatasetJsonl(
      content,
      AUTO_RECALL_POLICY_EVALUATION_DATASET_CONTRACT,
    );

    process.stdout.write(options.json
      ? `${JSON.stringify({ dataset: datasetPath, ...report }, null, 2)}\n`
      : renderSummary(report, datasetPath));
    return report.validation.valid ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    return 1;
  }
}

module.exports = {
  DEFAULT_DATASET,
  parseArgs,
  renderSummary,
  main,
};

if (require.main === module) {
  main().then(code => {
    process.exitCode = code;
  });
}
