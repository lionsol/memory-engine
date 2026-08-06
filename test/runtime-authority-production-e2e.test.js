import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildRuntimeArtifactManifestV2 } from "../bin/runtime-artifact-manifest-v2-lib.cjs";
import { buildRuntimeBuildIdentity, REQUIRED_RUNTIME_FILES, ROOT_RUNTIME_FILES } from "../lib/version/runtime-build-identity.js";
import { claimPath } from "../lib/runtime-authority/evidence.js";
import { assertRuntimeIdentity } from "../lib/runtime-authority/stage-handlers.js";
import { assertPublishedClaim } from "../lib/runtime-authority/verify.js";

const NODE = "/home/lionsol/.local/node24/bin/node";
const NPM = "/home/lionsol/.local/node24/lib/node_modules/npm/bin/npm-cli.js";
const PYTHON = "/usr/bin/python3.12";
const CC = "/usr/bin/x86_64-linux-gnu-gcc-13";
const CXX = "/usr/bin/x86_64-linux-gnu-g++-13";
const MAKE = "/usr/bin/make";
const AR = "/usr/bin/x86_64-linux-gnu-ar";
const NODE_GYP_ROOT = "/home/lionsol/.local/node24/lib/node_modules/npm/node_modules";
const ENV = { PATH: "/home/lionsol/.local/node24/bin:/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" };

function hash(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function version(executable, args = ["--version"]) { return execFileSync(executable, args, { env: ENV, encoding: "utf8" }).trim().split(/\r?\n/, 1)[0]; }
function tool(path, invoke = path) { return { path, sha256: hash(path), version: version(invoke) }; }
function writeJson(path, value, mode = 0o600) { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); writeFileSync(path, `${JSON.stringify(value)}\n`, { mode }); chmodSync(path, mode); }
function writeText(path, text, mode = 0o500) { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); writeFileSync(path, text, { mode }); chmodSync(path, mode); }
function makeRemovable(root) { chmodSync(root, 0o700); for (const entry of readdirSync(root, { withFileTypes: true })) { const child = join(root, entry.name); if (entry.isDirectory() && !entry.isSymbolicLink()) makeRemovable(child); else if (entry.isFile()) chmodSync(child, 0o600); } }

const SQLITE_STUB = `class Database {\n  constructor(filename) { this.filename = filename; }\n  prepare(sql) { return { get: () => ({ version: "synthetic-sqlite" }) }; }\n  close() {}\n}\nmodule.exports = Database;\n`;
const LANCEDB_STUB = `const fs = require("node:fs");\nasync function connect(root) {\n  fs.mkdirSync(root, { recursive: true });\n  return {\n    async createTable(name, rows) {\n      fs.writeFileSync(require("node:path").join(root, name + ".json"), JSON.stringify(rows));\n      return { query: () => ({ limit: () => ({ toArray: async () => rows }) }) };\n    },\n  };\n}\nmodule.exports = { connect };\n`;

function writeStubSource(source, { sqlite, lancedb, sqliteLoadThrows = false, lancedbLoadThrows = false }) {
  if (sqlite) {
    writeJson(join(source, "stubs/better-sqlite3/package.json"), { name: "better-sqlite3", version: "99.0.0-synthetic", main: "index.js" });
    writeText(join(source, "stubs/better-sqlite3/index.js"), sqliteLoadThrows ? "throw new Error('synthetic sqlite load failure');\n" : SQLITE_STUB);
  }
  if (lancedb) {
    writeJson(join(source, "stubs/lancedb/package.json"), { name: "@lancedb/lancedb", version: "99.0.0-synthetic", main: "index.js" });
    writeText(join(source, "stubs/lancedb/index.js"), lancedbLoadThrows ? "throw new Error('synthetic lancedb load failure');\n" : LANCEDB_STUB);
  }
}

