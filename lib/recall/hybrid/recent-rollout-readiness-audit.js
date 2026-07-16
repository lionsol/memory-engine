import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";

import {
  normalizeFtsQuery,
  stripPromptMetadataPrefix,
} from "../../../query-utils.js";
import { calcRealtimeConf } from "../../memory-confidence.js";
import { getDefaultMemoryEngineConfig } from "../../config/defaults.js";
import { openEngineDb } from "../../db/engine-db.js";
import {
  openCoreDbReadonly,
  openEngineDbIsolated,
} from "../../db/isolated-dbs.js";
import { hybridSearch } from "../hybrid-search.js";
import { collectRecentCandidates } from "./channels/recent.js";
import { createCandidateCounts, createHybridDebug, createHybridWarnings } from "./debug.js";
import { computeRecencyBoost } from "./fusion.js";
import { tokenizeQuery } from "./lexical.js";
import {
  inferCategoryFromChunk,
  isCandidateAllowedForRerank,
  normalizeExternalMemory,
  normalizeUnixSeconds,
  round4,
  toFiniteNumber,
} from "./normalize-candidate.js";
import {
  evaluateRecentTextIdInvariant,
  inspectRecentIsolationTopology,
  mergeRecentMetadataRows,
  resolveRecentAccessDecision,
} from "./recent-access.js";
import {
  assertRecentShadowPrivacy,
  canonicalizeRecentShadowCandidate,
  canonicalizeRecentShadowRawRow,
  compareRecentShadowRuns,
  deriveRecentShadowQueries,
  fingerprintRecentShadowValue,
  NO_HIT_CONTROL_QUERY,
} from "./recent-shadow-audit.js";

