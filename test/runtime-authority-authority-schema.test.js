import test from "node:test";
import assert from "node:assert/strict";
import { JOURNAL, assertAuthorityCompleteness, assertHostStabilityEvidence } from "../lib/runtime-authority/authority-schema.js";

const sha = character => character.repeat(64);

function completeAuthority() {
  const candidateManifest = "candidate/candidate-artifact-manifest.json";
  const activeBefore = "evidence/active-before-manifest.json";
  const activeAfter = "evidence/active-after-manifest.json";
  const candidateFreeze = "evidence/candidate-runtime-after-freeze.json";
  const r0Capture = "evidence/r0-runtime-identity.json";
  const tool_identities = Object.fromEntries([
    ["node", { kind: "node", path: "/synthetic/node", sha256: sha("0"), version: "node", abi: 1 }],
    ...["npm", "git", "tar", "unshare", "mount", "chroot", "systemctl", "python", "cc", "cxx", "make", "ar"].map((role, index) => [role, { kind: role, path: `/synthetic/${role}`, sha256: sha(String((index + 1) % 10)), version: role }]),
    ["node_gyp", { kind: "node_gyp", path: "/synthetic/node-gyp", tree_identity: sha("9"), entry_count: 1, file_count: 1, external_symlink_count: 0, dangling_symlink_count: 0 }],
  ]);
  return {
    schema: "memory-engine-runtime-authority-v1",
    published: true,
    expected_source_runtime_identity: sha("a"),
    expected_active_runtime_identity: sha("b"),
    expected_config_sha256: sha("c"),
    expected_gateway_pid: 1,
    expected_gateway_restart_count: 0,
    expected_console_pid: 2,
    expected_console_restart_count: 0,
    host_stability: { schema: "memory-engine-runtime-authority-host-stability-v1", path: "evidence/host-stability.json" },
    tool_identities,
    journal: [...JOURNAL],
    archives: [
      { role: "candidate_archive", schema: "memory-engine-runtime-authority-archive-v1", path: "candidate/candidate-authority.tar", sha256: sha("c"), manifest_path: candidateManifest, runtime_identity_path: candidateFreeze },
      { role: "r0_archive", schema: "memory-engine-runtime-authority-archive-v1", path: "recovery/r0-authority.tar", sha256: sha("d"), manifest_path: activeBefore, runtime_identity_path: r0Capture },
    ],
    manifests: [
      { role: "candidate_frozen", manifest_path: candidateManifest, sentinel_path: "candidate/candidate-sentinel.json", exact_identity: sha("e"), git_commit: "f".repeat(40), git_tree: "1".repeat(40), package_json_sha256: sha("1"), package_lock_sha256: sha("2") },
      { role: "active_before", manifest_path: activeBefore, exact_identity: sha("6") },
      { role: "active_after", manifest_path: activeAfter, exact_identity: sha("6") },
    ],
    runtime_identities: [
      { role: "candidate_after_ci", path: "evidence/candidate-runtime-after-ci.json", identity: sha("a"), expected_identity_class: "source" },
      { role: "candidate_after_freeze", path: candidateFreeze, identity: sha("a"), expected_identity_class: "source" },
      { role: "candidate_after_reextract", path: "evidence/candidate-runtime-after-reextract.json", identity: sha("a"), expected_identity_class: "source" },
      { role: "r0_capture", path: r0Capture, identity: sha("b"), expected_identity_class: "active" },
      { role: "r0_after_reextract", path: "evidence/r0-runtime-after-reextract.json", identity: sha("b"), expected_identity_class: "active" },
    ],
  };
}

test("complete authority role schema is accepted", () => {
  assert.doesNotThrow(() => assertAuthorityCompleteness(completeAuthority()));
});

test("empty or missing archive, manifest, and checkpoint roles are rejected", () => {
  for (const field of ["archives", "manifests", "runtime_identities"]) {
    const authority = completeAuthority();
    authority[field] = [];
    assert.throws(() => assertAuthorityCompleteness(authority), new RegExp(field === "runtime_identities" ? "runtime checkpoints" : field));
  }
  const missingCandidate = completeAuthority();
  missingCandidate.manifests = missingCandidate.manifests.filter(item => item.role !== "candidate_frozen");
  assert.throws(() => assertAuthorityCompleteness(missingCandidate), /manifests/);
  const missingR0 = completeAuthority();
  missingR0.archives = missingR0.archives.filter(item => item.role !== "r0_archive");
  assert.throws(() => assertAuthorityCompleteness(missingR0), /archives/);
  const missingCheckpoint = completeAuthority();
  missingCheckpoint.runtime_identities = missingCheckpoint.runtime_identities.filter(item => item.role !== "r0_after_reextract");
  assert.throws(() => assertAuthorityCompleteness(missingCheckpoint), /runtime checkpoints/);
});

test("duplicate, unknown, and swapped roles or references are rejected", () => {
  const duplicate = completeAuthority();
  duplicate.archives[1].role = "candidate_archive";
  assert.throws(() => assertAuthorityCompleteness(duplicate), /duplicate role/);

  const unknown = completeAuthority();
  unknown.manifests[0].role = "candidate";
  assert.throws(() => assertAuthorityCompleteness(unknown), /unknown role/);

  const swapped = completeAuthority();
  swapped.archives[0].manifest_path = swapped.manifests.find(item => item.role === "active_before").manifest_path;
  assert.throws(() => assertAuthorityCompleteness(swapped), /candidate archive manifest role mismatch/);
});

test("checkpoint identity class and journal are strict", () => {
  const wrongClass = completeAuthority();
  wrongClass.runtime_identities[0].expected_identity_class = "active";
  assert.throws(() => assertAuthorityCompleteness(wrongClass), /identity (?:class|mismatch)/);

  const truncated = completeAuthority();
  truncated.journal = truncated.journal.slice(0, -1);
  assert.throws(() => assertAuthorityCompleteness(truncated), /journal mismatch/);

  const reordered = completeAuthority();
  [reordered.journal[3], reordered.journal[4]] = [reordered.journal[4], reordered.journal[3]];
  assert.throws(() => assertAuthorityCompleteness(reordered), /journal mismatch/);
});

test("authority tool roles and host stability evidence are exact", () => {
  const authority = completeAuthority();
  for (const role of ["npm", "git", "systemctl", "node_gyp"]) {
    const candidate = structuredClone(authority);
    delete candidate.tool_identities[role];
    assert.throws(() => assertAuthorityCompleteness(candidate), /tool/);
  }
  for (const mutation of [
    value => { value.tool_identities.extra = value.tool_identities.node; },
    value => { value.tool_identities.git.kind = "tar"; },
    value => { value.tool_identities.node_gyp.external_symlink_count = 1; },
  ]) {
    const candidate = structuredClone(authority);
    mutation(candidate);
    assert.throws(() => assertAuthorityCompleteness(candidate), /tool/);
  }
  const evidence = {
    schema: "memory-engine-runtime-authority-host-stability-v1",
    before: { config_sha256: authority.expected_config_sha256, gateway: { active: true, running: true, pid: 1, restart_count: 0 }, console: { active: true, running: true, pid: 2, restart_count: 0 } },
    after: { config_sha256: authority.expected_config_sha256, gateway: { active: true, running: true, pid: 1, restart_count: 0 }, console: { active: true, running: true, pid: 2, restart_count: 0 } },
  };
  assert.doesNotThrow(() => assertHostStabilityEvidence(evidence, authority));
  evidence.after.gateway.pid = 9;
  assert.throws(() => assertHostStabilityEvidence(evidence, authority), /host stability/);
});
