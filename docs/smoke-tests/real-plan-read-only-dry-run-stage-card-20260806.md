# Real-Plan Read-Only Dry-Run Stage Card — 2026-08-06

> Status: `READY_FOR_COMMIT`
>
> This card defines the protocol for a fresh real-plan read-only dry-run. It
> requires the exact execution commit to be supplied later as `AUTHORIZED_HEAD`
> after this Markdown is committed and the repository is clean. The execution
> commit must contain implementation fix
> `55b0874d19c090d293b86ca8a65dfe180f23efc4` as an ancestor. This card does
> not authorize `prepare`, claim creation, staging, candidate/R0 construction,
> publication, runtime installation, configuration mutation, service operation,
> database, session or memory access, tag, or push.

## Stage decision

Can the committed Candidate-Builder Harness validate a fresh, exact real plan
against the current source, active runtime, release runtime, configuration,
Node 24 toolchain, user-scoped systemd services, path policy, and sandbox
capability while reporting `mutation_count=0`?

## User value

A passing dry-run establishes that the real host bindings satisfy the frozen
Candidate-Builder contract before any separately authorized one-shot prepare
transaction is considered.

## In scope

1. Collect fresh read-only bindings in an independent WSL terminal.
2. Create one owner-only mode `0600` plan and one owner-only dry-run evidence
   file outside the authority publication parent.
3. Run exactly one `dry-run --plan` invocation and close all no-mutation gates.

## Non-goals

- no source edits or test edits;
- no Codex coding task;
- no Edi runtime verification;
- no `prepare`, `verify --authority`, claim, staging, candidate, R0, archive,
  native smoke, publication, install, reload, stop, start, or restart;
- no OpenClaw configuration write;
- no database, LanceDB, session, memory, or agent-state read;
- no commit, tag, or push.

## Pass criteria

1. The CLI returns `decision=PASS`, `mutation_count=0`, and an empty
   `preflight_findings` array.
2. Source HEAD/tree, configuration SHA-256, Gateway PID/restart count, Console
   PID/restart count, and persistent authority parent contents are unchanged
   before and after the dry-run.
3. No run claim, staging root, final authority root, candidate, or R0 path is
   created for the run ID.

## Allowed filesystem changes

Only these owner-only records may be created:

- one private directory under
  `$HOME/.openclaw/backups/memory-engine/runtime-authority-plans/`;
- one mode `0600` plan JSON file in that directory;
- one mode `0600` dry-run evidence JSON file in that directory.

The authority publication parent remains:

```text
$HOME/.openclaw/backups/memory-engine/runtime-authorities
```

It must remain mode `0700` and empty throughout this stage.

## Stop conditions

Stop immediately and do not retry under the same run ID if any of the following
occurs:

- `AUTHORIZED_HEAD` is absent or is not a full lowercase 40-hex commit;
- repository HEAD differs from `AUTHORIZED_HEAD`;
- implementation fix `55b0874d19c090d293b86ca8a65dfe180f23efc4`
  is not an ancestor of `AUTHORIZED_HEAD`;
- the source worktree is dirty;
- the active plugin root, release source path, or configuration path cannot be
  resolved exactly;
- active or release artifact manifest is invalid;
- runtime identity is invalid;
- Node is not `v24.8.0` with ABI `137`;
- either user service is not `active/running`;
- persistent authority parent is not owner-only mode `0700` or is non-empty;
- plan mode/owner validation fails;
- dry-run returns `REJECT`, nonzero mutation count, or any preflight finding;
- config, service, source, or authority-parent state drifts during execution.

A stopped or rejected run does not authorize repair, prepare, or automatic
retry. Report the evidence and await a new decision.

## Owner execution packet

Run the following only from the independent WSL terminal as user `lionsol`.
Do not run it through DevSpace.

Before execution, this corrected Stage Card must be committed and the
repository must be clean. GPT/Sol must then separately freeze the exact current
commit as `AUTHORIZED_HEAD`. Do not derive authorization from a branch name,
`origin/main`, a short hash, or `HEAD` at some later time. Do not weaken the
clean-worktree gate or add an ignore rule for this file.

### 1. Freeze the shell and source checkout

