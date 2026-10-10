#!/usr/bin/env node

const { createHash } = require("node:crypto");
const { createReadStream, mkdirSync, statSync, writeFileSync, readFileSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const Database = require("better-sqlite3");
const { resolveMemoryEnginePaths } = require("../lib/runtime/paths.cjs");

const FINGERPRINT_CONTRACT = "core_deployment_logical_fingerprint_v1";

const CANONICAL_TABLES = Object.freeze([
  {
    name: "memory_index_chunks",
    fields: ["id", "path", "source", "start_line", "end_line", "hash", "model", "text", "embedding", "updated_at"],
    orderBy: "id",
  },
  {
    name: "memory_index_sources",
    fields: ["path", "source", "hash", "mtime", "size"],
    orderBy: "path, source",
  },
  {
    name: "memory_embedding_cache",
    fields: ["provider", "model", "provider_key", "hash", "embedding", "dims", "updated_at"],
    orderBy: "provider, model, provider_key, hash",
  },
  {
    name: "memory_index_meta",
    fields: ["key", "value"],
    orderBy: "key",
  },
  {
    name: "memory_index_state",
    fields: ["id", "revision"],
    orderBy: "id",
  },
]);

const SCHEMA_SURFACE_FIELDS = Object.freeze(["type", "name", "tbl_name", "sql"]);
const SCHEMA_IDENTITY_FIELDS = Object.freeze([
  "meta_key", "role", "schema_version", "agent_id", "created_at",
]);
const USAGE = "Usage: node bin/core-deployment-logical-fingerprint.js [--core-db <path>] [--out <json>] [--pretty] [--physical-sha256]\n       node bin/core-deployment-logical-fingerprint.js --compare <before.json> [--core-db <path>] [--out <after.json>] [--pretty] [--physical-sha256]";

function updateLength(hash, length) {
  const encoded = Buffer.allocUnsafe(8);
  encoded.writeBigUInt64BE(BigInt(length));
  hash.update(encoded);
}

function updateTyped(hash, value) {
  let type;
  let bytes;
  if (value === null || value === undefined) {
    type = 0x00;
    bytes = Buffer.alloc(0);
  } else if (Buffer.isBuffer(value)) {
    type = 0x05;
    bytes = value;
  } else if (typeof value === "bigint") {
    type = 0x04;
    bytes = Buffer.from(value.toString(), "utf8");
  } else if (typeof value === "string") {
    type = 0x01;
    bytes = Buffer.from(value, "utf8");
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Unsupported non-finite SQLite number");
    if (Number.isSafeInteger(value) && !Object.is(value, -0)) {
      type = 0x02;
      bytes = Buffer.from(String(value), "ascii");
    } else {
      type = 0x03;
      bytes = Buffer.allocUnsafe(8);
      bytes.writeDoubleBE(value);
    }
  } else {
    throw new Error(`Unsupported SQLite value type: ${typeof value}`);
  }
  hash.update(Buffer.from([type]));
  updateLength(hash, bytes.length);
  hash.update(bytes);
}

function jsonSqlValue(value) {
  if (typeof value !== "bigint") return value ?? null;
  if (value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)) {
    return Number(value);
  }
  return value.toString();
}

function hashRows(statement, label, fields) {
  const hash = createHash("sha256");
  hash.update(Buffer.from([0xa1]));
  updateTyped(hash, label);
  for (const field of fields) updateTyped(hash, field);

  let rows = 0;
  for (const row of statement.iterate()) {
    hash.update(Buffer.from([0xb1]));
    for (const field of fields) updateTyped(hash, row[field]);
    hash.update(Buffer.from([0xb2]));
    rows += 1;
  }
  hash.update(Buffer.from([0xaf]));
  updateTyped(hash, BigInt(rows));
  return { rows, sha256: hash.digest("hex") };
}

function hashObject(label, fields, object) {
  const hash = createHash("sha256");
  hash.update(Buffer.from([0xc1]));
  updateTyped(hash, label);
  for (const field of fields) {
    updateTyped(hash, field);
    updateTyped(hash, object[field]);
  }
  hash.update(Buffer.from([0xcf]));
  return hash.digest("hex");
}

function readUserVersion(db) {
  const row = db.prepare("PRAGMA user_version").safeIntegers(true).get();
  return row.user_version;
}

function assertCurrentDialect(db) {
  const current = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_index_chunks' LIMIT 1",
  ).get();
  if (!current) throw new Error("Unsupported Core DB: expected openclaw_memory_index dialect");
}

