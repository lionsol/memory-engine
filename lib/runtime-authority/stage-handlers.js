const { chmodSync, lstatSync, readFileSync, readdirSync, statSync } = require("node:fs");
const { join, relative } = require("node:path");
const { archiveSha256 } = require("./archive.js");
const { buildRuntimeArtifactManifestV2 } = require("../../bin/runtime-artifact-manifest-v2-lib.cjs");
const { buildSentinel } = require("./sentinel.js");
const { writeJson, hashFile } = require("./evidence.js");
const { copyTreePreservingHardlinks } = require("./owned-root.js");

function ownedPath(context, path) {
  context.broker.recheckBeforeMutation(path, { root: "persistent_parent", mustExist: false });
  return path;
}

function copyHarness(context) {
  const root = join(context.stagingRoot, ".harness");
  context.owned.mkdir(root, 0o700);
  for (const [source, target] of [
    [join(__dirname, "artifact-helper.cjs"), join(root, "artifact-helper.cjs")],
    [join(__dirname, "runtime-helper.mjs"), join(root, "runtime-helper.mjs")],
    [join(__dirname, "native-smoke-helper.cjs"), join(root, "native-smoke-helper.cjs")],
    [join(__dirname, "targeted-helper.cjs"), join(root, "targeted-helper.cjs")],
    [join(__dirname, "../version/runtime-build-identity.js"), join(root, "runtime-build-identity.mjs")],
    [join(__dirname, "../../bin/runtime-artifact-manifest-v2-lib.cjs"), join(root, "manifest-lib.cjs")],
  ]) {
    const root = source.includes("/lib/version/") ? "runtime_source_root" : (source.includes("/bin/runtime-artifact-manifest-v2-lib.cjs") ? "manifest_root" : "harness_root");
    context.broker.assertRead(source, { root, type: "file" });
    try { if (lstatSync(target).isFile()) chmodSync(target, 0o600); } catch (error) { if (error.code !== "ENOENT") throw error; }
    context.owned.write(target, readFileSync(source), 0o500);
  }
  return root;
}

function parseJsonOutput(result) {
  return JSON.parse(String(result.stdout || "").trim());
}

function assertRuntimeIdentity(runtime, expected, label) {
  if (!runtime || runtime.valid !== true || typeof runtime.identity !== "string" || !/^[0-9a-f]{64}$/.test(runtime.identity)) {
    throw new Error(`${label} runtime identity invalid`);
  }
  if (runtime.identity !== expected) throw new Error(`${label} runtime identity mismatch`);
  return runtime;
}

function assertNativeSmoke(result, label) {
  if (!result || result.ok !== true || result.available !== true) throw new Error(`${label} native smoke did not prove availability`);
  return result;
}

function ownedJson(context, path, value) {
  context.owned.write(path, `${require("./canonical-json.js").canonicalize(value)}\n`, 0o600);
}

function freezeTree(root) {
  const stats = statSync(root);
  chmodSync(root, stats.mode & ~0o222);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) freezeTree(path);
    else if (entry.isFile()) chmodSync(path, statSync(path).mode & ~0o222);
  }
}

function manifestFor(root) {
  const manifest = buildRuntimeArtifactManifestV2({ rootDir: root });
  if (!manifest.valid) throw new Error(`invalid authority tree:${manifest.errors.join(",")}`);
  return manifest;
}

function commonEvidence(context, name, value) {
  const stagingRoot = context.stagingRoot || context.owned?.root;
  if (!stagingRoot) throw new Error("evidence staging root missing");
  const path = ownedPath({ ...context, broker: context.broker || context.owned?.broker, stagingRoot }, join(stagingRoot, "evidence", name));
  context.owned.mkdir(join(stagingRoot, "evidence"), 0o700);
  context.owned.write(path, `${require("./canonical-json.js").canonicalize(value)}\n`, 0o600);
  return relative(stagingRoot, path).replaceAll("\\", "/");
}

