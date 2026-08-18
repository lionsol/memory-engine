import { createHash } from "node:crypto";

import {
  extractCategoryFromText,
  inferCategoryFromPath,
} from "../category-inference.js";

export const CANONICAL_MEMORY_OBJECT_SCHEMA_VERSION = 1;

export const SUPPORTED_CANONICAL_SOURCE_CATEGORIES = Object.freeze([
  "temporary",
  "raw_log",
  "episodic",
  "preference",
  "kg_node",
  "user_identity",
  "core_profile",
  "project",
  "daily_journal",
  "dreaming",
  "stats",
  "generated",
  "workflow",
  "workflow_rule",
]);

const SUPPORTED_SOURCE_CATEGORY_SET = new Set(SUPPORTED_CANONICAL_SOURCE_CATEGORIES);
const PATH_EXTERNAL_SENTINEL = "external";
const EPISODE_PATH_PATTERN = /^memory\/episodes\/(\d{4}-\d{2}-\d{2})\.md$/;

const KIND_BY_CATEGORY = Object.freeze({
  preference: "preference",
  user_identity: "preference",
  project: "project_state",
  episodic: "episode",
  raw_log: "diagnostic",
  workflow: "workflow_rule",
  workflow_rule: "workflow_rule",
  stats: "quality_signal",
});

function compositionFailure(reason, message) {
  const error = new Error(message);
  error.reason = reason;
  return error;
}

