import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, linkSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prepareRuntimeAuthority } from "../lib/runtime-authority/prepare.js";
import { CommandExecutionError } from "../lib/runtime-authority/command-failure.js";
import { claimPath, updateClaim } from "../lib/runtime-authority/evidence.js";
import { fakeToolInspector, makeFixture, successfulHooks, writePlan } from "./runtime-authority-fixtures.test.js";

function completeSyntheticHooks() {
  return Object.fromEntries([
    "SOURCE_ARCHIVED", "PACKAGE_PACKED", "DEPENDENCIES_INSTALLED", "CANDIDATE_VERIFIED", "CANDIDATE_ARCHIVED", "R0_CAPTURED", "R0_VERIFIED",
  ].map(stage => [stage, ({ stagingRoot, owned, plan }) => {
    owned.mkdir(join(stagingRoot, "evidence"), 0o700);
    owned.write(join(stagingRoot, "evidence", `${stage}.json`), `${stage}\n`, 0o600);
    if (stage !== "CANDIDATE_ARCHIVED") return undefined;
    const source = plan.expected_source_runtime_identity;
    const active = plan.expected_active_runtime_identity;
    const candidateManifest = "candidate/candidate-artifact-manifest.json";
    const candidateSentinel = "candidate/candidate-sentinel.json";
    const activeBefore = "evidence/active-before-manifest.json";
    const activeAfter = "evidence/active-after-manifest.json";
    const candidateFreeze = "evidence/candidate-runtime-after-freeze.json";
    const candidateCi = "evidence/candidate-runtime-after-ci.json";
    const candidateReextract = "evidence/candidate-runtime-after-reextract.json";
    const r0Capture = "evidence/r0-runtime-identity.json";
    const r0Reextract = "evidence/r0-runtime-after-reextract.json";
    for (const path of [candidateManifest, candidateSentinel, activeBefore, activeAfter]) {
      owned.mkdir(join(stagingRoot, path.split("/")[0]), 0o700);
      owned.write(join(stagingRoot, path), "{}\n", 0o600);
    }
    for (const [path, identity] of [[candidateCi, source], [candidateFreeze, source], [candidateReextract, source], [r0Capture, active], [r0Reextract, active]]) {
      owned.write(join(stagingRoot, path), `${JSON.stringify({ valid: true, identity })}\n`, 0o600);
    }
    owned.mkdir(join(stagingRoot, "candidate"), 0o700);
    owned.mkdir(join(stagingRoot, "recovery"), 0o700);
    owned.write(join(stagingRoot, "candidate/candidate-authority.tar"), "candidate\n", 0o400);
    owned.write(join(stagingRoot, "recovery/r0-authority.tar"), "r0\n", 0o400);
    return {
      archives: [
        { role: "candidate_archive", schema: "memory-engine-runtime-authority-archive-v1", path: "candidate/candidate-authority.tar", sha256: "c".repeat(64), manifest_path: candidateManifest, runtime_identity_path: candidateFreeze },
        { role: "r0_archive", schema: "memory-engine-runtime-authority-archive-v1", path: "recovery/r0-authority.tar", sha256: "d".repeat(64), manifest_path: activeBefore, runtime_identity_path: r0Capture },
      ],
      manifests: [
        { role: "candidate_frozen", manifest_path: candidateManifest, sentinel_path: candidateSentinel, exact_identity: "e".repeat(64), git_commit: "a".repeat(40), git_tree: "b".repeat(40), package_json_sha256: plan.expected_package_json_sha256, package_lock_sha256: plan.expected_package_lock_sha256 },
        { role: "active_before", manifest_path: activeBefore, exact_identity: "f".repeat(64) },
        { role: "active_after", manifest_path: activeAfter, exact_identity: "f".repeat(64) },
      ],
      candidateRuntimeCheckpoints: [
        { role: "candidate_after_ci", path: candidateCi, identity: source, expected_identity_class: "source" },
        { role: "candidate_after_freeze", path: candidateFreeze, identity: source, expected_identity_class: "source" },
        { role: "candidate_after_reextract", path: candidateReextract, identity: source, expected_identity_class: "source" },
        { role: "r0_capture", path: r0Capture, identity: active, expected_identity_class: "active" },
        { role: "r0_after_reextract", path: r0Reextract, identity: active, expected_identity_class: "active" },
      ],
    };
  }]));
}

