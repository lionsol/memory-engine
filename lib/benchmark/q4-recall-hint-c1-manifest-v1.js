import { createHash } from "node:crypto";
import {
  Q4_RECALL_HINT_C1_CORPUS_SCHEMA,
  Q4_RECALL_HINT_C1_CORPUS_VERSION,
} from "./q4-recall-hint-c1-corpus-v1.js";

export const Q4_RECALL_HINT_C1_MANIFEST_SCHEMA = "memory_engine_q4_recall_hint_c1_manifest_v1";
export const Q4_RECALL_HINT_C1_PRODUCER_INPUT_SCHEMA = "memory_engine_q4_recall_hint_producer_input_v1";
export const Q4_RECALL_HINT_C1_SPLIT_SALT = "q4-recall-hint-c1-split-v1";
export const Q4_RECALL_HINT_C1_FAMILIES = Object.freeze([
  "entity_reference",
  "temporal_relation",
  "multi_facet",
  "protection",
]);
export const Q4_RECALL_HINT_C1_CASES_PER_FAMILY = 12;
export const Q4_RECALL_HINT_C1_DEVELOPMENT_PER_FAMILY = 4;
export const Q4_RECALL_HINT_C1_ACCEPTANCE_PER_FAMILY = 8;
export const Q4_RECALL_HINT_C1_FROZEN_IDENTITY = Object.freeze({
  corpus_sha256: "a2718822fe9ed69a1b6b5f750823d066d3702b5199cc98845434a265f6c5b61b",
  development_sha256: "0e310f3c2e887ca4949e703a4fdf17d16de5e6da2170a94efad3d4afc5f63fda",
  acceptance_sha256: "9f43b50b767937ef204fb1751c2e72f5b9a4ef1aaf662d22144729e5c096bd7e",
  manifest_sha256: "0a18b7dadf102df499f6f99f85729179df815fac3113def93bc2792eb508bff2",
});

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function requireString(value, field, maxCodePoints = null) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`q4_c1_${field}_required`);
  const normalized = value.trim();
  if (maxCodePoints !== null && Array.from(normalized).length > maxCodePoints) {
    throw new Error(`q4_c1_${field}_exceeds_bound`);
  }
  return normalized;
}

function requireStringArray(value, field, { min = 0, max = Infinity, itemMaxCodePoints = null } = {}) {
  if (!Array.isArray(value)) throw new Error(`q4_c1_${field}_must_be_array`);
  if (value.length < min || value.length > max) throw new Error(`q4_c1_${field}_count_invalid`);
  const normalized = value.map((item, index) => requireString(
    item,
    `${field}_${index}`,
    itemMaxCodePoints,
  ));
  if (new Set(normalized).size !== normalized.length) throw new Error(`q4_c1_${field}_duplicate`);
  return normalized;
}

function normalizeBoundedContext(value, caseId) {
  if (!isPlainObject(value)) throw new Error(`q4_c1_bounded_context_invalid:${caseId}`);
  const allowed = new Set(["active_project", "recent_entities", "temporal_anchor"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`q4_c1_bounded_context_unknown_field:${caseId}:${key}`);
  }
  const normalized = {};
  if (value.active_project !== undefined) {
    normalized.active_project = requireString(value.active_project, `${caseId}_active_project`, 96);
  }
  if (value.recent_entities !== undefined) {
    normalized.recent_entities = requireStringArray(value.recent_entities, `${caseId}_recent_entities`, {
      max: 4,
      itemMaxCodePoints: 96,
    });
  }
  if (value.temporal_anchor !== undefined) {
    normalized.temporal_anchor = requireString(value.temporal_anchor, `${caseId}_temporal_anchor`, 96);
  }
  return normalized;
}

function normalizeMemoryRecords(value, caseId) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`q4_c1_memory_records_required:${caseId}`);
  return value.map((row, index) => {
    if (!isPlainObject(row)) throw new Error(`q4_c1_memory_record_invalid:${caseId}:${index}`);
    const allowed = new Set(["id", "text"]);
    for (const key of Object.keys(row)) {
      if (!allowed.has(key)) throw new Error(`q4_c1_memory_record_unknown_field:${caseId}:${key}`);
    }
    return {
      id: requireString(row.id, `${caseId}_memory_id_${index}`, 128),
      text: requireString(row.text, `${caseId}_memory_text_${index}`, 800),
    };
  });
}

