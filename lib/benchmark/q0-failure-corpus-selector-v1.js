import { createHash } from 'node:crypto';

import {
  adaptQ0TriggerFailuresFromV2B5Jsonl,
} from './q0-trigger-failure-adapter-v1.js';

export const Q0_FAILURE_EVALUATION_CORPUS_V1_SCHEMA =
  'memory_engine_q0_failure_evaluation_corpus_v1';
export const Q0_FAILURE_EVALUATION_CORPUS_VERSION = 'v1';
export const Q0_E2C_SELECTOR_SALT = 'q0-e2c-selector-v1';
export const Q0_RANK_TARGET = 19;
export const Q0_RANK_SOURCE_COUNT = 248;
export const Q0_TRIGGER_FAILURE_COUNT = 21;
export const Q0_LONGMEMEVAL_DATASET_SHA256 =
  'd6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442';
export const Q0_TRIGGER_SOURCE_ID_SET_SHA256 =
  '22d053bb64aa1275a410730ad5bff91f8113efe33f09521e2d81797d3a5d235e';
export const Q0_RANK_SOURCE_ID_SET_SHA256 =
  'f11c6034ab89f9b4796ec66144e9a130bb324977381d4c0f1e6cd49e6a45f8cf';
export const Q0_SELECTED_RANK_ID_SET_SHA256 =
  '003e0adbb1a0c6434fecb9b4366aed188826e222e25d764c64c1b16e39654bbf';
export const Q0_COMBINED_ID_SET_SHA256 =
  'b91990e6a60cec6f0a6cdebb3a80a999d79edfdf198c3b3ea57c6611c48d5bb5';

export const Q0_RANK_FAMILIES = Object.freeze([
  'knowledge-update',
  'multi-session',
  'single-session-assistant',
  'single-session-preference',
  'single-session-user',
  'temporal-reasoning',
]);

export const Q0_RANK_FAMILY_POPULATION = Object.freeze({
  'knowledge-update': 21,
  'multi-session': 93,
  'single-session-assistant': 4,
  'single-session-preference': 23,
  'single-session-user': 11,
  'temporal-reasoning': 96,
});

export const Q0_RANK_FAMILY_QUOTAS = Object.freeze({
  'knowledge-update': 2,
  'multi-session': 6,
  'single-session-assistant': 1,
  'single-session-preference': 2,
  'single-session-user': 2,
  'temporal-reasoning': 6,
});

const RANK_SOURCE_SCHEMA = 'memory_engine_q0_longmemeval_rank_failure_manifest_v1';
const RANK_SOURCE_FAMILY_PREFIX = 'question_type:';
const TRIGGER_SOURCE_FIXTURE = 'auto-recall-policy-holdout.v2b5';
const CORPUS_SELECTION_METHOD =
  'coverage_first_largest_remainder_then_salted_sha256';

const FORBIDDEN_PAYLOAD_FIELDS = new Set([
  'prompt',
  'question',
  'answer',
  'transcript',
  'session',
  'session_contents',
  'memory',
  'memory_text',
  'retrieved_session_ids',
  'tool_result',
  'embedding',
  'content',
]);

const uniqueSorted = (values) => [...new Set(values)].sort();

const isRecord = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
);

const isBoundedString = (value, maxLength = 256) => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= maxLength
  && !/[\u0000-\u001f\u007f]/u.test(value)
);

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

export function sha256SortedIdSet(ids, { trailingNewline = false } = {}) {
  const sorted = [...ids].sort();
  const payload = sorted.join('\n') + (trailingNewline && sorted.length > 0 ? '\n' : '');
  return sha256(payload);
}

const selectionHashForId = (caseId) => sha256(`${Q0_E2C_SELECTOR_SALT}\0${caseId}`);

const errorResult = (errors, extra = {}) => ({
  valid: errors.length === 0,
  errors: uniqueSorted(errors),
  ...extra,
});

const validateNoForbiddenFields = (value, path, errors) => {
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PAYLOAD_FIELDS.has(key.toLowerCase())) {
      errors.push(`FORBIDDEN_PAYLOAD_FIELD:${path}.${key}`);
      continue;
    }
    validateNoForbiddenFields(child, `${path}.${key}`, errors);
  }
};

