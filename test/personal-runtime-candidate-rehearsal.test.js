import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const DECISION = new URL(
  "../docs/smoke-tests/personal-runtime-candidate-rehearsal-decision-20260721.md",
  import.meta.url,
);
const DESIGN = new URL(
  "../docs/smoke-tests/personal-runtime-remediation-authorization.md",
  import.meta.url,
);
const RUNTIME_SYNC = new URL("../docs/runtime-sync.md", import.meta.url);
const INDEX = new URL("../docs/README.md", import.meta.url);
const LEDGER = new URL("../docs/hybrid-fail-closed-rollout-status.md", import.meta.url);
const DEVLOG = new URL("../docs/devlog.md", import.meta.url);

function read(url) {
  return readFileSync(url, "utf8");
}

function requireTokens(text, tokens, label) {
  for (const token of tokens) {
    assert.equal(text.includes(token), true, `missing ${label} token: ${token}`);
  }
}

test("R6.4 rehearsal decision exists and is indexed", () => {
  assert.equal(existsSync(DECISION), true);
  const index = read(INDEX);
  assert.match(index, /personal-runtime-candidate-rehearsal-decision-20260721\.md/);
});

test("R6.4 binds reviewed source, archive, candidate, and native identities", () => {
  const decision = read(DECISION);
  requireTokens(
    decision,
    [
      "Decision: PASSED / CLOSED",
      "9b6b734f321b5708e621cdd7a6dba92a5dd0e036",
      "full_suite=1746 pass / 0 fail / 8 skip",
      "sha256=acbc27b55d0863fbff5dada85eec40993186012802eaba1a1291e132d194697b",
      "entry_count=614",
      "contains_source_git=false",
      "contains_source_node_modules=false",
      "node_version=v24.8.0",
      "NODE_MODULE_VERSION=137",
      "better-sqlite3=11.10.0",
      "@lancedb/lancedb=0.29.0",
      "source_runtime_equal=true",
      "difference_count=0",
      "candidate_build_identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718",
      "SQLite smoke:",
      "readback=native-ok",
      "LanceDB smoke:",
      "readback=lance-ok",
    ],
    "R6.4 candidate evidence",
  );
});

test("R6.4 freezes the candidate and records complete dependency/native evidence", () => {
  const decision = read(DECISION);
  requireTokens(
    decision,
    [
      "writable_files=0",
      "writable_directories=0",
      "candidate_root_mode=0500",
      "candidate_tree_sha256=5692d954c92b3dc3f10c0c645b14e71632abfe4346120461c409ad6c70bdb224",
      "better_sqlite3.node=be4109c5b07514ade1a2e1452cbed9fca25cbb8d025b76fa2a81e21a91286a05",
      "lancedb_linux_x64_gnu.node=9f0261d60d1181023d4ea48c5b871d19e9af010748ddbde057b94188f97921fd",
      "Any changed mode, file, dependency, archive, lockfile, runtime closure, or tree hash invalidates this candidate",
    ],
    "R6.4 frozen candidate",
  );
});

test("R6.4 proves independent C0 and exact R0 recovery copies", () => {
  const decision = read(DECISION);
  requireTokens(
    decision,
    [
      "byte_equal=true",
      "separate_inode=true",
      "backup_sha256=da9e443c416979ed71763ccc7cd00106597bed7a7dfdb064a3b507627b2c6f2a",
      "source_backup_shared_regular_file_inodes=0",
      "full_tree_diff=none",
      "tree_bytes=882079435",
      "rollback_tree_sha256=6da85f45dc433fe2874a8eaf0299643886d5825ff64910af9367195da3d1cdc9",
      "rollback_runtime_build_identity=86d04dd7b07bbd62948381f26dadd6b4e444b993ae7bdf6e535b0a5a8152f1f1",
      "R0 `better-sqlite3` completed an actual Node 24 / ABI 137",
      "REFRESH REQUIRED BEFORE LIVE EXECUTION",
    ],
    "R6.4 recovery evidence",
  );
});

