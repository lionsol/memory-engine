import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const DESIGN = new URL("../docs/smoke-tests/candidate-builder-harness-design-20260805.md", import.meta.url);
const TEMPLATE = new URL("../docs/smoke-tests/candidate-builder-harness-execution-template.md", import.meta.url);
const DOCS_INDEX = new URL("../docs/README.md", import.meta.url);
const SMOKE_INDEX = new URL("../docs/smoke-tests/README.md", import.meta.url);

function read(url) {
  return readFileSync(url, "utf8");
}

function count(text, token) {
  return text.split(token).length - 1;
}

test("candidate-builder design and execution template exist", () => {
  assert.equal(existsSync(DESIGN), true);
  assert.equal(existsSync(TEMPLATE), true);
});

test("design freezes the single-entry, isolated, manifest-based architecture", () => {
  const design = read(DESIGN);

  for (const token of [
    "accepted design",
    "future implementation",
    "not runtime verified",
    "source implementation present",
    "synthetic verification passed",
    "not used for a real candidate",
    "bin/prepare-runtime-authority.cjs",
    "one-shot transaction",
    "resume",
    "free-form exploration",
    "schema=memory-engine-runtime-authority-plan-v1",
    "schema\nrun_id",
    "operator_home",
    "unshare_executable",
    "mount_executable",
    "chroot_executable",
    "systemctl_executable",
    "mode `0600`",
    "created_at <= current time < expires_at",
    "expected_node_version",
    "expected_node_abi",
    "expected_node_executable_sha256",
    "expected_npm_version",
    "expected_npm_cli_sha256",
    "expected_git_version",
    "expected_git_executable_sha256",
    "expected_tar_version",
    "expected_tar_executable_sha256",
    "expected_unshare_version",
    "expected_unshare_executable_sha256",
    "expected_mount_version",
    "expected_mount_executable_sha256",
    "expected_chroot_version",
    "expected_chroot_executable_sha256",
    "expected_systemctl_version",
    "expected_systemctl_executable_sha256",
    "executable realpaths, versions, and hashes",
    "exact Git commit",
    "git archive",
    "source repository's `node_modules` is never read by npm",
    "explicit cwd",
    "explicit `--prefix`",
    "unshare --user --map-root-user --mount --pid --fork --mount-proc",
    "entire operator home",
    "memory-engine-runtime-artifact-manifest-v2",
    "No second full-tree hash algorithm",
    "manifest_file_sha256",
    "evidence-file integrity only",
    "sentinel_identity",
    "canonical JSON projection",
    "object keys",
    "no insignificant whitespace",
    "different roots",
    "npm ci",
    "Host-inspection operations",
    "Sandboxed staged-code operations",
    "node.candidate_runtime_identity",
    "node.candidate_sqlite_disposable_smoke",
    "node.candidate_lancedb_disposable_smoke",
    "node.candidate_targeted_tests",
    "node.r0_runtime_identity",
    "node.r0_sqlite_disposable_smoke",
    "node.r0_lancedb_disposable_smoke",
    "npm pack child",
    "npm ci child",
    "candidate native-smoke child",
    "R0 native-smoke child",
    "memory-engine-runtime-authority-archive-v1",
    "entry order is bytewise relative-path order",
    "mtime is a fixed value",
    "external hardlinks and special files are forbidden",
    "archiving the same tree twice",
    "Verify contract",
    "`--authority` is the sole accepted root argument",
    "authority.json",
    "checksums.sha256",
    "published=true",
    "absence of unexpected files",
    "R0 is not a chmod-frozen extracted directory",
    ".run-claims/<run_id>.json",
    "O_CREAT|O_EXCL",
    "claims are never deleted",
    "schema=memory-engine-runtime-authority-dry-run-v1",
    "Failure-injection matrix",
    "synthetic `dry-run` only",
    "production default factory",
    "source-implemented",
    "typed entry inventory",
    "internal npm",
    "unexpected empty directories",
    "strict rejection",
    "controlled `/dev/null`",
    "compiler headers",
    "Python/node-gyp closure",
    "/usr/lib/python3.12",
    "node-gyp configure/build",
    "Native smoke is fail-closed",
    "sqlite.ok=true",
    "lancedb.available=true",
    "lowercase 64-hex",
    "after `npm ci`",
    "after candidate freeze",
    "after candidate archive re-extraction",
    "bound Node",
    "python_executable",
    "expected_python_executable_sha256",
    "cc_executable",
    "cxx_executable",
    "make_executable",
    "ar_executable",
    "node_gyp_root",
    "expected_node_gyp_tree_identity",
    "PYTHON",
    "node-gyp closure",
    "candidate link audit",
    "memory-engine-runtime-authority-host-stability-v1",
    "host-stability.json",
    "claim update fails after rename",
    "RECOVERY_REQUIRED",
    "node npm git tar unshare mount chroot systemctl python cc cxx make ar node_gyp",
    "RUN_CLAIMED",
    "candidate_archive",
    "r0_archive",
    "candidate_after_ci",
    "candidate_after_freeze",
    "candidate_after_reextract",
    "r0_capture",
    "r0_after_reextract",
    "authority completeness validator",
    "published=true",
    "tar.verify_extract_candidate",
    "dedicated, operator-home-",
    "tar realpath",
    "transient paths",
  ]) {
    assert.equal(design.includes(token), true, `missing design contract token: ${token}`);
  }

  assert.match(design, /current\s+execution UID/);
  assert.match(design, /owner-matching,\s+non-symlink directory with mode `0700`/);
  assert.match(design, /read-only required\s+harness tools/);
  assert.match(design, /candidate\s+targeted-test child/);

  for (const token of ["not runtime verified", "does not authorize", "Edi is not invoked"]) {
    assert.equal(design.includes(token), true, `missing non-authorization token: ${token}`);
  }

  assert.equal(design.includes("manifest_file_sha256 participates in sentinel_identity"), false);
  assert.equal(design.includes("Only the dependency child runs in the sandbox"), false);
  assert.equal(design.includes("For verify, the plan is the sole source of operational bindings"), false);
});

