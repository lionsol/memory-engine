import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dryRun } from "../lib/runtime-authority/dry-run.js";
import { prepareRuntimeAuthority } from "../lib/runtime-authority/prepare.js";
import { claimPath } from "../lib/runtime-authority/evidence.js";
import { fakeToolInspector, makeFixture, writePlan } from "./runtime-authority-fixtures.js";

test("dry-run is read-only, deterministic, and reports planned operations", () => {
  const fixture = makeFixture();
  try {
    writePlan(fixture);
    const sandbox = { probe: () => ({ available: true }) };
    const first = dryRun({ planPath: fixture.planPath, toolInspector: fakeToolInspector, sandbox, now: new Date() });
    const second = dryRun({ planPath: fixture.planPath, toolInspector: fakeToolInspector, sandbox, now: new Date() });
    assert.equal(first.schema, "memory-engine-runtime-authority-dry-run-v1");
    assert.equal(first.decision, "PASS");
    assert.equal(first.mutation_count, 0);
    assert.deepEqual(first.planned_operations, second.planned_operations);
    assert.equal(first.tool_identities.node.abi, 1);
  } finally { fixture.cleanup(); }
});

test("dry-run rejects unavailable sandbox without mutation", () => {
  const fixture = makeFixture();
  try {
    writePlan(fixture);
    const result = dryRun({ planPath: fixture.planPath, toolInspector: fakeToolInspector });
    assert.equal(result.decision, "REJECT");
    assert.equal(result.mutation_count, 0);
    assert.equal(result.preflight_findings.length > 0, true);
  } finally { fixture.cleanup(); }
});

test("prepare rechecks bound tool identities before claiming a run", async () => {
  const fixture = makeFixture();
  try {
    writePlan(fixture);
    let inspections = 0;
    const driftingInspector = args => {
      inspections += 1;
      if (inspections === 2) throw new Error("tool replacement between dry-run and prepare");
      return fakeToolInspector(args);
    };
    await assert.rejects(() => prepareRuntimeAuthority({ planPath: fixture.planPath, toolInspector: driftingInspector, sandbox: { probe: () => ({ available: true }) } }), /tool replacement/);
    assert.equal(inspections, 2);
    assert.equal(existsSync(claimPath(fixture.plan.persistent_parent, fixture.plan.run_id)), false);
  } finally { fixture.cleanup(); }
});
