import { existsSync, closeSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";

import { H2_QUERY_PLANNER_QUERY_MAX_CHARS } from "./longmemeval-bounded-multi-query-planner-v1.js";

export const H2_QUERY_PLAN_CACHE_SCHEMA = "memory_engine_benchmark_query_plan_cache_v2";
export const H2_QUERY_PLAN_CACHE_SQLITE_USER_VERSION = 2;
export const H2_QUERY_PLAN_CACHE_SQLITE_TABLE = "query_plan_cache_entries";

const CACHE_KEY_FIELDS = [
  "provider",
  "base_url_identity",
  "model",
  "model_revision",
  "prompt_version",
  "prompt_sha256",
  "temperature",
  "output_schema_sha256",
  "question_input_sha256",
];
const GOLD_FIELDS = new Set([
  "answer",
  "expected_answer",
  "answer_session_ids",
  "evidence_session_ids",
  "has_answer",
  "evidence_label",
  "evidence_labels",
  "gold",
  "gold_answer",
  "evaluator_target",
  "expected_target",
  "sessions",
  "corpus",
  "question_type",
  "retrieval_results",
]);
const RESERVED_PROVENANCE_FIELDS = new Set([
  "profile",
  "repository_commit",
  "repository_worktree_clean",
  "repository_provenance_source",
  "dataset_sha256",
  "embedding_provider",
  "embedding_base_url_identity",
  "embedding_model",
  "embedding_model_revision",
  "embedding_dimension",
  "canonical_vector_projection_version",
  "canonical_vector_text_max_chars",
  "lexical_confidence_threshold",
  "vector_top_k",
  "provider_call_count",
  "embedding_cache_hits",
  "corpus_embedding_count",
  "query_embedding_count",
  "corpus_build_latency",
  "retrieval_latency",
  "vector_attempted_count",
  "vector_skipped_count",
  "vector_error_count",
]);

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function assertNoForbiddenFields(value, label, { rejectReserved = false } = {}) {
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenFields(item, label, { rejectReserved });
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (GOLD_FIELDS.has(key)) throw new Error(`${label}_contains_forbidden_field:${key}`);
    if (rejectReserved && RESERVED_PROVENANCE_FIELDS.has(key)) {
      throw new Error(`${label}_contains_reserved_field:${key}`);
    }
    if (["question", "raw_question", "input", "raw_input", "embedding_input"].includes(key)) {
      throw new Error(`${label}_contains_raw_input:${key}`);
    }
    assertNoForbiddenFields(child, label, { rejectReserved });
  }
}

function assertCachePath(cachePath) {
  if (/[\\/]\.openclaw[\\/]memory(?:[\\/]|$)/u.test(cachePath)) {
    const error = new Error("query plan cache cannot use a live OpenClaw memory path");
    error.code = "query_plan_cache_live_memory_path";
    throw error;
  }
}

