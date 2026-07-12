import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import {
  extractExactQueryFragments,
  normalizeFtsQuery,
  stripPromptMetadataPrefix,
} from "../../../query-utils.js";
import { calcRealtimeConf } from "../../memory-confidence.js";
import { createCandidateCounts, createHybridDebug, createHybridWarnings } from "./debug.js";
import { enrichLexicalCandidate, tokenizeQuery } from "./lexical.js";
import {
  inferCategoryFromChunk,
  isCandidateAllowedForRerank,
  normalizeExternalMemory,
  round4,
  toFiniteNumber,
} from "./normalize-candidate.js";
import { collectKgCandidates } from "./channels/kg.js";
import {
  evaluateKgTextIdInvariant,
  resolveKgAccessDecision,
} from "./kg-id-invariant.js";

const NO_HIT_CONTROL_QUERY = "__memory_engine_isolated_kg_shadow_no_hit_control_9f8c2d__";
const MUTATION_FLAGS = new Set(["--apply", "--force", "--write-db", "--delete", "--update", "--insert", "--no-backup"]);
const CANDIDATE_FIELDS = [
  "id",
  "text",
  "path",
  "updated_at",
  "confidence",
  "confidence_realtime",
  "confidence_mode",
  "last_confidence_update",
  "base_tau",
  "hit_count",
  "hits",
  "is_protected",
  "conflict_flag",
  "category",
  "is_archived",
  "kg_data",
  "similarity",
  "semantic_score",
  "created_at",
  "token_coverage",
  "exact_bonus",
  "structured_match_bonus",
  "source_type",
];

export function kgShadowLexicalMatchScore(haystack, terms) {
  if (!Array.isArray(terms) || terms.length === 0) return 0;
  const raw = String(haystack || "").toLowerCase();
  let matched = 0;
  for (const term of terms) {
    if (!term) continue;
    if (raw.includes(term)) matched += 1;
  }
  if (matched === 0) return 0;
  return round4(matched / terms.length);
}

function sha256Hex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function shortHash(value) {
  return sha256Hex(value).slice(0, 16);
}