```bash
set -euo pipefail
umask 077

export REPO="$HOME/.openclaw/workspace/plugins/memory-engine"
export REQUIRED_IMPLEMENTATION_COMMIT="55b0874d19c090d293b86ca8a65dfe180f23efc4"
: "${AUTHORIZED_HEAD:?set AUTHORIZED_HEAD to the exact GPT/Sol-authorized full commit}"
export AUTHORIZED_HEAD
export NODE24="$HOME/.local/node24/bin/node"
export NODE24_BIN="$HOME/.local/node24/bin"
export OPENCLAW_BIN="$(command -v openclaw)"
export PLAN_PARENT="$HOME/.openclaw/backups/memory-engine/runtime-authority-plans"
export AUTHORITY_PARENT="$HOME/.openclaw/backups/memory-engine/runtime-authorities"

cd "$REPO"

[[ "$AUTHORIZED_HEAD" =~ ^[0-9a-f]{40}$ ]]
test "$(git rev-parse HEAD)" = "$AUTHORIZED_HEAD"
git merge-base --is-ancestor "$REQUIRED_IMPLEMENTATION_COMMIT" "$AUTHORIZED_HEAD"
test -z "$(git status --porcelain=v1)"
test "$($NODE24 --version)" = "v24.8.0"
test "$($NODE24 -p 'process.versions.modules')" = "137"
```

Remove only the invalid ignored placeholder left by the DevSpace write attempt:

```bash
rm -f "$REPO/tmp/memory-quality/real-plan-dry-run-20260806T043001Z-55b0874.json"
```

Validate the publication parent before creating any plan:

```bash
test -d "$AUTHORITY_PARENT"
test "$(stat -c '%a' "$AUTHORITY_PARENT")" = "700"
test "$(stat -c '%u' "$AUTHORITY_PARENT")" = "$(id -u)"
test "$(find "$AUTHORITY_PARENT" -mindepth 1 -maxdepth 1 | wc -l)" = "0"
```

### 2. Create the fresh mode-0600 real plan

Create a temporary generator outside the repository:

```bash
cat > /tmp/build-memory-engine-real-plan.mjs <<'NODE'
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const home = homedir();
const repo = process.env.REPO;
const authorizedHead = process.env.AUTHORIZED_HEAD;
const nodeExecutable = realpathSync(process.env.NODE24);
const openclaw = process.env.OPENCLAW_BIN;
const planParent = process.env.PLAN_PARENT;
const authorityParent = process.env.AUTHORITY_PARENT;

if (!repo || !authorizedHead || !openclaw || !planParent || !authorityParent) {
  throw new Error("required execution environment missing");
}

const fixedEnv = {
  HOME: home,
  PATH: `${process.env.NODE24_BIN}:/usr/bin:/bin`,
  LC_ALL: "C",
  TZ: "UTC",
};

function run(executable, args, options = {}) {
  return execFileSync(executable, args, {
    cwd: options.cwd,
    env: { ...fixedEnv, ...(options.env || {}) },
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertRegularRealpath(path, label) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  if (realpathSync(path) !== path) throw new Error(`${label} must be a realpath`);
  return path;
}

function firstLine(text) {
  const line = String(text).trim().split(/\r?\n/, 1)[0];
  if (!line) throw new Error("empty version output");
  return line;
}

function tool(kind, path, args = ["--version"], invocation = path) {
  assertRegularRealpath(path, kind);
  return {
    path,
    sha256: sha256(path),
    version: firstLine(run(invocation, args)),
  };
}

function expandHome(path) {
  return path === "~" ? home : path.startsWith("~/") ? join(home, path.slice(2)) : path;
}

function exactServiceStatus(unit) {
  const uid = process.getuid();
  const runtimeDir = `/run/user/${uid}`;
  const output = run("/usr/bin/systemctl", [
    "--user",
    "show",
    unit,
    "--property=ActiveState,SubState,MainPID,NRestarts",
    "--no-pager",
  ], {
    env: {
      XDG_RUNTIME_DIR: runtimeDir,
      DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtimeDir}/bus`,
    },
  });
  const fields = Object.fromEntries(output.split(/\r?\n/).filter(Boolean).map(line => {
    const at = line.indexOf("=");
    if (at <= 0) throw new Error(`invalid systemd output for ${unit}`);
    return [line.slice(0, at), line.slice(at + 1)];
  }));
  const keys = Object.keys(fields).sort().join(",");
  if (keys !== ["ActiveState", "MainPID", "NRestarts", "SubState"].sort().join(",")) {
    throw new Error(`unexpected systemd fields for ${unit}`);
  }
  if (fields.ActiveState !== "active" || fields.SubState !== "running") {
    throw new Error(`${unit} is not active/running`);
  }
  if (!/^\d+$/.test(fields.MainPID) || !/^\d+$/.test(fields.NRestarts)) {
    throw new Error(`invalid counters for ${unit}`);
  }
  return {
    pid: Number(fields.MainPID),
    restart_count: Number(fields.NRestarts),
  };
}

