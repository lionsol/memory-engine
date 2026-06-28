import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { summarizeAnnotationLabels } from "../lib/annotation/summarize-annotation-labels.js";

function createFixtureDir() {
  return mkdtempSync(resolve(tmpdir(), "annotation-label-summary-"));
}

function writeJsonl(path, rows) {
  writeFileSync(path, `${rows.map(row => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function validRow(overrides = {}) {
  return {
    schema_version: 1,
    sample_id: "s1",
    sample_type: "memory",
    memory_id: "m1",
    chunk_id: "c1",
    primary_bucket: "raw_log_leak",
    source_path: "memory/smart-add/2026-06-24.md",
    annotation: {
      quality: "polluted",
      currency: "current",
      auto_recall_eligible: "no",
      preferred_action: "quarantine",
      reason: "raw log leakage",
    },
    annotator: "tester",
    labeled_at: "2026-06-26T14:00:00.000Z",
    ...overrides,
  };
}

test("schema validation and aggregation summary are correct", () => {
  const dir = createFixtureDir();
  const inputPath = resolve(dir, "labels.jsonl");
  const outPath = resolve(dir, "summary.json");
  writeJsonl(inputPath, [
    validRow(),
    validRow({
      sample_id: "s2",
      memory_id: "m2",
      chunk_id: "c2",
      primary_bucket: "duplicate_exact",
      annotation: {
        quality: "usable",
        currency: "superseded",
        auto_recall_eligible: "unsure",
        preferred_action: "demote",
        reason: "duplicate but still usable",
      },
    }),
    validRow({
      sample_id: "s3",
      memory_id: "m3",
      chunk_id: "c3",
      primary_bucket: "duplicate_exact",
      annotation: {
        quality: "good",
        currency: "current",
        auto_recall_eligible: "yes",
        preferred_action: "keep",
        reason: "good memory",
      },
    }),
  ]);

  const report = summarizeAnnotationLabels({
    inputPath,
    out: outPath,
    format: "json",
    now: new Date("2026-06-26T14:05:00.000Z"),
  });

  assert.equal(report.mode, "dry_run");
  assert.equal(report.write_db, false);
  assert.equal(report.memory_side_effects, false);
  assert.equal(report.reinforcement_side_effects, false);
  assert.equal(existsSync(outPath), true);
  assert.equal(report.summary.total_labels, 3);
  assert.equal(report.summary.labeled_count, 3);
  assert.equal(report.summary.missing_required_field_count, 0);
  assert.equal(report.summary.counts_by_primary_bucket.raw_log_leak, 1);
  assert.equal(report.summary.counts_by_primary_bucket.duplicate_exact, 2);
  assert.equal(report.summary.labeled_bucket_distribution.raw_log_leak, 1);
  assert.equal(report.summary.counts_by_quality.polluted, 1);
  assert.equal(report.summary.counts_by_auto_recall_eligible.no, 1);
  assert.equal(report.summary.counts_by_preferred_action.keep, 1);
  assert.equal(report.summary.polluted_rate_by_primary_bucket.raw_log_leak, 1);
  assert.equal(report.summary.auto_recall_eligible_no_rate_by_primary_bucket.raw_log_leak, 1);
  assert.equal(report.summary.unsure_rate_by_primary_bucket.duplicate_exact, 0.5);
  assert.equal(report.summary.validation_only_covers_raw_log_leak, false);
  assert.equal(report.summary.validation_scope_note, null);
});

test("invalid enums are detected", () => {
  const dir = createFixtureDir();
  const inputPath = resolve(dir, "labels.jsonl");
  writeJsonl(inputPath, [
    validRow({
      annotation: {
        quality: "bad_value",
        currency: "current",
        auto_recall_eligible: "nope",
        preferred_action: "drop",
        reason: "invalid enums",
      },
    }),
  ]);

  const report = summarizeAnnotationLabels({
    inputPath,
    format: "json",
    out: resolve(dir, "summary.json"),
  });

  assert.equal(report.summary.invalid_row_count, 1);
  assert.equal(report.summary.invalid_enum_count >= 3, true);
  assert.equal(report.summary.validation_errors[0].errors.includes("annotation.quality"), true);
  assert.equal(report.summary.validation_errors[0].errors.includes("annotation.auto_recall_eligible"), true);
  assert.equal(report.summary.validation_errors[0].errors.includes("annotation.preferred_action"), true);
});

test("missing required fields are detected", () => {
  const dir = createFixtureDir();
  const inputPath = resolve(dir, "labels.jsonl");
  writeJsonl(inputPath, [
    {
      schema_version: 1,
      sample_type: "memory",
      annotation: {
        quality: "good",
      },
    },
  ]);

  const report = summarizeAnnotationLabels({
    inputPath,
    format: "json",
    out: resolve(dir, "summary.json"),
  });

  assert.equal(report.summary.invalid_row_count, 1);
  assert.equal(report.summary.missing_required_field_count > 0, true);
  assert.equal(report.summary.validation_errors[0].errors.includes("sample_id"), true);
  assert.equal(report.summary.validation_errors[0].errors.includes("memory_id"), true);
  assert.equal(report.summary.validation_errors[0].errors.includes("annotation.currency"), true);
});

test("notes alias is accepted and canonical validation still uses reason", () => {
  const dir = createFixtureDir();
  const inputPath = resolve(dir, "labels.jsonl");
  const outPath = resolve(dir, "summary.json");
  writeJsonl(inputPath, [
    validRow({
      annotation: {
        quality: "polluted",
        currency: "current",
        auto_recall_eligible: "no",
        preferred_action: "quarantine",
        notes: "raw log leakage via notes alias",
      },
    }),
  ]);

  const report = summarizeAnnotationLabels({
    labels: inputPath,
    format: "json",
    out: outPath,
  });

  assert.equal(report.summary.invalid_row_count, 0);
  assert.equal(report.summary.labeled_count, 1);
  const content = readFileSync(outPath, "utf8");
  assert.equal(content.includes("\"notes\""), false);

  writeJsonl(inputPath, [
    validRow({
      annotation: {
        quality: "polluted",
        currency: "current",
        auto_recall_eligible: "no",
        preferred_action: "quarantine",
      },
    }),
  ]);

  const invalidReport = summarizeAnnotationLabels({
    labels: inputPath,
    format: "json",
    out: resolve(dir, "invalid-summary.json"),
  });

  assert.equal(invalidReport.summary.validation_errors[0].errors.includes("annotation.reason"), true);
});

test("CLI accepts preferred --labels flag and stays read-only", () => {
  const dir = createFixtureDir();
  const inputPath = resolve(dir, "labels.jsonl");
  const outPath = resolve(dir, "summary.md");
  writeJsonl(inputPath, [validRow()]);

  const result = spawnSync(process.execPath, [
    resolve(process.cwd(), "bin/summarize-annotation-labels.js"),
    "--in", inputPath,
    "--format", "md",
    "--out", outPath,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.equal(existsSync(outPath), true);
  assert.equal(/INSERT|UPDATE|DELETE/.test(String(result.stdout || "")), false);
  const markdown = readFileSync(outPath, "utf8");
  assert.equal(markdown.includes("Annotation Labels Summary"), true);
  assert.equal(markdown.includes("write_db: false"), true);
  assert.equal(markdown.includes("Labeled Bucket Distribution"), true);
});

test("CLI still accepts legacy --in flag", () => {
  const dir = createFixtureDir();
  const inputPath = resolve(dir, "labels.jsonl");
  const outPath = resolve(dir, "summary.md");
  writeJsonl(inputPath, [validRow()]);

  const result = spawnSync(process.execPath, [
    resolve(process.cwd(), "bin/summarize-annotation-labels.js"),
    "--in", inputPath,
    "--format", "md",
    "--out", outPath,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.equal(existsSync(outPath), true);
  const markdown = readFileSync(outPath, "utf8");
  assert.equal(markdown.includes("validation_only_covers_raw_log_leak: true"), true);
  assert.equal(markdown.includes("validation_scope_note: This validation only covers raw_log_leak."), true);
});
