import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const DECISION = new URL(
  "../docs/smoke-tests/personal-runtime-persistent-artifact-preparation-decision-20260722.md",
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

test("R6.5.3A blocked preparation decision exists and is indexed", () => {
  assert.equal(existsSync(DECISION), true);
  assert.match(read(README), /personal-runtime-persistent-artifact-preparation-decision-20260722\.md/);
});

test("R6.5.3A decision records successful offline gates before the stop condition", () => {
  requireTokens(read(DECISION), [
    "Result: BLOCKED / NO PUBLICATION",
    "resolved full HEAD=b2bc851d6dd2111344b4328ecc41b0a3b866acad",
    "active-before artifact identity=bf0e9b53ce7e712d2a34f2ffc3584aa86c55f8c8a9e6a90e5160e9d5f3cde78e",
    "active-after artifact identity=bf0e9b53ce7e712d2a34f2ffc3584aa86c55f8c8a9e6a90e5160e9d5f3cde78e",
    "R0 pre-freeze artifact identity=bf0e9b53ce7e712d2a34f2ffc3584aa86c55f8c8a9e6a90e5160e9d5f3cde78e",
    "active/R0 runtime difference_count=0",
    "candidate runtime identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718",
    "source/candidate difference_count=0",
    "source archive SHA-256=8a62d85c0ed583af3b3c49fa9953ee397b30d16a98b5379b7ecf1864420328f8",
    "candidate SQLite and LanceDB native smoke=PASS",
  ], "R6.5.3A successful pre-stop gates");
});

test("R6.5.3A decision fails closed on incompatible exact identity and read-only freeze requirements", () => {
  requireTokens(read(DECISION), [
    "The canonical artifact identity includes permission modes",
    "Removing write bits from R0 would therefore change its artifact identity",
    "immutable_supported=no",
    "R6.5.3A PREPARATION BLOCKED / FREEZE MODEL REPAIR REQUIRED",
    "Publishing by weakening either gate would violate the closed R6.5.3A packet",
  ], "freeze-model stop condition");
});

test("R6.5.3A cleanup leaves no published authority or live mutation", () => {
  requireTokens(read(DECISION), [
    "persistent parent published children=0",
    "staging root exists=false",
    "FINAL_ROOT exists=false",
    "Gateway PID=344",
    "config SHA-256=da9e443c416979ed71763ccc7cd00106597bed7a7dfdb064a3b507627b2c6f2a",
    "persistent authority root=NOT PUBLISHED",
    "persistent candidate=NOT PUBLISHED",
    "persistent R0=NOT PUBLISHED",
    "OpenClaw install/reload=NOT PERFORMED",
    "memory-data mutation=NOT PERFORMED",
  ], "no-publication cleanup");
});

test("R6.5.3A authorization is consumed and repair remains separate", () => {
  requireTokens(read(DECISION), [
    "R6.5.3A authorization=CONSUMED / NOT REUSABLE",
    "B8-A7-R6.5.3A.1 freeze-model repair=NOT STARTED",
    "persistent exact R0 archive preserving modes and content",
    "fresh extracted install staging created only inside the later R6.5.3B transaction",
    "This document records the direction only. It does not authorize or close that repair",
  ], "authorization and repair boundary");
});

test("current documents record blocked R6.5.3A without authorizing repair or rebase", () => {
  for (const text of [read(LEDGER), read(RUNTIME_SYNC), read(DEVLOG)]) {
    assert.match(text, /B8-A7-R6\.5\.3A (?:persistent artifact preparation )?execution(?:=|\s+)BLOCKED \/ NO PUBLICATION/);
    assert.match(text, /R6\.5\.3A authorization(?:=|\s+)CONSUMED \/ NOT REUSABLE/);
    assert.match(text, /persistent authority root(?:=|\s+)NOT PUBLISHED/);
    assert.match(text, /B8-A7-R6\.5\.3A\.1 freeze-model repair(?:=|\s+)NOT STARTED/);
    assert.match(text, /R6\.5\.3B recovery-source rebase execution(?:=|\s+)NOT AUTHORIZED/);
  }
});
