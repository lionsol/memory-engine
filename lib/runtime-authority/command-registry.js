const { execFileSync } = require("node:child_process");
const { HOST_OPERATIONS, SANDBOX_OPERATIONS } = require("./constants.js");
const { createCanonicalArchive, extractCanonicalArchive } = require("./archive.js");
const { realpathSync } = require("node:fs");
const { join } = require("node:path");

function defaultSpawn({ executable, args, cwd, env, input, timeout = 30_000, maxOutput = 256 * 1024 }) {
  try {
    const stdout = execFileSync(executable, args, {
      cwd, env, input, shell: false, timeout, maxBuffer: maxOutput, encoding: "utf8",
    });
    return { code: 0, stdout: String(stdout), stderr: "" };
  } catch (error) {
    const stdout = error.stdout ? String(error.stdout) : "";
    const stderr = error.stderr ? String(error.stderr) : String(error.message || "");
    return { code: Number.isInteger(error.status) ? error.status : 1, stdout, stderr, error };
  }
}

function fixedEnv(extra = {}) {
  return { ...extra, PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" };
}

function systemdUserEnv({ uid = typeof process.getuid === "function" ? process.getuid() : null } = {}) {
  if (!Number.isSafeInteger(uid) || uid < 0) throw new Error("systemd user scope requires a valid execution uid");
  const runtimeDir = `/run/user/${uid}`;
  return {
    XDG_RUNTIME_DIR: runtimeDir,
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtimeDir}/bus`,
  };
}

function systemdUserStatusArgs(unit) {
  return ["--user", "show", unit, "--property=ActiveState,SubState,MainPID,NRestarts", "--no-pager"];
}

class CommandRegistry {
  constructor({ plan, broker, spawn = defaultSpawn, sandbox = null, descriptors = {} } = {}) {
    this.plan = plan;
    this.broker = broker;
    this.spawn = spawn;
    this.sandbox = sandbox;
    this.descriptors = descriptors;
  }

  descriptor(id) {
    const descriptor = this.descriptors[id];
    if (!descriptor) throw new Error(`unregistered operation:${id}`);
    if (![...HOST_OPERATIONS, ...SANDBOX_OPERATIONS].includes(id)) throw new Error(`unknown operation:${id}`);
    return descriptor;
  }

  run(id, input = {}) {
    const descriptor = this.descriptor(id);
    for (const forbidden of ["argv", "executable", "cwd", "env", "shell"]) if (Object.prototype.hasOwnProperty.call(input, forbidden)) throw new Error(`raw operation input rejected:${forbidden}`);
    if (descriptor.validateInput) descriptor.validateInput(this.plan, input, this.broker);
    if (descriptor.implementation === "canonical-archive") {
      this.broker.assertRead(input.sourceRoot, { type: "directory" });
      this.broker.assertWrite(input.archivePath, { root: "persistent_parent", mustExist: false });
      return createCanonicalArchive({ root: input.sourceRoot, archivePath: input.archivePath, tarExecutable: this.plan.tar_executable, run: command => { const result = this.spawn({ ...command, cwd: input.sourceRoot, env: fixedEnv(), timeout: 120_000, maxOutput: 256 * 1024 }); if (result.code !== 0) throw new Error(`canonical archive failed:${result.stderr}`); return result; } });
    }
    if (descriptor.implementation === "canonical-extract") {
      this.broker.assertRead(input.archivePath, { type: "file" });
      this.broker.assertWrite(input.destination, { root: "persistent_parent", type: "directory", mustExist: true });
      return extractCanonicalArchive({ archivePath: input.archivePath, destination: input.destination, tarExecutable: this.plan.tar_executable, run: command => { const result = this.spawn({ ...command, cwd: input.destination, env: fixedEnv(), timeout: 120_000, maxOutput: 256 * 1024 }); if (result.code !== 0) throw new Error(`canonical extraction failed:${result.stderr}`); return result; } });
    }
    const executable = descriptor.executable(this.plan, input);
    this.broker.assertExecutable(executable);
    const cwd = descriptor.cwd ? descriptor.cwd(this.plan, input) : undefined;
    if (cwd) this.broker.assertRead(cwd, { type: "directory" });
    const args = descriptor.args(this.plan, input);
    if (!Array.isArray(args) || args.some(arg => typeof arg !== "string")) throw new Error(`invalid argv:${id}`);
    const env = fixedEnv(descriptor.env ? descriptor.env(this.plan, input) : {});
    if (descriptor.class === "sandbox") {
      if (!this.sandbox) throw new Error(`sandbox required:${id}`);
      return this.sandbox.run(id, { executable, args, cwd, env, input: descriptor.input?.(input) });
    }
    const result = this.spawn({ executable, args, cwd, env, input: descriptor.input?.(input), timeout: descriptor.timeout || 30_000, maxOutput: descriptor.maxOutput || 256 * 1024 });
    if ((descriptor.acceptedCodes || [0]).includes(result.code) === false) throw new Error(`${id} failed:${result.code}:${result.stderr}`);
    return result;
  }
}

function createRegistry({ plan, broker, spawn, sandbox } = {}) {
  const executable = key => currentPlan => currentPlan[key];
  const descriptors = {
    "git.status": { class: "host", executable: executable("git_executable"), args: () => ["status", "--porcelain=v1"], cwd: p => p.source_repo },
    "git.resolve_commit": { class: "host", executable: executable("git_executable"), args: (p, i) => ["rev-parse", i.ref || p.source_commit], cwd: p => p.source_repo },
    "git.resolve_tree": { class: "host", executable: executable("git_executable"), args: (p, i) => ["rev-parse", `${i.ref || p.source_commit}^{tree}`], cwd: p => p.source_repo },
    "git.remote": { class: "host", executable: executable("git_executable"), args: () => ["remote", "get-url", "origin"], cwd: p => p.source_repo },
    "git.archive": { class: "host", executable: executable("git_executable"), args: (p, i) => ["archive", "--format=tar", "--output", i.destination, p.source_commit], cwd: p => p.source_repo, validateInput: (p, i, b) => b.assertWrite(i.destination, { root: "persistent_parent", mustExist: false }) },
    "tar.extract_git_source": { class: "host", executable: executable("tar_executable"), args: (p, i) => ["-xf", i.archivePath, "-C", i.destination], cwd: p => p.source_repo, validateInput: (p, i, b) => { b.assertRead(i.archivePath, { root: "persistent_parent", type: "file" }); b.assertWrite(i.destination, { root: "persistent_parent", type: "directory", mustExist: true }); } },
    "tar.extract_npm_package": { class: "host", executable: executable("tar_executable"), args: (p, i) => ["-xzf", i.archivePath, "-C", i.destination], cwd: p => p.source_repo, validateInput: (p, i, b) => { b.assertRead(i.archivePath, { root: "persistent_parent", type: "file" }); b.assertWrite(i.destination, { root: "persistent_parent", type: "directory", mustExist: true }); } },
    "systemd.gateway_status": { class: "host", executable: executable("systemctl_executable"), args: p => systemdUserStatusArgs(p.gateway_unit), env: () => systemdUserEnv() },
    "systemd.console_status": { class: "host", executable: executable("systemctl_executable"), args: p => systemdUserStatusArgs(p.console_unit), env: () => systemdUserEnv() },
    "node.active_artifact_manifest": { class: "host", executable: executable("node_executable"), args: (p, i) => [i.script, "--root", p.active_root], cwd: p => p.source_repo },
    "node.release_artifact_manifest": { class: "host", executable: executable("node_executable"), args: (p, i) => [i.script, "--root", p.active_release], cwd: p => p.source_repo },
    "node.source_runtime_identity": { class: "host", executable: executable("node_executable"), args: p => [join(__dirname, "runtime-host-helper.mjs"), "--root", p.source_repo], cwd: p => p.source_repo, validateInput: (p, i, b) => b.assertRead(join(__dirname, "runtime-host-helper.mjs"), { root: "harness_root", type: "file" }) },
    "node.active_runtime_identity": { class: "host", executable: executable("node_executable"), args: p => [join(__dirname, "runtime-host-helper.mjs"), "--root", p.active_root], cwd: p => p.source_repo, validateInput: (p, i, b) => b.assertRead(join(__dirname, "runtime-host-helper.mjs"), { root: "harness_root", type: "file" }) },
    "node.release_runtime_identity": { class: "host", executable: executable("node_executable"), args: p => [join(__dirname, "runtime-host-helper.mjs"), "--root", p.active_release], cwd: p => p.source_repo, validateInput: (p, i, b) => b.assertRead(join(__dirname, "runtime-host-helper.mjs"), { root: "harness_root", type: "file" }) },
    "node.artifact_compare": { class: "host", executable: executable("node_executable"), args: (p, i) => [i.script, "--candidate", i.candidate, "--installed", i.installed, "--policy", i.policy], cwd: p => p.source_repo },
    "tar.create_candidate_authority": { class: "host", executable: executable("tar_executable"), args: () => [], cwd: p => p.source_repo, implementation: "canonical-archive" },
    "tar.extract_candidate_authority": { class: "host", executable: executable("tar_executable"), args: () => [], cwd: p => p.source_repo, implementation: "canonical-extract" },
    "tar.create_r0_authority": { class: "host", executable: executable("tar_executable"), args: () => [], cwd: p => p.source_repo, implementation: "canonical-archive" },
    "tar.extract_r0_authority": { class: "host", executable: executable("tar_executable"), args: () => [], cwd: p => p.source_repo, implementation: "canonical-extract" },
  };
  const candidateInput = (p, i, b) => { b.assertRead(i.candidate, { root: "persistent_parent", type: "directory" }); if (realpathSync(i.candidate) === realpathSync(p.source_repo)) throw new Error("candidate prefix cannot equal source repository"); };
  descriptors["npm.pack_staged_source"] = { class: "sandbox", executable: executable("node_executable"), args: (p, i) => [p.npm_cli, "pack", "--ignore-scripts", "--json", "--pack-destination", i.destination], cwd: (p, i) => i.sourceRoot, validateInput: (p, i, b) => { b.assertRead(i.sourceRoot, { root: "persistent_parent", type: "directory" }); b.assertWrite(i.destination, { root: "persistent_parent", type: "directory", mustExist: true }); b.assertRead(p.npm_cli, { root: "npm_cli", type: "file" }); } };
  descriptors["npm.prefix_candidate"] = { class: "sandbox", executable: executable("node_executable"), args: (p, i) => [p.npm_cli, "--prefix", i.candidate, "prefix"], cwd: (p, i) => i.candidate, validateInput: candidateInput };
  descriptors["npm.ci_candidate"] = { class: "sandbox", executable: executable("node_executable"), args: (p, i) => [p.npm_cli, "--prefix", i.candidate, "ci", "--omit=dev", "--no-audit", "--no-fund", "--cache", i.cache], cwd: (p, i) => i.candidate, validateInput: (p, i, b) => { candidateInput(p, i, b); b.assertWrite(i.cache, { root: "persistent_parent", mustExist: false }); } };
  descriptors["npm.ls_candidate"] = { class: "sandbox", executable: executable("node_executable"), args: (p, i) => [p.npm_cli, "--prefix", i.candidate, "ls", "--all", "--omit=dev"], cwd: (p, i) => i.candidate, validateInput: candidateInput };
  for (const id of SANDBOX_OPERATIONS.filter(operation => operation.startsWith("node."))) descriptors[id] = {
    class: "sandbox", executable: executable("node_executable"), args: (p, i) => [i.script, "--root", i.root, ...(i.mode ? ["--mode", i.mode] : []), ...(i.tests ? ["--tests-json", JSON.stringify(i.tests)] : [])], cwd: (p, i) => i.root,
    validateInput: (p, i, b) => { b.assertRead(i.script, { root: "persistent_parent", type: "file" }); b.assertRead(i.root, { root: "persistent_parent", type: "directory" }); },
  };
  for (const id of ["tar.verify_extract_candidate", "tar.verify_extract_r0"]) descriptors[id] = {
    class: "sandbox", executable: executable("tar_executable"),
    args: (p, i) => ["-xf", i.archive, "-C", i.destination, "--no-same-owner", "--no-same-permissions", "--no-overwrite-dir", "--mode=ugo+rwX", "--keep-directory-symlink"],
    cwd: (p, i) => i.scratch,
    validateInput: (p, i, b) => { b.assertRead(i.archive, { root: "persistent_parent", type: "file" }); b.assertWrite(i.destination, { root: "persistent_parent", type: "directory", mustExist: true }); },
  };
  return new CommandRegistry({ plan, broker, spawn, sandbox, descriptors });
}

module.exports = { CommandRegistry, createRegistry, defaultSpawn, fixedEnv, systemdUserEnv, systemdUserStatusArgs };
