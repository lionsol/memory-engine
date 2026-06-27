import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { previewAnnotationEligibility } from "../lib/annotation/preview-annotation-eligibility.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function createFixtureDir() {
  return mkdtempSync(resolve(tmpdir(), "annotation-eligibility-preview-"));
}

function writeJsonl(path, rows) {
  writeFileSync(path, `${rows.map(row => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function labelRow(overrides = {}) {
  return {
    schema_version: 1,
    sample_id: "sample-1",
    sample_type: "memory",
    memory_id: "memory-1",
    chunk_id: "chunk-1",
    primary_bucket: "raw_log_leak",
    source_path: "memory/smart-add/2026-06-24.md",
    annotation: {
      quality: "usable",
      currency: "current",
      auto_recall_eligible: "yes",
      preferred_action: "keep",
      reason: "looks okay",
    },
    ...overrides,
  };
}

function candidateRow(overrides = {}) {
  return {
    sample_id: "sample-1",
    sample_type: "memory",
    memory_id: "memory-1",
    chunk_id: "chunk-1",
    primary_bucket: "raw_log_leak",
    sample_buckets: ["raw_log_leak"],
    source_path: "memory/smart-add/2026-06-24.md",
    ...overrides,
  };
}

test("suspected_tool_output bucket recommends auto recall false and reinforcement false", () => {
  const dir = createFixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  const outPath = resolve(dir, "preview.json");
  writeJsonl(labelsPath, [
    labelRow({
      primary_bucket: "suspected_tool_output",
      annotation: {
        quality: "polluted",
        currency: "current",
        auto_recall_eligible: "unsure",
        preferred_action: "keep",
        reason: "tool output",
      },
    }),
  ]);

  const report = previewAnnotationEligibility({
    labelsInputPath: labelsPath,
    out: outPath,
    format: "json",
  });

  assert.equal(report.write_db, false);
  assert.equal(existsSync(outPath), true);
  assert.equal(report.summary.affected_sample_count, 1);
  assert.equal(report.recommendations[0].recommend_auto_recall_eligible, false);
  assert.equal(report.recommendations[0].recommend_reinforcement_eligible, false);
  assert.equal(report.recommendations[0].suggested_action, "quarantine_candidate");
});

test("raw_log_leak alone does not trigger quarantine or delete from bucket membership", () => {
  const dir = createFixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");
  writeJsonl(labelsPath, [labelRow()]);
  writeJsonl(candidatesPath, [candidateRow()]);

  const report = previewAnnotationEligibility({
    labelsInputPath: labelsPath,
    candidatesInputPath: candidatesPath,
    format: "json",
    out: resolve(dir, "preview.json"),
  });

  assert.equal(report.summary.raw_log_leak_only_samples_seen, 1);
  assert.equal(report.summary.raw_log_leak_only_bucket_noop_count, 1);
  assert.equal(report.summary.affected_sample_count, 0);
});

test("delete recommendation always requires manual confirmation", () => {
  const dir = createFixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  writeJsonl(labelsPath, [
    labelRow({
      annotation: {
        quality: "polluted",
        currency: "current",
        auto_recall_eligible: "no",
        preferred_action: "delete",
        reason: "confirmed bad sample",
      },
    }),
  ]);

  const report = previewAnnotationEligibility({
    labelsInputPath: labelsPath,
    format: "json",
    out: resolve(dir, "preview.json"),
  });

  assert.equal(report.summary.manual_confirm_required_count, 1);
  assert.equal(report.recommendations[0].suggested_action, "delete_candidate");
  assert.equal(report.recommendations[0].requires_manual_confirm, true);
});

test("demote does not escalate to delete or quarantine", () => {
  const dir = createFixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  writeJsonl(labelsPath, [
    labelRow({
      primary_bucket: "memory_other",
      annotation: {
        quality: "low_quality",
        currency: "superseded",
        auto_recall_eligible: "unsure",
        preferred_action: "demote",
        reason: "demote only",
      },
    }),
  ]);

  const report = previewAnnotationEligibility({
    labelsInputPath: labelsPath,
    format: "json",
    out: resolve(dir, "preview.json"),
  });

  assert.equal(report.summary.affected_sample_count, 1);
  assert.equal(report.recommendations[0].suggested_action, "demote_only");
  assert.equal(report.recommendations[0].requires_manual_confirm, false);
});

test("CLI rejects destructive flags and stays read-only", () => {
  const dir = createFixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  const outPath = resolve(dir, "preview.md");
  writeJsonl(labelsPath, [labelRow()]);

  const rejected = spawnSync(process.execPath, [
    resolve(repoRoot, "bin/preview-annotation-eligibility.js"),
    "--labels", labelsPath,
    "--delete",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(rejected.status, 1);
  assert.equal(existsSync(outPath), false);

  const ok = spawnSync(process.execPath, [
    resolve(repoRoot, "bin/preview-annotation-eligibility.js"),
    "--labels", labelsPath,
    "--format", "md",
    "--out", outPath,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(ok.status, 0);
  assert.equal(existsSync(outPath), true);
  assert.equal(/INSERT|UPDATE|DELETE/.test(String(ok.stdout || "")), false);
  const markdown = readFileSync(outPath, "utf8");
  assert.equal(markdown.includes("Annotation Eligibility Preview"), true);
  assert.equal(markdown.includes("write_db: false"), true);
});