function stableShadowSerialize(value) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Buffer.isBuffer(value)) return JSON.stringify({ type: "Buffer", hex: value.toString("hex") });
  if (Array.isArray(value)) return `[${value.map(stableShadowSerialize).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableShadowSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function fingerprintShadowValue(value) {
  return sha256Hex(stableShadowSerialize(value));
}

export function canonicalizeKgShadowCandidate(candidate = {}) {
  const canonical = {};
  for (const field of CANDIDATE_FIELDS) {
    canonical[field] = Object.hasOwn(candidate, field) ? candidate[field] : null;
  }
  return canonical;
}

function summarizeCandidate(candidate, position) {
  const canonical = canonicalizeKgShadowCandidate(candidate);
  return {
    position,
    id_hash: shortHash(canonical.id),
    row_fingerprint: fingerprintShadowValue(canonical),
    text_length: String(canonical.text ?? "").length,
    path_hash: shortHash(canonical.path),
    kg_data_length: String(canonical.kg_data ?? "").length,
  };
}

function sanitizeError(error) {
  if (!error) return null;
  return {
    code: error.code ? String(error.code) : null,
    message: String(error.message || error),
  };
}

function median(values = []) {
  const numeric = values
    .map(value => Number(value))
    .filter(value => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (numeric.length === 0) return 0;
  const mid = Math.floor(numeric.length / 2);
  if (numeric.length % 2 === 1) return numeric[mid];
  return (numeric[mid - 1] + numeric[mid]) / 2;
}

function databaseList(db) {
  return db.prepare("PRAGMA database_list").all().map(row => ({
    seq: Number(row.seq || 0),
    name: String(row.name || ""),
    file: String(row.file || ""),
  }));
}

function databaseNames(db) {
  return databaseList(db).map(row => row.name);
}

function dataVersion(db) {
  const row = db.prepare("PRAGMA data_version").get();
  const value = row?.data_version ?? row?.dataVersion ?? Object.values(row || {})[0] ?? 0;
  return Number(value || 0);
}

function fileSnapshot(path) {
  const stat = statSync(path);
  return {
    size: Number(stat.size || 0),
    mtimeMs: Number(stat.mtimeMs || 0),
  };
}

function noSensitiveText(reportJson, forbiddenValues = []) {
  return forbiddenValues.every(value => !value || !reportJson.includes(String(value)));
}

function buildQueryDescriptor(rawText, source) {
  const original = String(rawText ?? "");
  const limited = original.slice(0, 1200);
  const truncated = limited.length !== original.length;
  const stripped = stripPromptMetadataPrefix(limited);
  if (!stripped.trim()) {
    return {
      text: limited,
      query: {
        query_id: shortHash(limited),
        source,
        char_count: limited.length,
        term_count: 0,
        truncated,
      },
      empty: true,
    };
  }
  const normalized = normalizeFtsQuery(stripped);
  const queryTerms = tokenizeQuery(normalized);
  return {
    text: limited,
    query: {
      query_id: shortHash(limited),
      source,
      char_count: limited.length,
      term_count: queryTerms.length,
      truncated,
      broad_probe: queryTerms.length === 1,
    },
    empty: false,
  };
}

export function deriveKgShadowQueries({
  queries = [],
  queriesFile = null,
  derivedKgRows = [],
  includeNoHitControl = false,
} = {}) {
  const descriptors = [];
  const stats = {
    explicit_input_count: 0,
    file_input_count: 0,
    derived_source_row_count: Array.isArray(derivedKgRows) ? derivedKgRows.length : 0,
    derived_truncated_row_count: 0,
    derived_unique_full_query_count: 0,
    derived_duplicate_query_count: 0,
    no_hit_control_count: includeNoHitControl ? 1 : 0,
    final_unique_query_count: 0,
  };

  for (const query of queries) {
    stats.explicit_input_count += 1;
    descriptors.push(buildQueryDescriptor(query, "explicit"));
  }

  if (queriesFile) {
    const fileText = readFileSync(resolve(String(queriesFile)), "utf8");
    for (const line of fileText.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      stats.file_input_count += 1;
      descriptors.push(buildQueryDescriptor(trimmed, "file"));
    }
  }

  const fullDerivedSeen = new Set();
  for (const row of derivedKgRows) {
    const fullDescriptor = buildQueryDescriptor(row, "derived_kg_data_full");
    if (fullDescriptor.query.truncated) stats.derived_truncated_row_count += 1;
    const fullKey = sha256Hex(fullDescriptor.text);
    if (fullDerivedSeen.has(fullKey)) stats.derived_duplicate_query_count += 1;
    else {
      fullDerivedSeen.add(fullKey);
      stats.derived_unique_full_query_count += 1;
    }
    descriptors.push(fullDescriptor);

    const normalized = normalizeFtsQuery(stripPromptMetadataPrefix(fullDescriptor.text));
    const tokens = tokenizeQuery(normalized).filter(Boolean);
    for (const count of [1, 2, 3]) {
      if (tokens.length < count) break;
      descriptors.push(buildQueryDescriptor(tokens.slice(0, count).join(" "), `derived_kg_data_term_${count}`));
    }
  }

  if (includeNoHitControl) {
    descriptors.push(buildQueryDescriptor(NO_HIT_CONTROL_QUERY, "no_hit_control"));
  }

  const deduped = [];
  const seen = new Set();
  for (const descriptor of descriptors) {
    const key = sha256Hex(descriptor.text);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(descriptor);
  }
  stats.final_unique_query_count = deduped.length;
  return {
    descriptors: deduped,
    stats,
  };
}

function buildKgChannelContext({
  queryText,
  withDb,
  withEngineDb,
  withCoreDb,
  kgAccessMode,
  kgIsolationRequested,
  kgIsolationFallbackReason,
  nowSec,
  minConfidence,
  ftsTopK,
  likePatternTopN,
}) {
  const rawQuery = String(queryText || "");
  const strippedQuery = stripPromptMetadataPrefix(rawQuery);
  const normalizedQuery = normalizeFtsQuery(strippedQuery);
  const queryTerms = tokenizeQuery(normalizedQuery);
  const exactFragments = extractExactQueryFragments(strippedQuery, 8);
  const candidateCounts = createCandidateCounts();
  const debug = createHybridDebug({
    rawQuery,
    strippedQuery,
    normalizedQuery,
    queryTerms,
    candidateCounts,
    minConfidence,
    lexicalConfidenceThreshold: 0.7,
  });
  const channels = {};
  const warnings = [];
  const { warnHybridSearchOnce } = createHybridWarnings();
  const warnAndRecord = (message, error = null) => {
    warnings.push({
      message,
      error: error ? String(error.message || error) : null,
    });
    warnHybridSearchOnce(message, error);
  };
  return {
    queryTerms,
    exactFragments,
    channels,
    debug,
    candidateCounts,
    warnings,
    normalizedQuery,
    strippedQuery,
    likePatternTopN,
    ftsTopK,
    categoryMap: null,
    withDb,
    withEngineDb,
    withCoreDb,
    kgAccessMode,
    kgIsolationRequested,
    kgIsolationFallbackReason,
    normalizeCandidate: row => normalizeExternalMemory(row, {
      nowSec,
      calcRealtimeConf,
      categoryMap: null,
    }),
    filterForRerank: item => isCandidateAllowedForRerank(item, minConfidence),
    enrichLexicalCandidate,
    inferCategoryFromChunk,
    lexicalMatchScore: kgShadowLexicalMatchScore,
    toDebugErrorMessage: error => String(error?.message || error),
    warnHybridSearchOnce: warnAndRecord,
  };
}

function summarizeRun(ctx, durationMs) {
  const candidates = Array.isArray(ctx.channels.kg) ? ctx.channels.kg : [];
  return {
    kg_raw: Number(ctx.candidateCounts.kg_raw || 0),
    kg_after_conf_filter: Number(ctx.candidateCounts.kg_after_conf_filter || 0),
    candidate_count: candidates.length,
    candidate_summaries: candidates.map((candidate, index) => summarizeCandidate(candidate, index)),
    kg_access_mode: Object.hasOwn(ctx.debug, "kg_access_mode") ? ctx.debug.kg_access_mode : null,
    fallback_reason: Object.hasOwn(ctx.debug, "kg_isolated_fallback_reason")
      ? ctx.debug.kg_isolated_fallback_reason
      : null,
    error: ctx.debug.kg_error
      ? sanitizeError({ message: ctx.debug.kg_error })
      : null,
    duration_ms: round4(durationMs),
  };
}

async function executeKgShadowRun({
  queryText,
  mode,
  withDb,
  withEngineDb,
  withCoreDb,
  nowSec,
  minConfidence,
  ftsTopK,
  likePatternTopN,
  fallbackReason = null,
}) {
  const ctx = buildKgChannelContext({
    queryText,
    withDb,
    withEngineDb,
    withCoreDb,
    kgAccessMode: mode,
    kgIsolationRequested: mode !== "legacy" || fallbackReason !== null,
    kgIsolationFallbackReason: fallbackReason,
    nowSec,
    minConfidence,
    ftsTopK,
    likePatternTopN,
  });
  const started = performance.now();
  await collectKgCandidates(ctx);
  const durationMs = performance.now() - started;
  return {
    ctx,
    summary: summarizeRun(ctx, durationMs),
  };
}

export function compareKgShadowRuns({
  query,
  legacy,
  isolatedRequested,
} = {}) {
  const rawHit = (legacy?.kg_raw || 0) > 0 || (isolatedRequested?.kg_raw || 0) > 0;
  const positiveCandidateEvidence =
    (legacy?.candidate_count || 0) > 0
    && (isolatedRequested?.candidate_count || 0) > 0;
  if (query?.empty) {
    return {
      equivalent: false,
      classification: "skipped_empty_query",
      raw_hit: rawHit,
      positive_candidate_evidence: positiveCandidateEvidence,
      raw_count_equal: false,
      post_filter_count_equal: false,
      ordered_ids_equal: false,
      row_fingerprints_equal: false,
    };
  }

  if (legacy.error && isolatedRequested.error) {
    return {
      equivalent: false,
      classification: "both_error",
      raw_hit: rawHit,
      positive_candidate_evidence: positiveCandidateEvidence,
      raw_count_equal: false,
      post_filter_count_equal: false,
      ordered_ids_equal: false,
      row_fingerprints_equal: false,
    };
  }
  if (legacy.error) {
    return {
      equivalent: false,
      classification: "legacy_error",
      raw_hit: rawHit,
      positive_candidate_evidence: positiveCandidateEvidence,
      raw_count_equal: false,
      post_filter_count_equal: false,
      ordered_ids_equal: false,
      row_fingerprints_equal: false,
    };
  }
  if (isolatedRequested.error) {
    return {
      equivalent: false,
      classification: "isolated_error",
      raw_hit: rawHit,
      positive_candidate_evidence: positiveCandidateEvidence,
      raw_count_equal: false,
      post_filter_count_equal: false,
      ordered_ids_equal: false,
      row_fingerprints_equal: false,
    };
  }

  const rawCountEqual = legacy.kg_raw === isolatedRequested.kg_raw;
  const postFilterCountEqual = legacy.kg_after_conf_filter === isolatedRequested.kg_after_conf_filter;
  const legacyIdHashes = legacy.candidate_summaries.map(item => item.id_hash);
  const isolatedIdHashes = isolatedRequested.candidate_summaries.map(item => item.id_hash);
  const orderedIdsEqual = JSON.stringify(legacyIdHashes) === JSON.stringify(isolatedIdHashes);
  const legacyFingerprints = legacy.candidate_summaries.map(item => item.row_fingerprint);
  const isolatedFingerprints = isolatedRequested.candidate_summaries.map(item => item.row_fingerprint);
  const rowFingerprintsEqual = JSON.stringify(legacyFingerprints) === JSON.stringify(isolatedFingerprints);

  if (isolatedRequested.kg_access_mode === "legacy_fallback") {
    return {
      equivalent: rawCountEqual && postFilterCountEqual && orderedIdsEqual && rowFingerprintsEqual,
      classification: rawCountEqual && postFilterCountEqual && orderedIdsEqual && rowFingerprintsEqual
        ? "guarded_legacy_fallback_equivalent"
        : "mismatch",
      raw_hit: rawHit,
      positive_candidate_evidence: positiveCandidateEvidence,
      raw_count_equal: rawCountEqual,
      post_filter_count_equal: postFilterCountEqual,
      ordered_ids_equal: orderedIdsEqual,
      row_fingerprints_equal: rowFingerprintsEqual,
    };
  }

  const equivalent = rawCountEqual && postFilterCountEqual && orderedIdsEqual && rowFingerprintsEqual;
  return {
    equivalent,
    classification: equivalent ? "isolated_equivalent" : "mismatch",
    raw_hit: rawHit,
    positive_candidate_evidence: positiveCandidateEvidence,
    raw_count_equal: rawCountEqual,
    post_filter_count_equal: postFilterCountEqual,
    ordered_ids_equal: orderedIdsEqual,
    row_fingerprints_equal: rowFingerprintsEqual,
  };
}

function deriveDecision({
  topologyValid,
  databaseStable,
  comparisons,
  summary,
}) {
  if (!topologyValid) {
    return {
      class: "fail",
      reason: "invalid_topology",
      production_enablement_recommended: false,
    };
  }
  if (!databaseStable) {
    return {
      class: "inconclusive",
      reason: "inconclusive_database_changed",
      production_enablement_recommended: false,
    };
  }

  const valid = comparisons.filter(item => item.comparison.classification !== "skipped_empty_query");
  if (valid.length === 0) {
    return {
      class: "inconclusive",
      reason: "no_effective_queries",
      production_enablement_recommended: false,
    };
  }
  if (valid.some(item => ["mismatch", "legacy_error", "isolated_error", "both_error"].includes(item.comparison.classification))) {
    const mismatch = valid.find(item => ["mismatch", "legacy_error", "isolated_error", "both_error"].includes(item.comparison.classification));
    return {
      class: "fail",
      reason: mismatch.comparison.classification,
      production_enablement_recommended: false,
    };
  }

  const isolatedCount = valid.filter(item => item.comparison.classification === "isolated_equivalent").length;
  const guardedCount = valid.filter(item => item.comparison.classification === "guarded_legacy_fallback_equivalent").length;
  if (isolatedCount > 0 && summary.positive_candidate_query_count === 0) {
    return {
      class: "inconclusive",
      reason: "no_positive_candidate_evidence",
      production_enablement_recommended: false,
    };
  }
  if (isolatedCount > 0 && isolatedCount === valid.length) {
    return {
      class: "pass",
      reason: summary.positive_multi_term_query_count >= 1
        ? "all_queries_isolated_equivalent_with_multi_term_evidence"
        : "all_queries_isolated_equivalent_with_broad_probe_only",
      production_enablement_recommended: false,
    };
  }
  if (guardedCount > 0 || isolatedCount > 0) {
    return {
      class: "guarded_only",
      reason: guardedCount > 0 ? "queries_guarded_or_mixed" : "insufficient_isolated_evidence",
      production_enablement_recommended: false,
    };
  }
  return {
    class: "inconclusive",
    reason: "no_effective_queries",
    production_enablement_recommended: false,
  };
}

function summarizeComparisons(comparisons = []) {
  const effective = comparisons.filter(item => item.comparison.classification !== "skipped_empty_query");
  const isolatedEquivalent = effective.filter(item => item.comparison.classification === "isolated_equivalent");
  const positiveCandidate = isolatedEquivalent.filter(item => item.comparison.positive_candidate_evidence);
  return {
    query_count: comparisons.length,
    isolated_equivalent_count: isolatedEquivalent.length,
    guarded_fallback_equivalent_count: effective.filter(item => item.comparison.classification === "guarded_legacy_fallback_equivalent").length,
    mismatch_count: effective.filter(item => item.comparison.classification === "mismatch").length,
    error_count: effective.filter(item => ["legacy_error", "isolated_error", "both_error"].includes(item.comparison.classification)).length,
    skipped_count: comparisons.filter(item => item.comparison.classification === "skipped_empty_query").length,
    raw_hit_query_count: effective.filter(item => item.comparison.raw_hit).length,
    no_raw_hit_query_count: effective.filter(item => !item.comparison.raw_hit).length,
    positive_candidate_query_count: positiveCandidate.length,
    zero_post_filter_query_count: effective.filter(item => item.legacy.candidate_count === 0 && item.isolated_requested.candidate_count === 0).length,
    positive_multi_term_query_count: positiveCandidate.filter(item => item.query.term_count >= 2).length,
    positive_single_term_query_count: positiveCandidate.filter(item => item.query.term_count === 1).length,
    legacy_duration_ms_median: round4(median(comparisons.map(item => item.legacy.duration_ms))),
    isolated_duration_ms_median: round4(median(comparisons.map(item => item.isolated_requested.duration_ms))),
  };
}

function topologyReport({ legacyDb, isolatedEngineDb, isolatedCoreDb }) {
  const legacyNames = databaseNames(legacyDb);
  const isolatedEngineNames = databaseNames(isolatedEngineDb);
  const isolatedCoreNames = databaseNames(isolatedCoreDb);
  const legacyReadonly = legacyDb.readonly === true;
  const isolatedEngineReadonly = isolatedEngineDb.readonly === true;
  const isolatedCoreReadonly = isolatedCoreDb.readonly === true;
  const topology = {
    legacy: {
      readonly: legacyReadonly,
      database_names: legacyNames,
    },
    isolated_engine: {
      readonly: isolatedEngineReadonly,
      database_names: isolatedEngineNames,
    },
    isolated_core: {
      readonly: isolatedCoreReadonly,
      database_names: isolatedCoreNames,
    },
  };
  const valid = legacyReadonly
    && isolatedEngineReadonly
    && isolatedCoreReadonly
    && JSON.stringify(legacyNames) === JSON.stringify(["main", "core"])
    && JSON.stringify(isolatedEngineNames) === JSON.stringify(["main"])
    && JSON.stringify(isolatedCoreNames) === JSON.stringify(["main"]);
  return { topology, valid };
}

function buildStabilitySnapshot({ legacyDb, isolatedEngineDb, isolatedCoreDb, coreDbPath, engineDbPath }) {
  return {
    legacy_data_version: dataVersion(legacyDb),
    isolated_engine_data_version: dataVersion(isolatedEngineDb),
    isolated_core_data_version: dataVersion(isolatedCoreDb),
    core_file: fileSnapshot(coreDbPath),
    engine_file: fileSnapshot(engineDbPath),
  };
}

function compareStability(before, after) {
  return {
    stable:
      before.legacy_data_version === after.legacy_data_version
      && before.isolated_engine_data_version === after.isolated_engine_data_version
      && before.isolated_core_data_version === after.isolated_core_data_version
      && before.core_file.size === after.core_file.size
      && before.core_file.mtimeMs === after.core_file.mtimeMs
      && before.engine_file.size === after.engine_file.size
      && before.engine_file.mtimeMs === after.engine_file.mtimeMs,
    legacy_data_version_before: before.legacy_data_version,
    legacy_data_version_after: after.legacy_data_version,
    isolated_engine_data_version_before: before.isolated_engine_data_version,
    isolated_engine_data_version_after: after.isolated_engine_data_version,
    isolated_core_data_version_before: before.isolated_core_data_version,
    isolated_core_data_version_after: after.isolated_core_data_version,
    core_file_changed:
      before.core_file.size !== after.core_file.size
      || before.core_file.mtimeMs !== after.core_file.mtimeMs,
    engine_file_changed:
      before.engine_file.size !== after.engine_file.size
      || before.engine_file.mtimeMs !== after.engine_file.mtimeMs,
  };
}

function deriveFromKgData({ isolatedEngineDb, limit }) {
  const rows = isolatedEngineDb.prepare(`
    SELECT
      kg_data
    FROM memory_confidence
    WHERE COALESCE(is_archived, 0) = 0
      AND kg_data IS NOT NULL
      AND kg_data != ''
      AND typeof(kg_data) = 'text'
    ORDER BY typeof(chunk_id) ASC, hex(chunk_id) ASC
    LIMIT ?
  `).all(limit);
  return rows.map(row => String(row.kg_data || ""));
}

export async function runKgShadowAudit(options = {}) {
  const {
    legacyDb,
    isolatedEngineDb,
    isolatedCoreDb,
    coreDbPath,
    engineDbPath,
    queries = [],
    queriesFile = null,
    deriveFromKg = 0,
    includeNoHitControl = false,
    topK = 20,
    likePatternTopN = 8,
    minConfidence = 0.15,
    nowSec = Math.floor(Date.now() / 1000),
    closeHandles = false,
  } = options;

  if (!legacyDb || !isolatedEngineDb || !isolatedCoreDb) {
    throw new Error("kg shadow audit requires legacyDb, isolatedEngineDb, and isolatedCoreDb");
  }
  if (!coreDbPath || !engineDbPath) {
    throw new Error("kg shadow audit requires coreDbPath and engineDbPath");
  }

  let report;
  try {
    const { topology, valid: topologyValid } = topologyReport({ legacyDb, isolatedEngineDb, isolatedCoreDb });
    const before = buildStabilitySnapshot({ legacyDb, isolatedEngineDb, isolatedCoreDb, coreDbPath, engineDbPath });
    const engineInvariantRows = isolatedEngineDb.prepare("SELECT chunk_id FROM memory_confidence").all();
    const coreInvariantRows = isolatedCoreDb.prepare("SELECT id FROM chunks").all();
    const kgTextIdInvariant = evaluateKgTextIdInvariant({
      engineRows: engineInvariantRows,
      coreRows: coreInvariantRows,
    });
    const isolatedAccessDecision = resolveKgAccessDecision({
      isolatedKgCapability: true,
      invariant: kgTextIdInvariant,
    });

    const derivedKgRows = deriveFromKg > 0
      ? deriveFromKgData({ isolatedEngineDb, limit: deriveFromKg })
      : [];
    const queryCorpus = deriveKgShadowQueries({
      queries,
      queriesFile,
      derivedKgRows,
      includeNoHitControl,
    });
    const queryDescriptors = queryCorpus.descriptors;

    const comparisons = [];
    for (const descriptor of queryDescriptors) {
      if (descriptor.empty) {
        comparisons.push({
          query: descriptor.query,
          legacy: {
            kg_raw: 0,
            kg_after_conf_filter: 0,
            candidate_count: 0,
            candidate_summaries: [],
            error: null,
            duration_ms: 0,
          },
          isolated_requested: {
            kg_raw: 0,
            kg_after_conf_filter: 0,
            candidate_count: 0,
            candidate_summaries: [],
            kg_access_mode: isolatedAccessDecision.mode === "isolated" ? "isolated" : "legacy_fallback",
            fallback_reason: isolatedAccessDecision.fallback_reason,
            error: null,
            duration_ms: 0,
          },
          comparison: compareKgShadowRuns({
            query: descriptor,
            legacy: { error: null, kg_raw: 0, kg_after_conf_filter: 0, candidate_summaries: [] },
            isolatedRequested: { error: null, kg_raw: 0, kg_after_conf_filter: 0, candidate_summaries: [] },
          }),
        });
        continue;
      }

      const legacyRun = await executeKgShadowRun({
        queryText: descriptor.text,
        mode: "legacy",
        withDb: fn => fn(legacyDb),
        withEngineDb: fn => fn(isolatedEngineDb),
        withCoreDb: fn => fn(isolatedCoreDb),
        nowSec,
        minConfidence,
        ftsTopK: topK,
        likePatternTopN,
      });
      const isolatedRun = await executeKgShadowRun({
        queryText: descriptor.text,
        mode: isolatedAccessDecision.mode,
        withDb: fn => fn(legacyDb),
        withEngineDb: fn => fn(isolatedEngineDb),
        withCoreDb: fn => fn(isolatedCoreDb),
        nowSec,
        minConfidence,
        ftsTopK: topK,
        likePatternTopN,
        fallbackReason: isolatedAccessDecision.fallback_reason,
      });

      comparisons.push({
        query: descriptor.query,
        legacy: legacyRun.summary,
        isolated_requested: isolatedRun.summary,
        comparison: compareKgShadowRuns({
          query: descriptor,
          legacy: legacyRun.summary,
          isolatedRequested: isolatedRun.summary,
        }),
      });
    }

    const after = buildStabilitySnapshot({ legacyDb, isolatedEngineDb, isolatedCoreDb, coreDbPath, engineDbPath });
    const databaseStability = compareStability(before, after);
    const summary = summarizeComparisons(comparisons);
    const decision = deriveDecision({
      topologyValid,
      databaseStable: databaseStability.stable,
      comparisons,
      summary,
    });

    report = {
      audit: "isolated_kg_shadow",
      topology,
      kg_text_id_invariant: kgTextIdInvariant,
      isolated_access_decision: isolatedAccessDecision,
      database_stability: databaseStability,
      query_corpus: queryCorpus.stats,
      queries: comparisons,
      summary,
      decision,
    };
    return report;
  } finally {
    if (closeHandles) {
      for (const db of [legacyDb, isolatedEngineDb, isolatedCoreDb]) {
        if (db?.open) db.close();
      }
    }
  }
}

export function validateShadowAuditOptions(options = {}) {
  if (Array.isArray(options.argv)) {
    for (const arg of options.argv) {
      if (MUTATION_FLAGS.has(arg)) {
        throw new Error(`read-only audit rejects mutation flag: ${arg}`);
      }
    }
  }
  if ((!Array.isArray(options.queries) || options.queries.length === 0) && !options.queriesFile && !(Number(options.deriveFromKg) > 0)) {
    throw new Error("read-only audit requires --query, --queries-file, or --derive-from-kg");
  }
  if (!Number.isInteger(options.topK) || options.topK < 1 || options.topK > 1000) {
    throw new Error("read-only audit requires --top-k to be an integer between 1 and 1000");
  }
  if (!Number.isInteger(options.likePatternTopN) || options.likePatternTopN < 1 || options.likePatternTopN > 100) {
    throw new Error("read-only audit requires --like-pattern-top-n to be an integer between 1 and 100");
  }
  if (!Number.isFinite(options.minConfidence) || options.minConfidence < 0 || options.minConfidence > 1) {
    throw new Error("read-only audit requires --min-confidence to be between 0 and 1");
  }
  if (!Number.isInteger(options.deriveFromKg) || options.deriveFromKg < 0 || options.deriveFromKg > 1000) {
    throw new Error("read-only audit requires --derive-from-kg to be an integer between 0 and 1000");
  }
}

export function writeShadowAuditReport(output, outPath) {
  const target = resolve(String(outPath));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, String(output), "utf8");
}

export function assertShadowAuditPrivacy(report, forbiddenValues = []) {
  return noSensitiveText(JSON.stringify(report), forbiddenValues);
}

export function assertShadowAuditPathsExist({ coreDbPath, engineDbPath }) {
  if (!existsSync(coreDbPath)) throw new Error(`read-only audit core DB not found: ${coreDbPath}`);
  if (!existsSync(engineDbPath)) throw new Error(`read-only audit engine DB not found: ${engineDbPath}`);
}

export {
  MUTATION_FLAGS,
  NO_HIT_CONTROL_QUERY,
};
