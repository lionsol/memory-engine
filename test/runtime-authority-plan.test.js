import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, writeFileSync } from "node:fs";
import { makeFixture, writePlan } from "./runtime-authority-fixtures.js";
import { parseJson, readPlanFile, validatePlanObject } from "../lib/runtime-authority/plan.js";

test("plan accepts exact schema and rejects duplicate keys", () => {
  const fixture = makeFixture();
  try {
    writePlan(fixture);
    const loaded = readPlanFile(fixture.planPath);
    assert.equal(loaded.plan.schema, "memory-engine-runtime-authority-plan-v1");
    assert.throws(() => parseJson('{"a":1,"a":2}'), /duplicate JSON key/);
  } finally { fixture.cleanup(); }
});

test("plan rejects mode, ownership, time, path, key, and target violations", () => {
  const fixture = makeFixture();
  try {
    writePlan(fixture, { ...fixture.plan, unknown: true });
    assert.throws(() => readPlanFile(fixture.planPath), /exact field set/);
    writePlan(fixture);
    chmodSync(fixture.planPath, 0o644);
    assert.throws(() => readPlanFile(fixture.planPath), /mode must be 0600/);
    const invalid = { ...fixture.plan, source_repo: `${fixture.plan.source_repo}/`, targeted_test_files: ["../escape.test.js", "../escape.test.js"] };
    assert.ok(validatePlanObject(invalid).some(error => error.includes("absolute path")));
    assert.ok(validatePlanObject(invalid).some(error => error.includes("targeted test")));
  } finally { fixture.cleanup(); }
});

test("plan time window uses inclusive start and exclusive expiry", () => {
  const fixture = makeFixture();
  try {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const valid = { ...fixture.plan, created_at: now.toISOString(), expires_at: new Date(now.getTime() + 1).toISOString() };
    assert.deepEqual(validatePlanObject(valid, { now }), []);
    assert.ok(validatePlanObject({ ...valid, expires_at: now.toISOString() }).some(error => error.includes("time window")));
  } finally { fixture.cleanup(); }
});

test("plan requires concrete source, active and release runtime identities", () => {
  const fixture = makeFixture();
  try {
    for (const field of ["expected_source_runtime_identity", "expected_active_runtime_identity", "expected_release_runtime_identity"]) {
      for (const value of [null, undefined, "", "placeholder"]) {
        const invalid = { ...fixture.plan, [field]: value };
        assert.ok(validatePlanObject(invalid).some(error => error.includes(`runtime identity:${field}`)));
      }
    }
  } finally { fixture.cleanup(); }
});

test("plan requires exact Python/compiler/ar and node-gyp bindings", () => {
  const fixture = makeFixture();
  try {
    for (const field of ["python_executable", "cc_executable", "cxx_executable", "make_executable", "ar_executable", "node_gyp_root"]) {
      const value = { ...fixture.plan, [field]: null };
      writePlan(fixture, value);
      assert.throws(() => readPlanFile(fixture.planPath), /exact field set mismatch|invalid absolute path/);
    }
    for (const field of ["expected_python_executable_sha256", "expected_cc_executable_sha256", "expected_cxx_executable_sha256", "expected_make_executable_sha256", "expected_ar_executable_sha256", "expected_node_gyp_tree_identity"]) {
      const value = { ...fixture.plan, [field]: "placeholder" };
      writePlan(fixture, value);
      assert.throws(() => readPlanFile(fixture.planPath), /invalid sha256|invalid node-gyp closure identity/);
    }
  } finally { fixture.cleanup(); }
});