export const RECENT_ROLLOUT_MUTATION_FLAGS = new Set([
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

export const RECENT_ROLLOUT_REPORT_SCHEMA_VERSION = 2;

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

const NORMALIZED_FIELDS = [
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

function sha256Hex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function shortHash(value) {
  return sha256Hex(value).slice(0, 16);
}

export const FILE_IDENTITY_ERROR = "file_identity_resolution_failed";
export const FILE_IDENTITY_BLOCKED = "file_identity_blocked";
export const FILE_IDENTITY_ALLOWED = "file_identity_allowed";

export function resolveSnapshotPathIdentity(inputPath) {
  let resolved = String(inputPath);
  if (resolved.startsWith("file:///")) {
    return { status: FILE_IDENTITY_ERROR, reason: "file_uri_not_allowed", identity: null };
  } else if (resolved.startsWith("file%3A///") || resolved.startsWith("file%3A%2F%2F%2F")) {
    return { status: FILE_IDENTITY_ERROR, reason: "encoded_file_uri_not_allowed", identity: null };
  } else if (!isAbsolute(resolved)) {
    resolved = resolve(resolved);
  }

  if (!existsSync(resolved)) {
    return { status: FILE_IDENTITY_ERROR, reason: "path_does_not_exist", identity: null };
  }

  let real;
  try {
    real = realpathSync(resolved);
  } catch {
    return { status: FILE_IDENTITY_ERROR, reason: "realpath_failure", identity: null };
  }

  let stat;
  try {
    stat = statSync(real);
  } catch {
    return { status: FILE_IDENTITY_ERROR, reason: "stat_failure", identity: null };
  }

  return {
    status: FILE_IDENTITY_ALLOWED,
    identity: {
      realpath: real,
      dev: Number(stat.dev || 0),
      ino: Number(stat.ino || 0),
      size: Number(stat.size || 0),
      nlink: Number(stat.nlink || 0),
    },
  };
}

export function rejectLiveDatabaseSnapshotIdentity(inputPath, defaultPaths) {
  const inputIdentity = resolveSnapshotPathIdentity(inputPath);
  if (inputIdentity.status !== FILE_IDENTITY_ALLOWED) {
    return {
      allowed: false,
      reason: inputIdentity.reason || "identity_resolution_failed",
      status: inputIdentity.status,
    };
  }

  for (const defaultPath of defaultPaths) {
    if (!defaultPath) continue;
    const defaultIdentity = resolveSnapshotPathIdentity(defaultPath);
    if (defaultIdentity.status !== FILE_IDENTITY_ALLOWED) continue;

    if (
      inputIdentity.identity.realpath === defaultIdentity.identity.realpath
      || (
        inputIdentity.identity.dev === defaultIdentity.identity.dev
        && inputIdentity.identity.ino === defaultIdentity.identity.ino
      )
    ) {
      return {
        allowed: false,
        reason: "input_path_identifies_default_db",
        status: FILE_IDENTITY_BLOCKED,
        input: inputIdentity.identity,
        matched_default: defaultIdentity.identity,
      };
    }
  }

  return {
    allowed: true,
    reason: "path_identity_independent_from_defaults",
    status: FILE_IDENTITY_ALLOWED,
    identity: inputIdentity.identity,
  };
}

function stableJsonString(value) {
  return JSON.stringify(value);
}

function monotonicNowMs() {
  return performance.timeOrigin + performance.now();
}

function dataVersion(db) {
  const row = db.prepare("PRAGMA data_version").get();
  const value = row?.data_version ?? row?.dataVersion ?? Object.values(row || {})[0] ?? 0;
  return Number(value || 0);
}

function pragmaScalar(db, pragmaName) {
  const row = db.prepare(`PRAGMA ${pragmaName}`).get();
  return Number(row?.[pragmaName] ?? Object.values(row || {})[0] ?? 0);
}

function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fileSnapshot(path, { hash = false } = {}) {
  if (!existsSync(path)) {
    return {
      present: false,
      size: null,
      mtimeMs: null,
      inode: null,
      sha256: null,
      sha256_checked: false,
    };
  }
  const stat = statSync(path);
  return {
    present: true,
    size: Number(stat.size || 0),
    mtimeMs: Number(stat.mtimeMs || 0),
    inode: Number(stat.ino || 0),
    sha256: hash ? fileSha256(path) : null,
    sha256_checked: hash,
  };
}

function sameFileSnapshot(a, b) {
  if (a.present !== b.present) return false;
  if (!a.present && !b.present) return true;
  if (a.size !== b.size || a.inode !== b.inode) return false;
  if (a.sha256_checked && b.sha256_checked) return a.sha256 === b.sha256;
  return true;
}

function snapshotPair(before, after) {
  return {
    present_before: before.present,
    present_after: after.present,
    size_before: before.size,
    size_after: after.size,
    mtime_before: before.mtimeMs,
    mtime_after: after.mtimeMs,
    inode_before: before.inode,
    inode_after: after.inode,
    sha256_before: before.sha256,
    sha256_after: after.sha256,
    sha256_checked: before.sha256_checked === true && after.sha256_checked === true,
  };
}

function dataRoleSnapshot({ dbPath, hashMainFiles = false }) {
  return {
    main: fileSnapshot(dbPath, { hash: hashMainFiles }),
    wal: fileSnapshot(`${dbPath}-wal`, { hash: true }),
    shm: fileSnapshot(`${dbPath}-shm`, { hash: false }),
  };
}

function sidecarMetadataChanged(before, after) {
  return (
    before.present !== after.present
    || before.size !== after.size
    || before.mtimeMs !== after.mtimeMs
    || before.inode !== after.inode
    || (before.sha256_checked && after.sha256_checked && before.sha256 !== after.sha256)
  );
}

function walContentChanged(before, after) {
  if (before.present !== after.present) {
    return after.present === true && Number(after.size || 0) > 0;
  }
  if (!before.present && !after.present) return false;
  if (Number(before.size || 0) !== Number(after.size || 0)) return true;
  if (before.sha256_checked && after.sha256_checked && before.sha256 !== after.sha256) return true;
  return false;
}

function isZeroByteWal(snapshot) {
  return snapshot.present === true && Number(snapshot.size || 0) === 0;
}

function readonlyWalIndexActivityForRole(role) {
  const walCreatedEmpty = role.wal.present_before === false
    && role.wal.present_after === true
    && Number(role.wal.size_after || 0) === 0;
  const walStableZeroByte = isZeroByteWal({
    present: role.wal.present_before,
    size: role.wal.size_before,
  })
    && isZeroByteWal({
      present: role.wal.present_after,
      size: role.wal.size_after,
    })
    && (
      role.wal.sha256_checked !== true
      || role.wal.sha256_before === role.wal.sha256_after
    );
  const walUnchangedMissing = role.wal.present_before === false && role.wal.present_after === false;
  const shmCreated = role.shm.present_before === false && role.shm.present_after === true;
  const shmMtimeRefresh = role.shm.present_before === true
    && role.shm.present_after === true
    && role.shm.mtime_before !== role.shm.mtime_after
    && role.shm.size_before === role.shm.size_after;
  const shmUnchanged = role.shm.present_before === role.shm.present_after
    && role.shm.mtime_before === role.shm.mtime_after
    && role.shm.inode_before === role.shm.inode_after
    && role.shm.size_before === role.shm.size_after;
  const walAllowed = walCreatedEmpty || walStableZeroByte || walUnchangedMissing;
  const shmAllowed = shmCreated || shmMtimeRefresh || shmUnchanged;
  return walAllowed && shmAllowed && (walCreatedEmpty || walStableZeroByte || shmCreated || shmMtimeRefresh);
}

function buildSnapshotContext({
  isolatedSnapshot = false,
  snapshotIdentityVerified = false,
} = {}) {
  return {
    requested: isolatedSnapshot === true,
    verified_non_live_identity: isolatedSnapshot === true && snapshotIdentityVerified === true,
    database_open_mode: "readonly",
    sqlite_immutable: false,
    expected_external_writer: isolatedSnapshot === true ? false : true,
    creation_method_claim: isolatedSnapshot === true ? "sqlite_backup_api" : null,
    creation_method_verified: false,
  };
}

export function classifyDatabaseStability({
  before,
  after,
  hashMainFiles = false,
  snapshotContext = null,
} = {}) {
  const core = {
    main: snapshotPair(before.core.main, after.core.main),
    wal: snapshotPair(before.core.wal, after.core.wal),
    shm: snapshotPair(before.core.shm, after.core.shm),
    data_version_before: before.core.data_version,
    data_version_after: after.core.data_version,
    schema_version_before: before.core.schema_version,
    schema_version_after: after.core.schema_version,
    total_changes_before: before.core.total_changes,
    total_changes_after: after.core.total_changes,
  };
  const engine = {
    main: snapshotPair(before.engine.main, after.engine.main),
    wal: snapshotPair(before.engine.wal, after.engine.wal),
    shm: snapshotPair(before.engine.shm, after.engine.shm),
    data_version_before: before.engine.data_version,
    data_version_after: after.engine.data_version,
    schema_version_before: before.engine.schema_version,
    schema_version_after: after.engine.schema_version,
    total_changes_before: before.engine.total_changes,
    total_changes_after: after.engine.total_changes,
  };

  const snapshotModeVerified =
    snapshotContext?.requested === true
    && snapshotContext?.verified_non_live_identity === true;
  const rawMainFileContentStable =
    sameFileSnapshot(before.core.main, after.core.main)
    && sameFileSnapshot(before.engine.main, after.engine.main);
  const dataVersionStable =
    before.core.data_version === after.core.data_version
    && before.engine.data_version === after.engine.data_version
    && before.legacy.data_version === after.legacy.data_version;
  const schemaVersionStable =
    before.core.schema_version === after.core.schema_version
    && before.engine.schema_version === after.engine.schema_version;
  const totalChangesStable =
    before.core.total_changes === after.core.total_changes
    && before.engine.total_changes === after.engine.total_changes
    && before.legacy.total_changes === after.legacy.total_changes;

  // Determine main_file_content_evidence level
  let mainFileContentEvidence = "insufficient";
  if (hashMainFiles === true) {
    if (
      before.core.main.sha256_checked === true
      && after.core.main.sha256_checked === true
      && before.engine.main.sha256_checked === true
      && after.engine.main.sha256_checked === true
      && before.core.main.sha256 != null
      && after.core.main.sha256 != null
      && before.engine.main.sha256 != null
      && after.engine.main.sha256 != null
    ) {
      mainFileContentEvidence = "sha256";
    }
  } else if (
    before.core.main.present === true
    && after.core.main.present === true
    && before.engine.main.present === true
    && after.engine.main.present === true
    && before.core.main.size != null
    && after.core.main.size != null
    && before.engine.main.size != null
    && after.engine.main.size != null
    && before.core.main.inode != null
    && after.core.main.inode != null
    && before.engine.main.inode != null
    && after.engine.main.inode != null
    && before.core.data_version != null
    && after.core.data_version != null
    && before.engine.data_version != null
    && after.engine.data_version != null
    && before.core.schema_version != null
    && after.core.schema_version != null
    && before.engine.schema_version != null
    && after.engine.schema_version != null
    && before.core.total_changes != null
    && after.core.total_changes != null
  ) {
    mainFileContentEvidence = "metadata_and_sqlite_versions";
  }

  const mainFileContentStable =
    mainFileContentEvidence !== "insufficient"
      ? rawMainFileContentStable
      : false;
  const logicalDatabaseStable =
    mainFileContentStable
    && dataVersionStable
    && schemaVersionStable
    && totalChangesStable;

  const coreWalContentChanged = walContentChanged(before.core.wal, after.core.wal);
  const engineWalContentChanged = walContentChanged(before.engine.wal, after.engine.wal);
  const walContentChange = coreWalContentChanged || engineWalContentChanged;
  const coreSidecarChanged =
    sidecarMetadataChanged(before.core.wal, after.core.wal)
    || sidecarMetadataChanged(before.core.shm, after.core.shm);
  const engineSidecarChanged =
    sidecarMetadataChanged(before.engine.wal, after.engine.wal)
    || sidecarMetadataChanged(before.engine.shm, after.engine.shm);
  const sidecarNeutral = !coreSidecarChanged && !engineSidecarChanged;

  let sidecarActivityClass = "none";
  let decisionEligible = true;
  if (!logicalDatabaseStable) {
    sidecarActivityClass = "logical_database_change";
    decisionEligible = false;
  } else if (walContentChange) {
    sidecarActivityClass = "wal_content_change";
    decisionEligible = false;
  } else if (sidecarNeutral) {
    sidecarActivityClass = "none";
  } else if (
    snapshotModeVerified === true
    && readonlyWalIndexActivityForRole(core)
    && readonlyWalIndexActivityForRole(engine)
  ) {
    sidecarActivityClass = "readonly_wal_index_activity";
  } else {
    sidecarActivityClass = "external_or_unknown_activity";
    decisionEligible = false;
  }
  if (mainFileContentEvidence === "insufficient") {
    decisionEligible = false;
  }

  return {
    logical_database_stable: logicalDatabaseStable,
    main_file_content_stable: mainFileContentStable,
    main_file_content_evidence: mainFileContentEvidence,
    data_version_stable: dataVersionStable,
    schema_version_stable: schemaVersionStable,
    total_changes_stable: totalChangesStable,
    sidecar_neutral: sidecarNeutral,
    sidecar_activity_class: sidecarActivityClass,
    core,
    engine,
    legacy: {
      data_version_before: before.legacy.data_version,
      data_version_after: after.legacy.data_version,
      total_changes_before: before.legacy.total_changes,
      total_changes_after: after.legacy.total_changes,
    },
    decision_eligible: decisionEligible,
    stable: logicalDatabaseStable,
    stability_contract: {
      logical_readonly: true,
      sidecar_neutral: sidecarNeutral,
    },
    hash_main_files: hashMainFiles === true,
  };
}

function databaseNames(db) {
  return db.prepare("PRAGMA database_list").all().map(row => String(row.name || ""));
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
  return numeric.length % 2 === 1 ? numeric[mid] : (numeric[mid - 1] + numeric[mid]) / 2;
}

function percentile(values = [], p = 0.95) {
  const numeric = values
    .map(value => Number(value))
    .filter(value => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (numeric.length === 0) return 0;
  const index = Math.max(0, Math.min(numeric.length - 1, Math.ceil(numeric.length * p) - 1));
  return numeric[index];
}

function summarizeTiming(values = []) {
  const numeric = values.filter(value => Number.isFinite(value)).map(Number);
  return {
    repetitions: numeric.length,
    median_ms: round4(median(numeric)),
    p95_ms: round4(percentile(numeric, 0.95)),
    min_ms: round4(numeric.length > 0 ? Math.min(...numeric) : 0),
    max_ms: round4(numeric.length > 0 ? Math.max(...numeric) : 0),
  };
}

function fixedNowSec(options = {}) {
  return Number.isInteger(options.auditNowSec)
    ? options.auditNowSec
    : Math.floor(Date.now() / 1000);
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

function deriveRowsForQueries(legacyDb, deriveLimit) {
  return legacyDb.prepare(RECENT_DOMAIN_SQL).all(deriveLimit).map(row => ({
    text: String(row.text ?? ""),
    path: String(row.path ?? ""),
  }));
}

function privacySafeDescriptor(descriptor) {
  return descriptor.query;
}

function recentShadowLexicalMatchScore(haystack, terms) {
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

function fingerprintRow(canonical) {
  return fingerprintRecentShadowValue(canonical);
}

function summarizeFingerprintRecord({ canonical, position }) {
  return {
    position,
    id_hash: shortHash(canonical.id),
    path_hash: shortHash(canonical.path),
    row_fingerprint: fingerprintRow(canonical),
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

function buildContext({
  queryText,
  nowSec,
  parameters,
  ftsIsEmpty,
  withDb,
  withCoreDb,
  withEngineDb,
  recentAccessMode,
  recentIsolationRequested,
  recentIsolationFallbackReason,
  timingState,
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
    minConfidence: parameters.minConfidence,
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

  const measuredNormalize = (row) => {
    const started = process.hrtime.bigint();
    try {
      return normalizeExternalMemory(row, {
        nowSec,
        calcRealtimeConf,
        categoryMap: null,
      });
    } finally {
      timingState.normalize_projection_ms += Number(process.hrtime.bigint() - started) / 1e6;
    }
  };

  const measuredFilter = (candidate) => {
    const started = process.hrtime.bigint();
    try {
      return isCandidateAllowedForRerank(candidate, parameters.minConfidence);
    } finally {
      timingState.normalize_projection_ms += Number(process.hrtime.bigint() - started) / 1e6;
    }
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
    likePatternTopN: parameters.likePatternTopN,
    likeTopK: parameters.likeTopK,
    recentTopK: parameters.recentTopK,
    recentRerankTopK: parameters.recentRerankTopK,
    recentFallbackTopK: parameters.recentFallbackTopK,
    rankingConfig: {},
    categoryMap: null,
    normalizeCandidate: measuredNormalize,
    filterForRerank: measuredFilter,
    enrichLexicalCandidate: candidate => candidate,
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
  if (text.includes("SELECT chunk_id, confidence, last_confidence_update")) return "engine_snapshot";
  if (text.includes("SELECT id, path, updated_at FROM chunks")) return "core_snapshot";
  return "other";
}

function updateTimingForTrace(entry, timingState) {
  const durationMs = Number(entry.duration_ms || 0);
  if (entry.db === "engine" && entry.branch === "archived_engine") timingState.archived_engine_ms += durationMs;
  if (entry.db === "engine" && entry.branch === "metadata_engine") timingState.metadata_engine_ms += durationMs;
  if (entry.db === "core" && ["like_fallback", "recent_scored", "recent_fallback"].includes(entry.branch)) {
    timingState.core_sql_total_ms += durationMs;
    timingState[`${entry.branch}_core_ms`] += durationMs;
  }
  if (entry.db === "legacy" && ["like_fallback", "recent_scored", "recent_fallback"].includes(entry.branch)) {
    timingState.legacy_sql_total_ms += durationMs;
  }
}

function createRecordingAccessor(db, name, trace, timingState) {
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
          duration_ms: 0,
        });
        throw error;
      }
      return {
        all(...params) {
          const started = process.hrtime.bigint();
          try {
            const rows = statement.all(...params);
            const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
            const entry = { db: name, branch, sql: String(sql), params, rows, duration_ms: durationMs };
            trace.push(entry);
            updateTimingForTrace(entry, timingState);
            return rows;
          } catch (error) {
            const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
            const entry = { db: name, branch, sql: String(sql), params, error: sanitizeError(error), duration_ms: durationMs };
            trace.push(entry);
            updateTimingForTrace(entry, timingState);
            throw error;
          }
        },
        get(...params) {
          const started = process.hrtime.bigint();
          try {
            const row = statement.get(...params);
            const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
            const entry = { db: name, branch, sql: String(sql), params, row, duration_ms: durationMs };
            trace.push(entry);
            updateTimingForTrace(entry, timingState);
            return row;
          } catch (error) {
            const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
            const entry = { db: name, branch, sql: String(sql), params, error: sanitizeError(error), duration_ms: durationMs };
            trace.push(entry);
            updateTimingForTrace(entry, timingState);
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

function summarizeRun({ ctx, trace, durationMs, defaultAccessMode, timingState }) {
  const accessMode = ctx.debug?.recent_access_mode || defaultAccessMode;
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

  const wrapperCounts = {
    archived_engine_query_count: trace.filter(entry => entry.db === "engine" && entry.branch === "archived_engine").length,
    metadata_engine_query_count: trace.filter(entry => entry.db === "engine" && entry.branch === "metadata_engine").length,
    core_query_count: trace.filter(entry => entry.db === "core" && ["like_fallback", "recent_scored", "recent_fallback"].includes(entry.branch)).length,
  };
  wrapperCounts.engine_query_count_total =
    wrapperCounts.archived_engine_query_count + wrapperCounts.metadata_engine_query_count;

  const debugCounts = {
    archived_engine_query_count: Number(ctx.debug.recent_isolated_engine_query_count ?? 0) > 0 ? 1 : 0,
    metadata_engine_query_count: Number(ctx.debug.recent_isolated_metadata_query_count ?? 0),
    core_query_count: Number(ctx.debug.recent_isolated_core_query_count ?? 0),
  };
  debugCounts.engine_query_count_total =
    debugCounts.archived_engine_query_count + debugCounts.metadata_engine_query_count;

  const queryCountContractAmbiguous =
    ctx.recentIsolationRequested === true
    && stableJsonString(wrapperCounts) !== stableJsonString(debugCounts);

  const totalRecentMs = round4(durationMs);
  const knownIsolated =
    timingState.snapshot_guard_ms
    + timingState.archived_engine_ms
    + timingState.core_sql_total_ms
    + timingState.metadata_engine_ms
    + timingState.normalize_projection_ms;
  const unreconciledMs = Math.max(0, totalRecentMs - round4(knownIsolated));
  timingState.metadata_merge_ms = unreconciledMs;
  timingState.other_ms = 0;
  const timingReconciliationErrorMs = Math.max(0, totalRecentMs - round4(
    timingState.snapshot_guard_ms
    + timingState.archived_engine_ms
    + timingState.core_sql_total_ms
    + timingState.metadata_engine_ms
    + timingState.metadata_merge_ms
    + timingState.normalize_projection_ms
    + timingState.other_ms
  ));

  return {
    recent_access_mode: accessMode,
    fallback_reason: ctx.debug?.recent_isolated_fallback_reason ?? null,
    error: ctx.debug?.recent_error ? sanitizeError({ message: ctx.debug.recent_error }) : null,
    candidate_counts: {
      like_raw: Number(ctx.candidateCounts.like_raw || 0),
      recent_raw: Number(ctx.candidateCounts.recent_raw || 0),
      episode_raw: Number(ctx.candidateCounts.episode_raw || 0),
      recent_fallback_raw: Number(ctx.candidateCounts.recent_fallback_raw || 0),
    },
    branches,
    query_counts: wrapperCounts,
    debug_query_counts: debugCounts,
    query_count_contract_ambiguous: queryCountContractAmbiguous,
    timing: {
      total_recent_ms: totalRecentMs,
      snapshot_guard_ms: round4(timingState.snapshot_guard_ms),
      archived_engine_ms: round4(timingState.archived_engine_ms),
      core_sql_total_ms: round4(timingState.core_sql_total_ms),
      like_fallback_core_ms: round4(timingState.like_fallback_core_ms),
      recent_scored_core_ms: round4(timingState.recent_scored_core_ms),
      recent_fallback_core_ms: round4(timingState.recent_fallback_core_ms),
      metadata_engine_ms: round4(timingState.metadata_engine_ms),
      metadata_merge_ms: round4(timingState.metadata_merge_ms),
      metadata_merge_measurement_method: "residual_estimate",
      normalize_projection_ms: round4(timingState.normalize_projection_ms),
      other_ms: round4(timingState.other_ms),
      timing_attribution_complete: false,
      timing_reconciliation_error_ms: round4(timingReconciliationErrorMs),
      legacy_sql_total_ms: round4(timingState.legacy_sql_total_ms),
      legacy_normalize_projection_ms: round4(timingState.legacy_normalize_projection_ms),
    },
  };
}

function emptyTimingState() {
  return {
    snapshot_guard_ms: 0,
    archived_engine_ms: 0,
    core_sql_total_ms: 0,
    like_fallback_core_ms: 0,
    recent_scored_core_ms: 0,
    recent_fallback_core_ms: 0,
    metadata_engine_ms: 0,
    metadata_merge_ms: 0,
    normalize_projection_ms: 0,
    other_ms: 0,
    legacy_sql_total_ms: 0,
    legacy_normalize_projection_ms: 0,
  };
}

function evaluateRunAccessDecision({ isolatedCoreDb, isolatedEngineDb }) {
  const started = process.hrtime.bigint();
  const coreSnapshotRows = isolatedCoreDb.prepare("SELECT id FROM chunks").all();
  const engineSnapshotRows = isolatedEngineDb.prepare("SELECT chunk_id FROM memory_confidence").all();
  const invariant = evaluateRecentTextIdInvariant({
    engineRows: engineSnapshotRows,
    coreRows: coreSnapshotRows,
  });
  const topology = inspectRecentIsolationTopology({
    withCoreDb: run => run(isolatedCoreDb),
    withEngineDb: run => run(isolatedEngineDb),
  });
  const accessDecision = resolveRecentAccessDecision({
    isolatedRecentCapability: true,
    invariant,
    topology,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  return {
    invariant,
    topology,
    accessDecision,
    durationMs,
  };
}

async function executeMeasuredRun({
  queryText,
  scenario,
  nowSec,
  parameters,
  legacyDb,
  isolatedCoreDb,
  isolatedEngineDb,
  mode,
}) {
  const timingState = emptyTimingState();
  let recentAccessMode = "legacy";
  let recentIsolationRequested = false;
  let recentIsolationFallbackReason = null;
  if (mode === "isolated") {
    const decision = evaluateRunAccessDecision({ isolatedCoreDb, isolatedEngineDb });
    recentAccessMode = decision.accessDecision.mode;
    recentIsolationRequested = true;
    recentIsolationFallbackReason = decision.accessDecision.fallback_reason;
    timingState.snapshot_guard_ms = decision.durationMs;
  }

  const trace = [];
  const ctx = buildContext({
    queryText,
    nowSec,
    parameters,
    ftsIsEmpty: scenario.ftsIsEmpty,
    withDb: createRecordingAccessor(legacyDb, "legacy", trace, timingState),
    withCoreDb: createRecordingAccessor(isolatedCoreDb, "core", trace, timingState),
    withEngineDb: createRecordingAccessor(isolatedEngineDb, "engine", trace, timingState),
    recentAccessMode,
    recentIsolationRequested,
    recentIsolationFallbackReason,
    timingState,
  });

  const started = process.hrtime.bigint();
  try {
    await collectRecentCandidates(ctx);
  } catch (error) {
    ctx.debug.recent_error = String(error.message || error);
  }
  const totalMs = Number(process.hrtime.bigint() - started) / 1e6;
  if (mode === "legacy") {
    timingState.legacy_normalize_projection_ms = timingState.normalize_projection_ms;
    timingState.normalize_projection_ms = 0;
  }

  return {
    ctx,
    summary: summarizeRun({
      ctx,
      trace,
      durationMs: totalMs,
      defaultAccessMode: mode === "legacy" ? "legacy" : recentAccessMode,
      timingState,
    }),
  };
}

function aggregateModeTimings(summaries, mode) {
  const pick = field => summaries.map(item => Number(item[mode]?.timing?.[field] || 0));
  const result = {
    total_recent_ms: summarizeTiming(pick("total_recent_ms")),
  };
  if (mode === "legacy") {
    result.legacy_sql_total_ms = summarizeTiming(pick("legacy_sql_total_ms"));
    result.legacy_normalize_projection_ms = summarizeTiming(pick("legacy_normalize_projection_ms"));
    return result;
  }
  for (const field of [
    "snapshot_guard_ms",
    "archived_engine_ms",
    "core_sql_total_ms",
    "like_fallback_core_ms",
    "recent_scored_core_ms",
    "recent_fallback_core_ms",
    "metadata_engine_ms",
    "metadata_merge_ms",
    "normalize_projection_ms",
    "other_ms",
  ]) {
    result[field] = summarizeTiming(pick(field));
  }
  return result;
}

function representativeSummary(summaries, mode) {
  return summaries[0]?.[mode] || null;
}

function summariesStable(summaries, mode) {
  if (summaries.length <= 1) return true;
  const fingerprint = item => stableJsonString({
    candidate_counts: item[mode].candidate_counts,
    branches: item[mode].branches,
    query_counts: item[mode].query_counts,
    debug_query_counts: item[mode].debug_query_counts,
    recent_access_mode: item[mode].recent_access_mode,
    fallback_reason: item[mode].fallback_reason,
    error: item[mode].error,
  });
  const first = fingerprint(summaries[0]);
  return summaries.every(item => fingerprint(item) === first);
}

function stageTimingCloses(run) {
  const isolated = run.isolated?.timing;
  if (!isolated) return true;
  const sum =
    Number(isolated.archived_engine_ms || 0)
    + Number(isolated.core_sql_total_ms || 0)
    + Number(isolated.metadata_engine_ms || 0)
    + Number(isolated.metadata_merge_ms || 0)
    + Number(isolated.normalize_projection_ms || 0)
    + Number(isolated.other_ms || 0);
  return sum <= Number(isolated.total_recent_ms || 0) + 1.5
    && Number(isolated.snapshot_guard_ms || 0) >= 0
    && Number(isolated.other_ms || 0) >= 0
    && Number(isolated.timing_reconciliation_error_ms || 0) <= 1.5;
}

async function executeScenarioMeasurements(options) {
  const {
    queryText,
    scenario,
    nowSec,
    parameters,
    repetitions,
    warmups,
    openHandles,
  } = options;
  const runs = [];

  for (let i = 0; i < warmups; i += 1) {
    const handles = await openHandles();
    try {
      await executeMeasuredRun({ queryText, scenario, nowSec, parameters, ...handles, mode: "legacy" });
      await executeMeasuredRun({ queryText, scenario, nowSec, parameters, ...handles, mode: "isolated" });
    } finally {
      handles.close();
    }
  }

  for (let i = 0; i < repetitions; i += 1) {
    const handles = await openHandles();
    try {
      const order = i % 2 === 0 ? ["legacy", "isolated"] : ["isolated", "legacy"];
      const result = {};
      for (const mode of order) {
        const run = await executeMeasuredRun({ queryText, scenario, nowSec, parameters, ...handles, mode });
        result[mode] = run.summary;
      }
      runs.push(result);
    } finally {
      handles.close();
    }
  }

  const representative = {
    legacy: representativeSummary(runs, "legacy"),
    isolated: representativeSummary(runs, "isolated"),
  };
  const comparison = compareRecentShadowRuns({
    legacy: representative.legacy,
    isolatedRequested: representative.isolated,
    scenario,
  });

  return {
    legacy: representative.legacy,
    isolated_requested: representative.isolated,
    comparison: {
      ...comparison,
      repetition_consistent: summariesStable(runs, "legacy") && summariesStable(runs, "isolated"),
      stage_timing_closes: runs.every(stageTimingCloses),
    },
    timing_stats: {
      legacy: aggregateModeTimings(runs, "legacy"),
      isolated: aggregateModeTimings(runs, "isolated"),
    },
  };
}

function coverageSummary(results = []) {
  const positive = results.filter(item =>
    item.comparison.classification === "isolated_equivalent" && item.comparison.positive_candidate_evidence,
  );
  return {
    like_fallback: positive.some(item => item.legacy.branches.like_fallback.candidate_count > 0),
    recent_scored: positive.some(item => item.legacy.branches.recent_scored.candidate_count > 0),
    recent_fallback: positive.some(item => item.legacy.branches.recent_fallback.candidate_count > 0),
    episode_projection: positive.some(item => item.legacy.branches.episode_projection.candidate_count > 0),
  };
}

function decisionForReadiness({
  scenarios,
  concurrency,
  topology,
  databaseStability,
  privacyValidation,
}) {
  const summary = {
    mismatches: scenarios.filter(item => item.comparison.classification === "mismatch").length,
    errors: scenarios.filter(item => item.comparison.classification === "error").length,
    guardedFallbacks: scenarios.filter(item => item.comparison.classification === "guarded_fallback_equivalent").length,
  };
  if (!databaseStability.logical_database_stable) {
    return {
      class: "fail",
      reason: "logical_database_change",
      production_enablement_recommended: false,
    };
  }
  if (databaseStability.sidecar_activity_class === "wal_content_change" && databaseStability.decision_eligible !== true) {
    return {
      class: "fail",
      reason: "wal_content_change",
      production_enablement_recommended: false,
    };
  }
  if (!privacyValidation.passed) {
    return {
      class: "fail",
      reason: "privacy_validation_failed",
      production_enablement_recommended: false,
    };
  }
  if (
    topology.legacy.readonly !== true
    || topology.isolated_core.readonly !== true
    || topology.isolated_engine.readonly !== true
    || stableJsonString(topology.legacy.database_names) !== stableJsonString(["main", "core"])
    || stableJsonString(topology.isolated_core.database_names) !== stableJsonString(["main"])
    || stableJsonString(topology.isolated_engine.database_names) !== stableJsonString(["main"])
  ) {
    return {
      class: "fail",
      reason: "invalid_readonly_topology",
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
  if (summary.mismatches > 0 || summary.errors > 0) {
    return {
      class: "fail",
      reason: summary.errors > 0 ? "recent_error" : "mismatch",
      production_enablement_recommended: false,
    };
  }
  if (scenarios.some(item => !item.comparison.repetition_consistent || !item.comparison.stage_timing_closes || item.comparison.query_count_contract_ambiguous)) {
    return {
      class: "inconclusive",
      reason: "measurement_contract_inconclusive",
      production_enablement_recommended: false,
    };
  }
  const coverage = coverageSummary(scenarios);
  if (!coverage.like_fallback || !coverage.recent_scored || !coverage.recent_fallback || !coverage.episode_projection) {
    return {
      class: "inconclusive",
      reason: "insufficient_branch_coverage",
      production_enablement_recommended: false,
    };
  }

  const isolatedTotals = scenarios
    .map(item => Number(item.timing_stats?.isolated?.total_recent_ms?.p95_ms || 0))
    .filter(Number.isFinite);
  const isolatedMax = scenarios
    .map(item => Number(item.timing_stats?.isolated?.total_recent_ms?.max_ms || 0))
    .filter(Number.isFinite);
  const serialP95 = isolatedTotals.length > 0 ? Math.max(...isolatedTotals) : 0;
  const serialMax = isolatedMax.length > 0 ? Math.max(...isolatedMax) : 0;
  const concurrency2 = concurrency.find(item => item.level === 2) || null;
  const concurrency4 = concurrency.find(item => item.level === 4) || null;

  if (databaseStability.sidecar_activity_class === "external_or_unknown_activity") {
    return {
      class: "semantic_pass_latency_inconclusive",
      reason: "external_or_unknown_sidecar_activity",
      production_enablement_recommended: false,
    };
  }

  if (
    serialP95 > 350
    || serialMax > 750
    || summary.guardedFallbacks > 0
    || (concurrency2 && (
      concurrency2.concurrency_execution_established !== true
      || concurrency2.p95_ms > 700
      || concurrency2.max_ms > 1500
      || concurrency2.error_count > 0
      || concurrency2.mismatch_count > 0
      || concurrency2.worker_error_count > 0
      || concurrency2.worker_exit_error_count > 0
    ))
    || (concurrency4 && (
      concurrency4.concurrency_execution_established !== true
      || concurrency4.error_count > 0
      || concurrency4.mismatch_count > 0
      || concurrency4.worker_error_count > 0
      || concurrency4.worker_exit_error_count > 0
    ))
  ) {
    return {
      class: "semantic_pass_latency_inconclusive",
      reason: "latency_budget_not_met",
      production_enablement_recommended: false,
    };
  }

  return {
    class: "pass_canary_readiness",
    reason: "isolated_recent_ready_for_internal_canary_design",
    production_enablement_recommended: false,
  };
}

function benchmarkQueries(results, count = 5) {
  return results
    .filter(item => item.comparison.classification === "isolated_equivalent")
    .slice(0, count);
}

function withDbPathEnv(coreDbPath, engineDbPath, run) {
  const previous = {
    CORE_DB_PATH: process.env.CORE_DB_PATH,
    ENGINE_DB_PATH: process.env.ENGINE_DB_PATH,
  };
  process.env.CORE_DB_PATH = coreDbPath;
  process.env.ENGINE_DB_PATH = engineDbPath;
  try {
    return run();
  } finally {
    if (previous.CORE_DB_PATH == null) delete process.env.CORE_DB_PATH;
    else process.env.CORE_DB_PATH = previous.CORE_DB_PATH;
    if (previous.ENGINE_DB_PATH == null) delete process.env.ENGINE_DB_PATH;
    else process.env.ENGINE_DB_PATH = previous.ENGINE_DB_PATH;
  }
}

function openReadonlyHandlesForPaths({ coreDbPath, engineDbPath }) {
  return withDbPathEnv(coreDbPath, engineDbPath, () => ({
    legacyDb: openEngineDb({ readonly: true }),
    isolatedCoreDb: openCoreDbReadonly({ coreDbPath, engineDbPath }),
    isolatedEngineDb: openEngineDbIsolated({ coreDbPath, engineDbPath, readonly: true }),
  }));
}

function closeReadonlyHandles(handles) {
  if (handles?.legacyDb?.open) handles.legacyDb.close();
  if (handles?.isolatedCoreDb?.open) handles.isolatedCoreDb.close();
  if (handles?.isolatedEngineDb?.open) handles.isolatedEngineDb.close();
}

function intervalsOverlap(a, b) {
  return a.started_at_ms < b.ended_at_ms && b.started_at_ms < a.ended_at_ms;
}

function overlappingIntervalCount(intervals = []) {
  let count = 0;
  for (let i = 0; i < intervals.length; i += 1) {
    for (let j = i + 1; j < intervals.length; j += 1) {
      if (intervalsOverlap(intervals[i], intervals[j])) count += 1;
    }
  }
  return count;
}

function summarizeConcurrencyResult({
  level,
  calls,
  durations,
  errorCount,
  mismatchCount,
  workerErrorCount,
  workerExitErrorCount,
  wallClockMs,
  observedMaxInFlight,
  intervals,
}) {
  const overlappingCallCount = overlappingIntervalCount(intervals);
  return {
    level,
    requested_concurrency: level,
    call_count: calls,
    total_call_count: calls,
    observed_max_in_flight: observedMaxInFlight,
    overlapping_call_count: overlappingCallCount,
    concurrency_execution_established:
      observedMaxInFlight >= level && overlappingCallCount > 0,
    wall_clock_ms: round4(wallClockMs),
    sum_individual_call_ms: round4(durations.reduce((sum, value) => sum + Number(value || 0), 0)),
    throughput_calls_per_second: round4(wallClockMs > 0 ? (calls / wallClockMs) * 1000 : 0),
    median_ms: round4(median(durations)),
    p95_ms: round4(percentile(durations, 0.95)),
    max_ms: round4(durations.length > 0 ? Math.max(...durations) : 0),
    error_count: errorCount,
    mismatch_count: mismatchCount,
    worker_error_count: workerErrorCount,
    worker_exit_error_count: workerExitErrorCount,
  };
}

function runConcurrencyWorker({
  coreDbPath,
  engineDbPath,
  queryText,
  scenario,
  nowSec,
  parameters,
  minWorkerDelayMs = 0,
}) {
  return new Promise((resolvePromise) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: {
        type: "recent_rollout_concurrency_worker",
        coreDbPath,
        engineDbPath,
        queryText,
        scenario,
        nowSec,
        parameters,
        minWorkerDelayMs,
      },
    });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolvePromise(result);
    };
    worker.once("message", (message) => {
      finish(message);
    });
    worker.once("error", (error) => {
      finish({
        ok: false,
        worker_error: sanitizeError(error),
      });
    });
    worker.once("exit", (code) => {
      if (!settled && code !== 0) {
        finish({
          ok: false,
          worker_exit_error: { code },
        });
      }
    });
  });
}

async function runConcurrencySmoke({
  scenarios,
  level,
  calls = 20,
  coreDbPath,
  engineDbPath,
  nowSec,
  parameters,
  concurrencyWorkerDelayMs = 0,
}) {
  const selected = benchmarkQueries(scenarios, Math.max(1, level));
  if (selected.length === 0) {
    return {
      level,
      requested_concurrency: level,
      call_count: 0,
      total_call_count: 0,
      observed_max_in_flight: 0,
      overlapping_call_count: 0,
      concurrency_execution_established: false,
      wall_clock_ms: 0,
      sum_individual_call_ms: 0,
      throughput_calls_per_second: 0,
      median_ms: 0,
      p95_ms: 0,
      max_ms: 0,
      error_count: 0,
      mismatch_count: 0,
      worker_error_count: 0,
      worker_exit_error_count: 0,
    };
  }

  const durations = [];
  let errorCount = 0;
  let mismatchCount = 0;
  let workerErrorCount = 0;
  let workerExitErrorCount = 0;
  let observedMaxInFlight = 0;
  let inFlight = 0;
  const intervals = [];
  const started = process.hrtime.bigint();

  for (let batchStart = 0; batchStart < calls; batchStart += level) {
    const batch = selected.slice(0, Math.min(level, calls - batchStart));
    const resultsBatch = await Promise.all(batch.map(async (item) => {
      inFlight += 1;
      observedMaxInFlight = Math.max(observedMaxInFlight, inFlight);
      try {
        return await runConcurrencyWorker({
          coreDbPath,
          engineDbPath,
          queryText: item.query_text,
          scenario: item.scenario,
          nowSec,
          parameters,
          minWorkerDelayMs: concurrencyWorkerDelayMs,
        });
      } finally {
        inFlight -= 1;
      }
    }));
    for (const [index, result] of resultsBatch.entries()) {
      if (result?.started_at_ms != null && result?.ended_at_ms != null) {
        intervals.push({
          started_at_ms: Number(result.started_at_ms),
          ended_at_ms: Number(result.ended_at_ms),
        });
      }
      if (result?.worker_error) {
        workerErrorCount += 1;
        errorCount += 1;
        continue;
      }
      if (result?.worker_exit_error) {
        workerExitErrorCount += 1;
        errorCount += 1;
        continue;
      }
      if (!result?.ok || result?.error) {
        errorCount += 1;
        continue;
      }
      durations.push(Number(result.summary?.timing?.total_recent_ms || 0));
      const baseline = batch[index].isolated_requested;
      if (stableJsonString({
        candidate_counts: result.summary?.candidate_counts,
        branches: result.summary?.branches,
      }) !== stableJsonString({
        candidate_counts: baseline.candidate_counts,
        branches: baseline.branches,
      })) {
        mismatchCount += 1;
      }
    }
  }

  const totalMs = Number(process.hrtime.bigint() - started) / 1e6;
  return summarizeConcurrencyResult({
    level,
    calls,
    durations,
    errorCount,
    mismatchCount,
    workerErrorCount,
    workerExitErrorCount,
    wallClockMs: totalMs,
    observedMaxInFlight,
    intervals,
  });
}

async function defaultHybridSmokeRunner({
  queryText,
  topK,
  legacyDb,
  isolatedCoreDb,
  isolatedEngineDb,
  capabilities,
}) {
  const runtime = {
    withHybridDbAccessScope: (run) => run({
      withCoreDb: fn => fn(isolatedCoreDb),
      withEngineDb: fn => fn(isolatedEngineDb),
      withLegacyDb: fn => fn(legacyDb),
      capabilities,
    }),
    calcRealtimeConf,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "rollout_readiness_audit" }),
    getLancedbRuntimeRuntime: async () => null,
    generateEmbeddingRuntime: async () => [],
    getMemorySearchManager: async () => ({
      manager: {
        search: async () => [],
      },
    }),
  };
  const result = await hybridSearch(queryText, { topK }, runtime);
  return {
    channels: Array.isArray(result.channels) ? result.channels.map(String) : [],
    results_count: Array.isArray(result.results) ? result.results.length : 0,
    debug: {
      recent_access_mode: result.debug?.recent_access_mode || null,
      recent_isolated_requested: result.debug?.recent_isolated_requested === true,
      recent_isolated_fallback_reason: result.debug?.recent_isolated_fallback_reason || null,
    },
  };
}

function buildPrivacyValidation(report, sensitiveValues) {
  const reportJson = JSON.stringify(report);
  const checked = sensitiveValues.filter(value => typeof value === "string" && value.length >= 4);
  const leakCount = checked.filter(value => reportJson.includes(value)).length;
  return {
    passed: leakCount === 0,
    checked_value_count: checked.length,
    leak_count: leakCount,
  };
}

function collectSensitiveValues({ derivedRows = [], explicitQueries = [] }) {
  const values = [];
  for (const query of explicitQueries) values.push(String(query));
  for (const row of derivedRows) values.push(String(row.text || ""), String(row.path || ""), row.updated_at == null ? null : String(row.updated_at));
  return values;
}

export async function runRecentRolloutReadinessAudit({
  legacyDb,
  isolatedCoreDb,
  isolatedEngineDb,
  coreDbPath,
  engineDbPath,
  queries = [],
  queriesFile = null,
  deriveLimit = 24,
  includeNoHitControl = true,
  warmups = 1,
  repetitions = 5,
  concurrencyLevels = [2, 4],
  scenarios = [
    { name: "fts_has_results", ftsIsEmpty: false },
    { name: "fts_empty", ftsIsEmpty: true },
  ],
  auditNowSec = null,
  minConfidence = null,
  recentTopK = null,
  recentFallbackTopK = null,
  recentRerankTopK = null,
  likePatternTopN = null,
  likeTopK = null,
  openHandles = null,
  hybridSmokeRunner = defaultHybridSmokeRunner,
  sampleSensitiveValues = null,
  concurrencyWorkerDelayMs = 0,
  hashMainFiles = false,
  isolatedSnapshot = false,
  snapshotIdentityVerified = false,
} = {}) {
  if (!legacyDb || !isolatedCoreDb || !isolatedEngineDb) {
    throw new Error("runRecentRolloutReadinessAudit requires legacyDb, isolatedCoreDb, and isolatedEngineDb");
  }
  if (typeof openHandles !== "function") {
    throw new Error("runRecentRolloutReadinessAudit requires openHandles for repeated measurements");
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
    legacy: {
      data_version: dataVersion(legacyDb),
      total_changes: Number(legacyDb.prepare("SELECT total_changes() AS total_changes").get()?.total_changes || 0),
    },
    core: {
      ...dataRoleSnapshot({ dbPath: coreDbPath, hashMainFiles }),
      data_version: dataVersion(isolatedCoreDb),
      schema_version: pragmaScalar(isolatedCoreDb, "schema_version"),
      total_changes: Number(isolatedCoreDb.prepare("SELECT total_changes() AS total_changes").get()?.total_changes || 0),
    },
    engine: {
      ...dataRoleSnapshot({ dbPath: engineDbPath, hashMainFiles }),
      data_version: dataVersion(isolatedEngineDb),
      schema_version: pragmaScalar(isolatedEngineDb, "schema_version"),
      total_changes: Number(isolatedEngineDb.prepare("SELECT total_changes() AS total_changes").get()?.total_changes || 0),
    },
  };

  const coreSnapshotRows = isolatedCoreDb.prepare("SELECT id FROM chunks").all();
  const engineSnapshotRows = isolatedEngineDb.prepare("SELECT chunk_id FROM memory_confidence").all();
  const invariant = evaluateRecentTextIdInvariant({
    engineRows: engineSnapshotRows,
    coreRows: coreSnapshotRows,
  });
  const derivedRows = queries.length === 0 && !queriesFile
    ? deriveRowsForQueries(legacyDb, Math.max(1, Number(deriveLimit) || 24))
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
      const measured = await executeScenarioMeasurements({
        queryText: descriptor.text,
        scenario,
        nowSec,
        parameters,
        repetitions: Math.max(1, Number(repetitions) || 5),
        warmups: Math.max(0, Number(warmups) || 0),
        openHandles,
      });
      scenarioResults.push({
        query: privacySafeDescriptor(descriptor),
        query_text: descriptor.text,
        scenario,
        legacy: measured.legacy,
        isolated_requested: measured.isolated_requested,
        comparison: measured.comparison,
        timing_stats: measured.timing_stats,
      });
    }
  }

  const concurrency = [];
  for (const level of concurrencyLevels) {
    concurrency.push(await runConcurrencySmoke({
      scenarios: scenarioResults,
      level: Number(level),
      calls: 20,
      coreDbPath,
      engineDbPath,
      nowSec,
      parameters,
      concurrencyWorkerDelayMs,
    }));
  }

  const hybridSmokeQuery = scenarioResults.find(item => item.comparison.classification === "isolated_equivalent")?.query_text
    || scenarioResults[0]?.query_text
    || "alpha";
  const hybrid_integration_smoke = {
    legacy: await hybridSmokeRunner({
      queryText: hybridSmokeQuery,
      topK: 5,
      legacyDb,
      isolatedCoreDb,
      isolatedEngineDb,
      capabilities: { isolatedRecent: false },
    }),
    isolated: await hybridSmokeRunner({
      queryText: hybridSmokeQuery,
      topK: 5,
      legacyDb,
      isolatedCoreDb,
      isolatedEngineDb,
      capabilities: { isolatedRecent: true },
    }),
  };

  const after = {
    legacy: {
      data_version: dataVersion(legacyDb),
      total_changes: Number(legacyDb.prepare("SELECT total_changes() AS total_changes").get()?.total_changes || 0),
    },
    core: {
      ...dataRoleSnapshot({ dbPath: coreDbPath, hashMainFiles }),
      data_version: dataVersion(isolatedCoreDb),
      schema_version: pragmaScalar(isolatedCoreDb, "schema_version"),
      total_changes: Number(isolatedCoreDb.prepare("SELECT total_changes() AS total_changes").get()?.total_changes || 0),
    },
    engine: {
      ...dataRoleSnapshot({ dbPath: engineDbPath, hashMainFiles }),
      data_version: dataVersion(isolatedEngineDb),
      schema_version: pragmaScalar(isolatedEngineDb, "schema_version"),
      total_changes: Number(isolatedEngineDb.prepare("SELECT total_changes() AS total_changes").get()?.total_changes || 0),
    },
  };
  const snapshotContext = buildSnapshotContext({
    isolatedSnapshot,
    snapshotIdentityVerified,
  });
  const databaseStability = classifyDatabaseStability({
    before,
    after,
    hashMainFiles,
    snapshotContext,
  });

  const report = {
    report_schema_version: RECENT_ROLLOUT_REPORT_SCHEMA_VERSION,
    audit: "isolated_recent_rollout_readiness",
    fixed_now_used: true,
    scenario_time_consistent: true,
    parameters,
    topology,
    snapshot_guard: {
      core_total: coreSnapshotRows.length,
      core_text_count: coreSnapshotRows.filter(row => typeof row.id === "string").length,
      core_non_text_count: coreSnapshotRows.filter(row => typeof row.id !== "string").length,
      engine_total: engineSnapshotRows.length,
      engine_text_count: engineSnapshotRows.filter(row => typeof row.chunk_id === "string").length,
      engine_non_text_count: engineSnapshotRows.filter(row => typeof row.chunk_id !== "string").length,
      passed: invariant.passed,
    },
    query_corpus: queryCorpus.stats,
    scenarios: scenarioResults.map(item => ({
      query: item.query,
      scenario: item.scenario,
      legacy: item.legacy,
      isolated_requested: item.isolated_requested,
      comparison: item.comparison,
      timing_stats: item.timing_stats,
    })),
    branch_coverage: coverageSummary(scenarioResults),
    concurrency,
    hybrid_integration_smoke,
    missing_confidence_evidence: {
      real_snapshot_count: Number(legacyDb.prepare(`
        SELECT COUNT(*) AS count
        FROM chunks c
        LEFT JOIN memory_confidence mc
          ON c.id = mc.chunk_id
        WHERE COALESCE(mc.is_archived, 0) = 0
          AND c.path NOT LIKE 'memory/generated-smart-add/%'
          AND (c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')
          AND mc.chunk_id IS NULL
      `).get()?.count || 0),
      synthetic_contract_test_present: true,
    },
    database_stability: databaseStability,
    snapshot_context: snapshotContext,
  };
  report.missing_confidence_evidence.real_snapshot_positive_evidence =
    report.missing_confidence_evidence.real_snapshot_count > 0;

  const sensitiveValues = typeof sampleSensitiveValues === "function"
    ? sampleSensitiveValues()
    : collectSensitiveValues({ derivedRows, explicitQueries: queries });
  report.privacy_validation = buildPrivacyValidation(report, sensitiveValues);
  report.decision = decisionForReadiness({
    scenarios: scenarioResults,
    concurrency,
    topology,
    databaseStability,
    privacyValidation: report.privacy_validation,
  });
  report.production_enablement_recommended = false;
  return report;
}

export function writeRecentRolloutReadinessReport(output, outPath) {
  writeFileSync(resolve(String(outPath)), output);
}

async function runConcurrencyWorkerEntry(payload) {
  const {
    coreDbPath,
    engineDbPath,
    queryText,
    scenario,
    nowSec,
    parameters,
    minWorkerDelayMs = 0,
  } = payload;
  const handles = openReadonlyHandlesForPaths({ coreDbPath, engineDbPath });
  const startedAtMs = monotonicNowMs();
  try {
    if (Number(minWorkerDelayMs) > 0) {
      const waitArray = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(waitArray, 0, 0, Number(minWorkerDelayMs));
    }
    const topology = buildTopologies(handles);
    const summary = (await executeMeasuredRun({
      queryText,
      scenario,
      nowSec,
      parameters,
      ...handles,
      mode: "isolated",
    })).summary;
    return {
      ok: true,
      started_at_ms: startedAtMs,
      ended_at_ms: monotonicNowMs(),
      topology,
      summary,
    };
  } catch (error) {
    return {
      ok: false,
      started_at_ms: startedAtMs,
      ended_at_ms: monotonicNowMs(),
      error: sanitizeError(error),
    };
  } finally {
    closeReadonlyHandles(handles);
  }
}

if (!isMainThread && workerData?.type === "recent_rollout_concurrency_worker") {
  runConcurrencyWorkerEntry(workerData)
    .then((result) => {
      parentPort?.postMessage(result);
    })
    .catch((error) => {
      parentPort?.postMessage({
        ok: false,
        worker_error: sanitizeError(error),
      });
    });
}