function writeInstalledStubs(root, { sqlite, lancedb }) {
  if (sqlite) {
    writeJson(join(root, "node_modules/better-sqlite3/package.json"), { name: "better-sqlite3", version: "99.0.0-synthetic", main: "index.js" });
    writeText(join(root, "node_modules/better-sqlite3/index.js"), SQLITE_STUB);
  }
  if (lancedb) {
    writeJson(join(root, "node_modules/@lancedb/lancedb/package.json"), { name: "@lancedb/lancedb", version: "99.0.0-synthetic", main: "index.js" });
    writeText(join(root, "node_modules/@lancedb/lancedb/index.js"), LANCEDB_STUB);
  }
}

function writeRuntimeClosure(root, packageJson) {
  for (const relativePath of [...REQUIRED_RUNTIME_FILES, ...ROOT_RUNTIME_FILES, "lib/synthetic-runtime.js"]) {
    if (relativePath === "package.json") writeJson(join(root, relativePath), packageJson);
    else if (relativePath === "openclaw.plugin.json") writeJson(join(root, relativePath), { id: "synthetic-memory-engine" });
    else writeText(join(root, relativePath), relativePath === "index.js" ? "module.exports = 42;\n" : "module.exports = { synthetic: true };\n");
  }
}

function installScript({ mutateRuntime = false, externalNodeGypLink = null } = {}) {
  return [
    "const fs=require('node:fs');",
    "const path=require('node:path');",
    "const cp=require('node:child_process');",
    "const python=cp.spawnSync(process.env.PYTHON,['-c',\"import encodings,os,sysconfig; include=sysconfig.get_path('include'); stdlib=sysconfig.get_path('stdlib'); assert include and os.path.isdir(include); assert stdlib and os.path.isdir(stdlib)\"],{stdio:'pipe'});",
    "if(python.status!==0)throw new Error(String(python.stderr));",
    "const gyp=path.join(process.cwd(),'binding.gyp');",
    "const cc=path.join(process.cwd(),'binding.cc');",
    "fs.writeFileSync(gyp,JSON.stringify({targets:[{target_name:'synthetic',sources:['binding.cc']}]}));",
    "fs.writeFileSync(cc,'#include <node.h>\\nnamespace synthetic { void Init(v8::Local<v8::Object>) {} }\\nNODE_MODULE(NODE_GYP_MODULE_NAME, synthetic::Init)\\n');",
    "const nodeGyp=path.join(process.env.NODE_GYP_ROOT,'node-gyp','bin','node-gyp.js');",
    "const built=cp.spawnSync(process.execPath,[nodeGyp,'configure','build','--nodedir=/runtime'],{cwd:process.cwd(),stdio:'pipe'});",
    "if(built.status!==0)throw new Error(String(built.stderr));",
    "fs.writeFileSync('/dev/null','lifecycle');",
    "const fd=fs.openSync('/dev/urandom','r');const random=Buffer.alloc(8);fs.readSync(fd,random,0,8,null);fs.closeSync(fd);",
    "fs.writeFileSync(path.join(process.cwd(),'lifecycle-random.txt'),random.toString('hex'));",
    "const bin=path.join(process.cwd(),'node_modules','.bin');fs.mkdirSync(bin,{recursive:true});",
    "for(const name of ['cli','pkg-cli','tool','tool-alt'])fs.symlinkSync('../../install.js',path.join(bin,name));",
    "const hard=path.join(process.cwd(),'node_modules','lifecycle-hard-a');fs.writeFileSync(hard,'hard\\n');fs.linkSync(hard,path.join(process.cwd(),'node_modules','lifecycle-hard-b'));",
    "const transient=path.join(process.cwd(),'build','node_gyp_bins','python3');if(fs.existsSync(transient)){if(!fs.lstatSync(transient).isSymbolicLink())throw new Error('unexpected node-gyp link type');fs.unlinkSync(transient);}",
    externalNodeGypLink ? `const externalLink=path.join(${JSON.stringify(externalNodeGypLink === "dependency" ? "node_modules/better-sqlite3/build/node_gyp_bins/python3" : "build/node_gyp_bins/python3")});fs.mkdirSync(path.dirname(externalLink),{recursive:true});fs.symlinkSync('/usr/bin/python3',externalLink);` : "",
    mutateRuntime ? "fs.appendFileSync(path.join(process.cwd(),'index.js'),'mutation\\n');" : "",
  ].join("\n");
}

