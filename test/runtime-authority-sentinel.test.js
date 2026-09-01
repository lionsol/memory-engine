import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildRuntimeArtifactManifestV2 } from "../bin/runtime-artifact-manifest-v2-lib.cjs";
import { buildSentinel, validateSentinel } from "../lib/runtime-authority/sentinel.js";
import { makeFixture } from "./runtime-authority-fixtures.js";

test("sentinel identity is canonical and independent of root and checked_at", () => {
  const fixture = makeFixture();
  try {
    const second = join(fixture.root, "second");
    mkdirSync(second, { mode: 0o700 });
    writeFileSync(join(second, "canary"), "same\n", { mode: 0o400 });
    writeFileSync(join(second, "package.json"), "{}\n", { mode: 0o400 });
    writeFileSync(join(fixture.plan.source_repo, "canary"), "same\n", { mode: 0o400 });
    const firstManifest = buildRuntimeArtifactManifestV2({ rootDir: fixture.plan.source_repo, checkedAt: "2026-01-01T00:00:00.000Z" });
    const secondManifest = buildRuntimeArtifactManifestV2({ rootDir: second, checkedAt: "2027-01-01T00:00:00.000Z" });
    const first = buildSentinel({ manifest: firstManifest, checkedAt: "a", rootPath: "/one", gitCommit: "commit", gitTree: "tree", packageJsonSha256: "p", packageLockSha256: "l" });
    const other = buildSentinel({ manifest: secondManifest, checkedAt: "b", rootPath: "/two", gitCommit: "commit", gitTree: "tree", packageJsonSha256: "p", packageLockSha256: "l" });
    assert.equal(first.sentinel_identity, other.sentinel_identity);
    assert.notEqual(first.manifest_file_sha256, other.manifest_file_sha256);
    assert.equal(first.projection.checked_at, undefined);
    assert.equal(first.projection.root_path, undefined);
    assert.equal(validateSentinel(first, { manifest: firstManifest, gitCommit: "commit", gitTree: "tree", packageJsonSha256: "p", packageLockSha256: "l" }).valid, true);
    const disk = join(fixture.root, "sentinel.json");
    writeFileSync(disk, `${JSON.stringify(first)}\n`);
    const roundTrip = JSON.parse(readFileSync(disk, "utf8"));
    assert.equal(validateSentinel(roundTrip, { manifest: firstManifest, gitCommit: "commit", gitTree: "tree", packageJsonSha256: "p", packageLockSha256: "l" }).valid, true);
    roundTrip.checked_at = "changed"; roundTrip.root_path = "/other";
    assert.equal(validateSentinel(roundTrip, { manifest: firstManifest, gitCommit: "commit", gitTree: "tree", packageJsonSha256: "p", packageLockSha256: "l" }).valid, true);
    roundTrip.projection.semantic_identity = "changed";
    assert.equal(validateSentinel(roundTrip, { manifest: firstManifest, gitCommit: "commit", gitTree: "tree", packageJsonSha256: "p", packageLockSha256: "l" }).valid, false);
  } finally { fixture.cleanup(); }
});
