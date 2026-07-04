import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("console server exposes annotations page route", () => {
  const source = readFileSync(new URL("../console/server.js", import.meta.url), "utf8");
  assert.equal(source.includes('pathname === "/annotations"'), true);
  assert.equal(source.includes('view: "annotations"'), true);
});

test("console layout nav includes Annotations entry", () => {
  const layout = readFileSync(new URL("../console/views/layout.ejs", import.meta.url), "utf8");
  assert.equal(layout.includes('href="/annotations"'), true);
  assert.equal(layout.includes(">Annotations<"), true);
});

test("console annotations page contains File API loader and export labels flow", () => {
  const page = readFileSync(new URL("../console/views/annotations.ejs", import.meta.url), "utf8");
  for (const token of [
    'type="file"',
    "Load candidate JSONL",
    "sample_id",
    "memory_id",
    "chunk_id",
    "primary_bucket",
    "sample_buckets",
    "source_path",
    "risk_score",
    "content_preview",
    "Export Labels JSONL",
    "file.text()",
    "Blob([rows.join",
    "annotation-labels-",
  ]) {
    assert.equal(page.includes(token), true, `missing token: ${token}`);
  }
});

test("console annotations page resets stale filters after loading a new file", () => {
  const page = readFileSync(new URL("../console/views/annotations.ejs", import.meta.url), "utf8");
  for (const token of [
    "annotationClearFiltersButton",
    "Filters: none",
    "function clearFilters()",
    "els.bucketFilter.value = \"\";",
    "els.pathPrefixFilter.value = \"\";",
    "els.unlabeledOnly.checked = false;",
    "els.labelFile.value = \"\";",
    "No labels loaded",
    "clearFilters();",
  ]) {
    assert.equal(page.includes(token), true, `missing filter reset token: ${token}`);
  }
});

test("console annotations page can import existing labels locally to resume review", () => {
  const page = readFileSync(new URL("../console/views/annotations.ejs", import.meta.url), "utf8");
  for (const token of [
    "annotationLabelFile",
    "Load labels JSONL to resume",
    "annotationLabelImportStatus",
    "parseLabelJsonl",
    "normalizeAnnotation",
    "labelMatchesSampleIdentity",
    "importLabelsFromText",
    "skippedNotInCandidates",
    "skippedIdentityMismatch",
    "lastLabelImportSummary",
    "Load candidate JSONL before loading labels.",
    "Imported ${imported} label(s)",
  ]) {
    assert.equal(page.includes(token), true, `missing label import token: ${token}`);
  }
});

test("console annotations page can load whitelisted candidate reports through read-only reports API", () => {
  const page = readFileSync(new URL("../console/views/annotations.ejs", import.meta.url), "utf8");
  for (const token of [
    "annotationCandidateLoadStatus",
    "No server report loaded",
    "read-only server API",
    "button.dataset.reportName",
    "loadCandidateReportFromServer",
    "resetCandidateSamplesFromText",
    "/api/reports/file?name=",
    "encodeURIComponent(reportName)",
    "payload?.format !== \"jsonl\"",
    "Only JSONL candidate reports can be loaded here.",
    "Failed to load ${reportName}",
    "Loaded ${state.samples.length} sample(s) from ${sourceLabel}",
  ]) {
    assert.equal(page.includes(token), true, `missing server candidate load token: ${token}`);
  }
});

test("console annotations page can load whitelisted label reports after candidates", () => {
  const page = readFileSync(new URL("../console/views/annotations.ejs", import.meta.url), "utf8");
  for (const token of [
    "Available Label Reports",
    "annotationAvailableLabels",
    "annotationLabelReportLoadStatus",
    "No server label report loaded",
    "renderAvailableLabels",
    "button.dataset.labelReportName",
    "loadLabelReportFromServer",
    "Load candidate JSONL before loading server labels.",
    "Only JSONL label reports can be loaded here.",
    "Loaded labels from ${reportName}",
    "Failed to load ${reportName}",
    "renderReportList",
  ]) {
    assert.equal(page.includes(token), true, `missing server label load token: ${token}`);
  }
});

test("console annotations page can auto-load candidate and label reports from query params", () => {
  const page = readFileSync(new URL("../console/views/annotations.ejs", import.meta.url), "utf8");
  for (const token of [
    "autoLoadReportsFromQuery",
    "new URLSearchParams(window.location.search || \"\")",
    "params.get(\"candidate\")",
    "params.get(\"candidate_report\")",
    "params.get(\"labels\")",
    "params.get(\"label_report\")",
    "Auto-load query detected",
    "const loadedCandidate = await loadCandidateReportFromServer(candidate)",
    "if (!loadedCandidate) return",
    "await loadLabelReportFromServer(labels)",
    "autoLoadReportsFromQuery();",
    "return true",
    "return false",
  ]) {
    assert.equal(page.includes(token), true, `missing query auto-load token: ${token}`);
  }
});

test("console annotations page exports a browser-local QC report", () => {
  const page = readFileSync(new URL("../console/views/annotations.ejs", import.meta.url), "utf8");
  for (const token of [
    "annotationExportReportButton",
    "Export QC Report JSON",
    "annotation_local_qc_report",
    "browser_local_only",
    "buildLocalQcReport",
    "downloadJson",
    "coverage_rate",
    "candidate_bucket_distribution",
    "queue_reason_distribution",
    "keep_active_distribution",
    "preferred_action_distribution",
    "target_category_distribution",
    "rescue_confidence_distribution",
    "unlabeled_samples",
    "annotation-local-qc-report-",
  ]) {
    assert.equal(page.includes(token), true, `missing local qc report token: ${token}`);
  }
});

test("console annotations page makes filtered bucket views explicit", () => {
  const page = readFileSync(new URL("../console/views/annotations.ejs", import.meta.url), "utf8");
  for (const token of [
    "All buckets (${state.samples.length})",
    "function bucketTotals()",
    "filtered (${state.samples.length} total)",
    "filtered view",
    "state.currentIndex = 0;",
  ]) {
    assert.equal(page.includes(token), true, `missing filtered-view token: ${token}`);
  }
});

test("console annotations page preserves and displays rescue review queue metadata", () => {
  const page = readFileSync(new URL("../console/views/annotations.ejs", import.meta.url), "utf8");
  for (const token of [
    "annotationReviewQueueCard",
    "Review Queue Metadata",
    "queue_priority",
    "review_reasons",
    "manual_review_flags",
    "risk_signals",
    "scoring_parts",
    "raw_predicted_keep_active",
    "predicted_keep_active",
    "boundary_distance",
    "prior_sampling_reason",
    "renderReviewQueueMetadata",
    "renderPills",
  ]) {
    assert.equal(page.includes(token), true, `missing rescue queue metadata token: ${token}`);
  }
});

test("console annotations page exposes no destructive action entrypoints", () => {
  const page = readFileSync(new URL("../console/views/annotations.ejs", import.meta.url), "utf8");
  for (const forbidden of [
    "data-archive",
    "data-delete",
    'fetch("/api/memories/',
    "data-apply",
    "data-reinforce",
  ]) {
    assert.equal(page.includes(forbidden), false, `forbidden token present: ${forbidden}`);
  }
  assert.equal(page.includes("read-only server API"), true);
  assert.equal(page.includes("does not upload labels"), true);
  assert.equal(page.includes("does not write DB"), true);
});