function makeProductionFixture({ lifecycle = false, native = { sqlite: true, lancedb: true }, sqliteLoadThrows = false, lancedbLoadThrows = false, mutateRuntime = false, omitPackedRuntimeFile = null, externalNodeGypLink = null, stabilityDrift = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "runtime-authority-production-"));
  const source = join(root, "source"); const active = join(root, "active"); const release = join(root, "release"); const parent = join(root, "authority"); const config = join(root, "config.json"); const planPath = join(root, "plan.json");
  for (const path of [source, active, release, parent]) mkdirSync(path, { recursive: true, mode: 0o700 });
  const dependencies = {};
  if (native.sqlite) dependencies["better-sqlite3"] = "file:stubs/better-sqlite3";
  if (native.lancedb) dependencies["@lancedb/lancedb"] = "file:stubs/lancedb";
  const pkg = { name: "synthetic-memory-engine", version: "1.0.0", main: "index.js", dependencies };
  if (lifecycle) pkg.scripts = { install: "node install.js" };
  if (omitPackedRuntimeFile) pkg.files = [...REQUIRED_RUNTIME_FILES, ...ROOT_RUNTIME_FILES, "lib/**", "stubs/**", "install.js"].filter(path => path !== omitPackedRuntimeFile);
  writeRuntimeClosure(source, pkg);
  writeStubSource(source, { sqlite: native.sqlite, lancedb: native.lancedb, sqliteLoadThrows, lancedbLoadThrows });
  if (lifecycle) writeText(join(source, "install.js"), installScript({ mutateRuntime, externalNodeGypLink }));
  execFileSync(NODE, [NPM, "install", "--package-lock-only", "--ignore-scripts", "--offline", "--no-audit", "--no-fund"], { cwd: source, env: ENV, encoding: "utf8" });
  writeRuntimeClosure(active, pkg); writeRuntimeClosure(release, pkg);
  writeInstalledStubs(active, native); writeInstalledStubs(release, native);
  writeText(join(active, "canary"), "active\n", 0o400); writeText(join(release, "canary"), "release\n", 0o400);
  writeText(config, "synthetic-config\n", 0o600);
  const systemctl = join(root, "systemctl");
  const systemctlCount = join(root, "systemctl-count");
  writeText(systemctl, [
    "#!/bin/sh",
    `COUNT=${JSON.stringify(systemctlCount)}`,
    `CONFIG=${JSON.stringify(config)}`,
    `DRIFT=${JSON.stringify(stabilityDrift || "")}`,
    "if [ \"$1\" = \"--version\" ]; then echo synthetic-systemctl; exit 0; fi",
    "[ \"$1\" = \"--user\" ] && [ \"$2\" = \"show\" ] || exit 91",
    "[ -n \"$XDG_RUNTIME_DIR\" ] || exit 92",
    "[ \"$DBUS_SESSION_BUS_ADDRESS\" = \"unix:path=$XDG_RUNTIME_DIR/bus\" ] || exit 93",
    "unit=$3",
    "count=0; if [ -f \"$COUNT\" ]; then count=$(cat \"$COUNT\"); fi; count=$((count + 1)); printf '%s\\n' \"$count\" > \"$COUNT\"",
    "pid=123; restarts=0; active=active; running=running",
    "if [ \"$count\" -gt 2 ]; then case \"$DRIFT\" in",
    `config) printf 'synthetic-config-drift\\n' > \"$CONFIG\" ;;`,
    `gateway_pid) [ \"$unit\" = \"synthetic-gateway.service\" ] && pid=999 ;;`,
    `gateway_restart) [ \"$unit\" = \"synthetic-gateway.service\" ] && restarts=1 ;;`,
    `console_pid) [ \"$unit\" = \"synthetic-console.service\" ] && pid=998 ;;`,
    `console_restart) [ \"$unit\" = \"synthetic-console.service\" ] && restarts=1 ;;`,
    "esac; fi",
    "printf 'MainPID=%s\\nNRestarts=%s\\nSubState=%s\\nActiveState=%s\\n' \"$pid\" \"$restarts\" \"$running\" \"$active\"",
    "",
  ].join("\n"), 0o755);
  const operatorHome = join(root, "operator-home"); mkdirSync(join(operatorHome, "sessions"), { recursive: true, mode: 0o700 }); mkdirSync(join(operatorHome, "memory"), { recursive: true, mode: 0o700 }); mkdirSync(join(operatorHome, "python-site-packages"), { recursive: true, mode: 0o700 });
  writeText(join(operatorHome, "sessions/canary"), "secret\n", 0o600); writeText(join(operatorHome, "memory/canary"), "secret\n", 0o600); writeText(join(operatorHome, "python-site-packages/canary"), "secret\n", 0o600);
  const git = (...args) => execFileSync("/usr/bin/git", args, { cwd: source, env: ENV, encoding: "utf8" });
  git("init", "-q"); git("config", "user.email", "synthetic@example.test"); git("config", "user.name", "Synthetic"); git("add", "."); git("commit", "-qm", "initial"); git("remote", "add", "origin", "synthetic-origin");
  const commit = git("rev-parse", "HEAD").trim(); const tree = git("rev-parse", "HEAD^{tree}").trim();
  const sourceRuntime = buildRuntimeBuildIdentity({ rootDir: source }); const activeRuntime = buildRuntimeBuildIdentity({ rootDir: active }); const releaseRuntime = buildRuntimeBuildIdentity({ rootDir: release });
  assert.equal(sourceRuntime.valid, true); assert.equal(activeRuntime.valid, true); assert.equal(releaseRuntime.valid, true);
  const activeManifest = buildRuntimeArtifactManifestV2({ rootDir: active }); const releaseManifest = buildRuntimeArtifactManifestV2({ rootDir: release });
  assert.equal(activeManifest.valid, true); assert.equal(releaseManifest.valid, true);
  const nodeTool = tool(NODE); const npmTool = { path: NPM, sha256: hash(NPM), version: version(NODE, [NPM, "--version"]) }; const gitTool = tool("/usr/bin/git"); const tarTool = tool("/usr/bin/tar"); const unshareTool = tool("/usr/bin/unshare"); const mountTool = tool("/usr/bin/mount"); const chrootTool = tool("/usr/sbin/chroot"); const serviceTool = tool(systemctl);
  const pythonTool = tool(PYTHON); const ccTool = tool(CC); const cxxTool = tool(CXX); const makeTool = tool(MAKE); const arTool = tool(AR);
  const nodeGypManifest = buildRuntimeArtifactManifestV2({ rootDir: NODE_GYP_ROOT }); assert.equal(nodeGypManifest.valid, true);
  const plan = {
    schema: "memory-engine-runtime-authority-plan-v1", run_id: `synthetic-production-${lifecycle ? "lifecycle" : "basic"}-${Date.now()}`, created_at: new Date(Date.now() - 1000).toISOString(), expires_at: new Date(Date.now() + 300000).toISOString(),
    operator_home: operatorHome, source_repo: source, source_commit: commit, source_tree_identity: tree, origin_remote: "synthetic-origin", active_root: active, active_release: release, config_path: config, persistent_parent: parent,
    node_executable: NODE, npm_cli: NPM, git_executable: gitTool.path, tar_executable: tarTool.path, unshare_executable: unshareTool.path, mount_executable: mountTool.path, chroot_executable: chrootTool.path, systemctl_executable: systemctl,
    gateway_unit: "synthetic-gateway.service", console_unit: "synthetic-console.service", expected_package_json_sha256: hash(join(source, "package.json")), expected_package_lock_sha256: hash(join(source, "package-lock.json")), expected_source_runtime_identity: sourceRuntime.identity,
    expected_active_runtime_identity: activeRuntime.identity, expected_active_artifact_semantic_identity: activeManifest.semantic_identity, expected_active_artifact_topology_identity: activeManifest.topology_identity, expected_active_artifact_exact_identity: activeManifest.exact_identity,
    expected_release_runtime_identity: releaseRuntime.identity, expected_release_artifact_semantic_identity: releaseManifest.semantic_identity, expected_release_artifact_topology_identity: releaseManifest.topology_identity, expected_release_artifact_exact_identity: releaseManifest.exact_identity,
    expected_config_sha256: hash(config), expected_gateway_pid: 123, expected_gateway_restart_count: 0, expected_console_pid: 123, expected_console_restart_count: 0,
    expected_node_version: nodeTool.version, expected_node_abi: 137, expected_node_executable_sha256: nodeTool.sha256, expected_npm_version: npmTool.version, expected_npm_cli_sha256: npmTool.sha256,
    expected_git_version: gitTool.version, expected_git_executable_sha256: gitTool.sha256, expected_tar_version: tarTool.version, expected_tar_executable_sha256: tarTool.sha256, expected_unshare_version: unshareTool.version, expected_unshare_executable_sha256: unshareTool.sha256, expected_mount_version: mountTool.version, expected_mount_executable_sha256: mountTool.sha256, expected_chroot_version: chrootTool.version, expected_chroot_executable_sha256: chrootTool.sha256, expected_systemctl_version: serviceTool.version, expected_systemctl_executable_sha256: serviceTool.sha256,
    python_executable: PYTHON, expected_python_executable_sha256: pythonTool.sha256, expected_python_version: pythonTool.version,
    cc_executable: CC, expected_cc_executable_sha256: ccTool.sha256, expected_cc_version: ccTool.version,
    cxx_executable: CXX, expected_cxx_executable_sha256: cxxTool.sha256, expected_cxx_version: cxxTool.version,
    make_executable: MAKE, expected_make_executable_sha256: makeTool.sha256, expected_make_version: makeTool.version,
    ar_executable: AR, expected_ar_executable_sha256: arTool.sha256, expected_ar_version: arTool.version,
    node_gyp_root: NODE_GYP_ROOT, expected_node_gyp_tree_identity: nodeGypManifest.exact_identity, targeted_test_files: ["index.js"],
  };
  writeJson(planPath, plan);
  return { root, planPath, plan, cleanup: () => { try { makeRemovable(root); } finally { rmSync(root, { recursive: true, force: true }); } } };
}

