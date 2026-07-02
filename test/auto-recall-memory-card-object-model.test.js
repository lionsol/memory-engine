import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const MODEL_DOC = new URL("../docs/auto-recall-memory-card-object-model.md", import.meta.url);

function readDoc() {
  return readFileSync(MODEL_DOC, "utf8");
}

test("memory card object model doc exists", () => {
  assert.equal(existsSync(MODEL_DOC), true);
});

test("P4 model is explicitly design-only and avoids runtime/storage mutation", () => {
  const doc = readDoc();

  assert.match(doc, /Design-only P4 contract/i);
  assert.match(doc, /does not introduce a DB migration/i);
  assert.match(doc, /runtime injection change/i);
  assert.match(doc, /storage rewrite/i);
  assert.match(doc, /No runtime behavior change/i);
  assert.match(doc, /No DB migration/i);
});

test("memory object and memory card are distinct projections", () => {
  const doc = readDoc();

  assert.match(doc, /Memory object/i);
  assert.match(doc, /normalized internal representation/i);
  assert.match(doc, /Memory card/i);
  assert.match(doc, /compact user\/agent-facing projection/i);
  assert.match(doc, /retrieval candidate\s*\n\s*-> memory object projection\s*\n\s*-> memory card projection/i);
});

test("card-first disclosure keeps full content get-on-demand", () => {
  const doc = readDoc();

  assert.match(doc, /card-first injection/i);
  assert.match(doc, /Full content remains available only through an explicit get\/read path/i);
  assert.match(doc, /full_content_on_get/i);
  assert.match(doc, /not injected automatically/i);
  assert.match(doc, /get-on-demand/i);
});

test("design preserves runtime gate and cited-id-only reinforcement invariants", () => {
  const doc = readDoc();

  assert.match(doc, /runtime gate still runs before all recall logic/i);
  assert.match(doc, /card rendered != cited/i);
  assert.match(doc, /card injected != cited/i);
  assert.match(doc, /search result != cited/i);
  assert.match(doc, /Only explicit cited memory ids/i);
});

test("design includes required disclosure vocabulary from turn gold set", () => {
  const doc = readDoc();

  for (const token of ["none", "memory_card", "short_summary", "full_content_on_get"]) {
    assert.match(doc, new RegExp(token));
  }
});

test("design includes risk flags and lifecycle exclusion policy", () => {
  const doc = readDoc();

  for (const token of [
    "raw_log_like",
    "tool_output_like",
    "dreaming_artifact",
    "low_confidence",
    "archived",
    "quarantined",
    "cross_agent_scope",
  ]) {
    assert.match(doc, new RegExp(token));
  }

  assert.match(doc, /Only `active` should be eligible for default card injection/i);
  assert.match(doc, /archived`, `quarantined`, and `deleted_shadow` are excluded by default/i);
});

test("design preserves memory-core and agent-scope boundaries", () => {
  const doc = readDoc();

  assert.match(doc, /memory-engine impersonate OpenClaw memory-core/i);
  assert.match(doc, /agent scope/i);
  assert.match(doc, /edi/i);
  assert.match(doc, /task-planner/i);
  assert.match(doc, /Codex CLI remains outside memory-engine autoRecall/i);
  assert.match(doc, /Cross-agent scope cards must be treated as risk-flagged/i);
});

test("P4 migration is phased before runtime card-first experiment", () => {
  const doc = readDoc();

  assert.match(doc, /P4\.1 Design freeze/i);
  assert.match(doc, /P4\.2 Projection helpers/i);
  assert.match(doc, /P4\.3 Replay integration/i);
  assert.match(doc, /P4\.4 Console preview/i);
  assert.match(doc, /P4\.5 Runtime card-first experiment/i);
  assert.match(doc, /Behind explicit config flag/i);
  assert.match(doc, /edi-only/i);
});
