import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import checker from "../bin/test-integrity-check.js";

const {
  DOCUMENTATION_TOKEN_ONLY,
  formatTestIntegrityReport,
  hasExecutableTestRegistration,
  NO_EXECUTABLE_TEST_REGISTRATION,
  runTestIntegrity,
  scanTestIntegrity,
} = checker;

function createSyntheticProject() {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-test-integrity-"));
  const testDir = join(root, "test");
  mkdirSync(testDir, { recursive: true });
  return { root, testDir };
}

function writeFixture(testDir, relativePath, source) {
  const filePath = join(testDir, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, source);
  return filePath;
}

function withSyntheticProject(run) {
  const project = createSyntheticProject();
  try {
    return run(project);
  } finally {
    rmSync(project.root, { recursive: true, force: true });
  }
}

test("recognizes a real node:test registration and ignores comments/literals", () => {
  const source = [
    'import test from "node:test";',
    '// test("comment-only", () => {});',
    'const text = "test(\\\"literal\\\")";',
    'test("real", () => {});',
  ].join("\n");
  assert.equal(hasExecutableTestRegistration(source), true);
  assert.equal(
    hasExecutableTestRegistration([
      'import test from "node:test";',
      'const pattern = /test\\(/;',
    ].join("\n")),
    false,
  );
  withSyntheticProject(({ root, testDir }) => {
    writeFixture(testDir, "real.test.js", `${source}\n`);
    assert.deepEqual(scanTestIntegrity({ projectRoot: root, testDir }), {
      scannedCount: 1,
      invalidCount: 0,
      invalidFiles: [],
      invalidDetails: [],
      reasonCounts: {
        NO_EXECUTABLE_TEST_REGISTRATION: 0,
        DOCUMENTATION_TOKEN_ONLY: 0,
        UNREADABLE_TEST_FILE: 0,
      },
    });
  });
});

test("comment-only .test.js file fails integrity", () => {
  withSyntheticProject(({ root, testDir }) => {
    const invalidPath = writeFixture(testDir, "retired.test.js", "// retired under stabilization\n/* no executable test */\n");
    const report = scanTestIntegrity({ projectRoot: root, testDir });
    assert.deepEqual(report, {
      scannedCount: 1,
      invalidCount: 1,
      invalidFiles: ["test/retired.test.js"],
      invalidDetails: [
        {
          file: "test/retired.test.js",
          reason: NO_EXECUTABLE_TEST_REGISTRATION,
        },
      ],
      reasonCounts: {
        NO_EXECUTABLE_TEST_REGISTRATION: 1,
        DOCUMENTATION_TOKEN_ONLY: 0,
        UNREADABLE_TEST_FILE: 0,
      },
    });
    assert.equal(invalidPath.endsWith("retired.test.js"), true);
  });
});

test("helper-only .test.js file fails integrity", () => {
  withSyntheticProject(({ root, testDir }) => {
    writeFixture(
      testDir,
      "fixtures.test.js",
      'import test from "node:test";\nexport function makeFixture() { return { ok: true }; }\n',
    );
    const report = scanTestIntegrity({ projectRoot: root, testDir });
    assert.equal(report.scannedCount, 1);
    assert.equal(report.invalidCount, 1);
    assert.deepEqual(report.invalidFiles, ["test/fixtures.test.js"]);
    assert.deepEqual(report.invalidDetails, [
      {
        file: "test/fixtures.test.js",
        reason: NO_EXECUTABLE_TEST_REGISTRATION,
      },
    ]);
    assert.equal(report.reasonCounts[NO_EXECUTABLE_TEST_REGISTRATION], 1);
  });
});

test("ordinary non-test fixture is not part of the integrity scan", () => {
  withSyntheticProject(({ root, testDir }) => {
    writeFixture(testDir, "fixtures.js", "export function makeFixture() { return { ok: true }; }\n");
    const report = scanTestIntegrity({ projectRoot: root, testDir });
    assert.deepEqual(report, {
      scannedCount: 0,
      invalidCount: 0,
      invalidFiles: [],
      invalidDetails: [],
      reasonCounts: {
        NO_EXECUTABLE_TEST_REGISTRATION: 0,
        DOCUMENTATION_TOKEN_ONLY: 0,
        UNREADABLE_TEST_FILE: 0,
      },
    });
  });
});

test("failure report names each invalid file and returns a stable non-zero exit code", () => {
  withSyntheticProject(({ root, testDir }) => {
    writeFixture(testDir, "invalid.test.js", "// no test registration\n");
    const result = runTestIntegrity({ projectRoot: root, testDir });
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /scanned=1 invalid=1/);
    assert.match(result.output, /invalid files:\n- test\/invalid\.test\.js/);
    assert.match(result.output, /\[NO_EXECUTABLE_TEST_REGISTRATION\]/);
    assert.match(formatTestIntegrityReport(result), /status: FAIL/);
  });
});

