#!/usr/bin/env node

const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const DATASETS = Object.freeze([
  { name: "B1", path: "test/fixtures/auto-recall-policy-eval.v2b1.jsonl", contract: "AUTO_RECALL_POLICY_EVALUATION_DATASET_CONTRACT" },
  { name: "B3", path: "test/fixtures/auto-recall-policy-holdout.v2b3.jsonl", contract: "AUTO_RECALL_POLICY_HOLDOUT_V2B3_CONTRACT" },
  { name: "B5", path: "test/fixtures/auto-recall-policy-holdout.v2b5.jsonl", contract: "AUTO_RECALL_POLICY_HOLDOUT_V2B5_CONTRACT" },
]);

function parseArgs(argv = []) {
  const options = { json: false, help: false };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "help") options.help = true;
    else throw new Error("unknown argument: " + arg);
  }
  return options;
}

function printHelp() {
  console.log([
    "Evaluate the v2-C1 selective recall gate on known B1/B3/B5 corpora",
    "",
    "Usage:",
    "  node bin/evaluate-selective-recall-gate-c1.js [--json]",
    "",
    "This command is read-only and is design/regression evidence only.",
    "It does not grant runtime authority or independent readiness.",
    "",
  ].join("\n"));
}

function renderSummary(report) {
  const lines = [
    "# Selective Recall Gate v2-C1 Known-Corpus Evaluation",
    "",
    "- evidence_role: known_corpus_design_regression",
    "- authority: OFFLINE ONLY / NOT RUNTIME AUTHORIZED",
    "- independent_readiness_evidence: false",
    "",
  ];
  for (const item of report.datasets) {
    lines.push(
      `- ${item.name}: V1 FP=${item.v1_false_positive}; selective FP=${item.selective_false_positive}; FP reduced=${item.false_positive_reduced}; introduced FN=${item.introduced_false_negative}`,
    );
  }
  lines.push(
    "",
    `- aggregate V1 FP: ${report.aggregate.v1_false_positive}`,
    `- aggregate selective FP: ${report.aggregate.selective_false_positive}`,
    `- aggregate FP reduced: ${report.aggregate.false_positive_reduced}`,
    `- aggregate introduced FN: ${report.aggregate.introduced_false_negative}`,
    `- safety_gate_no_new_fn: ${report.aggregate.safety_gate_no_new_fn}`,
    `- utility_gate_fp_reduction: ${report.aggregate.utility_gate_fp_reduction}`,
    "",
    "Read-only side effects: none",
    "",
  );
  return lines.join("\n");
}

async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      printHelp();
      return 0;
    }

    const policy = await import("../lib/recall/auto-recall-policy-evaluation.js");
    const { evaluateSelectiveRecallGateDataset } = await import("../lib/recall/selective-recall-gate-evaluation.js");
    const datasets = DATASETS.map(item => {
      const path = resolve(process.cwd(), item.path);
      const parsed = policy.parseAutoRecallPolicyEvaluationJsonl(readFileSync(path, "utf8"));
      const report = evaluateSelectiveRecallGateDataset(parsed.rows, policy[item.contract]);
      return {
        name: item.name,
        path,
        validation: report.validation.valid,
        v1_false_positive: report.confusion_matrices.v1_current.false_positive,
        selective_false_positive: report.confusion_matrices.selective_candidate.false_positive,
        false_positive_reduced: report.diagnostics.false_positive_reduced_count,
        introduced_false_negative: report.diagnostics.introduced_false_negative_count,
      };
    });

    const aggregate = datasets.reduce((acc, item) => {
      acc.v1_false_positive += item.v1_false_positive;
      acc.selective_false_positive += item.selective_false_positive;
      acc.false_positive_reduced += item.false_positive_reduced;
      acc.introduced_false_negative += item.introduced_false_negative;
      return acc;
    }, { v1_false_positive: 0, selective_false_positive: 0, false_positive_reduced: 0, introduced_false_negative: 0 });
    aggregate.safety_gate_no_new_fn = aggregate.introduced_false_negative === 0;
    aggregate.utility_gate_fp_reduction = aggregate.selective_false_positive < aggregate.v1_false_positive;

    const report = { datasets, aggregate };
    process.stdout.write(options.json ? JSON.stringify(report, null, 2) + "\n" : renderSummary(report));
    return datasets.every(item => item.validation) ? 0 : 1;
  } catch (error) {
    process.stderr.write(String(error?.message || error) + "\n");
    return 1;
  }
}

module.exports = { DATASETS, parseArgs, renderSummary, main };

if (require.main === module) {
  main().then(code => {
    process.exitCode = code;
  });
}
