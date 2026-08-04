import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  ARTIFACT_MANIFEST_V2_CLASSIFICATIONS: CLASSIFICATIONS,
  ARTIFACT_MANIFEST_V2_POLICIES: POLICIES,
  buildExactIdentity,
  buildSemanticIdentity,
  buildTopologyIdentity,
  buildRuntimeArtifactManifestV2,
  compareRuntimeArtifactManifests,
  validateRuntimeArtifactManifestV2,
} = require("../bin/runtime-artifact-manifest-v2-lib.cjs");

function makeTree({ fileContents = {}, groups = [], symlinks = [], modeOverrides = {}, rootMode = 0o700 } = {}) {
  const root = mkdtempSync(join(tmpdir(), "runtime-artifact-v2-"));
  const files = new Map(Object.entries(fileContents));
  for (const group of groups) {
    const content = group.content ?? files.get(group.paths[0]) ?? `group:${group.paths.join(",")}\n`;
    for (const path of group.paths) files.set(path, content);
  }
  for (const [path, content] of files) {
    const absolutePath = join(root, path);
    mkdirSync(dirname(absolutePath), { recursive: true, mode: 0o700 });
    writeFileSync(absolutePath, content, { mode: modeOverrides[path] ?? 0o400 });
  }
  for (const group of groups) {
    const first = join(root, group.paths[0]);
    for (const path of group.paths.slice(1)) {
      const target = join(root, path);
      rmSync(target, { force: true });
      linkSync(first, target);
    }
  }
  for (const symlink of symlinks) {
    const absolutePath = join(root, symlink.path);
    mkdirSync(dirname(absolutePath), { recursive: true, mode: 0o700 });
    symlinkSync(symlink.target, absolutePath);
  }
  for (const [path, mode] of Object.entries(modeOverrides)) {
    const absolutePath = join(root, path);
    if (existsSync(absolutePath) && lstatSync(absolutePath).isDirectory()) chmodSync(absolutePath, mode);
  }
  chmodSync(root, rootMode);
  return root;
}

function makeWritable(root) {
  chmodSync(root, 0o700);
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stats = lstatSync(path);
    if (stats.isDirectory()) makeWritable(path);
  }
}

function cleanupTree(root) {
  if (!root) return;
  try {
    makeWritable(root);
  } catch {
    // The containing temporary directory remains disposable even if a fixture failed early.
  }
  rmSync(root, { recursive: true, force: true });
}

function compare(candidateRoot, installedRoot, policy) {
  return compareRuntimeArtifactManifests({
    candidateManifest: buildRuntimeArtifactManifestV2({ rootDir: candidateRoot }),
    installedManifest: buildRuntimeArtifactManifestV2({ rootDir: installedRoot }),
    policy,
  });
}

function baseFiles() {
  return {
    "a.txt": "a\n",
    "b.txt": "b\n",
    "c.txt": "c\n",
    "d.txt": "d\n",
  };
}

function assertDecision(result, classification, accepted) {
  assert.equal(result.classification, classification);
  assert.equal(result.accepted, accepted);
  assert.equal(result.decision, accepted ? "PASS" : "REJECT");
}

function assertStructuredEvidence(result) {
  for (const field of [
    "candidate_semantic_identity",
    "installed_semantic_identity",
    "candidate_topology_identity",
    "installed_topology_identity",
    "candidate_exact_identity",
    "installed_exact_identity",
    "candidate_hardlink_group_count",
    "installed_hardlink_group_count",
    "candidate_external_hardlink_reference_count",
    "installed_external_hardlink_reference_count",
    "semantic_equal",
    "topology_equal",
    "classification",
    "policy",
    "decision",
    "accepted",
    "stop_reason",
  ]) {
    assert.equal(Object.hasOwn(result, field), true, `missing evidence field: ${field}`);
  }
  assert.equal(typeof result.stop_reason, "string");
  assert.equal(Object.hasOwn(result, "semantic_difference"), true);
  assert.equal(Object.hasOwn(result, "topology_difference"), true);
}

function recomputeManifestIdentities(manifest) {
  manifest.semantic_identity = buildSemanticIdentity({
    rootEntryType: manifest.root_entry_type,
    rootMode: manifest.root_mode,
    entries: manifest.entries,
  });
  manifest.topology_identity = buildTopologyIdentity({
    hardlinkGroups: manifest.hardlink_groups,
    topologyComplete: manifest.topology_complete,
    externalHardlinkReferenceCount: manifest.external_hardlink_reference_count,
  });
  manifest.exact_identity = buildExactIdentity({
    semanticIdentity: manifest.semantic_identity,
    topologyIdentity: manifest.topology_identity,
  });
  return manifest;
}

function forgeRootMode(manifest, mode) {
  const forged = structuredClone(manifest);
  const previousWritable = Number.parseInt(forged.root_mode, 8) & 0o222 ? 1 : 0;
  const nextWritable = Number.parseInt(mode, 8) & 0o222 ? 1 : 0;
  forged.root_mode = mode;
  forged.entries.find(entry => entry.path === ".").mode = mode;
  forged.writable_directory_count += nextWritable - previousWritable;
  return recomputeManifestIdentities(forged);
}

test("v2 exact identity separates semantic and topology identities", () => {
  const candidateRoot = makeTree({ fileContents: baseFiles(), symlinks: [{ path: "link", target: "a.txt" }] });
  const installedRoot = makeTree({ fileContents: baseFiles(), symlinks: [{ path: "link", target: "a.txt" }] });
  try {
    const candidate = buildRuntimeArtifactManifestV2({ rootDir: candidateRoot, checkedAt: "2026-08-02T00:00:00.000Z" });
    const installed = buildRuntimeArtifactManifestV2({ rootDir: installedRoot, checkedAt: "2026-08-02T01:00:00.000Z" });
    assert.equal(candidate.valid, true);
    assert.equal(validateRuntimeArtifactManifestV2(candidate).artifact_valid, true);
    assert.equal(candidate.semantic_identity, installed.semantic_identity);
    assert.equal(candidate.topology_identity, installed.topology_identity);
    assert.equal(candidate.exact_identity, installed.exact_identity);
    assert.equal(candidate.semantic_identity === candidate.topology_identity, false);
    assertDecision(compareRuntimeArtifactManifests({ candidateManifest: candidate, installedManifest: installed }), CLASSIFICATIONS.EXACT, true);
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
  }
});