function normalizeCase(record, index) {
  if (!isPlainObject(record)) throw new Error(`q4_c1_case_invalid:${index}`);
  const allowed = new Set([
    "case_id",
    "family",
    "query",
    "bounded_context",
    "gold_evidence_ids",
    "memory_records",
  ]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`q4_c1_case_unknown_field:${index}:${key}`);
  }
  const caseId = requireString(record.case_id, `case_id_${index}`, 128);
  const family = requireString(record.family, `${caseId}_family`, 64);
  if (!Q4_RECALL_HINT_C1_FAMILIES.includes(family)) throw new Error(`q4_c1_family_invalid:${caseId}`);
  const query = requireString(record.query, `${caseId}_query`, 240);
  const boundedContext = normalizeBoundedContext(record.bounded_context, caseId);
  const goldEvidenceIds = requireStringArray(record.gold_evidence_ids, `${caseId}_gold_evidence_ids`, {
    min: 1,
    max: 3,
    itemMaxCodePoints: 128,
  });
  const memoryRecords = normalizeMemoryRecords(record.memory_records, caseId);
  const localIds = memoryRecords.map(row => row.id);
  if (new Set(localIds).size !== localIds.length) throw new Error(`q4_c1_memory_record_duplicate:${caseId}`);
  const localIdSet = new Set(localIds);
  if (goldEvidenceIds.some(id => !localIdSet.has(id))) throw new Error(`q4_c1_gold_not_in_case_memory:${caseId}`);

  if (family === "entity_reference" && (goldEvidenceIds.length !== 1 || memoryRecords.length !== 1)) {
    throw new Error(`q4_c1_entity_shape_invalid:${caseId}`);
  }
  if (family === "temporal_relation" && (goldEvidenceIds.length !== 1 || memoryRecords.length !== 2)) {
    throw new Error(`q4_c1_temporal_shape_invalid:${caseId}`);
  }
  if (family === "multi_facet" && (goldEvidenceIds.length !== 2 || memoryRecords.length !== 2)) {
    throw new Error(`q4_c1_multi_shape_invalid:${caseId}`);
  }
  if (family === "protection" && (goldEvidenceIds.length !== 1 || memoryRecords.length !== 1)) {
    throw new Error(`q4_c1_protection_shape_invalid:${caseId}`);
  }

  return {
    case_id: caseId,
    family,
    query,
    bounded_context: boundedContext,
    gold_evidence_ids: goldEvidenceIds,
    memory_records: memoryRecords,
  };
}

export function validateQ4RecallHintC1CorpusV1(corpus) {
  if (!isPlainObject(corpus)) throw new Error("q4_c1_corpus_required");
  if (corpus.schema !== Q4_RECALL_HINT_C1_CORPUS_SCHEMA) throw new Error("q4_c1_corpus_schema_invalid");
  if (corpus.corpus_version !== Q4_RECALL_HINT_C1_CORPUS_VERSION) throw new Error("q4_c1_corpus_version_invalid");
  const purpose = requireString(corpus.purpose, "corpus_purpose", 240);
  if (!Array.isArray(corpus.cases)) throw new Error("q4_c1_cases_must_be_array");
  const cases = corpus.cases.map(normalizeCase);
  const caseIds = cases.map(row => row.case_id);
  if (new Set(caseIds).size !== caseIds.length) throw new Error("q4_c1_case_id_duplicate");
  const memoryIds = cases.flatMap(row => row.memory_records.map(memory => memory.id));
  if (new Set(memoryIds).size !== memoryIds.length) throw new Error("q4_c1_global_memory_id_duplicate");

  for (const family of Q4_RECALL_HINT_C1_FAMILIES) {
    const count = cases.filter(row => row.family === family).length;
    if (count !== Q4_RECALL_HINT_C1_CASES_PER_FAMILY) {
      throw new Error(`q4_c1_family_count_invalid:${family}:${count}`);
    }
  }
  if (cases.length !== Q4_RECALL_HINT_C1_FAMILIES.length * Q4_RECALL_HINT_C1_CASES_PER_FAMILY) {
    throw new Error("q4_c1_total_case_count_invalid");
  }

  return {
    schema: Q4_RECALL_HINT_C1_CORPUS_SCHEMA,
    corpus_version: Q4_RECALL_HINT_C1_CORPUS_VERSION,
    purpose,
    cases,
  };
}

export function buildQ4RecallHintC1ProducerInputV1(record) {
  const normalized = normalizeCase(record, 0);
  return {
    schema: Q4_RECALL_HINT_C1_PRODUCER_INPUT_SCHEMA,
    case_id: normalized.case_id,
    query: normalized.query,
    bounded_context: normalized.bounded_context,
  };
}

