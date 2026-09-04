import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  adaptQ0TriggerFailuresFromV2B5Jsonl,
} from '../lib/benchmark/q0-trigger-failure-adapter-v1.js';
import {
  Q0_COMBINED_ID_SET_SHA256,
  Q0_E2C_SELECTOR_SALT,
  Q0_FAILURE_EVALUATION_CORPUS_V1_SCHEMA,
  Q0_RANK_FAMILY_POPULATION,
  Q0_RANK_FAMILY_QUOTAS,
  Q0_RANK_SOURCE_COUNT,
  Q0_RANK_SOURCE_ID_SET_SHA256,
  Q0_RANK_TARGET,
  Q0_SELECTED_RANK_ID_SET_SHA256,
  Q0_TRIGGER_FAILURE_COUNT,
  Q0_TRIGGER_SOURCE_ID_SET_SHA256,
  allocateCoverageFirstLargestRemainder,
  buildQ0FailureEvaluationCorpus,
  selectQ0RankMissCases,
  sha256SortedIdSet,
  validateQ0RankMissSourceManifest,
} from '../lib/benchmark/q0-failure-corpus-selector-v1.js';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const rankSourcePath = resolve(repoRoot, 'test/fixtures/q0-longmemeval-rank-miss-source.v1.json');
const corpusPath = resolve(repoRoot, 'test/fixtures/q0-failure-evaluation-corpus.v1.json');
const triggerSourcePath = resolve(
  repoRoot,
  'test/fixtures/auto-recall-policy-holdout.v2b5.jsonl',
);

const readRankSource = () => JSON.parse(readFileSync(rankSourcePath, 'utf8'));
const readCorpus = () => JSON.parse(readFileSync(corpusPath, 'utf8'));
const readTriggerSource = () => readFileSync(triggerSourcePath, 'utf8');

const buildCorpus = (rankSource = readRankSource()) => buildQ0FailureEvaluationCorpus({
  triggerSourceContent: readTriggerSource(),
  rankSourceManifest: rankSource,
});

const triggerFailureIds = () => {
  const report = adaptQ0TriggerFailuresFromV2B5Jsonl(readTriggerSource());
  return report.q0_adjudications
    .map((adjudication, index) => (
      adjudication.failure_class === 'TRIGGER_MISS' ? report.q0_cases[index].case_id : null
    ))
    .filter(Boolean)
    .sort();
};

const hasForbiddenPayloadKey = (value) => {
  const forbidden = new Set([
    'prompt',
    'question',
    'answer',
    'transcript',
    'session_contents',
    'memory',
    'memory_text',
    'retrieved_session_ids',
    'tool_result',
    'embedding',
    'content',
  ]);
  if (Array.isArray(value)) return value.some(hasForbiddenPayloadKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => (
    forbidden.has(key.toLowerCase()) || hasForbiddenPayloadKey(child)
  ));
};

test('validates the frozen 248-case rank source and all six populations', () => {
  const source = readRankSource();
  const validation = validateQ0RankMissSourceManifest(source);

  assert.equal(validation.valid, true);
  assert.equal(validation.count, Q0_RANK_SOURCE_COUNT);
  assert.equal(validation.unique_id_count, Q0_RANK_SOURCE_COUNT);
  assert.deepEqual(validation.family_population, Q0_RANK_FAMILY_POPULATION);
  assert.equal(validation.id_set_sha256, Q0_RANK_SOURCE_ID_SET_SHA256);
});

test('coverage-first largest-remainder allocation produces the frozen quotas', () => {
  const quotas = allocateCoverageFirstLargestRemainder(
    Q0_RANK_FAMILY_POPULATION,
    Q0_RANK_TARGET,
  );

  assert.deepEqual(quotas, Q0_RANK_FAMILY_QUOTAS);
  assert.equal(Object.values(quotas).reduce((sum, value) => sum + value, 0), Q0_RANK_TARGET);
  assert.equal(Object.values(quotas).every(value => value >= 1), true);
});

test('salted selection is independent of source manifest order', () => {
  const source = readRankSource();
  const selection = selectQ0RankMissCases(source);
  const reversed = selectQ0RankMissCases({
    ...source,
    cases: [...source.cases].reverse(),
  });

  assert.equal(selection.valid, true);
  assert.equal(reversed.valid, true);
  assert.deepEqual(
    selection.selected_cases.map(item => item.case_id).sort(),
    reversed.selected_cases.map(item => item.case_id).sort(),
  );
  assert.equal(selection.selected_count, Q0_RANK_TARGET);
  assert.equal(selection.selected_id_set_sha256, Q0_SELECTED_RANK_ID_SET_SHA256);
  assert.equal(selection.selected_cases.every(item => (
    item.selection_hash === createHash('sha256')
      .update(`${Q0_E2C_SELECTOR_SALT}\0${item.case_id}`)
      .digest('hex')
  )), true);
});

test('selected rank evidence counts preserve the frozen observational distribution', () => {
  const selection = selectQ0RankMissCases(readRankSource());
  const distribution = {};
  for (const item of selection.selected_cases) {
    const key = String(item.evidence_count);
    distribution[key] = (distribution[key] || 0) + 1;
  }

  assert.deepEqual(distribution, { '1': 6, '2': 12, '3': 1 });
});

