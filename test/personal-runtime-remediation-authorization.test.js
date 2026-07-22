import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

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

test("R6.3 runtime remediation design exists and is indexed", () => {
  assert.equal(existsSync(DESIGN), true);
  assert.equal(existsSync(RUNTIME_SYNC), true);
  const index = read(INDEX);
  assert.match(index, /personal-runtime-remediation-authorization\.md/);
  assert.match(index, /runtime-sync\.md/);
});

test("R6.3 rejects unsafe workspace, archive, link, and CLI-local runtime routes", () => {
  const design = read(DESIGN);
  requireTokens(
    design,
    [
      "Direct workspace directory install",
      "openclaw plugins install . --force",
      "approximately 938 MB",
      "does not install runtime dependencies",
      "Direct archive install",
      "npm install --omit=dev --ignore-scripts",
      "better-sqlite3",
      "Linked source install",
      "openclaw plugins install --link <source>",
      "CLI-local runtime inspection",
      "openclaw plugins inspect memory-engine --runtime --json",
      "Node 22 / ABI 127",
      "Node 24 Gateway",
    ],
    "R6.3 rejected route",
  );
});

test("R6.3 selects a dependency-complete Node 24 candidate", () => {
  const design = read(DESIGN);
  requireTokens(
    design,
    [
      "npm pack source archive",
      "exact reviewed package-lock.json",
      "Node 24 npm ci --omit=dev with lifecycle scripts enabled",
      "archive bytes=1215892",
      "unpacked bytes=5532037",
      "file count=612",
      "contains .git=false",
      "contains node_modules=false",
      "--ignore-scripts=false",
      "Node=v24.8.0",
      "NODE_MODULE_VERSION=137",
      "open :memory: database",
      "disposable LanceDB directory",
      "source_runtime_equal=true",
      "difference_count=0",
      "candidate runtime build identity",
    ],
    "R6.3 candidate",
  );
});

test("R6.3 binds independent config, runtime, host, and memory-data recovery evidence", () => {
  const design = read(DESIGN);
  requireTokens(
    design,
    [
      "C0: exact OpenClaw config backup",
      "R0: exact pre-change runtime recovery tree",
      "H0: host state evidence",
      "D0: quiesced memory-data snapshot",
      "separate inode",
      "R0 runtime build identity matches current runtime identity",
      "openclaw plugins registry --json",
      "Gateway PID/start timestamp",
      "~/.openclaw/memory/memory-engine",
      "~/.openclaw/memory/lancedb",
      "do not copy or manipulate the OpenClaw core DB",
      "Restoring it is a separate emergency action",
    ],
    "R6.3 recovery",
  );
});

test("R6.3 planned transaction uses the explicit Node 24 host entrypoint and stopped Gateway", () => {
  const design = read(DESIGN);
  requireTokens(
    design,
    [
      "$HOME/.local/node24/bin/node",
      "$HOME/.local/lib/node_modules/openclaw/openclaw.mjs",
      "gateway stop --json",
      "systemd service inactive",
      "Gateway port 18789 not listening",
      "plugins install \"$ARTIFACT_ROOT/candidate\" --force",
      "installed runtime parity against reviewed source=0",
      "native :memory: smoke passes",
      "gateway start --json",
      "new Gateway PID",
      "memoryEngine.sustainedRuntimePreflight",
      "tools.catalog",
      "{\"agentId\":\"edi\",\"includePlugins\":true}",
      "memory_engine",
      "memory_engine_search",
      "memory_engine_get",
    ],
    "R6.3 transaction",
  );
});

test("R6.3 defines fail-closed rollback branches without claiming exact sourcePath restoration", () => {
  const design = read(DESIGN);
  requireTokens(
    design,
    [
      "Install failure before publish",
      "Post-install disk verification failure",
      "Gateway start or loaded verification failure",
      "Memory-data incompatibility",
      "plugins install \"$ARTIFACT_ROOT/rollback-runtime\" --force",
      "rollback install record may now name `rollback-runtime` as its source path",
      "do not falsely claim the original sourcePath was restored",
      "Runtime rollback does not automatically restore D0",
      "Core DB restoration is outside this runbook",
    ],
    "R6.3 rollback",
  );
});

test("R6.3 separates offline preparation, live execution, and sustained authorization", () => {
  const design = read(DESIGN);
  requireTokens(
    design,
    [
      "R6.4 offline candidate and rollback rehearsal",
      "R6.5 live remediation execution authorization",
      "still requires explicit operator approval",
      "B8-A7 sustained runtime authorization",
      "offline candidate build=PASSED / FROZEN EPHEMERAL ARTIFACT",
      "completed transaction C0/R0/D0=EVIDENCE ONLY / NOT FRESH FOR RETRY",
      "fresh retry C0/R0/D0=NOT CREATED",
      "live retry plugin install/reload=NOT AUTHORIZED",
      "live retry Gateway stop/start/restart=NOT AUTHORIZED",
      "live retry native dependency build=NOT AUTHORIZED",
      "B8-A7 sustained runtime window=NOT AUTHORIZED",
      "B8-B removal=NOT AUTHORIZED",
    ],
    "R6.3 authorization boundary",
  );
});

test("runtime-sync routes operators to cold inspection and the R6.3 candidate model", () => {
  const runtimeSync = read(RUNTIME_SYNC);
  requireTokens(
    runtimeSync,
    [
      "openclaw plugins inspect memory-engine --json",
      "不要使用",
      "openclaw plugins inspect memory-engine --runtime --json",
      "不要把以下命令作为普通同步程序执行",
      "openclaw plugins install . --force",
      "personal-runtime-remediation-authorization.md",
      "npm ci --omit=dev",
      "$HOME/.local/node24/bin/node",
      "offline candidate artifact=ABSENT / REBUILD REQUIRED",
      "memory-engine-config-semantic-equivalence-v1",
      "R6.5.2 retry candidate install/reload=NOT PERFORMED",
      "R6.5.3A persistent artifact preparation=NOT AUTHORIZED",
      "R6.5.3B recovery-source rebase execution=NOT AUTHORIZED",
      "R6.5.3 candidate activation=NOT AUTHORIZED",
    ],
    "runtime sync",
  );
});

test("ledger and devlog retain R6.3/R6.4 and record the safe R6.5 rollback", () => {
  for (const text of [read(LEDGER), read(DEVLOG)]) {
    assert.match(
      text,
      /B8-A7-R6\.2 host activation boundary compatibility(?:=|\s+)PASSED \/ CLOSED/,
    );
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
    assert.match(text, /B8-A7-R6\.5 live remediation execution(?:=|\s+)ROLLED BACK \/ SAFE/);
    assert.match(text, /candidate Gateway activation(?:=|\s+)NOT REACHED/);
    assert.match(text, /B8-A7-R6\.5\.1 config semantic equivalence repair(?:=|\s+)PASSED \/ CLOSED/);
    assert.match(text, /B8-A7-R6\.5\.2 live remediation retry authorization packet(?:=|\s+)PASSED \/ CLOSED/);
    assert.match(text, /B8-A7-R6\.5\.2 live retry execution(?:=|\s+)BLOCKED \/ NO MUTATION/);
    assert.match(
      text,
      /B8-A7 sustained runtime authorization(?:=|\s+)WITHHELD \/ PERSONAL PROFILE REMEDIATION REQUIRED/,
    );
  }
});
