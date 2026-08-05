const { createHash } = require("node:crypto");
const { lstatSync, readFileSync, realpathSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const { buildRuntimeArtifactManifestV2 } = require("../../bin/runtime-artifact-manifest-v2-lib.cjs");

const VERSION_ARGS = Object.freeze({
  node: ["--version"], npm: ["--version"], git: ["--version"], tar: ["--version"],
  unshare: ["--version"], mount: ["--version"], chroot: ["--version"], systemctl: ["--version"],
  python: ["--version"], cc: ["--version"], cxx: ["--version"], make: ["--version"], ar: ["--version"],
});

function sha256File(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }

const FIXED_TOOL_ENV = Object.freeze({ PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" });

function defaultRunner({ executable, args, cwd = undefined, env = FIXED_TOOL_ENV, timeout = 5000 }) {
  const stdout = execFileSync(executable, args, { cwd, env: { ...FIXED_TOOL_ENV, ...env }, shell: false, timeout, maxBuffer: 64 * 1024, encoding: "utf8" });
  return { stdout: String(stdout), stderr: "", code: 0 };
}

function parseVersion(kind, output) {
  const first = String(output).trim().split(/\r?\n/, 1)[0];
  if (!first) throw new Error(`${kind} version output empty`);
  return first;
}

function inspectTool({ kind, executable, expected, broker, runner = defaultRunner, nodeExecutable = null }) {
  broker.assertExecutable(executable);
  const stats = lstatSync(executable);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`${kind} executable must be regular non-symlink file`);
  const realpath = realpathSync(executable);
  const hash = sha256File(executable);
  const invocation = kind === "npm" ? nodeExecutable : executable;
  const invocationArgs = kind === "npm" ? [realpath, "--version"] : VERSION_ARGS[kind] || ["--version"];
  if (!invocation) throw new Error("npm identity requires bound Node executable");
  const versionOutput = runner({ executable: invocation, args: invocationArgs, cwd: undefined, env: FIXED_TOOL_ENV }).stdout;
  const version = parseVersion(kind, versionOutput);
  const identity = { kind, path: realpath, sha256: hash, version };
  if (kind === "node") {
    const abiResult = runner({ executable, args: ["-p", "process.versions.modules"], env: FIXED_TOOL_ENV });
    identity.abi = Number.parseInt(String(abiResult.stdout).trim(), 10);
  }
  for (const [key, expectedValue] of Object.entries(expected || {})) {
    if (expectedValue !== undefined && identity[key] !== expectedValue) throw new Error(`${kind} identity mismatch:${key}`);
  }
  return identity;
}

function inspectNodeGyp({ root, expected, broker }) {
  broker.assertRead(root, { root: "node_gyp_root", type: "directory" });
  if (realpathSync(root) !== root) throw new Error("node-gyp root must be a non-symlink realpath");
  const manifest = buildRuntimeArtifactManifestV2({ rootDir: root });
  if (!manifest.valid || !manifest.exact_identity) throw new Error(`node-gyp closure manifest invalid:${(manifest.errors || []).join(",")}`);
  if (expected?.tree_identity !== undefined && manifest.exact_identity !== expected.tree_identity) throw new Error("node-gyp closure identity mismatch");
  return {
    kind: "node_gyp",
    path: root,
    tree_identity: manifest.exact_identity,
    entry_count: manifest.entry_count,
    file_count: manifest.file_count,
    external_symlink_count: manifest.external_symlink_count,
    dangling_symlink_count: manifest.dangling_symlink_count,
  };
}

function inspectPlanTools({ plan, broker, runner = defaultRunner }) {
  const entries = [
    ["node", plan.node_executable, { sha256: plan.expected_node_executable_sha256, version: plan.expected_node_version, abi: plan.expected_node_abi }],
    ["npm", plan.npm_cli, { sha256: plan.expected_npm_cli_sha256, version: plan.expected_npm_version }],
    ["git", plan.git_executable, { sha256: plan.expected_git_executable_sha256, version: plan.expected_git_version }],
    ["tar", plan.tar_executable, { sha256: plan.expected_tar_executable_sha256, version: plan.expected_tar_version }],
    ["unshare", plan.unshare_executable, { sha256: plan.expected_unshare_executable_sha256, version: plan.expected_unshare_version }],
    ["mount", plan.mount_executable, { sha256: plan.expected_mount_executable_sha256, version: plan.expected_mount_version }],
    ["chroot", plan.chroot_executable, { sha256: plan.expected_chroot_executable_sha256, version: plan.expected_chroot_version }],
    ["systemctl", plan.systemctl_executable, { sha256: plan.expected_systemctl_executable_sha256, version: plan.expected_systemctl_version }],
    ["python", plan.python_executable, { sha256: plan.expected_python_executable_sha256, version: plan.expected_python_version }],
    ["cc", plan.cc_executable, { sha256: plan.expected_cc_executable_sha256, version: plan.expected_cc_version }],
    ["cxx", plan.cxx_executable, { sha256: plan.expected_cxx_executable_sha256, version: plan.expected_cxx_version }],
    ["make", plan.make_executable, { sha256: plan.expected_make_executable_sha256, version: plan.expected_make_version }],
    ["ar", plan.ar_executable, { sha256: plan.expected_ar_executable_sha256, version: plan.expected_ar_version }],
  ];
  const identities = Object.fromEntries(entries.map(([kind, executable, expected]) => [kind, inspectTool({ kind, executable, expected, broker, runner, nodeExecutable: plan.node_executable })]));
  identities.node_gyp = inspectNodeGyp({ root: plan.node_gyp_root, expected: { tree_identity: plan.expected_node_gyp_tree_identity }, broker });
  return identities;
}

module.exports = { VERSION_ARGS, FIXED_TOOL_ENV, defaultRunner, sha256File, inspectTool, inspectNodeGyp, inspectPlanTools };
