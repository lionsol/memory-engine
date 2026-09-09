import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  isRetrievalExcludedPath,
} from "../recall/hybrid/normalize-candidate.js";
import {
  LOCOMO_CHUNK_FTS_ONLY_PROFILE,
  validateLocomoChunkCanonicalMapping,
} from "./locomo-chunk-candidate-builder.js";

export const LOCOMO_CHUNK_LIFECYCLE_OVERLAY_SCHEMA = "q3_locomo_experimental_canonical_lifecycle_overlay_v1";
export const LOCOMO_CHUNK_LIFECYCLE_OVERLAY_POLICY_ID = "q3_locomo_external_lifecycle_policy_v1";

export const LOCOMO_CHUNK_LIFECYCLE_OVERLAY_POLICY = Object.freeze({
  policy_id: LOCOMO_CHUNK_LIFECYCLE_OVERLAY_POLICY_ID,
  status: "experimental",
  productionEquivalent: false,
  management: {
    value: "external",
    rule: "frozen benchmark chunks have no matching Engine lifecycle row in the input material",
    source: "offline_overlay_policy",
  },
  classification_category: {
    value: "external",
    rule: "fixed deterministic fallback; never read from official gold or live state",
    source: "offline_overlay_policy",
  },
  lifecycle_category: {
    value: null,
    rule: "external objects do not claim an Engine lifecycle category",
    source: "canonical_memory_object_contract",
  },
  confidence: {
    initial_confidence: null,
    confidence: null,
    rule: "no Engine confidence row is read or inferred",
    source: "canonical_memory_object_contract",
  },
  archive_protection_conflict: {
    archived: null,
    protected: null,
    conflict: null,
    rule: "no Engine lifecycle flags are fabricated for external objects",
    source: "canonical_memory_object_contract",
  },
  time: {
    source_updated_at: null,
    last_confidence_update: null,
    base_tau_days: null,
    rule: "frozen chunk material does not provide Core updated_at or Engine time fields",
    source: "input_material_schema",
  },
  hits: {
    hit_count: null,
    rule: "no Engine hit counter is read or fabricated",
    source: "canonical_memory_object_contract",
  },
});

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  if (!isRecord(value)) throw new Error(`${label}_must_be_record`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}_must_be_nonempty_string`);
  }
  return value;
}

function requireSafeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label}_must_be_safe_integer`);
  }
  return value;
}

