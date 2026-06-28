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
  assert.equal(page.includes("browser File API only"), true);
  assert.equal(page.includes("does not upload labels"), true);
  assert.equal(page.includes("does not write DB"), true);
});
