const { createHash } = require("node:crypto");
const { lstatSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { buildRuntimeArtifactManifestV2, validateRuntimeArtifactManifestV2 } = require("../../bin/runtime-artifact-manifest-v2-lib.cjs");
const { hashFile } = require("./evidence.js");
const { HOST_STABILITY_SCHEMA } = require("./authority-schema.js");

function sha256File(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }

function text(result) { return String(result.stdout || "").trim(); }

function parseServiceOutput(output) {
  const values = String(output || "").split(/\r?\n/).filter(Boolean);
  if (values.length >= 4) return { active: values[0] === "active", running: values[1] === "running", pid: Number(values[2]), restart_count: Number(values[3]) };
  const fields = Object.fromEntries(values.map(value => value.split("=", 2)).filter(pair => pair.length === 2));
  return { active: fields.ActiveState === "active", running: fields.SubState === "running", pid: Number(fields.MainPID), restart_count: Number(fields.NRestarts) };
}

function captureHostStability({ plan, broker, registry } = {}) {
  broker.assertRead(plan.config_path, { root: "config", type: "file" });
  const gateway = parseServiceOutput(registry.run("systemd.gateway_status").stdout);
  const consoleService = parseServiceOutput(registry.run("systemd.console_status").stdout);
  return {
    config_sha256: hashFile(plan.config_path),
    gateway,
    console: consoleService,
  };
}

function expectedHostStability(plan) {
  return {
    config_sha256: plan.expected_config_sha256,
    gateway: { active: true, running: true, pid: plan.expected_gateway_pid, restart_count: plan.expected_gateway_restart_count },
    console: { active: true, running: true, pid: plan.expected_console_pid, restart_count: plan.expected_console_restart_count },
  };
}

function assertHostStability(snapshot, plan, label = "host") {
  const expected = expectedHostStability(plan);
  if (!snapshot || snapshot.config_sha256 !== expected.config_sha256) throw new Error(`${label} config SHA-256 mismatch`);
  for (const service of ["gateway", "console"]) {
    const actual = snapshot[service];
    const wanted = expected[service];
    if (!actual || actual.active !== wanted.active || actual.running !== wanted.running || actual.pid !== wanted.pid || actual.restart_count !== wanted.restart_count) throw new Error(`${label} ${service} status mismatch`);
  }
  return snapshot;
}

function assertHostStabilityPair(before, after, plan) {
  assertHostStability(before, plan, "host before");
  assertHostStability(after, plan, "host after");
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("host stability before/after drift");
  return { schema: HOST_STABILITY_SCHEMA, before, after };
}

function assertIdentity(manifest, expected, label) {
  const validation = validateRuntimeArtifactManifestV2(manifest);
  if (!validation.artifact_valid) throw new Error(`${label} manifest invalid:${validation.errors.join(",")}`);
  for (const [key, value] of Object.entries(expected)) if (value !== undefined && manifest[key] !== value) throw new Error(`${label} identity mismatch:${key}`);
  return validation;
}

function assertRuntimeIdentity(runtime, expected, label) {
  if (!runtime || runtime.valid !== true || typeof runtime.identity !== "string" || !/^[0-9a-f]{64}$/.test(runtime.identity)) {
    throw new Error(`${label} runtime identity invalid`);
  }
  if (runtime.identity !== expected) throw new Error(`${label} runtime identity mismatch`);
  return runtime;
}

function runPreflight({ plan, broker, registry, tools, sandbox, paths, strict = true } = {}) {
  const findings = [];
  let hostStability = null;
  if (strict) {
    const status = registry.run("git.status");
    if (String(status.stdout || "").trim()) throw new Error("source Git worktree is dirty");
    if (text(registry.run("git.resolve_commit", { ref: plan.source_commit })) !== plan.source_commit) throw new Error("source commit mismatch");
    if (text(registry.run("git.resolve_tree", { ref: plan.source_commit })) !== plan.source_tree_identity) throw new Error("source tree mismatch");
    if (text(registry.run("git.remote")) !== plan.origin_remote) throw new Error("origin remote mismatch");
    const packageJson = join(plan.source_repo, "package.json");
    const packageLock = join(plan.source_repo, "package-lock.json");
    broker.assertRead(packageJson, { root: "source_repo", type: "file" });
    broker.assertRead(packageLock, { root: "source_repo", type: "file" });
    if (sha256File(packageJson) !== plan.expected_package_json_sha256) throw new Error("package.json hash mismatch");
    if (sha256File(packageLock) !== plan.expected_package_lock_sha256) throw new Error("package-lock.json hash mismatch");
    for (const [root, expected] of [["active_root", {
      semantic_identity: plan.expected_active_artifact_semantic_identity, topology_identity: plan.expected_active_artifact_topology_identity, exact_identity: plan.expected_active_artifact_exact_identity,
    }], ["active_release", {
      semantic_identity: plan.expected_release_artifact_semantic_identity, topology_identity: plan.expected_release_artifact_topology_identity, exact_identity: plan.expected_release_artifact_exact_identity,
    }]]) {
      broker.assertRead(plan[root], { root, type: "directory" });
      const manifest = buildRuntimeArtifactManifestV2({ rootDir: plan[root] });
      assertIdentity(manifest, expected, root);
    }
    const sourceRuntime = JSON.parse(text(registry.run("node.source_runtime_identity")));
    const activeRuntime = JSON.parse(text(registry.run("node.active_runtime_identity")));
    const releaseRuntime = JSON.parse(text(registry.run("node.release_runtime_identity")));
    assertRuntimeIdentity(sourceRuntime, plan.expected_source_runtime_identity, "source");
    assertRuntimeIdentity(activeRuntime, plan.expected_active_runtime_identity, "active");
    assertRuntimeIdentity(releaseRuntime, plan.expected_release_runtime_identity, "release");
    hostStability = captureHostStability({ plan, broker, registry });
    assertHostStability(hostStability, plan, "host before");
    for (const candidate of [paths.staging, paths.final, join(plan.persistent_parent, ".run-claims", `${plan.run_id}.json`)]) {
      try { lstatSync(candidate); throw new Error(`preflight path already exists:${candidate}`); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  const sandboxResult = sandbox.probe();
  if (!sandboxResult.available) throw new Error("sandbox capability unavailable");
  return { findings, sandbox: sandboxResult, hostStability };
}

module.exports = { runPreflight, parseServiceOutput, captureHostStability, expectedHostStability, assertHostStability, assertHostStabilityPair, assertIdentity, assertRuntimeIdentity };
