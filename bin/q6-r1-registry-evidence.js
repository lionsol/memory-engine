#!/usr/bin/env node
"use strict";

const { DatabaseSync } = require("node:sqlite");

const SCHEMA = "memory_engine_q6_r1_registry_evidence_v1";
const DEFAULT_INDEX_KEY = "installed-plugin-index";
const DEFAULT_PLUGIN_ID = "memory-engine";

function usage() {
  return [
    "Usage:",
    "  node bin/q6-r1-registry-evidence.js --db <openclaw.sqlite> [--plugin-id memory-engine] [--json]",
    "",
    "Read-only bounded inspection of one plugin record from installed_plugin_index.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    db: null,
    pluginId: DEFAULT_PLUGIN_ID,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--db") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error("--db expects a value");
      args.db = value;
      i += 1;
    } else if (token === "--plugin-id") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error("--plugin-id expects a value");
      args.pluginId = value;
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  if (!args.help && !args.db) throw new Error("--db is required");
  if (typeof args.pluginId !== "string" || !args.pluginId.trim()) throw new Error("--plugin-id must be nonempty");
  return args;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label}_invalid_json: ${error.message}`);
  }
}

function nullableString(value) {
  return typeof value === "string" ? value : null;
}

function boundedInstallRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  return {
    source: nullableString(record.source),
    sourcePath: nullableString(record.sourcePath),
    installPath: nullableString(record.installPath),
    version: nullableString(record.version),
    installedAt: nullableString(record.installedAt),
  };
}

function boundedPluginMetadata(plugin) {
  if (!plugin || typeof plugin !== "object" || Array.isArray(plugin)) return null;
  return {
    pluginId: nullableString(plugin.pluginId),
    manifestPath: nullableString(plugin.manifestPath),
    manifestHash: nullableString(plugin.manifestHash),
    rootDir: nullableString(plugin.rootDir),
    origin: nullableString(plugin.origin),
    enabled: typeof plugin.enabled === "boolean" ? plugin.enabled : null,
    packageName: nullableString(plugin.packageName),
    packageVersion: nullableString(plugin.packageVersion),
    installRecordHash: nullableString(plugin.installRecordHash),
  };
}

function readEvidence({ dbPath, pluginId = DEFAULT_PLUGIN_ID, indexKey = DEFAULT_INDEX_KEY }) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare(
      `SELECT index_key, generated_at_ms, refresh_reason, install_records_json, plugins_json
       FROM installed_plugin_index
       WHERE index_key = ?`,
    ).get(indexKey);

    if (!row) {
      return {
        schema: SCHEMA,
        index_found: false,
        index_key: indexKey,
        plugin_id: pluginId,
        install_record: null,
        plugin_metadata: null,
        plugin_metadata_match_count: 0,
      };
    }

    const records = parseJson(row.install_records_json, "install_records_json");
    const plugins = parseJson(row.plugins_json, "plugins_json");
    if (!records || typeof records !== "object" || Array.isArray(records)) {
      throw new Error("install_records_json_wrong_shape");
    }
    if (!Array.isArray(plugins)) throw new Error("plugins_json_wrong_shape");

    const matches = plugins.filter(
      (entry) => entry && typeof entry === "object" && !Array.isArray(entry) && entry.pluginId === pluginId,
    );
    if (matches.length > 1) throw new Error("duplicate_plugin_metadata");

    return {
      schema: SCHEMA,
      index_found: true,
      index_key: nullableString(row.index_key),
      generated_at_ms: Number(row.generated_at_ms),
      refresh_reason: nullableString(row.refresh_reason),
      plugin_id: pluginId,
      install_record: boundedInstallRecord(records[pluginId]),
      plugin_metadata: boundedPluginMetadata(matches[0]),
      plugin_metadata_match_count: matches.length,
    };
  } finally {
    db.close();
  }
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const evidence = readEvidence({
    dbPath: args.db,
    pluginId: args.pluginId,
  });
  process.stdout.write(`${JSON.stringify(evidence, null, args.json ? 2 : 0)}\n`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_INDEX_KEY,
  DEFAULT_PLUGIN_ID,
  SCHEMA,
  boundedInstallRecord,
  boundedPluginMetadata,
  main,
  parseArgs,
  readEvidence,
};
