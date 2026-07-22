import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const PACKET = new URL(
  "../docs/smoke-tests/personal-runtime-persistent-artifact-preparation-authorization-20260721.md",
  import.meta.url,
);
const DESIGN = new URL(
  "../docs/smoke-tests/personal-runtime-persistent-artifact-rebase-design-20260721.md",
  import.meta.url,
);
const README = new URL("../docs/README.md", import.meta.url);
const LEDGER = new URL("../docs/hybrid-fail-closed-rollout-status.md", import.meta.url);
const RUNTIME_SYNC = new URL("../docs/runtime-sync.md", import.meta.url);
const DEVLOG = new URL("../docs/devlog.md", import.meta.url);

function read(url) {
  return readFileSync(url, "utf8");
}

function requireTokens(text, tokens, label) {
  for (const token of tokens) {
    assert.equal(text.includes(token), true, `missing ${label} token: ${token}`);
  }
}

test("R6.5.3A preparation packet exists and is indexed", () => {
  assert.equal(existsSync(PACKET), true);
  const index = read(README);
  assert.match(index, /personal-runtime-persistent-artifact-preparation-authorization-20260721\.md/);
});

test("R6.5.3 design is closed before preparation authorization", () => {
  requireTokens(read(DESIGN), [
    "Status: PASSED / CLOSED",
    "B8-A7-R6.5.3 persistent artifact rebuild/recovery-source rebase design=PASSED / CLOSED",
  ], "closed R6.5.3 design");
});

test("R6.5.3A binds a clean HEAD current runtime persistent parent and Gateway", () => {
  requireTokens(read(PACKET), [
    "reviewed source HEAD=<clean committed HEAD>",
    "active runtime identity=<current runtime build identity>",
    "persistent parent=$HOME/.openclaw/backups/memory-engine/r6.5.3",
    "Gateway PID=<current PID>",
    "Gateway Node=<current Node 24 executable>",
    "Any mismatch requires a new exact authorization",
  ], "execution identity binding");
});

test("R6.5.3A only uses durable owner-only same-filesystem publication", () => {
  requireTokens(read(PACKET), [
    "$HOME/.openclaw/backups/memory-engine/r6.5.3",
    "PERSISTENT_PARENT mode=0700",
    "STAGING_ROOT mode=0700",
    "FINAL_ROOT mode=0700",
    "STAGING_ROOT and FINAL_ROOT on the same filesystem",
    "no path component is a symlink",
    "same-filesystem atomic rename",
    "published=true",
  ], "persistent publication");
});

test("R6.5.3A builds candidate and stable active-runtime R0 offline", () => {
  requireTokens(read(PACKET), [
    "npm pack reviewed source under Node 24",
    "run Node 24 npm ci --omit=dev with lifecycle scripts enabled",
    "require source/candidate difference_count=0",
    "compute active full-tree artifact identity before copy",
    "compute active full-tree artifact identity after copy",
    "require active-before identity=active-after identity",
    "require R0 identity=stable active identity",
    "Do not stop the Gateway under this authorization",
  ], "offline candidate and R0 preparation");
});

test("R6.5.3A excludes secrets links production data and live mutation", () => {
  requireTokens(read(PACKET), [
    "No file is a hardlink, reflink, or symlink to production configuration, runtime, or data",
    "must not copy `openclaw.json` into the authority root",
    "must not emit configuration values",
    "core DB is not opened or copied",
    "leave OpenClaw configuration and registry untouched",
    "leave engine SQLite, LanceDB, and core DB untouched",
    "R6.5.3A success does not repair `sourcePath`",
  ], "non-mutation boundary");
});

test("R6.5.3A exact approval is distinct and the later execution is recorded as blocked", () => {
  requireTokens(read(PACKET), [
    "AUTHORIZE B8-A7-R6.5.3A OFFLINE PERSISTENT ARTIFACT PREPARATION",
    "reviewed source HEAD=<exact clean committed HEAD>",
    "active runtime identity=<exact current active runtime identity>",
    "persistent parent=/home/lionsol/.openclaw/backups/memory-engine/r6.5.3",
    "offline candidate and exact active-runtime R0 staging, validation, freeze, and atomic publication are authorized",
    "Gateway stop/start/restart, OpenClaw install/reload, sourcePath mutation, candidate activation, configuration mutation, and memory-data mutation are not authorized",
    "A generic “continue,” the consumed R6.5.2 authorization, or an approval with missing or stale values is insufficient",
    "B8-A7-R6.5.3A persistent artifact preparation execution=BLOCKED / NO PUBLICATION",
    "R6.5.3A authorization=CONSUMED / NOT REUSABLE",
    "B8-A7-R6.5.3A.1 freeze-model repair=NOT STARTED",
  ], "exact preparation approval");
});

test("current documents record blocked R6.5.3A publication and consumed authorization", () => {
  for (const text of [read(LEDGER), read(RUNTIME_SYNC), read(DEVLOG)]) {
    assert.match(text, /B8-A7-R6\.5\.3 persistent artifact rebuild\/recovery-source rebase design(?:=|\s+)PASSED \/ CLOSED/);
    assert.match(text, /B8-A7-R6\.5\.3A persistent artifact preparation authorization packet(?:=|\s+)PASSED \/ CLOSED/);
    assert.match(text, /B8-A7-R6\.5\.3A persistent artifact preparation execution(?:=|\s+)BLOCKED \/ NO PUBLICATION/);
    assert.match(text, /R6\.5\.3A authorization(?:=|\s+)CONSUMED \/ NOT REUSABLE/);
    assert.match(text, /persistent authority root(?:=|\s+)NOT PUBLISHED/);
    assert.match(text, /B8-A7-R6\.5\.3A\.1 freeze-model repair(?:=|\s+)NOT STARTED/);
    assert.match(text, /R6\.5\.3B recovery-source rebase execution(?:=|\s+)NOT AUTHORIZED/);
    assert.match(text, /R6\.5\.3 candidate activation(?:=|\s+)NOT AUTHORIZED/);
  }
});
