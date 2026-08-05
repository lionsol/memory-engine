import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "runtime-authority-synthetic-"));
  const operatorHome = join(root, "operator-home");
  const sourceRepo = join(root, "source-repo");
  const activeRoot = join(root, "active");
  const activeRelease = join(root, "release");
  const persistentParent = join(root, "authorities");
  const nodeGypRoot = join(root, "node-gyp-root");
  const planPath = join(root, "plan.json");
  mkdirSync(operatorHome, { recursive: true, mode: 0o700 });
  mkdirSync(sourceRepo, { recursive: true, mode: 0o700 });
  mkdirSync(activeRoot, { recursive: true, mode: 0o700 });
  mkdirSync(activeRelease, { recursive: true, mode: 0o700 });
  mkdirSync(persistentParent, { recursive: true, mode: 0o700 });
  mkdirSync(nodeGypRoot, { recursive: true, mode: 0o700 });
  writeFileSync(join(nodeGypRoot, "package.json"), "{}\n", { mode: 0o400 });
  writeFileSync(join(sourceRepo, "package.json"), "{}\n", { mode: 0o400 });
  writeFileSync(join(activeRoot, "canary"), "active\n", { mode: 0o400 });
  writeFileSync(join(activeRelease, "canary"), "release\n", { mode: 0o400 });
  const tools = {};
  for (const name of ["node", "npm", "git", "tar", "unshare", "mount", "chroot", "systemctl", "python", "cc", "cxx", "make", "ar"]) {
    const path = join(root, `${name}.tool`);
    writeFileSync(path, `synthetic-${name}\n`, { mode: 0o755 });
    tools[name] = path;
  }
  const plan = {
    schema: "memory-engine-runtime-authority-plan-v1",
    run_id: "synthetic-run-01",
    created_at: new Date(Date.now() - 1000).toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    operator_home: operatorHome,
    source_repo: sourceRepo,
    source_commit: "a".repeat(40),
    source_tree_identity: "b".repeat(64),
    origin_remote: "synthetic-origin",
    active_root: activeRoot,
    active_release: activeRelease,
    config_path: join(root, "config.json"),
    persistent_parent: persistentParent,
    node_executable: tools.node,
    npm_cli: tools.npm,
    git_executable: tools.git,
    tar_executable: tools.tar,
    unshare_executable: tools.unshare,
    mount_executable: tools.mount,
    chroot_executable: tools.chroot,
    systemctl_executable: tools.systemctl,
    gateway_unit: "synthetic-gateway.service",
    console_unit: "synthetic-console.service",
    expected_package_json_sha256: "0".repeat(64),
    expected_package_lock_sha256: "1".repeat(64),
    expected_source_runtime_identity: "2".repeat(64),
    expected_active_runtime_identity: "3".repeat(64),
    expected_active_artifact_semantic_identity: "4".repeat(64),
    expected_active_artifact_topology_identity: "5".repeat(64),
    expected_active_artifact_exact_identity: "6".repeat(64),
    expected_release_runtime_identity: "7".repeat(64),
    expected_release_artifact_semantic_identity: "8".repeat(64),
    expected_release_artifact_topology_identity: "9".repeat(64),
    expected_release_artifact_exact_identity: "a".repeat(64),
    expected_config_sha256: "b".repeat(64),
    expected_gateway_pid: 1,
    expected_gateway_restart_count: 0,
    expected_console_pid: 2,
    expected_console_restart_count: 0,
    expected_node_version: "synthetic-node",
    expected_node_abi: 1,
    expected_node_executable_sha256: "c".repeat(64),
    expected_npm_version: "synthetic-npm",
    expected_npm_cli_sha256: "d".repeat(64),
    expected_git_version: "synthetic-git",
    expected_git_executable_sha256: "e".repeat(64),
    expected_tar_version: "synthetic-tar",
    expected_tar_executable_sha256: "f".repeat(64),
    expected_unshare_version: "synthetic-unshare",
    expected_unshare_executable_sha256: "0".repeat(64),
    expected_mount_version: "synthetic-mount",
    expected_mount_executable_sha256: "1".repeat(64),
    expected_chroot_version: "synthetic-chroot",
    expected_chroot_executable_sha256: "2".repeat(64),
    expected_systemctl_version: "synthetic-systemctl",
    expected_systemctl_executable_sha256: "3".repeat(64),
    python_executable: tools.python,
    expected_python_executable_sha256: "4".repeat(64),
    expected_python_version: "synthetic-python",
    cc_executable: tools.cc,
    expected_cc_executable_sha256: "5".repeat(64),
    expected_cc_version: "synthetic-cc",
    cxx_executable: tools.cxx,
    expected_cxx_executable_sha256: "6".repeat(64),
    expected_cxx_version: "synthetic-cxx",
    make_executable: tools.make,
    expected_make_executable_sha256: "7".repeat(64),
    expected_make_version: "synthetic-make",
    ar_executable: tools.ar,
    expected_ar_executable_sha256: "8".repeat(64),
    expected_ar_version: "synthetic-ar",
    node_gyp_root: nodeGypRoot,
    expected_node_gyp_tree_identity: "9".repeat(64),
    targeted_test_files: ["test/synthetic.test.js"],
  };
  writeFileSync(plan.config_path, "synthetic-config\n", { mode: 0o600 });
  const cleanup = () => { try { rmSync(root, { recursive: true, force: true }); } catch {} };
  return { root, planPath, plan, tools, cleanup };
}