const validateRankSourceCase = (item, index, seenIds, errors) => {
  const path = `cases[${index}]`;
  if (!isRecord(item)) {
    errors.push(`INVALID_CASE_OBJECT:${path}`);
    return null;
  }

  const allowedKeys = new Set(['case_id', 'source_ref', 'case_ref', 'diagnostics']);
  for (const key of Object.keys(item)) {
    if (!allowedKeys.has(key)) errors.push(`INVALID_CASE_FIELD:${path}.${key}`);
  }

  if (!isBoundedString(item.case_id, 160)) {
    errors.push(`INVALID_CASE_ID:${path}`);
  } else if (seenIds.has(item.case_id)) {
    errors.push(`DUPLICATE_CASE_ID:${item.case_id}`);
  } else {
    seenIds.add(item.case_id);
  }

  if (!isBoundedString(item.source_ref, 256)) errors.push(`INVALID_SOURCE_REF:${path}`);

  const family = typeof item.case_ref === 'string'
    && item.case_ref.startsWith(RANK_SOURCE_FAMILY_PREFIX)
    ? item.case_ref.slice(RANK_SOURCE_FAMILY_PREFIX.length)
    : null;
  if (!family || !Q0_RANK_FAMILIES.includes(family)) {
    errors.push(`INVALID_CASE_FAMILY:${path}`);
  }

  if (!isRecord(item.diagnostics)
    || Object.keys(item.diagnostics).some(key => key !== 'evidence_count')) {
    errors.push(`INVALID_DIAGNOSTICS:${path}`);
  }
  if (!Number.isInteger(item.diagnostics?.evidence_count)
    || item.diagnostics.evidence_count < 1) {
    errors.push(`INVALID_EVIDENCE_COUNT:${path}`);
  }

  validateNoForbiddenFields(item, path, errors);
  return family;
};

export function validateQ0RankMissSourceManifest(manifest) {
  const errors = [];
  if (!isRecord(manifest)) return errorResult(['INVALID_RANK_SOURCE_MANIFEST']);
  if (manifest.schema !== RANK_SOURCE_SCHEMA) errors.push('INVALID_RANK_SOURCE_SCHEMA');
  if (manifest.rank_miss_count !== Q0_RANK_SOURCE_COUNT) {
    errors.push('RANK_SOURCE_COUNT_MISMATCH');
  }
  if (!Array.isArray(manifest.cases)) {
    errors.push('INVALID_RANK_SOURCE_CASES');
    return errorResult(errors, { count: 0, family_population: {}, id_set_sha256: null });
  }
  if (manifest.cases.length !== Q0_RANK_SOURCE_COUNT) errors.push('RANK_SOURCE_CASES_LENGTH_MISMATCH');

  const allowedTopLevel = new Set(['schema', 'rank_miss_count', 'cases']);
  for (const key of Object.keys(manifest)) {
    if (!allowedTopLevel.has(key)) errors.push(`INVALID_RANK_SOURCE_FIELD:${key}`);
  }

  const seenIds = new Set();
  const familyPopulation = Object.fromEntries(Q0_RANK_FAMILIES.map(family => [family, 0]));
  for (const [index, item] of manifest.cases.entries()) {
    const family = validateRankSourceCase(item, index, seenIds, errors);
    if (family && familyPopulation[family] !== undefined) familyPopulation[family] += 1;
  }

  for (const family of Q0_RANK_FAMILIES) {
    if (familyPopulation[family] !== Q0_RANK_FAMILY_POPULATION[family]) {
      errors.push(`RANK_FAMILY_POPULATION_MISMATCH:${family}`);
    }
  }

  const ids = manifest.cases.map(item => item?.case_id).filter(value => typeof value === 'string');
  const idSetSha256 = sha256SortedIdSet(ids);
  if (idSetSha256 !== Q0_RANK_SOURCE_ID_SET_SHA256) errors.push('RANK_SOURCE_ID_SET_MISMATCH');

  return {
    ...errorResult(errors),
    count: manifest.cases.length,
    unique_id_count: seenIds.size,
    family_population: familyPopulation,
    id_set_sha256: idSetSha256,
  };
}

export function allocateCoverageFirstLargestRemainder(
  familyPopulation,
  target = Q0_RANK_TARGET,
) {
  if (!isRecord(familyPopulation)) throw new Error('INVALID_FAMILY_POPULATION');
  if (!Number.isInteger(target) || target < 1) throw new Error('INVALID_RANK_TARGET');

  const families = Object.keys(familyPopulation).filter(
    family => Number.isInteger(familyPopulation[family]) && familyPopulation[family] > 0,
  ).sort();
  if (families.length === 0 || target < families.length) {
    throw new Error('INVALID_RANK_ALLOCATION');
  }

  const total = families.reduce((sum, family) => sum + familyPopulation[family], 0);
  const quotas = Object.fromEntries(families.map(family => [family, 1]));
  const extraSlots = target - families.length;
  const extras = families.map(family => {
    const numerator = extraSlots * familyPopulation[family];
    const floor = Math.floor(numerator / total);
    quotas[family] += floor;
    return { family, floor, remainder: numerator % total };
  });
  const allocatedExtras = extras.reduce((sum, item) => sum + item.floor, 0);
  const leftover = extraSlots - allocatedExtras;
  extras.sort((left, right) => (
    right.remainder - left.remainder || left.family.localeCompare(right.family)
  ));
  for (let index = 0; index < leftover; index += 1) quotas[extras[index].family] += 1;

  return Object.freeze(Object.fromEntries(
    families.map(family => [family, quotas[family]]),
  ));
}

