import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import {
  normalizeFtsQuery,
  stripPromptMetadataPrefix,
} from "../../../query-utils.js";
import { calcRealtimeConf } from "../../memory-confidence.js";
import { getDefaultMemoryEngineConfig } from "../../config/defaults.js";
import { collectRecentCandidates } from "./channels/recent.js";
import { createCandidateCounts, createHybridDebug, createHybridWarnings } from "./debug.js";
import { enrichLexicalCandidate, tokenizeQuery } from "./lexical.js";
import {
  inferCategoryFromChunk,
  isCandidateAllowedForRerank,
  normalizeExternalMemory,
  normalizeUnixSeconds,
  round4,
  toFiniteNumber,
} from "./normalize-candidate.js";
import {
  computeRecencyBoost,
} from "./fusion.js";
import {
  evaluateRecentTextIdInvariant,
  inspectRecentIsolationTopology,
  mergeRecentMetadataRows,
  resolveRecentAccessDecision,
} from "./recent-access.js";

export const NO_HIT_CONTROL_QUERY = "__memory_engine_isolated_recent_shadow_no_hit_control_b83c4f__";
export const RECENT_SHADOW_MUTATION_FLAGS = new Set([
  "--apply",
  "--force",
  "--write-db",
  "--delete",
  "--update",
  "--insert",
  "--repair",
  "--migrate",
  "--no-backup",
]);

const RAW_ROW_FIELDS = [
  "id",
  "text",
  "path",
  "updated_at",
  "confidence",
  "last_confidence_update",
  "base_tau",
  "hit_count",
  "hits",
  "is_protected",
  "conflict_flag",
  "category",
  "is_archived",
];

const NORMALIZED_CANDIDATE_FIELDS = [
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
  "similarity",
  "semantic_score",
  "created_at",
  "token_coverage",
  "exact_bonus",
  "structured_match_bonus",
  "source_type",
];

const RECENT_DOMAIN_SQL = `
  SELECT
    c.id,
    c.text,
    c.path,
    c.updated_at,
    COALESCE(mc.is_archived, 0) AS is_archived
  FROM chunks c
  LEFT JOIN memory_confidence mc
    ON c.id = mc.chunk_id
  WHERE COALESCE(mc.is_archived, 0) = 0
    AND c.path NOT LIKE 'memory/generated-smart-add/%'
    AND (c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')
  ORDER BY c.updated_at DESC, c.id ASC
  LIMIT ?
`;

function sha256Hex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function shortHash(value) {
  return sha256Hex(value).slice(0, 16);
}

function stableSerialize(value) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Buffer.isBuffer(value)) return JSON.stringify({ type: "Buffer", hex: value.toString("hex") });
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function fingerprintRecentShadowValue(value) {
  return sha256Hex(stableSerialize(value));
}

export function canonicalizeRecentShadowRawRow(row = {}) {
  const canonical = {};
  for (const field of RAW_ROW_FIELDS) {
    canonical[field] = Object.hasOwn(row, field) ? row[field] : null;
  }
  return canonical;
}

export function canonicalizeRecentShadowCandidate(candidate = {}) {
  const canonical = {};
  for (const field of NORMALIZED_CANDIDATE_FIELDS) {
    canonical[field] = Object.hasOwn(candidate, field) ? candidate[field] : null;
  }
  return canonical;
}

function summarizeFingerprintRecord({ canonical, position }) {
  return {
    position,
    id_hash: shortHash(canonical.id),
    path_hash: shortHash(canonical.path),
    row_fingerprint: fingerprintRecentShadowValue(canonical),
  };
}

function summarizeRawRows(rows = []) {
  return rows.map((row, position) => summarizeFingerprintRecord({
    canonical: canonicalizeRecentShadowRawRow(row),
    position,
  }));
}

function summarizeCandidates(rows = []) {
  return rows.map((row, position) => summarizeFingerprintRecord({
    canonical: canonicalizeRecentShadowCandidate(row),
    position,
  }));
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

function sanitizeError(error) {
  if (!error) return null;
  return {
    code: error.code ? String(error.code) : null,
    message: String(error.message || error),
  };
}

function databaseNames(db) {
  return db.prepare("PRAGMA database_list").all().map(row => String(row.name || ""));
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
    inode: Number(stat.ino || 0),
  };
}

function sameFileSnapshot(a, b) {
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.inode === b.inode;
}

function stableJsonString(value) {
  return JSON.stringify(value);
}

function fixedNowSec(options = {}) {
  return Number.isInteger(options.auditNowSec)
    ? options.auditNowSec
    : Math.floor(Date.now() / 1000);
}

