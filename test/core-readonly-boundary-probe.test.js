import test from "node:test";
import assert from "node:assert/strict";
import probe from "../bin/probe-core-readonly-boundary.js";

const { runProbe } = probe;

const writeNames = ["update", "cte_update", "insert", "delete", "write_pragma"];

function evidenceByName(result, name) {
  return result.evidence.filter((item) => item.name === name);
}

test("URI readonly ATTACH is classified by actual attach and write outcomes", () => {
  const result = runProbe().uri_readonly_attach;
  const variants = result.evidence.filter((item) => item.variant);
  assert.equal(variants.length >= 4, true);
  assert.equal(result.supported, variants.some((variant) => variant.supported));
  assert.equal(result.core_writes_blocked_by_sqlite, result.supported);
  for (const variant of variants) {
    assert.ok(variant.attach_status);
    assert.ok(variant.read_status);
    for (const name of writeNames) {
      const item = variant.write_results.find((write) => write.name === name);
      assert.ok(item, `missing URI probe evidence for ${variant.variant}/${name}`);
      assert.ok(item.status);
    }
    assert.equal(variant.supported, variant.attach_status === "succeeded"
      && variant.read_status === "succeeded"
      && variant.write_results.every((item) => item.status === "sqlite_readonly_error"));
  }
});

test("readonly Core main reports capability from legal Engine control and transaction evidence", () => {
  const result = runProbe().readonly_core_main_with_writable_engine_attach;
  assert.equal(result.core_writes_blocked_by_sqlite, true);
  assert.equal(result.cross_db_reads_succeeded, true);
  for (const name of writeNames) {
    assert.equal(evidenceByName(result, name)[0]?.status, "sqlite_readonly_error", name);
  }
  assert.equal(evidenceByName(result, "engine_fixture_write_control")[0]?.status, "succeeded");
  const engineWrite = evidenceByName(result, "engine_writes")[0];
  const transaction = evidenceByName(result, "engine_transaction")[0];
  assert.ok(["sqlite_readonly_error", "succeeded"].includes(engineWrite?.status));
  assert.ok(["sqlite_readonly_error", "succeeded"].includes(transaction?.status));
  assert.equal(result.supported, engineWrite.status === "succeeded" && transaction.status === "succeeded");
  const persistence = evidenceByName(result, "persistence")[0];
  assert.equal(persistence.persisted.coreText, "original");
  if (transaction.status === "succeeded") {
    assert.equal(persistence.status, "succeeded");
    assert.equal(persistence.persisted.confidence, 0.9);
    assert.equal(persistence.persisted.probeItems.includes("transaction"), true);
  } else {
    assert.equal(transaction.status, "sqlite_readonly_error");
    assert.equal(persistence.persisted.confidence, 0.5);
    assert.equal(persistence.persisted.probeItems.includes("transaction"), false);
  }
  assert.equal(evidenceByName(result, "busy_timeout")[0]?.status, "succeeded");
});

test("probe reports versions and a static migration impact inventory", () => {
  const result = runProbe();
  assert.match(result.versions.better_sqlite3, /^\d+\.\d+\.\d+/);
  assert.match(result.versions.sqlite, /^\d+\.\d+\.\d+/);
  assert.equal(typeof result.versions.sqlite_use_uri_compile_option, "boolean");
  assert.equal(result.migration_impact.some((item) => item.file === "lib/db/engine-db.js"), true);
  assert.equal(result.migration_impact.some((item) => item.file === "lib/checkpoint/db.js"), true);
  assert.equal(result.migration_impact.some((item) => item.file === "bin/memory-engine-cli.js"), true);
  assert.equal(result.migration_impact.some((item) => item.file === "bin/nightly-maintenance-command.cjs"), true);
});
