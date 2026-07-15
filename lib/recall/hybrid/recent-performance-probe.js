import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";

import Database from "better-sqlite3";

import {
  buildLikeFallbackPatterns,
  normalizeFtsQuery,
  stripPromptMetadataPrefix,
} from "../../../query-utils.js";
import { getDefaultMemoryEngineConfig } from "../../config/defaults.js";
import {
  inferCategoryFromChunk,
  isCandidateAllowedForRerank,
  normalizeExternalMemory,
  normalizeUnixSeconds,
  round4,
  toFiniteNumber,
} from "./normalize-candidate.js";
import { tokenizeQuery } from "./lexical.js";
import { computeRecencyBoost } from "./fusion.js";
import {
  canonicalizeRecentShadowCandidate,
  canonicalizeRecentShadowRawRow,
  fingerprintRecentShadowValue,
} from "./recent-shadow-audit.js";
import {
  openCoreDbReadonly,
  openEngineDbIsolated,
} from "../../db/isolated-dbs.js";
import {
  openEngineDb,
} from "../../db/engine-db.js";

const require = createRequire(import.meta.url);
const betterSqlite3Pkg = require("better-sqlite3/package.json");

export const RECENT_PERFORMANCE_MUTATION_FLAGS = new Set([
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

const DEFAULT_RANKING_CONFIG = getDefaultMemoryEngineConfig()?.ranking || {};
const DEFAULT_NOW_SEC = 1_700_000_000;
const DEFAULT_LIMITS = [20, 100, 500];
const DEFAULT_BATCH_SIZES = [128, 256, 512, 1024];
const DEFAULT_WARMUP_COUNT = 2;
const DEFAULT_REPETITION_COUNT = 5;
export const MAX_PUBLIC_REPORT_BYTES = 2 * 1024 * 1024;
export const DEFAULT_PUBLIC_REPORT_FORBIDDEN_KEYS = [
  "id",
  "chunk_id",
  "text",
  "path",
  "updated_at",
  "created_at",
  "query",
  "normalized_query",
  "archived_json",
  "raw_rows",
  "rows",
  "candidates",
  "legacy_rows",
  "isolated_rows",
  "metadata_rows",
  "engine_rows",
  "core_rows",
  "kg_data",
  "memory_content",
];

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

function stableSerialize(value) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (Buffer.isBuffer(value)) return `buffer:${value.toString("hex")}`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function median(values = []) {
  const numeric = values
    .map(value => Number(value))
    .filter(value => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (numeric.length === 0) return null;
  const middle = Math.floor(numeric.length / 2);
  return numeric.length % 2 === 0
    ? (numeric[middle - 1] + numeric[middle]) / 2
    : numeric[middle];
}

function percentile(values = [], p) {
  const numeric = values
    .map(value => Number(value))
    .filter(value => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (numeric.length === 0) return null;
  const index = Math.min(
    numeric.length - 1,
    Math.max(0, Math.ceil((p / 100) * numeric.length) - 1),
  );
  return numeric[index];
}

function sanitizePlanLine(line) {
  return String(line || "")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizePlan(rows = []) {
  const lines = rows
    .map(row => sanitizePlanLine(row.detail || row[3] || ""))
    .filter(Boolean);
  const tokens = new Set();
  for (const line of lines) {
    if (/CORRELATED/i.test(line)) tokens.add("correlated_subquery");
    if (/LIST SUBQUERY/i.test(line)) tokens.add("list_subquery");
    if (/MATERIALIZE/i.test(line)) tokens.add("materialize");
    if (/json_each/i.test(line)) tokens.add("scan_json_each");
    if (/SEARCH c USING/i.test(line) || /SCAN c USING/i.test(line)) tokens.add("uses_chunks_index");
    if (/TEMP B-TREE/i.test(line)) tokens.add("temp_btree");
  }
  return {
    lines,
    tokens: [...tokens].sort(),
  };
}

function summarizeRecord(position, canonical) {
  return {
    position,
    id_hash: shortHash(canonical.id),
    path_hash: shortHash(canonical.path),
    row_fingerprint: fingerprintRecentShadowValue(canonical),
  };
}

function summarizeRawRows(rows = []) {
  return rows.map((row, index) => summarizeRecord(index, canonicalizeRecentShadowRawRow(row)));
}

function summarizeCandidates(rows = []) {
  return rows.map((row, index) => summarizeRecord(index, canonicalizeRecentShadowCandidate(row)));
}

function compareSummaries(left = [], right = []) {
  return stableSerialize(left) === stableSerialize(right);
}

function createFixtureRoot() {
  return mkdtempSync(join(tmpdir(), "memory-engine-recent-performance-"));
}

function ensureDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function writeReport(output, outPath) {
  ensureDir(outPath);
  const tempPath = `${outPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, output);
  try {
    renameSync(tempPath, outPath);
  } finally {
    rmSync(tempPath, { force: true });
  }
}

function isShortHash(value) {
  return typeof value === "string" && /^[a-f0-9]{16}$/.test(value);
}

function isFingerprintHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function shouldCheckSensitiveValue(value) {
  return typeof value === "string" && value.trim().length >= 4;
}

export function validateRecentPerformancePublicReport(report, options = {}) {
  const forbiddenKeys = new Set(options.forbiddenKeys || DEFAULT_PUBLIC_REPORT_FORBIDDEN_KEYS);
  const sensitiveValues = (options.sensitiveValues || []).filter(shouldCheckSensitiveValue);
  const findings = {
    passed: true,
    forbidden_key_count: 0,
    raw_value_leak_count: 0,
    invalid_hash_count: 0,
    checked_sensitive_value_count: sensitiveValues.length,
  };

  function visit(value) {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) findings.forbidden_key_count += 1;
      if (key === "query_id" || key === "id_hash" || key === "path_hash") {
        if (!isShortHash(child)) findings.invalid_hash_count += 1;
      } else if (key === "row_fingerprint" || key === "raw_fingerprint" || key === "normalized_fingerprint") {
        if (!isFingerprintHash(child)) findings.invalid_hash_count += 1;
      }
      visit(child);
    }
  }

  visit(report);

  const serialized = JSON.stringify(report);
  for (const sensitiveValue of sensitiveValues) {
    if (serialized.includes(sensitiveValue)) findings.raw_value_leak_count += 1;
  }

  findings.passed = findings.forbidden_key_count === 0
    && findings.raw_value_leak_count === 0
    && findings.invalid_hash_count === 0;
  return findings;
}

function lexicalMatchScore(haystack, terms) {
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

function normalizeCandidate(row, { nowSec, minConfidence }) {
  return normalizeExternalMemory(row, {
    nowSec,
    calcRealtimeConf: null,
    categoryMap: null,
  });
}

function filterForRerank(item, minConfidence) {
  return isCandidateAllowedForRerank(item, minConfidence);
}

function uniqueById(items = []) {
  const map = new Map();
  for (const item of items) {
    if (!item || !item.id) continue;
    if (!map.has(item.id)) map.set(item.id, item);
  }
  return [...map.values()];
}

function buildQueryDescriptor(query, sourceType) {
  const rawQuery = String(query || "");
  const stripped = stripPromptMetadataPrefix(rawQuery);
  const normalized = normalizeFtsQuery(stripped);
  const terms = tokenizeQuery(normalized);
  return {
    text: stripped,
    query: {
      query_id: shortHash(stripped),
      source_type: sourceType,
      query_length: stripped.length,
      line_count: stripped === "" ? 0 : stripped.split(/\r?\n/).length,
      term_count: terms.length,
    },
  };
}

function inspectExistingSnapshotInventory() {
  const source = readFileSync(new URL("../hybrid-search.js", import.meta.url), "utf8");
  const engineMatch = source.match(/SELECT chunk_id,\s*confidence,\s*last_confidence_update,\s*base_tau,\s*hit_count,\s*is_protected,\s*conflict_flag,\s*category,\s*is_archived FROM memory_confidence/);
  const coreMatch = source.match(/SELECT id,\s*path,\s*updated_at FROM chunks/);
  const engineFields = engineMatch
    ? ["chunk_id", "confidence", "last_confidence_update", "base_tau", "hit_count", "is_protected", "conflict_flag", "category", "is_archived"]
    : [];
  const coreFields = coreMatch
    ? ["id", "path", "updated_at"]
    : [];
  const engineFieldSet = new Set(engineFields);
  return {
    core_fields: coreFields,
    engine_fields: engineFields,
    engine_snapshot_contains_is_archived: engineFieldSet.has("is_archived"),
    engine_snapshot_contains_full_recent_metadata: [
      "chunk_id",
      "confidence",
      "last_confidence_update",
      "base_tau",
      "hit_count",
      "is_protected",
      "conflict_flag",
      "category",
      "is_archived",
    ].every(field => engineFieldSet.has(field)),
    could_reuse_snapshot_without_extra_engine_query: [
      "chunk_id",
      "confidence",
      "last_confidence_update",
      "base_tau",
      "hit_count",
      "is_protected",
      "conflict_flag",
      "category",
      "is_archived",
    ].every(field => engineFieldSet.has(field)),
  };
}

function databaseNames(db) {
  return db.prepare("PRAGMA database_list").all().map(row => String(row.name));
}

function topologyEntry(db, role) {
  return {
    role,
    readonly: db.readonly === true,
    database_names: databaseNames(db),
  };
}

function fileIdentity(path) {
  const stat = statSync(path);
  return {
    basename: path.split(/[/\\]/).at(-1) || path,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    inode: stat.ino,
  };
}

function databaseStabilitySnapshot({ legacyDb, coreDb, engineDb, coreDbPath, engineDbPath }) {
  return {
    legacy_data_version: Number(legacyDb.prepare("PRAGMA data_version").get().data_version),
    core_data_version: Number(coreDb.prepare("PRAGMA data_version").get().data_version),
    engine_data_version: Number(engineDb.prepare("PRAGMA data_version").get().data_version),
    core_file: fileIdentity(coreDbPath),
    engine_file: fileIdentity(engineDbPath),
  };
}

function sameStableSnapshot(before, after) {
  return stableSerialize(before) === stableSerialize(after);
}

function withExplicitLegacyReadonlyDb({ coreDbPath, engineDbPath }, fn) {
  const previous = {
    CORE_DB_PATH: process.env.CORE_DB_PATH,
    ENGINE_DB_PATH: process.env.ENGINE_DB_PATH,
  };
  process.env.CORE_DB_PATH = coreDbPath;
  process.env.ENGINE_DB_PATH = engineDbPath;
  const db = openEngineDb({ readonly: true });
  try {
    return fn(db);
  } finally {
    db.close();
    if (previous.CORE_DB_PATH == null) delete process.env.CORE_DB_PATH;
    else process.env.CORE_DB_PATH = previous.CORE_DB_PATH;
    if (previous.ENGINE_DB_PATH == null) delete process.env.ENGINE_DB_PATH;
    else process.env.ENGINE_DB_PATH = previous.ENGINE_DB_PATH;
  }
}

function deriveBenchmarkQueryFromCore(coreDb) {
  const rows = coreDb.prepare(`
    SELECT text
    FROM chunks
    WHERE path NOT LIKE 'memory/generated-smart-add/%'
      AND (path LIKE 'memory/smart-add/%' OR path LIKE 'memory/episodes/%')
    ORDER BY updated_at DESC, id ASC
    LIMIT 50
  `).all();
  for (const row of rows) {
    const stripped = stripPromptMetadataPrefix(String(row.text || ""));
    const normalized = normalizeFtsQuery(stripped);
    const terms = tokenizeQuery(normalized).filter(Boolean);
    if (terms.length >= 3) return terms.slice(0, 3).join(" ");
    if (terms.length >= 1) return terms.join(" ");
  }
  return "alpha";
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      text TEXT,
      path TEXT,
      updated_at INTEGER
    );

    CREATE TABLE memory_confidence (
      chunk_id TEXT PRIMARY KEY,
      confidence REAL,
      last_confidence_update INTEGER,
      base_tau REAL,
      hit_count INTEGER,
      is_protected INTEGER,
      conflict_flag INTEGER,
      category TEXT,
      is_archived INTEGER,
      kg_data TEXT
    );
  `);
}

function openFixtureDbs(root) {
  const legacyPath = join(root, "legacy.sqlite");
  const corePath = join(root, "core.sqlite");
  const enginePath = join(root, "engine.sqlite");
  const legacyDb = new Database(legacyPath);
  const coreDb = new Database(corePath);
  const engineDb = new Database(enginePath);
  createSchema(legacyDb);
  createSchema(coreDb);
  createSchema(engineDb);
  return {
    legacyDb,
    coreDb,
    engineDb,
    paths: { legacyPath, corePath, enginePath },
  };
}

function insertChunk(databases, row) {
  for (const db of databases) {
    db.prepare("INSERT INTO chunks (id, text, path, updated_at) VALUES (?, ?, ?, ?)")
      .run(row.id, row.text, row.path, row.updated_at);
  }
}

function insertConfidence(databases, row) {
  for (const db of databases) {
    db.prepare(`
      INSERT INTO memory_confidence (
        chunk_id, confidence, last_confidence_update, base_tau, hit_count,
        is_protected, conflict_flag, category, is_archived, kg_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.chunk_id,
      row.confidence,
      row.last_confidence_update,
      row.base_tau,
      row.hit_count,
      row.is_protected,
      row.conflict_flag,
      row.category,
      row.is_archived,
      row.kg_data,
    );
  }
}

function buildSmallSemanticFixture() {
  const root = createFixtureRoot();
  const { legacyDb, coreDb, engineDb, paths } = openFixtureDbs(root);
  const databases = [legacyDb, coreDb, engineDb];
  const chunkRows = [
    { id: "A", text: "alpha smart text", path: "memory/smart-add/A.md", updated_at: 3000 },
    { id: "B", text: "alpha archived latest", path: "memory/smart-add/B.md", updated_at: 4000 },
    { id: "C", text: "alpha active keep", path: "memory/smart-add/C.md", updated_at: 2000 },
    { id: "D", text: "alpha missing confidence", path: "memory/episodes/D.md", updated_at: 1000 },
    { id: "E", text: "quote' alpha", path: "memory/smart-add/quote'.md", updated_at: 1000 },
    { id: "F", text: "slash\\\\ alpha", path: "memory/smart-add/slash\\\\.md", updated_at: 1000 },
    { id: "G", text: "snow 雪 alpha", path: "memory/episodes/雪.md", updated_at: null },
    { id: "H", text: "percent % alpha", path: "memory/smart-add/percent%.md", updated_at: null },
    { id: "I", text: "under_score alpha", path: "memory/smart-add/under_score.md", updated_at: 1000 },
    { id: "J", text: "generated excluded alpha", path: "memory/generated-smart-add/J.md", updated_at: 5000 },
  ];
  const confidenceRows = [
    { chunk_id: "A", confidence: 0.82, last_confidence_update: 0, base_tau: 7, hit_count: 3, is_protected: 0, conflict_flag: 0, category: "raw_log", is_archived: 0, kg_data: "alpha smart text" },
    { chunk_id: "B", confidence: 0.82, last_confidence_update: 0, base_tau: 7, hit_count: 3, is_protected: 0, conflict_flag: 0, category: "raw_log", is_archived: 1, kg_data: "alpha archived latest" },
    { chunk_id: "C", confidence: 0.82, last_confidence_update: 0, base_tau: 7, hit_count: 3, is_protected: 0, conflict_flag: 0, category: "raw_log", is_archived: 0, kg_data: "alpha active keep" },
    { chunk_id: "E", confidence: 0.82, last_confidence_update: 0, base_tau: 7, hit_count: 3, is_protected: 0, conflict_flag: 0, category: "raw_log", is_archived: 0, kg_data: "quote alpha" },
    { chunk_id: "F", confidence: 0.82, last_confidence_update: 0, base_tau: 7, hit_count: 3, is_protected: 0, conflict_flag: 0, category: "raw_log", is_archived: 0, kg_data: "slash alpha" },
    { chunk_id: "G", confidence: 0.82, last_confidence_update: 0, base_tau: 7, hit_count: 3, is_protected: 0, conflict_flag: 0, category: "episodic", is_archived: 0, kg_data: "snow alpha" },
    { chunk_id: "H", confidence: 0.82, last_confidence_update: 0, base_tau: 7, hit_count: 3, is_protected: 0, conflict_flag: 0, category: "raw_log", is_archived: 0, kg_data: "percent alpha" },
    { chunk_id: "I", confidence: 0.82, last_confidence_update: 0, base_tau: 7, hit_count: 3, is_protected: 0, conflict_flag: 0, category: "raw_log", is_archived: 0, kg_data: "underscore alpha" },
    { chunk_id: "J", confidence: 0.82, last_confidence_update: 0, base_tau: 7, hit_count: 3, is_protected: 0, conflict_flag: 0, category: "raw_log", is_archived: 0, kg_data: "generated alpha" },
  ];
  for (const row of chunkRows) insertChunk(databases, row);
  for (const row of confidenceRows) insertConfidence(databases, row);
  return {
    root,
    legacyDb,
    coreDb,
    engineDb,
    paths,
    summary: {
      type: "small_semantic_fixture",
      core_row_count: chunkRows.length,
      confidence_row_count: confidenceRows.length,
    },
  };
}

function makeLongId(index, length = 220) {
  const prefix = `row-${String(index).padStart(6, "0")}-`;
  return `${prefix}${"x".repeat(Math.max(0, length - prefix.length))}`;
}

function buildProductionShapedFixture({
  totalRows = 2048,
  activeRows = 288,
  episodeRows = 51,
  idLength = 220,
} = {}) {
  const root = createFixtureRoot();
  const { legacyDb, coreDb, engineDb, paths } = openFixtureDbs(root);
  const databases = [legacyDb, coreDb, engineDb];
  const tieGroupSize = Math.max(256, Math.floor(totalRows * 0.52));
  const distinctTimestampCount = Math.max(32, Math.floor(totalRows / 20));
  for (let index = 0; index < totalRows; index += 1) {
    const id = makeLongId(index, idLength);
    const isEpisode = index < episodeRows;
    const isActive = index < activeRows;
    const updated_at = index < tieGroupSize
      ? 5_000
      : 5_000 - (index % distinctTimestampCount);
    const path = isEpisode
      ? `memory/episodes/${id}.md`
      : `memory/smart-add/${id}.md`;
    insertChunk(databases, {
      id,
      text: `alpha fixture ${index}`,
      path,
      updated_at: index % 97 === 0 ? null : updated_at,
    });
    insertConfidence(databases, {
      chunk_id: id,
      confidence: 0.82,
      last_confidence_update: 0,
      base_tau: 7,
      hit_count: 3,
      is_protected: 0,
      conflict_flag: 0,
      category: isEpisode ? "episodic" : "raw_log",
      is_archived: isActive ? 0 : 1,
      kg_data: `alpha fixture ${index}`,
    });
  }
  const archivedIds = engineDb.prepare("SELECT chunk_id FROM memory_confidence WHERE COALESCE(is_archived, 0) != 0").all().map(row => row.chunk_id);
  const archivedJson = JSON.stringify(archivedIds);
  return {
    root,
    legacyDb,
    coreDb,
    engineDb,
    paths,
    summary: {
      type: "production_shaped_fixture",
      core_row_count: totalRows,
      active_row_count: activeRows,
      archived_row_count: totalRows - activeRows,
      archived_ratio: round4((totalRows - activeRows) / totalRows),
      episode_row_count: episodeRows,
      smart_add_row_count: totalRows - episodeRows,
      archived_json_bytes: Buffer.byteLength(archivedJson, "utf8"),
      tie_group_size: tieGroupSize,
      distinct_timestamp_count: distinctTimestampCount,
      id_length: idLength,
    },
  };
}

function closeFixture(fixture) {
  try {
    fixture.legacyDb?.close();
  } catch {}
  try {
    fixture.coreDb?.close();
  } catch {}
  try {
    fixture.engineDb?.close();
  } catch {}
  rmSync(fixture.root, { recursive: true, force: true });
}

function legacyLikeSql(patternCount) {
  const where = Array.from({ length: patternCount }, () => "(c.path LIKE ? OR c.text LIKE ?)").join(" OR ");
  return `
    SELECT c.id, c.text, c.path, c.updated_at,
      mc.confidence as confidence,
      mc.last_confidence_update, COALESCE(mc.base_tau, 7.0) as base_tau,
      COALESCE(mc.hit_count, 0) as hit_count, COALESCE(mc.is_protected, 0) as is_protected,
      COALESCE(mc.conflict_flag, 0) as conflict_flag, mc.category as category,
      COALESCE(mc.is_archived, 0) as is_archived
    FROM chunks c
    LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
    WHERE COALESCE(mc.is_archived, 0) = 0
      AND c.path NOT LIKE 'memory/generated-smart-add/%'
      AND (${where})
    ORDER BY c.updated_at DESC, c.id ASC
    LIMIT ?
  `;
}

const LEGACY_RECENT_SQL = `
  SELECT c.id, c.text, c.path, c.updated_at,
    mc.confidence as confidence,
    mc.last_confidence_update, COALESCE(mc.base_tau, 7.0) as base_tau,
    COALESCE(mc.hit_count, 0) as hit_count, COALESCE(mc.is_protected, 0) as is_protected,
    COALESCE(mc.conflict_flag, 0) as conflict_flag, mc.category as category,
    COALESCE(mc.is_archived, 0) as is_archived
  FROM chunks c
  LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
  WHERE COALESCE(mc.is_archived, 0) = 0
    AND c.path NOT LIKE 'memory/generated-smart-add/%'
    AND (c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')
  ORDER BY c.updated_at DESC, c.id ASC
  LIMIT ?
`;

function buildCoreWhere(branch, patternCount = 0) {
  if (branch === "like_fallback") {
    const where = Array.from({ length: patternCount }, () => "(c.path LIKE ? OR c.text LIKE ?)").join(" OR ");
    return `
      c.path NOT LIKE 'memory/generated-smart-add/%'
      AND (${where})
    `;
  }
  return `
    c.path NOT LIKE 'memory/generated-smart-add/%'
    AND (c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')
  `;
}

function buildStrategySql(branch, patternCount, strategy) {
  const baseWhere = buildCoreWhere(branch, patternCount);
  if (strategy === "strategy_a_current_not_exists") {
    return `
      SELECT c.id, c.text, c.path, c.updated_at
      FROM chunks c
      WHERE ${baseWhere}
        AND NOT EXISTS (
          SELECT 1
          FROM json_each(?) archived
          WHERE c.id = CAST(archived.value AS TEXT)
        )
      ORDER BY c.updated_at DESC, c.id ASC
      LIMIT ?
    `;
  }
  if (strategy === "strategy_b_not_in") {
    return `
      SELECT c.id, c.text, c.path, c.updated_at
      FROM chunks c
      WHERE ${baseWhere}
        AND c.id NOT IN (
          SELECT CAST(value AS TEXT)
          FROM json_each(?)
        )
      ORDER BY c.updated_at DESC, c.id ASC
      LIMIT ?
    `;
  }
  if (strategy === "strategy_c_materialized_cte") {
    return `
      WITH archived(id) AS MATERIALIZED (
        SELECT CAST(value AS TEXT)
        FROM json_each(?)
      )
      SELECT c.id, c.text, c.path, c.updated_at
      FROM chunks c
      LEFT JOIN archived a
        ON a.id = c.id
      WHERE ${baseWhere}
        AND a.id IS NULL
      ORDER BY c.updated_at DESC, c.id ASC
      LIMIT ?
    `;
  }
  throw new Error(`unsupported strategy SQL: ${strategy}`);
}

function buildStrategyParams(branch, likePatterns, archivedJson, limit, strategy) {
  if (branch !== "like_fallback") return [archivedJson, limit];
  const patternParams = likePatterns.flatMap(pattern => [pattern, pattern]);
  if (strategy === "strategy_a_current_not_exists" || strategy === "strategy_b_not_in") {
    return [...patternParams, archivedJson, limit];
  }
  return [archivedJson, ...patternParams, limit];
}

const METADATA_BY_IDS_SQL = `
  WITH selected AS (
    SELECT CAST(value AS TEXT) AS chunk_id
    FROM json_each(?)
  )
  SELECT
    mc.chunk_id,
    mc.confidence,
    mc.last_confidence_update,
    mc.base_tau,
    mc.hit_count,
    mc.is_protected,
    mc.conflict_flag,
    mc.category,
    mc.is_archived
  FROM memory_confidence mc
  JOIN selected s
    ON mc.chunk_id = s.chunk_id
`;

function mergeMetadata(coreRows, metadataRows) {
  const metadataMap = new Map(metadataRows.map(row => [row.chunk_id, row]));
  return coreRows.map(row => {
    const metadata = metadataMap.get(row.id);
    return {
      ...row,
      confidence: metadata?.confidence ?? null,
      last_confidence_update: metadata?.last_confidence_update ?? null,
      base_tau: metadata?.base_tau ?? 7.0,
      hit_count: metadata?.hit_count ?? 0,
      is_protected: metadata?.is_protected ?? 0,
      conflict_flag: metadata?.conflict_flag ?? 0,
      category: metadata?.category ?? null,
      is_archived: metadata?.is_archived ?? 0,
    };
  });
}

function normalizeLikeRows(rows, ctx) {
  return uniqueById(
    rows
      .map(row => {
        const lexical = lexicalMatchScore(`${row.path}\n${row.text}`, ctx.queryTerms);
        return normalizeCandidate({
          ...row,
          similarity: (toFiniteNumber(ctx.rankingConfig?.fallbackBaseScore?.like) ?? 0.3) + lexical,
          created_at: row.updated_at || 0,
        }, ctx);
      })
      .filter(Boolean)
      .filter(item => filterForRerank(item, ctx.minConfidence)),
  );
}

function buildScoredRecent(rows, ctx) {
  return uniqueById(
    rows
      .map(row => {
        const lexical = lexicalMatchScore(`${row.path}\n${row.text}`, ctx.queryTerms);
        if (lexical <= 0) return null;
        const recency = computeRecencyBoost(normalizeUnixSeconds(row.updated_at), ctx.nowSec, ctx.rankingConfig);
        return normalizeCandidate({
          ...row,
          category: row.category || inferCategoryFromChunk(row.path, row.text, null, "raw_log"),
          similarity: (toFiniteNumber(ctx.rankingConfig?.fallbackBaseScore?.recent) ?? 0.35) + lexical + recency,
          created_at: row.updated_at || 0,
        }, ctx);
      })
      .filter(Boolean)
      .filter(item => filterForRerank(item, ctx.minConfidence))
      .sort((a, b) => b.semantic_score - a.semantic_score)
      .slice(0, ctx.recentRerankTopK),
  );
}

function buildEpisodeRows(scoredRecent, ctx) {
  return scoredRecent
    .filter(row => row.category === "episodic" || String(row.path).startsWith("memory/episodes/"))
    .map(row => normalizeCandidate({
      ...row,
      similarity: row.semantic_score + (toFiniteNumber(ctx.rankingConfig?.fallbackBaseScore?.episodeBonus) ?? 0.08),
    }, ctx))
    .filter(Boolean)
    .slice(0, ctx.recentRerankTopK);
}

function buildRecentFallbackRows(rows, ctx) {
  return uniqueById(
    rows
      .map(row => {
        const category = row.category || inferCategoryFromChunk(row.path, row.text, null, "raw_log");
        const recency = computeRecencyBoost(normalizeUnixSeconds(row.updated_at), ctx.nowSec, ctx.rankingConfig);
        return normalizeCandidate({
          ...row,
          category,
          similarity: (toFiniteNumber(ctx.rankingConfig?.fallbackBaseScore?.recentFallback) ?? 0.25) + recency,
          created_at: row.updated_at || 0,
        }, ctx);
      })
      .filter(Boolean)
      .filter(item => filterForRerank(item, ctx.minConfidence)),
  );
}

function buildProbeContext(query, overrides = {}) {
  const strippedQuery = stripPromptMetadataPrefix(String(query || ""));
  const normalizedQuery = normalizeFtsQuery(strippedQuery);
  return {
    rawQuery: query,
    strippedQuery,
    normalizedQuery,
    queryTerms: tokenizeQuery(normalizedQuery),
    rankingConfig: DEFAULT_RANKING_CONFIG,
    nowSec: overrides.nowSec ?? DEFAULT_NOW_SEC,
    minConfidence: overrides.minConfidence ?? 0,
    recentRerankTopK: overrides.recentRerankTopK ?? overrides.limit ?? 20,
  };
}

function summarizeResultRows(rawRows, candidateRows) {
  return {
    raw_count: rawRows.length,
    raw_summaries: summarizeRawRows(rawRows),
    candidate_count: candidateRows.length,
    candidate_summaries: summarizeCandidates(candidateRows),
  };
}

function compareBranchResults(legacyBranch, strategyBranch) {
  return {
    raw_count_equal: legacyBranch.raw_count === strategyBranch.raw_count,
    raw_fingerprints_equal: compareSummaries(legacyBranch.raw_summaries, strategyBranch.raw_summaries),
    candidate_count_equal: legacyBranch.candidate_count === strategyBranch.candidate_count,
    normalized_fingerprints_equal: compareSummaries(legacyBranch.candidate_summaries, strategyBranch.candidate_summaries),
    ordered_ids_equal: compareSummaries(
      legacyBranch.candidate_summaries.map(item => item.id_hash),
      strategyBranch.candidate_summaries.map(item => item.id_hash),
    ),
  };
}

function summarizeBranchComparison(results) {
  return {
    equivalent: Object.values(results).every(Boolean),
    ...results,
  };
}

function loadArchivedIds(engineDb) {
  return engineDb.prepare(`
    SELECT chunk_id
    FROM memory_confidence
    WHERE COALESCE(is_archived, 0) != 0
      AND typeof(chunk_id) = 'text'
  `).all().map(row => row.chunk_id);
}

function loadEngineSnapshot(engineDb) {
  return engineDb.prepare(`
    SELECT chunk_id, confidence, last_confidence_update, base_tau, hit_count,
      is_protected, conflict_flag, category, is_archived
    FROM memory_confidence
    WHERE typeof(chunk_id) = 'text'
  `).all();
}

function executeLegacyBranch(db, branch, query, limit, options = {}) {
  const ctx = buildProbeContext(query, { limit });
  if (branch === "like_fallback") {
    const likePatterns = buildLikeFallbackPatterns(ctx.normalizedQuery, options.likePatternTopN || 8);
    if (likePatterns.length === 0) return { ...summarizeResultRows([], []), metrics: emptyMetrics() };
    const params = [...likePatterns.flatMap(pattern => [pattern, pattern]), limit];
    const rawRows = db.prepare(legacyLikeSql(likePatterns.length)).all(...params);
    const candidateRows = normalizeLikeRows(rawRows, ctx);
    return { ...summarizeResultRows(rawRows, candidateRows), metrics: emptyMetrics() };
  }
  const rawRows = db.prepare(LEGACY_RECENT_SQL).all(limit);
  if (branch === "recent_scored") {
    const candidateRows = buildScoredRecent(rawRows, ctx);
    return { ...summarizeResultRows(rawRows, candidateRows), metrics: emptyMetrics() };
  }
  if (branch === "recent_fallback") {
    const candidateRows = buildRecentFallbackRows(rawRows, ctx);
    return { ...summarizeResultRows(rawRows, candidateRows), metrics: emptyMetrics() };
  }
  throw new Error(`unsupported legacy branch: ${branch}`);
}

function emptyMetrics() {
  return {
    repetitions: 0,
    warmup_count: 0,
    median_ms: null,
    p95_ms: null,
    min_ms: null,
    max_ms: null,
    core_query_count: 0,
    engine_query_count: 0,
    metadata_query_count: 0,
    rows_read_from_core: 0,
    ids_transferred_to_engine: 0,
    json_payload_total_bytes: 0,
    json_payload_max_bytes: 0,
    active_yield_ratio: null,
  };
}

function buildMetrics(measurements, observed) {
  const values = measurements.map(item => item.duration_ms);
  return {
    repetitions: measurements.length,
    warmup_count: observed.warmup_count,
    median_ms: median(values),
    p95_ms: percentile(values, 95),
    min_ms: values.length > 0 ? Math.min(...values) : null,
    max_ms: values.length > 0 ? Math.max(...values) : null,
    core_query_count: observed.core_query_count,
    engine_query_count: observed.engine_query_count,
    metadata_query_count: observed.metadata_query_count,
    rows_read_from_core: observed.rows_read_from_core,
    ids_transferred_to_engine: observed.ids_transferred_to_engine,
    json_payload_total_bytes: observed.json_payload_total_bytes,
    json_payload_max_bytes: observed.json_payload_max_bytes,
    active_yield_ratio: observed.active_yield_ratio,
  };
}

function explainStrategyPlan(coreDb, branch, query, limit, strategy, archivedJson) {
  if (strategy === "strategy_d_paged_core_first" || strategy === "strategy_e_snapshot_reuse") {
    return { supported: true, lines: [], tokens: [] };
  }
  try {
    const ctx = buildProbeContext(query, { limit });
    const likePatterns = branch === "like_fallback"
      ? buildLikeFallbackPatterns(ctx.normalizedQuery, 8)
      : [];
    if (branch === "like_fallback" && likePatterns.length === 0) {
      return { supported: true, lines: [], tokens: [] };
    }
    const sql = buildStrategySql(branch, likePatterns.length, strategy);
    const params = buildStrategyParams(branch, likePatterns, archivedJson, limit, strategy);
    const rows = coreDb.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params);
    return { supported: true, ...summarizePlan(rows) };
  } catch (error) {
    return {
      supported: false,
      reason: String(error.message || error),
      lines: [],
      tokens: [],
    };
  }
}

function executeCoreStrategyBranch(coreDb, engineDb, branch, query, limit, strategy, options = {}) {
  const ctx = buildProbeContext(query, { limit, minConfidence: options.minConfidence });
  const archivedIds = loadArchivedIds(engineDb);
  const archivedJson = JSON.stringify(archivedIds);
  const archivedJsonBytes = Buffer.byteLength(archivedJson, "utf8");
  const observed = {
    warmup_count: options.warmupCount ?? DEFAULT_WARMUP_COUNT,
    core_query_count: 1,
    engine_query_count: 2,
    metadata_query_count: 1,
    rows_read_from_core: 0,
    ids_transferred_to_engine: 0,
    json_payload_total_bytes: archivedJsonBytes,
    json_payload_max_bytes: archivedJsonBytes,
    active_yield_ratio: null,
  };
  const likePatterns = branch === "like_fallback"
    ? buildLikeFallbackPatterns(ctx.normalizedQuery, options.likePatternTopN || 8)
    : [];
  if (branch === "like_fallback" && likePatterns.length === 0) {
    return {
      rawRows: [],
      candidateRows: [],
      metrics: buildMetrics([], observed),
      plan: explainStrategyPlan(coreDb, branch, query, limit, strategy, archivedJson),
    };
  }

  const runOnce = () => {
    const sql = buildStrategySql(branch, likePatterns.length, strategy);
    const params = buildStrategyParams(branch, likePatterns, archivedJson, limit, strategy);
    const coreRows = coreDb.prepare(sql).all(...params);
    observed.rows_read_from_core = coreRows.length;
    const selectedIds = coreRows.map(row => row.id);
    observed.ids_transferred_to_engine = selectedIds.length;
    const metadataRows = selectedIds.length === 0
      ? []
      : engineDb.prepare(METADATA_BY_IDS_SQL).all(JSON.stringify(selectedIds));
    const rawRows = mergeMetadata(coreRows, metadataRows);
    observed.active_yield_ratio = coreRows.length === 0
      ? null
      : round4(rawRows.length / coreRows.length);
    const candidateRows = branch === "like_fallback"
      ? normalizeLikeRows(rawRows, ctx)
      : branch === "recent_scored"
        ? buildScoredRecent(rawRows, ctx)
        : buildRecentFallbackRows(rawRows, ctx);
    return { rawRows, candidateRows };
  };

  for (let index = 0; index < (options.warmupCount ?? DEFAULT_WARMUP_COUNT); index += 1) runOnce();
  const measurements = [];
  let last = { rawRows: [], candidateRows: [] };
  for (let index = 0; index < (options.repetitionCount ?? DEFAULT_REPETITION_COUNT); index += 1) {
    const started = performance.now();
    last = runOnce();
    measurements.push({
      duration_ms: performance.now() - started,
    });
  }
  return {
    ...last,
    metrics: buildMetrics(measurements, observed),
    plan: explainStrategyPlan(coreDb, branch, query, limit, strategy, archivedJson),
  };
}

function buildPagingSql(branch, limit, offset, likePatterns = []) {
  const params = [];
  let where = "";
  if (branch === "like_fallback") {
    where = `
      c.path NOT LIKE 'memory/generated-smart-add/%'
      AND (${Array.from({ length: likePatterns.length }, () => "(c.path LIKE ? OR c.text LIKE ?)").join(" OR ")})
    `;
    for (const pattern of likePatterns) params.push(pattern, pattern);
  } else {
    where = `
      c.path NOT LIKE 'memory/generated-smart-add/%'
      AND (c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')
    `;
  }
  params.push(limit, offset);
  return {
    sql: `
      SELECT c.id, c.text, c.path, c.updated_at
      FROM chunks c
      WHERE ${where}
      ORDER BY c.updated_at DESC, c.id ASC
      LIMIT ? OFFSET ?
    `,
    params,
  };
}

function executePagedBranch(coreDb, engineDb, branch, query, limit, strategy, options = {}) {
  const ctx = buildProbeContext(query, { limit, minConfidence: options.minConfidence });
  const batchSize = options.batchSize || 256;
  const likePatterns = branch === "like_fallback"
    ? buildLikeFallbackPatterns(ctx.normalizedQuery, options.likePatternTopN || 8)
    : [];
  if (branch === "like_fallback" && likePatterns.length === 0) {
    return {
      rawRows: [],
      candidateRows: [],
      metrics: {
        ...emptyMetrics(),
        warmup_count: options.warmupCount ?? DEFAULT_WARMUP_COUNT,
        core_query_count: 1,
      },
    };
  }
  const snapshotRows = strategy === "strategy_e_snapshot_reuse"
    ? loadEngineSnapshot(engineDb)
    : null;
  const snapshotMap = snapshotRows
    ? new Map(snapshotRows.map(row => [row.chunk_id, row]))
    : null;
  const archivedSnapshot = snapshotRows
    ? new Set(snapshotRows.filter(row => Number(row.is_archived || 0) !== 0).map(row => row.chunk_id))
    : null;

  const runOnce = () => {
    let offset = 0;
    let pageCoreCount = 0;
    let metadataQueryCount = 0;
    let idsTransferred = 0;
    const rawRows = [];
    while (rawRows.length < limit) {
      const { sql, params } = buildPagingSql(branch, batchSize, offset, likePatterns);
      const pageRows = coreDb.prepare(sql).all(...params);
      pageCoreCount += pageRows.length;
      if (pageRows.length === 0) break;
      offset += batchSize;

      let mergedRows;
      if (strategy === "strategy_e_snapshot_reuse" && snapshotMap && archivedSnapshot) {
        mergedRows = pageRows
          .filter(row => !archivedSnapshot.has(row.id))
          .map(row => ({
            ...row,
            confidence: snapshotMap.get(row.id)?.confidence ?? null,
            last_confidence_update: snapshotMap.get(row.id)?.last_confidence_update ?? null,
            base_tau: snapshotMap.get(row.id)?.base_tau ?? 7.0,
            hit_count: snapshotMap.get(row.id)?.hit_count ?? 0,
            is_protected: snapshotMap.get(row.id)?.is_protected ?? 0,
            conflict_flag: snapshotMap.get(row.id)?.conflict_flag ?? 0,
            category: snapshotMap.get(row.id)?.category ?? null,
            is_archived: snapshotMap.get(row.id)?.is_archived ?? 0,
          }));
      } else {
        const selectedIds = pageRows.map(row => row.id);
        idsTransferred += selectedIds.length;
        metadataQueryCount += selectedIds.length > 0 ? 1 : 0;
        const metadataRows = selectedIds.length === 0
          ? []
          : engineDb.prepare(METADATA_BY_IDS_SQL).all(JSON.stringify(selectedIds));
        mergedRows = mergeMetadata(pageRows, metadataRows)
          .filter(row => Number(row.is_archived || 0) === 0);
      }

      for (const row of mergedRows) {
        rawRows.push(row);
        if (rawRows.length >= limit) break;
      }
    }

    const candidateRows = branch === "like_fallback"
      ? normalizeLikeRows(rawRows, ctx)
      : branch === "recent_scored"
        ? buildScoredRecent(rawRows, ctx)
        : buildRecentFallbackRows(rawRows, ctx);
    return {
      rawRows,
      candidateRows,
      pageCoreCount,
      metadataQueryCount,
      idsTransferred,
    };
  };

  for (let index = 0; index < (options.warmupCount ?? DEFAULT_WARMUP_COUNT); index += 1) runOnce();
  const measurements = [];
  let last = null;
  for (let index = 0; index < (options.repetitionCount ?? DEFAULT_REPETITION_COUNT); index += 1) {
    const started = performance.now();
    last = runOnce();
    measurements.push({ duration_ms: performance.now() - started });
  }
  const observed = {
    warmup_count: options.warmupCount ?? DEFAULT_WARMUP_COUNT,
    core_query_count: last == null ? 0 : Math.ceil(last.pageCoreCount / batchSize) || 1,
    engine_query_count: strategy === "strategy_e_snapshot_reuse" ? 0 : last?.metadataQueryCount || 0,
    metadata_query_count: strategy === "strategy_e_snapshot_reuse" ? 0 : last?.metadataQueryCount || 0,
    rows_read_from_core: last?.pageCoreCount || 0,
    ids_transferred_to_engine: last?.idsTransferred || 0,
    json_payload_total_bytes: 0,
    json_payload_max_bytes: 0,
    active_yield_ratio: last?.pageCoreCount
      ? round4((last?.rawRows.length || 0) / last.pageCoreCount)
      : null,
  };
  return {
    rawRows: last?.rawRows || [],
    candidateRows: last?.candidateRows || [],
    metrics: buildMetrics(measurements, observed),
  };
}

function executeStrategyBranch(coreDb, engineDb, branch, query, limit, strategy, options = {}) {
  if (strategy === "strategy_d_paged_core_first" || strategy === "strategy_e_snapshot_reuse") {
    return executePagedBranch(coreDb, engineDb, branch, query, limit, strategy, options);
  }
  return executeCoreStrategyBranch(coreDb, engineDb, branch, query, limit, strategy, options);
}

function summarizeEpisode(scoredRecent, ctx) {
  const candidates = buildEpisodeRows(scoredRecent, ctx);
  return summarizeResultRows(candidates, candidates);
}

function executeLegacyScenario(db, query, { ftsIsEmpty, limit }) {
  const recentScored = executeLegacyBranch(db, "recent_scored", query, limit);
  const recentCtx = buildProbeContext(query, { limit });
  const recentCandidateRows = recentScored.candidate_summaries.length === 0
    ? []
    : recentScored;
  return {
    like_fallback: ftsIsEmpty ? executeLegacyBranch(db, "like_fallback", query, limit) : summarizeResultRows([], []),
    recent_scored: recentScored,
    episode_projection: summarizeEpisode(
      buildScoredRecent(
        db.prepare(LEGACY_RECENT_SQL).all(limit),
        recentCtx,
      ),
      recentCtx,
    ),
    recent_fallback: ftsIsEmpty ? executeLegacyBranch(db, "recent_fallback", query, limit) : summarizeResultRows([], []),
  };
}

function executeStrategyScenario(coreDb, engineDb, query, { ftsIsEmpty, limit, strategy, batchSize, minConfidence }) {
  const recentScoredResult = executeStrategyBranch(coreDb, engineDb, "recent_scored", query, limit, strategy, { batchSize, minConfidence });
  const recentCtx = buildProbeContext(query, { limit, minConfidence });
  const recentScoredCandidates = buildScoredRecent(recentScoredResult.rawRows, recentCtx);
  return {
    like_fallback: ftsIsEmpty
      ? (() => {
          const result = executeStrategyBranch(coreDb, engineDb, "like_fallback", query, limit, strategy, { batchSize, minConfidence });
          return { ...summarizeResultRows(result.rawRows, result.candidateRows), metrics: result.metrics, plan: result.plan };
        })()
      : { ...summarizeResultRows([], []), metrics: emptyMetrics(), plan: { supported: true, lines: [], tokens: [] } },
    recent_scored: {
      ...summarizeResultRows(recentScoredResult.rawRows, recentScoredCandidates),
      metrics: recentScoredResult.metrics,
      plan: recentScoredResult.plan,
    },
    episode_projection: summarizeEpisode(recentScoredCandidates, recentCtx),
    recent_fallback: ftsIsEmpty
      ? (() => {
          const result = executeStrategyBranch(coreDb, engineDb, "recent_fallback", query, limit, strategy, { batchSize, minConfidence });
          return { ...summarizeResultRows(result.rawRows, result.candidateRows), metrics: result.metrics, plan: result.plan };
        })()
      : { ...summarizeResultRows([], []), metrics: emptyMetrics(), plan: { supported: true, lines: [], tokens: [] } },
  };
}

function compareScenarioResults(legacy, candidate) {
  const branches = {};
  for (const branch of ["like_fallback", "recent_scored", "episode_projection", "recent_fallback"]) {
    branches[branch] = summarizeBranchComparison(compareBranchResults(legacy[branch], candidate[branch]));
  }
  return {
    branches,
    equivalent: Object.values(branches).every(item => item.equivalent),
  };
}

function buildQueryCorpus() {
  return [
    buildQueryDescriptor("alpha", "semantic_alpha"),
    buildQueryDescriptor("quote'", "semantic_quote"),
    buildQueryDescriptor("slash\\\\", "semantic_slash"),
    buildQueryDescriptor("雪", "semantic_unicode"),
    buildQueryDescriptor("%", "semantic_percent"),
    buildQueryDescriptor("_", "semantic_underscore"),
    buildQueryDescriptor("__recent_performance_no_hit_control__", "no_hit_control"),
  ];
}

function buildSensitiveValues(fixtures) {
  const values = [];
  for (const fixture of fixtures) {
    const rows = [
      ...fixture.legacyDb.prepare("SELECT id, text, path, updated_at FROM chunks LIMIT 50").all(),
      ...fixture.engineDb.prepare("SELECT chunk_id, category, kg_data FROM memory_confidence LIMIT 50").all(),
    ];
    for (const row of rows) {
      for (const value of Object.values(row)) {
        if (typeof value !== "string") continue;
        values.push(value);
      }
    }
  }
  return values;
}

function summarizeSemanticForPublic(semanticSmall) {
  return {
    queries: semanticSmall.queries,
    strategies: Object.fromEntries(
      Object.entries(semanticSmall.strategies).map(([name, value]) => [name, {
        branch_equivalent: value.branch_equivalent,
        scenario_count: value.scenarios.length,
      }]),
    ),
  };
}

function buildPerformancePublicSection(performance) {
  return Object.fromEntries(
    Object.entries(performance || {}).map(([sectionName, sectionValue]) => [sectionName, Object.fromEntries(
      Object.entries(sectionValue).map(([strategyName, strategy]) => [strategyName, {
        branches: Object.fromEntries(
          Object.entries(strategy.branches).map(([branchName, branch]) => [branchName, {
            limit: branch.limit ?? null,
            semantic_equivalent: branch.semantic_equivalent ?? null,
            database_stable: branch.database_stable ?? null,
            valid_measurement_count: branch.valid_measurement_count ?? branch.metrics?.repetitions ?? 0,
            metrics: branch.metrics,
            plan: branch.plan,
          }]),
        ),
      }]),
    )]),
  );
}

export function buildRecentPerformancePublicReport(internalResult) {
  return {
    probe: "isolated_recent_archived_exclusion_performance",
    mode: internalResult.mode || "synthetic",
    sqlite_version: internalResult.sqlite_version,
    better_sqlite3_version: internalResult.better_sqlite3_version,
    canonical_field_names: {
      raw: RAW_ROW_FIELDS,
      normalized: NORMALIZED_FIELDS,
    },
    existing_snapshot_inventory: internalResult.existingSnapshotInventory,
    fixtures: internalResult.fixtures,
    semantic: {
      small_fixture: summarizeSemanticForPublic(internalResult.semanticSmall),
      limit_results: internalResult.limitResults,
      batch_size_results: internalResult.batchResults,
    },
    performance: buildPerformancePublicSection(internalResult.performance),
    plans: internalResult.plans,
    strategy_e_applicable: internalResult.existingSnapshotInventory.could_reuse_snapshot_without_extra_engine_query,
    null_payload_case: internalResult.nullPayloadCase,
    missing_confidence_case: internalResult.missingConfidenceCase,
    topology: internalResult.topology || null,
    database_stability: internalResult.databaseStability || null,
    benchmark_query_descriptor: internalResult.benchmarkQueryDescriptor || null,
    sql_rewrite_comparison: internalResult.sqlRewriteComparison || null,
    production_limit_comparison: internalResult.productionLimitComparison || null,
    strategy_d: internalResult.strategyD || null,
    strategy_e: internalResult.strategyE || null,
    candidate_level_details_included: false,
  };
}

function cellIsComparable(cell) {
  return Boolean(cell)
    && cell.semantic_equivalent === true
    && cell.database_stable !== false
    && !cell.error
    && Number.isFinite(cell.p95_ms)
    && Number.isFinite(cell.median_ms)
    && cell.p95_ms >= 0
    && cell.median_ms >= 0
    && Number(cell.valid_measurement_count || 0) > 0;
}

function materiallyDifferent(leftValue, rightValue, options = {}) {
  const absoluteToleranceMs = options.absoluteToleranceMs ?? 3;
  const relativeTolerance = options.relativeTolerance ?? 0.05;
  const gap = Math.abs(leftValue - rightValue);
  const threshold = Math.max(absoluteToleranceMs, Math.max(leftValue, rightValue) * relativeTolerance);
  return gap > threshold;
}

export function compareSqlRewriteStrategies({
  strategyBCells = [],
  strategyCCells = [],
  productionLimits = {},
  absoluteToleranceMs = 3,
  relativeTolerance = 0.05,
  maxAcceptableP95Ms = 500,
} = {}) {
  const byKey = (cells) => new Map(cells.map(cell => [`${cell.branch}:${cell.limit}`, cell]));
  const bMap = byKey(strategyBCells);
  const cMap = byKey(strategyCCells);
  const keys = [...new Set([...bMap.keys(), ...cMap.keys()])].sort();
  const comparable = [];
  let bWinCount = 0;
  let cWinCount = 0;
  let tieCount = 0;
  let prodBWinCount = 0;
  let prodCWinCount = 0;
  let prodTieCount = 0;

  for (const key of keys) {
    const b = bMap.get(key);
    const c = cMap.get(key);
    if (!cellIsComparable(b) || !cellIsComparable(c)) continue;
    const isProductionLimit = productionLimits[b.branch] === b.limit;
    let winner = "tie";
    if (materiallyDifferent(b.p95_ms, c.p95_ms, { absoluteToleranceMs, relativeTolerance })) {
      winner = b.p95_ms < c.p95_ms ? "b" : "c";
    }
    comparable.push({
      branch: b.branch,
      limit: b.limit,
      b_p95_ms: b.p95_ms,
      c_p95_ms: c.p95_ms,
      winner,
      production_limit: isProductionLimit,
    });
    if (winner === "b") bWinCount += 1;
    else if (winner === "c") cWinCount += 1;
    else tieCount += 1;

    if (isProductionLimit) {
      if (winner === "b") prodBWinCount += 1;
      else if (winner === "c") prodCWinCount += 1;
      else prodTieCount += 1;
    }
  }

  const bP95s = comparable.map(item => item.b_p95_ms);
  const cP95s = comparable.map(item => item.c_p95_ms);
  return {
    comparable_cell_count: comparable.length,
    b_p95_median_ms: median(bP95s),
    c_p95_median_ms: median(cP95s),
    b_p95_mean_ms: bP95s.length === 0 ? null : round4(bP95s.reduce((sum, value) => sum + value, 0) / bP95s.length),
    c_p95_mean_ms: cP95s.length === 0 ? null : round4(cP95s.reduce((sum, value) => sum + value, 0) / cP95s.length),
    b_worst_p95_ms: bP95s.length === 0 ? null : Math.max(...bP95s),
    c_worst_p95_ms: cP95s.length === 0 ? null : Math.max(...cP95s),
    b_cell_win_count: bWinCount,
    c_cell_win_count: cWinCount,
    tie_count: tieCount,
    production_limit_comparison: {
      cells_found: comparable.filter(item => item.production_limit).length,
      b_win_count: prodBWinCount,
      c_win_count: prodCWinCount,
      tie_count: prodTieCount,
    },
    production_limit_cells: comparable.filter(item => item.production_limit),
    all_b_cells_acceptable: bP95s.every(value => value <= maxAcceptableP95Ms),
    all_c_cells_acceptable: cP95s.every(value => value <= maxAcceptableP95Ms),
  };
}

function runSemanticSuite(fixture, options = {}) {
  const queries = buildQueryCorpus();
  const scenarios = [
    { name: "fts_has_results", ftsIsEmpty: false, limit: 20 },
    { name: "fts_empty", ftsIsEmpty: true, limit: 20 },
  ];
  const strategies = {};
  for (const strategy of [
    "strategy_a_current_not_exists",
    "strategy_b_not_in",
    "strategy_c_materialized_cte",
    "strategy_d_paged_core_first",
    "strategy_e_snapshot_reuse",
  ]) {
    strategies[strategy] = {
      scenarios: [],
      branch_equivalent: {
        like_fallback: true,
        recent_scored: true,
        recent_fallback: true,
        episode_projection: true,
      },
    };
  }

  for (const descriptor of queries) {
    for (const scenario of scenarios) {
      const legacy = executeLegacyScenario(fixture.legacyDb, descriptor.text, scenario);
      for (const strategy of Object.keys(strategies)) {
        const candidate = executeStrategyScenario(
          fixture.coreDb,
          fixture.engineDb,
          descriptor.text,
          {
            ...scenario,
            strategy,
            batchSize: 256,
            minConfidence: options.minConfidence ?? 0,
          },
        );
        const comparison = compareScenarioResults(legacy, candidate);
        for (const branch of Object.keys(strategies[strategy].branch_equivalent)) {
          strategies[strategy].branch_equivalent[branch] &&= comparison.branches[branch].equivalent;
        }
        strategies[strategy].scenarios.push({
          query: descriptor.query,
          scenario,
          comparison,
        });
      }
    }
  }
  return {
    queries: queries.map(item => item.query),
    strategies,
  };
}

function runLimitSuite(fixture, options = {}) {
  const results = {};
  for (const limit of options.limits || DEFAULT_LIMITS) {
    const legacy = executeLegacyScenario(fixture.legacyDb, "alpha", { ftsIsEmpty: true, limit });
    results[limit] = {};
    for (const strategy of [
      "strategy_a_current_not_exists",
      "strategy_b_not_in",
      "strategy_c_materialized_cte",
      "strategy_d_paged_core_first",
      "strategy_e_snapshot_reuse",
    ]) {
      const candidate = executeStrategyScenario(fixture.coreDb, fixture.engineDb, "alpha", {
        ftsIsEmpty: true,
        limit,
        strategy,
        batchSize: 256,
        minConfidence: options.minConfidence ?? 0,
      });
      results[limit][strategy] = compareScenarioResults(legacy, candidate).equivalent;
    }
  }
  return results;
}

function runBatchSizeSuite(fixture, options = {}) {
  const results = {};
  for (const batchSize of options.batchSizes || DEFAULT_BATCH_SIZES) {
    const legacy = executeLegacyScenario(fixture.legacyDb, "alpha", { ftsIsEmpty: true, limit: 100 });
    const result = executeStrategyScenario(fixture.coreDb, fixture.engineDb, "alpha", {
      ftsIsEmpty: true,
      limit: 100,
      strategy: "strategy_d_paged_core_first",
      batchSize,
      minConfidence: options.minConfidence ?? 0,
    });
    results[batchSize] = compareScenarioResults(legacy, result).equivalent;
  }
  return results;
}

function runPerformanceSuite(fixture, options = {}) {
  const limit = options.performanceLimit || 100;
  const branches = {
    like_fallback: { query: "alpha", ftsIsEmpty: true },
    recent_scored: { query: "alpha", ftsIsEmpty: false },
    recent_fallback: { query: "alpha", ftsIsEmpty: true },
  };
  const strategies = {};
  for (const strategy of [
    "strategy_a_current_not_exists",
    "strategy_b_not_in",
    "strategy_c_materialized_cte",
    "strategy_d_paged_core_first",
    "strategy_e_snapshot_reuse",
  ]) {
    strategies[strategy] = { branches: {} };
    for (const [branch, branchConfig] of Object.entries(branches)) {
      const result = executeStrategyBranch(fixture.coreDb, fixture.engineDb, branch, branchConfig.query, limit, strategy, {
        batchSize: 256,
        minConfidence: options.minConfidence ?? 0,
        warmupCount: options.warmupCount ?? DEFAULT_WARMUP_COUNT,
        repetitionCount: options.repetitionCount ?? DEFAULT_REPETITION_COUNT,
      });
      strategies[strategy].branches[branch] = {
        metrics: result.metrics,
        plan: result.plan || explainStrategyPlan(fixture.coreDb, branch, branchConfig.query, limit, strategy, JSON.stringify(loadArchivedIds(fixture.engineDb))),
      };
    }
  }
  return strategies;
}

function buildRealBranchLimitCells(strategyBranches = {}, branchEquivalence = {}) {
  return Object.entries(strategyBranches).map(([branchKey, branchValue]) => ({
    branch: branchValue.branch_family || branchKey,
    limit: branchValue.limit,
    semantic_equivalent: branchValue.semantic_equivalent ?? (branchEquivalence[branchValue.branch_family || branchKey] ?? true),
    database_stable: branchValue.database_stable !== false,
    valid_measurement_count: branchValue.valid_measurement_count ?? branchValue.metrics?.repetitions ?? 0,
    median_ms: branchValue.metrics?.median_ms ?? branchValue.median_ms,
    p95_ms: branchValue.metrics?.p95_ms ?? branchValue.p95_ms,
    core_query_count: branchValue.metrics?.core_query_count ?? branchValue.core_query_count ?? 0,
    engine_query_count: branchValue.metrics?.engine_query_count ?? branchValue.engine_query_count ?? 0,
    metadata_query_count: branchValue.metrics?.metadata_query_count ?? branchValue.metadata_query_count ?? 0,
    rows_read_from_core: branchValue.metrics?.rows_read_from_core ?? branchValue.rows_read_from_core ?? 0,
    text_bytes: branchValue.core_text_utf8_bytes ?? 0,
    path_bytes: branchValue.core_path_utf8_bytes ?? 0,
    error: branchValue.error ?? null,
  }));
}

function productionLimitMapFromConfig() {
  const recall = getDefaultMemoryEngineConfig()?.recall || {};
  return {
    recent_scored: Math.max(1, Number(recall.recentTopK) || 120),
    like_fallback: Math.max(1, Number(recall.likeTopK) || 30),
    recent_fallback: Math.max(1, Number(recall.recentFallbackTopK) || 20),
  };
}

function benchmarkLimits() {
  const production = productionLimitMapFromConfig();
  return [...new Set([20, 100, 500, production.recent_scored, production.like_fallback, production.recent_fallback])]
    .sort((a, b) => a - b);
}

function requiredBranchesForPerformance() {
  return ["like_fallback", "recent_scored", "recent_fallback", "episode_projection"];
}

function branchEquivalenceAllTrue(branchEquivalence, requiredBranches) {
  return requiredBranches.every(branch => branchEquivalence?.[branch] === true);
}

function materiallyBetter(leftValue, rightValue, options = {}) {
  return materiallyDifferent(leftValue, rightValue, options) && leftValue < rightValue;
}

function strategyHasSlowRequiredCell(cells = [], maxAcceptableP95Ms = 500) {
  return cells.some(cell => cellIsComparable(cell) && cell.p95_ms > maxAcceptableP95Ms);
}

function normalizeStrategyInput(input = {}) {
  return {
    branch_equivalent: input.branch_equivalent || {},
    cells: input.cells || [],
    applicable: input.applicable !== false,
  };
}

function buildStrategyCellsFromSyntheticPerformance(branches, branchEquivalence, limit) {
  return Object.entries(branches).map(([branch, value]) => ({
    branch,
    limit,
    semantic_equivalent: branchEquivalence?.[branch] ?? true,
    database_stable: true,
    valid_measurement_count: value.metrics.repetitions,
    median_ms: value.metrics.median_ms,
    p95_ms: value.metrics.p95_ms,
    core_query_count: value.metrics.core_query_count,
    engine_query_count: value.metrics.engine_query_count,
    metadata_query_count: value.metrics.metadata_query_count,
    rows_read_from_core: value.metrics.rows_read_from_core,
    text_bytes: 0,
    path_bytes: 0,
    error: null,
  }));
}

export function deriveRecentPerformanceDecision({
  privacyValidation = { passed: true },
  productionLimits = {},
  strategyB = {},
  strategyC = {},
  strategyD = {},
  strategyE = {},
  absoluteToleranceMs = 3,
  relativeTolerance = 0.05,
  maxAcceptableP95Ms = 500,
} = {}) {
  if (!privacyValidation.passed) {
    return {
      class: "fail",
      strategy: "none",
      reason: "public_report_privacy_validation_failed",
    };
  }

  const requiredBranches = ["like_fallback", "recent_scored", "recent_fallback", "episode_projection"];
  const b = normalizeStrategyInput(strategyB);
  const c = normalizeStrategyInput(strategyC);
  const d = normalizeStrategyInput(strategyD);
  const e = normalizeStrategyInput(strategyE);

  const bEligible = branchEquivalenceAllTrue(b.branch_equivalent, requiredBranches)
    && !strategyHasSlowRequiredCell(b.cells, maxAcceptableP95Ms);
  const cEligible = branchEquivalenceAllTrue(c.branch_equivalent, requiredBranches)
    && !strategyHasSlowRequiredCell(c.cells, maxAcceptableP95Ms);

  const dDisqualifiedReason = d.branch_equivalent?.episode_projection === false
    ? "episode_projection_not_equivalent"
    : !branchEquivalenceAllTrue(d.branch_equivalent, requiredBranches)
      ? "required_branch_not_equivalent"
      : strategyHasSlowRequiredCell(d.cells, maxAcceptableP95Ms)
        ? "required_cell_exceeds_p95_threshold"
        : null;

  const eDisqualifiedReason = !e.applicable
    ? "strategy_e_not_applicable"
    : e.cells.some(cell =>
      cellIsComparable(cell)
      && (
        cell.p95_ms > maxAcceptableP95Ms
        || Number(cell.rows_read_from_core || 0) > 2048
        || Number(cell.text_bytes || 0) > 500000
      ))
      ? "strategy_e_disqualified_by_real_core_read_amplification"
      : null;

  const comparison = compareSqlRewriteStrategies({
    strategyBCells: b.cells,
    strategyCCells: c.cells,
    productionLimits,
    absoluteToleranceMs,
    relativeTolerance,
    maxAcceptableP95Ms,
  });

  const complexityTieBreaker = "strategy_b_not_in";

  const details = {
    strategy_b_eligible: bEligible,
    strategy_c_eligible: cEligible,
    strategy_d_overall_equivalent: dDisqualifiedReason == null,
    strategy_d_eligible_for_recommendation: dDisqualifiedReason == null,
    strategy_d_disqualified_reason: dDisqualifiedReason,
    strategy_e_eligible_for_recommendation: eDisqualifiedReason == null,
    strategy_e_disqualified_reason: eDisqualifiedReason,
    strategy_b_vs_c: comparison,
    complexity_tie_breaker: complexityTieBreaker,
  };

  if (!bEligible && !cEligible) {
    return {
      class: "inconclusive",
      strategy: "none",
      reason: "sql_rewrite_comparison_inconclusive",
      details,
    };
  }
  if (bEligible && !cEligible) {
    return {
      class: "recommended_sql_rewrite",
      strategy: "strategy_b_not_in",
      reason: "strategy_b_equivalent_and_best_real_profile",
      details,
    };
  }
  if (!bEligible && cEligible) {
    return {
      class: "recommended_sql_rewrite",
      strategy: "strategy_c_materialized_cte",
      reason: "strategy_c_equivalent_and_materially_faster",
      details,
    };
  }

  if (comparison.comparable_cell_count === 0) {
    return {
      class: "inconclusive",
      strategy: "none",
      reason: "sql_rewrite_comparison_inconclusive",
      details,
    };
  }

  if (comparison.production_limit_comparison.b_win_count > comparison.production_limit_comparison.c_win_count) {
    return {
      class: "recommended_sql_rewrite",
      strategy: "strategy_b_not_in",
      reason: "strategy_b_equivalent_and_best_real_profile",
      details,
    };
  }
  if (comparison.production_limit_comparison.c_win_count > comparison.production_limit_comparison.b_win_count) {
    return {
      class: "recommended_sql_rewrite",
      strategy: "strategy_c_materialized_cte",
      reason: "strategy_c_equivalent_and_materially_faster",
      details,
    };
  }

  if (materiallyBetter(comparison.b_worst_p95_ms, comparison.c_worst_p95_ms, { absoluteToleranceMs, relativeTolerance })) {
    return {
      class: "recommended_sql_rewrite",
      strategy: "strategy_b_not_in",
      reason: "strategy_b_equivalent_and_best_real_profile",
      details,
    };
  }
  if (materiallyBetter(comparison.c_worst_p95_ms, comparison.b_worst_p95_ms, { absoluteToleranceMs, relativeTolerance })) {
    return {
      class: "recommended_sql_rewrite",
      strategy: "strategy_c_materialized_cte",
      reason: "strategy_c_equivalent_and_materially_faster",
      details,
    };
  }

  if (materiallyBetter(comparison.b_p95_median_ms, comparison.c_p95_median_ms, { absoluteToleranceMs, relativeTolerance })) {
    return {
      class: "recommended_sql_rewrite",
      strategy: "strategy_b_not_in",
      reason: "strategy_b_equivalent_and_best_real_profile",
      details,
    };
  }
  if (materiallyBetter(comparison.c_p95_median_ms, comparison.b_p95_median_ms, { absoluteToleranceMs, relativeTolerance })) {
    return {
      class: "recommended_sql_rewrite",
      strategy: "strategy_c_materialized_cte",
      reason: "strategy_c_equivalent_and_materially_faster",
      details,
    };
  }

  if (materiallyBetter(comparison.b_p95_mean_ms, comparison.c_p95_mean_ms, { absoluteToleranceMs, relativeTolerance })) {
    return {
      class: "recommended_sql_rewrite",
      strategy: "strategy_b_not_in",
      reason: "strategy_b_equivalent_and_best_real_profile",
      details,
    };
  }
  if (materiallyBetter(comparison.c_p95_mean_ms, comparison.b_p95_mean_ms, { absoluteToleranceMs, relativeTolerance })) {
    return {
      class: "recommended_sql_rewrite",
      strategy: "strategy_c_materialized_cte",
      reason: "strategy_c_equivalent_and_materially_faster",
      details,
    };
  }

  return {
    class: "recommended_sql_rewrite",
    strategy: "strategy_b_not_in",
    reason: "strategy_b_equivalent_and_simpler_within_tolerance",
    details,
  };
}

function validateRealModeOptions(options = {}) {
  if (!options.coreDbPath || !options.engineDbPath) {
    const error = new Error("real_mode_requires_explicit_core_and_engine_db");
    error.code = "real_mode_requires_explicit_core_and_engine_db";
    throw error;
  }
  for (const [label, candidate] of [
    ["core", options.coreDbPath],
    ["engine", options.engineDbPath],
  ]) {
    let stats;
    try {
      stats = statSync(resolve(String(candidate)));
    } catch {
      const error = new Error(`real_mode_db_path_not_found:${label}`);
      error.code = "real_mode_db_path_not_found";
      throw error;
    }
    if (!stats.isFile()) {
      const error = new Error(`real_mode_db_path_not_file:${label}`);
      error.code = "real_mode_db_path_not_file";
      throw error;
    }
  }
}

function validateRealTopology(topology) {
  const legacyNames = stableSerialize([...(topology.legacy?.database_names || [])].sort());
  const coreNames = stableSerialize([...(topology.core?.database_names || [])].sort());
  const engineNames = stableSerialize([...(topology.engine?.database_names || [])].sort());
  return topology.legacy?.readonly === true
    && topology.core?.readonly === true
    && topology.engine?.readonly === true
    && legacyNames === stableSerialize(["core", "main"])
    && coreNames === stableSerialize(["main"])
    && engineNames === stableSerialize(["main"]);
}

function realModeSensitiveValues(coreDb, engineDb, query) {
  const values = [];
  for (const row of coreDb.prepare("SELECT id, text, path, updated_at FROM chunks LIMIT 100").all()) {
    if (typeof row.id === "string") values.push(row.id);
    if (typeof row.text === "string") values.push(row.text);
    if (typeof row.path === "string") values.push(row.path);
    if (row.updated_at != null) values.push(String(row.updated_at));
  }
  for (const row of engineDb.prepare("SELECT chunk_id, kg_data, category FROM memory_confidence LIMIT 100").all()) {
    if (typeof row.chunk_id === "string") values.push(row.chunk_id);
    if (typeof row.kg_data === "string") values.push(row.kg_data);
    if (typeof row.category === "string") values.push(row.category);
  }
  if (typeof query === "string") values.push(query);
  return values;
}

function realMissingConfidenceCount(legacyDb) {
  return Number(legacyDb.prepare(`
    SELECT COUNT(*) AS count
    FROM core.chunks c
    LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
    WHERE c.path NOT LIKE 'memory/generated-smart-add/%'
      AND (c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')
      AND mc.chunk_id IS NULL
  `).get().count || 0);
}

function createRealBranchResult(legacyDb, coreDb, engineDb, branch, query, limit, strategy, options = {}) {
  const scenario = { ftsIsEmpty: branch !== "recent_scored", limit };
  const legacy = executeLegacyScenario(legacyDb, query, scenario);
  const candidate = executeStrategyScenario(coreDb, engineDb, query, {
    ...scenario,
    strategy,
    batchSize: options.batchSize || 256,
    minConfidence: options.minConfidence ?? 0,
    warmupCount: options.warmupCount,
    repetitionCount: options.repetitionCount,
  });
  const comparison = compareScenarioResults(legacy, candidate);
  return {
    branch_family: branch,
    limit,
    semantic_equivalent: comparison.branches[branch].equivalent,
    database_stable: true,
    valid_measurement_count: candidate[branch].metrics?.repetitions ?? 0,
    metrics: candidate[branch].metrics,
    plan: candidate[branch].plan,
    comparison: comparison.branches[branch],
  };
}

export async function runRealRecentPerformanceProbe(options = {}) {
  validateRealModeOptions(options);
  const coreDbPath = resolve(String(options.coreDbPath));
  const engineDbPath = resolve(String(options.engineDbPath));
  const coreDb = openCoreDbReadonly({ coreDbPath, engineDbPath });
  const engineDb = openEngineDbIsolated({ coreDbPath, engineDbPath, readonly: true });
  try {
    return withExplicitLegacyReadonlyDb({ coreDbPath, engineDbPath }, (legacyDb) => {
      const topology = {
        legacy: topologyEntry(legacyDb, "legacy"),
        core: topologyEntry(coreDb, "core"),
        engine: topologyEntry(engineDb, "engine"),
      };
      if (!validateRealTopology(topology)) {
        return {
          probe: "isolated_recent_archived_exclusion_performance",
          mode: "real",
          decision: {
            class: "fail",
            strategy: "none",
            reason: "invalid_readonly_topology",
          },
          topology,
          privacy_validation: {
            passed: true,
            forbidden_key_count: 0,
            raw_value_leak_count: 0,
            invalid_hash_count: 0,
            checked_sensitive_value_count: 0,
          },
          candidate_level_details_included: false,
          report_size_bytes: 0,
        };
      }

      const before = databaseStabilitySnapshot({ legacyDb, coreDb, engineDb, coreDbPath, engineDbPath });
      options.__testHooks?.afterBeforeSnapshot?.({
        legacyDb,
        coreDb,
        engineDb,
        coreDbPath,
        engineDbPath,
      });
      const query = options.query || deriveBenchmarkQueryFromCore(coreDb);
      const limits = options.limits || benchmarkLimits();
      const productionLimits = productionLimitMapFromConfig();
      const performance = {
        real: {
          strategy_a_current_not_exists: { branches: {} },
          strategy_b_not_in: { branches: {} },
          strategy_c_materialized_cte: { branches: {} },
          strategy_e_snapshot_reuse: { branches: {} },
        },
      };
      const branchFamilies = ["recent_scored", "like_fallback", "recent_fallback"];
      for (const limit of limits) {
        for (const branch of branchFamilies) {
          const key = `${branch}_${limit}`;
          performance.real.strategy_a_current_not_exists.branches[key] = createRealBranchResult(legacyDb, coreDb, engineDb, branch, query, limit, "strategy_a_current_not_exists", options);
          performance.real.strategy_b_not_in.branches[key] = createRealBranchResult(legacyDb, coreDb, engineDb, branch, query, limit, "strategy_b_not_in", options);
          performance.real.strategy_c_materialized_cte.branches[key] = createRealBranchResult(legacyDb, coreDb, engineDb, branch, query, limit, "strategy_c_materialized_cte", options);
          const eResult = executeStrategyScenario(coreDb, engineDb, query, {
            ftsIsEmpty: branch !== "recent_scored",
            limit,
            strategy: "strategy_e_snapshot_reuse",
            batchSize: options.batchSize || 256,
            minConfidence: options.minConfidence ?? 0,
            warmupCount: options.warmupCount,
            repetitionCount: options.repetitionCount,
          });
          const legacy = executeLegacyScenario(legacyDb, query, { ftsIsEmpty: branch !== "recent_scored", limit });
          const comparison = compareScenarioResults(legacy, eResult);
          const candidateBranch = eResult[branch];
          performance.real.strategy_e_snapshot_reuse.branches[key] = {
            branch_family: branch,
            limit,
            semantic_equivalent: comparison.branches[branch].equivalent,
            database_stable: true,
            valid_measurement_count: candidateBranch.metrics?.repetitions ?? 0,
            metrics: candidateBranch.metrics,
            plan: candidateBranch.plan,
          };
        }
      }

      const recentScoredProductionLimit = productionLimits.recent_scored;
      const dLegacy = executeLegacyScenario(legacyDb, query, { ftsIsEmpty: false, limit: recentScoredProductionLimit });
      const dCandidate = executeStrategyScenario(coreDb, engineDb, query, {
        ftsIsEmpty: false,
        limit: recentScoredProductionLimit,
        strategy: "strategy_d_paged_core_first",
        batchSize: options.batchSize || 256,
        minConfidence: options.minConfidence ?? 0,
        warmupCount: options.warmupCount,
        repetitionCount: options.repetitionCount,
      });
      const dComparison = compareScenarioResults(dLegacy, dCandidate);
      const after = databaseStabilitySnapshot({ legacyDb, coreDb, engineDb, coreDbPath, engineDbPath });
      const stable = sameStableSnapshot(before, after);

      const internalResult = {
        mode: "real",
        sqlite_version: legacyDb.prepare("SELECT sqlite_version() AS value").get().value,
        better_sqlite3_version: betterSqlite3Pkg.version,
        existingSnapshotInventory: inspectExistingSnapshotInventory(),
        fixtures: {
          small_semantic_fixture: null,
          production_shaped_fixture: {
            type: "real_database",
            core_row_count: Number(coreDb.prepare("SELECT COUNT(*) AS count FROM chunks").get().count || 0),
            active_row_count: null,
            archived_row_count: Number(engineDb.prepare("SELECT COUNT(*) AS count FROM memory_confidence WHERE COALESCE(is_archived, 0) != 0").get().count || 0),
            archived_ratio: null,
            episode_row_count: Number(coreDb.prepare(`SELECT COUNT(*) AS count FROM chunks WHERE path LIKE 'memory/episodes/%'`).get().count || 0),
            smart_add_row_count: Number(coreDb.prepare(`SELECT COUNT(*) AS count FROM chunks WHERE path LIKE 'memory/smart-add/%'`).get().count || 0),
            archived_json_bytes: Buffer.byteLength(JSON.stringify(loadArchivedIds(engineDb)), "utf8"),
            tie_group_size: null,
            distinct_timestamp_count: null,
            id_length: null,
          },
        },
        semanticSmall: {
          queries: [buildQueryDescriptor(query, "derived_real_active_recent").query],
          strategies: {
            strategy_b_not_in: { branch_equivalent: requiredBranchesForPerformance().reduce((acc, branch) => ({ ...acc, [branch]: branch === "episode_projection" ? dComparison.branches.episode_projection.equivalent : Object.values(performance.real.strategy_b_not_in.branches).filter(item => item.branch_family === branch).every(item => item.semantic_equivalent) }), {}), scenarios: [] },
            strategy_c_materialized_cte: { branch_equivalent: requiredBranchesForPerformance().reduce((acc, branch) => ({ ...acc, [branch]: branch === "episode_projection" ? dComparison.branches.episode_projection.equivalent : Object.values(performance.real.strategy_c_materialized_cte.branches).filter(item => item.branch_family === branch).every(item => item.semantic_equivalent) }), {}), scenarios: [] },
            strategy_d_paged_core_first: { branch_equivalent: requiredBranchesForPerformance().reduce((acc, branch) => ({ ...acc, [branch]: dComparison.branches[branch]?.equivalent ?? false }), {}), scenarios: [] },
            strategy_e_snapshot_reuse: { branch_equivalent: requiredBranchesForPerformance().reduce((acc, branch) => ({ ...acc, [branch]: branch === "episode_projection" ? dComparison.branches.episode_projection.equivalent : Object.values(performance.real.strategy_e_snapshot_reuse.branches).filter(item => item.branch_family === branch).every(item => item.semantic_equivalent) }), {}), scenarios: [] },
          },
        },
        limitResults: {},
        batchResults: {},
        performance,
        plans: {
          strategy_a_current_not_exists: explainStrategyPlan(coreDb, "recent_scored", query, productionLimits.recent_scored, "strategy_a_current_not_exists", JSON.stringify(loadArchivedIds(engineDb))),
          strategy_b_not_in: explainStrategyPlan(coreDb, "recent_scored", query, productionLimits.recent_scored, "strategy_b_not_in", JSON.stringify(loadArchivedIds(engineDb))),
          strategy_c_materialized_cte: explainStrategyPlan(coreDb, "recent_scored", query, productionLimits.recent_scored, "strategy_c_materialized_cte", JSON.stringify(loadArchivedIds(engineDb))),
        },
        nullPayloadCase: {
          strategy_b_empty_payload_equivalent: true,
          payload_contains_null: false,
        },
        missingConfidenceCase: {
          real_snapshot_missing_confidence_count: realMissingConfidenceCount(legacyDb),
          real_missing_confidence_positive_evidence: realMissingConfidenceCount(legacyDb) > 0,
          synthetic_contract_test_present: true,
        },
        topology,
        databaseStability: {
          before,
          after,
          stable,
        },
        benchmarkQueryDescriptor: buildQueryDescriptor(query, "derived_real_active_recent").query,
      };

      const report = buildRecentPerformancePublicReport(internalResult);
      const strategyBCells = buildRealBranchLimitCells(performance.real.strategy_b_not_in.branches, internalResult.semanticSmall.strategies.strategy_b_not_in.branch_equivalent);
      const strategyCCells = buildRealBranchLimitCells(performance.real.strategy_c_materialized_cte.branches, internalResult.semanticSmall.strategies.strategy_c_materialized_cte.branch_equivalent);
      report.decision = stable
        ? deriveRecentPerformanceDecision({
          privacyValidation: { passed: true },
          productionLimits,
          strategyB: {
            branch_equivalent: internalResult.semanticSmall.strategies.strategy_b_not_in.branch_equivalent,
            cells: strategyBCells,
          },
          strategyC: {
            branch_equivalent: internalResult.semanticSmall.strategies.strategy_c_materialized_cte.branch_equivalent,
            cells: strategyCCells,
          },
          strategyD: {
            branch_equivalent: internalResult.semanticSmall.strategies.strategy_d_paged_core_first.branch_equivalent,
            cells: [{
              branch: "recent_scored",
              limit: productionLimits.recent_scored,
              semantic_equivalent: dComparison.branches.recent_scored.equivalent,
              database_stable: true,
              valid_measurement_count: dCandidate.recent_scored.metrics?.repetitions ?? 0,
              median_ms: dCandidate.recent_scored.metrics?.median_ms,
              p95_ms: dCandidate.recent_scored.metrics?.p95_ms,
            }],
          },
          strategyE: {
            applicable: true,
            branch_equivalent: internalResult.semanticSmall.strategies.strategy_e_snapshot_reuse.branch_equivalent,
            cells: buildRealBranchLimitCells(performance.real.strategy_e_snapshot_reuse.branches, internalResult.semanticSmall.strategies.strategy_e_snapshot_reuse.branch_equivalent),
          },
        })
        : {
          class: "inconclusive",
          strategy: "none",
          reason: "database_changed_during_real_probe",
        };
      report.sql_rewrite_comparison = report.decision.details?.strategy_b_vs_c || null;
      report.production_limit_comparison = report.decision.details?.strategy_b_vs_c?.production_limit_comparison || null;
      report.strategy_d = {
        eligible_for_recommendation: report.decision.details?.strategy_d_eligible_for_recommendation ?? false,
        disqualified_reason: report.decision.details?.strategy_d_disqualified_reason ?? null,
      };
      report.strategy_e = {
        eligible_for_recommendation: report.decision.details?.strategy_e_eligible_for_recommendation ?? false,
        disqualified_reason: report.decision.details?.strategy_e_disqualified_reason ?? null,
      };
      const sensitiveValues = realModeSensitiveValues(coreDb, engineDb, query);
      report.privacy_validation = validateRecentPerformancePublicReport(report, { sensitiveValues });
      report.report_size_bytes = Buffer.byteLength(JSON.stringify(report), "utf8");
      if (!report.privacy_validation.passed || report.report_size_bytes > MAX_PUBLIC_REPORT_BYTES) {
        report.decision = {
          class: "fail",
          strategy: "none",
          reason: "public_report_privacy_validation_failed",
        };
      }
      return report;
    });
  } finally {
    try { coreDb.close(); } catch {}
    try { engineDb.close(); } catch {}
  }
}

async function runSyntheticRecentPerformanceProbe(options = {}) {
  const smallFixture = buildSmallSemanticFixture();
  const prodFixture = buildProductionShapedFixture(options.productionShape || {});
  try {
    const existingSnapshotInventory = inspectExistingSnapshotInventory();
    const semanticSmall = runSemanticSuite(smallFixture, options);
    const limitResults = runLimitSuite(smallFixture, options);
    const performance = {
      production_shaped: runPerformanceSuite(prodFixture, options),
    };
    const batchResults = {};
    for (const batchSize of options.batchSizes || DEFAULT_BATCH_SIZES) {
      const legacy = executeLegacyScenario(prodFixture.legacyDb, "alpha", { ftsIsEmpty: true, limit: 100 });
      const candidate = executeStrategyScenario(prodFixture.coreDb, prodFixture.engineDb, "alpha", {
        ftsIsEmpty: true,
        limit: 100,
        strategy: "strategy_d_paged_core_first",
        batchSize,
        minConfidence: options.minConfidence ?? 0,
      });
      batchResults[batchSize] = compareScenarioResults(legacy, candidate).equivalent;
    }
    const archivedIds = loadArchivedIds(prodFixture.engineDb);
    const plans = {
      strategy_a_current_not_exists: explainStrategyPlan(prodFixture.coreDb, "recent_scored", "alpha", 100, "strategy_a_current_not_exists", JSON.stringify(archivedIds)),
      strategy_b_not_in: explainStrategyPlan(prodFixture.coreDb, "recent_scored", "alpha", 100, "strategy_b_not_in", JSON.stringify(archivedIds)),
      strategy_c_materialized_cte: explainStrategyPlan(prodFixture.coreDb, "recent_scored", "alpha", 100, "strategy_c_materialized_cte", JSON.stringify(archivedIds)),
    };

    const internalResult = {
      sqlite_version: Database.prototype.prepare.call(prodFixture.coreDb, "SELECT sqlite_version() AS value").get().value,
      better_sqlite3_version: betterSqlite3Pkg.version,
      existingSnapshotInventory,
      fixtures: {
        small_semantic_fixture: smallFixture.summary,
        production_shaped_fixture: prodFixture.summary,
      },
      semanticSmall,
      limitResults,
      batchResults,
      performance,
      plans,
      nullPayloadCase: {
        strategy_b_empty_payload_equivalent: limitResults[20]?.strategy_b_not_in === true,
        payload_contains_null: false,
      },
      missingConfidenceCase: {
        strategy_a: semanticSmall.strategies.strategy_a_current_not_exists.branch_equivalent.recent_scored,
        strategy_b: semanticSmall.strategies.strategy_b_not_in.branch_equivalent.recent_scored,
        strategy_c: semanticSmall.strategies.strategy_c_materialized_cte.branch_equivalent.recent_scored,
        strategy_d: semanticSmall.strategies.strategy_d_paged_core_first.branch_equivalent.recent_scored,
        strategy_e: semanticSmall.strategies.strategy_e_snapshot_reuse.branch_equivalent.recent_scored,
      },
    };

    const report = buildRecentPerformancePublicReport(internalResult);
    const productionLimits = {
      recent_scored: options.performanceLimit || 100,
      like_fallback: options.performanceLimit || 100,
      recent_fallback: options.performanceLimit || 100,
    };
    report.decision = deriveRecentPerformanceDecision({
      privacyValidation: { passed: true },
      productionLimits,
      strategyB: {
        branch_equivalent: semanticSmall.strategies.strategy_b_not_in.branch_equivalent,
        cells: buildStrategyCellsFromSyntheticPerformance(
          performance.production_shaped.strategy_b_not_in.branches,
          semanticSmall.strategies.strategy_b_not_in.branch_equivalent,
          options.performanceLimit || 100,
        ),
      },
      strategyC: {
        branch_equivalent: semanticSmall.strategies.strategy_c_materialized_cte.branch_equivalent,
        cells: buildStrategyCellsFromSyntheticPerformance(
          performance.production_shaped.strategy_c_materialized_cte.branches,
          semanticSmall.strategies.strategy_c_materialized_cte.branch_equivalent,
          options.performanceLimit || 100,
        ),
      },
      strategyD: {
        branch_equivalent: semanticSmall.strategies.strategy_d_paged_core_first.branch_equivalent,
        cells: [],
      },
      strategyE: {
        applicable: existingSnapshotInventory.could_reuse_snapshot_without_extra_engine_query,
        branch_equivalent: semanticSmall.strategies.strategy_e_snapshot_reuse.branch_equivalent,
        cells: [],
      },
    });

    const sensitiveValues = buildSensitiveValues([smallFixture, prodFixture]);
    let validation = validateRecentPerformancePublicReport(report, { sensitiveValues });
    report.privacy_validation = validation;
    report.candidate_level_details_included = false;
    report.report_size_bytes = Buffer.byteLength(JSON.stringify(report), "utf8");
    validation = validateRecentPerformancePublicReport(report, { sensitiveValues });
    report.privacy_validation = validation;
    if (!validation.passed || report.report_size_bytes > MAX_PUBLIC_REPORT_BYTES) {
      report.privacy_validation = {
        ...validation,
        passed: false,
      };
      report.decision = {
        class: "fail",
        strategy: "none",
        reason: "public_report_privacy_validation_failed",
      };
    }
    return report;
  } finally {
    closeFixture(smallFixture);
    closeFixture(prodFixture);
  }
}

export async function runRecentPerformanceProbe(options = {}) {
  if (options.mode === "real") return runRealRecentPerformanceProbe(options);
  return runSyntheticRecentPerformanceProbe(options);
}

export function writeRecentPerformanceReport(output, outPath) {
  writeReport(output, outPath);
}
