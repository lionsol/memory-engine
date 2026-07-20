import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import backupCli from "../bin/build-sustained-runtime-config-backup-manifest.js";
import { buildSustainedRuntimeConfigBackupManifest } from "../lib/recall/hybrid/sustained-runtime-config-backup.js";

const CREATED_AT = "2026-07-20T03:00:00.000Z";

function safeConfig() {
  return {
    secret: "do-not-copy",
    plugins: {
      entries: {
        "active-memory": { enabled: false },
        "memory-engine": {
          enabled: true,
          config: {
            kgFailClosedMode: "legacy_fallback",
            recentFailClosedMode: "legacy_fallback",
            autoRecall: { enabled: false },
            productionEvidenceWindow: { enabled: false },
          },
        },
      },
    },
  };
}

test("config backup manifest binds exact bytes and reduced rollback facts without copying secrets", () => {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-config-backup-"));
  const livePath = join(root, "openclaw-live.json");
  const path = join(root, "openclaw-backup.json");
  const bytes = JSON.stringify(safeConfig(), null, 2);
  writeFileSync(livePath, bytes, "utf8");
  writeFileSync(path, bytes, "utf8");
  chmodSync(path, 0o600);
  const report = buildSustainedRuntimeConfigBackupManifest({
    configPath: path,
    liveConfigPath: livePath,
    createdAt: CREATED_AT,
  });
  assert.equal(report.valid, true);
  assert.equal(report.status, "ready");
  assert.match(report.config_sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.byte_count > 0, true);
  assert.equal(report.live_byte_count, report.byte_count);
  assert.equal(report.live_config_sha256, report.config_sha256);
  assert.equal(report.backup_matches_live_config, true);
  assert.notEqual(report.live_config_path, report.backup_path);
  assert.match(report.effective_config_fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(report.active_memory_enabled, false);
  assert.equal(report.kg_mode, "legacy_fallback");
  assert.equal(report.recent_mode, "legacy_fallback");
  assert.equal(report.auto_recall_enabled, false);
  assert.equal(report.production_evidence_enabled, false);
  assert.equal(JSON.stringify(report).includes("do-not-copy"), false);
});

test("unsafe or invalid backups fail closed", () => {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-config-backup-bad-"));
  const activeLivePath = join(root, "active-live.json");
  const activePath = join(root, "active.json");
  const active = safeConfig();
  delete active.plugins.entries["active-memory"];
  const activeBytes = JSON.stringify(active);
  writeFileSync(activeLivePath, activeBytes, "utf8");
  writeFileSync(activePath, activeBytes, "utf8");
  chmodSync(activePath, 0o600);
  const activeReport = buildSustainedRuntimeConfigBackupManifest({
    configPath: activePath,
    liveConfigPath: activeLivePath,
    createdAt: CREATED_AT,
  });
  assert.equal(activeReport.valid, false);
  assert.ok(activeReport.blockers.includes("config_backup_runtime_boundary_conflict"));

  const malformedLivePath = join(root, "malformed-live.json");
  const malformedPath = join(root, "malformed.json");
  writeFileSync(malformedLivePath, "{", "utf8");
  writeFileSync(malformedPath, "{", "utf8");
  chmodSync(malformedPath, 0o600);
  const malformed = buildSustainedRuntimeConfigBackupManifest({
    configPath: malformedPath,
    liveConfigPath: malformedLivePath,
    createdAt: CREATED_AT,
  });
  assert.equal(malformed.valid, false);
  assert.ok(malformed.blockers.some(item => item.startsWith("config_backup_json_invalid:")));
});

test("mismatched, linked, and over-permissive backup files fail closed", () => {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-config-backup-binding-"));
  const livePath = join(root, "live.json");
  const bytes = JSON.stringify(safeConfig());
  writeFileSync(livePath, bytes, "utf8");

  const mismatchedPath = join(root, "mismatched.json");
  writeFileSync(mismatchedPath, `${bytes}\n`, "utf8");
  chmodSync(mismatchedPath, 0o600);
  const mismatched = buildSustainedRuntimeConfigBackupManifest({
    configPath: mismatchedPath,
    liveConfigPath: livePath,
    createdAt: CREATED_AT,
  });
  assert.equal(mismatched.valid, false);
  assert.ok(mismatched.blockers.includes("config_backup_live_bytes_mismatch"));

  const hardlinkPath = join(root, "hardlink.json");
  linkSync(livePath, hardlinkPath);
  chmodSync(hardlinkPath, 0o600);
  const hardlink = buildSustainedRuntimeConfigBackupManifest({
    configPath: hardlinkPath,
    liveConfigPath: livePath,
    createdAt: CREATED_AT,
  });
  assert.equal(hardlink.valid, false);
  assert.ok(hardlink.blockers.includes("config_backup_not_independent_copy"));

  const symlinkPath = join(root, "symlink.json");
  symlinkSync(livePath, symlinkPath);
  const symlink = buildSustainedRuntimeConfigBackupManifest({
    configPath: symlinkPath,
    liveConfigPath: livePath,
    createdAt: CREATED_AT,
  });
  assert.equal(symlink.valid, false);
  assert.ok(symlink.blockers.includes("config_backup_symlink_not_allowed"));

  const openPath = join(root, "open.json");
  writeFileSync(openPath, bytes, "utf8");
  chmodSync(openPath, 0o644);
  const open = buildSustainedRuntimeConfigBackupManifest({
    configPath: openPath,
    liveConfigPath: livePath,
    createdAt: CREATED_AT,
  });
  assert.equal(open.valid, false);
  assert.ok(open.blockers.includes("config_backup_permissions_too_open"));
});

test("config backup CLI writes only the manifest", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-config-backup-cli-"));
  const livePath = join(root, "openclaw-live.json");
  const path = join(root, "openclaw-backup.json");
  const out = join(root, "manifest.json");
  const bytes = JSON.stringify(safeConfig());
  writeFileSync(livePath, bytes, "utf8");
  writeFileSync(path, bytes, "utf8");
  chmodSync(path, 0o600);
  const result = await backupCli.buildSustainedRuntimeConfigBackupManifestCli([
    "--live-config", livePath,
    "--config-backup", path,
    "--created-at", CREATED_AT,
    "--out", out,
    "--pretty",
  ]);
  assert.equal(result.exitCode, 0);
  const output = readFileSync(out, "utf8");
  assert.equal(output.includes("do-not-copy"), false);
  assert.equal(JSON.parse(output).valid, true);
});
