import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const PACKET = new URL(
  "../docs/smoke-tests/personal-runtime-live-remediation-authorization-20260721.md",
  import.meta.url,
);
const INDEX = new URL("../docs/README.md", import.meta.url);
const LEDGER = new URL("../docs/hybrid-fail-closed-rollout-status.md", import.meta.url);
const DEVLOG = new URL("../docs/devlog.md", import.meta.url);
const MANIFEST_CLI = new URL("../bin/build-runtime-artifact-manifest.js", import.meta.url);
const MANIFEST_LIB = new URL("../bin/runtime-artifact-manifest-lib.js", import.meta.url);

function read(url) {
  return readFileSync(url, "utf8");
}

function requireTokens(text, tokens, label) {
  for (const token of tokens) {
    assert.equal(text.includes(token), true, `missing ${label} token: ${token}`);
  }
}

test("R6.5 live remediation packet and artifact manifest tooling exist and are indexed", () => {
  for (const url of [PACKET, MANIFEST_CLI, MANIFEST_LIB]) assert.equal(existsSync(url), true);
  const index = read(INDEX);
  assert.match(index, /personal-runtime-live-remediation-authorization-20260721\.md/);
  assert.match(index, /R6\.5 passed \/ closed/);
});

test("R6.5 binds the exact runtime and reproducible artifact identities", () => {
  const packet = read(PACKET);
  requireTokens(packet, [
    "runtime build identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718",
    "artifact manifest serialization=memory-engine-runtime-artifact-manifest-v1",
    "artifact manifest identity=0490e60741c8ef12c0a6a8e70a169c43bd6d81c8cd465f781b7d01c8b3244f42",
    "package-lock.json SHA-256=8ee89a15cc54eb532618cf011a30f5684cedf0aa0c026cb69378bc025ec58718",
    "source archive SHA-256=acbc27b55d0863fbff5dada85eec40993186012802eaba1a1291e132d194697b",
    "candidate writable files=0",
    "candidate writable directories=0",
    "candidate external symlinks=0",
    "candidate external hardlink references=0",
    "better_sqlite3.node SHA-256=be4109c5b07514ade1a2e1452cbed9fca25cbb8d025b76fa2a81e21a91286a05",
  ], "R6.5 identity");
});

test("artifact manifest contract covers modes, content, symlinks, and hardlinks fail closed", () => {
  const packet = read(PACKET);
  const lib = read(MANIFEST_LIB);
  requireTokens(packet, [
    "relative path",
    "permission mode",
    "file byte count and SHA-256",
    "symlink target and within-root resolution",
    "internal hardlink group membership",
    "external or broken symlinks",
    "hardlink references not fully contained in the artifact root",
    "The tool is report-only",
  ], "artifact manifest packet");
  requireTokens(lib, [
    "memory-engine-runtime-artifact-manifest-v1",
    "external_hardlink_reference_count",
    "external_symlink_count",
    "hardlink_groups",
    "writable_file_count",
    "writable_directory_count",
  ], "artifact manifest implementation");
});

test("R6.5 requires fresh C0 R0 H0 D0 and install-time data identity equality", () => {
  const packet = read(PACKET);
  requireTokens(packet, [
    "Phase 1: Fresh C0 and R0",
    "Phase 2: Fresh H0",
    "Phase 5: D0 Quiesced Data Snapshot",
    "/home/lionsol/.openclaw/memory/memory-engine",
    "/home/lionsol/.openclaw/memory/lancedb",
    "/home/lionsol/.openclaw/memory/main.sqlite",
    "source identity=D0 identity",
    "Record the stopped live data identities as `D_PRE_INSTALL`",
    "recompute engine SQLite/LanceDB manifests as D_POST_INSTALL",
    "D_POST_INSTALL identities=D_PRE_INSTALL identities",
    "Any data identity difference is a stop condition",
  ], "R6.5 recovery/data gate");
});

