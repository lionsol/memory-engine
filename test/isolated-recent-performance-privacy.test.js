import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MAX_PUBLIC_REPORT_BYTES,
  buildRecentPerformancePublicReport,
  validateRecentPerformancePublicReport,
  writeRecentPerformanceReport,
} from "../lib/recall/hybrid/recent-performance-probe.js";

const SECRETS = {
  id: "SECRET-RAW-ID-DO-NOT-LEAK-001",
  chunk_id: "SECRET-ENGINE-ID-DO-NOT-LEAK-002",
  text: "SECRET CHUNK BODY DO NOT LEAK",
  path: "memory/smart-add/SECRET-PATH-DO-NOT-LEAK.md",
  updated_at: "SECRET-TIMESTAMP-DO-NOT-LEAK",
  query: "SECRET QUERY DO NOT LEAK",
  archived_id: "SECRET-ARCHIVED-ID-DO-NOT-LEAK",
  kg_data: "SECRET-KG-DATA-DO-NOT-LEAK",
  category: "SECRET-CATEGORY-DO-NOT-LEAK",
};

function makeInternalResult() {
  return {
    sqlite_version: "3.49.2",
    better_sqlite3_version: "11.10.0",
    existingSnapshotInventory: {
      core_fields: ["id", "path", "updated_at"],
      engine_fields: ["chunk_id", "confidence", "last_confidence_update", "base_tau", "hit_count", "is_protected", "conflict_flag", "category", "is_archived"],
      engine_snapshot_contains_is_archived: true,
      engine_snapshot_contains_full_recent_metadata: true,
      could_reuse_snapshot_without_extra_engine_query: true,
    },
    fixtures: {
      small_semantic_fixture: { type: "small_semantic_fixture", core_row_count: 1, confidence_row_count: 1 },
      production_shaped_fixture: { type: "production_shaped_fixture", core_row_count: 1, active_row_count: 1, archived_row_count: 0, archived_ratio: 0, episode_row_count: 0, smart_add_row_count: 1, archived_json_bytes: 2, tie_group_size: 1, distinct_timestamp_count: 1, id_length: 64 },
    },
    semanticSmall: {
      queries: [{
        query_id: "1234567890abcdef",
        source_type: "synthetic",
        query_length: 12,
        line_count: 1,
        term_count: 2,
      }],
      strategies: {
        strategy_b_not_in: { branch_equivalent: { like_fallback: true, recent_scored: true, recent_fallback: true, episode_projection: true }, scenarios: [] },
      },
    },
    limitResults: { 20: { strategy_b_not_in: true } },
    batchResults: { 256: true },
    performance: {
      production_shaped: {
        strategy_b_not_in: {
          branches: {
            recent_scored: {
              metrics: {
                repetitions: 5,
                warmup_count: 2,
                median_ms: 12,
                p95_ms: 15,
                min_ms: 10,
                max_ms: 16,
                core_query_count: 1,
                engine_query_count: 2,
                metadata_query_count: 1,
                rows_read_from_core: 10,
                ids_transferred_to_engine: 10,
                json_payload_total_bytes: 10,
                json_payload_max_bytes: 10,
                active_yield_ratio: 1,
              },
              plan: { lines: ["LIST SUBQUERY"], tokens: ["list_subquery"] },
            },
          },
        },
      },
    },
    plans: {
      strategy_b_not_in: { lines: ["LIST SUBQUERY"], tokens: ["list_subquery"] },
    },
    nullPayloadCase: {
      strategy_b_empty_payload_equivalent: true,
      payload_contains_null: false,
    },
    missingConfidenceCase: {
      strategy_b: true,
    },
    rawFixtureSecrets: { ...SECRETS },
  };
}

test("public report strips internal secrets and validates", () => {
  const internalResult = makeInternalResult();
  assert.equal(Object.values(internalResult.rawFixtureSecrets).every(value => String(value).includes("SECRET")), true);

  const report = buildRecentPerformancePublicReport(internalResult);
  const validation = validateRecentPerformancePublicReport(report, {
    sensitiveValues: Object.values(SECRETS),
  });
  const serialized = JSON.stringify(report);

  assert.equal(validation.passed, true);
  assert.equal(validation.forbidden_key_count, 0);
  assert.equal(validation.raw_value_leak_count, 0);
  assert.equal(validation.invalid_hash_count, 0);

  for (const secret of Object.values(SECRETS)) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});

test("privacy validator fails on forbidden keys, leaked values, and invalid hashes", () => {
  const report = {
    ok: true,
    id_hash: "not-a-hash",
    rows: [{ benign: true }],
    nested: {
      marker: "SECRET QUERY DO NOT LEAK",
    },
  };
  const validation = validateRecentPerformancePublicReport(report, {
    sensitiveValues: [SECRETS.query],
  });

  assert.equal(validation.passed, false);
  assert.equal(validation.forbidden_key_count > 0, true);
  assert.equal(validation.raw_value_leak_count > 0, true);
  assert.equal(validation.invalid_hash_count > 0, true);
});

test("safe report writes without leaks and remains under size cap", () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-recent-perf-privacy-"));
  try {
    const report = buildRecentPerformancePublicReport(makeInternalResult());
    report.privacy_validation = validateRecentPerformancePublicReport(report, {
      sensitiveValues: Object.values(SECRETS),
    });
    const output = JSON.stringify(report, null, 2);
    const outPath = join(root, "safe-report.json");
    writeRecentPerformanceReport(output, outPath);
    assert.equal(existsSync(outPath), true);
    const written = readFileSync(outPath, "utf8");
    for (const secret of Object.values(SECRETS)) {
      assert.equal(written.includes(secret), false, secret);
    }
    assert.equal(Buffer.byteLength(written, "utf8") < MAX_PUBLIC_REPORT_BYTES, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
