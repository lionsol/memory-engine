import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const DOC = new URL("../docs/human-annotation-gold-set.md", import.meta.url);

function readDoc() {
  return readFileSync(DOC, "utf8");
}

test("human annotation workflow points to Console annotations and reports handoff", () => {
  const doc = readDoc();
  for (const token of [
    "Console `/annotations`",
    "Console `/reports`",
    "whitelisted report",
    "browser File API",
    "Open with Latest Labels",
    "/annotations?candidate=<report>&labels=<labels>",
    "browser-local QC JSON",
    "combined / queue / label / QC structured preview",
    "docs/smoke-tests/console-annotation-report-handoff.md",
  ]) {
    assert.equal(doc.includes(token), true, `missing workflow token: ${token}`);
  }
});

test("human annotation workflow preserves GUI read-only safety boundaries", () => {
  const doc = readDoc();
  for (const token of [
    "server 侧只允许读取 whitelisted reports",
    "不上传 labels",
    "不写 DB",
    "不修改 memory",
    "不执行 apply / unarchive / category update / delete / quarantine / reinforce",
  ]) {
    assert.equal(doc.includes(token), true, `missing safety token: ${token}`);
  }
});