function requireSha256(value, label) {
  const hash = requireString(value, label);
  if (!SHA256_PATTERN.test(hash)) throw new Error(`${label}_must_be_sha256`);
  return hash;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validateMaterialIdentity(value) {
  const identity = requireRecord(value, "overlay_material_identity");
  const normalized = {
    dataset_sha256: requireSha256(identity.dataset_sha256, "overlay_dataset_sha256"),
    chunk_material_manifest_sha256: requireSha256(
      identity.chunk_material_manifest_sha256,
      "overlay_chunk_material_manifest_sha256",
    ),
    chunks_sha256: requireSha256(identity.chunks_sha256, "overlay_chunks_sha256"),
  };
  for (const key of ["dataset_path", "chunks_path", "manifest_path"]) {
    if (identity[key] !== undefined) normalized[key] = requireString(identity[key], `overlay_${key}`);
  }
  return normalized;
}

function canonicalMemoryFromMaterialChunk(row, index) {
  const chunk = requireRecord(row, `overlay_material_chunk:${index}`);
  const sampleId = requireString(chunk.sampleId, `overlay_material_chunk:${index}:sample_id`);
  const sessionId = requireString(chunk.sessionId, `overlay_material_chunk:${index}:session_id`);
  const chunkIndex = requireSafeInteger(chunk.chunkIndex, `overlay_material_chunk:${index}:chunk_index`);
  const memoryId = requireString(chunk.memoryId, `overlay_material_chunk:${index}:memory_id`);
  const text = requireString(chunk.text, `overlay_material_chunk:${index}:text`);
  const hash = requireSha256(chunk.hash, `overlay_material_chunk:${index}:hash`);
  if (sha256(text) !== hash) throw new Error(`overlay_material_chunk:${index}:hash_mismatch`);
  const source = requireRecord(chunk.source, `overlay_material_chunk:${index}:source`);
  const sourceSystem = requireString(source.system, `overlay_material_chunk:${index}:source_system`);
  if (source.recordType !== "chunk") throw new Error(`overlay_material_chunk:${index}:record_type_invalid`);
  if (source.recordId !== memoryId) throw new Error(`overlay_material_chunk:${index}:record_id_mismatch`);
  const sourcePath = requireString(source.path, `overlay_material_chunk:${index}:source_path`);
  const coreSource = requireString(source.coreSource, `overlay_material_chunk:${index}:core_source`);
  const startLine = requireSafeInteger(chunk.startLine, `overlay_material_chunk:${index}:start_line`, 1);
  const endLine = requireSafeInteger(chunk.endLine, `overlay_material_chunk:${index}:end_line`, startLine);
  if (source.lineStart !== startLine || source.lineEnd !== endLine) {
    throw new Error(`overlay_material_chunk:${index}:source_line_range_mismatch`);
  }
  if (source.text !== text) throw new Error(`overlay_material_chunk:${index}:source_text_mismatch`);
  if (source.coreHash !== hash) throw new Error(`overlay_material_chunk:${index}:source_hash_mismatch`);
  const positionStatus = requireString(
    chunk.position?.status,
    `overlay_material_chunk:${index}:position_status`,
  );

  return {
    memory_id: memoryId,
    source: {
      system: sourceSystem,
      record_type: "chunk",
      record_id: memoryId,
      path: sourcePath,
      core_source: coreSource,
      line_start: startLine,
      line_end: endLine,
      text,
      core_hash: hash,
      updated_at: null,
    },
    classification: {
      category: LOCOMO_CHUNK_LIFECYCLE_OVERLAY_POLICY.classification_category.value,
      category_authority: LOCOMO_CHUNK_LIFECYCLE_OVERLAY_POLICY_ID,
    },
    lifecycle: {
      management: "external",
      category: null,
      initial_confidence: null,
      confidence: null,
      last_confidence_update: null,
      base_tau_days: null,
      hit_count: null,
      archived: null,
      protected: null,
      conflict: null,
    },
    content_ref: {
      mode: "experimental_offline_overlay",
      content_hash: `sha256:${hash}`,
    },
    overlay_identity: {
      sample_id: sampleId,
      session_id: sessionId,
      chunk_index: chunkIndex,
      position_status: positionStatus,
    },
  };
}

function summarizePositionStatuses(materialChunks) {
  const counts = {};
  for (const chunk of materialChunks) {
    const status = String(chunk.position?.status || "unknown");
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

function summarizeFilteringImpact(memories) {
  const excluded = {
    retrieval_excluded: 0,
    canonical_archived: 0,
    below_min_confidence: 0,
  };
  for (const memory of memories) {
    const sourcePath = memory.source.path.replace(/\\/g, "/");
    if (isRetrievalExcludedPath(sourcePath)) excluded.retrieval_excluded += 1;
    if (memory.lifecycle.archived === true) excluded.canonical_archived += 1;
    if (memory.lifecycle.management === "managed" && memory.lifecycle.confidence < LOCOMO_CHUNK_FTS_ONLY_PROFILE.min_confidence) {
      excluded.below_min_confidence += 1;
    }
  }
  const excludedCount = Object.values(excluded).reduce((sum, count) => sum + count, 0);
  return {
    profile_id: LOCOMO_CHUNK_FTS_ONLY_PROFILE.profile_id,
    min_confidence: LOCOMO_CHUNK_FTS_ONLY_PROFILE.min_confidence,
    input_count: memories.length,
    excluded,
    excluded_count: excludedCount,
    eligible_before_query_count: memories.length - excludedCount,
    note: "This is the candidate builder's deterministic overlay effect; null external lifecycle flags are not evidence of production active state.",
  };
}

function summarizeSortingImpact(memories) {
  const externalCount = memories.filter(memory => memory.lifecycle.management === "external").length;
  const categoryBoost = LOCOMO_CHUNK_FTS_ONLY_PROFILE.ranking_config.categoryBoost.external.external;
  const externalBoost = LOCOMO_CHUNK_FTS_ONLY_PROFILE.ranking_config.externalBoost.value;
  return {
    profile_id: LOCOMO_CHUNK_FTS_ONLY_PROFILE.profile_id,
    external_count: externalCount,
    lifecycle_dependent_differential_count: 0,
    uniform_overlay_terms: {
      category: "external",
      category_boost: categoryBoost,
      external_boost: externalBoost,
      confidence_boost: 0,
      recency_boost: 0,
    },
    note: "The overlay supplies no per-chunk confidence or timestamp signal; FTS semantic score, RRF rank, and stable tie order remain query-dependent and are not computed here.",
  };
}

export function buildLocomoChunkLifecycleOverlay({ materialChunks, materialIdentity } = {}) {
  if (!Array.isArray(materialChunks)) throw new Error("overlay_material_chunks_must_be_array");
  const identity = validateMaterialIdentity(materialIdentity);
  const memories = materialChunks.map(canonicalMemoryFromMaterialChunk);
  const { memoryById } = validateLocomoChunkCanonicalMapping({
    materialChunks,
    canonicalMemories: memories,
  });
  const sampleIds = new Set(materialChunks.map(chunk => chunk.sampleId));
  return {
    schema: LOCOMO_CHUNK_LIFECYCLE_OVERLAY_SCHEMA,
    status: "experimental",
    productionEquivalent: false,
    provider_calls: 0,
    retrieval_runs: 0,
    live_sources_read: false,
    gold_read: false,
    material_identity: identity,
    policy: LOCOMO_CHUNK_LIFECYCLE_OVERLAY_POLICY,
    counts: {
      input_chunk_count: materialChunks.length,
      overlay_memory_count: memoryById.size,
      covered_count: memoryById.size,
      rejected_count: 0,
      duplicate_id_count: 0,
      one_to_one: memoryById.size === materialChunks.length,
      sample_count: sampleIds.size,
      position_status_counts: summarizePositionStatuses(materialChunks),
    },
    filtering_impact: summarizeFilteringImpact(memories),
    sorting_impact: summarizeSortingImpact(memories),
    memories,
  };
}

function assertEmptyOutputDirectory(outputDir) {
  mkdirSync(outputDir, { recursive: true });
  if (readdirSync(outputDir).length > 0) throw new Error("overlay_output_directory_must_be_empty");
}

function writeChecksums(outputDir, files) {
  const rows = files
    .toSorted((left, right) => left.localeCompare(right))
    .map(relativePath => `${sha256(readFileSync(path.join(outputDir, relativePath)))}  ${relativePath}`);
  writeFileSync(path.join(outputDir, "SHA256SUMS"), `${rows.join("\n")}\n`, "utf8");
  return rows;
}

export function writeLocomoChunkLifecycleOverlay({ materialChunks, materialIdentity, outputDir } = {}) {
  const overlay = buildLocomoChunkLifecycleOverlay({ materialChunks, materialIdentity });
  requireString(outputDir, "overlay_output_dir");
  assertEmptyOutputDirectory(outputDir);
  const overlayPath = path.join(outputDir, "canonical-lifecycle-overlay.json");
  const reportPath = path.join(outputDir, "canonical-lifecycle-overlay-report.json");
  writeFileSync(overlayPath, stableJson(overlay), "utf8");
  const overlayHash = sha256(readFileSync(overlayPath));
  const report = {
    schema: "q3_locomo_experimental_canonical_lifecycle_overlay_report_v1",
    status: overlay.status,
    productionEquivalent: overlay.productionEquivalent,
    overlay_sha256: overlayHash,
    counts: overlay.counts,
    filtering_impact: overlay.filtering_impact,
    sorting_impact: overlay.sorting_impact,
    material_identity: overlay.material_identity,
    provider_calls: 0,
    retrieval_runs: 0,
    live_sources_read: false,
    gold_read: false,
  };
  writeFileSync(reportPath, stableJson(report), "utf8");
  const checksumRows = writeChecksums(outputDir, [
    "canonical-lifecycle-overlay.json",
    "canonical-lifecycle-overlay-report.json",
  ]);
  return {
    outputDir,
    overlayPath,
    reportPath,
    checksumsPath: path.join(outputDir, "SHA256SUMS"),
    overlaySha256: overlayHash,
    checksums: checksumRows,
    overlay,
    report,
  };
}