export function selectQ0RankMissCases(manifest) {
  const validation = validateQ0RankMissSourceManifest(manifest);
  if (!validation.valid) return errorResult(validation.errors, { selected_cases: [], quotas: {} });

  let quotas;
  try {
    quotas = allocateCoverageFirstLargestRemainder(validation.family_population, Q0_RANK_TARGET);
  } catch (error) {
    return errorResult(['RANK_ALLOCATION_FAILED'], { selected_cases: [], quotas: {} });
  }

  const selectedCases = [];
  for (const family of Q0_RANK_FAMILIES) {
    const candidates = manifest.cases
      .filter(item => item.case_ref === RANK_SOURCE_FAMILY_PREFIX + family)
      .map(item => ({
        case_id: item.case_id,
        source_ref: item.source_ref,
        case_ref: item.case_ref,
        evidence_count: item.diagnostics.evidence_count,
        selection_hash: selectionHashForId(item.case_id),
      }))
      .sort((left, right) => (
        left.selection_hash.localeCompare(right.selection_hash)
        || left.case_id.localeCompare(right.case_id)
      ));
    selectedCases.push(...candidates.slice(0, quotas[family]));
  }

  const selectedIds = selectedCases.map(item => item.case_id);
  const selectedIdSetSha256 = sha256SortedIdSet(selectedIds);
  if (selectedIdSetSha256 !== Q0_SELECTED_RANK_ID_SET_SHA256) {
    return errorResult(['SELECTED_RANK_ID_SET_MISMATCH'], {
      selected_cases: [],
      quotas,
      selected_id_set_sha256: selectedIdSetSha256,
    });
  }

  return {
    valid: true,
    errors: [],
    quotas,
    selected_cases: selectedCases,
    selected_count: selectedCases.length,
    selected_id_set_sha256: selectedIdSetSha256,
  };
}

const projectTriggerEntries = (triggerReport) => {
  if (!triggerReport?.valid
    || triggerReport.source_fixture !== TRIGGER_SOURCE_FIXTURE
    || triggerReport.selected_case_count !== 24
    || triggerReport.q0_cases.length !== 24
    || triggerReport.q0_adjudications.length !== 24) {
    return errorResult(['TRIGGER_SOURCE_CONTRACT_INVALID'], { entries: [] });
  }

  const entries = [];
  for (let index = 0; index < triggerReport.q0_cases.length; index += 1) {
    const q0Case = triggerReport.q0_cases[index];
    const adjudication = triggerReport.q0_adjudications[index];
    if (adjudication.failure_class !== 'TRIGGER_MISS') continue;
    if (adjudication.loss_authority !== 'SCOPED'
      || q0Case.provenance !== 'TARGETED_SYNTHETIC'
      || q0Case.evaluation_scope !== 'TRIGGER_ONLY') {
      return errorResult(['TRIGGER_CASE_AUTHORITY_INVALID'], { entries: [] });
    }
    entries.push({
      case_id: q0Case.case_id,
      provenance: q0Case.provenance,
      evaluation_scope: q0Case.evaluation_scope,
      failure_class: adjudication.failure_class,
      loss_authority: adjudication.loss_authority,
      source_ref: q0Case.source_ref,
      case_ref: q0Case.case_ref,
    });
  }

  const ids = entries.map(item => item.case_id);
  if (entries.length !== Q0_TRIGGER_FAILURE_COUNT) {
    return errorResult(['TRIGGER_FAILURE_COUNT_MISMATCH'], { entries: [] });
  }
  if (new Set(ids).size !== ids.length) return errorResult(['DUPLICATE_TRIGGER_CASE_ID'], { entries: [] });
  const idSetSha256 = sha256SortedIdSet(ids);
  if (idSetSha256 !== Q0_TRIGGER_SOURCE_ID_SET_SHA256) {
    return errorResult(['TRIGGER_SOURCE_ID_SET_MISMATCH'], { entries: [] });
  }
  return { valid: true, errors: [], entries, id_set_sha256: idSetSha256 };
};

const projectRankEntries = (selection) => selection.selected_cases.map(item => ({
  case_id: item.case_id,
  provenance: 'BENCHMARK_DERIVED',
  evaluation_scope: 'RETRIEVAL_FROM_MATERIALIZED_MEMORY',
  failure_class: 'RANK_MISS',
  loss_authority: 'SCOPED',
  source_ref: item.source_ref,
  case_ref: item.case_ref,
  effective_top_k: 3,
  evidence_count: item.evidence_count,
  selection_hash: item.selection_hash,
}));

