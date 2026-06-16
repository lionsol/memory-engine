const { readdirSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPT_DIR = __dirname;
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
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
const RECURSIVE_DIRS = ["lib", "console", "bin", "test"];
const SKIP_DIRS = new Set(["node_modules", ".git"]);

function collectDirectRootJsFiles(rootDir) {
  return readdirSync(rootDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".js") && ROOT_JS_INCLUDE.has(entry.name))
    .map(entry => path.resolve(rootDir, entry.name));
}

function collectJsFilesRecursive(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...collectJsFilesRecursive(path.resolve(dir, entry.name)));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    files.push(path.resolve(dir, entry.name));
  }
  return files;
}

function collectProjectJsFiles(projectRoot = PROJECT_ROOT) {
  const allFiles = [
    ...collectDirectRootJsFiles(projectRoot),
    ...RECURSIVE_DIRS.flatMap(dir => collectJsFilesRecursive(path.resolve(projectRoot, dir))),
  ];
  return [...new Set(allFiles)].sort((a, b) => a.localeCompare(b));
}

function runStaticCheck(projectRoot = PROJECT_ROOT) {
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

if (require.main === module) {
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

module.exports = {
  collectProjectJsFiles,
  runStaticCheck,
};
