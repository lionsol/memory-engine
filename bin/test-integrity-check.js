const { readdirSync, readFileSync } = require("node:fs");
const { relative, resolve, sep } = require("node:path");

const PROJECT_ROOT = resolve(__dirname, "..");
const DEFAULT_TEST_DIR = resolve(PROJECT_ROOT, "test");

// The repository's Node test contract is the default node:test import plus a
// line-oriented test/test.skip/test.todo/test.only/test.runIf registration.
// This intentionally does not attempt to parse arbitrary JavaScript frameworks.
const NODE_TEST_IMPORT_PATTERN = /^\s*import\s+test\s+from\s*(["'])node:test\1\s*;?/mu;
const NODE_TEST_REGISTRATION_PATTERN = /(?:^|\r?\n)[ \t]*test(?:[ \t]*\.[ \t]*(?:skip|todo|only|runIf))?[ \t]*\(/mu;

function toPosixPath(filePath) {
  return filePath.split(sep).join("/");
}

function blankComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, comment => comment.replace(/[^\r\n]/gu, " "))
    .replace(/\/\/[^\r\n]*/gu, comment => comment.replace(/[^\r\n]/gu, " "));
}

function hasExecutableTestRegistration(source) {
  const code = blankComments(source);
  return NODE_TEST_IMPORT_PATTERN.test(code) && NODE_TEST_REGISTRATION_PATTERN.test(code);
}

function collectTestFiles(testDir = DEFAULT_TEST_DIR) {
  const files = [];

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".test.js")) {
        files.push(entryPath);
      }
    }
  }

  visit(resolve(testDir));
  return files.sort((left, right) => left.localeCompare(right));
}

function scanTestIntegrity({ projectRoot = PROJECT_ROOT, testDir = DEFAULT_TEST_DIR } = {}) {
  const root = resolve(projectRoot);
  const invalidFiles = [];
  const files = collectTestFiles(testDir);

  for (const file of files) {
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      invalidFiles.push(toPosixPath(relative(root, file)));
      continue;
    }
    if (!hasExecutableTestRegistration(source)) {
      invalidFiles.push(toPosixPath(relative(root, file)));
    }
  }

  return {
    scannedCount: files.length,
    invalidCount: invalidFiles.length,
    invalidFiles,
  };
}

function formatTestIntegrityReport(report) {
  const lines = [
    `test-integrity: scanned=${report.scannedCount} invalid=${report.invalidCount}`,
  ];
  if (report.invalidFiles.length > 0) {
    lines.push("invalid files:", ...report.invalidFiles.map(file => `- ${file}`));
    lines.push("status: FAIL");
  } else {
    lines.push("invalid files: none", "status: PASS");
  }
  return lines.join("\n");
}

function runTestIntegrity(options = {}) {
  const report = scanTestIntegrity(options);
  return {
    ...report,
    exitCode: report.invalidCount === 0 ? 0 : 1,
    output: formatTestIntegrityReport(report),
  };
}

module.exports = {
  collectTestFiles,
  formatTestIntegrityReport,
  hasExecutableTestRegistration,
  runTestIntegrity,
  scanTestIntegrity,
};

if (require.main === module) {
  try {
    const result = runTestIntegrity();
    console.log(result.output);
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(`test-integrity: unable to scan test directory: ${error.message}`);
    process.exitCode = 1;
  }
}