test("install normalization classification is policy-independent and root-mode exact", () => {
  const candidateRoot = makeTree({ fileContents: baseFiles(), rootMode: 0o500 });
  const installedRoot = makeTree({ fileContents: baseFiles(), rootMode: 0o700 });
  try {
    for (const policy of [
      POLICIES.EXACT,
      POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1,
      POLICIES.ALLOW_INSTALL_ROOT_MODE_AND_INTERNAL_HARDLINK_SPLIT_V1,
    ]) {
      const result = compare(candidateRoot, installedRoot, policy);
      assertStructuredEvidence(result);
      assert.equal(result.classification, CLASSIFICATIONS.INSTALL_NORMALIZATION);
      assert.equal(result.semantic_equal, false);
      assert.equal(result.topology_equal, true);
      assert.equal(result.controlled_transformation.topology_classification, CLASSIFICATIONS.EXACT);
      assert.deepEqual(result.controlled_transformation.semantic_transformation, {
        path: ".",
        changed_fields: ["mode"],
        candidate_root_mode: "0500",
        installed_root_mode: "0700",
      });
      assert.equal(result.controlled_transformation.split_groups.length, 0);
      const accepted = policy === POLICIES.ALLOW_INSTALL_ROOT_MODE_AND_INTERNAL_HARDLINK_SPLIT_V1;
      assertDecision(result, CLASSIFICATIONS.INSTALL_NORMALIZATION, accepted);
      assert.equal(result.stop_reason, accepted
        ? "accepted_install_root_mode_normalization_v1"
        : `policy_rejected_install_normalization:${policy}`);
      assert.equal(result.controlled_transformation.accepted, accepted);
    }
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
  }
});

test("install normalization accepts complete, partial, and selected hardlink splits only under the new policy", () => {
  const candidateRoot = makeTree({
    fileContents: baseFiles(),
    rootMode: 0o500,
    groups: [
      { paths: ["a.txt", "b.txt", "c.txt"], content: "abc\n" },
      { paths: ["d.txt", "e.txt"], content: "de\n" },
    ],
  });
  const installedRoot = makeTree({
    fileContents: {
      "a.txt": "abc\n",
      "b.txt": "abc\n",
      "c.txt": "abc\n",
      "d.txt": "de\n",
      "e.txt": "de\n",
    },
    rootMode: 0o700,
    groups: [{ paths: ["a.txt", "b.txt"], content: "abc\n" }],
  });
  try {
    const result = compare(candidateRoot, installedRoot, POLICIES.ALLOW_INSTALL_ROOT_MODE_AND_INTERNAL_HARDLINK_SPLIT_V1);
    assertDecision(result, CLASSIFICATIONS.INSTALL_NORMALIZATION, true);
    assert.equal(result.semantic_equal, false);
    assert.equal(result.controlled_transformation.topology_classification, CLASSIFICATIONS.SPLIT_ONLY);
    assert.equal(result.topology_difference.removed_sharing_pair_count, 3);
    assert.equal(result.topology_difference.new_sharing_pair_count, 0);
    assert.equal(result.controlled_transformation.split_groups.length, 2);
    assert.equal(result.stop_reason, "accepted_install_root_mode_and_internal_hardlink_split_v1");

    for (const policy of [POLICIES.EXACT, POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1]) {
      const rejected = compare(candidateRoot, installedRoot, policy);
      assertDecision(rejected, CLASSIFICATIONS.INSTALL_NORMALIZATION, false);
      assert.equal(rejected.controlled_transformation.accepted, false);
      assert.equal(rejected.stop_reason, `policy_rejected_install_normalization:${policy}`);
    }
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
  }
});

test("the three better-sqlite3-style groups remain a pure split under install normalization", () => {
  const files = {
    "node_modules/better-sqlite3/build/Release/better_sqlite3.node": "native-a\n",
    "node_modules/better-sqlite3/build/Release/better_sqlite3.node.copy": "native-a\n",
    "node_modules/better-sqlite3/build/Release/obj.target/better_sqlite3.node": "native-b\n",
    "node_modules/better-sqlite3/build/Release/obj.target/better_sqlite3.node.copy": "native-b\n",
    "node_modules/better-sqlite3/deps/sqlite3/sqlite3.c": "native-c\n",
    "node_modules/better-sqlite3/deps/sqlite3/sqlite3.c.copy": "native-c\n",
  };
  const groups = [
    { paths: ["node_modules/better-sqlite3/build/Release/better_sqlite3.node", "node_modules/better-sqlite3/build/Release/better_sqlite3.node.copy"], content: "native-a\n" },
    { paths: ["node_modules/better-sqlite3/build/Release/obj.target/better_sqlite3.node", "node_modules/better-sqlite3/build/Release/obj.target/better_sqlite3.node.copy"], content: "native-b\n" },
    { paths: ["node_modules/better-sqlite3/deps/sqlite3/sqlite3.c", "node_modules/better-sqlite3/deps/sqlite3/sqlite3.c.copy"], content: "native-c\n" },
  ];
  const candidateRoot = makeTree({ fileContents: files, groups, rootMode: 0o500 });
  const installedRoot = makeTree({ fileContents: files, rootMode: 0o700 });
  try {
    const result = compare(candidateRoot, installedRoot, POLICIES.ALLOW_INSTALL_ROOT_MODE_AND_INTERNAL_HARDLINK_SPLIT_V1);
    assertDecision(result, CLASSIFICATIONS.INSTALL_NORMALIZATION, true);
    assert.equal(result.controlled_transformation.topology_classification, CLASSIFICATIONS.SPLIT_ONLY);
    assert.equal(result.topology_difference.removed_sharing_pair_count, 3);
    assert.equal(result.topology_difference.new_sharing_pair_count, 0);
    assert.equal(result.controlled_transformation.split_groups.length, 3);
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
  }
});

test("root normalization plus any non-root semantic difference remains an unconditional mismatch", () => {
  const cases = [
    {
      name: "child file mode",
      installed: { fileContents: baseFiles(), rootMode: 0o700, modeOverrides: { "b.txt": 0o600 } },
    },
    {
      name: "child directory mode",
      installed: { fileContents: { ...baseFiles(), "nested/file.txt": "nested\n" }, rootMode: 0o700, modeOverrides: { nested: 0o750 } },
      candidate: { fileContents: { ...baseFiles(), "nested/file.txt": "nested\n" }, rootMode: 0o500 },
    },
    {
      name: "content and size",
      installed: { fileContents: { ...baseFiles(), "b.txt": "changed-size\n" }, rootMode: 0o700 },
    },
    {
      name: "added path",
      installed: { fileContents: { ...baseFiles(), "added.txt": "added\n" }, rootMode: 0o700 },
    },
    {
      name: "deleted path",
      installed: { fileContents: { "a.txt": "a\n", "b.txt": "b\n", "c.txt": "c\n" }, rootMode: 0o700 },
    },
    {
      name: "renamed path",
      installed: { fileContents: { "a.txt": "a\n", "b.txt": "b\n", "c.txt": "c\n", "renamed.txt": "d\n" }, rootMode: 0o700 },
    },
    {
      name: "symlink target",
      candidate: { fileContents: baseFiles(), rootMode: 0o500, symlinks: [{ path: "link", target: "a.txt" }] },
      installed: { fileContents: baseFiles(), rootMode: 0o700, symlinks: [{ path: "link", target: "b.txt" }] },
    },
  ];
  const roots = [];
  try {
    for (const item of cases) {
      const candidateRoot = makeTree(item.candidate ?? { fileContents: baseFiles(), rootMode: 0o500 });
      const installedRoot = makeTree(item.installed);
      roots.push(candidateRoot, installedRoot);
      const result = compare(candidateRoot, installedRoot, POLICIES.ALLOW_INSTALL_ROOT_MODE_AND_INTERNAL_HARDLINK_SPLIT_V1);
      assertDecision(result, CLASSIFICATIONS.SEMANTIC_MISMATCH, false, item.name);
      assert.equal(result.stop_reason, "semantic_mismatch", item.name);
    }
  } finally {
    for (const root of roots) cleanupTree(root);
  }
});

