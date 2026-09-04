import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Q0_TRIGGER_FAILURE_ADAPTER_V1_SCHEMA,
  adaptQ0TriggerFailuresFromV2B5Jsonl,
  adaptQ0TriggerFailuresFromV2B5Rows,
} from '../lib/benchmark/q0-trigger-failure-adapter-v1.js';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixturePath = resolve(repoRoot, 'test/fixtures/auto-recall-policy-holdout.v2b5.jsonl');

const fixtureContent = () => readFileSync(fixturePath, 'utf8');
const fixtureRows = () => fixtureContent().trim().split(/\r?\n/u).map(line => JSON.parse(line));

const frozenReport = () => adaptQ0TriggerFailuresFromV2B5Jsonl(fixtureContent());

test('adapts exactly the 24 expected-recall rows from the frozen source', () => {
  const report = frozenReport();

  assert.equal(report.schema, Q0_TRIGGER_FAILURE_ADAPTER_V1_SCHEMA);
  assert.equal(report.valid, true);
  assert.equal(report.errors.length, 0);
  assert.equal(report.source_fixture, 'auto-recall-policy-holdout.v2b5');
  assert.deepEqual(report.source_contract, {
    total: 48,
    expected_recall_yes: 24,
    expected_recall_no: 24,
  });
  assert.equal(report.selected_case_count, 24);
  assert.equal(report.q0_cases.length, 24);
  assert.equal(report.q0_adjudications.length, 24);
});

test('current frozen v2b5 runtime result is 21 trigger failures and 3 passes', () => {
  const report = frozenReport();

  assert.equal(report.trigger_fail_count, 21);
  assert.equal(report.trigger_pass_count, 3);
  assert.equal(report.trigger_unknown_count, 0);
  assert.equal(report.q0_aggregate.counts.failure_class.TRIGGER_MISS, 21);
  assert.equal(report.q0_aggregate.counts.adjudication_status.CLASSIFIED, 21);
  assert.equal(report.q0_aggregate.counts.adjudication_status.NO_LOSS, 3);
});

test('all adapted trigger failures are scoped TRIGGER_MISS cases', () => {
  const report = frozenReport();
  const failed = report.q0_adjudications.filter(result => result.failure_class === 'TRIGGER_MISS');

  assert.equal(failed.length, 21);
  assert.equal(failed.every(result => result.adjudication_status === 'CLASSIFIED'), true);
  assert.equal(failed.every(result => result.loss_authority === 'SCOPED'), true);
  assert.equal(failed.every(result => result.first_loss_stage === 'trigger'), true);
  assert.equal(failed.every(result => result.valid === true), true);
});

test('the three trigger passes remain NO_LOSS without loss authority', () => {
  const report = frozenReport();
  const passes = report.q0_adjudications.filter(result => result.adjudication_status === 'NO_LOSS');

  assert.equal(passes.length, 3);
  assert.equal(passes.every(result => result.failure_class === null), true);
  assert.equal(passes.every(result => result.loss_authority === null), true);
});

test('every adapted case is targeted synthetic trigger-only evidence', () => {
  const report = frozenReport();

  assert.equal(
    report.q0_cases.every(caseItem => caseItem.provenance === 'TARGETED_SYNTHETIC'),
    true,
  );
  assert.equal(
    report.q0_cases.every(caseItem => caseItem.evaluation_scope === 'TRIGGER_ONLY'),
    true,
  );
  assert.equal(report.q0_aggregate.counts.provenance.TARGETED_SYNTHETIC, 24);
  assert.equal(report.q0_aggregate.counts.evaluation_scope.TRIGGER_ONLY, 24);
  assert.equal(
    Object.values(report.q0_aggregate.production_observed_end_to_end_first_loss_distribution)
      .every(count => count === 0),
    true,
  );
});

test('expected-NO rows are excluded from the Q0 case corpus', () => {
  const rows = fixtureRows();
  const expectedNoIds = new Set(
    rows.filter(row => row.expected_should_recall === false).map(row => row.turn_id),
  );
  const report = frozenReport();

  assert.equal(
    report.q0_cases.some(caseItem => expectedNoIds.has(caseItem.case_id.replace(
      'q0e2a-trigger-v2b5-',
      '',
    ))),
    false,
  );
});

test('Q0 cases and report contain no prompt, query, transcript, memory, or tool result', () => {
  const rows = fixtureRows();
  const report = frozenReport();
  const reportText = JSON.stringify(report);
  const forbiddenCaseFields = [
    'prompt',
    'query',
    'transcript',
    'memory_text',
    'tool_result',
  ];

  for (const caseItem of report.q0_cases) {
    for (const field of forbiddenCaseFields) {
      assert.equal(field in caseItem, false, field);
    }
  }
  assert.equal(reportText.includes('"prompt"'), false);
  assert.equal(reportText.includes(rows[0].prompt), false);
});

test('family breakdown totals exactly the selected 24 cases', () => {
  const report = frozenReport();
  const totals = report.family_breakdown.reduce((total, family) => ({
    selected: total.selected + family.selected,
    trigger_fail: total.trigger_fail + family.trigger_fail,
    trigger_pass: total.trigger_pass + family.trigger_pass,
    trigger_unknown: total.trigger_unknown + family.trigger_unknown,
  }), {
    selected: 0,
    trigger_fail: 0,
    trigger_pass: 0,
    trigger_unknown: 0,
  });

  assert.equal(report.family_breakdown.length, 6);
  assert.deepEqual(totals, {
    selected: 24,
    trigger_fail: 21,
    trigger_pass: 3,
    trigger_unknown: 0,
  });
  assert.equal(
    report.family_breakdown.every(family => family.selected === (
      family.trigger_fail + family.trigger_pass + family.trigger_unknown
    )),
    true,
  );
});

test('corrupted frozen source contract fails closed with no classifiable cases', () => {
  const rows = fixtureRows();
  rows[0].expected_should_recall = false;
  const report = adaptQ0TriggerFailuresFromV2B5Rows(rows);

  assert.equal(report.valid, false);
  assert.deepEqual(report.errors, ['SOURCE_V2B5_CONTRACT_INVALID']);
  assert.equal(report.selected_case_count, 0);
  assert.equal(report.q0_cases.length, 0);
  assert.equal(report.q0_adjudications.length, 0);
});

test('invalid source data that prevents a runtime boolean fails closed', () => {
  const rows = fixtureRows();
  rows[0].recall_intent = ['not-a-valid-recall-intent'];
  const report = adaptQ0TriggerFailuresFromV2B5Rows(rows);

  assert.equal(report.valid, false);
  assert.equal(report.errors.includes('SOURCE_V2B5_CONTRACT_INVALID'), true);
  assert.equal(report.selected_case_count, 0);
  assert.equal(report.q0_aggregate.counts.adjudication_status.CLASSIFIED, 0);
});
