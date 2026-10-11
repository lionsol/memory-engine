import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '..');
const helperPath = join(repoRoot, 'docs/smoke-tests/autorecall-recent-install-step-20261011.sh');
const nodePath = process.execPath;

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'autorecall-install-step-'));
  const candidate = join(root, 'candidate package with spaces');
  const rollback = join(root, 'fresh rollback package with spaces');
  const cwd = join(root, 'stable cwd with spaces');
  const entrypoint = join(root, 'harmless OpenClaw fixture with spaces.mjs');
  const driver = join(root, 'source helper driver.sh');
  const record = join(root, 'fixture-record.jsonl');
  mkdirSync(candidate);
  mkdirSync(rollback);
  mkdirSync(cwd);

  writeFileSync(entrypoint, `
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const recordPath = process.env.FIXTURE_RECORD_PATH;
const prior = existsSync(recordPath) ? readFileSync(recordPath, 'utf8').trim() : '';
const callIndex = prior ? prior.split('\\n').filter(Boolean).length : 0;
const exitCodes = (process.env.FIXTURE_EXIT_CODES ?? '0').split(',').map((value) => Number(value));
const exitCode = exitCodes[Math.min(callIndex, exitCodes.length - 1)];
appendFileSync(recordPath, JSON.stringify({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  path: process.env.PATH,
}) + '\\n');
process.exit(Number.isInteger(exitCode) ? exitCode : 70);
`);

  writeFileSync(driver, `#!/usr/bin/env bash
set +e
source "$1"
export INSTALL_STEP_NODE="$2"
export INSTALL_STEP_OPENCLAW_ENTRYPOINT="$3"
export INSTALL_STEP_CWD="$4"
export INSTALL_STEP_PATH="$5"
export FIXTURE_RECORD_PATH="$6"
export FIXTURE_EXIT_CODES="$7"
autorecall_install_step "$8" "$9" "\${10}" "\${11}" "\${12}"
rc=$?
printf 'driver_rc=%s\\n' "$rc"
exit 0
`);

  return { root, candidate, rollback, cwd, entrypoint, driver, record };
}

