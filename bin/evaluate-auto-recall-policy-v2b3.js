#!/usr/bin/env node

const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const DEFAULT_DATASET = "test/fixtures/auto-recall-policy-holdout.v2b3.jsonl";

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
  console.log(`Evaluate the AutoRecall v2-B3 corpus offline

Usage:
  node bin/evaluate-auto-recall-policy-v2b3.js [options]

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
  const readiness = report.readiness;
  const lines = [
    "# AutoRecall v2-B3 Regression Evaluation",
    "",
    `- dataset: ${datasetPath}`,
    `- total: ${report.dataset.total}`,
    `- expected_yes: ${report.dataset.yes}`,
    `- expected_no: ${report.dataset.no}`,
    `- validation: ${report.validation.valid ? "PASS" : "FAIL"}`,
    `- v1 TP/TN/FP/FN: ${matrices.v1_current.true_positive}/${matrices.v1_current.true_negative}/${matrices.v1_current.false_positive}/${matrices.v1_current.false_negative}`,
    `- v2 oracle TP/TN/FP/FN: ${matrices.v2_oracle_policy.true_positive}/${matrices.v2_oracle_policy.true_negative}/${matrices.v2_oracle_policy.false_positive}/${matrices.v2_oracle_policy.false_negative}`,
    `- v2 runtime TP/TN/FP/FN: ${matrices.v2_runtime_candidate.true_positive}/${matrices.v2_runtime_candidate.true_negative}/${matrices.v2_runtime_candidate.false_positive}/${matrices.v2_runtime_candidate.false_negative}`,
    `- task_intent_mismatch_count: ${report.diagnostics.task_intent_mismatch_count}`,
    `- recall_intent_mismatch_count: ${report.diagnostics.recall_intent_mismatch_count}`,
    `- semantic_only_mismatch_count: ${report.diagnostics.semantic_only_mismatch_count}`,
    `- evidence_role: ${report.evidence_role}`,
    `- current_evaluation_status: ${report.current_evaluation_status}`,
    `- historical_b3_status: ${report.historical_b3_status}`,
    `- readiness_diagnostics: oracle=${readiness.oracle_gate_pass}, quantitative=${readiness.quantitative_gate_pass}, family=${readiness.family_gate_pass}`,
    `- candidate_policy_status: ${report.candidate_policy_status}`,
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

    const { evaluateAutoRecallPolicyHoldoutV2B3Jsonl } = await import(
      "../lib/recall/auto-recall-policy-holdout-v2b3.js"
    );
    const datasetPath = resolve(process.cwd(), options.dataset);
    const content = readFileSync(datasetPath, "utf8");
    const report = evaluateAutoRecallPolicyHoldoutV2B3Jsonl(content);

    process.stdout.write(options.json
      ? `${JSON.stringify({ dataset_path: datasetPath, ...report }, null, 2)}\n`
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
