import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const STATUS_DOC = new URL("../docs/hybrid-fail-closed-rollout-status.md", import.meta.url);
const R4_ADR = new URL("../docs/adr/host-plugin-metadata-ownership.md", import.meta.url);
const DOCS_INDEX = new URL("../docs/README.md", import.meta.url);
const DEVLOG = new URL("../docs/devlog.md", import.meta.url);
const RUNTIME_SYNC = new URL("../docs/runtime-sync.md", import.meta.url);

function read(url) {
  return readFileSync(url, "utf8");
}

test("Hybrid fail-closed rollout ledger and R4 ADR exist and are indexed", () => {
  assert.equal(existsSync(STATUS_DOC), true);
  assert.equal(existsSync(R4_ADR), true);
  const index = read(DOCS_INDEX);
  assert.match(index, /hybrid-fail-closed-rollout-status\.md/);
  assert.match(index, /adr\/host-plugin-metadata-ownership\.md/);
  assert.match(index, /tool-surface-runtime-access-audit\.md/);
});

test("R4 ADR assigns publication authority to OpenClaw and preserves fail-closed boundaries", () => {
  const adr = read(R4_ADR);
  for (const token of [
    "Status: Accepted",
    "B8-A7-R4 Metadata Ownership Decision Review",
    "Option A: OpenClaw upstream host publisher",
    "Option B: memory-engine shadow publisher",
    "Option C: direct SQLite/index consumption",
    "openclaw@2026.7.1-2",
    "authority_state",
    "installation_state",
    "policy_state",
    "disabled-by-host-policy",
    "The low-level SQLite writer is not the publication boundary",
    "startup reconciliation",
    "OpenClaw upstream host publisher=REQUIRED",
    "real host publisher=NOT AUTHORIZED",
    "production manifest consumer=NOT AUTHORIZED",
    "B8-A7 sustained runtime authorization=WITHHELD",
  ]) {
    assert.equal(adr.includes(token), true, `missing R4 ADR token: ${token}`);
  }
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
    "B8-A6 Stage 4 Recent full rollout",
    "CLOSED / PASS",
    "B8-A6.4 AutoRecall runtime-gate config contract",
    "B8-A6.5 hook-contract-compatible AutoRecall gate",
    "CLOSED / RUNTIME VERIFIED",
    "Stage 4 Final Runtime Rerun Closeout",
    "controlled_run_surface_coverage_status=complete",
    "controlled_run_closeout_eligible=true",
    "missing canonical surfaces such as `auto_recall`",
    "zero AutoRecall observations cannot be interpreted as closeout-ready",
    "empty `agentAllowlist` or `triggerAllowlist` values fail closed",
    "scope_match=null",
    "canonical legacy fallback markers override access-mode summaries",
    "Stage 4 First Runtime Attempt Review",
    "Stage 4 Clean Rerun Review",
    "PluginHookBeforePromptBuildEvent={prompt,messages}",
    "Normal user runs carry `ctx.trigger=\"user\"`",
    "autoRecall.agentAllowlist default=[\"edi\"]",
    "Stage 4 reviewed-runtime provenance=false",
    "Stage 4 rollback=PASS",
    "Stage 4 Authorization Review",
    "103/103 passed",
    "B8-B legacy fallback removal",
    "NOT AUTHORIZED",
    "B8-A7-R3A host-published metadata manifest synthetic contract",
    "PASSED / CLOSED",
    "canonical JSON",
    "duplicate-key rejection",
    "BOM/NUL rejection",
    "permission rejection",
    "atomic old/new generation",
    "symlink/hardlink rejection",
    "zero-consumer-write evidence",
    "B8-A7-R3B host metadata publisher integration-point source audit",
    "NOT FOUND / BLOCKED",
    "B8-A7-R4 metadata ownership decision",
    "ACCEPTED / OPTION A REQUIRED",
    "OpenClaw upstream host publisher REQUIRED",
    "openclaw@2026.7.1-2",
    "installation_state",
    "policy_state",
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
    "Stage 4 closeout confirms the controlled rollout and rollback wiring only",
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
    "## 2026-07-21",
    "F1-D-B8-A7-R4: metadata ownership decision",
    "openclaw@2026.7.1-2",
    "OpenClaw upstream host publisher=REQUIRED",
    "## 2026-07-19",
    "Stage 2 KG full rollout and Stage 3 rollback closeout",
    "opencode/deepseek-v4-flash",
    "auto_recall=2",
    "Stage 2 KG full rollout: PASS",
    "Stage 3 KG rollback: PASS",
    "F1-D-B8-A6 Stage 4: final runtime rerun closeout",
    "B8-A6 Stage 4=CLOSED / PASS",
    "B8-A6.5=CLOSED / RUNTIME VERIFIED",
    "F1-D-B8-A6.5: implementation review closeout",
    "F1-D-B8-A6 Stage 4: final config-only rerun and host-contract mismatch review",
    "B8-A6.5 hook-contract-compatible AutoRecall gate=OPEN / REQUIRED NEXT",
    "F1-D-B8-A6.5: hook-contract-compatible AutoRecall gate",
    "triggerAllowlist=[\"user\"]",
    "missing_surface:auto_recall",
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