test("design and execution template freeze the same complete journal", () => {
  const journal = [
    "PLAN_VALIDATED", "PREFLIGHT_PASSED", "RUN_CLAIMED", "SOURCE_ARCHIVED", "PACKAGE_PACKED",
    "DEPENDENCIES_INSTALLED", "CANDIDATE_VERIFIED", "CANDIDATE_ARCHIVED", "R0_CAPTURED", "R0_VERIFIED",
    "AUTHORITY_ASSEMBLED", "PUBLISHED",
  ].join("\n");
  for (const url of [DESIGN, TEMPLATE]) assert.equal(read(url).includes(journal), true, `journal mismatch in ${url.pathname}`);
});

test("execution template contains every frozen placeholder and authorization boundary", () => {
  const template = read(TEMPLATE);

  for (const placeholder of [
    "<PLAN_PATH>",
    "<PLAN_SHA256>",
    "<OPERATOR_HOME>",
    "<SOURCE_COMMIT>",
    "<SOURCE_TREE_IDENTITY>",
    "<ACTIVE_ROOT>",
    "<ACTIVE_RELEASE>",
    "<ACTIVE_RUNTIME_IDENTITY>",
    "<ACTIVE_ARTIFACT_EXACT_IDENTITY>",
    "<RELEASE_RUNTIME_IDENTITY>",
    "<RELEASE_ARTIFACT_EXACT_IDENTITY>",
    "<CONFIG_SHA256>",
    "<GATEWAY_PID>",
    "<CONSOLE_PID>",
    "<PERSISTENT_PARENT>",
    "<RUN_ID>",
    "<NODE_EXECUTABLE>",
    "<NPM_CLI>",
    "<GIT_EXECUTABLE>",
    "<TAR_EXECUTABLE>",
    "<UNSHARE_EXECUTABLE>",
    "<MOUNT_EXECUTABLE>",
    "<CHROOT_EXECUTABLE>",
    "<SYSTEMCTL_EXECUTABLE>",
    "PLAN_SCHEMA=memory-engine-runtime-authority-plan-v1",
    "mode-0700 non-symlink directory",
    "<EXPECTED_NODE_VERSION>",
    "<EXPECTED_NODE_ABI>",
    "<EXPECTED_NODE_EXECUTABLE_SHA256>",
    "<EXPECTED_NPM_VERSION>",
    "<EXPECTED_NPM_CLI_SHA256>",
    "<EXPECTED_GIT_VERSION>",
    "<EXPECTED_TAR_VERSION>",
    "<EXPECTED_GIT_EXECUTABLE_SHA256>",
    "<EXPECTED_TAR_EXECUTABLE_SHA256>",
    "<EXPECTED_UNSHARE_VERSION>",
    "<EXPECTED_UNSHARE_EXECUTABLE_SHA256>",
    "<EXPECTED_MOUNT_VERSION>",
    "<EXPECTED_MOUNT_EXECUTABLE_SHA256>",
    "<EXPECTED_CHROOT_VERSION>",
    "<EXPECTED_CHROOT_EXECUTABLE_SHA256>",
    "<EXPECTED_SYSTEMCTL_VERSION>",
    "<EXPECTED_SYSTEMCTL_EXECUTABLE_SHA256>",
    "<PYTHON_EXECUTABLE>",
    "<EXPECTED_PYTHON_EXECUTABLE_SHA256>",
    "<EXPECTED_PYTHON_VERSION>",
    "<CC_EXECUTABLE>",
    "<EXPECTED_CC_EXECUTABLE_SHA256>",
    "<EXPECTED_CC_VERSION>",
    "<CXX_EXECUTABLE>",
    "<EXPECTED_CXX_EXECUTABLE_SHA256>",
    "<EXPECTED_CXX_VERSION>",
    "<MAKE_EXECUTABLE>",
    "<EXPECTED_MAKE_EXECUTABLE_SHA256>",
    "<EXPECTED_MAKE_VERSION>",
    "<AR_EXECUTABLE>",
    "<EXPECTED_AR_EXECUTABLE_SHA256>",
    "<EXPECTED_AR_VERSION>",
    "<NODE_GYP_ROOT>",
    "<EXPECTED_NODE_GYP_TREE_IDENTITY>",
    "memory-engine-runtime-authority-host-stability-v1",
    "host-stability.json",
    "RUN_CLAIMED",
    "RECOVERY_REQUIRED",
    "node_gyp",
  ]) {
    assert.equal(template.includes(placeholder), true, `missing authorization placeholder: ${placeholder}`);
  }

  for (const token of [
    "dry-run and prepare approvals are issued separately",
    "one-shot transaction",
    "automatic retry",
    "live installation",
    "sourcePath",
    "canonical authority archive v1",
    "Verify authorization",
    "self-binding `authority.json`",
    "checksums.sha256",
    "service operation",
    "AutoRecall",
    "H6",
    "tag",
    "push",
    "typed entry inventory",
    "verification namespace",
    "controlled devices",
  ]) {
    assert.equal(template.includes(token), true, `missing execution boundary: ${token}`);
  }
});

