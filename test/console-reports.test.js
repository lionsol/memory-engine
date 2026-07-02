import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";

import {
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

test("reports service allows bucket-slug and multi-bucket annotation candidate filenames", withTempReports(({ reportsDir }) => {
  writeReport(reportsDir, "annotation-candidates-dreaming_duplicate-20260628-022727.jsonl", "{\"sample\":1}\n", Date.UTC(2026, 5, 28, 2, 27, 27));
  writeReport(reportsDir, "annotation-candidates-dreaming_duplicate-dreaming_maintenance_log-dreaming_candidate_staging-20260628-022727.md", "# sample", Date.UTC(2026, 5, 28, 2, 27, 28));
  writeReport(reportsDir, "annotation-candidates-dreaming_duplicate-20260628.jsonl", "{\"legacy\":1}\n", Date.UTC(2026, 5, 28, 2, 27, 29));

  const names = listReports().map(file => file.name);
  assert.deepEqual(names, [
    "annotation-candidates-dreaming_duplicate-20260628.jsonl",
    "annotation-candidates-dreaming_duplicate-dreaming_maintenance_log-dreaming_candidate_staging-20260628-022727.md",
    "annotation-candidates-dreaming_duplicate-20260628-022727.jsonl",
  ]);
  assert.equal(getAllowedReportKind("annotation-candidates-dreaming_duplicate-20260628-022727.jsonl"), "annotation_candidates");
  assert.equal(getAllowedReportKind("annotation-candidates-dreaming_duplicate-dreaming_maintenance_log-dreaming_candidate_staging-20260628-022727.md"), "annotation_candidates");
  assert.equal(getAllowedReportKind("annotation-candidates-dreaming_duplicate-20260628.jsonl"), "annotation_candidates");
}));

test("reports latest helper returns null for missing families", withTempReports(() => {
  const latest = latestReports();
  assert.equal(latest.annotation_summary, null);
  assert.equal(latest.annotation_eligibility_preview, null);
  assert.equal(latest.auto_recall_safety_smoke, null);
  assert.equal(latest.auto_recall_turn_gold_set_replay, null);
}));