test("pure Markdown token assertions fail with a stable documentation reason", () => {
  withSyntheticProject(({ root, testDir }) => {
    writeFixture(
      testDir,
      "phase-token.test.js",
      [
        'import test from "node:test";',
        'import { readFileSync } from "node:fs";',
        'const doc = readFileSync(new URL("../docs/plan.md", import.meta.url), "utf8");',
        'test("phase is closed", () => { assert.match(doc, /PASS \\/ CLOSED/); });',
      ].join("\n"),
    );
    const report = scanTestIntegrity({ projectRoot: root, testDir });
    assert.equal(report.invalidCount, 1);
    assert.deepEqual(report.invalidDetails, [
      { file: "test/phase-token.test.js", reason: DOCUMENTATION_TOKEN_ONLY },
    ]);
    assert.equal(report.reasonCounts[DOCUMENTATION_TOKEN_ONLY], 1);
    assert.match(formatTestIntegrityReport(report), /DOCUMENTATION_TOKEN_ONLY/);
  });
});

test("Markdown phase/token loops and README wording tests fail closed", () => {
  withSyntheticProject(({ root, testDir }) => {
    writeFixture(
      testDir,
      "phase-loop.test.js",
      [
        'import test from "node:test";',
        'import { readFileSync } from "node:fs";',
        'const doc = readFileSync(new URL("../docs/plan.md", import.meta.url), "utf8");',
        'test("required phase tokens", () => {',
        '  for (const token of ["Phase 1", "AUTHORIZED", "CLOSED"]) assert.equal(doc.includes(token), true);',
        '});',
      ].join("\n"),
    );
    writeFixture(
      testDir,
      "readme-wording.test.js",
      [
        'import test from "node:test";',
        'import assert from "node:assert/strict";',
        'import { readFileSync } from "node:fs";',
        'const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");',
        'test("README states the current phase", () => assert.match(readme, /Current architecture/));',
      ].join("\n"),
    );
    const report = scanTestIntegrity({ projectRoot: root, testDir });
    assert.equal(report.scannedCount, 2);
    assert.equal(report.invalidCount, 2);
    assert.deepEqual(report.invalidDetails, [
      { file: "test/phase-loop.test.js", reason: DOCUMENTATION_TOKEN_ONLY },
      { file: "test/readme-wording.test.js", reason: DOCUMENTATION_TOKEN_ONLY },
    ]);
    assert.equal(report.reasonCounts[DOCUMENTATION_TOKEN_ONLY], 2);
  });
});

test("structural Markdown link tests remain valid evidence", () => {
  withSyntheticProject(({ root, testDir }) => {
    writeFixture(
      testDir,
      "markdown-links.test.js",
      [
        'import test from "node:test";',
        'import assert from "node:assert/strict";',
        'import { existsSync, readFileSync } from "node:fs";',
        'import { dirname, resolve } from "node:path";',
        'const doc = readFileSync(new URL("../docs/README.md", import.meta.url), "utf8");',
        'test("local links resolve", () => {',
        '  for (const [, href] of doc.matchAll(/\\[[^\\]]+\\]\\(([^)]+)\\)/g)) {',
        '    if (!href.startsWith("http")) assert.equal(existsSync(resolve(dirname("/tmp/docs/README.md"), href)), true);',
        '  }',
        '});',
      ].join("\n"),
    );
    const report = scanTestIntegrity({ projectRoot: root, testDir });
    assert.deepEqual(report.invalidFiles, []);
    assert.equal(report.invalidCount, 0);
  });
});

test("JSON schema, CLI, production behavior, and source negative tests remain valid evidence", () => {
  withSyntheticProject(({ root, testDir }) => {
    writeFixture(
      testDir,
      "json-schema.test.js",
      [
        'import test from "node:test";',
        'import assert from "node:assert/strict";',
        'import { readFileSync } from "node:fs";',
        'test("schema is structured", () => {',
        '  const manifest = JSON.parse(readFileSync("../openclaw.plugin.json", "utf8"));',
        '  assert.equal(manifest.configSchema.type, "object");',
        '});',
      ].join("\n"),
    );
    writeFixture(
      testDir,
      "cli.test.js",
      [
        'import test from "node:test";',
        'import assert from "node:assert/strict";',
        'import { spawnSync } from "node:child_process";',
        'test("CLI contract is executable", () => {',
        '  const result = spawnSync(process.execPath, ["bin/example.js", "--json"], { encoding: "utf8" });',
        '  assert.equal(result.status, 0);',
        '});',
      ].join("\n"),
    );
    writeFixture(
      testDir,
      "behavior.test.js",
      [
        'import test from "node:test";',
        'import assert from "node:assert/strict";',
        'import { actualFunction } from "../lib/foo.js";',
        'test("production behavior is observable", () => assert.equal(actualFunction(), true));',
      ].join("\n"),
    );
    writeFixture(
      testDir,
      "source-boundary.test.js",
      [
        'import test from "node:test";',
        'import assert from "node:assert/strict";',
        'import { readFileSync } from "node:fs";',
        'test("source boundary excludes destructive path", () => {',
        '  const source = readFileSync("../bin/foo.js", "utf8");',
        '  assert.doesNotMatch(source, /DROP TABLE/);',
        '});',
      ].join("\n"),
    );
    const report = scanTestIntegrity({ projectRoot: root, testDir });
    assert.equal(report.scannedCount, 4);
    assert.deepEqual(report.invalidFiles, []);
    assert.equal(report.invalidCount, 0);
  });
});

test("package exposes the test integrity checker script", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts?.["test:integrity"], "node bin/test-integrity-check.js");
});

test("current repository test tree passes integrity", () => {
  const report = scanTestIntegrity();
  assert.ok(report.scannedCount > 0);
  assert.equal(report.invalidCount, 0, formatTestIntegrityReport(report));
});
