import test from "node:test";
import assert from "node:assert/strict";
import gate from "../bin/review-gate.js";

const {
  PROJECT_ROOT,
  REQUIRED_PHASES,
  normalizeExecutionResult,
  runReviewGate,
} = gate;

function successfulExecutor(calls) {
  return invocation => {
    calls.push(invocation);
    return { status: 0, signal: null };
  };
}

function summaryFor(statuses) {
  return [
    "review-gate:",
    ...REQUIRED_PHASES.map((phase, index) => `  ${phase.key}=${statuses[index] ? "PASS" : "FAIL"}`),
    `  overall=${statuses.every(Boolean) ? "PASS" : "FAIL"}`,
  ].join("\n");
}

test("runs all required phases in order with the repository cwd and command contract", () => {
  const calls = [];
  const result = runReviewGate({ executor: successfulExecutor(calls) });

  assert.deepEqual(
    calls.map(call => call.phase),
    ["static_check", "test_integrity", "node_test", "openspec_strict", "diff_check"],
  );
  assert.deepEqual(
    calls.map(({ command, args }) => ({ command, args })),
    REQUIRED_PHASES.map(({ command, args }) => ({ command, args })),
  );
  for (const call of calls) {
    assert.equal(call.cwd, PROJECT_ROOT);
    assert.equal(call.env, process.env);
    assert.equal(call.shell, false);
    assert.equal(call.stdio, "inherit");
  }
  assert.equal(result.overall, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.output, summaryFor([true, true, true, true, true]));
});

test("a single failed phase makes the gate fail but does not stop later phases", () => {
  const calls = [];
  const result = runReviewGate({
    executor: invocation => {
      calls.push(invocation.phase);
      return { status: invocation.phase === "test_integrity" ? 1 : 0 };
    },
  });

  assert.deepEqual(calls, REQUIRED_PHASES.map(phase => phase.key));
  assert.equal(result.overall, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.phaseResults[1].exitCode, 1);
  assert.equal(result.output, summaryFor([true, false, true, true, true]));
});

test("reports multiple failed phases in the stable summary", () => {
  const statuses = [false, true, false, true, false];
  const result = runReviewGate({
    executor: ({ phase }) => ({ status: statuses[REQUIRED_PHASES.findIndex(item => item.key === phase)] ? 0 : 2 }),
  });

  assert.deepEqual(
    result.phaseResults.filter(phase => !phase.passed).map(phase => [phase.key, phase.exitCode]),
    [["static_check", 2], ["node_test", 2], ["diff_check", 2]],
  );
  assert.equal(result.exitCode, 1);
  assert.equal(result.output, summaryFor(statuses));
});

test("normalizes exit codes, signals, and executor errors", () => {
  assert.deepEqual(normalizeExecutionResult({ status: 0 }), {
    error: null,
    exitCode: 0,
    passed: true,
    signal: null,
  });
  assert.deepEqual(normalizeExecutionResult({ status: 7 }), {
    error: null,
    exitCode: 7,
    passed: false,
    signal: null,
  });
  assert.deepEqual(normalizeExecutionResult({ status: null, signal: "SIGTERM" }), {
    error: null,
    exitCode: null,
    passed: false,
    signal: "SIGTERM",
  });
  assert.deepEqual(normalizeExecutionResult({ error: new Error("spawn failed") }), {
    error: "spawn failed",
    exitCode: null,
    passed: false,
    signal: null,
  });
});

test("continues after an executor exception and reports the normalized error", () => {
  const calls = [];
  const result = runReviewGate({
    executor: invocation => {
      calls.push(invocation.phase);
      if (invocation.phase === "openspec_strict") throw new Error("openspec unavailable");
      return { status: 0 };
    },
  });

  assert.deepEqual(calls, REQUIRED_PHASES.map(phase => phase.key));
  assert.equal(result.phaseResults[3].error, "openspec unavailable");
  assert.equal(result.phaseResults[4].passed, true);
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /openspec_strict=FAIL/);
});