function cliPath() { return join(dirname(new URL(import.meta.url).pathname), "..", "bin", "prepare-runtime-authority.cjs"); }
function runProductionScenario(fixture, { verifyWithAlternateNode = false } = {}) {
  const cli = cliPath();
  const dry = JSON.parse(execFileSync(NODE, [cli, "dry-run", "--plan", fixture.planPath], { env: ENV, encoding: "utf8" }));
  assert.equal(dry.decision, "PASS"); assert.equal(dry.mutation_count, 0);
  const prepared = JSON.parse(execFileSync(NODE, [cli, "prepare", "--plan", fixture.planPath], { env: ENV, encoding: "utf8" }));
  assert.equal(prepared.authority.published, true);
  assert.deepEqual(prepared.authority.host_stability, { schema: "memory-engine-runtime-authority-host-stability-v1", path: "evidence/host-stability.json" });
  assert.deepEqual(prepared.authority.archives.map(item => item.role).sort(), ["candidate_archive", "r0_archive"]);
  assert.deepEqual(prepared.authority.manifests.map(item => item.role).sort(), ["active_after", "active_before", "candidate_frozen"]);
  assert.deepEqual(prepared.authority.runtime_identities.map(item => item.role).sort(), ["candidate_after_ci", "candidate_after_freeze", "candidate_after_reextract", "r0_after_reextract", "r0_capture"]);
  const verified = JSON.parse(execFileSync(NODE, [cli, "verify", "--authority", prepared.finalRoot], { env: ENV, encoding: "utf8" }));
  assert.equal(verified.valid, true);
  if (verifyWithAlternateNode) {
    const script = `const {verifyAuthority}=require(${JSON.stringify(join(dirname(new URL(import.meta.url).pathname), "..", "lib/runtime-authority/verify.js"))}); if (!verifyAuthority({authorityRoot:process.argv[1]}).valid) process.exit(1);`;
    execFileSync("/usr/bin/node", ["-e", script, prepared.finalRoot], { cwd: dirname(new URL(import.meta.url).pathname), env: ENV, encoding: "utf8" });
  }
  return prepared;
}

