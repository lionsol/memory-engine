import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");

test("AML Docker packaging is Node 24, non-root, retained-volume, and health-check bound", () => {
  const dockerfile = readFileSync(join(ROOT, "Dockerfile.aml"), "utf8");
  assert.match(dockerfile, /^FROM node:24-bookworm-slim AS dependencies/m);
  assert.match(dockerfile, /^FROM node:24-bookworm-slim/m);
  assert.match(dockerfile, /USER node/u);
  assert.match(dockerfile, /EXPOSE 8080/u);
  assert.match(dockerfile, /VOLUME \["\/tmp\/memory-engine-aml-data"\]/u);
  assert.match(dockerfile, /HEALTHCHECK/u);
  assert.match(dockerfile, /127\.0\.0\.1:8080\/health/u);
  assert.match(dockerfile, /CMD \["node", "bin\/serve-aml-benchmark-v1\.js"\]/u);
  assert.doesNotMatch(dockerfile, /(?:^|\s)(?:sk-|Bearer\s+[^$]|api[_-]?key\s*[:=]\s*[^$])/iu);
  assert.doesNotMatch(dockerfile, /\.env(?:\.|\s|$)/u);
});
test("Docker context excludes repository metadata, test output, credentials, and database artifacts", () => {
  const dockerignore = readFileSync(join(ROOT, ".dockerignore"), "utf8");
  for (const entry of [".git", "node_modules", "test", "reports", "coverage", "*.sqlite",
    "*.sqlite-wal", "*.sqlite-shm", "*.log", ".env", ".env.*"]) {
    assert.match(dockerignore, new RegExp(`^${entry.replaceAll(".", "\\.").replaceAll("*", ".*")}$`, "mu"));
  }
  assert.equal(dockerignore.includes("lib"), false);
  assert.equal(dockerignore.includes("bin"), false);
});
