import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const SMOKE_DOC = new URL("../docs/smoke-tests/console-annotation-report-handoff.md", import.meta.url);
const REPORTS_VIEW = new URL("../console/views/reports.ejs", import.meta.url);
const ANNOTATIONS_VIEW = new URL("../console/views/annotations.ejs", import.meta.url);
const CHARTS = new URL("../console/public/charts.js", import.meta.url);

function read(url) {
  return readFileSync(url, "utf8");
}

test("console annotation/report handoff smoke doc exists", () => {
  assert.equal(existsSync(SMOKE_DOC), true);
});

test("handoff smoke doc covers read-only safety boundaries", () => {
  const doc = read(SMOKE_DOC);
  for (const token of [
    "read-only",
    "upload labels to the server",
    "write DB",
    "mutate memory files",
    "apply lifecycle actions",
    "unarchive records",
    "update categories",
    "delete records",
    "quarantine records",
    "reinforce memories",
    "call an LLM",
    "/api/reports/file?name=<report>",
  ]) {
    assert.equal(doc.includes(token), true, `missing safety token: ${token}`);
  }
});

test("handoff smoke doc covers report preview families and structured latest preference", () => {
  const doc = read(SMOKE_DOC);
  for (const token of [
    "annotation_candidates",
    "annotation_labels",
    "annotation_local_qc_report",
    "archived_raw_log_rescue_combined_report",
    "archived_raw_log_rescue_review_queue",
    "archived_raw_log_rescue_review_queue_label_report",
    "auto_recall_turn_gold_set_replay",
    "combined rescue report: `.json`",
    "manual review queue: `.jsonl`",
    "review queue label report: `.json`",
  ]) {
    assert.equal(doc.includes(token), true, `missing report family token: ${token}`);
  }
});

test("handoff smoke doc covers GUI handoff and deep link steps", () => {
  const doc = read(SMOKE_DOC);
  for (const token of [
    "latest cards render and are clickable",
    "Open in Annotations",
    "Open with Latest Labels",
    "Current Deep Link",
    "Copy Link",
    "Export labels JSONL",
    "Export browser-local QC JSON",
    "/annotations?candidate=<candidate-or-queue.jsonl>",
    "/annotations?candidate=<candidate-or-queue.jsonl>&labels=<labels.jsonl>",
    "/annotations?candidate_report=<candidate-or-queue.jsonl>&label_report=<labels.jsonl>",
    "candidate load failure stops labels import",
    "local browser files do not generate server deep links",
  ]) {
    assert.equal(doc.includes(token), true, `missing handoff token: ${token}`);
  }
});

test("implementation still exposes documented report and annotation handoff hooks", () => {
  const combined = `${read(REPORTS_VIEW)}\n${read(ANNOTATIONS_VIEW)}\n${read(CHARTS)}`;
  for (const token of [
    "reportLatestCards",
    "data-report-latest-name",
    "annotationDeepLinkForReport",
    "Open in Annotations",
    "Open with Latest Labels",
    "autoLoadReportsFromQuery",
    "annotationDeepLink",
    "annotationCopyDeepLinkButton",
    "navigator.clipboard.writeText",
    "review_queue_preview",
    "review_queue_label_preview",
    "annotation_local_qc_preview",
    "rescue_combined_preview",
  ]) {
    assert.equal(combined.includes(token), true, `missing implementation token: ${token}`);
  }
});

test("handoff smoke doc keeps lifecycle labels advisory only", () => {
  const doc = read(SMOKE_DOC);
  for (const token of [
    "QC reports do not authorize deletion",
    "Label reports do not authorize unarchive",
    "preferred_action` is advisory only",
    "auto_recall_eligible` labels do not directly change runtime recall gates",
    "Manual review remains required before any lifecycle action",
  ]) {
    assert.equal(doc.includes(token), true, `missing non-goal token: ${token}`);
  }
});