function assertSqliteHeader(cachePath) {
  if (!existsSync(cachePath)) return;
  const fileStat = statSync(cachePath);
  if (fileStat.isDirectory()) throw new Error("query plan cache path is a directory");
  if (fileStat.size === 0) throw new Error("legacy or invalid empty query plan cache format");
  let descriptor;
  try {
    descriptor = openSync(cachePath, "r");
    const header = Buffer.alloc(16);
    readSync(descriptor, header, 0, header.length, 0);
    if (header.toString("latin1") !== "SQLite format 3\u0000") {
      throw new Error("legacy or invalid non-SQLite query plan cache format");
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function normalizeCacheKey(key) {
  try {
    assertNoForbiddenFields(key, "query_plan_cache_key", { rejectReserved: true });
  } catch (error) {
    const wrapped = new Error(error.message);
    wrapped.code = "query_plan_cache_key_invalid";
    throw wrapped;
  }
  if (!key || typeof key !== "object" || Array.isArray(key)) {
    throw new Error("query plan cache key must be an object");
  }
  if (Object.hasOwn(key, "question") || Object.hasOwn(key, "raw_question")) {
    throw new Error("raw question is not allowed in query plan cache key");
  }
  const normalized = {
    provider: String(key.provider || ""),
    base_url_identity: String(key.base_url_identity || ""),
    model: String(key.model || ""),
    model_revision: String(key.model_revision || ""),
    prompt_version: String(key.prompt_version || ""),
    prompt_sha256: String(key.prompt_sha256 || ""),
    temperature: Number(key.temperature),
    output_schema_sha256: String(key.output_schema_sha256 || ""),
    question_input_sha256: String(key.question_input_sha256 || ""),
  };
  if ([
    normalized.provider,
    normalized.base_url_identity,
    normalized.model,
    normalized.model_revision,
    normalized.prompt_version,
    normalized.prompt_sha256,
    normalized.output_schema_sha256,
    normalized.question_input_sha256,
  ].some(value => value.length === 0) || !Number.isFinite(normalized.temperature)) {
    throw new Error("query plan cache key identity is incomplete");
  }
  if (!/^[0-9a-f]{64}$/u.test(normalized.prompt_sha256) ||
      !/^[0-9a-f]{64}$/u.test(normalized.output_schema_sha256)) {
    throw new Error("query plan cache planner identity hash is invalid");
  }
  if (!/^[0-9a-f]{64}$/u.test(normalized.question_input_sha256)) {
    throw new Error("query plan cache question hash is invalid");
  }
  return normalized;
}

function serializeKey(key) {
  return JSON.stringify(Object.fromEntries(CACHE_KEY_FIELDS.map(field => [field, key[field]])));
}

function normalizePlan(plan) {
  try {
    assertNoForbiddenFields(plan, "query_plan_cache_plan", { rejectReserved: true });
  } catch (error) {
    throw new Error(error.message);
  }
  if (!plan || typeof plan !== "object" || Array.isArray(plan) || !Array.isArray(plan.queries) || plan.queries.length !== 2) {
    throw new Error("query plan cache value must contain exactly two queries");
  }
  if (plan.queries.some(query => typeof query !== "string" || query.trim().length === 0)) {
    throw new Error("query plan cache queries must be non-empty strings");
  }
  if (plan.queries.some(query => query.length > H2_QUERY_PLANNER_QUERY_MAX_CHARS)) {
    throw new Error("query plan cache query exceeds the frozen length limit");
  }
  if (new Set(plan.queries.map(query => query.trim())).size !== plan.queries.length) {
    throw new Error("query plan cache queries must be distinct after trim");
  }
  const expectedHash = sha256(JSON.stringify({ queries: plan.queries }));
  if (plan.plan_hash !== undefined && plan.plan_hash !== expectedHash) {
    throw new Error("query plan cache plan hash mismatch");
  }
  const provenance = plan.provenance && typeof plan.provenance === "object" && !Array.isArray(plan.provenance)
    ? { ...plan.provenance }
    : {};
  assertNoForbiddenFields(provenance, "query_plan_cache_provenance", { rejectReserved: true });
  return {
    queries: [...plan.queries],
    plan_hash: expectedHash,
    provenance,
  };
}

function initializeDatabase(cachePath) {
  if (cachePath) {
    mkdirSync(dirname(cachePath), { recursive: true });
    assertSqliteHeader(cachePath);
  }
  const database = new Database(cachePath || ":memory:");
  try {
    database.pragma("synchronous = FULL");
    const integrity = String(database.pragma("integrity_check", { simple: true }));
    if (integrity !== "ok") throw new Error(`query plan cache integrity check failed: ${integrity}`);
    const userVersion = Number(database.pragma("user_version", { simple: true }));
    const tables = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all().map(row => row.name);
    if (userVersion === 0 && tables.length === 0) {
      database.exec(`
        CREATE TABLE query_plan_cache_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        INSERT INTO query_plan_cache_metadata (key, value)
        VALUES ('schema', '${H2_QUERY_PLAN_CACHE_SCHEMA}');
        CREATE TABLE ${H2_QUERY_PLAN_CACHE_SQLITE_TABLE} (
          cache_key TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          base_url_identity TEXT NOT NULL,
          model TEXT NOT NULL,
          model_revision TEXT NOT NULL,
          prompt_version TEXT NOT NULL,
          prompt_sha256 TEXT NOT NULL,
          temperature REAL NOT NULL,
          output_schema_sha256 TEXT NOT NULL,
          question_input_sha256 TEXT NOT NULL,
          plan_hash TEXT NOT NULL,
          queries_json TEXT NOT NULL,
          provenance_json TEXT NOT NULL
        );
        PRAGMA user_version = ${H2_QUERY_PLAN_CACHE_SQLITE_USER_VERSION};
      `);
    } else {
      if (userVersion !== H2_QUERY_PLAN_CACHE_SQLITE_USER_VERSION ||
          tables.length !== 2 ||
          !tables.includes("query_plan_cache_metadata") ||
          !tables.includes(H2_QUERY_PLAN_CACHE_SQLITE_TABLE)) {
        throw new Error("unsupported or invalid query plan cache schema");
      }
      const schema = database.prepare(
        "SELECT value FROM query_plan_cache_metadata WHERE key = 'schema'",
      ).get();
      if (schema?.value !== H2_QUERY_PLAN_CACHE_SCHEMA) throw new Error("query plan cache schema identity mismatch");
    }
    const columns = database.prepare(`PRAGMA table_info(${H2_QUERY_PLAN_CACHE_SQLITE_TABLE})`).all();
    const required = [
      ["cache_key", "TEXT"],
      ["provider", "TEXT"],
      ["base_url_identity", "TEXT"],
      ["model", "TEXT"],
      ["model_revision", "TEXT"],
      ["prompt_version", "TEXT"],
      ["prompt_sha256", "TEXT"],
      ["temperature", "REAL"],
      ["output_schema_sha256", "TEXT"],
      ["question_input_sha256", "TEXT"],
      ["plan_hash", "TEXT"],
      ["queries_json", "TEXT"],
      ["provenance_json", "TEXT"],
    ];
    if (columns.length !== required.length ||
        !columns.every((column, index) => column.name === required[index][0] &&
          String(column.type).toUpperCase() === required[index][1] &&
          (index === 0 ? column.pk === 1 : column.notnull === 1))) {
      throw new Error("query plan cache table columns are invalid");
    }
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function buildQueryPlanCacheKey({
  provider = "",
  baseUrlIdentity = "",
  model = "",
  modelRevision = "",
  promptVersion = "",
  promptSha256 = "",
  temperature = undefined,
  outputSchemaSha256 = "",
  question = undefined,
  questionInputSha256 = undefined,
} = {}) {
  const questionHash = questionInputSha256 || (question === undefined ? "" : sha256(question));
  return normalizeCacheKey({
    provider,
    base_url_identity: baseUrlIdentity,
    model,
    model_revision: modelRevision,
    prompt_version: promptVersion,
    prompt_sha256: promptSha256,
    temperature,
    output_schema_sha256: outputSchemaSha256,
    question_input_sha256: questionHash,
  });
}

export function createBenchmarkQueryPlanCache(cachePath = null) {
  const resolvedPath = cachePath == null ? null : resolve(String(cachePath));
  if (resolvedPath) assertCachePath(resolvedPath);
  const database = initializeDatabase(resolvedPath);
  let closed = false;
  const selectEntry = database.prepare(`
    SELECT cache_key, provider, base_url_identity, model, model_revision,
      prompt_version, prompt_sha256, temperature, output_schema_sha256,
      question_input_sha256, plan_hash, queries_json, provenance_json
    FROM ${H2_QUERY_PLAN_CACHE_SQLITE_TABLE}
    WHERE cache_key = ?
  `);
  const upsertEntry = database.prepare(`
    INSERT INTO ${H2_QUERY_PLAN_CACHE_SQLITE_TABLE} (
      cache_key, provider, base_url_identity, model, model_revision,
      prompt_version, prompt_sha256, temperature, output_schema_sha256,
      question_input_sha256, plan_hash, queries_json, provenance_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      provider = excluded.provider,
      base_url_identity = excluded.base_url_identity,
      model = excluded.model,
      model_revision = excluded.model_revision,
      prompt_version = excluded.prompt_version,
      prompt_sha256 = excluded.prompt_sha256,
      temperature = excluded.temperature,
      output_schema_sha256 = excluded.output_schema_sha256,
      question_input_sha256 = excluded.question_input_sha256,
      plan_hash = excluded.plan_hash,
      queries_json = excluded.queries_json,
      provenance_json = excluded.provenance_json
  `);
  const selectAllEntries = database.prepare(`
    SELECT cache_key, provider, base_url_identity, model, model_revision,
      prompt_version, prompt_sha256, temperature, output_schema_sha256,
      question_input_sha256, plan_hash, queries_json, provenance_json
    FROM ${H2_QUERY_PLAN_CACHE_SQLITE_TABLE}
    ORDER BY cache_key
  `);

  function ensureOpen() {
    if (closed) throw new Error("query plan cache is closed");
  }

  function decodeRow(row, expectedKey = null) {
    let queries;
    let provenance;
    try {
      queries = JSON.parse(String(row.queries_json || ""));
      provenance = JSON.parse(String(row.provenance_json || ""));
    } catch {
      throw new Error("query plan cache row JSON is invalid");
    }
    const plan = normalizePlan({ queries, plan_hash: row.plan_hash, provenance });
    let rowKey;
    try {
      rowKey = normalizeCacheKey({
        provider: row.provider,
        base_url_identity: row.base_url_identity,
        model: row.model,
        model_revision: row.model_revision,
        prompt_version: row.prompt_version,
        prompt_sha256: row.prompt_sha256,
        temperature: row.temperature,
        output_schema_sha256: row.output_schema_sha256,
        question_input_sha256: row.question_input_sha256,
      });
    } catch {
      throw new Error("query plan cache row identity is invalid");
    }
    if (row.cache_key !== serializeKey(rowKey) ||
        (expectedKey && row.cache_key !== serializeKey(expectedKey)) ||
        row.provider !== plan.provenance.provider ||
        row.base_url_identity !== plan.provenance.base_url_identity ||
        row.model !== plan.provenance.model ||
        row.model_revision !== plan.provenance.model_revision ||
        row.prompt_version !== plan.provenance.prompt_version ||
        row.prompt_sha256 !== plan.provenance.prompt_sha256 ||
        Number(row.temperature) !== Number(plan.provenance.temperature) ||
        row.output_schema_sha256 !== plan.provenance.output_schema_sha256 ||
        row.question_input_sha256 !== plan.provenance.question_input_sha256) {
      throw new Error("query plan cache provenance mismatch");
    }
    return plan;
  }

  return {
    path: resolvedPath,
    get(key) {
      ensureOpen();
      const normalizedKey = normalizeCacheKey(key);
      const row = selectEntry.get(serializeKey(normalizedKey));
      return row ? decodeRow(row, normalizedKey) : null;
    },
    set(key, plan) {
      ensureOpen();
      const normalizedKey = normalizeCacheKey(key);
      const normalizedPlan = normalizePlan(plan);
      const provenance = {
        ...normalizedPlan.provenance,
        provider: normalizedKey.provider,
        base_url_identity: normalizedKey.base_url_identity,
        model: normalizedKey.model,
        model_revision: normalizedKey.model_revision,
        prompt_version: normalizedKey.prompt_version,
        prompt_sha256: normalizedKey.prompt_sha256,
        temperature: normalizedKey.temperature,
        output_schema_sha256: normalizedKey.output_schema_sha256,
        question_input_sha256: normalizedKey.question_input_sha256,
        plan_hash: normalizedPlan.plan_hash,
      };
      assertNoForbiddenFields(provenance, "query_plan_cache_provenance", { rejectReserved: true });
      upsertEntry.run(
        serializeKey(normalizedKey),
        normalizedKey.provider,
        normalizedKey.base_url_identity,
        normalizedKey.model,
        normalizedKey.model_revision,
        normalizedKey.prompt_version,
        normalizedKey.prompt_sha256,
        normalizedKey.temperature,
        normalizedKey.output_schema_sha256,
        normalizedKey.question_input_sha256,
        normalizedPlan.plan_hash,
        JSON.stringify(normalizedPlan.queries),
        JSON.stringify(provenance),
      );
    },
    close() {
      if (closed) return;
      database.close();
      closed = true;
    },
    snapshot() {
      ensureOpen();
      const entries = {};
      for (const row of selectAllEntries.all()) entries[row.cache_key] = decodeRow(row);
      return {
        schema: H2_QUERY_PLAN_CACHE_SCHEMA,
        user_version: H2_QUERY_PLAN_CACHE_SQLITE_USER_VERSION,
        entries,
      };
    },
  };
}
