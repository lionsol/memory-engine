import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const DESIGN = new URL(
  "../docs/openclaw-host-plugin-metadata-publisher-integration-design.md",
  import.meta.url,
);
const ADR = new URL("../docs/adr/host-plugin-metadata-ownership.md", import.meta.url);
const INDEX = new URL("../docs/README.md", import.meta.url);
const LEDGER = new URL("../docs/hybrid-fail-closed-rollout-status.md", import.meta.url);
const DEVLOG = new URL("../docs/devlog.md", import.meta.url);

function read(url) {
  return readFileSync(url, "utf8");
}

test("R5 host publisher integration design exists and is indexed", () => {
  assert.equal(existsSync(DESIGN), true);
  assert.equal(existsSync(ADR), true);

  const index = read(INDEX);
  assert.match(index, /openclaw-host-plugin-metadata-publisher-integration-design\.md/);
  assert.match(index, /host-plugin-metadata-ownership\.md/);
});

test("R5 design defines the host-owned target, outbox, manifest, and startup contracts", () => {
  const design = read(DESIGN);
  for (const token of [
    "Status: Accepted design / upstream implementation not authorized",
    "B8-A7-R5 OpenClaw Host Plugin Metadata Publisher Integration Design",
    "openclaw@2026.7.1-2",
    "requiredPluginIds",
    "host_plugin_metadata_state",
    "host_plugin_metadata_commits",
    "host_plugin_metadata_publications",
    "PRIMARY KEY (plugin_id, generation)",
    "prepared",
    "committed",
    "published",
    "openclaw.host-plugin-install-metadata/v2",
    "<resolved OpenClaw state directory>/plugins/host-metadata/v2/<plugin-id-sha256>.json",
    "installation_state",
    "policy_state",
    "publication.state=retired",
    "disabled-by-host-policy",
    "readConfigFileSnapshotWithPluginMetadata",
    "resolvePluginMetadataSnapshot",
    "no-plugin-metadata host-policy snapshot phase",
    "exact desired canonical manifest bytes",
    "do not merge filesystem-recovered managed npm records",
    "actual config hash matches neither",
    "writePersistedInstalledPluginIndexToSqlite",
    "Windows publication may use the same canonical and atomic contract",
  ]) {
    assert.equal(design.includes(token), true, `missing R5 design token: ${token}`);
  }
});

test("R5 design preserves the upstream and runtime authorization boundary", () => {
  const design = read(DESIGN);
  for (const token of [
    "OpenClaw fork/worktree=NOT CREATED",
    "OpenClaw source modification=NOT AUTHORIZED",
    "upstream pull request=NOT CREATED",
    "real host publisher=NOT AUTHORIZED",
    "production manifest consumer=NOT AUTHORIZED",
    "runtime configuration change=NOT AUTHORIZED",
    "plugin install/reload=NOT AUTHORIZED",
    "B8-A7 sustained runtime authorization=WITHHELD",
    "B8-A7 sustained runtime window=NOT AUTHORIZED",
    "B8-B removal=NOT AUTHORIZED",
  ]) {
    assert.equal(design.includes(token), true, `missing R5 boundary token: ${token}`);
  }
});

test("rollout ledger closes R4 and registers R5 without authorizing implementation", () => {
  const ledger = read(LEDGER);
  for (const token of [
    "B8-A7-R4 metadata ownership decision=PASSED / CLOSED",
    "B8-A7-R5 host publisher integration design=ACCEPTED",
    "B8-A7-R5 repository closure=IMPLEMENTED / EDI VERIFICATION PENDING",
    "B8-A7-R5 OpenClaw host publisher integration design",
    "ACCEPTED / UPSTREAM IMPLEMENTATION NOT STARTED",
    "SQLite durable publication outbox",
    "before resolvePluginMetadataSnapshot",
    "OpenClaw source modification NOT AUTHORIZED",
    "real host publisher NOT AUTHORIZED",
  ]) {
    assert.equal(ledger.includes(token), true, `missing R5 ledger token: ${token}`);
  }
});

test("devlog records the R5 source finding and continuing safety boundary", () => {
  const devlog = read(DEVLOG);
  for (const token of [
    "F1-D-B8-A7-R5: OpenClaw host publisher integration design",
    "commit `7d5c895`",
    "readConfigFileSnapshotWithPluginMetadata",
    "no-plugin-metadata host-policy snapshot phase",
    "`prepared`, `committed`, `published`, and `aborted`",
    "OpenClaw fork/worktree=NOT CREATED",
    "OpenClaw source modification=NOT AUTHORIZED",
    "B8-A7 sustained runtime authorization=WITHHELD",
  ]) {
    assert.equal(devlog.includes(token), true, `missing R5 devlog token: ${token}`);
  }
});