const hasOnlyBoundedCaseFields = (item) => {
  const allowed = new Set([
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
  return Object.keys(item).every(key => allowed.has(key));
};

const emptyCorpus = (errors) => ({
  schema: Q0_FAILURE_EVALUATION_CORPUS_V1_SCHEMA,
  corpus_version: Q0_FAILURE_EVALUATION_CORPUS_VERSION,
  valid: false,
  errors: uniqueSorted(errors),
  case_count: 0,
  composition: {
    trigger_miss: 0,
    rank_miss: 0,
    write_miss: 0,
    candidate_miss: 0,
    use_miss: 0,
  },
  cases: [],
});

/**
 * Build the frozen, bounded Q0 selection from the committed E2a adapter and
 * the R0 LongMemEval rank-miss manifest. No raw benchmark content is copied.
 */
export function buildQ0FailureEvaluationCorpus({
  triggerSourceContent,
  rankSourceManifest,
} = {}) {
  if (typeof triggerSourceContent !== 'string') return emptyCorpus(['TRIGGER_SOURCE_REQUIRED']);

  let triggerReport;
  try {
    triggerReport = adaptQ0TriggerFailuresFromV2B5Jsonl(triggerSourceContent);
  } catch {
    return emptyCorpus(['TRIGGER_SOURCE_EVALUATION_FAILED']);
  }
  const trigger = projectTriggerEntries(triggerReport);
  if (!trigger.valid) return emptyCorpus(trigger.errors);

  const rankSelection = selectQ0RankMissCases(rankSourceManifest);
  if (!rankSelection.valid) return emptyCorpus(rankSelection.errors);
  const rankEntries = projectRankEntries(rankSelection);
  const cases = [...trigger.entries, ...rankEntries]
    .sort((left, right) => left.case_id.localeCompare(right.case_id));
  const ids = cases.map(item => item.case_id);
  const combinedIdSetSha256 = sha256SortedIdSet(ids, { trailingNewline: true });

  if (cases.length !== 40) return emptyCorpus(['CORPUS_CASE_COUNT_MISMATCH']);
  if (new Set(ids).size !== ids.length) return emptyCorpus(['DUPLICATE_CORPUS_CASE_ID']);
  if (combinedIdSetSha256 !== Q0_COMBINED_ID_SET_SHA256) {
    return emptyCorpus(['COMBINED_ID_SET_MISMATCH']);
  }
  if (cases.some(item => !hasOnlyBoundedCaseFields(item))) {
    return emptyCorpus(['CORPUS_PAYLOAD_BOUNDARY_VIOLATION']);
  }

  return {
    schema: Q0_FAILURE_EVALUATION_CORPUS_V1_SCHEMA,
    corpus_version: Q0_FAILURE_EVALUATION_CORPUS_VERSION,
    valid: true,
    errors: [],
    case_count: cases.length,
    composition: {
      trigger_miss: trigger.entries.length,
      rank_miss: rankEntries.length,
      write_miss: 0,
      candidate_miss: 0,
      use_miss: 0,
    },
    evaluation_only: true,
    prevalence_claim: false,
    selection: {
      method: CORPUS_SELECTION_METHOD,
      salt: Q0_E2C_SELECTOR_SALT,
      rank_target: Q0_RANK_TARGET,
      rank_family_quotas: Q0_RANK_FAMILY_QUOTAS,
    },
    source_authority: {
      trigger_source_fixture: TRIGGER_SOURCE_FIXTURE,
      trigger_source_id_set_sha256: trigger.id_set_sha256,
      longmemeval_dataset_sha256: Q0_LONGMEMEVAL_DATASET_SHA256,
      rank_source_count: Q0_RANK_SOURCE_COUNT,
      rank_source_id_set_sha256: Q0_RANK_SOURCE_ID_SET_SHA256,
      selected_rank_id_set_sha256: rankSelection.selected_id_set_sha256,
      combined_id_set_sha256: combinedIdSetSha256,
      combined_hash_trailing_newline: true,
    },
    cases,
  };
}

export const Q0_FAILURE_CORPUS_SELECTOR_CONTRACT = Object.freeze({
  schema: Q0_FAILURE_EVALUATION_CORPUS_V1_SCHEMA,
  corpus_version: Q0_FAILURE_EVALUATION_CORPUS_VERSION,
  selection_method: CORPUS_SELECTION_METHOD,
  trigger_failure_count: Q0_TRIGGER_FAILURE_COUNT,
  rank_target: Q0_RANK_TARGET,
  rank_family_quotas: Q0_RANK_FAMILY_QUOTAS,
});