function createDefaultHandlers({ registryFactory } = {}) {
  return {
    SOURCE_ARCHIVED: ({ stagingRoot, plan, broker, ...context }) => {
      const sourceRoot = join(stagingRoot, "source", "reviewed");
      const archivePath = join(stagingRoot, "source", "repository-source.tar");
      context.owned.mkdir(sourceRoot, 0o700);
      context.owned.mkdir(join(stagingRoot, "source"), 0o700);
      const registry = registryFactory({ stagingRoot, ...context });
      registry.run("git.archive", { destination: archivePath });
      registry.run("tar.extract_git_source", { archivePath, destination: sourceRoot });
      return { sourceRoot, sourceArchivePath: archivePath, registry };
    },
    PACKAGE_PACKED: ({ stagingRoot, sourceRoot, registry, broker, ...context }) => {
      const sourceDir = join(stagingRoot, "source");
      const packResult = registry.run("npm.pack_staged_source", { sourceRoot, destination: sourceDir });
      const metadata = parseJsonOutput(packResult);
      const filename = metadata[0]?.filename || readdirSync(sourceDir).find(name => name.endsWith(".tgz"));
      if (!filename) throw new Error("npm pack did not produce archive");
      const packagePath = join(sourceDir, filename);
      broker.assertRead(packagePath, { root: "persistent_parent", type: "file" });
      return { packagePath, packMetadata: metadata };
    },
    DEPENDENCIES_INSTALLED: ({ stagingRoot, packagePath, sourceRoot, plan, registry, broker, ...context }) => {
      const candidateRoot = join(stagingRoot, "candidate");
      const unpackRoot = join(candidateRoot, "unpack");
      const installRoot = join(candidateRoot, "install");
      context.owned.mkdir(unpackRoot, 0o700);
      context.owned.mkdir(installRoot, 0o700);
      registry.run("tar.extract_npm_package", { archivePath: packagePath, destination: unpackRoot });
      copyTreePreservingHardlinks(join(unpackRoot, "package"), installRoot);
      if (!require("node:fs").existsSync(join(installRoot, "package-lock.json"))) context.owned.copyFile(join(sourceRoot, "package-lock.json"), join(installRoot, "package-lock.json"));
      const lockPath = join(installRoot, "package-lock.json");
      if (hashFile(join(installRoot, "package.json")) !== plan.expected_package_json_sha256) throw new Error("candidate package.json hash mismatch");
      if (hashFile(lockPath) !== plan.expected_package_lock_sha256) throw new Error("candidate package-lock hash mismatch");
      try { if (lstatSync(join(installRoot, "node_modules")).isSymbolicLink()) throw new Error("candidate node_modules symlink rejected"); } catch (error) { if (error.code !== "ENOENT") throw error; }
      broker.assertRead(join(installRoot, "package.json"), { root: "persistent_parent", type: "file" });
      broker.assertRead(join(installRoot, "package-lock.json"), { root: "persistent_parent", type: "file" });
      const reportedPrefix = String(registry.run("npm.prefix_candidate", { candidate: installRoot }).stdout || "").trim();
      const sandboxPrefix = `/staging${installRoot.slice(stagingRoot.length)}`;
      const prefix = reportedPrefix === sandboxPrefix ? installRoot : reportedPrefix;
      if (prefix !== installRoot) throw new Error("candidate npm prefix mismatch");
      registry.run("npm.ci_candidate", { candidate: installRoot, cache: join(stagingRoot, "npm-cache") });
      const candidateInstallAudit = buildRuntimeArtifactManifestV2({ rootDir: installRoot });
      const linkAudit = {
        schema: "memory-engine-runtime-authority-candidate-link-audit-v1",
        manifest_valid: candidateInstallAudit.valid,
        external_symlink_count: candidateInstallAudit.external_symlink_count,
        dangling_symlink_count: candidateInstallAudit.dangling_symlink_count,
        external_hardlink_reference_count: candidateInstallAudit.external_hardlink_reference_count,
        errors: candidateInstallAudit.errors,
      };
      commonEvidence(context, "candidate-install-link-audit.json", linkAudit);
      if (!candidateInstallAudit.valid || candidateInstallAudit.external_symlink_count !== 0 || candidateInstallAudit.dangling_symlink_count !== 0 || candidateInstallAudit.external_hardlink_reference_count !== 0) {
        throw new Error(`candidate external link audit rejected:${candidateInstallAudit.errors.join(",")}`);
      }
      registry.run("npm.ls_candidate", { candidate: installRoot });
      const helperRoot = copyHarness({ stagingRoot, plan, broker, ...context });
      const runtimeAfterCi = parseJsonOutput(registry.run("node.candidate_runtime_identity", { script: join(helperRoot, "runtime-helper.mjs"), root: installRoot }));
      assertRuntimeIdentity(runtimeAfterCi, plan.expected_source_runtime_identity, "candidate after npm ci");
      const checkpointPath = commonEvidence(context, "candidate-runtime-after-ci.json", runtimeAfterCi);
      return { candidateRoot, candidateInstall: installRoot, candidatePrefix: prefix, candidateRuntimeCheckpoints: [{ role: "candidate_after_ci", path: checkpointPath, identity: runtimeAfterCi.identity, expected_identity_class: "source" }] };
    },
    CANDIDATE_VERIFIED: ({ stagingRoot, candidateInstall, plan, registry, ...context }) => {
      const helperRoot = copyHarness({ stagingRoot, plan, ...context });
      const smokeScript = join(helperRoot, "native-smoke-helper.cjs");
      const sqliteSmoke = parseJsonOutput(registry.run("node.candidate_sqlite_disposable_smoke", { script: smokeScript, root: candidateInstall, mode: "sqlite" }));
      const lancedbSmoke = parseJsonOutput(registry.run("node.candidate_lancedb_disposable_smoke", { script: smokeScript, root: candidateInstall, mode: "lancedb" }));
      assertNativeSmoke(sqliteSmoke, "candidate sqlite");
      assertNativeSmoke(lancedbSmoke, "candidate LanceDB");
      const targetedScript = join(helperRoot, "targeted-helper.cjs");
      const targeted = parseJsonOutput(registry.run("node.candidate_targeted_tests", { script: targetedScript, root: candidateInstall, tests: plan.targeted_test_files }));
      const manifest = parseJsonOutput(registry.run("node.candidate_manifest", { script: join(helperRoot, "artifact-helper.cjs"), root: candidateInstall }));
      const runtime = parseJsonOutput(registry.run("node.candidate_runtime_identity", { script: join(helperRoot, "runtime-helper.mjs"), root: candidateInstall }));
      assertRuntimeIdentity(runtime, plan.expected_source_runtime_identity, "candidate");
      if (!manifest.valid) throw new Error(`candidate manifest invalid:${manifest.errors.join(",")}`);
      const manifestPath = join(stagingRoot, "candidate", "candidate-artifact-manifest.json");
      const runtimePath = join(stagingRoot, "candidate", "candidate-runtime-identity.json");
      ownedJson(context, manifestPath, manifest);
      ownedJson(context, runtimePath, runtime);
      const sentinel = buildSentinel({ manifest, gitCommit: plan.source_commit, gitTree: plan.source_tree_identity, packageJsonSha256: hashFile(join(candidateInstall, "package.json")), packageLockSha256: hashFile(join(candidateInstall, "package-lock.json")), rootPath: candidateInstall });
      const sentinelPath = join(stagingRoot, "candidate", "candidate-sentinel.json");
      ownedJson(context, sentinelPath, sentinel);
      return { candidateManifest: manifest, candidateRuntime: runtime, candidateManifestPath: manifestPath, candidateRuntimePath: runtimePath, candidateSentinelPath: sentinelPath, candidateNativeSmoke: { sqlite: sqliteSmoke, lancedb: lancedbSmoke }, candidateTargetedTests: targeted, candidateRuntimeCheckpoints: context.candidateRuntimeCheckpoints || [] };
    },
    CANDIDATE_ARCHIVED: ({ stagingRoot, candidateInstall, candidateManifest, candidateManifestPath, candidateSentinelPath, candidateRuntime, candidateRuntimeCheckpoints = [], broker, plan, registry, ...context }) => {
      context.owned.freeze(candidateInstall);
      candidateManifest = manifestFor(candidateInstall);
      const helperRoot = join(stagingRoot, ".harness");
      const frozenRuntime = parseJsonOutput(registry.run("node.candidate_runtime_identity", { script: join(helperRoot, "runtime-helper.mjs"), root: candidateInstall }));
      assertRuntimeIdentity(frozenRuntime, plan.expected_source_runtime_identity, "candidate after freeze");
      const candidateFreezeRuntimePath = commonEvidence(context, "candidate-runtime-after-freeze.json", frozenRuntime);
      candidateRuntimeCheckpoints = [...candidateRuntimeCheckpoints, { role: "candidate_after_freeze", path: candidateFreezeRuntimePath, identity: frozenRuntime.identity, expected_identity_class: "source" }];
      ownedJson(context, candidateManifestPath, candidateManifest);
      ownedJson(context, candidateSentinelPath, buildSentinel({ manifest: candidateManifest, gitCommit: plan.source_commit, gitTree: plan.source_tree_identity, packageJsonSha256: hashFile(join(candidateInstall, "package.json")), packageLockSha256: hashFile(join(candidateInstall, "package-lock.json")), rootPath: candidateInstall }));
      const archivePath = join(stagingRoot, "candidate", "candidate-authority.tar");
      registry.run("tar.create_candidate_authority", { sourceRoot: candidateInstall, archivePath });
      const extracted = join(stagingRoot, ".scratch-candidate-reextract");
      context.owned.mkdir(extracted, 0o700);
      registry.run("tar.extract_candidate_authority", { archivePath, destination: extracted });
      const reextractManifest = manifestFor(extracted);
      if (reextractManifest.exact_identity !== candidateManifest.exact_identity) throw new Error("candidate archive re-extraction mismatch");
      const reextractRuntime = parseJsonOutput(registry.run("node.candidate_runtime_identity", { script: join(helperRoot, "runtime-helper.mjs"), root: extracted }));
      assertRuntimeIdentity(reextractRuntime, plan.expected_source_runtime_identity, "candidate archive re-extraction");
      const candidateReextractRuntimePath = commonEvidence(context, "candidate-runtime-after-reextract.json", reextractRuntime);
      candidateRuntimeCheckpoints = [...candidateRuntimeCheckpoints, { role: "candidate_after_reextract", path: candidateReextractRuntimePath, identity: reextractRuntime.identity, expected_identity_class: "source" }];
      context.owned.chmod(extracted, 0o700);
      context.owned.remove(extracted);
      const archive = { role: "candidate_archive", schema: "memory-engine-runtime-authority-archive-v1", path: relative(stagingRoot, archivePath).replaceAll("\\", "/"), sha256: archiveSha256(archivePath), manifest_path: relative(stagingRoot, candidateManifestPath).replaceAll("\\", "/"), runtime_identity_path: candidateFreezeRuntimePath };
      return { candidateArchivePath: archivePath, candidateManifest, candidateRuntime: frozenRuntime, candidateRuntimeCheckpoints, archives: [archive], manifests: [{ role: "candidate_frozen", manifest_path: relative(stagingRoot, candidateManifestPath).replaceAll("\\", "/"), sentinel_path: relative(stagingRoot, candidateSentinelPath).replaceAll("\\", "/"), exact_identity: candidateManifest.exact_identity, git_commit: plan.source_commit, git_tree: plan.source_tree_identity, package_json_sha256: hashFile(join(candidateInstall, "package.json")), package_lock_sha256: hashFile(join(candidateInstall, "package-lock.json")) }] };
    },
    R0_CAPTURED: ({ stagingRoot, plan, broker, registry, candidateRuntimeCheckpoints = [], ...context }) => {
      const before = manifestFor(plan.active_root);
      const r0Root = join(stagingRoot, "recovery", "r0-install");
      context.owned.mkdir(join(stagingRoot, "recovery"), 0o700);
      broker.assertRead(plan.active_root, { root: "active_root", type: "directory" });
      context.owned.mutation(r0Root);
      copyTreePreservingHardlinks(plan.active_root, r0Root);
      const after = manifestFor(plan.active_root);
      if (before.exact_identity !== after.exact_identity) throw new Error("active identity changed during R0 window");
      const scratch = manifestFor(r0Root);
      if (scratch.exact_identity !== before.exact_identity) throw new Error("active/R0 parity mismatch");
      const helperRoot = join(stagingRoot, ".harness");
      const r0Runtime = parseJsonOutput(registry.run("node.r0_runtime_identity", { script: join(helperRoot, "runtime-helper.mjs"), root: r0Root }));
      assertRuntimeIdentity(r0Runtime, plan.expected_active_runtime_identity, "R0");
      const r0NativeSmoke = {
        sqlite: parseJsonOutput(registry.run("node.r0_sqlite_disposable_smoke", { script: join(helperRoot, "native-smoke-helper.cjs"), root: r0Root, mode: "sqlite" })),
        lancedb: parseJsonOutput(registry.run("node.r0_lancedb_disposable_smoke", { script: join(helperRoot, "native-smoke-helper.cjs"), root: r0Root, mode: "lancedb" })),
      };
      assertNativeSmoke(r0NativeSmoke.sqlite, "R0 sqlite");
      assertNativeSmoke(r0NativeSmoke.lancedb, "R0 LanceDB");
      const beforePath = join(stagingRoot, "evidence", "active-before-manifest.json");
      const afterPath = join(stagingRoot, "evidence", "active-after-manifest.json");
      context.owned.mkdir(join(stagingRoot, "evidence"), 0o700);
      context.owned.write(beforePath, `${require("./canonical-json.js").canonicalize(before)}\n`, 0o600);
      context.owned.write(afterPath, `${require("./canonical-json.js").canonicalize(after)}\n`, 0o600);
      const r0RuntimePath = commonEvidence(context, "r0-runtime-identity.json", r0Runtime);
      context.owned.write(join(stagingRoot, "evidence", "r0-native-smoke.json"), `${require("./canonical-json.js").canonicalize(r0NativeSmoke)}\n`, 0o600);
      return { r0Root, activeBefore: before, activeAfter: after, r0Runtime, r0RuntimePath, r0NativeSmoke, candidateRuntimeCheckpoints: [...candidateRuntimeCheckpoints, { role: "r0_capture", path: r0RuntimePath, identity: r0Runtime.identity, expected_identity_class: "active" }] };
    },
    R0_VERIFIED: ({ stagingRoot, r0Root, activeBefore, r0RuntimePath = "evidence/r0-runtime-identity.json", candidateRuntimeCheckpoints = [], plan, registry, ...context }) => {
      const archivePath = join(stagingRoot, "recovery", "r0-authority.tar");
      registry.run("tar.create_r0_authority", { sourceRoot: r0Root, archivePath });
      const extracted = join(stagingRoot, ".scratch-r0-reextract");
      context.owned.mkdir(extracted, 0o700);
      registry.run("tar.extract_r0_authority", { archivePath, destination: extracted });
      const manifest = manifestFor(extracted);
      if (manifest.exact_identity !== activeBefore.exact_identity) throw new Error("R0 archive re-extraction mismatch");
      const reextractRuntime = parseJsonOutput(registry.run("node.r0_runtime_identity", { script: join(stagingRoot, ".harness", "runtime-helper.mjs"), root: extracted }));
      assertRuntimeIdentity(reextractRuntime, plan.expected_active_runtime_identity, "R0 archive re-extraction");
      const r0ReextractRuntimePath = commonEvidence(context, "r0-runtime-after-reextract.json", reextractRuntime);
      candidateRuntimeCheckpoints = [...candidateRuntimeCheckpoints, { role: "r0_after_reextract", path: r0ReextractRuntimePath, identity: reextractRuntime.identity, expected_identity_class: "active" }];
      context.owned.chmod(extracted, 0o700);
      context.owned.remove(extracted);
      context.owned.remove(r0Root);
      const archive = { role: "r0_archive", schema: "memory-engine-runtime-authority-archive-v1", path: relative(stagingRoot, archivePath).replaceAll("\\", "/"), sha256: archiveSha256(archivePath), manifest_path: "evidence/active-before-manifest.json", runtime_identity_path: r0RuntimePath };
      return { r0ArchivePath: archivePath, archives: [...(context.archives || []), archive], manifests: [...(context.manifests || []), { role: "active_before", manifest_path: "evidence/active-before-manifest.json", exact_identity: activeBefore.exact_identity }, { role: "active_after", manifest_path: "evidence/active-after-manifest.json", exact_identity: activeBefore.exact_identity }], candidateRuntimeCheckpoints };
    },
  };
}

function cleanupTransientArtifacts(context) {
  const paths = [
    join(context.stagingRoot, "candidate", "unpack"),
    join(context.stagingRoot, "npm-cache"),
    join(context.stagingRoot, "empty-npmrc"),
    join(context.stagingRoot, ".harness"),
    join(context.stagingRoot, ".runtime-authority-sandbox-root"),
    join(context.stagingRoot, ".sandbox-probe-marker"),
    join(context.stagingRoot, ".scratch-candidate-reextract"),
    join(context.stagingRoot, ".scratch-r0-reextract"),
    join(context.stagingRoot, "scratch"),
    join(context.stagingRoot, "candidate", "smoke"),
    join(context.stagingRoot, "recovery", "smoke"),
    join(context.stagingRoot, "recovery", "r0-install"),
  ];
  const removed = [];
  for (const path of paths) {
    try { lstatSync(path); context.owned.remove(path); removed.push(relative(context.stagingRoot, path).replaceAll("\\", "/")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return removed;
}

module.exports = { createDefaultHandlers, freezeTree, manifestFor, copyHarness, cleanupTransientArtifacts, assertNativeSmoke, assertRuntimeIdentity };
