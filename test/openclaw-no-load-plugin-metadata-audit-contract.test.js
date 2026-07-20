import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const AUDIT_PATH = new URL(
  "../docs/smoke-tests/openclaw-no-load-plugin-metadata-audit.md",
  import.meta.url,
);

function auditDocument() {
  return readFileSync(AUDIT_PATH, "utf8");
}

function includes(text, value) {
  assert.equal(text.includes(value), true, value);
}

test("audit records the writable state-database helper evidence", () => {
  const text = auditDocument();
  for (const value of [
    "<resolved state root>/state/openclaw.sqlite",
    "installed_plugin_index",
    "readPersistedInstalledPluginIndexFromSqlite()",
    "openOpenClawStateDatabase()",
    "DatabaseSync without readOnly=true",
    "ensureOpenClawStatePermissions",
    "configureSqliteConnectionPragmas",
    "ensureSchema",
    "loadInstalledPluginIndexWithDiscovery",
  ]) {
    includes(text, value);
  }
});

test("audit distinguishes existing API blockage from unassessed standalone reader feasibility", () => {
  const text = auditDocument();
  for (const value of [
    "Existing OpenClaw registry/snapshot API=BLOCKED FOR PHASE 0",
    "Existing OpenClaw metadata API=BLOCKED / REVIEW FIXES IMPLEMENTED",
    "standalone read-only state-DB reader feasibility=NOT ASSESSED",
    "B8-A7-R2B: standalone read-only OpenClaw state-DB reader feasibility audit",
    "B8-A7-R2B standalone read-only state-DB reader feasibility=NOT STARTED",
    "host remediation execution=NOT AUTHORIZED",
    "B8-A7 sustained runtime window=NOT AUTHORIZED",
    "B8-B removal=NOT AUTHORIZED",
  ]) {
    includes(text, value);
  }
  assert.doesNotMatch(text, /SQLite storage alone proves plugin loading/i);
  assert.doesNotMatch(text, /standalone read-only reader is impossible/i);
  assert.doesNotMatch(text, /host baseline is authorized/i);
});