test("public documentation is free of private execution bindings and content", () => {
  const text = `${read(DESIGN)}\n${read(TEMPLATE)}`;

  assert.equal(text.includes("/home/lionsol"), false);
  assert.equal(/[0-9a-f]{40}/i.test(text), false, "documents must not contain a current commit hash");
  assert.equal(/\bPID\s*=\s*\d+/i.test(text), false, "documents must not contain a concrete PID assignment");
  assert.equal(/(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[0-9A-Za-z-]+)/.test(text), false);
  assert.equal(/(?:<user>|<assistant>|BEGIN SESSION TRANSCRIPT|session transcript:)/i.test(text), false);
  assert.equal(/(?:sourcePath\s*=\s*\/|cwd\s*=\s*\/|prefix\s*=\s*\/)/i.test(text), false);
  assert.equal(/(?:node|npm|git|tar|systemctl)\s+\/\S+/i.test(text), false);
  assert.equal(/--(?:cwd|prefix|authority)\s+\/\S+/i.test(text), false);
});

test("documentation indexes expose both design documents", () => {
  const docsIndex = read(DOCS_INDEX);
  const smokeIndex = read(SMOKE_INDEX);

  for (const index of [docsIndex, smokeIndex]) {
    assert.equal(index.includes("candidate-builder-harness-design-20260805.md"), true);
    assert.equal(index.includes("candidate-builder-harness-execution-template.md"), true);
  }
});

test("new Markdown documents have balanced fences", () => {
  for (const url of [DESIGN, TEMPLATE]) {
    const text = read(url);
    assert.equal(count(text, "~~~") % 2, 0, `${url.pathname} has unbalanced tilde fences`);
    assert.equal(count(text, "```") % 2, 0, `${url.pathname} has unbalanced backtick fences`);
  }
});
