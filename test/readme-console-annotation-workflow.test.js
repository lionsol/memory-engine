import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const README = new URL("../README.md", import.meta.url);

function readReadme() {
  return readFileSync(README, "utf8");
}

test("README links the Console annotation workflow docs", () => {
  const readme = readReadme();
  for (const token of [
    "## Console Annotation Workflow",
    "docs/human-annotation-gold-set.md",
    "docs/smoke-tests/console-annotation-report-handoff.md",
    "/reports` ↔ `/annotations` GUI handoff smoke runbook",
    "npm run smoke:console-annotation-handoff",
  ]) {
    assert.equal(readme.includes(token), true, `missing README workflow token: ${token}`);
  }
});

test("README states Console annotation safety boundaries", () => {
  const readme = readReadme();
  for (const token of [
    "只读取 whitelisted reports",
    "不上传 labels",
    "不写 DB",
    "不执行 apply / unarchive / category update / delete / quarantine / reinforce",
  ]) {
    assert.equal(readme.includes(token), true, `missing README safety token: ${token}`);
  }
});
