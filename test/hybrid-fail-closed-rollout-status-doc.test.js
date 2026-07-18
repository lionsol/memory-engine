import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const STATUS_DOC = new URL("../docs/hybrid-fail-closed-rollout-status.md", import.meta.url);
const DOCS_INDEX = new URL("../docs/README.md", import.meta.url);
const DEVLOG = new URL("../docs/devlog.md", import.meta.url);

function read(url) {
  return readFileSync(url, "utf8");
}

test("Hybrid fail-closed rollout ledger exists and is indexed", () => {
  assert.equal(existsSync(STATUS_DOC), true);
  const index = read(DOCS_INDEX);
  assert.match(index, /hybrid-fail-closed-rollout-status\.md/);
  assert.match(index, /tool-surface-runtime-access-audit\.md/);
});

test("rollout ledger records the closed Stage 1 evidence and pending Stage 2 boundary", () => {
  const doc = read(STATUS_DOC);
  for (const token of [
    "Status: Current rollout ledger",
    "B8-A5 deterministic full fail-closed safety smoke",
    "B8-A6.1 scoped-canary evidence tooling",
    "B8-A6.2 tool-surface runtime access audit",
    "auto_recall=6",
    "memory_engine_action_search=1",
    "memory_engine_search=1",
    "stage2_review_eligible=true",
    "tool_surface_runtime_confirmed_effective_filtered",
    "OPERATOR AUTHORIZED / PENDING EXECUTION",
    "Stage 3 KG rollback validation",
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
    "Even a successful Stage 2/3 result does not authorize B8-B removal",
  ]) {
    assert.equal(doc.includes(token), true, `missing safety boundary token: ${token}`);
  }
});

test("devlog records the 2026-07-18 Stage 1 closeout", () => {
  const devlog = read(DEVLOG);
  for (const token of [
    "## 2026-07-18",
    "F1-D-B8-A5/A6",
    "Combined Stage 1 evidence",
    "observed_hybrid_events=8",
    "Node runtime finding",
    "Stage 2 已获得 operator 授权",
  ]) {
    assert.equal(devlog.includes(token), true, `missing devlog token: ${token}`);
  }
});
