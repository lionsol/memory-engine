import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PACKAGE_JSON = new URL("../package.json", import.meta.url);

function packageJson() {
  return JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));
}

test("package exposes Console annotation handoff smoke script", () => {
  const pkg = packageJson();
  const script = pkg.scripts?.["smoke:console-annotation-handoff"] || "";
  assert.equal(typeof script, "string");
  assert.match(script, /^node --test /);
  for (const token of [
    "test/console-reports.test.js",
    "test/console-annotations.test.js",
    "test/console-annotation-report-handoff-doc.test.js",
    "test/human-annotation-workflow-doc.test.js",
    "test/readme-console-annotation-workflow.test.js",
    "test/smoke-tests-index-doc.test.js",
    "test/report-archived-raw-log-rescue-review-queue-labels.test.js",
    "test/build-archived-raw-log-rescue-review-queue.test.js",
  ]) {
    assert.equal(script.includes(token), true, `missing smoke script token: ${token}`);
  }
});
