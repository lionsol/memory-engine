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
  const order = join(root, 'callback-order.log');
  mkdirSync(candidate);
  mkdirSync(rollback);
  mkdirSync(cwd);

  writeFileSync(entrypoint, `
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const recordPath = process.env.FIXTURE_RECORD_PATH;
const orderPath = process.env.CALLBACK_ORDER;
const prior = existsSync(recordPath) ? readFileSync(recordPath, 'utf8').trim() : '';
const callIndex = prior ? prior.split('\\n').filter(Boolean).length : 0;
const exitCodes = (process.env.FIXTURE_EXIT_CODES ?? '0').split(',').map((value) => Number(value));
const exitCode = exitCodes[Math.min(callIndex, exitCodes.length - 1)];
const packagePath = process.argv[4] ?? '';
const role = packagePath.includes('rollback') ? 'recovery' : 'candidate';
appendFileSync(orderPath, 'child:' + role + '\\n');
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
export CALLBACK_ORDER="\${15}"
export FACTS_EXIT_CODES="\${13}"
export ACCEPTANCE_EXIT="\${14}"
export FACTS_LAUNCH_OBSERVED="\${10}"
export FACTS_RUNTIME_STATE="\${11}"
export FACTS_DATA_DRIFT="\${12}"
FACTS_COUNTER="$CALLBACK_ORDER.facts"

facts_callback() {
  printf '%s\\n' facts >> "$CALLBACK_ORDER"
  local count=0
  if [[ -f "$FACTS_COUNTER" ]]; then
    count="$(<"$FACTS_COUNTER")"
  fi
  local first_code="\${FACTS_EXIT_CODES%%,*}"
  local last_code="$first_code"
  if [[ "$FACTS_EXIT_CODES" == *,* ]]; then
    last_code="\${FACTS_EXIT_CODES##*,}"
  fi
  local first_drift="\${FACTS_DATA_DRIFT%%,*}"
  local last_drift="$first_drift"
  if [[ "$FACTS_DATA_DRIFT" == *,* ]]; then
    last_drift="\${FACTS_DATA_DRIFT##*,}"
  fi
  local code="$first_code"
  local drift="$first_drift"
  if [[ "$count" != 0 ]]; then
    code="$last_code"
    drift="$last_drift"
  fi
  printf '%s' "$((count + 1))" > "$FACTS_COUNTER"
  if [[ "$code" != 0 ]]; then
    return "$code"
  fi
  printf 'launch_observed=%s\\n' "$FACTS_LAUNCH_OBSERVED"
  printf 'runtime_state=%s\\n' "$FACTS_RUNTIME_STATE"
  printf 'data_drift=%s\\n' "$drift"
}

recovery_acceptance_callback() {
  printf '%s\\n' acceptance >> "$CALLBACK_ORDER"
  return "$ACCEPTANCE_EXIT"
}

if autorecall_install_step "$8" "$9" facts_callback "\${16}"; then
  rc=0
else
  rc=$?
fi
printf 'driver_rc=%s\\n' "$rc"
exit 0
`);

  return { root, candidate, rollback, cwd, entrypoint, driver, record, order };
}

function readLines(path) {
  return existsSync(path)
    ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean)
    : [];
}

