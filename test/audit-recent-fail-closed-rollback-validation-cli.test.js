import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  auditRecentFailClosedRollbackValidation,
  exitCodeForStatus,
  parseArgs,
  usage,
} from "../bin/audit-recent-fail-closed-rollback-validation.js";

const before = {
  runtime_mode: "fail_closed_canary",
  observation_count: 20,
  applied_events: 20,
  suppressed_fallback_events: 20,
};
const after = {
  runtime_mode: "legacy_fallback",
  observation_count: 100,
  guard_failure_events: 10,
  applied_events: 0,
  suppressed_fallback_events: 0,
  legacy_fallback_events: 10,
};

function writeReports(root, values) {
  const paths = {};
  for (const [name, value] of Object.entries(values)) {
    paths[name] = join(root, `${name}.json`);
    writeFileSync(paths[name], JSON.stringify(value));
  }
  return paths;
}

async function run(values = { before, after }) {
  const root = mkdtempSync(join(tmpdir(), "recent-rollback-validation-cli-"));
  const paths = writeReports(root, values);
  try {
    return await auditRecentFailClosedRollbackValidation([
      "--before-report", paths.before,
      "--after-report", paths.after,
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("CLI maps confirmed rollback to exit code 0", async () => {
  const result = await run();
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.output).status, "rollback_confirmed");
});

test("CLI maps insufficient evidence to exit code 1", async () => {
  const result = await run({ before, after: { ...after, guard_failure_events: 0, legacy_fallback_events: 0 } });
  assert.equal(result.exitCode, 1);
  assert.equal(JSON.parse(result.output).status, "insufficient_evidence");
});

test("CLI maps rollback failure to exit code 2", async () => {
  const result = await run({ before, after: { ...after, suppressed_fallback_events: 1 } });
  assert.equal(result.exitCode, 2);
  assert.equal(JSON.parse(result.output).status, "rollback_failed");
});

test("CLI invalid JSON is reported as exit code 3 contract", async () => {
  const root = mkdtempSync(join(tmpdir(), "recent-rollback-validation-cli-invalid-"));
  const beforePath = join(root, "before.json");
  writeFileSync(beforePath, "not-json");
  try {
    await assert.rejects(
      auditRecentFailClosedRollbackValidation(["--before-report", beforePath]),
      /failed to read before report JSON/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.equal(exitCodeForStatus("rollback_confirmed"), 0);
  assert.equal(exitCodeForStatus("insufficient_evidence"), 1);
  assert.equal(exitCodeForStatus("rollback_failed"), 2);
  assert.equal(exitCodeForStatus("unknown"), 3);
});

test("CLI rejects missing required flags and mutation flags", () => {
  assert.throws(() => parseArgs(["--before-report"]), /expects a value/);
  assert.throws(() => parseArgs(["--apply"]), /unknown argument/);
  assert.match(usage(), /never changes runtime configuration/);
});