function readSchemaIdentity(db) {
  const statement = db.prepare("SELECT * FROM schema_meta WHERE meta_key = 'primary'").safeIntegers(true);
  const primaryRow = statement.get();
  if (!primaryRow) throw new Error("Unsupported Core DB: schema_meta.primary is missing");
  for (const field of [...SCHEMA_IDENTITY_FIELDS, "app_version", "updated_at"]) {
    if (!Object.hasOwn(primaryRow, field)) {
      throw new Error(`Unsupported Core DB: schema_meta.${field} is missing`);
    }
  }
  const primary = Object.fromEntries(SCHEMA_IDENTITY_FIELDS.map(field => [field, jsonSqlValue(primaryRow[field])]));
  return {
    primary,
    hashValues: Object.fromEntries(SCHEMA_IDENTITY_FIELDS.map(field => [field, primaryRow[field]])),
    volatile: {
      schema_meta_app_version: jsonSqlValue(primaryRow.app_version),
      schema_meta_updated_at: jsonSqlValue(primaryRow.updated_at),
    },
  };
}

function captureLogicalSections(db) {
  assertCurrentDialect(db);
  const tables = {};
  const canonicalHash = createHash("sha256");
  canonicalHash.update(Buffer.from([0xd1]));

  for (const table of CANONICAL_TABLES) {
    const fieldsSql = table.fields.map(field => `"${field}"`).join(", ");
    const statement = db.prepare(
      `SELECT ${fieldsSql} FROM "${table.name}" ORDER BY ${table.orderBy}`,
    ).safeIntegers(true);
    const result = hashRows(statement, table.name, table.fields);
    tables[table.name] = result;
    updateTyped(canonicalHash, table.name);
    updateTyped(canonicalHash, BigInt(result.rows));
    updateTyped(canonicalHash, result.sha256);
  }

  const identity = readSchemaIdentity(db);
  const identitySha256 = hashObject("schema_identity", SCHEMA_IDENTITY_FIELDS, identity.hashValues);

  const surfaceStatement = db.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE name = 'schema_meta'
       OR tbl_name = 'schema_meta'
       OR name LIKE 'memory_index_%'
    ORDER BY type, name
  `).safeIntegers(true);
  const surface = hashRows(surfaceStatement, "schema_surface", SCHEMA_SURFACE_FIELDS);
  const userVersion = readUserVersion(db);
  const canonicalContentSha256 = canonicalHash.digest("hex");

  const invariantHash = createHash("sha256");
  invariantHash.update(Buffer.from([0xe1]));
  updateTyped(invariantHash, "canonical_content_sha256");
  updateTyped(invariantHash, canonicalContentSha256);
  updateTyped(invariantHash, "schema_identity_sha256");
  updateTyped(invariantHash, identitySha256);
  updateTyped(invariantHash, "schema_surface_sha256");
  updateTyped(invariantHash, surface.sha256);
  updateTyped(invariantHash, "pragma_user_version");
  updateTyped(invariantHash, userVersion);

  return {
    dialect: "openclaw_memory_index",
    pragmaUserVersion: jsonSqlValue(userVersion),
    deploymentInvariantSha256: invariantHash.digest("hex"),
    canonicalContent: { sha256: canonicalContentSha256, tables },
    schemaIdentity: { sha256: identitySha256, primary: identity.primary },
    schemaSurface: { sha256: surface.sha256 },
    volatileMetadata: identity.volatile,
  };
}

function sha256File(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

async function captureFingerprint({ coreDbPath, physicalSha256 = false } = {}) {
  const resolvedCoreDbPath = resolve(String(coreDbPath || resolveMemoryEnginePaths().coreDbPath));
  const db = new Database(resolvedCoreDbPath, { readonly: true, fileMustExist: true });
  let sections;
  try {
    db.pragma("query_only = ON");
    db.defaultSafeIntegers(true);
    sections = captureLogicalSections(db);
  } finally {
    db.close();
  }

  const fileStat = statSync(resolvedCoreDbPath);
  const physical = {
    size_bytes: fileStat.size,
    mtime_ms: fileStat.mtimeMs,
    sha256: physicalSha256 ? await sha256File(resolvedCoreDbPath) : null,
  };
  return {
    contract: FINGERPRINT_CONTRACT,
    checked_at: new Date().toISOString(),
    core_db_path: resolvedCoreDbPath,
    dialect: sections.dialect,
    pragma_user_version: sections.pragmaUserVersion,
    deployment_invariant_sha256: sections.deploymentInvariantSha256,
    canonical_content: sections.canonicalContent,
    schema_identity: sections.schemaIdentity,
    schema_surface: sections.schemaSurface,
    volatile_metadata: sections.volatileMetadata,
    physical,
  };
}

function validateBaseline(baseline) {
  if (!baseline || baseline.contract !== FINGERPRINT_CONTRACT) {
    throw new Error(`Baseline must use contract ${FINGERPRINT_CONTRACT}`);
  }
  for (const key of ["core_db_path", "dialect", "deployment_invariant_sha256"]) {
    if (typeof baseline[key] !== "string" || baseline[key].length === 0) {
      throw new Error(`Baseline is missing ${key}`);
    }
  }
  for (const [section, key] of [
    ["canonical_content", "sha256"],
    ["schema_identity", "sha256"],
    ["schema_surface", "sha256"],
  ]) {
    if (typeof baseline[section]?.[key] !== "string") throw new Error(`Baseline is missing ${section}.${key}`);
  }
  if (!Object.hasOwn(baseline, "pragma_user_version")) throw new Error("Baseline is missing pragma_user_version");
}

function compareFingerprints(baseline, current, baselinePath) {
  validateBaseline(baseline);
  const contractEqual = baseline.contract === current.contract;
  const corePathEqual = baseline.core_db_path === current.core_db_path;
  const dialectEqual = baseline.dialect === current.dialect;
  const canonicalContentEqual = baseline.canonical_content.sha256 === current.canonical_content.sha256;
  const schemaIdentityEqual = baseline.schema_identity.sha256 === current.schema_identity.sha256;
  const schemaSurfaceEqual = baseline.schema_surface.sha256 === current.schema_surface.sha256;
  const userVersionEqual = baseline.pragma_user_version === current.pragma_user_version;
  const hashEqual = baseline.deployment_invariant_sha256 === current.deployment_invariant_sha256;
  const deploymentInvariantEqual = contractEqual && corePathEqual && dialectEqual
    && canonicalContentEqual && schemaIdentityEqual && schemaSurfaceEqual && userVersionEqual && hashEqual;
  const allowedMetadataChanges = [];
  for (const [key, label] of [
    ["schema_meta_updated_at", "schema_meta.updated_at"],
    ["schema_meta_app_version", "schema_meta.app_version"],
  ]) {
    if (baseline.volatile_metadata?.[key] !== current.volatile_metadata?.[key]) {
      allowedMetadataChanges.push(label);
    }
  }
  const baselinePhysicalSha = baseline.physical?.sha256;
  const currentPhysicalSha = current.physical?.sha256;
  return {
    baseline_path: resolve(baselinePath),
    contract_equal: contractEqual,
    core_path_equal: corePathEqual,
    dialect_equal: dialectEqual,
    canonical_content_equal: canonicalContentEqual,
    schema_identity_equal: schemaIdentityEqual,
    schema_surface_equal: schemaSurfaceEqual,
    user_version_equal: userVersionEqual,
    deployment_invariant_equal: deploymentInvariantEqual,
    physical_sha_equal: typeof baselinePhysicalSha === "string" && typeof currentPhysicalSha === "string"
      ? baselinePhysicalSha === currentPhysicalSha
      : null,
    allowed_metadata_changes: allowedMetadataChanges,
  };
}

function parseArgs(argv) {
  const parsed = { coreDbPath: undefined, comparePath: undefined, outPath: undefined, pretty: false, physicalSha256: false, help: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--pretty" || arg === "--physical-sha256" || arg === "--help") {
      if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`);
      seen.add(arg);
      if (arg === "--pretty") parsed.pretty = true;
      else if (arg === "--physical-sha256") parsed.physicalSha256 = true;
      else parsed.help = true;
      continue;
    }
    if (["--core-db", "--compare", "--out"].includes(arg)) {
      if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`);
      seen.add(arg);
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === "--core-db") parsed.coreDbPath = value;
      else if (arg === "--compare") parsed.comparePath = value;
      else parsed.outPath = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

async function runCli(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  let args;
  try {
    args = parseArgs(argv);
    if (args.help) {
      stdout.write(`${USAGE}\n`);
      return 0;
    }
    let report = await captureFingerprint({
      coreDbPath: args.coreDbPath,
      physicalSha256: args.physicalSha256,
    });
    let exitCode = 0;
    if (args.comparePath) {
      const baselinePath = resolve(args.comparePath);
      const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
      const comparison = compareFingerprints(baseline, report, baselinePath);
      report = { ...report, comparison };
      if (!comparison.deployment_invariant_equal) exitCode = 2;
    }
    const output = `${JSON.stringify(report, null, args.pretty ? 2 : 0)}\n`;
    if (args.outPath) {
      const outputPath = resolve(args.outPath);
      if (outputPath === report.core_db_path) {
        throw new Error("--out must not target the Core DB");
      }
      if (args.comparePath && outputPath === resolve(args.comparePath)) {
        throw new Error("--out must not overwrite the comparison baseline");
      }
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, output, "utf8");
    }
    stdout.write(output);
    return exitCode;
  } catch (error) {
    stderr.write(`${error?.message || String(error)}\n`);
    return 64;
  }
}

if (require.main === module) {
  runCli(process.argv.slice(2)).then(code => {
    process.exitCode = code;
  });
}

module.exports = {
  FINGERPRINT_CONTRACT,
  captureFingerprint,
  compareFingerprints,
  parseArgs,
  runCli,
};
