import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import checker from "../bin/test-integrity-check.js";

const {
  formatTestIntegrityReport,
  hasExecutableTestRegistration,
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
    assert.match(formatTestIntegrityReport(result), /status: FAIL/);
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
