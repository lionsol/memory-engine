import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
const {
  SCHEMA,
  readEvidence,
} = require("../bin/q6-r1-registry-evidence.js");

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "q6-r1-registry-"));
  const dbPath = join(dir, "openclaw.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE installed_plugin_index (
      index_key TEXT PRIMARY KEY,
      generated_at_ms INTEGER NOT NULL,
      refresh_reason TEXT NOT NULL,
      install_records_json TEXT NOT NULL,
      plugins_json TEXT NOT NULL
    )
  `);
  return { dir, dbPath, db };
}

test("Q6-R1 registry evidence reads exact memory-engine pluginId metadata read-only", () => {
  const f = fixture();
  try {
    f.db.prepare(`
      INSERT INTO installed_plugin_index (
        index_key, generated_at_ms, refresh_reason, install_records_json, plugins_json
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      "installed-plugin-index",
      123,
      "source-changed",
      JSON.stringify({
        "memory-engine": {
          source: "path",
          sourcePath: "/repo",
          installPath: "/extension",
          version: "1.0.0",
          installedAt: "2026-09-18T11:59:12.608Z",
          secret: "must-not-leak",
        },
      }),
      JSON.stringify([
        {
          pluginId: "other",
          manifestHash: "other",
        },
        {
          pluginId: "memory-engine",
          manifestPath: "/extension/openclaw.plugin.json",
          manifestHash: "346969",
          rootDir: "/extension",
          origin: "global",
          enabled: true,
          packageName: "memory-engine-plugin",
          packageVersion: "1.0.0",
          installRecordHash: "record-hash",
          contributions: { secret: "must-not-leak" },
        },
      ]),
    );
    f.db.close();

    const evidence = readEvidence({ dbPath: f.dbPath });
    assert.equal(evidence.schema, SCHEMA);
    assert.equal(evidence.index_found, true);
    assert.equal(evidence.plugin_metadata_match_count, 1);
    assert.deepEqual(evidence.install_record, {
      source: "path",
      sourcePath: "/repo",
      installPath: "/extension",
      version: "1.0.0",
      installedAt: "2026-09-18T11:59:12.608Z",
    });
    assert.deepEqual(evidence.plugin_metadata, {
      pluginId: "memory-engine",
      manifestPath: "/extension/openclaw.plugin.json",
      manifestHash: "346969",
      rootDir: "/extension",
      origin: "global",
      enabled: true,
      packageName: "memory-engine-plugin",
      packageVersion: "1.0.0",
      installRecordHash: "record-hash",
    });
    assert.equal(JSON.stringify(evidence).includes("must-not-leak"), false);
  } finally {
    try { f.db.close(); } catch {}
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("Q6-R1 registry evidence fails closed on duplicate plugin metadata", () => {
  const f = fixture();
  try {
    f.db.prepare(`
      INSERT INTO installed_plugin_index (
        index_key, generated_at_ms, refresh_reason, install_records_json, plugins_json
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      "installed-plugin-index",
      123,
      "source-changed",
      JSON.stringify({ "memory-engine": {} }),
      JSON.stringify([
        { pluginId: "memory-engine" },
        { pluginId: "memory-engine" },
      ]),
    );
    f.db.close();

    assert.throws(
      () => readEvidence({ dbPath: f.dbPath }),
      /duplicate_plugin_metadata/,
    );
  } finally {
    try { f.db.close(); } catch {}
    rmSync(f.dir, { recursive: true, force: true });
  }
});
