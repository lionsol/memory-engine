import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const DOC = new URL("../docs/smoke-tests/tool-surface-runtime-access-audit.md", import.meta.url);

function readDoc() {
  return readFileSync(DOC, "utf8");
}

test("tool-surface runtime access audit runbook exists", () => {
  assert.equal(existsSync(DOC), true);
});

test("runbook separates catalog, effective visibility, and real execution", () => {
  const doc = readDoc();
  for (const token of [
    "F1-D-B8-A6.2",
    "tools.catalog",
    "tools.effective",
    "tools.invoke",
    "These claims are not interchangeable",
    "registered but absent from the effective model tool set",
    "does not prove that the model sees",
  ]) {
    assert.equal(doc.includes(token), true, `missing access-audit token: ${token}`);
  }
});

test("runbook preserves search-only and no-policy-widening boundaries", () => {
  const doc = readDoc();
  for (const token of [
    "keeps KG and Recent in `legacy_fallback`",
    "invokes search only",
    "does not call `memory_engine_get`",
    "does not call add, cite, update, archive",
    "Do not switch the global profile to `full`",
    "Prefer no persistent policy change",
    "does not authorize Stage 2 or B8-B",
  ]) {
    assert.equal(doc.includes(token), true, `missing safety token: ${token}`);
  }
});

test("runbook documents Node ABI and coding-profile findings", () => {
  const doc = readDoc();
  for (const token of [
    "#!/usr/bin/env node",
    "process.versions.modules",
    'PATH="$HOME/.local/node24/bin:$PATH"',
    '"profile": "coding"',
    "default non-optional plugin-tool semantics",
  ]) {
    assert.equal(doc.includes(token), true, `missing runtime finding: ${token}`);
  }
});

test("runbook uses canonical observations and repeatable report inputs", () => {
  const doc = readDoc();
  for (const token of [
    "bin/export-hybrid-search-observations.js",
    "bin/audit-tool-surface-runtime-access.js",
    "bin/audit-scoped-fail-closed-canary-evidence.js",
    "bin/summarize-hybrid-search-observations.js",
    "--observations /tmp/memory-engine-auto-recall-canary-observations.jsonl",
    "--observations /tmp/memory-engine-tool-surface-observations.jsonl",
    "event_type",
    "metadata-only redacted replay",
  ]) {
    assert.equal(doc.includes(token), true, `missing evidence token: ${token}`);
  }
});

test("runbook records the audited result without auto-authorizing rollout", () => {
  const doc = readDoc();
  for (const token of [
    "tool_surface_runtime_confirmed_effective_filtered",
    "production_surface_execution_confirmed=true",
    "model_visibility_confirmed=false",
    "stage2_review_eligible=true",
    "does not automatically authorize Stage 2",
    "does not authorize legacy fallback removal",
  ]) {
    assert.equal(doc.includes(token), true, `missing result boundary: ${token}`);
  }
});