test("root normalization plus symlink resolution-state change is an unconditional mismatch", () => {
  const candidateRoot = makeTree({ fileContents: baseFiles(), rootMode: 0o500, symlinks: [{ path: "link", target: "a.txt" }] });
  const installedRoot = makeTree({ fileContents: baseFiles(), rootMode: 0o700, symlinks: [{ path: "link", target: "a.txt" }] });
  try {
    const candidate = buildRuntimeArtifactManifestV2({ rootDir: candidateRoot });
    const installed = buildRuntimeArtifactManifestV2({ rootDir: installedRoot });
    const link = installed.entries.find(entry => entry.path === "link");
    link.resolved_within_root = false;
    recomputeManifestIdentities(installed);
    const result = compareRuntimeArtifactManifests({
      candidateManifest: candidate,
      installedManifest: installed,
      policy: POLICIES.ALLOW_INSTALL_ROOT_MODE_AND_INTERNAL_HARDLINK_SPLIT_V1,
    });
    assertDecision(result, CLASSIFICATIONS.SEMANTIC_MISMATCH, false);
    assert.equal(result.semantic_difference.difference_count, 2);
    assert.equal(result.stop_reason, "semantic_mismatch");
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
  }
});

test("only candidate root mode 0500 to installed root mode 0700 is normalizable", () => {
  const baseRoot = makeTree({ fileContents: baseFiles(), rootMode: 0o700 });
  try {
    const base = buildRuntimeArtifactManifestV2({ rootDir: baseRoot });
    const cases = [
      ["0700 to 0500", forgeRootMode(base, "0700"), forgeRootMode(base, "0500")],
      ["0500 to 0750", forgeRootMode(base, "0500"), forgeRootMode(base, "0750")],
      ["0400 to 0700", forgeRootMode(base, "0400"), forgeRootMode(base, "0700")],
      ["0400 to 0750", forgeRootMode(base, "0400"), forgeRootMode(base, "0750")],
    ];
    for (const [name, candidate, installed] of cases) {
      const result = compareRuntimeArtifactManifests({
        candidateManifest: candidate,
        installedManifest: installed,
        policy: POLICIES.ALLOW_INSTALL_ROOT_MODE_AND_INTERNAL_HARDLINK_SPLIT_V1,
      });
      assertDecision(result, CLASSIFICATIONS.SEMANTIC_MISMATCH, false, name);
      assert.equal(result.stop_reason, "semantic_mismatch", name);
    }
  } finally {
    cleanupTree(baseRoot);
  }
});

test("normalization policy preserves topology and validity rejection classifications", () => {
  const mergeFiles = { ...baseFiles(), "a.txt": "merged\n", "b.txt": "merged\n" };
  const mergeCandidate = makeTree({ fileContents: mergeFiles, rootMode: 0o500 });
  const mergeInstalled = makeTree({ fileContents: mergeFiles, groups: [{ paths: ["a.txt", "b.txt"], content: "merged\n" }], rootMode: 0o700 });
  const crossCandidate = makeTree({
    fileContents: { "a.txt": "same\n", "b.txt": "same\n", "c.txt": "same\n", "d.txt": "same\n" },
    groups: [{ paths: ["a.txt", "b.txt"], content: "same\n" }, { paths: ["c.txt", "d.txt"], content: "same\n" }],
    rootMode: 0o500,
  });
  const crossInstalled = makeTree({
    fileContents: { "a.txt": "same\n", "b.txt": "same\n", "c.txt": "same\n", "d.txt": "same\n" },
    groups: [{ paths: ["a.txt", "c.txt"], content: "same\n" }, { paths: ["b.txt", "d.txt"], content: "same\n" }],
    rootMode: 0o700,
  });
  try {
    for (const [candidateRoot, installedRoot, classification] of [
      [mergeCandidate, mergeInstalled, CLASSIFICATIONS.MERGE_DETECTED],
      [crossCandidate, crossInstalled, CLASSIFICATIONS.CROSS_GROUP_RELINK],
    ]) {
      const result = compare(candidateRoot, installedRoot, POLICIES.ALLOW_INSTALL_ROOT_MODE_AND_INTERNAL_HARDLINK_SPLIT_V1);
      assertDecision(result, classification, false);
      assert.equal(result.stop_reason, classification === CLASSIFICATIONS.MERGE_DETECTED ? "merge_detected" : "cross_group_relink");
    }
  } finally {
    cleanupTree(mergeCandidate);
    cleanupTree(mergeInstalled);
    cleanupTree(crossCandidate);
    cleanupTree(crossInstalled);
  }
});

