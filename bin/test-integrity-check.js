const { readdirSync, readFileSync } = require("node:fs");
const { relative, resolve, sep } = require("node:path");

const PROJECT_ROOT = resolve(__dirname, "..");
const DEFAULT_TEST_DIR = resolve(PROJECT_ROOT, "test");

const NO_EXECUTABLE_TEST_REGISTRATION = "NO_EXECUTABLE_TEST_REGISTRATION";
const DOCUMENTATION_TOKEN_ONLY = "DOCUMENTATION_TOKEN_ONLY";
const UNREADABLE_TEST_FILE = "UNREADABLE_TEST_FILE";

const DOCUMENTATION_READ_PATTERN = /\b(?:readFileSync|readFile)\s*\(/u;
const DOCUMENTATION_PATH_PATTERN = /(?:docs\/|openspec\/|README(?:\.md)?|(?:design|runbook|contract|strategy|architecture|handoff)[^\s"'`]*\.md)/iu;
const NON_DOCUMENT_SUBJECT_PATTERN = /(?:from\s*["'`]\.\.?\/|require\(\s*["'`]\.\.?\/|(?:readFileSync|readFile|new\s+URL|resolve|join)\s*\([^\n)]*(?:\.(?:js|cjs|mjs|json|html|ejs|css|sh|py)\b|(?:bin|lib|console)\/))/iu;
const NON_DOCUMENT_ARTIFACT_PATTERN = /\.(?:html|ejs|css)\b/iu;
const STRUCTURED_OR_BEHAVIOR_PATTERN = /(?:from\s*["'`]\.\.?\/|require\(\s*["'`]\.\.?\/|spawnSync|spawn\s*\(|execFile|child_process|better-sqlite3|new\s+Database|mkdtemp|tmpdir|JSON\.parse|matchAll\s*\(|writeFileSync|appendFileSync|mkdirSync|readdirSync|lstatSync|statSync|readlinkSync)/u;
const DOCUMENTATION_ASSERTION_PATTERN = /(?:\.includes\s*\(|assert\.(?:match|doesNotMatch)\s*\()/u;

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

// This is deliberately a conservative, file-level heuristic. It catches the
// high-confidence false-evidence shape without attempting to parse JavaScript
// or judge individual test cases in a mixed behavior/contract file.
function isDocumentationTokenOnly(source) {
  const code = blankComments(source);
  if (!DOCUMENTATION_READ_PATTERN.test(code)) return false;
  if (!DOCUMENTATION_PATH_PATTERN.test(code)) return false;
  if (NON_DOCUMENT_ARTIFACT_PATTERN.test(code)) return false;
  if (NON_DOCUMENT_SUBJECT_PATTERN.test(code)) return false;
  if (STRUCTURED_OR_BEHAVIOR_PATTERN.test(code)) return false;
  return DOCUMENTATION_ASSERTION_PATTERN.test(code);
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
  const invalidDetails = [];
  const reasonCounts = {
    [NO_EXECUTABLE_TEST_REGISTRATION]: 0,
    [DOCUMENTATION_TOKEN_ONLY]: 0,
    [UNREADABLE_TEST_FILE]: 0,
  };
  const files = collectTestFiles(testDir);

  function addInvalid(file, reason) {
    const relativePath = toPosixPath(relative(root, file));
    invalidFiles.push(relativePath);
    invalidDetails.push({ file: relativePath, reason });
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  }

  for (const file of files) {
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      addInvalid(file, UNREADABLE_TEST_FILE);
      continue;
    }
    if (!hasExecutableTestRegistration(source)) {
      addInvalid(file, NO_EXECUTABLE_TEST_REGISTRATION);
    } else if (isDocumentationTokenOnly(source)) {
      addInvalid(file, DOCUMENTATION_TOKEN_ONLY);
    }
  }

  return {
    scannedCount: files.length,
    invalidCount: invalidFiles.length,
    invalidFiles,
    invalidDetails,
    reasonCounts,
  };
}

function formatTestIntegrityReport(report) {
  const lines = [
    `test-integrity: scanned=${report.scannedCount} invalid=${report.invalidCount} no_registration=${report.reasonCounts[NO_EXECUTABLE_TEST_REGISTRATION]} documentation_token_only=${report.reasonCounts[DOCUMENTATION_TOKEN_ONLY]}`,
  ];
  if (report.invalidFiles.length > 0) {
    lines.push(
      "invalid files:",
      ...report.invalidDetails.map(({ file, reason }) => `- ${file} [${reason}]`),
    );
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
  DOCUMENTATION_TOKEN_ONLY,
  formatTestIntegrityReport,
  hasExecutableTestRegistration,
  isDocumentationTokenOnly,
  NO_EXECUTABLE_TEST_REGISTRATION,
  runTestIntegrity,
  scanTestIntegrity,
  UNREADABLE_TEST_FILE,
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
