import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RELEASE_TAG_PATTERN = /^v(\d+\.\d+\.\d+)(?:-|$)/;

export function parseReleaseVersionFromTag(tag) {
  const normalized = String(tag || "").trim();
  const match = normalized.match(RELEASE_TAG_PATTERN);
  return match?.[1] || null;
}

export function readManifestVersions(repoRoot) {
  const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  const packageLock = JSON.parse(readFileSync(resolve(repoRoot, "package-lock.json"), "utf8"));

  return {
    package_json: packageJson.version || null,
    package_lock: packageLock.version || null,
    package_lock_root: packageLock.packages?.[""]?.version || null,
  };
}

function runGit(repoRoot, args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function collectVersionStatus(repoRoot) {
  const releaseTag = runGit(repoRoot, [
    "describe",
    "--tags",
    "--match",
    "v[0-9]*",
    "--abbrev=0",
    "HEAD",
  ]);
  const releaseVersion = parseReleaseVersionFromTag(releaseTag);
  const commit = runGit(repoRoot, ["rev-parse", "--short=12", "HEAD"]);
  const commitsAfterRelease = Number(runGit(repoRoot, ["rev-list", "--count", `${releaseTag}..HEAD`])) || 0;
  const buildIdentity = runGit(repoRoot, [
    "describe",
    "--tags",
    "--match",
    "v[0-9]*",
    "--always",
    "--dirty",
  ]);
  const dirty = runGit(repoRoot, ["status", "--porcelain"]).length > 0;
  const manifests = readManifestVersions(repoRoot);

  return {
    release_tag: releaseTag,
    release_version: releaseVersion,
    manifest_versions: manifests,
    commits_after_release: commitsAfterRelease,
    commit,
    dirty,
    unreleased: commitsAfterRelease > 0 || dirty,
    build_identity: buildIdentity,
  };
}

export function validateVersionStatus(status) {
  const errors = [];
  if (!status?.release_tag) errors.push("reachable release tag is missing");
  if (!status?.release_version) errors.push("reachable release tag does not start with v<major>.<minor>.<patch>");

  if (status?.release_version) {
    for (const [field, value] of Object.entries(status.manifest_versions || {})) {
      if (value !== status.release_version) {
        errors.push(`${field}=${value ?? "missing"} does not match release_version=${status.release_version}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