export function recentShadowLexicalMatchScore(haystack, terms) {
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

function defaultRuntimeParameters(options = {}) {
  const defaults = getDefaultMemoryEngineConfig?.() || {};
  const recall = defaults.recall || {};
  const confidence = defaults.confidence || {};
  return {
    minConfidence: toFiniteNumber(options.minConfidence)
      ?? toFiniteNumber(confidence.min)
      ?? 0.15,
    likePatternTopN: Math.max(1, Number(options.likePatternTopN) || Number(recall.likePatternTopN) || 8),
    likeTopK: Math.max(1, Number(options.likeTopK) || Number(recall.likeTopK) || 30),
    recentTopK: Math.max(1, Number(options.recentTopK) || Number(recall.recentTopK) || 120),
    recentRerankTopK: Math.max(1, Number(options.recentRerankTopK) || Number(recall.recentRerankTopK) || 20),
    recentFallbackTopK: Math.max(1, Number(options.recentFallbackTopK) || Number(recall.recentFallbackTopK) || 20),
  };
}

function buildQueryDescriptor(rawText, sourceType) {
  const text = String(rawText ?? "");
  const limited = text.slice(0, 1200);
  const stripped = stripPromptMetadataPrefix(limited);
  const normalized = normalizeFtsQuery(stripped);
  const queryTerms = tokenizeQuery(normalized).filter(Boolean);
  return {
    text: limited,
    query: {
      query_id: shortHash(limited),
      source_type: sourceType,
      query_length: limited.length,
      line_count: limited === "" ? 0 : limited.split(/\r?\n/u).length,
      term_count: queryTerms.length,
    },
    empty: stripped.trim() === "",
  };
}

function parseQueriesFile(queriesFile) {
  const text = readFileSync(resolve(String(queriesFile)), "utf8");
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("queries file JSON must be an array");
    return parsed.map(value => String(value));
  }
  return text
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"));
}

function deriveRowsForQueries(legacyDb, deriveLimit) {
  return legacyDb.prepare(RECENT_DOMAIN_SQL).all(deriveLimit).map(row => ({
    text: String(row.text ?? ""),
    path: String(row.path ?? ""),
    is_episode: String(row.path ?? "").startsWith("memory/episodes/"),
  }));
}

