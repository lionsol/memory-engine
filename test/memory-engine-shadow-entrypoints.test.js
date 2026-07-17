import test from "node:test";
import assert from "node:assert/strict";
import {
  closeSync,
  existsSync,
  openSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shimPaths = [
  resolve(repoRoot, "bin", "memory-engine.js"),
  resolve(repoRoot, "skills", "scripts", "memory-engine.js"),
];
const FORBIDDEN_SHIM_PATTERNS = [
  /better-sqlite3/i,
  /main\.sqlite/i,
  /ATTACH DATABASE/i,
  /\bwithDb\b/,
  /\bwithBothDbs\b/,
  /\bwithLegacyDb\b/,
  /lancedb/i,
  /embedding/i,
  /\bRRF\b/,
  /\bFTS\b/i,
  /\bKG search\b/i,
  /memory_confidence/i,
  /SELECT[\s\S]{0,120}\bchunks\b/i,
  /function\s+cmdAdd/i,
  /function\s+cmdSearch/i,
  /function\s+archive/i,
];
let captureCounter = 0;

function readShim(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

function createFixture() {
  const directory = mkdtempSync(resolve(tmpdir(), "memory-engine-shim-"));
  const canonicalPath = resolve(directory, "canonical-fixture.cjs");
  writeFileSync(canonicalPath, `
const payload = {
  argv: process.argv.slice(2),
  marker: process.env.SHIM_TEST_MARKER || null,
};
if (process.env.SHIM_TEST_STDOUT) process.stdout.write(process.env.SHIM_TEST_STDOUT);
if (process.env.SHIM_TEST_STDERR) process.stderr.write(process.env.SHIM_TEST_STDERR);
process.stdout.write(JSON.stringify(payload) + "\\n");
process.exitCode = Number(process.env.SHIM_TEST_EXIT || 0);
`);
  return { directory, canonicalPath };
}

function runShim(shimPath, canonicalPath, args = [], extraEnv = {}) {
  const captureId = captureCounter++;
  const stdoutPath = resolve(pathForTestHome(), `stdout-${captureId}.txt`);
  const stderrPath = resolve(pathForTestHome(), `stderr-${captureId}.txt`);
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");
  let result;
  try {
    result = spawnSync(process.execPath, [shimPath, ...args], {
      env: {
        ...process.env,
        HOME: resolve(pathForTestHome()),
        MEMORY_ENGINE_CANONICAL_CLI: canonicalPath,
        ...extraEnv,
      },
      stdio: ["pipe", stdoutFd, stderrFd],
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  const captured = {
    status: result.status,
    signal: result.signal,
    stdout: readFileSync(stdoutPath, "utf8"),
    stderr: readFileSync(stderrPath, "utf8"),
    error: result.error ? String(result.error) : null,
  };
  rmSync(stdoutPath, { force: true });
  rmSync(stderrPath, { force: true });
  return captured;
}

let isolatedHome;
function pathForTestHome() {
  if (!isolatedHome) isolatedHome = mkdtempSync(resolve(tmpdir(), "memory-engine-shim-home-"));
  return isolatedHome;
}

test.after(() => {
  if (isolatedHome) rmSync(isolatedHome, { recursive: true, force: true });
});

test("both shim files contain no DB or independent business logic", () => {
  for (const shimPath of shimPaths) {
    const source = readFileSync(shimPath, "utf8");
    for (const pattern of FORBIDDEN_SHIM_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${shimPath} contains forbidden shim content: ${pattern}`);
    }
    assert.match(source, /spawnSync\(process\.execPath/);
    assert.match(source, /stdio:\s*["']inherit["']/);
    assert.match(source, /env:\s*process\.env/);
  }
});

test("both shims directly resolve the same canonical CLI", () => {
  const binSource = readShim("bin/memory-engine.js");
  const skillSource = readShim("skills/scripts/memory-engine.js");
  assert.match(binSource, /path\.join\(__dirname,\s*["']memory-engine-cli\.js["']\)/);
  assert.match(skillSource, /path\.join\(__dirname,\s*["']\.\.\/\.\.\/bin\/memory-engine-cli\.js["']\)/);
  assert.doesNotMatch(binSource, /memory-engine\.js["']/);
  assert.doesNotMatch(skillSource, /memory-engine\.js["']/);
});

test("argv, environment, and UTF-8 arguments are passed through unchanged", () => {
  const fixture = createFixture();
  try {
    const args = ["search", "用户偏好 使用中文", "--top-k", "5", "带空格的参数"];
    for (const shimPath of shimPaths) {
      const result = runShim(shimPath, fixture.canonicalPath, args, {
        SHIM_TEST_MARKER: "透传环境",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout.trim()), {
        argv: args,
        marker: "透传环境",
      });
    }
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("stdout and stderr are inherited from the canonical CLI", () => {
  const fixture = createFixture();
  try {
    for (const shimPath of shimPaths) {
      const result = runShim(shimPath, fixture.canonicalPath, [], {
        SHIM_TEST_STDOUT: "fixture stdout\\n",
        SHIM_TEST_STDERR: "fixture stderr\\n",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /fixture stdout/);
      assert.match(result.stderr, /fixture stderr/);
    }
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("child exit code is preserved", () => {
  const fixture = createFixture();
  try {
    for (const shimPath of shimPaths) {
      const result = runShim(shimPath, fixture.canonicalPath, [], { SHIM_TEST_EXIT: "7" });
      assert.equal(result.status, 7, result.stderr);
    }
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("missing canonical CLI fails closed without fallback or file creation", () => {
  const fixture = createFixture();
  const missingPath = resolve(fixture.directory, "missing", "memory-engine-cli.js");
  const sentinelPath = resolve(fixture.directory, "fallback-created.txt");
  try {
    for (const shimPath of shimPaths) {
      const result = runShim(shimPath, missingPath, ["status"], {
        SHIM_TEST_MARKER: sentinelPath,
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /memory-engine canonical CLI is unavailable/);
      assert.doesNotMatch(result.stdout, /fallback|canonical-fixture/);
      assert.equal(existsSync(sentinelPath), false);
    }
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("both shadow entrypoints have identical observable behavior", () => {
  const fixture = createFixture();
  try {
    const args = ["search", "同一组参数", "--top-k", "3"];
    const env = { SHIM_TEST_MARKER: "same-behavior" };
    const results = shimPaths.map(shimPath => runShim(shimPath, fixture.canonicalPath, args, env));
    assert.deepEqual(results[1], results[0]);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});
