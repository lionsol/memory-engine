import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

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

test("R6.5.3 persistent artifact and rebase design exists and is indexed", () => {
  assert.equal(existsSync(DESIGN), true);
  assert.match(read(README), /personal-runtime-persistent-artifact-rebase-design-20260721\.md/);
  assert.match(read(LEDGER), /personal-runtime-persistent-artifact-rebase-design-20260721\.md/);
});

test("R6.5.3 restores a durable owner-only artifact root outside temporary filesystems", () => {
  requireTokens(read(DESIGN), [
    "PERSISTENT_ROOT=$HOME/.openclaw/backups/memory-engine/r6.5.3/<UTC-run-id>",
    "/tmp",
    "/run",
    "/dev/shm",
    "persistent parent mode=0700",
    "run root mode=0700",
    "authority and evidence files mode=0600",
    "no hardlink or reflink to active runtime, config, or memory data",
    "all copy operations use independent bytes",
  ], "persistent root");
});

test("R6.5.3 rejects path resurrection, symlink repair, registry edits, and combined activation", () => {
  requireTokens(read(DESIGN), [
    "A path with the same name is not the same authority",
    "symlink old /tmp path to a new persistent root",
    "bind-mount a replacement over the old /tmp path",
    "manually edit OpenClaw config or registry sourcePath",
    "install the reviewed candidate during the recovery-source rebase",
    "reuse the consumed R6.5.2 authorization",
    "trust an artifact by path or filename without fresh manifests",
  ], "rejected repairs");
});

test("R6.5.3 defines atomic publication and a non-secret authority manifest", () => {
  requireTokens(read(DESIGN), [
    ".staging-<UTC-run-id>",
    "publish by same-filesystem atomic rename",
    "schema=memory-engine-persistent-runtime-authority-v1",
    "candidate_artifact_identity",
    "candidate_runtime_identity",
    "r0_artifact_identity",
    "r0_runtime_identity",
    "published=true",
    "must not contain configuration contents, credentials, API keys, database rows, or memory text",
  ], "authority publication");
});

test("R6.5.3A rebuilds candidate and exact active-runtime R0 without live mutation", () => {
  requireTokens(read(DESIGN), [
    "R6.5.3A=offline persistent candidate and R0 preparation",
    "The historical candidate identity `0490e607…44f42` is evidence only",
    "source/candidate runtime parity=0",
    "active artifact identity before copy=active artifact identity after copy",
    "r0 artifact identity=stable active artifact identity",
    "active/r0 difference_count=0",
    "shared file inode count=0",
    "R0 Node 24 native smoke=pass",
    "The candidate must not be installed into the active OpenClaw environment during preparation",
  ], "offline preparation");
});

test("R6.5.3B rebases only the recovery source and preserves runtime and data identity", () => {
  requireTokens(read(DESIGN), [
    "R6.5.3B=live recovery-source rebase to persistent R0",
    "prepared R0 runtime identity=current active runtime identity",
    "prepared candidate remains unused",
    "plugins install <persistent-root>/recovery/r0 --force",
    "require D_POST_INSTALL=D_PRE_REBASE",
    "require installed runtime identity unchanged",
    "require sourcePath=<persistent-root>/recovery/r0",
    "The reviewed candidate must remain unused throughout this transaction",
  ], "recovery-source rebase");
});

test("R6.5.3 keeps core DB and candidate activation outside the rebase authorization", () => {
  requireTokens(read(DESIGN), [
    "D0 is created only after Gateway stop and quiescence",
    "covers memory-engine SQLite plus LanceDB, never the core DB",
    "Candidate activation is a later stage with a fresh exact authorization",
    "It must not reuse R6.5, R6.5.2, or recovery-source rebase authorization",
    "persistent R0 must remain while installed sourcePath points to it",
    "cleanup requires a separate reviewed decision",
  ], "separation and retention");
});

test("current documents close R6.5.3 design and keep R6.5.3A execution unauthorized", () => {
  for (const text of [read(DESIGN), read(LEDGER), read(RUNTIME_SYNC), read(DEVLOG)]) {
    assert.match(text, /B8-A7-R6\.5\.3 persistent artifact rebuild\/recovery-source rebase design(?:=|\s+)PASSED \/ CLOSED/);
    assert.match(text, /B8-A7-R6\.5\.3A persistent artifact preparation authorization packet(?:=|\s+)IMPLEMENTED \/ EDI VERIFICATION PENDING/);
    assert.match(text, /R6\.5\.3A persistent artifact preparation execution(?:=|\s+)NOT AUTHORIZED/);
    assert.match(text, /R6\.5\.3B recovery-source rebase execution(?:=|\s+)NOT AUTHORIZED/);
    assert.match(text, /R6\.5\.3 candidate activation(?:=|\s+)NOT AUTHORIZED/);
    assert.match(text, /persistent authority root(?:=|\s+)NOT CREATED/);
    assert.match(text, /B8-A7 sustained runtime authorization(?:=|\s+)WITHHELD \/ PERSONAL PROFILE REMEDIATION REQUIRED/);
  }
});
