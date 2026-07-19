import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const STATUS_DOC = new URL("../docs/hybrid-fail-closed-rollout-status.md", import.meta.url);
const DOCS_INDEX = new URL("../docs/README.md", import.meta.url);
const DEVLOG = new URL("../docs/devlog.md", import.meta.url);
const RUNTIME_SYNC = new URL("../docs/runtime-sync.md", import.meta.url);

function read(url) {
  return readFileSync(url, "utf8");
}

test("Hybrid fail-closed rollout ledger exists and is indexed", () => {
  assert.equal(existsSync(STATUS_DOC), true);
  const index = read(DOCS_INDEX);
  assert.match(index, /hybrid-fail-closed-rollout-status\.md/);
  assert.match(index, /tool-surface-runtime-access-audit\.md/);
});

test("rollout ledger records Stage 2/3 closeout, provenance hardening, and Stage 4 rerun status", () => {
  const doc = read(STATUS_DOC);
  for (const token of [
    "Status: Current rollout ledger",
    "B8-A5 deterministic full fail-closed safety smoke",
    "B8-A6.1 scoped-canary evidence tooling",
    "B8-A6.2 tool-surface runtime access audit",
    "auto_recall=6",
    "stage2_review_eligible=true",
    "tool_surface_runtime_confirmed_effective_filtered",
    "B8-A6 Stage 2 KG full rollout",
    "CLOSED / PASS",
    "auto_recall=2",
    "kg_runtime_mode=full_fail_closed on all 4 observations",
    "B8-A6 Stage 3 KG rollback validation",
    "B8-A6.3 observation provenance hardening",
    "hybrid-observation-provenance.md",
    "invalid_provenance_observation_count",
    "id=11087",
    "CLEAN RERUN INCONCLUSIVE / AUTO_RECALL SURFACE MISSING",
    "B8-A6.4 AutoRecall runtime-gate config contract",
    "Stage 4 First Runtime Attempt Review",
    "Stage 4 Clean Rerun Review",
    "autoRecall.agentAllowlist default=[\"edi\"]",
    "Stage 4 reviewed-runtime provenance=false",
    "Stage 4 rollback=PASS",
    "Stage 4 Authorization Review",
    "103/103 passed",
    "B8-B legacy fallback removal",
    "NOT AUTHORIZED",
  ]) {
    assert.equal(doc.includes(token), true, `missing rollout ledger token: ${token}`);
  }
});

test("rollout ledger preserves runtime and mutation safety boundaries", () => {
  const doc = read(STATUS_DOC);
  for (const token of [
    "PATH=\"$HOME/.local/node24/bin:$PATH\"",
    "Recent full rollout",
    "memory mutation",
    "cite",
    "reinforcement",
    "intentional corruption",
    "push or release publication",
    "Stage 4 is authorized only for the controlled rollout and rollback procedure",
    "any source or installed-runtime code modification during the rollout evidence window",
    "temporary bypass of AutoRecall agent, chat-type, role, or other runtime gates",
    "It does not authorize B8-B removal",
  ]) {
    assert.equal(doc.includes(token), true, `missing safety boundary token: ${token}`);
  }
});

test("runtime sync documentation uses the inspected extension install path", () => {
  const doc = read(RUNTIME_SYNC);
  assert.match(doc, /~\/\.openclaw\/extensions\/memory-engine/);
  assert.match(doc, /plugins inspect memory-engine --runtime --json/);
  assert.doesNotMatch(doc, /\.\.\/\.\.\/extensions\/memory-engine/);
});

test("devlog records Stage 1, corrected Stage 2/3 closeout, B8-A6.3, and Stage 4 rerun review", () => {
  const devlog = read(DEVLOG);
  for (const token of [
    "## 2026-07-19",
    "Stage 2 KG full rollout and Stage 3 rollback closeout",
    "opencode/deepseek-v4-flash",
    "auto_recall=2",
    "Stage 2 KG full rollout: PASS",
    "Stage 3 KG rollback: PASS",
    "F1-D-B8-A6.4: AutoRecall runtime-gate config contract",
    "Stage 4 clean rerun=INCONCLUSIVE / AUTO_RECALL SURFACE MISSING",
    "Stage 4 next rerun=CONFIG-ONLY AUTHORIZED",
    "F1-D-B8-A6 Stage 4: first runtime attempt evidence review",
    "Stage 4 reviewed-runtime provenance=false",
    "Stage 4 clean rerun=REQUIRED",
    "F1-D-B8-A6 Stage 4: Recent full rollout authorization review",
    "103 tests",
    "F1-D-B8-A6.3: Hybrid observation provenance hardening",
    "invalid_provenance_observation_count",
    "id=11087",
    "## 2026-07-18",
    "Combined Stage 1 evidence",
    "observed_hybrid_events=8",
  ]) {
    assert.equal(devlog.includes(token), true, `missing devlog token: ${token}`);
  }
});
