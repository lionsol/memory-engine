const {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
} = require("node:fs");
const { join } = require("node:path");
const { readPlanFile } = require("./plan.js");
const { createBroker } = require("./dry-run.js");
const { inspectPlanTools } = require("./tool-identity.js");
const { claimRun, updateClaim, writeJson, writeChecksums } = require("./evidence.js");
const { canonicalize } = require("./canonical-json.js");
const { createProductionFactory } = require("./factory.js");
const { expectedHostStability, assertHostStabilityPair } = require("./preflight.js");
const { OwnedRoot, ensureDirectoryMode, validatePersistentParent, createOwnedDirectory } = require("./owned-root.js");
const { buildTypedEntryInventory } = require("./inventory.js");
const { cleanupTransientArtifacts } = require("./stage-handlers.js");
const { JOURNAL, assertAuthorityCompleteness } = require("./authority-schema.js");

function assertAbsent(path) {
  try { lstatSync(path); throw new Error(`path already exists:${path}`); } catch (error) { if (error.code !== "ENOENT") throw error; }
}

function makeRemovable(root) {
  try { chmodSync(root, 0o700); } catch { return; }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) makeRemovable(path);
    else if (entry.isFile()) { try { chmodSync(path, 0o600); } catch {} }
  }
}

function makeStagingPaths(plan) {
  return { staging: join(plan.persistent_parent, `.staging-${plan.run_id}`), final: join(plan.persistent_parent, plan.run_id) };
}

function defaultHooks(factory) { return factory.handlers; }