for (const drift of ["config", "gateway_pid", "gateway_restart", "console_pid", "console_restart"]) {
  test(`host stability drift is fail-closed: ${drift}`, () => {
    const fixture = makeProductionFixture({ stabilityDrift: drift });
    try {
      assert.throws(() => execFileSync(NODE, [cliPath(), "prepare", "--plan", fixture.planPath], { env: ENV, encoding: "utf8", stdio: "pipe" }));
      assert.equal(existsSync(join(fixture.plan.persistent_parent, fixture.plan.run_id)), false);
      assert.equal(JSON.parse(readFileSync(claimPath(fixture.plan.persistent_parent, fixture.plan.run_id), "utf8")).outcome, "FAILED");
    } finally { fixture.cleanup(); }
  });
}

test("CLI dry-run, prepare and verify use the production orchestration path with valid runtime and local native dependencies", () => {
  const fixture = makeProductionFixture();
  try { runProductionScenario(fixture, { verifyWithAlternateNode: true }); } finally { fixture.cleanup(); }
});

test("CLI production path runs Python, node-gyp, compiler, controlled devices and candidate topology", () => {
  const fixture = makeProductionFixture({ lifecycle: true });
  try {
    const prepared = runProductionScenario(fixture);
    assert.ok(prepared.authority.entry_inventory.entries.filter(entry => entry.type === "symlink").length >= 4);
    assert.ok(prepared.authority.entry_inventory.hardlink_groups.some(group => group.paths.length >= 2));
  } finally { fixture.cleanup(); }
});

