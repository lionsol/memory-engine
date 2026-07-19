import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const cli = require(resolve(new URL("..", import.meta.url).pathname, "bin/audit-production-evidence-identity.js"));

function row(surface, overrides = {}) {
  return {
    event_type: "hybrid_search_observation",
    source: `hybrid.${surface}`,
    session_id: surface === "auto_recall" ? "session-1" : null,
    trace_id: `trace-${surface}`,
    metadata_json: {
      schema_version: 1,
      surface,
      search_executed: true,
      completed_at: "2026-07-18T00:00:00.000Z",
      production_evidence_enabled: true,
      evidence_epoch_id: "epoch-1",
      runtime_build_identity: "a".repeat(64),
      rollout_config_fingerprint: "b".repeat(64),
      ...overrides,
    },
  };
}

function writeFixture(extension, value) {
  const root = mkdtempSync(resolve(tmpdir(), "production-evidence-identity-cli-"));
  const path = resolve(root, `observations${extension}`);
  writeFileSync(path, value);
  return path;
}

test("CLI accepts JSON and JSONL and returns identity exit codes", async () => {
  const rows = [row("auto_recall"), row("memory_engine_search"), row("memory_engine_action_search")];
  const json = await cli.auditProductionEvidenceIdentity(["--observations", writeFixture(".json", JSON.stringify(rows)), "--pretty"]);
  assert.equal(json.exitCode, 0);
  assert.equal(json.report.status, "identity_ready");
  assert.match(json.output, /\n  \"status\":/);

  const mixed = await cli.auditProductionEvidenceIdentity(["--observations", writeFixture(".jsonl", rows.map(value => JSON.stringify(value)).join("\n"))]);
  assert.equal(mixed.exitCode, 0);
});

test("CLI distinguishes invalid input from blocked reports", async () => {
  const blocked = await cli.auditProductionEvidenceIdentity([
    "--observations",
    writeFixture(".json", JSON.stringify([row("auto_recall", { production_evidence_enabled: false })])),
  ]);
  assert.equal(blocked.exitCode, 2);
  await assert.rejects(() => cli.auditProductionEvidenceIdentity([]), /--observations is required/);
  await assert.rejects(
    () => cli.auditProductionEvidenceIdentity(["--observations", writeFixture(".json", "invalid")]),
    /failed to parse observations/,
  );
  assert.equal(cli.exitCodeForStatus("identity_ready"), 0);
  assert.equal(cli.exitCodeForStatus("identity_incomplete"), 1);
  assert.equal(cli.exitCodeForStatus("identity_mixed"), 2);
  assert.equal(cli.exitCodeForStatus("blocked"), 2);
});
