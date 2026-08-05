const PLAN_SCHEMA = "memory-engine-runtime-authority-plan-v1";
const SENTINEL_SCHEMA = "memory-engine-runtime-authority-sentinel-v1";
const ARCHIVE_SCHEMA = "memory-engine-runtime-authority-archive-v1";
const AUTHORITY_SCHEMA = "memory-engine-runtime-authority-v1";
const DRY_RUN_SCHEMA = "memory-engine-runtime-authority-dry-run-v1";
const ENTRY_INVENTORY_SCHEMA = "memory-engine-runtime-authority-entry-inventory-v1";

const PLAN_FIELDS = Object.freeze([
  "schema", "run_id", "created_at", "expires_at", "operator_home", "source_repo", "source_commit",
  "source_tree_identity", "origin_remote", "active_root", "active_release", "config_path",
  "persistent_parent", "node_executable", "npm_cli", "git_executable", "tar_executable",
  "unshare_executable", "mount_executable", "chroot_executable", "systemctl_executable", "gateway_unit", "console_unit",
  "expected_package_json_sha256", "expected_package_lock_sha256", "expected_source_runtime_identity",
  "expected_active_runtime_identity", "expected_active_artifact_semantic_identity",
  "expected_active_artifact_topology_identity", "expected_active_artifact_exact_identity",
  "expected_release_runtime_identity", "expected_release_artifact_semantic_identity",
  "expected_release_artifact_topology_identity", "expected_release_artifact_exact_identity",
  "expected_config_sha256", "expected_gateway_pid", "expected_gateway_restart_count",
  "expected_console_pid", "expected_console_restart_count", "expected_node_version", "expected_node_abi",
  "expected_node_executable_sha256", "expected_npm_version", "expected_npm_cli_sha256",
  "expected_git_version", "expected_git_executable_sha256", "expected_tar_version",
  "expected_tar_executable_sha256", "expected_unshare_version", "expected_unshare_executable_sha256",
  "expected_mount_version", "expected_mount_executable_sha256", "expected_systemctl_version",
  "expected_systemctl_executable_sha256", "targeted_test_files",
  "expected_chroot_version", "expected_chroot_executable_sha256",
  "python_executable", "expected_python_executable_sha256", "expected_python_version",
  "cc_executable", "expected_cc_executable_sha256", "expected_cc_version",
  "cxx_executable", "expected_cxx_executable_sha256", "expected_cxx_version",
  "make_executable", "expected_make_executable_sha256", "expected_make_version",
  "ar_executable", "expected_ar_executable_sha256", "expected_ar_version",
  "node_gyp_root", "expected_node_gyp_tree_identity",
]);

const PATH_FIELDS = Object.freeze([
  "operator_home", "source_repo", "active_root", "active_release", "config_path", "persistent_parent",
  "node_executable", "npm_cli", "git_executable", "tar_executable", "unshare_executable",
  "mount_executable", "chroot_executable", "systemctl_executable",
  "python_executable", "cc_executable", "cxx_executable", "make_executable", "ar_executable", "node_gyp_root",
]);

const TOOL_FIELDS = Object.freeze([
  ["node", "node_executable", "expected_node_executable_sha256", "expected_node_version", "expected_node_abi"],
  ["npm", "npm_cli", "expected_npm_cli_sha256", "expected_npm_version"],
  ["git", "git_executable", "expected_git_executable_sha256", "expected_git_version"],
  ["tar", "tar_executable", "expected_tar_executable_sha256", "expected_tar_version"],
  ["unshare", "unshare_executable", "expected_unshare_executable_sha256", "expected_unshare_version"],
  ["mount", "mount_executable", "expected_mount_executable_sha256", "expected_mount_version"],
  ["chroot", "chroot_executable", "expected_chroot_executable_sha256", "expected_chroot_version"],
  ["systemctl", "systemctl_executable", "expected_systemctl_executable_sha256", "expected_systemctl_version"],
  ["python", "python_executable", "expected_python_executable_sha256", "expected_python_version"],
  ["cc", "cc_executable", "expected_cc_executable_sha256", "expected_cc_version"],
  ["cxx", "cxx_executable", "expected_cxx_executable_sha256", "expected_cxx_version"],
  ["make", "make_executable", "expected_make_executable_sha256", "expected_make_version"],
  ["ar", "ar_executable", "expected_ar_executable_sha256", "expected_ar_version"],
]);

const HOST_OPERATIONS = Object.freeze([
  "git.status", "git.resolve_commit", "git.resolve_tree", "git.remote", "git.archive",
  "tar.extract_git_source", "tar.extract_npm_package",
  "systemd.gateway_status", "systemd.console_status", "node.active_artifact_manifest",
  "node.release_artifact_manifest", "node.source_runtime_identity", "node.active_runtime_identity", "node.release_runtime_identity", "node.artifact_compare", "tar.create_candidate_authority",
  "tar.extract_candidate_authority", "tar.create_r0_authority", "tar.extract_r0_authority",
]);

const SANDBOX_OPERATIONS = Object.freeze([
  "npm.pack_staged_source", "npm.prefix_candidate", "npm.ci_candidate", "npm.ls_candidate",
  "node.candidate_runtime_identity", "node.candidate_sqlite_disposable_smoke",
  "node.candidate_lancedb_disposable_smoke", "node.candidate_targeted_tests", "node.r0_runtime_identity",
  "node.r0_sqlite_disposable_smoke", "node.r0_lancedb_disposable_smoke", "node.candidate_manifest", "node.r0_manifest",
  "tar.verify_extract_candidate", "tar.verify_extract_r0",
]);

const ALL_OPERATIONS = Object.freeze([...HOST_OPERATIONS, ...SANDBOX_OPERATIONS]);

module.exports = {
  PLAN_SCHEMA,
  SENTINEL_SCHEMA,
  ARCHIVE_SCHEMA,
  AUTHORITY_SCHEMA,
  DRY_RUN_SCHEMA,
  ENTRY_INVENTORY_SCHEMA,
  PLAN_FIELDS,
  PATH_FIELDS,
  TOOL_FIELDS,
  HOST_OPERATIONS,
  SANDBOX_OPERATIONS,
  ALL_OPERATIONS,
};