test("verify requires the sibling run claim to be PUBLISHED and self-bound", () => {
  const fixture = makeProductionFixture();
  try {
    const prepared = runProductionScenario(fixture);
    const claim = claimPath(fixture.plan.persistent_parent, fixture.plan.run_id);
    const claimsDirectory = dirname(claim);
    const movedClaimsDirectory = join(fixture.plan.persistent_parent, ".run-claims-target");
    const original = readFileSync(claim, "utf8");
    const reject = () => assert.throws(() => execFileSync(NODE, [cliPath(), "verify", "--authority", prepared.finalRoot], { env: ENV, encoding: "utf8", stdio: "pipe" }));
    const currentUid = typeof process.getuid === "function" ? process.getuid() : 0;
    assert.throws(() => assertPublishedClaim(prepared.finalRoot, prepared.authority, { uid: currentUid + 1 }), /owner mismatch/);
    chmodSync(claimsDirectory, 0o755);
    reject();
    chmodSync(claimsDirectory, 0o700);
    renameSync(claimsDirectory, movedClaimsDirectory);
    symlinkSync(movedClaimsDirectory, claimsDirectory);
    reject();
    unlinkSync(claimsDirectory);
    renameSync(movedClaimsDirectory, claimsDirectory);
    for (const outcome of [null, "FAILED"]) {
      writeJson(claim, { run_id: fixture.plan.run_id, plan_sha256: prepared.authority.plan_sha256, claimed_at: "synthetic", outcome });
      reject();
    }
    rmSync(claim);
    reject();
    writeJson(join(fixture.plan.persistent_parent, "claim-target.json"), JSON.parse(original));
    symlinkSync(join(fixture.plan.persistent_parent, "claim-target.json"), claim);
    reject();
    rmSync(claim);
    writeFileSync(claim, original, { mode: 0o600 }); chmodSync(claim, 0o644);
    reject();
    writeJson(claim, { run_id: fixture.plan.run_id, plan_sha256: "0".repeat(64), claimed_at: "synthetic", outcome: "PUBLISHED" });
    reject();
    writeFileSync(claim, original, { mode: 0o600 }); chmodSync(claim, 0o600);
    const verified = JSON.parse(execFileSync(NODE, [cliPath(), "verify", "--authority", prepared.finalRoot], { env: ENV, encoding: "utf8" }));
    assert.equal(verified.valid, true);
  } finally { fixture.cleanup(); }
});

