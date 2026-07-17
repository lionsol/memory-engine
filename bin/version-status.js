#!/usr/bin/env node

const { resolve } = require("node:path");

const repoRoot = resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));
const json = args.has("--json");
const check = args.has("--check");

async function main() {
  try {
    const {
      collectVersionStatus,
      validateVersionStatus,
    } = await import("../lib/version/release-version.js");
    const status = collectVersionStatus(repoRoot);
    const validation = validateVersionStatus(status);
    const output = {
      ...status,
      validation,
    };

    if (json) {
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    } else {
      console.log(`release_tag: ${status.release_tag}`);
      console.log(`release_version: ${status.release_version || "invalid"}`);
      console.log(`package_json_version: ${status.manifest_versions.package_json || "missing"}`);
      console.log(`package_lock_version: ${status.manifest_versions.package_lock || "missing"}`);
      console.log(`package_lock_root_version: ${status.manifest_versions.package_lock_root || "missing"}`);
      console.log(`commits_after_release: ${status.commits_after_release}`);
      console.log(`commit: ${status.commit}`);
      console.log(`dirty: ${status.dirty}`);
      console.log(`unreleased: ${status.unreleased}`);
      console.log(`build_identity: ${status.build_identity}`);
      console.log(`version_check: ${validation.ok ? "pass" : "fail"}`);
      for (const error of validation.errors) console.error(`version_error: ${error}`);
    }

    if (check && !validation.ok) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      process.stdout.write(`${JSON.stringify({ validation: { ok: false, errors: [message] } }, null, 2)}\n`);
    } else {
      console.error(`version_error: ${message}`);
    }
    process.exitCode = 1;
  }
}

main();