function runFixture(fixture, {
  node = nodePath,
  cwd = fixture.cwd,
  exitCodes = '0',
  launchObserved = 'yes',
  runtimeState = 'unchanged',
  dataDrift = 'none',
  factsExitCodes = '0',
  acceptanceExit = 0,
  acceptanceCallback = 'recovery_acceptance_callback',
} = {}) {
  const pathValue = 'C:\\Program Files\\dotnet:/mnt/c/Program Files/node:/tmp/path with spaces';
  const result = spawnSync('/bin/bash', [
    fixture.driver,
    helperPath,
    node,
    fixture.entrypoint,
    cwd,
    pathValue,
    fixture.record,
    exitCodes,
    fixture.candidate,
    fixture.rollback,
    launchObserved,
    runtimeState,
    dataDrift,
    factsExitCodes,
    String(acceptanceExit),
    fixture.order,
    acceptanceCallback,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message);
  const facts = Object.fromEntries(result.stdout.trim().split('\n').filter(Boolean).map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  const records = readLines(fixture.record).map((line) => JSON.parse(line));
  return { result, facts, records, order: readLines(fixture.order), pathValue };
}

function assertInvocation(records, index, fixture, packageDir, pathValue) {
  assert.deepEqual(records[index], {
    argv: ['plugins', 'install', packageDir, '--force'],
    cwd: fixture.cwd,
    path: pathValue,
  });
}

test('offline install-step subprocess contract', async (t) => {
  await t.test('collects facts after the child and preserves exact launcher boundaries', () => {
    const fixture = makeFixture();
    const run = runFixture(fixture, { exitCodes: '0' });

    assert.equal(run.facts.driver_rc, '0');
    assert.equal(run.facts.candidate_invocations, '1');
    assert.equal(run.facts.recovery_invocations, '0');
    assert.equal(run.facts.candidate_facts_status, 'ok');
    assert.equal(run.facts.restart_decision, 'permitted');
    assert.deepEqual(run.order, ['child:candidate', 'facts']);
    assertInvocation(run.records, 0, fixture, fixture.candidate, run.pathValue);
  });

  await t.test('candidate success performs no recovery or acceptance callback', () => {
    const fixture = makeFixture();
    const run = runFixture(fixture, { exitCodes: '0,9' });

    assert.equal(run.facts.outcome, 'candidate_success');
    assert.equal(run.facts.candidate_exit_code, '0');
    assert.equal(run.facts.recovery_acceptance, 'not_run');
    assert.equal(run.records.length, 1);
    assert.deepEqual(run.order, ['child:candidate', 'facts']);
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
    assert.deepEqual(run.records, []);
    assert.deepEqual(run.order, ['facts']);
  });

  await t.test('a launched child returning 127 is not treated as pre-launch failure', () => {
    const fixture = makeFixture();
    const run = runFixture(fixture, {
      exitCodes: '127,0',
      launchObserved: 'yes',
      runtimeState: 'unknown',
      factsExitCodes: '0,0',
    });

    assert.equal(run.facts.candidate_exit_code, '127');
    assert.equal(run.facts.recovery_invocations, '1');
    assert.equal(run.facts.recovery_exit_code, '0');
    assert.equal(run.facts.restart_decision, 'permitted');
    assert.equal(run.facts.driver_rc, '127');
    assert.deepEqual(run.order, ['child:candidate', 'facts', 'child:recovery', 'facts', 'acceptance']);
    assertInvocation(run.records, 0, fixture, fixture.candidate, run.pathValue);
    assertInvocation(run.records, 1, fixture, fixture.rollback, run.pathValue);
  });

  await t.test('started-install failure allows one accepted recovery without candidate retry', () => {
    const fixture = makeFixture();
    const run = runFixture(fixture, {
      exitCodes: '1,0',
      launchObserved: 'yes',
      runtimeState: 'changed',
    });

    assert.equal(run.facts.outcome, 'candidate_failed_recovery_succeeded');
    assert.equal(run.facts.candidate_exit_code, '1');
    assert.equal(run.facts.recovery_invocations, '1');
    assert.equal(run.facts.recovery_acceptance, 'accepted');
    assert.equal(run.facts.restart_decision, 'permitted');
    assert.equal(run.facts.driver_rc, '1');
    assert.deepEqual(run.order, ['child:candidate', 'facts', 'child:recovery', 'facts', 'acceptance']);
    assert.equal(run.records.filter((entry) => entry.argv[2] === fixture.candidate).length, 1);
    assert.equal(run.records.filter((entry) => entry.argv[2] === fixture.rollback).length, 1);
  });

  await t.test('facts callback failure triggers recovery, then acceptance, without retry', () => {
    const fixture = makeFixture();
    const run = runFixture(fixture, {
      exitCodes: '1,0',
      factsExitCodes: '7,0',
      launchObserved: 'yes',
      runtimeState: 'changed',
    });

    assert.equal(run.facts.candidate_facts_status, 'failed:64');
    assert.equal(run.facts.recovery_facts_status, 'ok');
    assert.equal(run.facts.recovery_acceptance, 'accepted');
    assert.equal(run.facts.restart_decision, 'permitted');
    assert.equal(run.facts.driver_rc, '1');
    assert.deepEqual(run.order, ['child:candidate', 'facts', 'child:recovery', 'facts', 'acceptance']);
    assert.equal(run.records.length, 2);
  });

  await t.test('failed recovery acceptance blocks restart and runs only once', () => {
    const fixture = makeFixture();
    const run = runFixture(fixture, {
      exitCodes: '1,9',
      launchObserved: 'yes',
      runtimeState: 'changed',
      acceptanceExit: 9,
    });

    assert.equal(run.facts.outcome, 'candidate_failed_recovery_blocked');
    assert.equal(run.facts.recovery_exit_code, '9');
    assert.equal(run.facts.recovery_acceptance, 'rejected');
    assert.equal(run.facts.recovery_invocations, '1');
    assert.equal(run.facts.restart_decision, 'blocked');
    assert.equal(run.facts.driver_rc, '1');
    assert.deepEqual(run.order, ['child:candidate', 'facts', 'child:recovery', 'facts', 'acceptance']);
    assert.equal(run.records.length, 2);
  });

  await t.test('unexplained data drift blocks restart even after accepted recovery', () => {
    const fixture = makeFixture();
    const run = runFixture(fixture, {
      exitCodes: '1,0',
      launchObserved: 'yes',
      runtimeState: 'changed',
      dataDrift: 'unexplained',
    });

    assert.equal(run.facts.recovery_acceptance, 'accepted');
    assert.equal(run.facts.recovery_data_drift, 'unexplained');
    assert.equal(run.facts.restart_decision, 'blocked');
    assert.equal(run.facts.status, 'STOPPED');
    assert.deepEqual(run.order, ['child:candidate', 'facts', 'child:recovery', 'facts', 'acceptance']);
  });

  await t.test('candidate unexplained drift remains blocked after clean accepted recovery', () => {
    const fixture = makeFixture();
    const run = runFixture(fixture, {
      exitCodes: '1,0',
      launchObserved: 'yes',
      runtimeState: 'changed',
      dataDrift: 'unexplained,none',
    });

    assert.equal(run.facts.candidate_data_drift, 'unexplained');
    assert.equal(run.facts.recovery_data_drift, 'none');
    assert.equal(run.facts.recovery_acceptance, 'accepted');
    assert.equal(run.facts.outcome, 'candidate_unexplained_drift');
    assert.equal(run.facts.status, 'STOPPED');
    assert.equal(run.facts.restart_decision, 'blocked');
    assert.equal(run.facts.driver_rc, '1');
    assert.deepEqual(run.order, ['child:candidate', 'facts', 'child:recovery', 'facts', 'acceptance']);
  });

  await t.test('validation failure in an if context exits explicitly before any child', () => {
    const fixture = makeFixture();
    const run = runFixture(fixture, { acceptanceCallback: 'missing_acceptance_callback' });

    assert.equal(run.facts.outcome, 'validation_failed');
    assert.equal(run.facts.candidate_invocations, '0');
    assert.equal(run.facts.driver_rc, '64');
    assert.deepEqual(run.records, []);
    assert.deepEqual(run.order, []);
  });

  await t.test('cd failure in an if context exits explicitly before any child', () => {
    const fixture = makeFixture();
    const run = runFixture(fixture, { cwd: join(fixture.root, 'missing cwd with spaces') });

    assert.equal(run.facts.outcome, 'candidate_cd_failed');
    assert.equal(run.facts.candidate_invocations, '0');
    assert.equal(run.facts.recovery_invocations, '0');
    assert.equal(run.facts.driver_rc, '64');
    assert.deepEqual(run.records, []);
    assert.deepEqual(run.order, []);
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