for (const [name, options] of [
  ["missing better-sqlite3", { native: { sqlite: false, lancedb: true } }],
  ["missing LanceDB", { native: { sqlite: true, lancedb: false } }],
  ["better-sqlite3 load failure", { native: { sqlite: true, lancedb: true }, sqliteLoadThrows: true }],
]) {
  test(`native smoke failure is fail-closed: ${name}`, () => {
    const fixture = makeProductionFixture(options);
    try {
    assert.throws(() => execFileSync(NODE, [cliPath(), "prepare", "--plan", fixture.planPath], { env: ENV, encoding: "utf8", stdio: "pipe" }));
      assert.equal(existsSync(join(fixture.plan.persistent_parent, fixture.plan.run_id)), false);
      assert.equal(JSON.parse(readFileSync(claimPath(fixture.plan.persistent_parent, fixture.plan.run_id), "utf8")).outcome, "FAILED");
    } finally { fixture.cleanup(); }
  });
}

test("runtime identity mutation after lifecycle is fail-closed", () => {
  const fixture = makeProductionFixture({ lifecycle: true, mutateRuntime: true });
  try {
    assert.throws(() => execFileSync(NODE, [cliPath(), "prepare", "--plan", fixture.planPath], { env: ENV, encoding: "utf8", stdio: "pipe" }));
    assert.equal(existsSync(join(fixture.plan.persistent_parent, fixture.plan.run_id)), false);
    assert.equal(JSON.parse(readFileSync(claimPath(fixture.plan.persistent_parent, fixture.plan.run_id), "utf8")).outcome, "FAILED");
  } finally { fixture.cleanup(); }
});

test("npm pack omission of a required runtime file is fail-closed", () => {
  const fixture = makeProductionFixture({ omitPackedRuntimeFile: "auto-recall.js" });
  try {
    assert.throws(() => execFileSync(NODE, [cliPath(), "prepare", "--plan", fixture.planPath], { env: ENV, encoding: "utf8", stdio: "pipe" }));
    assert.equal(existsSync(join(fixture.plan.persistent_parent, fixture.plan.run_id)), false);
    assert.equal(JSON.parse(readFileSync(claimPath(fixture.plan.persistent_parent, fixture.plan.run_id), "utf8")).outcome, "FAILED");
  } finally { fixture.cleanup(); }
});

for (const location of ["root", "dependency"]) {
  test(`external node_gyp_bins/python3 link is rejected without cleanup: ${location}`, () => {
    const fixture = makeProductionFixture({ lifecycle: true, externalNodeGypLink: location });
    try {
      assert.throws(() => execFileSync(NODE, [cliPath(), "prepare", "--plan", fixture.planPath], { env: ENV, encoding: "utf8", stdio: "pipe" }));
      assert.equal(existsSync(join(fixture.plan.persistent_parent, fixture.plan.run_id)), false);
      assert.equal(JSON.parse(readFileSync(claimPath(fixture.plan.persistent_parent, fixture.plan.run_id), "utf8")).outcome, "FAILED");
    } finally { fixture.cleanup(); }
  });
}

test("harness has no transient node-gyp link deletion path", () => {
  const source = readFileSync(join(dirname(new URL(import.meta.url).pathname), "..", "lib/runtime-authority/stage-handlers.js"), "utf8");
  assert.equal(source.includes("cleanupNodeGypPythonLink"), false);
  assert.equal(source.includes("candidate-transient-build-link-cleanup"), false);
});

test("R0 runtime identity mismatch is fail-closed", () => {
  assert.throws(() => assertRuntimeIdentity({ valid: true, identity: "a".repeat(64) }, "b".repeat(64), "R0"), /R0 runtime identity mismatch/);
});
