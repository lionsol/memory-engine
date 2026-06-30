#!/usr/bin/env node

const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const previewCli = require("./preview-smart-add-duplicate-cleanup-candidates.js");

const FLAG_PREFIX = "--";
const FORBIDDEN_FLAGS = new Set([
  `${FLAG_PREFIX}apply`,
  `${FLAG_PREFIX}fix`,
  `${FLAG_PREFIX}delete`,
  `${FLAG_PREFIX}archive`,
  `${FLAG_PREFIX}quarantine`,
  `${FLAG_PREFIX}backfill-confidence`,
  `${FLAG_PREFIX}write-db`,
]);
const VALID_DECISIONS = new Set([
  "approve_delete_candidates",
  "skip",
  "manual_review_required",
]);

function printHelp() {
  console.log(`Validate Smart-Add Duplicate Cleanup Manifest

Usage:
  node bin/validate-smart-add-duplicate-cleanup-manifest.js --manifest <path> [options]

Options:
  --help               Show this help
  --manifest <path>    Path to confirmation manifest JSON
  --json               Print deterministic JSON output
  --markdown           Print Markdown summary

Notes:
  - Read-only validator only
  - Validates a user-supplied manifest against the current cleanup candidate preview
  - No DB writes, memory file mutation, cleanup apply, archive, quarantine, reinforce, confidence backfill, LLM, or network access
  - No runtime report files are written by this validator
`);
}

