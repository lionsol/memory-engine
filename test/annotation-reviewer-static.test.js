import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PAGE_PATH = resolve(process.cwd(), "tools/annotation-reviewer.html");
const DOC_PATH = resolve(process.cwd(), "docs/human-annotation-gold-set.md");

test("annotation reviewer page contains required fields and allowed enums", () => {
  const html = readFileSync(PAGE_PATH, "utf8");

  for (const token of [
    "sample_id",
    "memory_id",
    "chunk_id",
    "primary_bucket",
    "sample_buckets",
    "source_path",
    "risk_score",
    "content_preview",
    "quality",
    "currency",
    "auto_recall_eligible",
    "preferred_action",
    "reason",
  ]) {
    assert.equal(html.includes(token), true, `missing token: ${token}`);
  }

  for (const value of [
    "good", "usable", "low_quality", "polluted",
    "current", "superseded", "unknown",
    "yes", "no", "unsure",
    "keep", "demote", "quarantine", "archive", "delete",
  ]) {
    assert.equal(html.includes(`value="${value}"`), true, `missing enum value: ${value}`);
  }
});

test("annotation reviewer page stays local-only and contains no DB-write code path", () => {
  const html = readFileSync(PAGE_PATH, "utf8");

  for (const forbidden of [
    "fetch(",
    "XMLHttpRequest",
    "WebSocket",
    "indexedDB",
    "openDatabase",
    "INSERT ",
    "UPDATE ",
    "DELETE ",
    "/api/",
    "http://",
    "https://",
  ]) {
    assert.equal(html.includes(forbidden), false, `forbidden pattern present: ${forbidden}`);
  }

  assert.equal(html.includes('type="file"'), true);
  assert.equal(html.includes("file.text()"), true);
});

test("human annotation docs mention standalone reviewer usage and safety boundaries", () => {
  const doc = readFileSync(DOC_PATH, "utf8");
  assert.equal(doc.includes("tools/annotation-reviewer.html"), true);
  assert.equal(doc.includes("通过页面内的 File API 选择本地"), true);
  assert.equal(doc.includes("不访问 DB"), true);
  assert.equal(doc.includes("不写 DB"), true);
  assert.equal(doc.includes("不调用 API"), true);
});
