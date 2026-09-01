const { spawnSync } = require("node:child_process");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const NPM_COMMAND = process.platform === "win32" ? "npm.cmd" : "npm";

const REQUIRED_PHASES = Object.freeze([
  Object.freeze({ key: "static_check", command: NPM_COMMAND, args: ["run", "check"] }),
  Object.freeze({ key: "test_integrity", command: NPM_COMMAND, args: ["run", "test:integrity"] }),
  Object.freeze({ key: "node_test", command: process.execPath, args: ["--test"] }),
  Object.freeze({
    key: "openspec_strict",
    command: "openspec",
    args: ["validate", "--all", "--strict", "--no-interactive"],
  }),
  Object.freeze({ key: "diff_check", command: "git", args: ["diff", "--check"] }),
]);

function normalizeError(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return String(error);
}

function normalizeExecutionResult(result) {
  const exitCode = Number.isInteger(result?.status) ? result.status : null;
  const signal = result?.signal == null ? null : String(result.signal);
  const error = result?.error == null ? null : normalizeError(result.error);
  const passed = exitCode === 0 && signal === null && error === null;
  return { error, exitCode, passed, signal };
}

function spawnPhase({ command, args, cwd, env }) {
  return spawnSync(command, args, {
    cwd,
    env,
    shell: false,
    stdio: "inherit",
  });
}

function formatReviewGateSummary(phaseResults, overall) {
  return [
    "review-gate:",
    ...phaseResults.map(result => `  ${result.key}=${result.passed ? "PASS" : "FAIL"}`),
    `  overall=${overall ? "PASS" : "FAIL"}`,
  ].join("\n");
}

function runReviewGate({ executor = spawnPhase, projectRoot = PROJECT_ROOT } = {}) {
  const cwd = path.resolve(projectRoot);
  const phaseResults = [];

  for (const phase of REQUIRED_PHASES) {
    const invocation = {
      args: [...phase.args],
      command: phase.command,
      cwd,
      env: process.env,
      phase: phase.key,
      shell: false,
      stdio: "inherit",
    };

    let execution;
    try {
      execution = executor(invocation);
    } catch (error) {
      execution = { error };
    }

    phaseResults.push({ key: phase.key, ...normalizeExecutionResult(execution) });
  }

  const overall = phaseResults.every(result => result.passed);
  return {
    exitCode: overall ? 0 : 1,
    overall,
    output: formatReviewGateSummary(phaseResults, overall),
    phaseResults,
  };
}

module.exports = {
  PROJECT_ROOT,
  REQUIRED_PHASES,
  formatReviewGateSummary,
  normalizeExecutionResult,
  runReviewGate,
  spawnPhase,
};

if (require.main === module) {
  const result = runReviewGate();
  console.log(result.output);
  process.exitCode = result.exitCode;
}