const head = run("/usr/bin/git", ["rev-parse", "HEAD"], { cwd: repo });
if (head !== authorizedHead) throw new Error(`HEAD mismatch:${head}`);
if (run("/usr/bin/git", ["status", "--porcelain=v1"], { cwd: repo })) {
  throw new Error("source worktree is dirty");
}

const sourceTree = run("/usr/bin/git", ["rev-parse", `${head}^{tree}`], { cwd: repo });
const originRemote = run("/usr/bin/git", ["remote", "get-url", "origin"], { cwd: repo });
const inspect = JSON.parse(run(openclaw, ["plugins", "inspect", "memory-engine", "--json"]));
const activeRoot = realpathSync(inspect?.plugin?.rootDir);
const activeRelease = realpathSync(inspect?.install?.sourcePath);
const configPath = realpathSync(expandHome(run(openclaw, ["config", "file"])));

const { buildRuntimeArtifactManifestV2 } = require(join(repo, "bin/runtime-artifact-manifest-v2-lib.cjs"));
const { buildRuntimeBuildIdentity } = await import(`file://${join(repo, "lib/version/runtime-build-identity.js")}`);

const sourceRuntime = buildRuntimeBuildIdentity({ rootDir: repo });
const activeRuntime = buildRuntimeBuildIdentity({ rootDir: activeRoot });
const releaseRuntime = buildRuntimeBuildIdentity({ rootDir: activeRelease });
for (const [label, value] of [["source", sourceRuntime], ["active", activeRuntime], ["release", releaseRuntime]]) {
  if (!value.valid || !/^[0-9a-f]{64}$/.test(value.identity)) throw new Error(`${label} runtime identity invalid`);
}

const activeManifest = buildRuntimeArtifactManifestV2({ rootDir: activeRoot });
const releaseManifest = buildRuntimeArtifactManifestV2({ rootDir: activeRelease });
for (const [label, value] of [["active", activeManifest], ["release", releaseManifest]]) {
  if (!value.valid || value.external_symlink_count !== 0 || value.dangling_symlink_count !== 0) {
    throw new Error(`${label} artifact manifest invalid`);
  }
}

const npmCli = realpathSync(resolve(dirname(nodeExecutable), "../lib/node_modules/npm/bin/npm-cli.js"));
const nodeGypRoot = realpathSync(resolve(dirname(nodeExecutable), "../lib/node_modules/npm/node_modules"));
const nodeGypManifest = buildRuntimeArtifactManifestV2({ rootDir: nodeGypRoot });
if (!nodeGypManifest.valid || nodeGypManifest.external_symlink_count !== 0 || nodeGypManifest.dangling_symlink_count !== 0) {
  throw new Error("node-gyp closure manifest invalid");
}

const nodeTool = tool("node", nodeExecutable);
const npmTool = tool("npm", npmCli, [npmCli, "--version"], nodeExecutable);
const gitTool = tool("git", "/usr/bin/git");
const tarTool = tool("tar", "/usr/bin/tar");
const unshareTool = tool("unshare", "/usr/bin/unshare");
const mountTool = tool("mount", "/usr/bin/mount");
const chrootTool = tool("chroot", "/usr/sbin/chroot");
const systemctlTool = tool("systemctl", "/usr/bin/systemctl");
const pythonTool = tool("python", "/usr/bin/python3.12");
const ccTool = tool("cc", "/usr/bin/x86_64-linux-gnu-gcc-13");
const cxxTool = tool("cxx", "/usr/bin/x86_64-linux-gnu-g++-13");
const makeTool = tool("make", "/usr/bin/make");
const arTool = tool("ar", "/usr/bin/x86_64-linux-gnu-ar");

const abi = Number(run(nodeExecutable, ["-p", "process.versions.modules"]));
if (nodeTool.version !== "v24.8.0" || abi !== 137) throw new Error("Node 24 binding mismatch");