function readFlagValue(args, index, flagName) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flagName} expects a value`);
  }
  return value;
}

function parseArgs(argv = []) {
  const options = {
    help: false,
    manifestPath: null,
    json: false,
    markdown: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (FORBIDDEN_FLAGS.has(arg)) {
      throw new Error(`unsupported destructive flag: ${arg}`);
    }
    if (arg === "--help" || arg === "help") {
      options.help = true;
      continue;
    }
    if (arg === "--manifest") {
      options.manifestPath = readFlagValue(argv, i, "--manifest");
      i += 1;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--markdown") {
      options.markdown = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (options.json && options.markdown) {
    throw new Error("choose exactly one output format: --json or --markdown");
  }
  if (!options.help && !options.manifestPath) {
    throw new Error("--manifest is required");
  }
  if (!options.help && !options.json && !options.markdown) {
    options.json = true;
  }

  return options;
}

function createSideEffects() {
  return {
    db_writes: false,
    memory_file_mutation: false,
    cleanup_apply: false,
    archive: false,
    quarantine: false,
    reinforce: false,
    confidence_backfill: false,
    llm: false,
    network: false,
    runtime_report_files: false,
  };
}

function loadManifest(manifestPath) {
  const content = readFileSync(resolve(manifestPath), "utf8");
  return JSON.parse(content);
}

function baseReport() {
  return {
    generated_at: new Date().toISOString(),
    summary: {
      mode: "dry_run_manifest_validation",
      status: "pass",
      approved_group_count: 0,
      skipped_group_count: 0,
      manual_review_required_group_count: 0,
      rejected_group_count: 0,
      would_delete_count: 0,
    },
    errors: [],
    warnings: [],
    would_keep: [],
    would_delete: [],
    side_effects: createSideEffects(),
  };
}

function makeOccurrenceMap(group) {
  const map = new Map();
  for (const occurrence of group.occurrences || []) {
    map.set(occurrence.chunk_id, occurrence);
  }
  return map;
}

function pushGroupError(report, groupHash, message) {
  report.errors.push(`group ${groupHash}: ${message}`);
}

function validateManifestShape(report, manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    report.errors.push("manifest must be a JSON object");
    return;
  }
  if (manifest.version !== 1) {
    report.errors.push("manifest version must be 1");
  }
  if (manifest.kind !== "smart_add_duplicate_cleanup_manifest") {
    report.errors.push("manifest kind must be smart_add_duplicate_cleanup_manifest");
  }
  if (manifest.mode !== "dry_run_only") {
    report.errors.push("manifest mode must be dry_run_only");
  }
  if (!Array.isArray(manifest.groups)) {
    report.errors.push("manifest groups must be an array");
  }
}

function validateApprovedGroup(report, manifestGroup, currentGroup) {
  const groupHash = manifestGroup.group_hash || "<missing-group-hash>";
  const errorCountBefore = report.errors.length;
  if (currentGroup.cleanup_eligibility !== true) {
    pushGroupError(report, groupHash, "current group is not cleanup eligible");
  }
  if (currentGroup.classification !== "ingestion_bug_candidate") {
    pushGroupError(report, groupHash, `current group classification mismatch: ${currentGroup.classification}`);
  }
  if (Number(currentGroup.retrieved_count_total || 0) !== 0) {
    pushGroupError(report, groupHash, "current group retrieved_count_total must be 0");
  }
  if (Number(currentGroup.injected_count_total || 0) !== 0) {
    pushGroupError(report, groupHash, "current group injected_count_total must be 0");
  }
  if ((currentGroup.owners_touched || []).some(owner => owner !== "memory_engine_lifecycle")) {
    pushGroupError(report, groupHash, "current group must be lifecycle-owned only");
  }
  if ((currentGroup.families_touched || []).some(family => family !== "smart_add")) {
    pushGroupError(report, groupHash, "current group must be smart_add family only");
  }

  const keep = currentGroup.suggested_keep_candidate || null;
  if (!keep || !keep.chunk_id) {
    pushGroupError(report, groupHash, "current group missing suggested keep candidate");
    return;
  }
  if (manifestGroup.keep_chunk_id !== keep.chunk_id) {
    pushGroupError(report, groupHash, `keep_chunk_id mismatch: expected ${keep.chunk_id}`);
  }

  const deleteIds = Array.isArray(manifestGroup.delete_chunk_ids) ? manifestGroup.delete_chunk_ids : [];
  const uniqueDeleteIds = new Set();
  for (const deleteId of deleteIds) {
    if (uniqueDeleteIds.has(deleteId)) {
      pushGroupError(report, groupHash, `duplicate delete_chunk_id: ${deleteId}`);
    }
    uniqueDeleteIds.add(deleteId);
  }

  const allowedDeleteCandidates = new Map();
  for (const candidate of currentGroup.suggested_delete_candidates || []) {
    if (candidate?.chunk_id) {
      allowedDeleteCandidates.set(candidate.chunk_id, candidate);
    }
  }
  for (const deleteId of deleteIds) {
    if (!allowedDeleteCandidates.has(deleteId)) {
      pushGroupError(report, groupHash, `unknown delete_chunk_id: ${deleteId}`);
    }
  }

  if (report.errors.length > errorCountBefore) {
    return;
  }

  report.summary.approved_group_count += 1;
  report.would_keep.push({
    group_hash: currentGroup.group_hash,
    chunk_id: keep.chunk_id,
    path: keep.path,
    occurrence_date: keep.occurrence_date || keep.date || null,
    category: keep.category || null,
    fingerprint_hash: keep.fingerprint_hash || null,
  });

  const occurrenceMap = makeOccurrenceMap(currentGroup);
  for (const deleteId of deleteIds) {
    const occurrence = occurrenceMap.get(deleteId);
    const candidate = allowedDeleteCandidates.get(deleteId) || {};
    report.would_delete.push({
      group_hash: currentGroup.group_hash,
      chunk_id: deleteId,
      path: occurrence?.path || candidate.path || null,
      occurrence_date: occurrence?.occurrence_date || candidate.occurrence_date || candidate.date || null,
      category: occurrence?.category || candidate.category || null,
      fingerprint_hash: occurrence?.fingerprint_hash || candidate.fingerprint_hash || null,
    });
  }
}

async function validateCleanupManifest(manifestPath) {
  const report = baseReport();
  let manifest;
  try {
    manifest = loadManifest(manifestPath);
  } catch (error) {
    report.summary.status = "fail";
    report.errors.push(`failed to read manifest: ${String(error?.message || error)}`);
    return report;
  }

  const preview = await previewCli.runCleanupCandidatePreview();
  return validateCleanupManifestAgainstPreview(manifest, preview, report);
}

function validateCleanupManifestAgainstPreview(manifest, preview, report = baseReport()) {
  const groups = Array.isArray(preview?.groups) ? preview.groups : [];
  const groupMap = new Map(groups.map(group => [group.group_hash, group]));

  validateManifestShape(report, manifest);

  if (Array.isArray(manifest?.groups)) {
    for (const manifestGroup of manifest.groups) {
      const groupHash = manifestGroup?.group_hash || "<missing-group-hash>";
      const decision = manifestGroup?.decision;

      if (!VALID_DECISIONS.has(decision)) {
        pushGroupError(report, groupHash, `invalid decision: ${decision}`);
        report.summary.rejected_group_count += 1;
        continue;
      }

      const currentGroup = groupMap.get(groupHash);
      if (!currentGroup) {
        pushGroupError(report, groupHash, "group_hash not found in current cleanup preview");
        report.summary.rejected_group_count += 1;
        continue;
      }
      if (manifestGroup.normalized_content_hash !== currentGroup.normalized_content_hash) {
        pushGroupError(report, groupHash, "normalized_content_hash mismatch");
        report.summary.rejected_group_count += 1;
        continue;
      }

      if (decision === "skip") {
        report.summary.skipped_group_count += 1;
        continue;
      }
      if (decision === "manual_review_required") {
        report.summary.manual_review_required_group_count += 1;
        continue;
      }

      const errorCountBefore = report.errors.length;
      validateApprovedGroup(report, manifestGroup, currentGroup);
      if (report.errors.length > errorCountBefore) {
        report.summary.rejected_group_count += 1;
      }
    }
  }

  report.summary.would_delete_count = report.would_delete.length;
  if (report.errors.length > 0) {
    report.summary.status = "fail";
  }
  return report;
}

function renderMarkdown(report) {
  const lines = [
    "# Smart-Add Duplicate Cleanup Manifest Validation",
    "",
    `- generated_at: ${report.generated_at}`,
    `- status: ${report.summary.status}`,
    `- approved_group_count: ${report.summary.approved_group_count}`,
    `- skipped_group_count: ${report.summary.skipped_group_count}`,
    `- manual_review_required_group_count: ${report.summary.manual_review_required_group_count}`,
    `- rejected_group_count: ${report.summary.rejected_group_count}`,
    `- would_delete_count: ${report.summary.would_delete_count}`,
    "",
    "## Would Keep",
    "",
  ];

  if ((report.would_keep || []).length === 0) {
    lines.push("- none", "");
  } else {
    for (const item of report.would_keep) {
      lines.push(`- group_hash: ${item.group_hash} keep_chunk_id: ${item.chunk_id} path: ${item.path}`);
    }
    lines.push("");
  }

  lines.push("## Would Delete", "");
  if ((report.would_delete || []).length === 0) {
    lines.push("- none", "");
  } else {
    for (const item of report.would_delete) {
      lines.push(`- group_hash: ${item.group_hash} chunk_id: ${item.chunk_id} path: ${item.path} date: ${item.occurrence_date} category: ${item.category}`);
    }
    lines.push("");
  }

  lines.push("## Errors", "");
  if ((report.errors || []).length === 0) {
    lines.push("- none", "");
  } else {
    for (const error of report.errors) {
      lines.push(`- ${error}`);
    }
    lines.push("");
  }

  lines.push("## Side Effects", "");
  for (const [key, value] of Object.entries(report.side_effects || {})) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      printHelp();
      return 0;
    }
    const report = await validateCleanupManifest(options.manifestPath);
    const output = options.markdown
      ? renderMarkdown(report)
      : JSON.stringify(report, null, 2);
    if (report.summary.status === "fail") {
      console.error(output);
      return 1;
    }
    console.log(output);
    return 0;
  } catch (error) {
    console.error(String(error?.message || error));
    return 1;
  }
}

module.exports = {
  parseArgs,
  validateCleanupManifestAgainstPreview,
  validateCleanupManifest,
  renderMarkdown,
  main,
};

if (process.argv[1] && /validate-smart-add-duplicate-cleanup-manifest\.js$/.test(process.argv[1])) {
  main().then(code => {
    process.exitCode = code;
  });
}