test("incomplete injected authority is rejected and consumes claim", async () => {
  const fixture = makeFixture();
  try {
    writePlan(fixture);
    await assert.rejects(() => prepareRuntimeAuthority({ planPath: fixture.planPath, toolInspector: fakeToolInspector, hooks: successfulHooks(), sandbox: { probe: () => ({ available: true }) } }), /authority completeness/);
    assert.equal(existsSync(join(fixture.plan.persistent_parent, fixture.plan.run_id)), false);
    assert.equal(JSON.parse(readFileSync(claimPath(fixture.plan.persistent_parent, fixture.plan.run_id), "utf8")).outcome, "FAILED");
  } finally { fixture.cleanup(); }
});

test("every injected prepare stage failure consumes claim and never publishes final", async () => {
  for (const stage of ["SOURCE_ARCHIVED", "PACKAGE_PACKED", "DEPENDENCIES_INSTALLED", "CANDIDATE_VERIFIED", "CANDIDATE_ARCHIVED", "R0_CAPTURED", "R0_VERIFIED"]) {
    const fixture = makeFixture();
    try {
      writePlan(fixture);
      const hooks = successfulHooks();
      hooks[stage] = () => { throw new Error(`injected:${stage}`); };
      await assert.rejects(() => prepareRuntimeAuthority({ planPath: fixture.planPath, toolInspector: fakeToolInspector, hooks, sandbox: { probe: () => ({ available: true }) } }), new RegExp(`injected:${stage}`));
      assert.equal(existsSync(join(fixture.plan.persistent_parent, fixture.plan.run_id)), false);
      const claim = JSON.parse(readFileSync(claimPath(fixture.plan.persistent_parent, fixture.plan.run_id), "utf8"));
      assert.equal(claim.outcome, "FAILED");
      await assert.rejects(() => prepareRuntimeAuthority({ planPath: fixture.planPath, toolInspector: fakeToolInspector, hooks: successfulHooks(), sandbox: { probe: () => ({ available: true }) } }), /already exists/);
    } finally { fixture.cleanup(); }
  }
});

test("failed npm command preserves bounded evidence after staging cleanup", async () => {
  const fixture = makeFixture();
  try {
    writePlan(fixture);
    const hooks = successfulHooks();
    hooks.DEPENDENCIES_INSTALLED = ({ stagingRoot }) => {
      const logs = join(stagingRoot, "npm-cache", "_logs");
      mkdirSync(logs, { recursive: true, mode: 0o700 });
      const log = `npm log head\n${"x".repeat(70 * 1024)}\nnpm log tail\n`;
      writeFileSync(join(logs, "2026-08-06T12_00_00_000Z-debug-0.log"), log, { mode: 0o600 });
      throw new CommandExecutionError({ operationId: "npm.ci_candidate", exitCode: 2, stdout: "command stdout", stderr: "primary stderr TOKEN=secret", message: "sandbox operation failed:npm.ci_candidate:2:primary stderr TOKEN=secret" });
    };
    await assert.rejects(
      () => prepareRuntimeAuthority({ planPath: fixture.planPath, toolInspector: fakeToolInspector, hooks, sandbox: { probe: () => ({ available: true }) } }),
      /primary stderr TOKEN=secret/,
    );
    assert.equal(existsSync(join(fixture.plan.persistent_parent, `.staging-${fixture.plan.run_id}`)), false);
    assert.equal(existsSync(join(fixture.plan.persistent_parent, fixture.plan.run_id)), false);
    assert.equal(JSON.parse(readFileSync(claimPath(fixture.plan.persistent_parent, fixture.plan.run_id), "utf8")).outcome, "FAILED");
    const evidencePath = join(fixture.plan.persistent_parent, ".run-claims", `${fixture.plan.run_id}.failure-evidence.json`);
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    assert.equal(evidence.run_id, fixture.plan.run_id);
    assert.equal(evidence.plan_sha256.length, 64);
    assert.equal(evidence.journal_stage, "DEPENDENCIES_INSTALLED");
    assert.equal(evidence.command_registry_operation_id, "npm.ci_candidate");
    assert.equal(evidence.command_exit_code, 2);
    assert.equal(evidence.stderr.text.includes("secret"), false);
    assert.equal(evidence.npm_debug_logs.length, 1);
    assert.equal(evidence.npm_debug_logs[0].truncated, true);
    assert.match(evidence.npm_debug_logs[0].content, /npm log head/);
    assert.match(evidence.npm_debug_logs[0].content, /npm log tail/);
  } finally { fixture.cleanup(); }
});

