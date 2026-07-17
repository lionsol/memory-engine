import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectVersionStatus,
  parseReleaseVersionFromTag,
  validateVersionStatus,
} from "../lib/version/release-version.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(path) {
  return JSON.parse(readFileSync(resolve(repoRoot, path), "utf8"));
}

test("release tag parser accepts a semantic prefix and optional description", () => {
  assert.equal(parseReleaseVersionFromTag("v0.8.22-memory-process-boundary-audit"), "0.8.22");
  assert.equal(parseReleaseVersionFromTag("v0.8.23"), "0.8.23");
  assert.equal(parseReleaseVersionFromTag("1.0.2"), null);
  assert.equal(parseReleaseVersionFromTag("v1.0"), null);
});

test("version validation requires all manifest roots to match the reachable release", () => {
  const valid = validateVersionStatus({
    release_tag: "v0.8.22-example",
    release_version: "0.8.22",
    manifest_versions: {
      package_json: "0.8.22",
      package_lock: "0.8.22",
      package_lock_root: "0.8.22",
    },
  });
  assert.deepEqual(valid, { ok: true, errors: [] });

  const invalid = validateVersionStatus({
    release_tag: "v0.8.22-example",
    release_version: "0.8.22",
    manifest_versions: {
      package_json: "1.0.2",
      package_lock: "0.8.22",
      package_lock_root: "0.8.22",
    },
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join("\n"), /package_json=1\.0\.2/);
});

test("current manifests match the nearest reachable release tag", () => {
  const status = collectVersionStatus(repoRoot);
  const validation = validateVersionStatus(status);

  assert.equal(validation.ok, true, validation.errors.join("\n"));
  assert.match(status.release_tag, /^v\d+\.\d+\.\d+(?:-|$)/);
  assert.equal(status.release_version, readJson("package.json").version);
  assert.equal(status.manifest_versions.package_lock, readJson("package-lock.json").version);
  assert.equal(status.unreleased, status.commits_after_release > 0 || status.dirty);

  execFileSync("git", ["merge-base", "--is-ancestor", status.release_tag, "HEAD"], {
    cwd: repoRoot,
    stdio: "ignore",
  });
});

test("version status CLI reports unreleased state without failing consistency check", () => {
  const raw = execFileSync(process.execPath, ["bin/version-status.js", "--check", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const result = JSON.parse(raw);

  assert.equal(result.validation.ok, true, result.validation.errors?.join("\n"));
  assert.equal(typeof result.commits_after_release, "number");
  assert.equal(typeof result.dirty, "boolean");
  assert.equal(typeof result.unreleased, "boolean");
  assert.equal(typeof result.build_identity, "string");
});

test("package scripts and release policy expose version status and check commands", () => {
  const pkg = readJson("package.json");
  const policy = readFileSync(resolve(repoRoot, "docs/release-version-policy.md"), "utf8");

  assert.equal(pkg.scripts?.["version:status"], "node bin/version-status.js");
  assert.equal(pkg.scripts?.["version:check"], "node bin/version-status.js --check");
  for (const token of [
    "Status: Current release policy",
    "nearest release tag that is reachable from the current commit",
    "non-ancestor history",
    "unreleased changes",
    "npm run version:status",
    "npm run version:check",
  ]) {
    assert.equal(policy.includes(token), true, `missing release policy token: ${token}`);
  }
});