const gateway = exactServiceStatus("openclaw-gateway.service");
const consoleService = exactServiceStatus("memory-console.service");

const now = new Date();
const expires = new Date(now.getTime() + 20 * 60 * 1000);
const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const runId = `real-plan-dry-run-${stamp}-${head.slice(0, 7)}`;
mkdirSync(planParent, { recursive: true, mode: 0o700 });
chmodSync(planParent, 0o700);
const planPath = join(planParent, `${runId}.json`);

const plan = {
  schema: "memory-engine-runtime-authority-plan-v1",
  run_id: runId,
  created_at: now.toISOString(),
  expires_at: expires.toISOString(),
  operator_home: join(home, ".openclaw"),
  source_repo: repo,
  source_commit: head,
  source_tree_identity: sourceTree,
  origin_remote: originRemote,
  active_root: activeRoot,
  active_release: activeRelease,
  config_path: configPath,
  persistent_parent: authorityParent,
  node_executable: nodeTool.path,
  npm_cli: npmTool.path,
  git_executable: gitTool.path,
  tar_executable: tarTool.path,
  unshare_executable: unshareTool.path,
  mount_executable: mountTool.path,
  chroot_executable: chrootTool.path,
  systemctl_executable: systemctlTool.path,
  gateway_unit: "openclaw-gateway.service",
  console_unit: "memory-console.service",
  expected_package_json_sha256: sha256(join(repo, "package.json")),
  expected_package_lock_sha256: sha256(join(repo, "package-lock.json")),
  expected_source_runtime_identity: sourceRuntime.identity,
  expected_active_runtime_identity: activeRuntime.identity,
  expected_active_artifact_semantic_identity: activeManifest.semantic_identity,
  expected_active_artifact_topology_identity: activeManifest.topology_identity,
  expected_active_artifact_exact_identity: activeManifest.exact_identity,
  expected_release_runtime_identity: releaseRuntime.identity,
  expected_release_artifact_semantic_identity: releaseManifest.semantic_identity,
  expected_release_artifact_topology_identity: releaseManifest.topology_identity,
  expected_release_artifact_exact_identity: releaseManifest.exact_identity,
  expected_config_sha256: sha256(configPath),
  expected_gateway_pid: gateway.pid,
  expected_gateway_restart_count: gateway.restart_count,
  expected_console_pid: consoleService.pid,
  expected_console_restart_count: consoleService.restart_count,
  expected_node_version: nodeTool.version,
  expected_node_abi: abi,
  expected_node_executable_sha256: nodeTool.sha256,
  expected_npm_version: npmTool.version,
  expected_npm_cli_sha256: npmTool.sha256,
  expected_git_version: gitTool.version,
  expected_git_executable_sha256: gitTool.sha256,
  expected_tar_version: tarTool.version,
  expected_tar_executable_sha256: tarTool.sha256,
  expected_unshare_version: unshareTool.version,
  expected_unshare_executable_sha256: unshareTool.sha256,
  expected_mount_version: mountTool.version,
  expected_mount_executable_sha256: mountTool.sha256,
  expected_systemctl_version: systemctlTool.version,
  expected_systemctl_executable_sha256: systemctlTool.sha256,
  targeted_test_files: ["test/runtime-build-identity.test.js"],
  expected_chroot_version: chrootTool.version,
  expected_chroot_executable_sha256: chrootTool.sha256,
  python_executable: pythonTool.path,
  expected_python_executable_sha256: pythonTool.sha256,
  expected_python_version: pythonTool.version,
  cc_executable: ccTool.path,
  expected_cc_executable_sha256: ccTool.sha256,
  expected_cc_version: ccTool.version,
  cxx_executable: cxxTool.path,
  expected_cxx_executable_sha256: cxxTool.sha256,
  expected_cxx_version: cxxTool.version,
  make_executable: makeTool.path,
  expected_make_executable_sha256: makeTool.sha256,
  expected_make_version: makeTool.version,
  ar_executable: arTool.path,
  expected_ar_executable_sha256: arTool.sha256,
  expected_ar_version: arTool.version,
  node_gyp_root: nodeGypRoot,
  expected_node_gyp_tree_identity: nodeGypManifest.exact_identity,
};

writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600, flag: "wx" });
chmodSync(planPath, 0o600);
const stats = lstatSync(planPath);
if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o7777) !== 0o600 || stats.uid !== process.getuid()) {
  throw new Error("plan ownership or mode validation failed");
}

process.stdout.write(`${JSON.stringify({
  plan_path: planPath,
  plan_sha256: sha256(planPath),
  run_id: runId,
  created_at: plan.created_at,
  expires_at: plan.expires_at,
  source_commit: head,
  source_tree_identity: sourceTree,
  source_runtime_identity: sourceRuntime.identity,
  active_runtime_identity: activeRuntime.identity,
  release_runtime_identity: releaseRuntime.identity,
  config_sha256: plan.expected_config_sha256,
  gateway,
  console: consoleService,
  node_gyp_root: nodeGypRoot,
  node_gyp_tree_identity: nodeGypManifest.exact_identity,
}, null, 2)}\n`);
NODE

PLAN_META="$($NODE24 /tmp/build-memory-engine-real-plan.mjs)"
printf '%s\n' "$PLAN_META"
export PLAN_PATH="$(printf '%s' "$PLAN_META" | $NODE24 -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).plan_path))')"
export RUN_ID="$(printf '%s' "$PLAN_META" | $NODE24 -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).run_id))')"
export PLAN_SHA256="$(sha256sum "$PLAN_PATH" | awk '{print $1}')"

stat -c 'plan=%n mode=%a uid=%u gid=%g size=%s' "$PLAN_PATH"
printf 'plan_sha256=%s\nrun_id=%s\n' "$PLAN_SHA256" "$RUN_ID"
test "$(stat -c '%a' "$PLAN_PATH")" = "600"
test "$(stat -c '%u' "$PLAN_PATH")" = "$(id -u)"
```

Do not manually edit the generated plan. If any bound fact is wrong, stop and
create a new run ID only after a new authorization.

### 3. Capture pre-dry-run invariants

```bash
export BEFORE_HEAD="$(git rev-parse HEAD)"
export BEFORE_TREE="$(git rev-parse HEAD^{tree})"
export BEFORE_CONFIG_SHA="$(sha256sum "$HOME/.openclaw/openclaw.json" | awk '{print $1}')"
export BEFORE_GATEWAY="$(systemctl --user show openclaw-gateway.service --property=ActiveState,SubState,MainPID,NRestarts --no-pager | sort)"
export BEFORE_CONSOLE="$(systemctl --user show memory-console.service --property=ActiveState,SubState,MainPID,NRestarts --no-pager | sort)"
export BEFORE_AUTHORITY_COUNT="$(find "$AUTHORITY_PARENT" -mindepth 1 -maxdepth 1 | wc -l)"

test "$BEFORE_HEAD" = "$AUTHORIZED_HEAD"
test "$BEFORE_AUTHORITY_COUNT" = "0"
test ! -e "$AUTHORITY_PARENT/.staging-$RUN_ID"
test ! -e "$AUTHORITY_PARENT/$RUN_ID"
test ! -e "$AUTHORITY_PARENT/.run-claims/$RUN_ID.json"
```

### 4. Execute exactly one read-only dry-run

```bash
export DRY_RUN_EVIDENCE="${PLAN_PATH%.json}.dry-run.json"

$NODE24 bin/prepare-runtime-authority.cjs \
  dry-run \
  --plan "$PLAN_PATH" \
  --pretty \
  > "$DRY_RUN_EVIDENCE"