async function prepareRuntimeAuthority({ planPath, now = new Date(), toolInspector = inspectPlanTools, toolRunner, sandbox = null, hooks = null, clock = () => new Date().toISOString(), claimUpdater = updateClaim, restorePublication = null } = {}) {
  const loaded = readPlanFile(planPath, { now });
  const plan = loaded.plan;
  const paths = makeStagingPaths(plan);
  const production = !hooks && toolInspector === inspectPlanTools && !sandbox;
  const factory = production ? createProductionFactory({ plan, toolRunner }) : null;
  const broker = factory?.broker || createBroker(plan);
  const tools = factory ? factory.inspectTools() : toolInspector({ plan, broker, runner: toolRunner });
  let preflightResult = null;
  if (factory) preflightResult = factory.preflight({ paths, strict: true, sandboxRoot: null });
  else if (sandbox) sandbox.probe();
  const hostBefore = preflightResult?.hostStability || expectedHostStability(plan);
  assertAbsent(paths.staging);
  assertAbsent(paths.final);
  const preMutationTools = factory ? factory.inspectTools() : toolInspector({ plan, broker, runner: toolRunner });
  validatePersistentParent(broker, plan.persistent_parent);
  ensureDirectoryMode(plan.persistent_parent, 0o700);
  validatePersistentParent(broker, plan.persistent_parent);
  const claim = claimRun({ parent: plan.persistent_parent, runId: plan.run_id, planSha256: loaded.planSha256, claimedAt: clock(), broker });
  let stagingCreated = false;
  let finalRenamed = false;
  try {
    createOwnedDirectory(paths.staging, broker, { mode: 0o700 });
    stagingCreated = true;
    const owned = new OwnedRoot({ root: paths.staging, broker, rootKey: "persistent_parent" });
    const context = { plan, planPath, planSha256: loaded.planSha256, broker, owned, tools: preMutationTools, stagingRoot: paths.staging, finalRoot: paths.final, journal: [] };
    const stageHooks = hooks || defaultHooks(factory);
    if (!stageHooks) throw new Error("production factory required");
    for (const stage of JOURNAL.slice(3, -2)) {
      context.journal.push(stage);
      const hook = stageHooks[stage];
      if (typeof hook !== "function") throw new Error(`missing prepare hook:${stage}`);
      const result = await hook(context);
      if (result && typeof result === "object") Object.assign(context, result);
    }
    const removedTransient = cleanupTransientArtifacts(context);
    const hostAfter = factory ? factory.captureHostStability() : expectedHostStability(plan);
    const hostStability = assertHostStabilityPair(hostBefore, hostAfter, plan);
    owned.mkdir(join(paths.staging, "evidence"), 0o700);
    owned.write(join(paths.staging, "evidence", "host-stability.json"), `${canonicalize(hostStability)}\n`, 0o600);
    owned.write(join(paths.staging, "evidence", "final-layout-cleanup.json"), `${canonicalize({ schema: "memory-engine-runtime-authority-final-layout-v1", removed: removedTransient, forbidden_absent: ["candidate/unpack", "npm-cache", "empty-npmrc", ".harness", ".runtime-authority-sandbox-root", ".sandbox-probe-marker", ".scratch-candidate-reextract", ".scratch-r0-reextract", "scratch", "candidate/smoke", "recovery/smoke"] })}\n`, 0o600);
    context.journal.push("AUTHORITY_ASSEMBLED");
    const entryInventory = buildTypedEntryInventory(paths.staging, { rejectEmptyDirectories: true });
    const authorityBase = {
      schema: "memory-engine-runtime-authority-v1",
      published: false,
      run_id: plan.run_id,
      plan_sha256: loaded.planSha256,
      authority_root_binding: { root_name: plan.run_id, run_id: plan.run_id },
      journal: [...JOURNAL],
      entry_inventory: entryInventory,
      tool_identities: preMutationTools,
      source_commit: plan.source_commit,
      source_tree_identity: plan.source_tree_identity,
      expected_source_runtime_identity: plan.expected_source_runtime_identity,
      expected_active_runtime_identity: plan.expected_active_runtime_identity,
      expected_config_sha256: plan.expected_config_sha256,
      expected_gateway_pid: plan.expected_gateway_pid,
      expected_gateway_restart_count: plan.expected_gateway_restart_count,
      expected_console_pid: plan.expected_console_pid,
      expected_console_restart_count: plan.expected_console_restart_count,
      host_stability: { schema: "memory-engine-runtime-authority-host-stability-v1", path: "evidence/host-stability.json" },
      archives: context.archives || [],
      manifests: context.manifests || [],
      runtime_identities: context.candidateRuntimeCheckpoints || [],
    };
    assertAuthorityCompleteness(authorityBase, { requirePublished: false });
    const authority = { ...authorityBase, published: true };
    assertAuthorityCompleteness(authority);
    owned.write(join(paths.staging, "authority.json"), `${canonicalize(authority)}\n`, 0o600);
    writeChecksums(paths.staging, { owned });
    owned.publish(paths.final);
    finalRenamed = true;
    stagingCreated = false;
    claimUpdater(claim, "PUBLISHED", clock(), broker);
    return { ...context, authority, finalRoot: paths.final };
  } catch (error) {
    if (finalRenamed) {
      try {
        if (restorePublication) restorePublication({ broker, finalRoot: paths.final, stagingRoot: paths.staging });
        else broker.atomicRename(paths.final, paths.staging, { root: "persistent_parent" });
        finalRenamed = false;
        stagingCreated = true;
      } catch (rollbackError) {
        try { claimUpdater(claim, "FAILED", clock(), broker); } catch { /* retain non-PUBLISHED claim state */ }
        const recoveryError = new Error(`RECOVERY_REQUIRED: ${rollbackError.message}`);
        recoveryError.cause = error;
        throw recoveryError;
      }
    }
    try { claimUpdater(claim, "FAILED", clock(), broker); } catch { /* retain original failure */ }
    if (stagingCreated) {
      try { makeRemovable(paths.staging); rmSync(paths.staging, { recursive: true, force: true }); } catch { /* failed staging remains unpublished */ }
    }
    throw error;
  }
}

module.exports = { JOURNAL, makeStagingPaths, prepareRuntimeAuthority, defaultHooks };