test('the committed trigger adapter produces exactly 21 scoped trigger misses', () => {
  const report = adaptQ0TriggerFailuresFromV2B5Jsonl(readTriggerSource());
  const ids = triggerFailureIds();

  assert.equal(report.valid, true);
  assert.equal(report.selected_case_count, 24);
  assert.equal(report.trigger_fail_count, Q0_TRIGGER_FAILURE_COUNT);
  assert.equal(report.q0_aggregate.counts.failure_class.TRIGGER_MISS, 21);
  assert.equal(ids.length, Q0_TRIGGER_FAILURE_COUNT);
  assert.equal(sha256SortedIdSet(ids), Q0_TRIGGER_SOURCE_ID_SET_SHA256);
});

test('builds the exact 40-case evaluation-only composition and authority', () => {
  const corpus = buildCorpus();

  assert.equal(corpus.valid, true);
  assert.equal(corpus.schema, Q0_FAILURE_EVALUATION_CORPUS_V1_SCHEMA);
  assert.equal(corpus.case_count, 40);
  assert.deepEqual(corpus.composition, {
    trigger_miss: 21,
    rank_miss: 19,
    write_miss: 0,
    candidate_miss: 0,
    use_miss: 0,
  });
  assert.equal(corpus.evaluation_only, true);
  assert.equal(corpus.prevalence_claim, false);
  assert.equal(corpus.source_authority.combined_id_set_sha256, Q0_COMBINED_ID_SET_SHA256);
  assert.equal(corpus.source_authority.selected_rank_id_set_sha256, Q0_SELECTED_RANK_ID_SET_SHA256);
  assert.equal(corpus.cases.filter(item => item.failure_class === 'TRIGGER_MISS').length, 21);
  assert.equal(corpus.cases.filter(item => item.failure_class === 'RANK_MISS').length, 19);
  assert.equal(corpus.cases.every(item => item.loss_authority === 'SCOPED'), true);
  assert.equal(corpus.cases.some(item => item.provenance === 'PRODUCTION_OBSERVED'), false);
});

test('final corpus fixture reproduces the selector output and combined ID hash', () => {
  const corpus = buildCorpus();
  const fixture = readCorpus();

  assert.deepEqual(fixture, corpus);
  assert.equal(
    sha256SortedIdSet(corpus.cases.map(item => item.case_id), { trailingNewline: true }),
    Q0_COMBINED_ID_SET_SHA256,
  );
  assert.equal(new Set(corpus.cases.map(item => item.case_id)).size, 40);
});

test('input order changes do not change the frozen corpus', () => {
  const source = readRankSource();
  const shuffled = {
    ...source,
    cases: [...source.cases].slice().sort((left, right) => (
      right.case_id.localeCompare(left.case_id)
    )),
  };

  assert.deepEqual(buildCorpus(shuffled), buildCorpus(source));
});

test('corrupt family, duplicate ID, or evidence count fails closed', () => {
  const source = readRankSource();
  const badFamily = structuredClone(source);
  badFamily.cases[0].case_ref = 'question_type:unknown';
  const duplicate = structuredClone(source);
  duplicate.cases[1].case_id = duplicate.cases[0].case_id;
  const badEvidence = structuredClone(source);
  badEvidence.cases[0].diagnostics.evidence_count = 0;

  assert.equal(validateQ0RankMissSourceManifest(badFamily).valid, false);
  assert.equal(validateQ0RankMissSourceManifest(duplicate).valid, false);
  assert.equal(validateQ0RankMissSourceManifest(badEvidence).valid, false);
  assert.equal(buildCorpus(badFamily).valid, false);
});

test('rank source rejects raw-content payload fields', () => {
  const source = readRankSource();
  const corrupted = structuredClone(source);
  corrupted.cases[0].question = 'must not be copied';
  const validation = validateQ0RankMissSourceManifest(corrupted);

  assert.equal(validation.valid, false);
  assert.equal(validation.errors.some(error => error.startsWith('FORBIDDEN_PAYLOAD_FIELD:')), true);
  assert.equal(hasForbiddenPayloadKey(corrupted), true);
});

test('every corpus entry is bounded metadata without raw benchmark payload', () => {
  const corpus = readCorpus();
  const allowedFields = new Set([
    'case_id',
    'provenance',
    'evaluation_scope',
    'failure_class',
    'loss_authority',
    'source_ref',
    'case_ref',
    'effective_top_k',
    'evidence_count',
    'selection_hash',
  ]);

  assert.equal(hasForbiddenPayloadKey(corpus.cases), false);
  assert.equal(corpus.cases.every(item => Object.keys(item).every(key => allowedFields.has(key))), true);
  assert.equal(corpus.cases.every(item => (
    item.provenance === 'TARGETED_SYNTHETIC'
      || item.provenance === 'BENCHMARK_DERIVED'
  )), true);
});

test('corpus metadata records the intentional non-prevalence interpretation boundary', () => {
  const corpus = readCorpus();

  assert.equal(corpus.selection.method, 'coverage_first_largest_remainder_then_salted_sha256');
  assert.equal(corpus.selection.salt, Q0_E2C_SELECTOR_SALT);
  assert.equal(corpus.selection.rank_target, 19);
  assert.deepEqual(corpus.selection.rank_family_quotas, Q0_RANK_FAMILY_QUOTAS);
  assert.equal(corpus.evaluation_only, true);
  assert.equal(corpus.prevalence_claim, false);
});
