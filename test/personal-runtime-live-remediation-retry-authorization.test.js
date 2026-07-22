import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const PACKET = new URL(
  "../docs/smoke-tests/personal-runtime-live-remediation-retry-authorization-20260721.md",
  import.meta.url,
);
const README = new URL("../docs/README.md", import.meta.url);
const LEDGER = new URL("../docs/hybrid-fail-closed-rollout-status.md", import.meta.url);
const RUNTIME_SYNC = new URL("../docs/runtime-sync.md", import.meta.url);
const DECISION = new URL(
  "../docs/smoke-tests/personal-runtime-live-remediation-decision-20260721.md",
  import.meta.url,
);
const RETRY_DECISION = new URL(
  "../docs/smoke-tests/personal-runtime-live-remediation-retry-decision-20260721.md",
  import.meta.url,
);
const DEVLOG = new URL("../docs/devlog.md", import.meta.url);

function read(url) {
  return readFileSync(url, "utf8");
}

function requireTokens(text, tokens, label) {
  for (const token of tokens) {
    assert.equal(text.includes(token), true, `missing ${label} token: ${token}`);
  }
}

test("R6.5.2 retry authorization packet and blocked execution decision exist and are indexed", () => {
  assert.equal(existsSync(PACKET), true);
  assert.equal(existsSync(RETRY_DECISION), true);
  const index = read(README);
  assert.match(index, /personal-runtime-live-remediation-retry-authorization-20260721\.md/);
  assert.match(index, /personal-runtime-live-remediation-retry-decision-20260721\.md/);
});

test("R6.5.2 binds the unchanged candidate and current recovery runtime", () => {
  requireTokens(read(PACKET), [
    "candidate artifact identity=0490e60741c8ef12c0a6a8e70a169c43bd6d81c8cd465f781b7d01c8b3244f42",
    "candidate runtime identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718",
    "source/candidate difference_count=0",
    "candidate root mode=0500",
    "candidate writable files=0",
    "candidate writable directories=0",
    "candidate external symlinks=0",
    "candidate external hardlink references=0",
    "active runtime identity=86d04dd7b07bbd62948381f26dadd6b4e444b993ae7bdf6e535b0a5a8152f1f1",
    "active runtime/current recovery R0 difference_count=0",
    "sourcePath=/tmp/memory-engine-r6.5-live-2415dfe/runtime/r0",
  ], "R6.5.2 identity binding");
});

test("R6.5.2 uses the closed semantic config policy without broad exceptions", () => {
  const packet = read(PACKET);
  requireTokens(packet, [
    "policy=memory-engine-config-semantic-equivalence-v1",
    "status=exact_equal",
    "status=approved_host_metadata_change",
    "changed_paths=[meta.lastTouchedAt]",
    "unexpected_changed_paths=[]",
    "last_touched_at.before_valid=true",
    "last_touched_at.after_valid=true",
    "last_touched_at.monotonic=true",
    "any other changed JSON path",
    "Fresh C0 remains the exact rollback authority",
  ], "semantic config gate");
});

test("R6.5.2 requires new fresh recovery artifacts and preserves the old root", () => {
  requireTokens(read(PACKET), [
    "/tmp/memory-engine-r6.5.2-retry-<UTC>-<short-random>/",
    "fresh C0 byte-exact and separate inode",
    "fresh R0 full-tree exact and separate inode tree",
    "fresh H0 captured after R0 creation",
    "fresh D0 captured only after Gateway quiesce",
    "The previous `/tmp/memory-engine-r6.5-live-2415dfe` root remains read-only recovery evidence",
    "current recovery transaction root exists and remains protected",
    "R6.5.2 RETRY AUTHORIZATION BLOCKED / REBUILD OR REBASE REQUIRED",
  ], "fresh retry artifacts");
});

test("R6.5.2 preserves the core DB and gates install-time data identities", () => {
  requireTokens(read(PACKET), [
    "/home/lionsol/.openclaw/memory/memory-engine",
    "/home/lionsol/.openclaw/memory/lancedb",
    "/home/lionsol/.openclaw/memory/main.sqlite",
    "D_PRE_RETRY",
    "D_POST_INSTALL=D_PRE_RETRY",
    "restore fresh retry D0 only if data identities changed",
  ], "retry data boundary");
});

test("R6.5.2 requires Node 24 stopped install and loaded Gateway evidence", () => {
  const packet = read(PACKET);
  requireTokens(packet, [
    "$HOME/.local/node24/bin/node",
    "gateway stop --json",
    "plugins install /tmp/memory-engine-r6.4-9b6b734/candidate --force",
    "gateway start --json",
    "Allow a bounded startup-readiness interval",
    "memoryEngine.sustainedRuntimePreflight registered",
    "memoryEngine.productionEvidenceHealthcheck registered",
    "tools.catalog includes memory_engine",
    "tools.catalog includes memory_engine_search",
    "tools.catalog includes memory_engine_get",
    "A5=10/10",
  ], "retry runtime acceptance");
});

test("R6.5.2 exact approval is distinct and the later attempt is recorded as blocked", () => {
  requireTokens(read(PACKET), [
    "AUTHORIZE B8-A7-R6.5.2 LIVE REMEDIATION RETRY",
    "config semantic policy=memory-engine-config-semantic-equivalence-v1",
    "fresh retry C0/R0/H0/D0 creation and Gateway stop/install/start are authorized",
    "conditional rollback to fresh retry R0, exact retry C0, and exact pre-start retry D0 is authorized on any defined stop condition",
    "The original R6.5 approval, a generic “continue,” or an approval missing any line above is insufficient",
    "B8-A7-R6.5.2 live remediation retry authorization packet=PASSED / CLOSED",
    "B8-A7-R6.5.2 live retry execution=BLOCKED / NO MUTATION",
    "R6.5.2 retry authorization=CONSUMED / NOT REUSABLE",
    "fresh R6.5.2 C0/R0/H0/D0=NOT CREATED",
  ], "retry approval boundary");
});

test("current documents record the blocked R6.5.2 attempt and require rebuild or rebase", () => {
  for (const text of [read(LEDGER), read(RUNTIME_SYNC), read(DECISION), read(RETRY_DECISION), read(DEVLOG)]) {
    assert.match(text, /B8-A7-R6\.5\.1 config semantic equivalence repair(?:=|\s+)PASSED \/ CLOSED/);
    assert.match(text, /B8-A7-R6\.5\.2 live remediation retry authorization packet(?:=|\s+)PASSED \/ CLOSED/);
    assert.match(text, /B8-A7-R6\.5\.2 live retry execution(?:=|\s+)BLOCKED \/ NO MUTATION/);
    assert.match(text, /R6\.5\.2 retry authorization(?:=|\s+)CONSUMED \/ NOT REUSABLE/);
    assert.match(text, /B8-A7-R6\.5\.3 persistent artifact rebuild\/recovery-source rebase design(?:=|\s+)IMPLEMENTED \/ EDI VERIFICATION PENDING/);
    assert.match(text, /R6\.5\.3A persistent artifact preparation(?:=|\s+)NOT AUTHORIZED/);
    assert.match(text, /R6\.5\.3B recovery-source rebase execution(?:=|\s+)NOT AUTHORIZED/);
  }
});
