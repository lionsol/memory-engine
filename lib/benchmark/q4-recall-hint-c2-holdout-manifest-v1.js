import { createHash } from "node:crypto";

import { Q4_RECALL_HINT_C1_PRODUCER_INPUT_SCHEMA } from "./q4-recall-hint-c1-manifest-v1.js";
import {
  Q4_RECALL_HINT_C2_HOLDOUT_CORPUS_SCHEMA,
  Q4_RECALL_HINT_C2_HOLDOUT_CORPUS_VERSION,
} from "./q4-recall-hint-c2-holdout-corpus-v1.js";

export const Q4_RECALL_HINT_C2_HOLDOUT_MANIFEST_SCHEMA = "memory_engine_q4_recall_hint_c2_holdout_manifest_v1";
export const Q4_RECALL_HINT_C2_HOLDOUT_FAMILIES = Object.freeze([
  "entity_reference",
  "multi_facet",
  "protection",
]);
export const Q4_RECALL_HINT_C2_HOLDOUT_CASES_PER_FAMILY = 8;
export const Q4_RECALL_HINT_C2_HOLDOUT_CASE_COUNT = 24;
export const Q4_RECALL_HINT_C2_HOLDOUT_MEMORY_RECORD_COUNT = 32;
export const Q4_RECALL_HINT_C2_HOLDOUT_FROZEN_IDENTITY = Object.freeze({
  corpus_sha256: "cd4842fee339736f7eecd49ce525a3534fe971d83ff1d06fcc672ff3df113a13",
  holdout_sha256: "64658f3827a682c9c4a0b18316a2e830f3d66081c1a7fc25eb853f263ee39282",
  manifest_sha256: "05adda04c8b9250cef4791995dbb03742155e177d881204c0d4e55224168b0f9",
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
  if (typeof value !== "string" || value.trim() === "") throw new Error(`q4_c2_${field}_required`);
  const normalized = value.trim();
  if (maxCodePoints !== null && Array.from(normalized).length > maxCodePoints) {
    throw new Error(`q4_c2_${field}_exceeds_bound`);
  }
  return normalized;
}

function requireStringArray(value, field, { min = 0, max = Infinity, itemMaxCodePoints = null } = {}) {
  if (!Array.isArray(value)) throw new Error(`q4_c2_${field}_must_be_array`);
  if (value.length < min || value.length > max) throw new Error(`q4_c2_${field}_count_invalid`);
  const normalized = value.map((item, index) => requireString(item, `${field}_${index}`, itemMaxCodePoints));
  if (new Set(normalized).size !== normalized.length) throw new Error(`q4_c2_${field}_duplicate`);
  return normalized;
}

function normalizeBoundedContext(value, caseId) {
  if (!isPlainObject(value)) throw new Error(`q4_c2_bounded_context_invalid:${caseId}`);
  const allowed = new Set(["active_project", "recent_entities", "temporal_anchor"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`q4_c2_bounded_context_unknown_field:${caseId}:${key}`);
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
  if (!Array.isArray(value) || value.length === 0) throw new Error(`q4_c2_memory_records_required:${caseId}`);
  return value.map((row, index) => {
    if (!isPlainObject(row)) throw new Error(`q4_c2_memory_record_invalid:${caseId}:${index}`);
    const allowed = new Set(["id", "text"]);
    for (const key of Object.keys(row)) {
      if (!allowed.has(key)) throw new Error(`q4_c2_memory_record_unknown_field:${caseId}:${key}`);
    }
    return {
      id: requireString(row.id, `${caseId}_memory_id_${index}`, 128),
      text: requireString(row.text, `${caseId}_memory_text_${index}`, 800),
    };
  });
}

function normalizeCase(record, index) {
  if (!isPlainObject(record)) throw new Error(`q4_c2_case_invalid:${index}`);
  const allowed = new Set([
    "case_id",
    "family",
    "query",
    "bounded_context",
    "gold_evidence_ids",
    "memory_records",
  ]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`q4_c2_case_unknown_field:${index}:${key}`);
  }
  const caseId = requireString(record.case_id, `case_id_${index}`, 128);
  if (!caseId.startsWith("q4c2-")) throw new Error(`q4_c2_case_id_namespace_invalid:${caseId}`);
  const family = requireString(record.family, `${caseId}_family`, 64);
  if (!Q4_RECALL_HINT_C2_HOLDOUT_FAMILIES.includes(family)) throw new Error(`q4_c2_family_invalid:${caseId}`);
  const query = requireString(record.query, `${caseId}_query`, 240);
  const boundedContext = normalizeBoundedContext(record.bounded_context, caseId);
  const goldEvidenceIds = requireStringArray(record.gold_evidence_ids, `${caseId}_gold_evidence_ids`, {
    min: 1,
    max: 3,
    itemMaxCodePoints: 128,
  });
  const memoryRecords = normalizeMemoryRecords(record.memory_records, caseId);
  const localIds = memoryRecords.map(row => row.id);
  if (new Set(localIds).size !== localIds.length) throw new Error(`q4_c2_memory_record_duplicate:${caseId}`);
  if (localIds.some(id => !id.startsWith("q4c2-mem-"))) throw new Error(`q4_c2_memory_id_namespace_invalid:${caseId}`);
  const localIdSet = new Set(localIds);
  if (goldEvidenceIds.some(id => !localIdSet.has(id))) throw new Error(`q4_c2_gold_not_in_case_memory:${caseId}`);

  if (family === "entity_reference" && (goldEvidenceIds.length !== 1 || memoryRecords.length !== 1)) {
    throw new Error(`q4_c2_entity_shape_invalid:${caseId}`);
  }
  if (family === "multi_facet" && (goldEvidenceIds.length !== 2 || memoryRecords.length !== 2)) {
    throw new Error(`q4_c2_multi_shape_invalid:${caseId}`);
  }
  if (family === "protection" && (goldEvidenceIds.length !== 1 || memoryRecords.length !== 1)) {
    throw new Error(`q4_c2_protection_shape_invalid:${caseId}`);
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

export function validateQ4RecallHintC2HoldoutCorpusV1(corpus) {
  if (!isPlainObject(corpus)) throw new Error("q4_c2_corpus_required");
  if (corpus.schema !== Q4_RECALL_HINT_C2_HOLDOUT_CORPUS_SCHEMA) throw new Error("q4_c2_corpus_schema_invalid");
  if (corpus.corpus_version !== Q4_RECALL_HINT_C2_HOLDOUT_CORPUS_VERSION) throw new Error("q4_c2_corpus_version_invalid");
  const purpose = requireString(corpus.purpose, "corpus_purpose", 240);
  if (!Array.isArray(corpus.cases)) throw new Error("q4_c2_cases_must_be_array");
  const cases = corpus.cases.map(normalizeCase);
  const caseIds = cases.map(row => row.case_id);
  if (new Set(caseIds).size !== caseIds.length) throw new Error("q4_c2_case_id_duplicate");
  const memoryIds = cases.flatMap(row => row.memory_records.map(memory => memory.id));
  if (new Set(memoryIds).size !== memoryIds.length) throw new Error("q4_c2_global_memory_id_duplicate");

  for (const family of Q4_RECALL_HINT_C2_HOLDOUT_FAMILIES) {
    const count = cases.filter(row => row.family === family).length;
    if (count !== Q4_RECALL_HINT_C2_HOLDOUT_CASES_PER_FAMILY) {
      throw new Error(`q4_c2_family_count_invalid:${family}:${count}`);
    }
  }
  if (cases.length !== Q4_RECALL_HINT_C2_HOLDOUT_CASE_COUNT) throw new Error("q4_c2_total_case_count_invalid");
  const recordCount = cases.reduce((sum, row) => sum + row.memory_records.length, 0);
  if (recordCount !== Q4_RECALL_HINT_C2_HOLDOUT_MEMORY_RECORD_COUNT) {
    throw new Error(`q4_c2_memory_record_count_invalid:${recordCount}`);
  }

  return {
    schema: Q4_RECALL_HINT_C2_HOLDOUT_CORPUS_SCHEMA,
    corpus_version: Q4_RECALL_HINT_C2_HOLDOUT_CORPUS_VERSION,
    purpose,
    cases,
  };
}

export function buildQ4RecallHintC2ProducerInputV1(record) {
  const normalized = normalizeCase(record, 0);
  return {
    schema: Q4_RECALL_HINT_C1_PRODUCER_INPUT_SCHEMA,
    case_id: normalized.case_id,
    query: normalized.query,
    bounded_context: normalized.bounded_context,
  };
}

function caseSnapshot(row) {
  const producerInput = buildQ4RecallHintC2ProducerInputV1(row);
  return {
    case_id: row.case_id,
    family: row.family,
    case_sha256: sha256(JSON.stringify(row)),
    producer_input_sha256: sha256(JSON.stringify(producerInput)),
    gold_evidence_count: row.gold_evidence_ids.length,
    memory_record_count: row.memory_records.length,
  };
}

export function buildQ4RecallHintC2HoldoutManifestV1(corpus) {
  const normalized = validateQ4RecallHintC2HoldoutCorpusV1(corpus);
  const holdout = normalized.cases
    .map(caseSnapshot)
    .sort((left, right) => left.case_id.localeCompare(right.case_id));
  const body = {
    schema: Q4_RECALL_HINT_C2_HOLDOUT_MANIFEST_SCHEMA,
    corpus_identity: {
      schema: normalized.schema,
      corpus_version: normalized.corpus_version,
      corpus_sha256: sha256(JSON.stringify(normalized)),
    },
    split_policy: {
      method: "acceptance_only_fresh_holdout",
      development_count: 0,
      holdout_count: holdout.length,
      families: [...Q4_RECALL_HINT_C2_HOLDOUT_FAMILIES],
    },
    population: {
      case_count: normalized.cases.length,
      memory_record_count: normalized.cases.reduce((sum, row) => sum + row.memory_records.length, 0),
      development_count: 0,
      holdout_count: holdout.length,
      family_counts: Object.fromEntries(Q4_RECALL_HINT_C2_HOLDOUT_FAMILIES.map(family => [
        family,
        normalized.cases.filter(row => row.family === family).length,
      ])),
    },
    holdout,
    holdout_sha256: sha256(JSON.stringify(holdout)),
  };
  return {
    ...body,
    manifest_sha256: sha256(JSON.stringify(body)),
  };
}

export function assertQ4RecallHintC2HoldoutFrozenIdentityV1(corpus) {
  const manifest = buildQ4RecallHintC2HoldoutManifestV1(corpus);
  for (const [field, expected] of Object.entries(Q4_RECALL_HINT_C2_HOLDOUT_FROZEN_IDENTITY)) {
    const actual = field === "corpus_sha256" ? manifest.corpus_identity.corpus_sha256 : manifest[field];
    if (actual !== expected) throw new Error(`q4_c2_frozen_identity_mismatch:${field}:${actual}`);
  }
  return manifest;
}

export function flattenQ4RecallHintC2HoldoutMemoryRecordsV1(corpus) {
  const normalized = validateQ4RecallHintC2HoldoutCorpusV1(corpus);
  return normalized.cases.flatMap(row => row.memory_records.map(memory => ({ ...memory })));
}
