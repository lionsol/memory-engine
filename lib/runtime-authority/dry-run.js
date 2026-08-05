const { join } = require("node:path");
const { DRY_RUN_SCHEMA } = require("./constants.js");
const { readPlanFile } = require("./plan.js");
const { PathBroker } = require("./path-policy.js");
const { inspectPlanTools } = require("./tool-identity.js");

function plannedPaths(plan) {
  return { staging: join(plan.persistent_parent, `.staging-${plan.run_id}`), final: join(plan.persistent_parent, plan.run_id) };
}

function createBroker(plan) {
  return new PathBroker({
    allowedRoots: {
      source_repo: plan.source_repo,
      active_root: plan.active_root,
      active_release: plan.active_release,
      config: plan.config_path,
      persistent_parent: plan.persistent_parent,
      node_executable: plan.node_executable,
      npm_cli: plan.npm_cli,
      git_executable: plan.git_executable,
      tar_executable: plan.tar_executable,
      unshare_executable: plan.unshare_executable,
      mount_executable: plan.mount_executable,
      chroot_executable: plan.chroot_executable,
      systemctl_executable: plan.systemctl_executable,
      python_executable: plan.python_executable,
      cc_executable: plan.cc_executable,
      cxx_executable: plan.cxx_executable,
      make_executable: plan.make_executable,
      ar_executable: plan.ar_executable,
      node_gyp_root: plan.node_gyp_root,
      harness_root: require("node:path").join(__dirname),
      runtime_source_root: require("node:path").join(__dirname, "../version"),
      manifest_root: require("node:path").join(__dirname, "../../bin"),
    },
    deniedRoots: [
      join(plan.operator_home, "agents"), join(plan.operator_home, "sessions"), join(plan.operator_home, "memory"),
      join(plan.source_repo, "node_modules"),
    ],
  });
}

function dryRun({ planPath, now = new Date(), toolInspector = inspectPlanTools, toolRunner, sandbox = null } = {}) {
  const loaded = readPlanFile(planPath, { now });
  try {
    const production = toolInspector === inspectPlanTools && !sandbox;
    const factory = production ? require("./factory.js").createProductionFactory({ plan: loaded.plan, toolRunner }) : null;
    const broker = factory?.broker || createBroker(loaded.plan);
    const tools = factory ? factory.inspectTools() : toolInspector({ plan: loaded.plan, broker, runner: toolRunner });
    const paths = plannedPaths(loaded.plan);
    const sandboxResult = factory ? factory.preflight({ paths, strict: true }).sandbox : (sandbox ? sandbox.probe() : null);
    if (!sandboxResult) throw new Error("sandbox capability unavailable");
    return {
      schema: DRY_RUN_SCHEMA, decision: "PASS", plan_sha256: loaded.planSha256,
      validated_bindings: { schema: loaded.plan.schema, run_id: loaded.plan.run_id, source_commit: loaded.plan.source_commit, source_tree_identity: loaded.plan.source_tree_identity, origin_remote: loaded.plan.origin_remote },
      tool_identities: tools, allowed_roots: Object.keys(broker.allowedRoots).sort(), denied_roots: broker.deniedRoots.map(path => path.replace(loaded.plan.operator_home, "<operator-home>")).sort(),
      planned_operations: ["PLAN_VALIDATED", "PREFLIGHT_PASSED", "RUN_CLAIMED", "SOURCE_ARCHIVED", "PACKAGE_PACKED", "DEPENDENCIES_INSTALLED", "CANDIDATE_VERIFIED", "CANDIDATE_ARCHIVED", "R0_CAPTURED", "R0_VERIFIED", "AUTHORITY_ASSEMBLED", "PUBLISHED"], preflight_findings: [], mutation_count: 0,
    };
  } catch (error) {
    return { schema: DRY_RUN_SCHEMA, decision: "REJECT", plan_sha256: loaded.planSha256, validated_bindings: { schema: loaded.plan.schema, run_id: loaded.plan.run_id }, allowed_roots: [], denied_roots: [], planned_operations: [], preflight_findings: [String(error.message || error)], mutation_count: 0 };
  }
}

module.exports = { createBroker, dryRun };
