import { readdirSync, statSync } from "node:fs";
import path, { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const ROOT_JS_INCLUDE = new Set([
  "index.js",
  "auto-recall.js",
  "date-utils.js",
  "memory-manager-runtime.js",
  "query-utils.js",
  "session-checkpoint.js",
  "smart-add-fingerprint.js",
  "smart-add.js",
]);
const RECURSIVE_DIRS = ["lib", "console", "scripts", "test"];
const SKIP_DIRS = new Set(["node_modules", ".git"]);

function collectDirectRootJsFiles(rootDir) {
  return readdirSync(rootDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".js") && ROOT_JS_INCLUDE.has(entry.name))
    .map(entry => resolve(rootDir, entry.name));
}

function collectJsFilesRecursive(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...collectJsFilesRecursive(resolve(dir, entry.name)));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    files.push(resolve(dir, entry.name));
  }
  return files;
}

export function collectProjectJsFiles(projectRoot = PROJECT_ROOT) {
  const allFiles = [
    ...collectDirectRootJsFiles(projectRoot),
    ...RECURSIVE_DIRS.flatMap(dir => collectJsFilesRecursive(resolve(projectRoot, dir))),
  ];
  return [...new Set(allFiles)].sort((a, b) => a.localeCompare(b));
}

export function runStaticCheck(projectRoot = PROJECT_ROOT) {
  const files = collectProjectJsFiles(projectRoot);
  const failures = [];

  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], {
      cwd: projectRoot,
      encoding: "utf8",
    });
    if (result.status === 0) continue;
    failures.push({
      file,
      status: result.status,
      stderr: String(result.stderr || "").trim(),
      stdout: String(result.stdout || "").trim(),
      error: result.error ? String(result.error.message || result.error) : "",
    });
  }

  return { files, failures };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const { files, failures } = runStaticCheck();
  if (failures.length === 0) {
    console.log(`static check passed: ${files.length} files`);
    process.exit(0);
  }

  for (const failure of failures) {
    console.error(`\n[check] ${path.relative(PROJECT_ROOT, failure.file)}`);
    if (failure.stderr) console.error(failure.stderr);
    else if (failure.stdout) console.error(failure.stdout);
    else if (failure.error) console.error(failure.error);
    else console.error(`node --check exited with status ${failure.status ?? "unknown"}`);
  }
  process.exit(1);
}
