import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";

import {
  annotationReportsSnapshot,
  getAllowedReportKind,
  latestReports,
  listReports,
  readReportFile,
} from "../console/services/reports-service.js";
import { handleReportsApi } from "../console/routes/reports.js";

function withTempReports(testFn) {
  return async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "memory-engine-console-reports-"));
    const reportsDir = path.join(root, "reports");
    fs.mkdirSync(reportsDir, { recursive: true });
    const previous = process.env.MEMORY_ENGINE_REPORTS_DIR;
    process.env.MEMORY_ENGINE_REPORTS_DIR = reportsDir;
    try {
      await testFn({ root, reportsDir });
    } finally {
      if (previous === undefined) delete process.env.MEMORY_ENGINE_REPORTS_DIR;
      else process.env.MEMORY_ENGINE_REPORTS_DIR = previous;
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function writeReport(reportsDir, name, content, mtimeMs) {
  const file = path.join(reportsDir, name);
  fs.writeFileSync(file, content, "utf8");
  const at = new Date(mtimeMs);
  fs.utimesSync(file, at, at);
}

test("reports API lists only whitelisted report files", withTempReports(({ reportsDir }) => {
  writeReport(reportsDir, "annotation-summary-20260627-101010.md", "# summary", Date.UTC(2026, 5, 27, 10, 10, 10));
  writeReport(reportsDir, "annotation-labels-20260626-first50.jsonl", "{\"a\":1}\n", Date.UTC(2026, 5, 26, 10, 10, 10));
  writeReport(reportsDir, "auto-recall-safety-smoke-20260627-130731.md", "# smoke", Date.UTC(2026, 5, 27, 13, 7, 31));
  writeReport(reportsDir, "annotation-candidates-dreaming_duplicate-20260628-022727.jsonl", "{\"sample\":1}\n", Date.UTC(2026, 5, 28, 2, 27, 27));
  writeReport(reportsDir, "annotation-candidates-dreaming_duplicate-dreaming_maintenance_log-dreaming_candidate_staging-20260628-022727.jsonl", "{\"sample\":2}\n", Date.UTC(2026, 5, 28, 2, 27, 28));
  writeReport(reportsDir, "annotation-candidates-dreaming_duplicate-20260628.md", "# legacy", Date.UTC(2026, 5, 28, 2, 27, 29));
  writeReport(reportsDir, "annotation-local-qc-report-2026-07-04T10-00-00.000Z.json", "{\"mode\":\"annotation_local_qc_report\"}", Date.UTC(2026, 6, 4, 8, 0, 0));
  writeReport(reportsDir, "archived-raw-log-rescue-manual-review-queue-p7-20260704.jsonl", "{\"sample_id\":\"rescue:a\"}\n", Date.UTC(2026, 6, 4, 9, 0, 0));
  writeReport(reportsDir, "archived-raw-log-rescue-review-queue-label-report-p8-preflight-20260704.json", "{\"mode\":\"archived_raw_log_rescue_review_queue_label_report\"}", Date.UTC(2026, 6, 4, 10, 0, 0));
  writeReport(reportsDir, "not-allowed.txt", "nope", Date.UTC(2026, 5, 27, 1, 0, 0));
  fs.mkdirSync(path.join(reportsDir, "nested"), { recursive: true });
  fs.writeFileSync(path.join(reportsDir, "nested", "annotation-summary-20260627-101010.md"), "nested", "utf8");

  const result = handleReportsApi({
    method: "GET",
    parts: ["api", "reports"],
    searchParams: new URLSearchParams(),
  });

  assert.equal(result.status, 200);
  assert.deepEqual(
    result.body.files.map(file => file.name),
    [
      "archived-raw-log-rescue-review-queue-label-report-p8-preflight-20260704.json",
      "archived-raw-log-rescue-manual-review-queue-p7-20260704.jsonl",
      "annotation-local-qc-report-2026-07-04T10-00-00.000Z.json",
      "annotation-candidates-dreaming_duplicate-20260628.md",
      "annotation-candidates-dreaming_duplicate-dreaming_maintenance_log-dreaming_candidate_staging-20260628-022727.jsonl",
      "annotation-candidates-dreaming_duplicate-20260628-022727.jsonl",
      "auto-recall-safety-smoke-20260627-130731.md",
      "annotation-summary-20260627-101010.md",
      "annotation-labels-20260626-first50.jsonl",
    ]
  );
}));

test("reports file API rejects path traversal", withTempReports(({ reportsDir }) => {
  writeReport(reportsDir, "annotation-summary-20260627-101010.md", "# summary", Date.UTC(2026, 5, 27, 10, 10, 10));

  for (const name of ["../secret.txt", "/etc/passwd", "nested/file.md", "..\\\\windows.txt", "annotation-candidates-../../x.jsonl"]) {
    const result = handleReportsApi({
      method: "GET",
      parts: ["api", "reports", "file"],
      searchParams: new URLSearchParams({ name }),
    });
    assert.equal(result.status, 400);
    assert.match(result.body.error, /allowed|traversal|nested|absolute/i);
  }
}));

test("reports file API rejects non-whitelisted files", withTempReports(({ reportsDir }) => {
  writeReport(reportsDir, "annotation-summary-20260627-101010.md", "# summary", Date.UTC(2026, 5, 27, 10, 10, 10));
  writeReport(reportsDir, "memory-quality-eval.md", "# nope", Date.UTC(2026, 5, 27, 10, 11, 10));
  writeReport(reportsDir, "annotation-candidates-evil.txt", "evil", Date.UTC(2026, 5, 27, 10, 11, 11));

  for (const name of ["memory-quality-eval.md", "package.json", "annotation-candidates-evil.txt"]) {
    const result = handleReportsApi({
      method: "GET",
      parts: ["api", "reports", "file"],
      searchParams: new URLSearchParams({ name }),
    });
    assert.equal(result.status, 400);
    assert.match(result.body.error, /not allowed/i);
  }
}));

test("reports latest API picks latest summary eligibility preview and smoke files", withTempReports(({ reportsDir }) => {
  writeReport(reportsDir, "annotation-summary-20260627-101010.md", "# old summary", Date.UTC(2026, 5, 27, 10, 10, 10));
  writeReport(reportsDir, "annotation-summary-20260627-121212.json", "{\"new\":true}", Date.UTC(2026, 5, 27, 12, 12, 12));
  writeReport(reportsDir, "annotation-eligibility-preview-20260627-111111.md", "# old preview", Date.UTC(2026, 5, 27, 11, 11, 11));
  writeReport(reportsDir, "annotation-eligibility-preview-20260627-141414.json", "{\"preview\":true}", Date.UTC(2026, 5, 27, 14, 14, 14));
  writeReport(reportsDir, "auto-recall-safety-smoke-20260627-090909.md", "# old smoke", Date.UTC(2026, 5, 27, 9, 9, 9));
  writeReport(reportsDir, "auto-recall-safety-smoke-20260627-150000.md", "# new smoke", Date.UTC(2026, 5, 27, 15, 0, 0));

  const result = handleReportsApi({
    method: "GET",
    parts: ["api", "reports", "latest"],
    searchParams: new URLSearchParams(),
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.annotation_summary?.name, "annotation-summary-20260627-121212.json");
  assert.equal(result.body.annotation_eligibility_preview?.name, "annotation-eligibility-preview-20260627-141414.json");
  assert.equal(result.body.annotation_local_qc_report, null);
  assert.equal(result.body.archived_raw_log_rescue_combined_report, null);
  assert.equal(result.body.archived_raw_log_rescue_review_queue_label_report, null);
  assert.equal(result.body.auto_recall_safety_smoke?.name, "auto-recall-safety-smoke-20260627-150000.md");
}));

test("reports view stays read-only and contains no destructive action buttons or forms", () => {
  const view = readFileSync(new URL("../console/views/reports.ejs", import.meta.url), "utf8");

  for (const forbidden of [
    "data-archive",
    "data-delete",
    "<form",
  ]) {
    assert.equal(view.includes(forbidden), false, `forbidden token present: ${forbidden}`);
  }

  for (const required of [
    "Safety Reports",
    "read-only",
    "does not write DB",
    "does not modify memory records",
    "does not trigger autoRecall",
    "Long Input Decision Trace",
    "data-report-decision-trace",
    "Memory Card Preview",
    "Memory Card Preview Details",
    "data-report-memory-card-preview",
    "data-report-memory-card-preview-primary",
    "Archived Raw-log Rescue Combined Preview",
    "data-report-rescue-combined-preview",
    "Annotation QC Preview",
    "data-report-annotation-qc-preview",
    "Review Queue Preview",
    "data-report-review-queue-preview",
    "Review Queue Label Preview",
    "data-report-review-queue-label-preview",
    "Read-only preview only",
  ]) {
    assert.equal(view.includes(required), true, `missing required token: ${required}`);
  }
});

test("reports charts include decision trace rendering hooks and fields", () => {
  const charts = readFileSync(new URL("../console/public/charts.js", import.meta.url), "utf8");

  for (const required of [
    "data-report-decision-trace",
    "long_input_detected",
    "generic_task_detected",
    "explicit_history_context",
    "should_recall",
    "intent_reason",
    "focused_query",
    "data-report-memory-card-preview",
    "data-report-memory-card-preview-primary",
    "renderMemoryCardPreview",
    "memory_card_preview",
    "get token",
    "risk_flags",
    "source_hint",
    "auto_recall_turn_gold_set_replay",
    "Turn Gold Replay Cards",
    "latest.auto_recall_turn_gold_set_replay",
    "data-report-rescue-combined-preview",
    "renderRescueCombinedPreview",
    "rescue_combined_preview",
    "archived_raw_log_rescue_combined_report",
    "data-report-annotation-qc-preview",
    "renderAnnotationQcPreview",
    "annotation_local_qc_preview",
    "annotation_local_qc_report",
    "data-report-review-queue-preview",
    "renderReviewQueuePreview",
    "review_queue_preview",
    "latest.archived_raw_log_rescue_review_queue",
    "data-report-review-queue-label-preview",
    "renderReviewQueueLabelPreview",
    "review_queue_label_preview",
    "archived_raw_log_rescue_review_queue_label_report",
  ]) {
    assert.equal(charts.includes(required), true, `missing required token: ${required}`);
  }
});

test("reports service reads only whitelisted files and classifies kinds", withTempReports(({ reportsDir }) => {
  writeReport(reportsDir, "annotation-candidates-20260627-111111.jsonl", "{\"sample\":1}\n", Date.UTC(2026, 5, 27, 11, 11, 11));
  const files = listReports();
  assert.equal(files.length, 1);
  assert.equal(getAllowedReportKind(files[0].name), "annotation_candidates");

  const file = readReportFile("annotation-candidates-20260627-111111.jsonl");
  assert.equal(file.content, "{\"sample\":1}\n");
  assert.equal(file.format, "jsonl");
}));

test("reports service adds memory_card_preview for turn gold-set replay json reports via pure mapping", withTempReports(({ reportsDir }) => {
  writeReport(reportsDir, "auto-recall-turn-gold-set-replay-20260702-101010.json", JSON.stringify({
    replay: {
      summary: {
        mode: "read_only_turn_gold_set_replay",
        total_count: 2,
        card_expected_count: 1,
        card_projection_count: 1,
      },
      results: [
        {
          turn_id: "seed_long_project_review_001",
          line_number: 9,
          card_projection: {
            memory_card: {
              card_id: "memcard_turn_gold_seed_long_project_review_001",
              memory_id: "turn_gold_seed_long_project_review_001",
              title: "Expected memory card for seed_long_project_review_001",
              summary: "Expected memory_card disclosure.",
              salience_reason: "Gold-set expected disclosure for review_plan.",
              source_hint: "test/fixtures/auto-recall-turn-gold-set.seed.jsonl:9-9",
              category: "project",
              kind: "decision",
              confidence_score: 1,
              risk_flags: [],
              disclosure_level: "memory_card",
              get_token: "memory_engine_get:turn_gold_seed_long_project_review_001",
            },
          },
        },
        {
          turn_id: "seed_long_rewrite_001",
          line_number: 1,
          card_projection: {
            memory_card: null,
          },
        },
      ],
    },
  }, null, 2), Date.UTC(2026, 6, 2, 10, 10, 10));

  const file = readReportFile("auto-recall-turn-gold-set-replay-20260702-101010.json");
  assert.equal(file.kind, "auto_recall_turn_gold_set_replay");
  assert.equal(file.memory_card_preview.summary.mode, "read_only_memory_card_preview");
  assert.equal(file.memory_card_preview.summary.total_count, 2);
  assert.equal(file.memory_card_preview.summary.card_expected_count, 1);
  assert.equal(file.memory_card_preview.summary.card_projection_count, 1);
  assert.equal(file.memory_card_preview.cards.length, 1);
  assert.deepEqual(file.memory_card_preview.cards[0], {
    turn_id: "seed_long_project_review_001",
    line_number: 9,
    card_id: "memcard_turn_gold_seed_long_project_review_001",
    memory_id: "turn_gold_seed_long_project_review_001",
    title: "Expected memory card for seed_long_project_review_001",
    summary: "Expected memory_card disclosure.",
    salience_reason: "Gold-set expected disclosure for review_plan.",
    source_hint: "test/fixtures/auto-recall-turn-gold-set.seed.jsonl:9-9",
    category: "project",
    kind: "decision",
    confidence_score: 1,
    risk_flags: [],
    disclosure_level: "memory_card",
    get_token: "memory_engine_get:turn_gold_seed_long_project_review_001",
  });
  assert.deepEqual(file.memory_card_preview.side_effects, {
    db_writes: false,
    memory_file_mutation: false,
    dataset_file_mutation: false,
    retrieval: false,
    injection: false,
    cleanup_apply: false,
    archive: false,
    quarantine: false,
    reinforce: false,
    llm: false,
    network: false,
    runtime_report_files: false,
  });
}));

test("reports service adds rescue_combined_preview for combined rescue reports via pure mapping", withTempReports(({ reportsDir }) => {
  writeReport(reportsDir, "archived-raw-log-rescue-combined-report-p2-p4-20260703.json", JSON.stringify({
    mode: "archived_raw_log_rescue_combined_label_report",
    write_db: false,
    memory_side_effects: false,
    reinforcement_side_effects: false,
    threshold: 55,
    unsure_threshold: 30,
    summary: {
      labels_valid: 40,
      labels_invalid: 1,
      invalid_reasons: { schema_version: 1 },
    },
    scoring: {
      total: 40,
      exact_match: 13,
      exact_accuracy: 0.325,
      yes_true_positive: 11,
      yes_false_positive: 0,
      yes_false_negative: 11,
      yes_true_negative: 18,
      yes_precision: 1,
      yes_recall: 0.5,
      yes_f1: 0.6666666667,
      predicted_distribution: { unsure: 23, yes: 11, no: 6 },
      actual_distribution: { yes: 22, no: 18 },
      false_positives: [{ sample_id: "fp-a", score: 99 }],
      false_negatives: [{ sample_id: "fn-a", score: 54, predicted_keep_active: "unsure" }],
    },
    manual_review: {
      total: 23,
      predicted_distribution: { unsure: 23 },
      raw_predicted_distribution: { yes: 20, unsure: 3 },
      flag_distribution: { positive_negative_conflict: 20 },
      selection_reason_distribution: { boundary: 8, positive_negative_conflict: 9 },
      target_category_distribution: { project: 5, raw_log: 14 },
      rescue_confidence_distribution: { low: 19, medium: 3 },
      metrics: {
        total: 23,
        exact_match: 0,
        exact_accuracy: 0,
        yes_true_positive: 0,
        yes_false_positive: 0,
        yes_false_negative: 7,
        yes_true_negative: 16,
        yes_precision: null,
        yes_recall: 0,
        yes_f1: null,
      },
    },
    non_manual: {
      total: 17,
      predicted_distribution: { yes: 11, no: 6 },
      selection_reason_distribution: { boundary: 7, bucket_diversity: 8 },
      metrics: {
        total: 17,
        exact_match: 13,
        exact_accuracy: 0.7647,
        yes_true_positive: 11,
        yes_false_positive: 0,
        yes_false_negative: 4,
        yes_true_negative: 2,
        yes_precision: 1,
        yes_recall: 0.7333,
        yes_f1: 0.8461,
      },
    },
    by_round: {
      p2: { total: 20, exact_match: 12, exact_accuracy: 0.6, yes_precision: 1, yes_recall: 0.5882, yes_f1: 0.7407 },
      p4: { total: 20, exact_match: 1, exact_accuracy: 0.05, yes_precision: 1, yes_recall: 0.2, yes_f1: 0.3333 },
    },
    by_bucket: {
      archived_raw_log_project: { total: 23, exact_match: 8, exact_accuracy: 0.3478, yes_precision: 1, yes_recall: 0.8, yes_f1: 0.8889 },
      archived_raw_log_decision: { total: 6, exact_match: 1, exact_accuracy: 0.1667, yes_precision: 1, yes_recall: 0.3333, yes_f1: 0.5 },
    },
    by_selection_reason: {
      boundary: { total: 15, exact_match: 7, exact_accuracy: 0.4667, yes_precision: 1, yes_recall: 1, yes_f1: 1 },
      bucket_diversity: { total: 12, exact_match: 5, exact_accuracy: 0.4167, yes_precision: 1, yes_recall: 0.4, yes_f1: 0.5714 },
    },
    invalid_labels: [{ sample_id: "invalid-a", errors: ["schema_version"] }],
  }, null, 2), Date.UTC(2026, 6, 3, 13, 0, 0));

  const file = readReportFile("archived-raw-log-rescue-combined-report-p2-p4-20260703.json");
  assert.equal(file.kind, "archived_raw_log_rescue_combined_report");
  assert.equal(file.rescue_combined_preview.summary.mode, "read_only_rescue_combined_preview");
  assert.equal(file.rescue_combined_preview.summary.labels_valid, 40);
  assert.equal(file.rescue_combined_preview.summary.labels_invalid, 1);
  assert.equal(file.rescue_combined_preview.summary.total, 40);
  assert.equal(file.rescue_combined_preview.summary.exact_match, 13);
  assert.equal(file.rescue_combined_preview.summary.yes_false_negative, 11);
  assert.equal(file.rescue_combined_preview.summary.manual_review_total, 23);
  assert.deepEqual(file.rescue_combined_preview.distributions.predicted_distribution, [
    { label: "unsure", count: 23 },
    { label: "yes", count: 11 },
    { label: "no", count: 6 },
  ]);
  assert.deepEqual(file.rescue_combined_preview.breakdowns.by_round.map(row => row.label), ["p2", "p4"]);
  assert.equal(file.rescue_combined_preview.breakdowns.manual_review_metrics.total, 23);
  assert.equal(file.rescue_combined_preview.breakdowns.non_manual_metrics.total, 17);
  assert.equal(file.rescue_combined_preview.false_negatives[0].sample_id, "fn-a");
  assert.equal(file.rescue_combined_preview.false_positives[0].sample_id, "fp-a");
  assert.equal(file.rescue_combined_preview.invalid_labels[0].sample_id, "invalid-a");
  assert.deepEqual(file.rescue_combined_preview.safety, {
    db_writes: false,
    memory_file_mutation: false,
    unarchive: false,
    category_update: false,
    delete: false,
    quarantine: false,
    reinforce: false,
    llm: false,
    network: false,
  });
}));

test("reports service adds review_queue_preview for rescue queue JSONL via pure mapping", withTempReports(({ reportsDir }) => {
  const rows = [
    {
      schema_version: 1,
      queue_type: "archived_raw_log_rescue_manual_review",
      queue_priority: 1,
      review_reasons: ["positive_negative_conflict"],
      sample_id: "queue-a",
      memory_id: "mem-a",
      chunk_id: "chunk-a",
      primary_bucket: "archived_raw_log_project",
      is_archived: true,
      risk_signals: ["raw_log_leak", "conflict"],
      score: 77,
      boundary_distance: 1,
      raw_predicted_keep_active: "yes",
      predicted_keep_active: "unsure",
      manual_review_flags: ["positive_negative_conflict"],
      content_preview: "sample a",
    },
    {
      schema_version: 1,
      queue_type: "archived_raw_log_rescue_manual_review",
      queue_priority: 2,
      review_reasons: ["near_boundary"],
      sample_id: "queue-b",
      memory_id: "mem-b",
      chunk_id: "chunk-b",
      primary_bucket: "archived_raw_log_project",
      is_archived: true,
      risk_signals: ["raw_log_leak"],
      score: 71,
      boundary_distance: 2,
      raw_predicted_keep_active: "no",
      predicted_keep_active: "no",
      manual_review_flags: [],
      content_missing_reason: "redacted",
      content_preview: "sample b",
    },
    {
      schema_version: 1,
      queue_type: "archived_raw_log_rescue_manual_review",
      queue_priority: 3,
      review_reasons: ["near_boundary"],
      sample_id: "queue-b",
      memory_id: "mem-b2",
      chunk_id: "chunk-b2",
      primary_bucket: "archived_raw_log_preference",
      is_archived: false,
      risk_signals: [],
      score: 70,
      boundary_distance: 3,
      raw_predicted_keep_active: "unsure",
      predicted_keep_active: "unsure",
      manual_review_flags: ["near_boundary"],
      content_preview: "sample duplicate",
    },
  ];
  writeReport(reportsDir, "archived-raw-log-rescue-manual-review-queue-p7-20260704.jsonl", `${rows.map(row => JSON.stringify(row)).join("\n")}\n`, Date.UTC(2026, 6, 4, 13, 0, 0));

  const file = readReportFile("archived-raw-log-rescue-manual-review-queue-p7-20260704.jsonl");
  assert.equal(file.kind, "archived_raw_log_rescue_review_queue");
  assert.equal(file.review_queue_preview.summary.mode, "read_only_review_queue_preview");
  assert.equal(file.review_queue_preview.summary.total_rows, 3);
  assert.equal(file.review_queue_preview.summary.unique_sample_ids, 2);
  assert.equal(file.review_queue_preview.summary.duplicate_sample_ids, 1);
  assert.equal(file.review_queue_preview.summary.min_queue_priority, 1);
  assert.equal(file.review_queue_preview.summary.max_queue_priority, 3);
  assert.equal(file.review_queue_preview.summary.archived_count, 2);
  assert.equal(file.review_queue_preview.summary.content_missing_count, 1);
  assert.deepEqual(file.review_queue_preview.distributions.review_reason_distribution, [
    { label: "near_boundary", count: 2 },
    { label: "positive_negative_conflict", count: 1 },
  ]);
  assert.deepEqual(file.review_queue_preview.distributions.predicted_keep_active_distribution, [
    { label: "unsure", count: 2 },
    { label: "no", count: 1 },
  ]);
  assert.deepEqual(file.review_queue_preview.duplicate_sample_ids, ["queue-b"]);
  assert.deepEqual(file.review_queue_preview.queue_samples.map(sample => sample.sample_id), ["queue-a", "queue-b", "queue-b"]);
  assert.deepEqual(file.review_queue_preview.safety, {
    db_writes: false,
    memory_file_mutation: false,
    unarchive: false,
    category_update: false,
    delete: false,
    quarantine: false,
    reinforce: false,
    llm: false,
    network: false,
  });
}));

test("reports service adds annotation_local_qc_preview for local QC reports via pure mapping", withTempReports(({ reportsDir }) => {
  writeReport(reportsDir, "annotation-local-qc-report-2026-07-04T13-00-00.000Z.json", JSON.stringify({
    mode: "annotation_local_qc_report",
    schema_version: 1,
    generated_at: "2026-07-04T13:00:00.000Z",
    summary: {
      total_candidates: 50,
      unique_candidate_sample_ids: 50,
      duplicate_candidate_sample_ids: 0,
      labeled_count: 37,
      unlabeled_count: 13,
      coverage_rate: 0.74,
      candidate_bucket_distribution: { archived_raw_log_project: 50 },
      queue_reason_distribution: { positive_negative_conflict: 40, near_decision_boundary: 10 },
      quality_distribution: { usable: 20, good: 10, low_quality: 7 },
      keep_active_distribution: { yes: 12, no: 20, unsure: 5 },
      preferred_action_distribution: { keep: 18, archive: 12, delete: 7 },
      target_category_distribution: { project: 24, raw_log: 13 },
      rescue_confidence_distribution: { high: 8, medium: 20, low: 9 },
      last_label_import: {
        imported: 37,
        parse_invalid: 1,
        skipped_not_in_candidates: 2,
        skipped_identity_mismatch: 3,
        skipped_empty: 4,
      },
    },
    duplicate_candidate_sample_ids: ["dup-a", "dup-b"],
    unlabeled_samples: [
      { sample_id: "sample-a", primary_bucket: "archived_raw_log_project", queue_priority: 1, review_reasons: ["positive_negative_conflict"] },
      { sample_id: "sample-b", primary_bucket: "archived_raw_log_project", queue_priority: 2, review_reasons: ["near_decision_boundary"] },
    ],
  }, null, 2), Date.UTC(2026, 6, 4, 13, 0, 0));

  const file = readReportFile("annotation-local-qc-report-2026-07-04T13-00-00.000Z.json");
  assert.equal(file.kind, "annotation_local_qc_report");
  assert.equal(file.annotation_local_qc_preview.summary.mode, "read_only_annotation_local_qc_preview");
  assert.equal(file.annotation_local_qc_preview.summary.total_candidates, 50);
  assert.equal(file.annotation_local_qc_preview.summary.labeled_count, 37);
  assert.equal(file.annotation_local_qc_preview.summary.unlabeled_count, 13);
  assert.equal(file.annotation_local_qc_preview.summary.coverage_rate, 0.74);
  assert.deepEqual(file.annotation_local_qc_preview.summary.last_label_import, {
    imported: 37,
    parse_invalid: 1,
    skipped_not_in_candidates: 2,
    skipped_identity_mismatch: 3,
    skipped_empty: 4,
  });
  assert.deepEqual(file.annotation_local_qc_preview.distributions.queue_reason_distribution, [
    { label: "positive_negative_conflict", count: 40 },
    { label: "near_decision_boundary", count: 10 },
  ]);
  assert.deepEqual(file.annotation_local_qc_preview.unlabeled_samples.map(sample => sample.sample_id), ["sample-a", "sample-b"]);
  assert.deepEqual(file.annotation_local_qc_preview.duplicate_candidate_sample_ids, ["dup-a", "dup-b"]);
  assert.deepEqual(file.annotation_local_qc_preview.safety, {
    db_writes: false,
    memory_file_mutation: false,
    upload: false,
    apply: false,
    archive: false,
    delete: false,
    quarantine: false,
    reinforce: false,
    llm: false,
    network: false,
  });
}));

test("reports service adds review_queue_label_preview for rescue label reports via pure mapping", withTempReports(({ reportsDir }) => {
  writeReport(reportsDir, "archived-raw-log-rescue-review-queue-label-report-p8-preflight-20260704.json", JSON.stringify({
    mode: "archived_raw_log_rescue_review_queue_label_report",
    write_db: false,
    memory_side_effects: false,
    reinforcement_side_effects: false,
    safety: {
      db_writes: false,
      unarchive: false,
      category_update: false,
      delete: false,
      quarantine: false,
      reinforce: false,
    },
    summary: {
      queue_total: 50,
      queue_valid: 50,
      queue_unique_sample_ids: 50,
      queue_invalid: 1,
      queue_duplicate_sample_ids: 2,
      labels_total: 38,
      labels_valid_aligned: 37,
      labels_invalid: 3,
      labels_not_in_queue: 4,
      labels_identity_mismatch: 5,
      labels_duplicate_sample_ids: 6,
      queue_unlabeled: 13,
      coverage_rate: 0.74,
      queue_reason_distribution: { positive_negative_conflict: 40, near_decision_boundary: 10 },
      queue_bucket_distribution: { archived_raw_log_project: 50 },
      quality_distribution: { usable: 20, low_quality: 17 },
      keep_active_distribution: { yes: 11, no: 20, unsure: 6 },
      preferred_action_distribution: { keep: 19, archive: 18 },
      target_category_distribution: { project: 24, raw_log: 13 },
      rescue_confidence_distribution: { high: 9, medium: 18, low: 10 },
    },
    queue_errors: [{ line_number: 1, sample_id: "bad-queue", errors: ["queue_type"] }],
    invalid_labels: [{ line_number: 2, sample_id: "bad-label", errors: ["annotation.reason"] }],
    labels_not_in_queue: [{ line_number: 3, sample_id: "foreign-label" }],
    identity_mismatch_labels: [{ line_number: 4, sample_id: "mismatch-label", mismatches: ["memory_id"] }],
    duplicate_queue_sample_ids: ["dup-queue"],
    duplicate_label_sample_ids: ["dup-label"],
    unlabeled_queue_samples: [
      { queue_priority: 1, sample_id: "unlabeled-a", primary_bucket: "archived_raw_log_project", review_reasons: ["positive_negative_conflict"] },
    ],
    valid_labels: [
      { sample_id: "valid-a", queue_priority: 2, keep_active: "yes", preferred_action: "keep", target_category: "project", rescue_confidence: "high", reason: "valid" },
    ],
  }, null, 2), Date.UTC(2026, 6, 4, 13, 0, 0));

  const file = readReportFile("archived-raw-log-rescue-review-queue-label-report-p8-preflight-20260704.json");
  assert.equal(file.kind, "archived_raw_log_rescue_review_queue_label_report");
  assert.equal(file.review_queue_label_preview.summary.mode, "read_only_review_queue_label_preview");
  assert.equal(file.review_queue_label_preview.summary.queue_unique_sample_ids, 50);
  assert.equal(file.review_queue_label_preview.summary.labels_valid_aligned, 37);
  assert.equal(file.review_queue_label_preview.summary.queue_unlabeled, 13);
  assert.equal(file.review_queue_label_preview.summary.coverage_rate, 0.74);
  assert.deepEqual(file.review_queue_label_preview.distributions.queue_reason_distribution, [
    { label: "positive_negative_conflict", count: 40 },
    { label: "near_decision_boundary", count: 10 },
  ]);
  assert.deepEqual(file.review_queue_label_preview.blockers.queue_errors[0], { line_number: 1, sample_id: "bad-queue", errors: ["queue_type"] });
  assert.deepEqual(file.review_queue_label_preview.blockers.duplicate_queue_sample_ids, ["dup-queue"]);
  assert.equal(file.review_queue_label_preview.unlabeled_queue_samples[0].sample_id, "unlabeled-a");
  assert.equal(file.review_queue_label_preview.valid_labels[0].sample_id, "valid-a");
  assert.deepEqual(file.review_queue_label_preview.safety, {
    db_writes: false,
    memory_file_mutation: false,
    unarchive: false,
    category_update: false,
    delete: false,
    quarantine: false,
    reinforce: false,
    llm: false,
    network: false,
  });
}));

test("reports service adds decision_trace for autoRecall long-input json reports via pure mapping", withTempReports(({ reportsDir }) => {
  writeReport(reportsDir, "auto-recall-long-input-smoke-20260701-101010.json", JSON.stringify({
    summary: { status: "pass" },
    checks: [
      {
        id: "long_debug_with_history_uses_focused_query",
        details: {
          should_recall: true,
          intent_reason: "long_input_with_history_context_use_focused_query",
          long_input_detected: true,
          generic_task_detected: false,
          explicit_history_context: true,
          focused_query: "结合之前上下文 | memory-engine | focused query",
        },
      },
    ],
  }, null, 2), Date.UTC(2026, 6, 1, 10, 10, 10));

  const file = readReportFile("auto-recall-long-input-smoke-20260701-101010.json");
  assert.equal(file.kind, "auto_recall_long_input_smoke");
  assert.deepEqual(file.decision_trace, {
    long_input_detected: true,
    generic_task_detected: false,
    explicit_history_context: true,
    should_recall: true,
    intent_reason: "long_input_with_history_context_use_focused_query",
    focused_query: "结合之前上下文 | memory-engine | focused query",
  });
}));

test("reports service allows bucket-slug, rescue queue, and rescue label report filenames", withTempReports(({ reportsDir }) => {
  writeReport(reportsDir, "annotation-candidates-dreaming_duplicate-20260628-022727.jsonl", "{\"sample\":1}\n", Date.UTC(2026, 5, 28, 2, 27, 27));
  writeReport(reportsDir, "annotation-candidates-dreaming_duplicate-dreaming_maintenance_log-dreaming_candidate_staging-20260628-022727.md", "# sample", Date.UTC(2026, 5, 28, 2, 27, 28));
  writeReport(reportsDir, "annotation-candidates-dreaming_duplicate-20260628.jsonl", "{\"legacy\":1}\n", Date.UTC(2026, 5, 28, 2, 27, 29));
  writeReport(reportsDir, "archived-raw-log-rescue-combined-report-p2-p4-20260703.md", "# combined", Date.UTC(2026, 6, 3, 1, 0, 0));
  writeReport(reportsDir, "archived-raw-log-rescue-manual-review-queue-p7-20260704.jsonl", "{\"sample_id\":\"rescue:a\"}\n", Date.UTC(2026, 6, 4, 1, 0, 0));
  writeReport(reportsDir, "archived-raw-log-rescue-manual-review-queue-p7-20260704.md", "# queue", Date.UTC(2026, 6, 4, 1, 0, 1));
  writeReport(reportsDir, "archived-raw-log-rescue-review-queue-label-report-p8-preflight-20260704.json", "{\"ok\":true}", Date.UTC(2026, 6, 4, 1, 0, 2));
  writeReport(reportsDir, "annotation-local-qc-report-2026-07-04T12-34-56.789Z.json", "{\"mode\":\"annotation_local_qc_report\"}", Date.UTC(2026, 6, 4, 1, 0, 3));

  const names = listReports().map(file => file.name);
  assert.deepEqual(names, [
    "annotation-local-qc-report-2026-07-04T12-34-56.789Z.json",
    "archived-raw-log-rescue-review-queue-label-report-p8-preflight-20260704.json",
    "archived-raw-log-rescue-manual-review-queue-p7-20260704.md",
    "archived-raw-log-rescue-manual-review-queue-p7-20260704.jsonl",
    "archived-raw-log-rescue-combined-report-p2-p4-20260703.md",
    "annotation-candidates-dreaming_duplicate-20260628.jsonl",
    "annotation-candidates-dreaming_duplicate-dreaming_maintenance_log-dreaming_candidate_staging-20260628-022727.md",
    "annotation-candidates-dreaming_duplicate-20260628-022727.jsonl",
  ]);
  assert.equal(getAllowedReportKind("annotation-candidates-dreaming_duplicate-20260628-022727.jsonl"), "annotation_candidates");
  assert.equal(getAllowedReportKind("annotation-candidates-dreaming_duplicate-dreaming_maintenance_log-dreaming_candidate_staging-20260628-022727.md"), "annotation_candidates");
  assert.equal(getAllowedReportKind("annotation-candidates-dreaming_duplicate-20260628.jsonl"), "annotation_candidates");
  assert.equal(getAllowedReportKind("archived-raw-log-rescue-combined-report-p2-p4-20260703.md"), "archived_raw_log_rescue_combined_report");
  assert.equal(getAllowedReportKind("archived-raw-log-rescue-manual-review-queue-p7-20260704.jsonl"), "archived_raw_log_rescue_review_queue");
  assert.equal(getAllowedReportKind("archived-raw-log-rescue-review-queue-label-report-p8-preflight-20260704.json"), "archived_raw_log_rescue_review_queue_label_report");
  assert.equal(getAllowedReportKind("annotation-local-qc-report-2026-07-04T12-34-56.789Z.json"), "annotation_local_qc_report");
}));

test("reports latest helper tracks browser-local annotation QC reports", withTempReports(({ reportsDir }) => {
  writeReport(reportsDir, "annotation-local-qc-report-2026-07-04T12-34-56.789Z.json", "{\"old\":true}", Date.UTC(2026, 6, 4, 12, 34, 56));
  writeReport(reportsDir, "annotation-local-qc-report-2026-07-04T13-00-00.000Z.json", "{\"new\":true}", Date.UTC(2026, 6, 4, 13, 0, 0));

  const latest = latestReports();
  assert.equal(latest.annotation_local_qc_report?.name, "annotation-local-qc-report-2026-07-04T13-00-00.000Z.json");
  const file = readReportFile("annotation-local-qc-report-2026-07-04T13-00-00.000Z.json");
  assert.equal(file.kind, "annotation_local_qc_report");
  assert.equal(file.format, "json");
  assert.equal(file.content, "{\"new\":true}");
}));

test("reports latest helper tracks archived raw-log rescue review queue reports", withTempReports(({ reportsDir }) => {
  writeReport(reportsDir, "archived-raw-log-rescue-manual-review-queue-p7-20260704.jsonl", "{\"queue_type\":\"archived_raw_log_rescue_manual_review\",\"sample_id\":\"old\"}\n", Date.UTC(2026, 6, 4, 12, 0, 0));
  writeReport(reportsDir, "archived-raw-log-rescue-manual-review-queue-p8-20260705.jsonl", "{\"queue_type\":\"archived_raw_log_rescue_manual_review\",\"sample_id\":\"new\"}\n", Date.UTC(2026, 6, 5, 12, 0, 0));
  writeReport(reportsDir, "archived-raw-log-rescue-manual-review-queue-p8-20260705.md", "# queue", Date.UTC(2026, 6, 5, 12, 0, 1));

  const latest = latestReports();
  assert.equal(latest.archived_raw_log_rescue_review_queue?.name, "archived-raw-log-rescue-manual-review-queue-p8-20260705.jsonl");
  const file = readReportFile("archived-raw-log-rescue-manual-review-queue-p8-20260705.jsonl");
  assert.equal(file.kind, "archived_raw_log_rescue_review_queue");
  assert.equal(file.format, "jsonl");
  assert.equal(file.review_queue_preview.summary.total_rows, 1);
}));

test("reports latest helper prefers structured rescue preview formats over newer markdown", withTempReports(({ reportsDir }) => {
  writeReport(reportsDir, "archived-raw-log-rescue-combined-report-p2-p4-20260703.json", "{\"mode\":\"archived_raw_log_rescue_combined_label_report\"}", Date.UTC(2026, 6, 3, 12, 0, 0));
  writeReport(reportsDir, "archived-raw-log-rescue-combined-report-p2-p4-20260703.md", "# combined", Date.UTC(2026, 6, 3, 12, 0, 1));
  writeReport(reportsDir, "archived-raw-log-rescue-review-queue-label-report-p8-preflight-20260704.json", "{\"mode\":\"archived_raw_log_rescue_review_queue_label_report\"}", Date.UTC(2026, 6, 4, 12, 0, 0));
  writeReport(reportsDir, "archived-raw-log-rescue-review-queue-label-report-p8-preflight-20260704.md", "# labels", Date.UTC(2026, 6, 4, 12, 0, 1));

  const latest = latestReports();
  assert.equal(latest.archived_raw_log_rescue_combined_report?.name, "archived-raw-log-rescue-combined-report-p2-p4-20260703.json");
  assert.equal(latest.archived_raw_log_rescue_review_queue_label_report?.name, "archived-raw-log-rescue-review-queue-label-report-p8-preflight-20260704.json");
}));

test("annotations snapshot excludes local QC reports from candidate and label lists", withTempReports(({ reportsDir }) => {
  writeReport(reportsDir, "annotation-candidates-20260628-022727.jsonl", "{\"sample\":1}\n", Date.UTC(2026, 5, 28, 2, 27, 27));
  writeReport(reportsDir, "annotation-labels-20260704-p7.jsonl", "{\"sample_id\":\"rescue:a\"}\n", Date.UTC(2026, 6, 4, 1, 0, 0));
  writeReport(reportsDir, "annotation-local-qc-report-2026-07-04T12-34-56.789Z.json", "{\"mode\":\"annotation_local_qc_report\"}", Date.UTC(2026, 6, 4, 1, 0, 1));

  const snapshot = annotationReportsSnapshot();
  assert.deepEqual(snapshot.available_candidates.map(file => file.name), ["annotation-candidates-20260628-022727.jsonl"]);
  assert.deepEqual(snapshot.available_labels.map(file => file.name), ["annotation-labels-20260704-p7.jsonl"]);
}));

test("annotations snapshot lists rescue review queue JSONL as loadable candidate", withTempReports(({ reportsDir }) => {
  writeReport(reportsDir, "annotation-candidates-20260628-022727.jsonl", "{\"sample\":1}\n", Date.UTC(2026, 5, 28, 2, 27, 27));
  writeReport(reportsDir, "archived-raw-log-rescue-manual-review-queue-p7-20260704.jsonl", "{\"sample_id\":\"rescue:a\"}\n", Date.UTC(2026, 6, 4, 1, 0, 0));
  writeReport(reportsDir, "archived-raw-log-rescue-manual-review-queue-p7-20260704.md", "# queue", Date.UTC(2026, 6, 4, 1, 0, 1));
  writeReport(reportsDir, "archived-raw-log-rescue-review-queue-label-report-p8-preflight-20260704.json", "{\"ok\":true}", Date.UTC(2026, 6, 4, 1, 0, 2));

  const snapshot = annotationReportsSnapshot();
  assert.deepEqual(snapshot.available_candidates.map(file => file.name), [
    "archived-raw-log-rescue-manual-review-queue-p7-20260704.jsonl",
    "annotation-candidates-20260628-022727.jsonl",
  ]);
  assert.equal(snapshot.available_candidates.every(file => file.name.endsWith(".jsonl")), true);
  assert.equal(snapshot.available_labels.length, 0);
}));

test("reports latest helper returns null for missing families", withTempReports(() => {
  const latest = latestReports();
  assert.equal(latest.annotation_summary, null);
  assert.equal(latest.annotation_eligibility_preview, null);
  assert.equal(latest.annotation_local_qc_report, null);
  assert.equal(latest.archived_raw_log_rescue_combined_report, null);
  assert.equal(latest.archived_raw_log_rescue_review_queue, null);
  assert.equal(latest.archived_raw_log_rescue_review_queue_label_report, null);
  assert.equal(latest.auto_recall_safety_smoke, null);
  assert.equal(latest.auto_recall_turn_gold_set_replay, null);
}));
