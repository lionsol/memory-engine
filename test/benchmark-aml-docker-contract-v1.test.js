import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");

function parseStages(dockerfile) {
  const matches = [...dockerfile.matchAll(/^FROM[ \t]+([^\s]+)(?:[ \t]+AS[ \t]+([^\s]+))?[ \t]*$/gim)];
  return matches.map((match, index) => ({
    image: match[1],
    alias: match[2] ?? null,
    text: dockerfile.slice(match.index, matches[index + 1]?.index ?? dockerfile.length),
  }));
}

function normalizeDockerfileWhitespace(stageText) {
  return stageText
    .replace(/\\[ \t]*(?:\r?\n)[ \t]*/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

test("AML Docker dependencies build native modules outside the final runtime image", () => {
  const dockerfile = readFileSync(join(ROOT, "Dockerfile.aml"), "utf8");
  const stages = parseStages(dockerfile);
  assert.equal(stages.length, 2);

  const dependencies = stages.find((stage) => stage.alias === "dependencies");
  const runtimeStages = stages.filter((stage) => stage.alias === null);
  assert.ok(dependencies);
  assert.equal(runtimeStages.length, 1);
  const runtime = runtimeStages[0];
  const dependencyCommands = normalizeDockerfileWhitespace(dependencies.text);
  const runtimeCommands = normalizeDockerfileWhitespace(runtime.text);

  assert.equal(dependencies.image, "node:24-bookworm-slim");
  assert.equal(runtime.image, "node:24-bookworm-slim");
  assert.match(dependencyCommands, /apt-get update/u);
  assert.match(dependencyCommands, /apt-get install -y --no-install-recommends python3 make g\+\+/u);
  assert.match(dependencyCommands, /rm -rf \/var\/lib\/apt\/lists\/\*/u);
  assert.match(runtimeCommands, /COPY --from=dependencies \/app\/node_modules \.\/node_modules/u);
  assert.doesNotMatch(runtimeCommands, /apt-get install/u);

  assert.match(runtimeCommands, /USER\s+node/u);
  assert.match(runtimeCommands, /EXPOSE\s+8080/u);
  assert.match(runtimeCommands, /VOLUME\s*\[\s*"\/tmp\/memory-engine-aml-data"\s*\]/u);
  assert.match(runtimeCommands, /HEALTHCHECK/u);
  assert.match(runtimeCommands, /127\.0\.0\.1:8080\/health/u);
  assert.match(runtimeCommands, /CMD\s*\[\s*"node"\s*,\s*"bin\/serve-aml-benchmark-v1\.js"\s*\]/u);
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
