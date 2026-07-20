import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  REQUIRED_RUNTIME_FILES,
  ROOT_RUNTIME_FILES,
} from "../lib/version/runtime-build-identity.js";
import { buildRuntimeSourceParityReport } from "../lib/version/runtime-source-parity.js";

function fixtureRoot(label) {
  const root = mkdtempSync(resolve(tmpdir(), `memory-engine-${label}-`));
  for (const path of [...REQUIRED_RUNTIME_FILES, ...ROOT_RUNTIME_FILES, "lib/runtime.js"]) {
    const target = resolve(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `fixture:${path}\n`, "utf8");
  }
  return root;
}

test("runtime/source parity uses the reviewed runtime dependency closure", () => {
  const sourceRoot = fixtureRoot("source");
  const runtimeRoot = fixtureRoot("runtime");
  const report = buildRuntimeSourceParityReport({
    sourceRoot,
    runtimeRoot,
    checkedAt: "2026-07-20T01:00:00.000Z",
  });
  assert.equal(report.source_runtime_equal, true);
  assert.equal(report.difference_count, 0);
  assert.equal(report.runtime_build_identity, report.source_build_identity);
});

test("runtime/source parity reports changed runtime content without exposing file bytes", () => {
  const sourceRoot = fixtureRoot("source-drift");
  const runtimeRoot = fixtureRoot("runtime-drift");
  writeFileSync(resolve(runtimeRoot, "lib/runtime.js"), "changed\n", "utf8");
  const report = buildRuntimeSourceParityReport({
    sourceRoot,
    runtimeRoot,
    checkedAt: "2026-07-20T01:00:00.000Z",
  });
  assert.equal(report.source_runtime_equal, false);
  assert.equal(report.difference_count, 1);
  assert.deepEqual(report.differences, [{ path: "lib/runtime.js", status: "content_mismatch" }]);
  assert.equal(JSON.stringify(report).includes("changed"), false);
});

test("runtime/source parity requires canonical UTC report time", () => {
  assert.throws(() => buildRuntimeSourceParityReport({
    sourceRoot: fixtureRoot("source-time"),
    runtimeRoot: fixtureRoot("runtime-time"),
    checkedAt: "2026-07-20",
  }), /canonical UTC ISO/);
});