export function writePlan(fixture, value = fixture.plan, mode = 0o600) {
  writeFileSync(fixture.planPath, `${JSON.stringify(value)}\n`, { mode });
  chmodSync(fixture.planPath, mode);
}

export function fakeToolInspector({ plan }) {
  return Object.fromEntries([
    ["node", { kind: "node", path: plan.node_executable, sha256: plan.expected_node_executable_sha256, version: plan.expected_node_version, abi: plan.expected_node_abi }],
    ["npm", { kind: "npm", path: plan.npm_cli, sha256: plan.expected_npm_cli_sha256, version: plan.expected_npm_version }],
    ["git", { kind: "git", path: plan.git_executable, sha256: plan.expected_git_executable_sha256, version: plan.expected_git_version }],
    ["tar", { kind: "tar", path: plan.tar_executable, sha256: plan.expected_tar_executable_sha256, version: plan.expected_tar_version }],
    ["unshare", { kind: "unshare", path: plan.unshare_executable, sha256: plan.expected_unshare_executable_sha256, version: plan.expected_unshare_version }],
    ["mount", { kind: "mount", path: plan.mount_executable, sha256: plan.expected_mount_executable_sha256, version: plan.expected_mount_version }],
    ["chroot", { kind: "chroot", path: plan.chroot_executable, sha256: plan.expected_chroot_executable_sha256, version: plan.expected_chroot_version }],
    ["systemctl", { kind: "systemctl", path: plan.systemctl_executable, sha256: plan.expected_systemctl_executable_sha256, version: plan.expected_systemctl_version }],
    ["python", { kind: "python", path: plan.python_executable, sha256: plan.expected_python_executable_sha256, version: plan.expected_python_version }],
    ["cc", { kind: "cc", path: plan.cc_executable, sha256: plan.expected_cc_executable_sha256, version: plan.expected_cc_version }],
    ["cxx", { kind: "cxx", path: plan.cxx_executable, sha256: plan.expected_cxx_executable_sha256, version: plan.expected_cxx_version }],
    ["make", { kind: "make", path: plan.make_executable, sha256: plan.expected_make_executable_sha256, version: plan.expected_make_version }],
    ["ar", { kind: "ar", path: plan.ar_executable, sha256: plan.expected_ar_executable_sha256, version: plan.expected_ar_version }],
    ["node_gyp", { kind: "node_gyp", path: plan.node_gyp_root, tree_identity: plan.expected_node_gyp_tree_identity, entry_count: 1, file_count: 1, external_symlink_count: 0, dangling_symlink_count: 0 }],
  ]);
}

export function successfulHooks() {
  return Object.fromEntries([
    "SOURCE_ARCHIVED", "PACKAGE_PACKED", "DEPENDENCIES_INSTALLED", "CANDIDATE_VERIFIED", "CANDIDATE_ARCHIVED",
    "R0_CAPTURED", "R0_VERIFIED",
  ].map(stage => [stage, ({ stagingRoot }) => {
    writeFileSync(join(stagingRoot, `${stage}.evidence`), `${stage}\n`, { mode: 0o400 });
  }]));
}