test("R6.4 rehearses candidate to rollback to candidate through isolated OpenClaw", () => {
  const decision = read(DECISION);
  requireTokens(
    decision,
    [
      "OPENCLAW_STATE_DIR=/tmp/memory-engine-r6.4-9b6b734/sandbox-home/.openclaw",
      "Forward candidate installation",
      "installed_candidate_parity=true",
      "Rollback installation",
      "rollback_parity=true",
      "Final forward reinstallation",
      "final_candidate_parity=true",
      "candidate -> installed candidate",
      "installed candidate -> R0 rollback",
      "R0 rollback -> frozen candidate",
      "The real OpenClaw state directory was not used",
    ],
    "R6.4 isolated transaction",
  );
});

test("R6.4 records install-time data effects and stable-cwd requirement", () => {
  for (const text of [read(DECISION), read(DESIGN), read(RUNTIME_SYNC)]) {
    requireTokens(
      text,
      [
        "plugins install",
        "D0",
        "uv_cwd",
      ],
      "R6.4 operational finding",
    );
  }
  assert.match(read(DECISION), /stable working directory/i);
  assert.match(read(DESIGN), /stable working directory/i);
  assert.match(read(RUNTIME_SYNC), /稳定 cwd/);
  const decision = read(DECISION);
  requireTokens(
    decision,
    [
      "Plugin installation is not data-neutral",
      "attempted confidence-table initialization",
      "initialized sandbox LanceDB",
      "pre-install engine SQLite and LanceDB identities recorded",
      "post-install pre-start data identities recorded",
      "Install and verification require a stable working directory",
      "ENOENT: no such file or directory, uv_cwd",
      "Sandbox plugin import is not Gateway evidence",
    ],
    "R6.4 new constraint",
  );
});

test("R6.4 preserves the real environment and keeps R6.5 separate", () => {
  const decision = read(DECISION);
  requireTokens(
    decision,
    [
      "real_config_sha256=da9e443c416979ed71763ccc7cd00106597bed7a7dfdb064a3b507627b2c6f2a",
      "Gateway_PID=676",
      "real_plugin_install=not performed",
      "real_Gateway_stop/start/restart=not performed",
      "production_D0=not created",
      "offline candidate artifact=VALIDATED / FROZEN / EPHEMERAL",
      "B8-A7-R6.5 live remediation execution authorization packet=PASSED / CLOSED",
      "B8-A7-R6.5 live remediation execution=ROLLED BACK / SAFE",
      "candidate Gateway activation=NOT REACHED",
      "old runtime restored=TRUE",
      "B8-A7-R6.5.1 config semantic equivalence repair=PASSED / CLOSED",
      "R6.5 live retry=NOT AUTHORIZED",
      "explicit retry approval=NOT RECEIVED",
      "live retry candidate install/reload=NOT AUTHORIZED",
      "live retry Gateway stop/start/restart=NOT AUTHORIZED",
      "B8-A7 sustained runtime window=NOT AUTHORIZED",
      "B8-B removal=NOT AUTHORIZED",
    ],
    "R6.4 non-mutation boundary",
  );
});

test("ledger and devlog retain R6.4 closeout and record the later safe R6.5 rollback", () => {
  for (const text of [read(LEDGER), read(DEVLOG)]) {
    assert.match(
      text,
      /B8-A7-R6\.3 runtime-remediation authorization design(?:=|\s+)PASSED \/ CLOSED/,
    );
    assert.match(
      text,
      /B8-A7-R6\.4 offline candidate and rollback rehearsal(?:=|\s+)PASSED \/ CLOSED/,
    );
    assert.match(
      text,
      /B8-A7-R6\.5 live remediation execution authorization packet(?:=|\s+)PASSED \/ CLOSED/,
    );
    assert.match(
      text,
      /offline candidate artifact(?:=|\s+)VALIDATED \/ FROZEN \/ EPHEMERAL/,
    );
    assert.match(text, /B8-A7-R6\.5 live remediation execution(?:=|\s+)ROLLED BACK \/ SAFE/);
    assert.match(text, /candidate Gateway activation(?:=|\s+)NOT REACHED/);
    assert.match(text, /B8-A7-R6\.5\.1 config semantic equivalence repair(?:=|\s+)PASSED \/ CLOSED/);
    assert.match(text, /B8-A7-R6\.5\.2 live remediation retry authorization packet(?:=|\s+)IMPLEMENTED \/ EDI VERIFICATION PENDING/);
    assert.match(text, /R6\.5\.2 live retry execution(?:=|\s+)NOT AUTHORIZED/);
  }
});