test("R6.5 uses stable cwd and explicit Node 24 stop install start commands", () => {
  const packet = read(PACKET);
  requireTokens(packet, [
    "Stable Command Environment",
    "/home/lionsol/.openclaw/workspace/plugins/memory-engine",
    "Never run install, rollback, inspect, parity, native smoke, or Gateway verification from",
    "$HOME/.local/node24/bin/node",
    "$HOME/.local/lib/node_modules/openclaw/openclaw.mjs",
    "gateway stop --json",
    "plugins install /tmp/memory-engine-r6.4-9b6b734/candidate --force",
    "gateway start --json",
    "port 18789 not listening",
    "Gateway ABI=137",
  ], "R6.5 transaction");
});

test("R6.5 verifies loaded methods tools and safe feature state", () => {
  const packet = read(PACKET);
  requireTokens(packet, [
    "memoryEngine.sustainedRuntimePreflight",
    "gateway call tools.catalog",
    "{\"agentId\":\"edi\",\"includePlugins\":true}",
    "memory_engine",
    "memory_engine_search",
    "memory_engine_get",
    "memoryEngine.productionEvidenceHealthcheck",
    "PRODUCTION_EVIDENCE_HEALTHCHECK_FAILED",
    "unknown method` is a failure",
    "AutoRecall=false",
    "KG=legacy_fallback",
    "Recent=legacy_fallback",
    "production evidence=false",
    "A5 smoke=10/10 pass",
  ], "R6.5 loaded acceptance");
});

test("R6.5 defines bounded rollback and keeps sustained authorization separate", () => {
  const packet = read(PACKET);
  requireTokens(packet, [
    "Rollback Authorization",
    "plugins install <fresh-R0-path> --force",
    "restore C0 only if config bytes changed",
    "restore D0 only when data identity changed during this bounded transaction",
    "Preserve the changed stores as failure evidence first",
    "B8-A7-R6.5 live runtime remediation=PASS",
    "It does not yield",
    "B8-A7 sustained runtime authorization",
    "B8-B removal authorization",
  ], "R6.5 rollback boundary");
});

test("R6.5 records exact approval, safe rollback, and a separately gated retry", () => {
  const packet = read(PACKET);
  requireTokens(packet, [
    "A generic “continue” is not sufficient for this phase",
    "AUTHORIZE B8-A7-R6.5 LIVE REMEDIATION",
    "candidate artifact identity=0490e60741c8ef12c0a6a8e70a169c43bd6d81c8cd465f781b7d01c8b3244f42",
    "B8-A7-R6.5 live remediation execution=ROLLED BACK / SAFE",
    "candidate Gateway activation=NOT REACHED",
    "old runtime restored=TRUE",
    "B8-A7-R6.5.1 config semantic equivalence repair=IMPLEMENTED / EDI VERIFICATION PENDING",
    "R6.5 live retry=NOT AUTHORIZED",
    "explicit retry approval=NOT RECEIVED",
    "fresh retry C0/R0/D0=NOT CREATED",
    "live retry plugin install/reload=NOT AUTHORIZED",
    "live retry Gateway stop/start/restart=NOT AUTHORIZED",
  ], "R6.5 approval boundary");
});

test("ledger and devlog record the safe R6.5 rollback and pending retry repair", () => {
  for (const text of [read(LEDGER), read(DEVLOG)]) {
    assert.match(text, /B8-A7-R6\.4 offline candidate and rollback rehearsal(?:=|\s+)PASSED \/ CLOSED/);
    assert.match(text, /B8-A7-R6\.5 live remediation execution authorization packet(?:=|\s+)PASSED \/ CLOSED/);
    assert.match(text, /B8-A7-R6\.5 live remediation execution(?:=|\s+)ROLLED BACK \/ SAFE/);
    assert.match(text, /candidate Gateway activation(?:=|\s+)NOT REACHED/);
    assert.match(text, /B8-A7-R6\.5\.1 config semantic equivalence repair(?:=|\s+)IMPLEMENTED \/ EDI VERIFICATION PENDING/);
    assert.match(text, /R6\.5 live retry(?:=|\s+)NOT AUTHORIZED/);
    assert.match(text, /B8-A7 sustained runtime authorization(?:=|\s+)WITHHELD \/ PERSONAL PROFILE REMEDIATION REQUIRED/);
    assert.match(text, /B8-B removal(?:=|\s+)NOT AUTHORIZED/);
  }
});
