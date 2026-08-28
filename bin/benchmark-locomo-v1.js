#!/usr/bin/env node

const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

function requireValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing_argument_value:${option}`);
  return value;
}

function parseArgs(argv) {
  const args = {
    input: null,
    evidencePolicy: "locomo_evidence_strict_v1",
    json: false,
    requireOfficial: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input") {
      args.input = requireValue(argv, index, token);
      index += 1;
    } else if (token === "--evidence-policy") {
      args.evidencePolicy = requireValue(argv, index, token);
      index += 1;
    } else if (token === "--require-official") {
      args.requireOfficial = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    } else {
      throw new Error(`unknown_argument:${token}`);
    }
  }
  return args;
}

function usage() {
  return [
    "Usage: node bin/benchmark-locomo-v1.js --input <locomo10.json> [options]",
    "",
    "Options:",
    "  --evidence-policy <name>  locomo_evidence_strict_v1 (default) or locomo_evidence_canonicalized_v1",
    "  --require-official        Require the pinned official dataset SHA and shape",
    "  --json                    Print the complete contract summary as JSON",
    "  --help                    Show this help",
    "",
    "B5-I1 validates the LoCoMo dataset/metric contract only; it does not run retrieval.",
  ].join("\n");
}

function renderSummary(summary) {
  const selected = summary.selected_policy_summary;
  const lines = [
    `schema=${summary.schema}`,
    `profile=${summary.profile}`,
    `upstream_commit=${summary.provenance.upstream_commit}`,
    `dataset_sha256=${summary.dataset_sha256}`,
    `dataset_sha256_matches=${summary.dataset_sha256_matches}`,
    `license_identity=${summary.provenance.license_identity}`,
    `conversations=${summary.conversations}`,
    `sessions=${summary.sessions}`,
    `turns=${summary.turns}`,
    `qa=${summary.qa}`,
    `turn_identity=${summary.turn_identity.validated}/${summary.turn_identity.total}`,
    `evidence_policy=${summary.selected_evidence_policy}`,
    `scored_cases=${selected.scored_cases}`,
    `skipped_cases=${selected.skipped_cases}`,
  ];
  for (const [category, count] of Object.entries(summary.category_totals)) {
    lines.push(`category.${category}=${count}`);
  }
  for (const [reason, count] of Object.entries(selected.skip_reasons)) {
    lines.push(`skip_reason.${reason}=${count}`);
  }
  return lines.join("\n");
}

async function run(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    return { help: true, text: usage() };
  }
  if (!args.input) throw new Error("--input is required");

  const {
    LOCOMO_DATASET_SHA256,
    LOCOMO_EVIDENCE_CANONICALIZED_V1,
    LOCOMO_EVIDENCE_STRICT_V1,
    validateLocomoDataset,
    getLocomoProvenance,
    sha256LocomoDatasetBytes,
    summarizeLocomoDataset,
  } = await import("../lib/benchmark/locomo-v1.js");
  if (![LOCOMO_EVIDENCE_STRICT_V1, LOCOMO_EVIDENCE_CANONICALIZED_V1].includes(args.evidencePolicy)) {
    throw new Error(`unsupported_evidence_policy:${args.evidencePolicy}`);
  }

  const inputPath = resolve(args.input);
  const bytes = readFileSync(inputPath);
  const parsed = JSON.parse(bytes.toString("utf8"));
  const validation = validateLocomoDataset(parsed);
  const selected = summarizeLocomoDataset(parsed, { evidencePolicy: args.evidencePolicy });
  const actualSha256 = sha256LocomoDatasetBytes(bytes);
  const output = {
    ...validation,
    dataset_sha256: actualSha256,
    dataset_sha256_matches: actualSha256 === LOCOMO_DATASET_SHA256,
    selected_evidence_policy: args.evidencePolicy,
    selected_policy_summary: {
      scored_cases: selected.scored_cases,
      skipped_cases: selected.skipped_cases,
      skip_reasons: selected.skip_reasons,
      by_category: selected.by_category,
    },
    provenance: {
      ...getLocomoProvenance(),
      dataset_sha256_actual: actualSha256,
    },
  };
  if (args.requireOfficial && (!output.dataset_sha256_matches || !output.official_shape_matches)) {
    throw new Error(output.dataset_sha256_matches ? "official_locomo_shape_mismatch" : `dataset_sha256_mismatch:${actualSha256}`);
  }
  return {
    help: false,
    output,
    text: args.json ? JSON.stringify(output, null, 2) : renderSummary(output),
  };
}

async function main(argv = process.argv.slice(2)) {
  const result = await run(argv);
  process.stdout.write(`${result.text}\n`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`benchmark-locomo-v1: ${error?.message || error}`);
    console.error(usage());
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs, renderSummary, run, usage };
