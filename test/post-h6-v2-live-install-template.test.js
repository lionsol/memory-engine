import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const template = readFileSync(
  join(process.cwd(), "docs/smoke-tests/post-h6-v2-live-install-template.md"),
  "utf8",
);

test("post-H6 template keeps reviewed bindings and fail-closed boundaries", () => {
  for (const token of [
    "<BASELINE_RELEASE>",
    "<CANDIDATE_RELEASE>",
    "<SOURCE_COMMIT>",
    "<EVIDENCE_ROOT>",
    "candidate install attempt is limited to one",
    "Do not create D0",
    "AutoRecall",
    "H6 canary",
    "Production enablement remains a separate decision",
  ]) {
    assert.equal(template.includes(token), true, `missing template contract: ${token}`);
  }
});

test("post-H6 template contains no personal paths or private identifiers", () => {
  assert.doesNotMatch(template, /\/home\/lionsol|\.openclaw|private-runtime|private-evidence/i);
  assert.doesNotMatch(template, /\b[0-9a-f]{7,40}\b/i);
  assert.doesNotMatch(template, /\b(?:gateway|console)_pid\s*=/i);
  assert.doesNotMatch(template, /plugins doctor|npm\s+(?:install|ci|rebuild)/i);
});