function fail(reason, message) {
  throw compositionFailure(reason, message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredField(row, field, reason) {
  if (!Object.hasOwn(row, field)) {
    fail(reason, `missing ${field}`);
  }
  return row[field];
}

function validateCoreString(row, field) {
  const value = requiredField(row, field, "core_malformed");
  if (typeof value !== "string") fail("core_malformed", `${field} must be a string`);
  return value;
}

function validateCoreLine(row, field) {
  const value = requiredField(row, field, "core_malformed");
  if (!Number.isSafeInteger(value)) fail("core_malformed", `${field} must be an integer`);
  return value;
}

function optionalCoreHash(row) {
  const value = row.hash;
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail("core_malformed", "hash must be a string or null");
  return value;
}

function optionalCoreUpdatedAt(row) {
  const value = row.updated_at;
  if (value === undefined || value === null) return null;
  if (
    !(typeof value === "number" && Number.isFinite(value)) &&
    !(typeof value === "string" && value.length > 0)
  ) {
    fail("core_malformed", "updated_at must preserve a scalar Core value");
  }
  return value;
}

export function validateCanonicalCoreRow(coreRow) {
  if (!isObject(coreRow)) fail("core_malformed", "Core row must be an object");

  const id = validateCoreString(coreRow, "id");
  if (id.trim().length === 0) fail("core_malformed", "Core id must be non-empty");

  const path = validateCoreString(coreRow, "path");
  const source = validateCoreString(coreRow, "source");
  const startLine = validateCoreLine(coreRow, "start_line");
  const endLine = validateCoreLine(coreRow, "end_line");
  const text = validateCoreString(coreRow, "text");

  return {
    id,
    path,
    source,
    startLine,
    endLine,
    text,
    hash: optionalCoreHash(coreRow),
    updatedAt: optionalCoreUpdatedAt(coreRow),
  };
}

function requiredFiniteNumber(row, field, { integer = false, minimum = null, maximum = null } = {}) {
  const value = requiredField(row, field, "engine_malformed");
  if (!Number.isFinite(value) || (integer && !Number.isSafeInteger(value))) {
    fail("engine_malformed", `${field} must be a finite ${integer ? "integer" : "number"}`);
  }
  if (minimum !== null && value < minimum) fail("engine_malformed", `${field} is below its minimum`);
  if (maximum !== null && value > maximum) fail("engine_malformed", `${field} is above its maximum`);
  return value;
}

function optionalFiniteNumber(row, field) {
  const value = requiredField(row, field, "engine_malformed");
  if (value === null) return null;
  if (!Number.isFinite(value)) fail("engine_malformed", `${field} must be a finite number or null`);
  return value;
}

function requiredBooleanFlag(row, field) {
  const value = requiredField(row, field, "engine_malformed");
  if (value === true || value === false) return value;
  if (value === 0 || value === 1) return Boolean(value);
  fail("engine_malformed", `${field} must be a boolean or SQLite 0/1 flag`);
}

export function validateCanonicalEngineRow(engineRow, coreId) {
  if (!isObject(engineRow)) fail("engine_malformed", "Engine row must be an object");

  const chunkId = requiredField(engineRow, "chunk_id", "engine_malformed");
  if (typeof chunkId !== "string" || chunkId.length === 0 || chunkId !== coreId) {
    fail("engine_malformed", "Engine chunk_id must exactly match Core id");
  }

  const initialConfidence = requiredFiniteNumber(engineRow, "initial_confidence", {
    minimum: 0,
    maximum: 1,
  });
  const confidence = requiredFiniteNumber(engineRow, "confidence", {
    minimum: 0,
    maximum: 1,
  });
  const lastConfidenceUpdate = optionalFiniteNumber(engineRow, "last_confidence_update");
  const baseTau = requiredFiniteNumber(engineRow, "base_tau", { minimum: 0 });
  const hitCount = requiredFiniteNumber(engineRow, "hit_count", { integer: true, minimum: 0 });
  const archived = requiredBooleanFlag(engineRow, "is_archived");
  const protectedMemory = requiredBooleanFlag(engineRow, "is_protected");
  const conflict = requiredBooleanFlag(engineRow, "conflict_flag");
  const category = requiredField(engineRow, "category", "engine_malformed");
  if (typeof category !== "string" || category.trim().length === 0) {
    fail("engine_malformed", "category must be a non-empty string");
  }

  return {
    chunkId,
    initialConfidence,
    confidence,
    lastConfidenceUpdate,
    baseTau,
    hitCount,
    archived,
    protected: protectedMemory,
    conflict,
    category,
  };
}

function categoryFromSource(core, engine) {
  if (engine) {
    return {
      category: engine.category,
      categoryAuthority: "engine",
    };
  }

  const sourceCategory = extractCategoryFromText(core.text);
  if (SUPPORTED_SOURCE_CATEGORY_SET.has(sourceCategory)) {
    return {
      category: sourceCategory,
      categoryAuthority: "source_metadata",
    };
  }

  const pathCategory = inferCategoryFromPath(core.path, { fallback: PATH_EXTERNAL_SENTINEL });
  if (pathCategory !== PATH_EXTERNAL_SENTINEL) {
    return {
      category: pathCategory,
      categoryAuthority: "path_inference",
    };
  }

  return {
    category: "unknown",
    categoryAuthority: "unknown",
  };
}

function kindFromCategory(category) {
  return KIND_BY_CATEGORY[String(category).toLowerCase()] || "fact";
}

function temporalFromPath(path) {
  const match = EPISODE_PATH_PATTERN.exec(path);
  if (!match) {
    return {
      episodeDate: null,
      episodeDateBasis: null,
    };
  }
  return {
    episodeDate: match[1],
    episodeDateBasis: "source_path",
  };
}

function lifecycleFromEngine(engine) {
  if (!engine) {
    return {
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
    };
  }
  return {
    management: "managed",
    category: engine.category,
    initial_confidence: engine.initialConfidence,
    confidence: engine.confidence,
    last_confidence_update: engine.lastConfidenceUpdate,
    base_tau_days: engine.baseTau,
    hit_count: engine.hitCount,
    archived: engine.archived,
    protected: engine.protected,
    conflict: engine.conflict,
  };
}

export function composeCanonicalMemoryObject(coreRow, engineRow = null) {
  const core = validateCanonicalCoreRow(coreRow);
  const engine = engineRow === null || engineRow === undefined
    ? null
    : validateCanonicalEngineRow(engineRow, core.id);
  const classification = categoryFromSource(core, engine);
  const temporal = temporalFromPath(core.path);

  return {
    schema_version: CANONICAL_MEMORY_OBJECT_SCHEMA_VERSION,
    canonical_id: `cmem:core:${core.id}`,
    memory_id: core.id,
    source: {
      system: "openclaw_core",
      record_type: "chunk",
      record_id: core.id,
      path: core.path,
      core_source: core.source,
      line_start: core.startLine,
      line_end: core.endLine,
      text: core.text,
      core_hash: core.hash,
      updated_at: core.updatedAt,
    },
    classification: {
      category: classification.category,
      category_authority: classification.categoryAuthority,
      kind: kindFromCategory(classification.category),
      kind_basis: "category",
    },
    temporal: {
      episode_date: temporal.episodeDate,
      episode_date_basis: temporal.episodeDateBasis,
    },
    lifecycle: lifecycleFromEngine(engine),
    content_ref: {
      mode: "core_chunk",
      content_hash: `sha256:${createHash("sha256").update(core.text).digest("hex")}`,
    },
  };
}