export function deriveRecentShadowQueries({
  queries = [],
  queriesFile = null,
  derivedRows = [],
  includeNoHitControl = true,
} = {}) {
  const descriptors = [];
  const stats = {
    explicit_input_count: 0,
    file_input_count: 0,
    derived_source_row_count: Array.isArray(derivedRows) ? derivedRows.length : 0,
    derived_valid_query_count: 0,
    derived_duplicate_query_count: 0,
    no_hit_control_count: includeNoHitControl ? 1 : 0,
    final_unique_query_count: 0,
  };

  for (const query of queries) {
    stats.explicit_input_count += 1;
    descriptors.push(buildQueryDescriptor(query, "explicit_query"));
  }

  if (queriesFile) {
    for (const query of parseQueriesFile(queriesFile)) {
      stats.file_input_count += 1;
      descriptors.push(buildQueryDescriptor(query, "file_query"));
    }
  }

  const derivedSeen = new Set();
  for (const row of derivedRows) {
    const full = buildQueryDescriptor(row.text, "derived_full_query");
    if (!full.empty) {
      const key = sha256Hex(full.text);
      if (derivedSeen.has(key)) stats.derived_duplicate_query_count += 1;
      else {
        derivedSeen.add(key);
        stats.derived_valid_query_count += 1;
      }
      descriptors.push(full);
    }

    const normalized = normalizeFtsQuery(stripPromptMetadataPrefix(String(row.text ?? "")));
    const terms = tokenizeQuery(normalized).filter(Boolean);
    for (const count of [1, 2, 3]) {
      if (terms.length < count) break;
      const probe = buildQueryDescriptor(terms.slice(0, count).join(" "), `derived_term_probe_${count}`);
      const key = sha256Hex(probe.text);
      if (derivedSeen.has(key)) stats.derived_duplicate_query_count += 1;
      else {
        derivedSeen.add(key);
        stats.derived_valid_query_count += 1;
      }
      descriptors.push(probe);
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

function buildContext({
  queryText,
  nowSec,
  minConfidence,
  likePatternTopN,
  likeTopK,
  recentTopK,
  recentRerankTopK,
  recentFallbackTopK,
  ftsIsEmpty,
  withDb,
  withCoreDb,
  withEngineDb,
  recentAccessMode,
  recentIsolationRequested,
  recentIsolationFallbackReason,
}) {
  const rawQuery = String(queryText || "");
  const strippedQuery = stripPromptMetadataPrefix(rawQuery);
  const normalizedQuery = normalizeFtsQuery(strippedQuery);
  const queryTerms = tokenizeQuery(normalizedQuery).filter(Boolean);
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
    channels,
    debug,
    candidateCounts,
    warnings,
    nowSec,
    normalizedQuery,
    strippedQuery,
    queryTerms,
    likePatternTopN,
    likeTopK,
    recentTopK,
    recentRerankTopK,
    recentFallbackTopK,
    rankingConfig: {},
    categoryMap: null,
    normalizeCandidate: row => normalizeExternalMemory(row, {
      nowSec,
      calcRealtimeConf,
      categoryMap: null,
    }),
    filterForRerank: item => isCandidateAllowedForRerank(item, minConfidence),
    enrichLexicalCandidate,
    inferCategoryFromChunk,
    lexicalMatchScore: recentShadowLexicalMatchScore,
    computeRecencyBoost,
    normalizeUnixSeconds,
    toFiniteNumber,
    toDebugErrorMessage: error => String(error?.message || error),
    warnHybridSearchOnce: warnAndRecord,
    uniqueVectorChannels: () => false,
    withDb,
    withCoreDb,
    withEngineDb,
    ftsIsEmpty,
    recentAccessMode,
    recentIsolationRequested,
    recentIsolationFallbackReason,
  };
}

function classifyTrace(sql, state) {
  const text = String(sql || "");
  if (text.includes("COALESCE(is_archived, 0) != 0")) return "archived_engine";
  if (text.includes("WITH selected AS") && text.includes("FROM memory_confidence mc")) return "metadata_engine";
  if (text.includes("(c.path LIKE ? OR c.text LIKE ?)")) return "like_fallback";
  if (text.includes("c.path LIKE 'memory/smart-add/%'") && text.includes("c.path LIKE 'memory/episodes/%'")) {
    state.recentDomainCount += 1;
    return state.recentDomainCount === 1 ? "recent_scored" : "recent_fallback";
  }
  if (text.includes("PRAGMA database_list")) return "topology";
  return "other";
}

function createRecordingAccessor(db, name, trace) {
  const state = { recentDomainCount: 0 };
  return run => run({
    readonly: db.readonly,
    prepare(sql) {
      const branch = classifyTrace(sql, state);
      let statement;
      try {
        statement = db.prepare(sql);
      } catch (error) {
        trace.push({
          db: name,
          branch,
          sql: String(sql),
          params: [],
          error: sanitizeError(error),
        });
        throw error;
      }
      return {
        all(...params) {
          try {
            const rows = statement.all(...params);
            trace.push({
              db: name,
              branch,
              sql: String(sql),
              params,
              rows,
            });
            return rows;
          } catch (error) {
            trace.push({
              db: name,
              branch,
              sql: String(sql),
              params,
              error: sanitizeError(error),
            });
            throw error;
          }
        },
        get(...params) {
          try {
            const row = statement.get(...params);
            trace.push({
              db: name,
              branch,
              sql: String(sql),
              params,
              row,
            });
            return row;
          } catch (error) {
            trace.push({
              db: name,
              branch,
              sql: String(sql),
              params,
              error: sanitizeError(error),
            });
            throw error;
          }
        },
      };
    },
  });
}

function branchRawRows(trace, branch) {
  return trace
    .filter(entry => entry.branch === branch && Array.isArray(entry.rows))
    .flatMap(entry => entry.rows);
}

function mergedIsolatedBranchRows(trace, branch) {
  const coreRows = trace
    .filter(entry => entry.db === "core" && entry.branch === branch && Array.isArray(entry.rows))
    .flatMap(entry => entry.rows);
  const metadataRows = trace
    .filter(entry => entry.db === "engine" && entry.branch === "metadata_engine" && Array.isArray(entry.rows))
    .flatMap(entry => entry.rows);
  return mergeRecentMetadataRows(coreRows, metadataRows);
}

function summarizeBranchRaw(trace, branch, accessMode) {
  const rows = accessMode === "isolated"
    ? mergedIsolatedBranchRows(trace, branch)
    : branchRawRows(trace, branch);
  return {
    raw_count: rows.length,
    raw_summaries: summarizeRawRows(rows),
  };
}

function summarizeChannelCandidates(channels, branch) {
  const rows = Array.isArray(channels?.[branch]) ? channels[branch] : [];
  return {
    candidate_count: rows.length,
    candidate_summaries: summarizeCandidates(rows),
  };
}

function normalizeAccessMode(summary, defaultMode) {
  return summary.debug?.recent_access_mode || defaultMode;
}

function summarizeRun({ ctx, trace, durationMs, defaultAccessMode }) {
  const accessMode = normalizeAccessMode(ctx, defaultAccessMode);
  const branches = {
    like_fallback: {
      ...summarizeBranchRaw(trace, "like_fallback", accessMode),
      ...summarizeChannelCandidates(ctx.channels, "like"),
    },
    recent_scored: {
      ...summarizeBranchRaw(trace, "recent_scored", accessMode),
      ...summarizeChannelCandidates(ctx.channels, "recent"),
    },
    episode_projection: summarizeChannelCandidates(ctx.channels, "episode"),
    recent_fallback: {
      ...summarizeBranchRaw(trace, "recent_fallback", accessMode),
      ...summarizeChannelCandidates(ctx.channels, "recent_fallback"),
    },
  };

  const isolatedDebugCounts = {
    archived_engine_query_count: Number(ctx.debug.recent_isolated_engine_query_count ?? 0) > 0
      ? 1
      : 0,
    metadata_engine_query_count: Number(ctx.debug.recent_isolated_metadata_query_count ?? 0),
    engine_query_count_total: Number(ctx.debug.recent_isolated_engine_query_count ?? 0)
      + Number(ctx.debug.recent_isolated_metadata_query_count ?? 0),
    core_query_count: Number(ctx.debug.recent_isolated_core_query_count ?? 0),
  };

  const wrapperCounts = {
    archived_engine_query_count: trace.filter(entry => entry.db === "engine" && entry.branch === "archived_engine").length,
    metadata_engine_query_count: trace.filter(entry => entry.db === "engine" && entry.branch === "metadata_engine").length,
    core_query_count: trace.filter(entry => entry.db === "core" && ["like_fallback", "recent_scored", "recent_fallback"].includes(entry.branch)).length,
  };
  wrapperCounts.engine_query_count_total =
    wrapperCounts.archived_engine_query_count + wrapperCounts.metadata_engine_query_count;

  const orderedDebugCounts = {
    archived_engine_query_count: isolatedDebugCounts.archived_engine_query_count,
    metadata_engine_query_count: isolatedDebugCounts.metadata_engine_query_count,
    core_query_count: isolatedDebugCounts.core_query_count,
    engine_query_count_total: isolatedDebugCounts.engine_query_count_total,
  };
  const orderedWrapperCounts = {
    archived_engine_query_count: wrapperCounts.archived_engine_query_count,
    metadata_engine_query_count: wrapperCounts.metadata_engine_query_count,
    core_query_count: wrapperCounts.core_query_count,
    engine_query_count_total: wrapperCounts.engine_query_count_total,
  };

  const queryCountContractAmbiguous =
    orderedDebugCounts.engine_query_count_total !== 0
    && stableJsonString(orderedDebugCounts) !== stableJsonString(orderedWrapperCounts);

  return {
    recent_access_mode: accessMode,
    fallback_reason: ctx.debug.recent_isolated_fallback_reason ?? null,
    error: ctx.debug.recent_error ? sanitizeError({ message: ctx.debug.recent_error }) : null,
    candidate_counts: {
      like_raw: Number(ctx.candidateCounts.like_raw || 0),
      recent_raw: Number(ctx.candidateCounts.recent_raw || 0),
      episode_raw: Number(ctx.candidateCounts.episode_raw || 0),
      recent_fallback_raw: Number(ctx.candidateCounts.recent_fallback_raw || 0),
    },
    branches,
    query_counts: orderedWrapperCounts,
    debug_query_counts: orderedDebugCounts,
    query_count_contract_ambiguous: queryCountContractAmbiguous,
    archived_payload: ctx.recentIsolationRequested === true ? {
      row_count: Number(ctx.debug.recent_archived_row_count ?? 0),
      unique_id_count: Number(ctx.debug.recent_archived_unique_id_count ?? 0),
      duplicate_id_count: Number(ctx.debug.recent_archived_duplicate_id_count ?? 0),
      json_utf8_bytes: Number(ctx.debug.recent_archived_json_bytes ?? 0),
      max_id_utf8_bytes: Number(ctx.debug.recent_archived_max_id_bytes ?? 0),
      payload_large: ctx.debug.recent_archived_payload_large === true,
    } : null,
    duration_ms: round4(durationMs),
  };
}

async function executeScenarioRun({
  queryText,
  scenario,
  withDb,
  withCoreDb,
  withEngineDb,
  recentAccessMode,
  recentIsolationRequested,
  recentIsolationFallbackReason,
  nowSec,
  parameters,
  defaultAccessMode,
}) {
  const trace = [];
  const ctx = buildContext({
    queryText,
    nowSec,
    minConfidence: parameters.minConfidence,
    likePatternTopN: parameters.likePatternTopN,
    likeTopK: parameters.likeTopK,
    recentTopK: parameters.recentTopK,
    recentRerankTopK: parameters.recentRerankTopK,
    recentFallbackTopK: parameters.recentFallbackTopK,
    ftsIsEmpty: scenario.ftsIsEmpty,
    withDb: createRecordingAccessor(withDb, "legacy", trace),
    withCoreDb: createRecordingAccessor(withCoreDb, "core", trace),
    withEngineDb: createRecordingAccessor(withEngineDb, "engine", trace),
    recentAccessMode,
    recentIsolationRequested,
    recentIsolationFallbackReason,
  });

  const started = performance.now();
  await collectRecentCandidates(ctx);
  const durationMs = performance.now() - started;
  return {
    ctx,
    summary: summarizeRun({ ctx, trace, durationMs, defaultAccessMode }),
  };
}

function compareFingerprintLists(left, right) {
  return stableJsonString(left) === stableJsonString(right);
}

function branchComparison(legacyBranch, isolatedBranch) {
  return {
    raw_count_equal: legacyBranch.raw_count === isolatedBranch.raw_count,
    raw_ordered_ids_equal: compareFingerprintLists(
      legacyBranch.raw_summaries?.map(item => item.id_hash) || [],
      isolatedBranch.raw_summaries?.map(item => item.id_hash) || [],
    ),
    raw_fingerprints_equal: compareFingerprintLists(
      legacyBranch.raw_summaries?.map(item => item.row_fingerprint) || [],
      isolatedBranch.raw_summaries?.map(item => item.row_fingerprint) || [],
    ),
    candidate_count_equal: legacyBranch.candidate_count === isolatedBranch.candidate_count,
    ordered_ids_equal: compareFingerprintLists(
      legacyBranch.candidate_summaries?.map(item => item.id_hash) || [],
      isolatedBranch.candidate_summaries?.map(item => item.id_hash) || [],
    ),
    normalized_fingerprints_equal: compareFingerprintLists(
      legacyBranch.candidate_summaries?.map(item => item.row_fingerprint) || [],
      isolatedBranch.candidate_summaries?.map(item => item.row_fingerprint) || [],
    ),
  };
}

function allTrue(values = []) {
  return values.every(Boolean);
}

export function compareRecentShadowRuns({
  legacy,
  isolatedRequested,
  scenario,
} = {}) {
  const branchNames = ["like_fallback", "recent_scored", "episode_projection", "recent_fallback"];
  if (legacy.error || isolatedRequested.error) {
    return {
      classification: "error",
      equivalent: false,
      positive_candidate_evidence: false,
      query_count_contract_ambiguous: Boolean(isolatedRequested.query_count_contract_ambiguous),
      branches: {},
    };
  }

  if (isolatedRequested.query_count_contract_ambiguous) {
    return {
      classification: "error",
      equivalent: false,
      positive_candidate_evidence: false,
      query_count_contract_ambiguous: true,
      branches: {},
      reason: "ambiguous_engine_query_count_contract",
    };
  }

  const candidateCountsEqual =
    stableJsonString(legacy.candidate_counts) === stableJsonString(isolatedRequested.candidate_counts);

  const branches = Object.fromEntries(branchNames.map(name => [
    name,
    branchComparison(legacy.branches[name], isolatedRequested.branches[name]),
  ]));

  const branchEqual = Object.values(branches).every(result => allTrue(Object.values(result)));
  const positiveCandidateEvidence = branchNames.some(name =>
    legacy.branches[name].candidate_count > 0 && isolatedRequested.branches[name].candidate_count > 0,
  );
  const allChannelsEmpty = branchNames.every(name =>
    legacy.branches[name].candidate_count === 0 && isolatedRequested.branches[name].candidate_count === 0,
  );

  if (isolatedRequested.recent_access_mode === "guarded_fallback") {
    return {
      classification: candidateCountsEqual && branchEqual
        ? (allChannelsEmpty ? "no_positive_candidate_evidence" : "guarded_fallback_equivalent")
        : "mismatch",
      equivalent: candidateCountsEqual && branchEqual,
      positive_candidate_evidence: positiveCandidateEvidence,
      query_count_contract_ambiguous: false,
      branches,
    };
  }

  if (!candidateCountsEqual || !branchEqual) {
    return {
      classification: "mismatch",
      equivalent: false,
      positive_candidate_evidence: positiveCandidateEvidence,
      query_count_contract_ambiguous: false,
      branches,
    };
  }

  if (allChannelsEmpty) {
    return {
      classification: "no_positive_candidate_evidence",
      equivalent: true,
      positive_candidate_evidence: false,
      query_count_contract_ambiguous: false,
      branches,
    };
  }

  return {
    classification: "isolated_equivalent",
    equivalent: true,
    positive_candidate_evidence: positiveCandidateEvidence,
    query_count_contract_ambiguous: false,
    branches,
  };
}

function emptyStorageSummary() {
  return {
    total_count: 0,
    text_count: 0,
    non_text_count: 0,
  };
}

function summarizeSnapshotGuard(coreRows, engineRows, invariant) {
  return {
    core_total: Array.isArray(coreRows) ? coreRows.length : 0,
    core_text_count: invariant?.core?.text_count ?? 0,
    core_non_text_count: invariant?.core?.non_text_count ?? 0,
    engine_total: Array.isArray(engineRows) ? engineRows.length : 0,
    engine_text_count: invariant?.engine?.text_count ?? 0,
    engine_non_text_count: invariant?.engine?.non_text_count ?? 0,
    passed: invariant?.passed === true,
  };
}

export function deriveRecentShadowDecision({
  topology,
  databaseStability,
  scenarios,
  episodeDomainPresent,
}) {
  const topologyValid =
    topology.legacy.readonly === true
    && topology.isolated_core.readonly === true
    && topology.isolated_engine.readonly === true
    && stableJsonString(topology.legacy.database_names) === stableJsonString(["main", "core"])
    && stableJsonString(topology.isolated_core.database_names) === stableJsonString(["main"])
    && stableJsonString(topology.isolated_engine.database_names) === stableJsonString(["main"]);

  if (!topologyValid) {
    return {
      class: "fail",
      reason: "invalid_topology",
      production_enablement_recommended: false,
    };
  }
  if (!databaseStability.stable) {
    return {
      class: "inconclusive",
      reason: "database_changed_during_shadow_audit",
      production_enablement_recommended: false,
    };
  }

  if (scenarios.some(item => item.comparison.query_count_contract_ambiguous)) {
    return {
      class: "inconclusive",
      reason: "ambiguous_engine_query_count_contract",
      production_enablement_recommended: false,
    };
  }

  if (scenarios.some(item => item.comparison.classification === "error")) {
    return {
      class: "fail",
      reason: "recent_error",
      production_enablement_recommended: false,
    };
  }
  if (scenarios.some(item => item.comparison.classification === "mismatch")) {
    return {
      class: "fail",
      reason: "mismatch",
      production_enablement_recommended: false,
    };
  }

  if (scenarios.length === 0) {
    return {
      class: "inconclusive",
      reason: "no_effective_queries",
      production_enablement_recommended: false,
    };
  }

  const isolatedPositive = scenarios.filter(item =>
    item.comparison.classification === "isolated_equivalent" && item.comparison.positive_candidate_evidence,
  );
  const guardedEquivalent =
    scenarios.length > 0
    && scenarios.every(item => item.isolated_requested.recent_access_mode === "guarded_fallback")
    && scenarios.every(item =>
      item.comparison.classification === "guarded_fallback_equivalent"
      || item.comparison.classification === "no_positive_candidate_evidence",
    );

  if (isolatedPositive.length === 0) {
    if (guardedEquivalent) {
      return {
        class: "guarded_only",
        reason: "guarded_fallback_without_isolated_positive_evidence",
        production_enablement_recommended: false,
      };
    }
    return {
      class: "inconclusive",
      reason: "no_positive_candidate_evidence",
      production_enablement_recommended: false,
    };
  }

  const hasFtsNonEmptyPositive = isolatedPositive.some(item => item.scenario.ftsIsEmpty === false);
  const hasFtsEmptyPositive = isolatedPositive.some(item => item.scenario.ftsIsEmpty === true);
  const branchCoverage = {
    like_fallback: isolatedPositive.some(item => item.comparison.branches.like_fallback.candidate_count_equal && item.legacy.branches.like_fallback.candidate_count > 0),
    recent_scored: isolatedPositive.some(item => item.comparison.branches.recent_scored.candidate_count_equal && item.legacy.branches.recent_scored.candidate_count > 0),
    recent_fallback: isolatedPositive.some(item => item.comparison.branches.recent_fallback.candidate_count_equal && item.legacy.branches.recent_fallback.candidate_count > 0),
    episode_projection: isolatedPositive.some(item => item.comparison.branches.episode_projection.candidate_count_equal && item.legacy.branches.episode_projection.candidate_count > 0),
  };

  if (!hasFtsNonEmptyPositive || !hasFtsEmptyPositive) {
    return {
      class: "inconclusive",
      reason: "insufficient_scenario_coverage",
      production_enablement_recommended: false,
    };
  }
  if (!branchCoverage.like_fallback || !branchCoverage.recent_scored || !branchCoverage.recent_fallback) {
    return {
      class: "inconclusive",
      reason: "insufficient_branch_coverage",
      production_enablement_recommended: false,
    };
  }
  if (episodeDomainPresent && !branchCoverage.episode_projection) {
    return {
      class: "inconclusive",
      reason: "episode_projection_not_covered",
      production_enablement_recommended: false,
    };
  }

  return {
    class: "pass",
    reason: "all_recent_scenarios_isolated_equivalent",
    production_enablement_recommended: false,
  };
}

export function defaultRecentShadowScenarios() {
  return [
    { name: "fts_has_results", ftsIsEmpty: false },
    { name: "fts_empty", ftsIsEmpty: true },
  ];
}

function currentSnapshotRelationship(legacyDb, invariant) {
  if (!invariant.passed) {
    return {
      real_snapshot_count: 0,
      real_snapshot_positive_evidence: false,
      synthetic_contract_test_present: true,
    };
  }
  const row = legacyDb.prepare(`
    SELECT COUNT(*) AS count
    FROM chunks c
    LEFT JOIN memory_confidence mc
      ON c.id = mc.chunk_id
    WHERE COALESCE(mc.is_archived, 0) = 0
      AND c.path NOT LIKE 'memory/generated-smart-add/%'
      AND (c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')
      AND mc.chunk_id IS NULL
  `).get();
  const count = Number(row?.count || 0);
  return {
    real_snapshot_count: count,
    real_snapshot_positive_evidence: count > 0,
    synthetic_contract_test_present: true,
  };
}

function episodeDomainPresent(legacyDb) {
  const row = legacyDb.prepare(`
    SELECT COUNT(*) AS count
    FROM chunks c
    LEFT JOIN memory_confidence mc
      ON c.id = mc.chunk_id
    WHERE COALESCE(mc.is_archived, 0) = 0
      AND c.path LIKE 'memory/episodes/%'
  `).get();
  return Number(row?.count || 0) > 0;
}

function buildTopologies({ legacyDb, isolatedCoreDb, isolatedEngineDb }) {
  return {
    legacy: {
      readonly: legacyDb.readonly === true,
      database_names: databaseNames(legacyDb),
    },
    isolated_core: {
      readonly: isolatedCoreDb.readonly === true,
      database_names: databaseNames(isolatedCoreDb),
    },
    isolated_engine: {
      readonly: isolatedEngineDb.readonly === true,
      database_names: databaseNames(isolatedEngineDb),
    },
  };
}

export function assertRecentShadowPrivacy(reportJson, forbiddenValues = []) {
  return forbiddenValues.every(value => value == null || !reportJson.includes(String(value)));
}

export async function runRecentShadowAudit({
  legacyDb,
  isolatedCoreDb,
  isolatedEngineDb,
  coreDbPath,
  engineDbPath,
  queries = [],
  queriesFile = null,
  deriveLimit = 12,
  includeNoHitControl = true,
  scenarios = defaultRecentShadowScenarios(),
  auditNowSec = null,
  minConfidence = null,
  recentTopK = null,
  recentFallbackTopK = null,
  recentRerankTopK = null,
  likePatternTopN = null,
  likeTopK = null,
  afterScenarios = null,
} = {}) {
  if (!legacyDb || !isolatedCoreDb || !isolatedEngineDb) {
    throw new Error("runRecentShadowAudit requires legacyDb, isolatedCoreDb, and isolatedEngineDb");
  }
  const parameters = defaultRuntimeParameters({
    minConfidence,
    recentTopK,
    recentFallbackTopK,
    recentRerankTopK,
    likePatternTopN,
    likeTopK,
  });
  const nowSec = fixedNowSec({ auditNowSec });

  const topology = buildTopologies({ legacyDb, isolatedCoreDb, isolatedEngineDb });
  const before = {
    legacy_data_version: dataVersion(legacyDb),
    isolated_core_data_version: dataVersion(isolatedCoreDb),
    isolated_engine_data_version: dataVersion(isolatedEngineDb),
    core_file: fileSnapshot(coreDbPath),
    engine_file: fileSnapshot(engineDbPath),
  };

  const coreSnapshotRows = isolatedCoreDb.prepare("SELECT id FROM chunks").all();
  const engineSnapshotRows = isolatedEngineDb.prepare("SELECT chunk_id FROM memory_confidence").all();
  const invariant = evaluateRecentTextIdInvariant({
    engineRows: engineSnapshotRows,
    coreRows: coreSnapshotRows,
  });
  const accessDecision = resolveRecentAccessDecision({
    isolatedRecentCapability: true,
    invariant,
    topology: inspectRecentIsolationTopology({
      withCoreDb: run => run(isolatedCoreDb),
      withEngineDb: run => run(isolatedEngineDb),
    }),
  });

  const derivedRows = queries.length === 0 && !queriesFile
    ? deriveRowsForQueries(legacyDb, Math.max(1, Number(deriveLimit) || 12))
    : [];
  const queryCorpus = deriveRecentShadowQueries({
    queries,
    queriesFile,
    derivedRows,
    includeNoHitControl,
  });

  const scenarioResults = [];
  for (const descriptor of queryCorpus.descriptors) {
    for (const scenario of scenarios) {
      const legacyRun = await executeScenarioRun({
        queryText: descriptor.text,
        scenario,
        withDb: legacyDb,
        withCoreDb: isolatedCoreDb,
        withEngineDb: isolatedEngineDb,
        recentAccessMode: "legacy",
        recentIsolationRequested: false,
        recentIsolationFallbackReason: null,
        nowSec,
        parameters,
        defaultAccessMode: "legacy",
      });
      const isolatedRun = await executeScenarioRun({
        queryText: descriptor.text,
        scenario,
        withDb: legacyDb,
        withCoreDb: isolatedCoreDb,
        withEngineDb: isolatedEngineDb,
        recentAccessMode: accessDecision.mode === "legacy" ? "guarded_fallback" : accessDecision.mode,
        recentIsolationRequested: true,
        recentIsolationFallbackReason: accessDecision.fallback_reason,
        nowSec,
        parameters,
        defaultAccessMode: accessDecision.mode === "isolated" ? "isolated" : "guarded_fallback",
      });

      scenarioResults.push({
        query: descriptor.query,
        scenario: {
          name: scenario.name,
          ftsIsEmpty: scenario.ftsIsEmpty,
        },
        legacy: legacyRun.summary,
        isolated_requested: isolatedRun.summary,
        comparison: compareRecentShadowRuns({
          legacy: legacyRun.summary,
          isolatedRequested: isolatedRun.summary,
          scenario,
        }),
      });
    }
  }

  if (typeof afterScenarios === "function") {
    await afterScenarios();
  }

  const after = {
    legacy_data_version: dataVersion(legacyDb),
    isolated_core_data_version: dataVersion(isolatedCoreDb),
    isolated_engine_data_version: dataVersion(isolatedEngineDb),
    core_file: fileSnapshot(coreDbPath),
    engine_file: fileSnapshot(engineDbPath),
  };

  const databaseStability = {
    stable:
      before.legacy_data_version === after.legacy_data_version
      && before.isolated_core_data_version === after.isolated_core_data_version
      && before.isolated_engine_data_version === after.isolated_engine_data_version
      && sameFileSnapshot(before.core_file, after.core_file)
      && sameFileSnapshot(before.engine_file, after.engine_file),
    legacy_data_version_before: before.legacy_data_version,
    legacy_data_version_after: after.legacy_data_version,
    isolated_core_data_version_before: before.isolated_core_data_version,
    isolated_core_data_version_after: after.isolated_core_data_version,
    isolated_engine_data_version_before: before.isolated_engine_data_version,
    isolated_engine_data_version_after: after.isolated_engine_data_version,
    core_file_changed: !sameFileSnapshot(before.core_file, after.core_file),
    engine_file_changed: !sameFileSnapshot(before.engine_file, after.engine_file),
  };

  const decision = deriveRecentShadowDecision({
    topology,
    databaseStability,
    scenarios: scenarioResults,
    episodeDomainPresent: episodeDomainPresent(legacyDb),
  });

  const summary = {
    scenario_count: scenarioResults.length,
    isolated_equivalent_count: scenarioResults.filter(item => item.comparison.classification === "isolated_equivalent").length,
    guarded_fallback_equivalent_count: scenarioResults.filter(item => item.comparison.classification === "guarded_fallback_equivalent").length,
    mismatch_count: scenarioResults.filter(item => item.comparison.classification === "mismatch").length,
    error_count: scenarioResults.filter(item => item.comparison.classification === "error").length,
    no_positive_candidate_evidence_count: scenarioResults.filter(item => item.comparison.classification === "no_positive_candidate_evidence").length,
    legacy_duration_ms_median: median(scenarioResults.map(item => item.legacy.duration_ms)),
    isolated_duration_ms_median: median(scenarioResults.map(item => item.isolated_requested.duration_ms)),
  };

  const report = {
    audit: "isolated_recent_shadow",
    fixed_now_used: true,
    scenario_time_consistent: true,
    parameters,
    topology,
    snapshot_guard: summarizeSnapshotGuard(coreSnapshotRows, engineSnapshotRows, invariant),
    query_corpus: queryCorpus.stats,
    queries: scenarioResults,
    summary,
    missing_confidence_evidence: currentSnapshotRelationship(legacyDb, invariant),
    database_stability: databaseStability,
    decision,
  };
  return report;
}

export function writeRecentShadowReport(output, outPath) {
  const resolved = resolve(String(outPath));
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, output);
  return resolved;
}