chmod 600 "$DRY_RUN_EVIDENCE"
stat -c 'evidence=%n mode=%a uid=%u gid=%g size=%s' "$DRY_RUN_EVIDENCE"
cat "$DRY_RUN_EVIDENCE"
```

Do not run `prepare` after this command, even if the dry-run passes.

### 5. Enforce the dry-run result contract

```bash
$NODE24 - "$DRY_RUN_EVIDENCE" "$AUTHORIZED_HEAD" <<'NODE'
const fs = require("node:fs");
const result = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const authorizedHead = process.argv[3];
if (result.schema !== "memory-engine-runtime-authority-dry-run-v1") throw new Error("dry-run schema mismatch");
if (result.decision !== "PASS") throw new Error(`dry-run rejected:${JSON.stringify(result.preflight_findings)}`);
if (result.mutation_count !== 0) throw new Error(`unexpected mutation_count:${result.mutation_count}`);
if (!Array.isArray(result.preflight_findings) || result.preflight_findings.length !== 0) throw new Error("preflight findings are not empty");
if (result.validated_bindings?.source_commit !== authorizedHead) throw new Error("validated source commit mismatch");
process.stdout.write(JSON.stringify({
  decision: result.decision,
  mutation_count: result.mutation_count,
  plan_sha256: result.plan_sha256,
  validated_bindings: result.validated_bindings,
  planned_operations: result.planned_operations,
  preflight_findings: result.preflight_findings,
}, null, 2) + "\n");
NODE
```

### 6. Close the no-mutation gates

```bash
export AFTER_HEAD="$(git rev-parse HEAD)"
export AFTER_TREE="$(git rev-parse HEAD^{tree})"
export AFTER_CONFIG_SHA="$(sha256sum "$HOME/.openclaw/openclaw.json" | awk '{print $1}')"
export AFTER_GATEWAY="$(systemctl --user show openclaw-gateway.service --property=ActiveState,SubState,MainPID,NRestarts --no-pager | sort)"
export AFTER_CONSOLE="$(systemctl --user show memory-console.service --property=ActiveState,SubState,MainPID,NRestarts --no-pager | sort)"
export AFTER_AUTHORITY_COUNT="$(find "$AUTHORITY_PARENT" -mindepth 1 -maxdepth 1 | wc -l)"

test "$AFTER_HEAD" = "$BEFORE_HEAD"
test "$AFTER_TREE" = "$BEFORE_TREE"
test "$AFTER_CONFIG_SHA" = "$BEFORE_CONFIG_SHA"
test "$AFTER_GATEWAY" = "$BEFORE_GATEWAY"
test "$AFTER_CONSOLE" = "$BEFORE_CONSOLE"
test "$AFTER_AUTHORITY_COUNT" = "$BEFORE_AUTHORITY_COUNT"
test "$AFTER_AUTHORITY_COUNT" = "0"
test ! -e "$AUTHORITY_PARENT/.staging-$RUN_ID"
test ! -e "$AUTHORITY_PARENT/$RUN_ID"
test ! -e "$AUTHORITY_PARENT/.run-claims/$RUN_ID.json"
test -z "$(git status --porcelain=v1)"

printf '%s\n' \
  "REAL_PLAN_DRY_RUN=PASS" \
  "HEAD=$AFTER_HEAD" \
  "PLAN_PATH=$PLAN_PATH" \
  "PLAN_SHA256=$PLAN_SHA256" \
  "DRY_RUN_EVIDENCE=$DRY_RUN_EVIDENCE" \
  "RUN_ID=$RUN_ID" \
  "AUTHORITY_PARENT_COUNT=$AFTER_AUTHORITY_COUNT"
```

## Required execution report

Return only the following evidence to GPT for review:

```text
stage=Real-Plan Read-Only Dry-Run
result=PASS | REJECT | STOPPED
authorized_head=<full authorized commit>
HEAD=<full commit>
source_tree_identity=<full tree>
run_id=<run id>
plan_path=<absolute path>
plan_sha256=<sha256>
plan_mode=<mode>
dry_run_evidence=<absolute path>
decision=<PASS or REJECT>
mutation_count=<integer>
preflight_findings=<JSON array>
gateway_before_after=<same or drift>
console_before_after=<same or drift>
config_before_after=<same or drift>
authority_parent_before_after=<counts>
claim_created=false | true
staging_created=false | true
final_root_created=false | true
prepare_invoked=false
```

If the result is `REJECT` or `STOPPED`, include the exact first failing command
and its stderr. Do not repair, retry, or continue into prepare.

## Current non-authoritative inspection baseline

The following was observed during prior read-only inspection and is supplied
only as a comparison aid. The owner execution must collect fresh values and may
not copy these into the plan without recalculation.

```text
required_implementation_commit=55b0874d19c090d293b86ca8a65dfe180f23efc4
Node=v24.8.0
Node ABI=137
Gateway=active/running PID 204419 NRestarts 0
Console=active/running PID 693 NRestarts 0
config_sha256=2ce0efff8aa0354458062e1dbdab25a14ccd1542dfa7028aa1807577fc83e3f7
authority_parent=mode 0700, empty
```

These values are not execution authority and may legitimately drift before the
owner runs this card. Any drift must be freshly bound or treated as a stop
condition according to the card.