function splitCases(cases) {
  const development = [];
  const acceptance = [];
  for (const family of Q4_RECALL_HINT_C1_FAMILIES) {
    const familyCases = cases
      .filter(row => row.family === family)
      .map(row => ({ row, key: sha256(`${Q4_RECALL_HINT_C1_SPLIT_SALT}:${family}:${row.case_id}`) }))
      .sort((left, right) => left.key.localeCompare(right.key) || left.row.case_id.localeCompare(right.row.case_id));
    development.push(...familyCases.slice(0, Q4_RECALL_HINT_C1_DEVELOPMENT_PER_FAMILY).map(item => item.row));
    acceptance.push(...familyCases.slice(Q4_RECALL_HINT_C1_DEVELOPMENT_PER_FAMILY).map(item => item.row));
  }
  return {
    development: development.sort((a, b) => a.case_id.localeCompare(b.case_id)),
    acceptance: acceptance.sort((a, b) => a.case_id.localeCompare(b.case_id)),
  };
}

function caseSnapshot(row) {
  const producerInput = buildQ4RecallHintC1ProducerInputV1(row);
  return {
    case_id: row.case_id,
    family: row.family,
    case_sha256: sha256(JSON.stringify(row)),
    producer_input_sha256: sha256(JSON.stringify(producerInput)),
    gold_evidence_count: row.gold_evidence_ids.length,
    memory_record_count: row.memory_records.length,
  };
}

export function buildQ4RecallHintC1ManifestV1(corpus) {
  const normalized = validateQ4RecallHintC1CorpusV1(corpus);
  const split = splitCases(normalized.cases);
  const development = split.development.map(caseSnapshot);
  const acceptance = split.acceptance.map(caseSnapshot);
  const body = {
    schema: Q4_RECALL_HINT_C1_MANIFEST_SCHEMA,
    corpus_identity: {
      schema: normalized.schema,
      corpus_version: normalized.corpus_version,
      corpus_sha256: sha256(JSON.stringify(normalized)),
    },
    split_policy: {
      method: "family_stratified_salted_sha256",
      salt: Q4_RECALL_HINT_C1_SPLIT_SALT,
      cases_per_family: Q4_RECALL_HINT_C1_CASES_PER_FAMILY,
      development_per_family: Q4_RECALL_HINT_C1_DEVELOPMENT_PER_FAMILY,
      acceptance_per_family: Q4_RECALL_HINT_C1_ACCEPTANCE_PER_FAMILY,
    },
    population: {
      case_count: normalized.cases.length,
      memory_record_count: normalized.cases.reduce((sum, row) => sum + row.memory_records.length, 0),
      development_count: development.length,
      acceptance_count: acceptance.length,
      family_counts: Object.fromEntries(Q4_RECALL_HINT_C1_FAMILIES.map(family => [
        family,
        normalized.cases.filter(row => row.family === family).length,
      ])),
    },
    development,
    acceptance,
    development_sha256: sha256(JSON.stringify(development)),
    acceptance_sha256: sha256(JSON.stringify(acceptance)),
  };
  return {
    ...body,
    manifest_sha256: sha256(JSON.stringify(body)),
  };
}

export function validateQ4RecallHintC1ManifestV1(manifest, corpus) {
  if (!isPlainObject(manifest)) throw new Error("q4_c1_manifest_required");
  const expected = buildQ4RecallHintC1ManifestV1(corpus);
  if (JSON.stringify(manifest) !== JSON.stringify(expected)) throw new Error("q4_c1_manifest_mismatch");
  return expected;
}

export function assertQ4RecallHintC1FrozenIdentityV1(corpus) {
  const manifest = buildQ4RecallHintC1ManifestV1(corpus);
  for (const [field, expected] of Object.entries(Q4_RECALL_HINT_C1_FROZEN_IDENTITY)) {
    const actual = field === "corpus_sha256" ? manifest.corpus_identity.corpus_sha256 : manifest[field];
    if (actual !== expected) throw new Error(`q4_c1_frozen_identity_mismatch:${field}:${actual}`);
  }
  return manifest;
}

export function flattenQ4RecallHintC1MemoryRecordsV1(corpus) {
  const normalized = validateQ4RecallHintC1CorpusV1(corpus);
  return normalized.cases.flatMap(row => row.memory_records.map(memory => ({ ...memory })));
}

export function assignQ4RecallHintC1SplitV1(corpus) {
  const normalized = validateQ4RecallHintC1CorpusV1(corpus);
  const split = splitCases(normalized.cases);
  return {
    development: split.development.map(row => row.case_id),
    acceptance: split.acceptance.map(row => row.case_id),
  };
}