test("incomplete injected authority with candidate-style links is rejected", async () => {
  const fixture = makeFixture();
  try {
    writePlan(fixture);
    const hooks = successfulHooks();
    hooks.CANDIDATE_VERIFIED = ({ stagingRoot }) => {
      const bin = join(stagingRoot, "candidate", "install", "node_modules", ".bin");
      const pkg = join(stagingRoot, "candidate", "install", "node_modules", "pkg", "bin");
      mkdirSync(bin, { recursive: true, mode: 0o700 }); mkdirSync(pkg, { recursive: true, mode: 0o700 });
      writeFileSync(join(pkg, "cli.js"), "module.exports=1;\n", { mode: 0o500 });
      writeFileSync(join(pkg, "other.js"), "module.exports=2;\n", { mode: 0o500 });
      for (const name of ["cli", "pkg-cli", "tool", "tool-alt"]) symlinkSync("../pkg/bin/cli.js", join(bin, name));
      writeFileSync(join(pkg, "hard-a"), "hard\n", { mode: 0o400 }); linkSync(join(pkg, "hard-a"), join(pkg, "hard-b"));
    };
    await assert.rejects(() => prepareRuntimeAuthority({ planPath: fixture.planPath, toolInspector: fakeToolInspector, hooks, sandbox: { probe: () => ({ available: true }) } }), /authority completeness/);
    assert.equal(existsSync(join(fixture.plan.persistent_parent, fixture.plan.run_id)), false);
  } finally { fixture.cleanup(); }
});

test("persistent-parent symlink ancestor is rejected before run claim", async () => {
  const fixture = makeFixture();
  try {
    const realParent = join(fixture.root, "real-authorities");
    mkdirSync(realParent, { mode: 0o700 });
    const linkedParent = join(fixture.root, "linked-authorities");
    symlinkSync(realParent, linkedParent);
    writePlan(fixture, { ...fixture.plan, persistent_parent: linkedParent });
    await assert.rejects(() => prepareRuntimeAuthority({ planPath: fixture.planPath, toolInspector: fakeToolInspector, hooks: successfulHooks(), sandbox: { probe: () => ({ available: true }) } }), /owned parent ancestor symlink/);
    assert.equal(existsSync(join(realParent, ".run-claims", `${fixture.plan.run_id}.json`)), false);
  } finally { fixture.cleanup(); }
});

test("claim update failure after final rename rolls back publication and consumes FAILED claim", async () => {
  const fixture = makeFixture();
  try {
    writePlan(fixture);
    const claimUpdater = (path, outcome, updatedAt, broker) => {
      if (outcome === "PUBLISHED") throw new Error("injected claim publication failure");
      return updateClaim(path, outcome, updatedAt, broker);
    };
    await assert.rejects(() => prepareRuntimeAuthority({ planPath: fixture.planPath, toolInspector: fakeToolInspector, hooks: completeSyntheticHooks(), sandbox: { probe: () => ({ available: true }) }, claimUpdater }), /injected claim publication failure/);
    assert.equal(existsSync(join(fixture.plan.persistent_parent, fixture.plan.run_id)), false);
    assert.equal(existsSync(join(fixture.plan.persistent_parent, `.staging-${fixture.plan.run_id}`)), false);
    assert.equal(JSON.parse(readFileSync(claimPath(fixture.plan.persistent_parent, fixture.plan.run_id), "utf8")).outcome, "FAILED");
  } finally { fixture.cleanup(); }
});

test("claim update failure with rollback failure returns RECOVERY_REQUIRED and never publishes", async () => {
  const fixture = makeFixture();
  try {
    writePlan(fixture);
    const claimUpdater = (path, outcome, updatedAt, broker) => {
      if (outcome === "PUBLISHED") throw new Error("injected claim publication failure");
      return updateClaim(path, outcome, updatedAt, broker);
    };
    await assert.rejects(() => prepareRuntimeAuthority({ planPath: fixture.planPath, toolInspector: fakeToolInspector, hooks: completeSyntheticHooks(), sandbox: { probe: () => ({ available: true }) }, claimUpdater, restorePublication: () => { throw new Error("injected rollback failure"); } }), /RECOVERY_REQUIRED/);
    assert.equal(existsSync(join(fixture.plan.persistent_parent, fixture.plan.run_id)), true);
    assert.equal(JSON.parse(readFileSync(claimPath(fixture.plan.persistent_parent, fixture.plan.run_id), "utf8")).outcome, "FAILED");
  } finally { fixture.cleanup(); }
});