function runFixture(fixture, {
  node = nodePath,
  exitCodes = '0',
  launchObserved = 'yes',
  runtimeState = 'unchanged',
  recoveryAcceptance = 'not-needed',
} = {}) {
  const pathValue = 'C:\\Program Files\\dotnet:/mnt/c/Program Files/node:/tmp/path with spaces';
  const result = spawnSync('/bin/bash', [
    fixture.driver,
    helperPath,
    node,
    fixture.entrypoint,
    fixture.cwd,
    pathValue,
    fixture.record,
    exitCodes,
    fixture.candidate,
    fixture.rollback,
    launchObserved,
    runtimeState,
    recoveryAcceptance,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message);
  const facts = Object.fromEntries(result.stdout.trim().split('\n').filter(Boolean).map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  const records = existsSync(fixture.record)
    ? readFileSync(fixture.record, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : [];
  return { result, facts, records, pathValue };
}

function assertInvocation(records, index, fixture, packageDir, pathValue) {
  assert.deepEqual(records[index], {
    argv: ['plugins', 'install', packageDir, '--force'],
    cwd: fixture.cwd,
    path: pathValue,
  });
}

test('offline install-step subprocess contract', async (t) => {
  await t.test('uses one quoted launcher with exact argv, PATH, cwd, and candidate call', () => {
  const fixture = makeFixture();
  const run = runFixture(fixture, { exitCodes: '0' });

  assert.equal(run.result.status, 0);
  assert.equal(run.facts.driver_rc, '0');
  assert.equal(run.facts.candidate_invocations, '1');
  assert.equal(run.facts.recovery_invocations, '0');
  assert.equal(run.facts.restart_decision, 'permitted');
  assert.equal(run.records.length, 1);
  assertInvocation(run.records, 0, fixture, fixture.candidate, run.pathValue);
});

  await t.test('candidate success performs no recovery', () => {
  const fixture = makeFixture();
  const run = runFixture(fixture, { exitCodes: '0,9' });

  assert.equal(run.facts.outcome, 'candidate_success');
  assert.equal(run.facts.candidate_exit_code, '0');
  assert.equal(run.facts.recovery_exit_code, 'not_run');
  assert.equal(run.records.length, 1);
});

  await t.test('verified pre-launch failure retains the original exit and skips recovery', () => {
  const fixture = makeFixture();
  const missingNode = join(fixture.root, 'missing node with spaces');
  const run = runFixture(fixture, {
    node: missingNode,
    launchObserved: 'no',
    runtimeState: 'unchanged',
  });

  assert.equal(run.facts.outcome, 'candidate_failed_prelaunch_unchanged');
  assert.equal(run.facts.candidate_exit_code, '127');
  assert.equal(run.facts.recovery_invocations, '0');
  assert.equal(run.facts.restart_decision, 'permitted');
  assert.equal(run.facts.driver_rc, '127');
  assert.equal(run.records.length, 0);
});

  await t.test('a launched child returning 127 is not treated as a pre-launch failure', () => {
  const fixture = makeFixture();
  const run = runFixture(fixture, {
    exitCodes: '127,0',
    launchObserved: 'yes',
    runtimeState: 'unknown',
    recoveryAcceptance: 'accepted',
  });

  assert.equal(run.facts.candidate_exit_code, '127');
  assert.equal(run.facts.recovery_invocations, '1');
  assert.equal(run.facts.recovery_exit_code, '0');
  assert.equal(run.facts.restart_decision, 'permitted');
  assert.equal(run.facts.driver_rc, '127');
  assert.equal(run.records.length, 2);
  assertInvocation(run.records, 0, fixture, fixture.candidate, run.pathValue);
  assertInvocation(run.records, 1, fixture, fixture.rollback, run.pathValue);
});

  await t.test('started-install failure allows exactly one accepted recovery without candidate retry', () => {
  const fixture = makeFixture();
  const run = runFixture(fixture, {
    exitCodes: '1,0',
    launchObserved: 'yes',
    runtimeState: 'changed',
    recoveryAcceptance: 'accepted',
  });

  assert.equal(run.facts.outcome, 'candidate_failed_recovery_succeeded');
  assert.equal(run.facts.candidate_exit_code, '1');
  assert.equal(run.facts.recovery_invocations, '1');
  assert.equal(run.facts.restart_decision, 'permitted');
  assert.equal(run.facts.driver_rc, '1');
  assert.equal(run.records.length, 2);
  assert.equal(run.records.filter((entry) => entry.argv[2] === fixture.candidate).length, 1);
  assert.equal(run.records.filter((entry) => entry.argv[2] === fixture.rollback).length, 1);
});

  await t.test('failed recovery blocks restart and never retries recovery', () => {
  const fixture = makeFixture();
  const run = runFixture(fixture, {
    exitCodes: '1,9',
    launchObserved: 'yes',
    runtimeState: 'changed',
    recoveryAcceptance: 'accepted',
  });

  assert.equal(run.facts.outcome, 'candidate_failed_recovery_blocked');
  assert.equal(run.facts.recovery_exit_code, '9');
  assert.equal(run.facts.recovery_invocations, '1');
  assert.equal(run.facts.restart_decision, 'blocked');
  assert.equal(run.records.length, 2);
});

  await t.test('failed recovery acceptance and unexplained drift keep the step stopped', () => {
  const fixture = makeFixture();
  const run = runFixture(fixture, {
    exitCodes: '1,0',
    launchObserved: 'no',
    runtimeState: 'changed',
    recoveryAcceptance: 'rejected',
  });

  assert.equal(run.facts.outcome, 'candidate_failed_recovery_blocked');
  assert.equal(run.facts.recovery_exit_code, '0');
  assert.equal(run.facts.recovery_acceptance, 'rejected');
  assert.equal(run.facts.restart_decision, 'blocked');
  assert.equal(run.facts.status, 'STOPPED');
  assert.equal(run.records.length, 2);
});

  await t.test('direct execution refuses before invoking a child', () => {
  const fixture = makeFixture();
  const result = spawnSync('/bin/bash', [helperPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      FIXTURE_RECORD_PATH: fixture.record,
      FIXTURE_EXIT_CODES: '0',
    },
  });

  assert.equal(result.status, 64);
  assert.match(result.stderr, /direct execution refused/);
  assert.equal(existsSync(fixture.record), false);
});

  await t.test('tested helper has a stable content hash', () => {
  const helperHash = createHash('sha256').update(readFileSync(helperPath)).digest('hex');
  assert.match(helperHash, /^[0-9a-f]{64}$/);
  console.log(`helper_sha256=${helperHash}`);
});
});