test("builder and validator consistently fail closed for a backslash filename", () => {
  const invalidRoot = makeTree({ fileContents: { "bad\\name": "bad\n" } });
  const validRoot = makeTree({ fileContents: baseFiles() });
  const outputRoot = mkdtempSync(join(tmpdir(), "runtime-artifact-v2-invalid-path-cli-"));
  const outputPath = join(outputRoot, "invalid.json");
  try {
    const report = buildRuntimeArtifactManifestV2({ rootDir: invalidRoot });
    assert.equal(report.valid, false);
    assert.equal(report.semantic_identity, null);
    assert.equal(report.topology_identity, null);
    assert.equal(report.exact_identity, null);
    assert.equal(report.topology_complete, false);
    assert.equal(report.errors.includes("entries:path_invalid:bad\\name"), true);

    const validation = validateRuntimeArtifactManifestV2(report);
    assert.equal(validation.schema_valid, false);
    assert.equal(validation.artifact_valid, false);
    assert.equal(validation.errors.includes("entries:path_invalid:bad\\name"), true);

    for (const policy of [undefined, POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1]) {
      const result = compareRuntimeArtifactManifests({
        candidateManifest: buildRuntimeArtifactManifestV2({ rootDir: validRoot }),
        installedManifest: report,
        policy,
      });
      assertStructuredEvidence(result);
      assertDecision(result, CLASSIFICATIONS.INVALID_MANIFEST, false);
      assert.equal(result.stop_reason, "invalid_manifest_schema");
    }

    const cli = spawnSync(process.execPath, [
      "bin/build-runtime-artifact-manifest-v2.cjs",
      "--root", invalidRoot,
      "--out", outputPath,
    ], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
    assert.equal(cli.status, 2, cli.stderr);
    assert.equal(JSON.parse(readFileSync(outputPath, "utf8")).valid, false);
  } finally {
    cleanupTree(invalidRoot);
    cleanupTree(validRoot);
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("hardlink groups are self-consistent across mode, size, and SHA-256", () => {
  const candidateRoot = makeTree({ fileContents: baseFiles(), groups: [{ paths: ["a.txt", "b.txt"], content: "shared\n" }] });
  const installedRoot = makeTree({ fileContents: { ...baseFiles(), "a.txt": "shared\n", "b.txt": "shared\n" } });
  try {
    const candidate = buildRuntimeArtifactManifestV2({ rootDir: candidateRoot });
    const installed = buildRuntimeArtifactManifestV2({ rootDir: installedRoot });
    assert.equal(validateRuntimeArtifactManifestV2(candidate).artifact_valid, true);

    const variants = [
      {
        name: "sha256",
        error: "hardlink_group:member_sha256_mismatch",
        mutate(manifest, member) {
          member.sha256 = "0".repeat(64);
        },
      },
      {
        name: "size",
        error: "hardlink_group:member_size_mismatch",
        mutate(manifest, member) {
          member.size += 1;
          manifest.total_file_bytes += 1;
        },
      },
      {
        name: "mode",
        error: "hardlink_group:member_mode_mismatch",
        mutate(manifest, member) {
          member.mode = "0600";
          manifest.writable_file_count += 1;
        },
      },
      {
        name: "simultaneous",
        error: [
          "hardlink_group:member_mode_mismatch",
          "hardlink_group:member_size_mismatch",
          "hardlink_group:member_sha256_mismatch",
        ],
        mutate(manifest, member) {
          member.sha256 = "f".repeat(64);
          member.size += 1;
          member.mode = "0600";
          manifest.total_file_bytes += 1;
          manifest.writable_file_count += 1;
        },
      },
    ];

    for (const variant of variants) {
      const forged = structuredClone(candidate);
      const member = forged.entries.find(entry => entry.path === "b.txt");
      variant.mutate(forged, member);
      recomputeManifestIdentities(forged);
      const validation = validateRuntimeArtifactManifestV2(forged);
      assert.equal(validation.schema_valid, false, variant.name);
      assert.equal(validation.artifact_valid, false, variant.name);
      const expectedErrors = Array.isArray(variant.error) ? variant.error : [variant.error];
      for (const expectedError of expectedErrors) {
        assert.equal(validation.errors.some(error => error.startsWith(expectedError)), true, `${variant.name}:${expectedError}`);
      }
      assert.equal(forged.semantic_identity !== candidate.semantic_identity, true, variant.name);
      assert.equal(forged.exact_identity !== candidate.exact_identity, true, variant.name);

      for (const policy of [POLICIES.EXACT, POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1]) {
        const result = compareRuntimeArtifactManifests({
          candidateManifest: candidate,
          installedManifest: forged,
          policy,
        });
        assertStructuredEvidence(result);
        assertDecision(result, CLASSIFICATIONS.INVALID_MANIFEST, false);
        assert.equal(result.accepted, false);
        assert.equal(result.stop_reason, "invalid_manifest_schema");
      }
    }
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
  }
});

test("complete hardlink expansion is split-only", () => {
  const candidateRoot = makeTree({ fileContents: baseFiles(), groups: [{ paths: ["a.txt", "b.txt"], content: "shared\n" }] });
  const installedRoot = makeTree({ fileContents: { ...baseFiles(), "a.txt": "shared\n", "b.txt": "shared\n" } });
  try {
    assertDecision(compare(candidateRoot, installedRoot, POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1), CLASSIFICATIONS.SPLIT_ONLY, true);
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
  }
});

test("partial hardlink group split is accepted only by split policy", () => {
  const candidateRoot = makeTree({ fileContents: baseFiles(), groups: [{ paths: ["a.txt", "b.txt", "c.txt"], content: "shared\n" }] });
  const installedRoot = makeTree({ fileContents: { ...baseFiles(), "a.txt": "shared\n", "b.txt": "shared\n", "c.txt": "shared\n" }, groups: [{ paths: ["a.txt", "b.txt"], content: "shared\n" }] });
  try {
    const result = compare(candidateRoot, installedRoot, POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1);
    assertDecision(result, CLASSIFICATIONS.SPLIT_ONLY, true);
    assert.equal(result.controlled_transformation.type, "internal_hardlink_split_v1");
    assert.equal(result.controlled_transformation.split_groups.length, 1);
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
  }
});

test("selected groups may split while other groups remain exact", () => {
  const candidateRoot = makeTree({
    fileContents: baseFiles(),
    groups: [
      { paths: ["a.txt", "b.txt"], content: "ab\n" },
      { paths: ["c.txt", "d.txt"], content: "cd\n" },
    ],
  });
  const installedRoot = makeTree({
    fileContents: { "a.txt": "ab\n", "b.txt": "ab\n", "c.txt": "cd\n", "d.txt": "cd\n" },
    groups: [{ paths: ["c.txt", "d.txt"], content: "cd\n" }],
  });
  try {
    const result = compare(candidateRoot, installedRoot, POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1);
    assertDecision(result, CLASSIFICATIONS.SPLIT_ONLY, true);
    assert.deepEqual(result.controlled_transformation.split_groups[0].candidate_paths, ["a.txt", "b.txt"]);
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
  }
});

test("independent files merged into one inode are rejected as a merge", () => {
  const mergeFiles = { ...baseFiles(), "a.txt": "merged\n", "b.txt": "merged\n" };
  const candidateRoot = makeTree({ fileContents: mergeFiles });
  const installedRoot = makeTree({ fileContents: mergeFiles, groups: [{ paths: ["a.txt", "b.txt"], content: "merged\n" }] });
  try {
    assertDecision(compare(candidateRoot, installedRoot, POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1), CLASSIFICATIONS.MERGE_DETECTED, false);
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
  }
});

test("separate candidate groups cross-linked after installation are rejected", () => {
  const candidateRoot = makeTree({
    fileContents: { "a.txt": "same\n", "b.txt": "same\n", "c.txt": "same\n", "d.txt": "same\n" },
    groups: [{ paths: ["a.txt", "b.txt"], content: "same\n" }, { paths: ["c.txt", "d.txt"], content: "same\n" }],
  });
  const installedRoot = makeTree({
    fileContents: { "a.txt": "same\n", "b.txt": "same\n", "c.txt": "same\n", "d.txt": "same\n" },
    groups: [{ paths: ["a.txt", "c.txt"], content: "same\n" }, { paths: ["b.txt", "d.txt"], content: "same\n" }],
  });
  try {
    assertDecision(compare(candidateRoot, installedRoot, POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1), CLASSIFICATIONS.CROSS_GROUP_RELINK, false);
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
  }
});

test("split plus content change is an unconditional semantic mismatch", () => {
  const candidateRoot = makeTree({ fileContents: baseFiles(), groups: [{ paths: ["a.txt", "b.txt"], content: "shared\n" }] });
  const installedRoot = makeTree({ fileContents: { ...baseFiles(), "a.txt": "shared\n", "b.txt": "changed\n" } });
  try {
    assertDecision(compare(candidateRoot, installedRoot, POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1), CLASSIFICATIONS.SEMANTIC_MISMATCH, false);
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
  }
});

test("split plus mode change is an unconditional semantic mismatch", () => {
  const candidateRoot = makeTree({ fileContents: baseFiles(), groups: [{ paths: ["a.txt", "b.txt"], content: "shared\n" }] });
  const installedRoot = makeTree({ fileContents: { ...baseFiles(), "a.txt": "shared\n", "b.txt": "shared\n" }, modeOverrides: { "b.txt": 0o600 } });
  try {
    assertDecision(compare(candidateRoot, installedRoot, POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1), CLASSIFICATIONS.SEMANTIC_MISMATCH, false);
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
  }
});

test("added path is a semantic mismatch", () => {
  const candidateRoot = makeTree({ fileContents: baseFiles() });
  const installedRoot = makeTree({ fileContents: { ...baseFiles(), "added.txt": "added\n" } });
  try {
    assertDecision(compare(candidateRoot, installedRoot, POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1), CLASSIFICATIONS.SEMANTIC_MISMATCH, false);
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
  }
});

test("deleted path is a semantic mismatch", () => {
  const candidateRoot = makeTree({ fileContents: baseFiles() });
  const installedRoot = makeTree({ fileContents: { "a.txt": "a\n", "b.txt": "b\n", "c.txt": "c\n" } });
  try {
    assertDecision(compare(candidateRoot, installedRoot, POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1), CLASSIFICATIONS.SEMANTIC_MISMATCH, false);
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
  }
});

test("renamed path is a semantic mismatch", () => {
  const candidateRoot = makeTree({ fileContents: baseFiles() });
  const installedRoot = makeTree({ fileContents: { "a.txt": "a\n", "b.txt": "b\n", "c.txt": "c\n", "renamed.txt": "d\n" } });
  try {
    assertDecision(compare(candidateRoot, installedRoot, POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1), CLASSIFICATIONS.SEMANTIC_MISMATCH, false);
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
  }
});

test("changed symlink target is a semantic mismatch", () => {
  const candidateRoot = makeTree({ fileContents: baseFiles(), symlinks: [{ path: "link", target: "a.txt" }] });
  const installedRoot = makeTree({ fileContents: baseFiles(), symlinks: [{ path: "link", target: "b.txt" }] });
  try {
    assertDecision(compare(candidateRoot, installedRoot, POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1), CLASSIFICATIONS.SEMANTIC_MISMATCH, false);
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
  }
});

test("external symlink fails closed independently", () => {
  const parent = mkdtempSync(join(tmpdir(), "runtime-artifact-v2-external-symlink-"));
  const candidateRoot = makeTree({ fileContents: baseFiles() });
  const installedRoot = join(parent, "installed");
  mkdirSync(installedRoot, { mode: 0o700 });
  writeFileSync(join(parent, "outside.txt"), "outside\n");
  symlinkSync(join(parent, "outside.txt"), join(installedRoot, "external-link"));
  try {
    const installed = buildRuntimeArtifactManifestV2({ rootDir: installedRoot });
    assert.equal(installed.valid, false);
    assert.equal(installed.external_symlink_count, 1);
    assertDecision(compareRuntimeArtifactManifests({ candidateManifest: buildRuntimeArtifactManifestV2({ rootDir: candidateRoot }), installedManifest: installed, policy: POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1 }), CLASSIFICATIONS.INVALID_MANIFEST, false);
    assertDecision(compareRuntimeArtifactManifests({ candidateManifest: buildRuntimeArtifactManifestV2({ rootDir: candidateRoot }), installedManifest: installed, policy: POLICIES.ALLOW_INSTALL_ROOT_MODE_AND_INTERNAL_HARDLINK_SPLIT_V1 }), CLASSIFICATIONS.INVALID_MANIFEST, false);
  } finally {
    cleanupTree(candidateRoot);
    rmSync(parent, { recursive: true, force: true });
  }
});

test("dangling symlink fails closed independently", () => {
  const candidateRoot = makeTree({ fileContents: baseFiles() });
  const installedRoot = makeTree({ fileContents: baseFiles(), symlinks: [{ path: "dangling", target: "missing.txt" }] });
  try {
    const installed = buildRuntimeArtifactManifestV2({ rootDir: installedRoot });
    assert.equal(installed.valid, false);
    assert.equal(installed.dangling_symlink_count, 1);
    assertDecision(compareRuntimeArtifactManifests({ candidateManifest: buildRuntimeArtifactManifestV2({ rootDir: candidateRoot }), installedManifest: installed, policy: POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1 }), CLASSIFICATIONS.INVALID_MANIFEST, false);
    assertDecision(compareRuntimeArtifactManifests({ candidateManifest: buildRuntimeArtifactManifestV2({ rootDir: candidateRoot }), installedManifest: installed, policy: POLICIES.ALLOW_INSTALL_ROOT_MODE_AND_INTERNAL_HARDLINK_SPLIT_V1 }), CLASSIFICATIONS.INVALID_MANIFEST, false);
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
  }
});

test("external hardlink reference is a distinct fail-closed classification", () => {
  const parent = mkdtempSync(join(tmpdir(), "runtime-artifact-v2-external-hardlink-"));
  const candidateRoot = makeTree({ fileContents: baseFiles() });
  const installedRoot = join(parent, "installed");
  mkdirSync(installedRoot, { mode: 0o700 });
  const outside = join(parent, "outside.txt");
  writeFileSync(outside, "outside\n");
  linkSync(outside, join(installedRoot, "external-hardlink"));
  try {
    const installed = buildRuntimeArtifactManifestV2({ rootDir: installedRoot });
    assert.equal(installed.valid, false);
    assert.equal(installed.external_hardlink_reference_count, 1);
    assertDecision(compareRuntimeArtifactManifests({ candidateManifest: buildRuntimeArtifactManifestV2({ rootDir: candidateRoot }), installedManifest: installed, policy: POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1 }), CLASSIFICATIONS.EXTERNAL_REFERENCE, false);
    assertDecision(compareRuntimeArtifactManifests({ candidateManifest: buildRuntimeArtifactManifestV2({ rootDir: candidateRoot }), installedManifest: installed, policy: POLICIES.ALLOW_INSTALL_ROOT_MODE_AND_INTERNAL_HARDLINK_SPLIT_V1 }), CLASSIFICATIONS.EXTERNAL_REFERENCE, false);
  } finally {
    cleanupTree(candidateRoot);
    rmSync(parent, { recursive: true, force: true });
  }
});

test("special file fails closed", () => {
  const candidateRoot = makeTree({ fileContents: baseFiles() });
  const installedRoot = makeTree({ fileContents: baseFiles() });
  const mkfifo = spawnSync("mkfifo", [join(installedRoot, "named-pipe")], { encoding: "utf8" });
  assert.equal(mkfifo.status, 0, mkfifo.stderr);
  try {
    const installed = buildRuntimeArtifactManifestV2({ rootDir: installedRoot });
    assert.equal(installed.valid, false);
    assert.equal(installed.special_entry_count, 1);
    assertDecision(compareRuntimeArtifactManifests({ candidateManifest: buildRuntimeArtifactManifestV2({ rootDir: candidateRoot }), installedManifest: installed, policy: POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1 }), CLASSIFICATIONS.INVALID_MANIFEST, false);
    assertDecision(compareRuntimeArtifactManifests({ candidateManifest: buildRuntimeArtifactManifestV2({ rootDir: candidateRoot }), installedManifest: installed, policy: POLICIES.ALLOW_INSTALL_ROOT_MODE_AND_INTERNAL_HARDLINK_SPLIT_V1 }), CLASSIFICATIONS.INVALID_MANIFEST, false);
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
  }
});

test("root symlink fails closed", () => {
  const parent = mkdtempSync(join(tmpdir(), "runtime-artifact-v2-root-symlink-"));
  const target = makeTree({ fileContents: baseFiles() });
  const rootSymlink = join(parent, "root-link");
  symlinkSync(target, rootSymlink);
  try {
    const report = buildRuntimeArtifactManifestV2({ rootDir: rootSymlink });
    assert.equal(report.valid, false);
    assert.equal(report.root_entry_type, "symlink");
    assertDecision(compareRuntimeArtifactManifests({ candidateManifest: buildRuntimeArtifactManifestV2({ rootDir: target }), installedManifest: report, policy: POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1 }), CLASSIFICATIONS.INVALID_MANIFEST, false);
    assertDecision(compareRuntimeArtifactManifests({ candidateManifest: buildRuntimeArtifactManifestV2({ rootDir: target }), installedManifest: report, policy: POLICIES.ALLOW_INSTALL_ROOT_MODE_AND_INTERNAL_HARDLINK_SPLIT_V1 }), CLASSIFICATIONS.INVALID_MANIFEST, false);
  } finally {
    cleanupTree(target);
    rmSync(parent, { recursive: true, force: true });
  }
});

test("split combined with new sharing is mixed or unknown", () => {
  const candidateRoot = makeTree({
    fileContents: { "a.txt": "same\n", "b.txt": "same\n", "c.txt": "same\n" },
    groups: [{ paths: ["a.txt", "b.txt"], content: "same\n" }],
  });
  const installedRoot = makeTree({
    fileContents: { "a.txt": "same\n", "b.txt": "same\n", "c.txt": "same\n" },
    groups: [{ paths: ["b.txt", "c.txt"], content: "same\n" }],
  });
  try {
    assertDecision(compare(candidateRoot, installedRoot, POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1), CLASSIFICATIONS.MIXED_OR_UNKNOWN, false);
    assertDecision(compare(candidateRoot, installedRoot, POLICIES.ALLOW_INSTALL_ROOT_MODE_AND_INTERNAL_HARDLINK_SPLIT_V1), CLASSIFICATIONS.MIXED_OR_UNKNOWN, false);
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
  }
});

test("malformed topology schema is rejected as an invalid manifest", () => {
  const candidateRoot = makeTree({ fileContents: baseFiles(), groups: [{ paths: ["a.txt", "b.txt"], content: "shared\n" }] });
  const installedRoot = makeTree({ fileContents: { ...baseFiles(), "a.txt": "shared\n", "b.txt": "shared\n" } });
  try {
    const candidate = buildRuntimeArtifactManifestV2({ rootDir: candidateRoot });
    const installed = buildRuntimeArtifactManifestV2({ rootDir: installedRoot });
    const malformed = { ...installed, hardlink_groups: [], topology_group_count: 0, hardlink_group_count: 0 };
    assert.equal(validateRuntimeArtifactManifestV2(malformed).schema_valid, false);
    assertDecision(compareRuntimeArtifactManifests({ candidateManifest: candidate, installedManifest: malformed, policy: POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1 }), CLASSIFICATIONS.INVALID_MANIFEST, false);
    assertDecision(compareRuntimeArtifactManifests({ candidateManifest: candidate, installedManifest: malformed, policy: POLICIES.ALLOW_INSTALL_ROOT_MODE_AND_INTERNAL_HARDLINK_SPLIT_V1 }), CLASSIFICATIONS.INVALID_MANIFEST, false);
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
  }
});

test("comparison reports provide bounded structured evidence for every requested classification", () => {
  const exactCandidateRoot = makeTree({ fileContents: baseFiles() });
  const exactInstalledRoot = makeTree({ fileContents: baseFiles() });
  const splitCandidateRoot = makeTree({ fileContents: baseFiles(), groups: [{ paths: ["a.txt", "b.txt"], content: "shared\n" }] });
  const splitInstalledRoot = makeTree({ fileContents: { ...baseFiles(), "a.txt": "shared\n", "b.txt": "shared\n" } });
  const mergeFiles = { ...baseFiles(), "a.txt": "merged\n", "b.txt": "merged\n" };
  const mergeCandidateRoot = makeTree({ fileContents: mergeFiles });
  const mergeInstalledRoot = makeTree({ fileContents: mergeFiles, groups: [{ paths: ["a.txt", "b.txt"], content: "merged\n" }] });
  const crossCandidateRoot = makeTree({
    fileContents: { "a.txt": "same\n", "b.txt": "same\n", "c.txt": "same\n", "d.txt": "same\n" },
    groups: [{ paths: ["a.txt", "b.txt"], content: "same\n" }, { paths: ["c.txt", "d.txt"], content: "same\n" }],
  });
  const crossInstalledRoot = makeTree({
    fileContents: { "a.txt": "same\n", "b.txt": "same\n", "c.txt": "same\n", "d.txt": "same\n" },
    groups: [{ paths: ["a.txt", "c.txt"], content: "same\n" }, { paths: ["b.txt", "d.txt"], content: "same\n" }],
  });
  const mixedCandidateRoot = makeTree({
    fileContents: { "a.txt": "same\n", "b.txt": "same\n", "c.txt": "same\n" },
    groups: [{ paths: ["a.txt", "b.txt"], content: "same\n" }],
  });
  const mixedInstalledRoot = makeTree({
    fileContents: { "a.txt": "same\n", "b.txt": "same\n", "c.txt": "same\n" },
    groups: [{ paths: ["b.txt", "c.txt"], content: "same\n" }],
  });
  const semanticCandidateRoot = makeTree({ fileContents: baseFiles() });
  const semanticInstalledRoot = makeTree({ fileContents: { ...baseFiles(), "b.txt": "changed\n" } });
  const externalParent = mkdtempSync(join(tmpdir(), "runtime-artifact-v2-evidence-external-"));
  const externalInstalledRoot = join(externalParent, "installed");
  mkdirSync(externalInstalledRoot, { mode: 0o700 });
  const outside = join(externalParent, "outside.txt");
  writeFileSync(outside, "outside\n");
  linkSync(outside, join(externalInstalledRoot, "external-hardlink"));
  const roots = [
    exactCandidateRoot, exactInstalledRoot,
    splitCandidateRoot, splitInstalledRoot,
    mergeCandidateRoot, mergeInstalledRoot,
    crossCandidateRoot, crossInstalledRoot,
    mixedCandidateRoot, mixedInstalledRoot,
    semanticCandidateRoot, semanticInstalledRoot,
  ];
  try {
    const manifest = root => buildRuntimeArtifactManifestV2({ rootDir: root });
    const run = (candidateRoot, installedRoot, policy) => compareRuntimeArtifactManifests({
      candidateManifest: manifest(candidateRoot),
      installedManifest: manifest(installedRoot),
      policy,
    });

    const exact = run(exactCandidateRoot, exactInstalledRoot);
    assertStructuredEvidence(exact);
    assertDecision(exact, CLASSIFICATIONS.EXACT, true);
    assert.equal(exact.semantic_equal, true);
    assert.equal(exact.topology_equal, true);
    assert.equal(exact.candidate_semantic_identity !== null, true);
    assert.equal(exact.candidate_topology_identity !== null, true);
    assert.equal(exact.candidate_exact_identity !== null, true);
    assert.equal(exact.stop_reason, "accepted_exact");
    assert.equal(exact.semantic_difference.difference_count, 0);
    assert.equal(exact.topology_difference.new_sharing_pair_count, 0);

    const acceptedSplit = run(splitCandidateRoot, splitInstalledRoot, POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1);
    assertStructuredEvidence(acceptedSplit);
    assertDecision(acceptedSplit, CLASSIFICATIONS.SPLIT_ONLY, true);
    assert.equal(acceptedSplit.semantic_equal, true);
    assert.equal(acceptedSplit.topology_equal, false);
    assert.equal(acceptedSplit.stop_reason, "accepted_controlled_internal_hardlink_split_v1");
    assert.equal(acceptedSplit.controlled_transformation.split_groups.length, 1);
    assert.equal(acceptedSplit.topology_difference.removed_sharing_pair_count, 1);

    const rejectedSplit = run(splitCandidateRoot, splitInstalledRoot);
    assertStructuredEvidence(rejectedSplit);
    assertDecision(rejectedSplit, CLASSIFICATIONS.SPLIT_ONLY, false);
    assert.equal(rejectedSplit.stop_reason, "policy_rejected_split_only:exact");
    assert.equal(rejectedSplit.controlled_transformation.accepted, false);

    const merge = run(mergeCandidateRoot, mergeInstalledRoot, POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1);
    assertStructuredEvidence(merge);
    assertDecision(merge, CLASSIFICATIONS.MERGE_DETECTED, false);
    assert.equal(merge.semantic_equal, true);
    assert.equal(merge.topology_equal, false);
    assert.equal(merge.stop_reason, "merge_detected");
    assert.equal(merge.topology_difference.new_sharing_pair_count, 1);
    assert.equal(merge.topology_difference.installed_affected_groups.total_group_count > 0, true);

    const cross = run(crossCandidateRoot, crossInstalledRoot, POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1);
    assertStructuredEvidence(cross);
    assertDecision(cross, CLASSIFICATIONS.CROSS_GROUP_RELINK, false);
    assert.equal(cross.stop_reason, "cross_group_relink");
    assert.equal(cross.topology_difference.new_sharing_pair_count > 0, true);
    assert.equal(cross.topology_difference.candidate_affected_groups.groups.length > 0, true);

    const mixed = run(mixedCandidateRoot, mixedInstalledRoot, POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1);
    assertStructuredEvidence(mixed);
    assertDecision(mixed, CLASSIFICATIONS.MIXED_OR_UNKNOWN, false);
    assert.equal(mixed.stop_reason, "mixed_or_unknown_topology");
    assert.equal(mixed.topology_difference.removed_sharing_pair_count > 0, true);
    assert.equal(mixed.topology_difference.new_sharing_pair_count > 0, true);

    const semantic = run(semanticCandidateRoot, semanticInstalledRoot, POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1);
    assertStructuredEvidence(semantic);
    assertDecision(semantic, CLASSIFICATIONS.SEMANTIC_MISMATCH, false);
    assert.equal(semantic.semantic_equal, false);
    assert.equal(semantic.stop_reason, "semantic_mismatch");
    assert.equal(semantic.semantic_difference.difference_count, 1);
    assert.deepEqual(semantic.semantic_difference.changed_paths[0].changed_fields, ["size", "sha256"]);

    const invalid = compareRuntimeArtifactManifests({
      candidateManifest: {},
      installedManifest: manifest(exactInstalledRoot),
      policy: POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1,
    });
    assertStructuredEvidence(invalid);
    assertDecision(invalid, CLASSIFICATIONS.INVALID_MANIFEST, false);
    assert.equal(invalid.stop_reason, "invalid_manifest_schema");
    assert.equal(invalid.candidate_semantic_identity, null);
    assert.equal(invalid.candidate_hardlink_group_count, null);
    assert.equal(invalid.semantic_equal, null);

    const external = compareRuntimeArtifactManifests({
      candidateManifest: manifest(exactCandidateRoot),
      installedManifest: manifest(externalInstalledRoot),
      policy: POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1,
    });
    assertStructuredEvidence(external);
    assertDecision(external, CLASSIFICATIONS.EXTERNAL_REFERENCE, false);
    assert.equal(external.stop_reason, "external_hardlink_reference");
    assert.equal(external.installed_external_hardlink_reference_count, 1);
    assert.equal(external.installed_exact_identity, null);
    assert.equal(external.topology_difference, null);
  } finally {
    for (const root of roots) cleanupTree(root);
    rmSync(externalParent, { recursive: true, force: true });
  }
});

test("default exact policy rejects split-only and does not infer an exception", () => {
  const candidateRoot = makeTree({ fileContents: baseFiles(), groups: [{ paths: ["a.txt", "b.txt"], content: "shared\n" }] });
  const installedRoot = makeTree({ fileContents: { ...baseFiles(), "a.txt": "shared\n", "b.txt": "shared\n" } });
  try {
    assertDecision(compareRuntimeArtifactManifests({
      candidateManifest: buildRuntimeArtifactManifestV2({ rootDir: candidateRoot }),
      installedManifest: buildRuntimeArtifactManifestV2({ rootDir: installedRoot }),
    }), CLASSIFICATIONS.SPLIT_ONLY, false);
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
  }
});

test("explicit split policy accepts only split-only transformations", () => {
  const splitCandidate = makeTree({ fileContents: baseFiles(), groups: [{ paths: ["a.txt", "b.txt"], content: "shared\n" }] });
  const splitInstalled = makeTree({ fileContents: { ...baseFiles(), "a.txt": "shared\n", "b.txt": "shared\n" } });
  const mergeFiles = { ...baseFiles(), "a.txt": "merged\n", "b.txt": "merged\n" };
  const mergeCandidate = makeTree({ fileContents: mergeFiles });
  const mergeInstalled = makeTree({ fileContents: mergeFiles, groups: [{ paths: ["a.txt", "b.txt"], content: "merged\n" }] });
  try {
    assertDecision(compare(splitCandidate, splitInstalled, POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1), CLASSIFICATIONS.SPLIT_ONLY, true);
    assertDecision(compare(mergeCandidate, mergeInstalled, POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1), CLASSIFICATIONS.MERGE_DETECTED, false);
  } finally {
    cleanupTree(splitCandidate);
    cleanupTree(splitInstalled);
    cleanupTree(mergeCandidate);
    cleanupTree(mergeInstalled);
  }
});

test("synthetic three better-sqlite3 hardlink groups may expand independently", () => {
  const files = {
    "node_modules/better-sqlite3/build/Release/better_sqlite3.node": "native-a\n",
    "node_modules/better-sqlite3/build/Release/better_sqlite3.node.copy": "native-a\n",
    "node_modules/better-sqlite3/build/Release/obj.target/better_sqlite3.node": "native-b\n",
    "node_modules/better-sqlite3/build/Release/obj.target/better_sqlite3.node.copy": "native-b\n",
    "node_modules/better-sqlite3/deps/sqlite3/sqlite3.c": "native-c\n",
    "node_modules/better-sqlite3/deps/sqlite3/sqlite3.c.copy": "native-c\n",
  };
  const groups = [
    { paths: ["node_modules/better-sqlite3/build/Release/better_sqlite3.node", "node_modules/better-sqlite3/build/Release/better_sqlite3.node.copy"], content: "native-a\n" },
    { paths: ["node_modules/better-sqlite3/build/Release/obj.target/better_sqlite3.node", "node_modules/better-sqlite3/build/Release/obj.target/better_sqlite3.node.copy"], content: "native-b\n" },
    { paths: ["node_modules/better-sqlite3/deps/sqlite3/sqlite3.c", "node_modules/better-sqlite3/deps/sqlite3/sqlite3.c.copy"], content: "native-c\n" },
  ];
  const candidateRoot = makeTree({ fileContents: files, groups });
  const installedRoot = makeTree({ fileContents: files });
  try {
    const candidate = buildRuntimeArtifactManifestV2({ rootDir: candidateRoot });
    const installed = buildRuntimeArtifactManifestV2({ rootDir: installedRoot });
    assert.equal(candidate.hardlink_group_count, 3);
    assert.equal(installed.hardlink_group_count, 0);
    assertDecision(compareRuntimeArtifactManifests({ candidateManifest: candidate, installedManifest: installed, policy: POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1 }), CLASSIFICATIONS.SPLIT_ONLY, true);
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
  }
});

test("v2 build and compare CLIs expose exact default and explicit split policy", () => {
  const candidateRoot = makeTree({ fileContents: baseFiles(), groups: [{ paths: ["a.txt", "b.txt"], content: "shared\n" }] });
  const installedRoot = makeTree({ fileContents: { ...baseFiles(), "a.txt": "shared\n", "b.txt": "shared\n" } });
  const outputRoot = mkdtempSync(join(tmpdir(), "runtime-artifact-v2-cli-"));
  const candidateManifestPath = join(outputRoot, "candidate.json");
  const installedManifestPath = join(outputRoot, "installed.json");
  const comparePath = join(outputRoot, "compare.json");
  const cwd = new URL("..", import.meta.url);
  try {
    for (const [root, output] of [[candidateRoot, candidateManifestPath], [installedRoot, installedManifestPath]]) {
      const built = spawnSync(process.execPath, ["bin/build-runtime-artifact-manifest-v2.cjs", "--root", root, "--out", output], { cwd, encoding: "utf8" });
      assert.equal(built.status, 0, built.stderr);
      assert.equal(existsSync(output), true);
    }
    const rejected = spawnSync(process.execPath, [
      "bin/compare-runtime-artifact-manifests-v2.cjs",
      "--candidate", candidateManifestPath,
      "--installed", installedManifestPath,
      "--out", comparePath,
    ], { cwd, encoding: "utf8" });
    assert.equal(rejected.status, 2, rejected.stderr);
    assert.equal(JSON.parse(readFileSync(comparePath, "utf8")).classification, CLASSIFICATIONS.SPLIT_ONLY);
    const accepted = spawnSync(process.execPath, [
      "bin/compare-runtime-artifact-manifests-v2.cjs",
      "--candidate", candidateManifestPath,
      "--installed", installedManifestPath,
      "--policy", POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1,
    ], { cwd, encoding: "utf8" });
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(JSON.parse(accepted.stdout).accepted, true);
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("v2 compare CLI exposes and enforces the strict install-normalization policy", () => {
  const candidateRoot = makeTree({ fileContents: baseFiles(), rootMode: 0o500 });
  const installedRoot = makeTree({ fileContents: baseFiles(), rootMode: 0o700 });
  const outputRoot = mkdtempSync(join(tmpdir(), "runtime-artifact-v2-normalization-cli-"));
  const candidateManifestPath = join(outputRoot, "candidate.json");
  const installedManifestPath = join(outputRoot, "installed.json");
  const comparePath = join(outputRoot, "compare.json");
  const cwd = new URL("..", import.meta.url);
  try {
    const help = spawnSync(process.execPath, ["bin/compare-runtime-artifact-manifests-v2.cjs", "--help"], { cwd, encoding: "utf8" });
    assert.equal(help.status, 0, help.stderr);
    assert.equal(help.stdout.includes(POLICIES.EXACT), true);
    assert.equal(help.stdout.includes(POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1), true);
    assert.equal(help.stdout.includes(POLICIES.ALLOW_INSTALL_ROOT_MODE_AND_INTERNAL_HARDLINK_SPLIT_V1), true);

    for (const [root, output] of [[candidateRoot, candidateManifestPath], [installedRoot, installedManifestPath]]) {
      const built = spawnSync(process.execPath, ["bin/build-runtime-artifact-manifest-v2.cjs", "--root", root, "--out", output], { cwd, encoding: "utf8" });
      assert.equal(built.status, 0, built.stderr);
    }

    const newPolicy = spawnSync(process.execPath, [
      "bin/compare-runtime-artifact-manifests-v2.cjs",
      "--candidate", candidateManifestPath,
      "--installed", installedManifestPath,
      "--policy", POLICIES.ALLOW_INSTALL_ROOT_MODE_AND_INTERNAL_HARDLINK_SPLIT_V1,
      "--out", comparePath,
    ], { cwd, encoding: "utf8" });
    assert.equal(newPolicy.status, 0, newPolicy.stderr);
    const accepted = JSON.parse(readFileSync(comparePath, "utf8"));
    assert.equal(accepted.classification, CLASSIFICATIONS.INSTALL_NORMALIZATION);
    assert.equal(accepted.accepted, true);

    for (const policy of [POLICIES.EXACT, POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1]) {
      const rejected = spawnSync(process.execPath, [
        "bin/compare-runtime-artifact-manifests-v2.cjs",
        "--candidate", candidateManifestPath,
        "--installed", installedManifestPath,
        "--policy", policy,
      ], { cwd, encoding: "utf8" });
      assert.equal(rejected.status, 2, `${policy}: ${rejected.stderr}`);
      const report = JSON.parse(rejected.stdout);
      assert.equal(report.classification, CLASSIFICATIONS.INSTALL_NORMALIZATION);
      assert.equal(report.accepted, false);
    }

    const unknown = spawnSync(process.execPath, [
      "bin/compare-runtime-artifact-manifests-v2.cjs",
      "--candidate", candidateManifestPath,
      "--installed", installedManifestPath,
      "--policy", "not-a-policy",
    ], { cwd, encoding: "utf8" });
    assert.equal(unknown.status, 1);
  } finally {
    cleanupTree(candidateRoot);
    cleanupTree(installedRoot);
    rmSync(outputRoot, { recursive: true, force: true });
  }
});
