import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  REQUIRED_RUNTIME_FILES,
  ROOT_RUNTIME_FILES,
} from "../lib/version/runtime-build-identity.js";

const root = resolve(new URL("..", import.meta.url).pathname);
const allowedRootRuntimeFiles = new Set([
  ...REQUIRED_RUNTIME_FILES,
  ...ROOT_RUNTIME_FILES,
]);

function resolveImport(sourcePath, specifier) {
  const base = resolve(sourcePath, "..");
  const candidate = resolve(base, specifier);
  const candidates = [candidate, `${candidate}.js`, `${candidate}.cjs`, `${candidate}.mjs`, `${candidate}.json`, resolve(candidate, "index.js")];
  return candidates.find(path => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  }) || null;
}

function runtimeSourceFiles(entryPath) {
  const pending = [entryPath];
  const visited = new Set();
  const output = [];
  while (pending.length > 0) {
    const sourcePath = pending.shift();
    if (visited.has(sourcePath)) continue;
    visited.add(sourcePath);
    output.push(sourcePath);
    const source = readFileSync(sourcePath, "utf8");
    for (const specifier of localImports(source)) {
      const target = resolveImport(sourcePath, specifier);
      assert.ok(target, `unresolved local runtime import ${relative(root, sourcePath)} -> ${specifier}`);
      const targetPath = relative(root, target).replaceAll("\\", "/");
      assert.ok(
        targetPath.startsWith("lib/") || allowedRootRuntimeFiles.has(targetPath),
        `local runtime dependency is outside identity scope: ${relative(root, sourcePath)} -> ${targetPath}`,
      );
      pending.push(target);
    }
  }
  return output;
}

function localImports(source) {
  const imports = [];
  const patterns = [
    /\bfrom\s+["'](\.[^"']+)["']/g,
    /\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) imports.push(match[1]);
  }
  return [...new Set(imports)];
}

test("all local runtime imports are covered by the runtime identity scope", () => {
  const findings = [];
  for (const sourcePath of runtimeSourceFiles(resolve(root, "index.js"))) {
    const source = readFileSync(sourcePath, "utf8");
    for (const specifier of localImports(source)) {
      const target = resolveImport(sourcePath, specifier);
      assert.ok(target, `unresolved local runtime import ${relative(root, sourcePath)} -> ${specifier}`);
      const targetPath = relative(root, target).replaceAll("\\", "/");
      if (targetPath.startsWith("lib/")) continue;
      findings.push({ source: relative(root, sourcePath), specifier, target: targetPath });
      assert.ok(
        allowedRootRuntimeFiles.has(targetPath),
        `root runtime dependency is outside identity scope: ${findings.at(-1).source} -> ${targetPath}`,
      );
    }
  }

  const rootTargets = new Set(findings.map(finding => finding.target));
  for (const required of ["auto-recall.js", "date-utils.js", "memory-manager-runtime.js", "query-utils.js", "smart-add.js"]) {
    assert.ok(rootTargets.has(required), `expected root runtime dependency was not discovered: ${required}`);
  }
});
