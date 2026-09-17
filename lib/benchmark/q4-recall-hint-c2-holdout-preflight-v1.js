import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import Database from "better-sqlite3";

import { hybridSearch } from "../recall/hybrid-search.js";
import { createBenchmarkHybridRuntime } from "./longmemeval-retrieval-runner-v1.js";
import { buildQ4RecallHintC2FreshHoldoutCorpusV1 } from "./q4-recall-hint-c2-holdout-corpus-v1.js";
import {
  Q4_RECALL_HINT_C2_HOLDOUT_CASES_PER_FAMILY,
  Q4_RECALL_HINT_C2_HOLDOUT_FAMILIES,
  assertQ4RecallHintC2HoldoutFrozenIdentityV1,
  flattenQ4RecallHintC2HoldoutMemoryRecordsV1,
  validateQ4RecallHintC2HoldoutCorpusV1,
} from "./q4-recall-hint-c2-holdout-manifest-v1.js";
import {
  Q4_RECALL_HINT_MAX_POOL_DEPTH,
  Q4_RECALL_HINT_TOP_K,
} from "./q4-recall-hint-evaluation-v1.js";

export const Q4_RECALL_HINT_C2_HOLDOUT_PREFLIGHT_SCHEMA = "memory_engine_q4_recall_hint_c2_holdout_preflight_v1";
export const Q4_RECALL_HINT_C2_HOLDOUT_PREFLIGHT_PROFILE = "q4_c2_zero_provider_lexical_control_v1";
export const Q4_RECALL_HINT_C2_HOLDOUT_BENCHMARK_NOW_SEC = 1_800_000_000;

const TARGET_FAMILIES = Object.freeze(["entity_reference", "multi_facet"]);

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function createCoreSchema(db) {
  db.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      source TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      hash TEXT,
      model TEXT,
      text TEXT NOT NULL,
      embedding TEXT,
      updated_at INTEGER
    );
    CREATE VIRTUAL TABLE chunks_fts USING fts5(
      text,
      id UNINDEXED,
      path UNINDEXED,
      source UNINDEXED,
      model UNINDEXED,
      start_line UNINDEXED,
      end_line UNINDEXED
    );
  `);
}

function createEngineSchema(db) {
  db.exec(`
    CREATE TABLE memory_confidence (
      chunk_id TEXT PRIMARY KEY,
      initial_confidence REAL NOT NULL,
      confidence REAL NOT NULL,
      last_confidence_update INTEGER,
      base_tau REAL NOT NULL,
      hit_count INTEGER NOT NULL,
      is_archived INTEGER NOT NULL,
      is_protected INTEGER NOT NULL,
      conflict_flag INTEGER NOT NULL,
      category TEXT NOT NULL,
      kg_data TEXT
    );
  `);
}

export function materializeQ4RecallHintC2HoldoutCorpusV1(corpus) {
  const normalized = validateQ4RecallHintC2HoldoutCorpusV1(corpus);
  assertQ4RecallHintC2HoldoutFrozenIdentityV1(corpus);
  const root = mkdtempSync(join(tmpdir(), "memory-engine-q4-c2-holdout-"));
  const corePath = join(root, "core.sqlite");
  const enginePath = join(root, "engine.sqlite");
  const core = new Database(corePath);
  const engine = new Database(enginePath);
  try {
    createCoreSchema(core);
    createEngineSchema(engine);
    const insertChunk = core.prepare(`
      INSERT INTO chunks (
        id, path, source, start_line, end_line, hash, model, text, embedding, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = core.prepare(`
      INSERT INTO chunks_fts (text, id, path, source, model, start_line, end_line)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertConfidence = engine.prepare(`
      INSERT INTO memory_confidence (
        chunk_id, initial_confidence, confidence, last_confidence_update,
        base_tau, hit_count, is_archived, is_protected, conflict_flag, category, kg_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const records = flattenQ4RecallHintC2HoldoutMemoryRecordsV1(normalized);
    const insertAll = core.transaction(() => {
      for (const [index, row] of records.entries()) {
        const path = `benchmark/q4-c2/${String(index).padStart(4, "0")}-${row.id}.md`;
        const hash = sha256(row.text);
        insertChunk.run(
          row.id,
          path,
          "benchmark_q4_recall_hint_c2",
          1,
          1,
          hash,
          "q4-c2-synthetic-v1",
          row.text,
          null,
          Q4_RECALL_HINT_C2_HOLDOUT_BENCHMARK_NOW_SEC,
        );
        insertFts.run(
          row.text,
          row.id,
          path,
          "benchmark_q4_recall_hint_c2",
          "q4-c2-synthetic-v1",
          1,
          1,
        );
      }
    });
    const insertAllConfidence = engine.transaction(() => {
      for (const row of records) {
        insertConfidence.run(row.id, 1, 1, null, 365, 0, 0, 0, 0, "episodic", null);
      }
    });
    insertAll();
    insertAllConfidence();
  } finally {
    core.close();
    engine.close();
  }
  return {
    root,
    corePath,
    enginePath,
    record_count: normalized.cases.reduce((sum, row) => sum + row.memory_records.length, 0),
  };
}

function resultId(result) {
  const value = result?.memory_id ?? result?.id ?? null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uniqueIds(results) {
  const seen = new Set();
  const ids = [];
  for (const result of Array.isArray(results) ? results : []) {
    const id = resultId(result);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function scoreCase(record, candidatePoolIds, rankedTop3Ids, latencyMs) {
  const gold = new Set(record.gold_evidence_ids);
  const poolObserved = new Set(candidatePoolIds.filter(id => gold.has(id)));
  const top3Observed = new Set(rankedTop3Ids.filter(id => gold.has(id)));
  return {
    case_id: record.case_id,
    split: "acceptance",
    family: record.family,
    gold_evidence_count: gold.size,
    candidate_pool_ids: candidatePoolIds,
    ranked_top3_ids: rankedTop3Ids,
    pool_evidence_coverage: poolObserved.size / gold.size,
    pool_miss: poolObserved.size !== gold.size,
    recall_any_at_3: Number(top3Observed.size > 0),
    recall_all_at_3: Number(top3Observed.size === gold.size),
    latency_ms: latencyMs,
  };
}

function summarize(rows, selector) {
  const selected = rows.filter(selector);
  if (selected.length === 0) return null;
  const mean = fn => selected.reduce((sum, row) => sum + fn(row), 0) / selected.length;
  return {
    case_count: selected.length,
    pool_miss_count: selected.filter(row => row.pool_miss).length,
    pool_evidence_coverage: mean(row => row.pool_evidence_coverage),
    recall_any_at_3: mean(row => row.recall_any_at_3),
    recall_all_at_3: mean(row => row.recall_all_at_3),
  };
}

function evaluateEligibility(rows) {
  const reasons = [];
  const protection = rows.filter(row => row.family === "protection");
  if (protection.length !== Q4_RECALL_HINT_C2_HOLDOUT_CASES_PER_FAMILY) {
    reasons.push("holdout_protection_count_invalid");
  }
  if (protection.some(row => row.pool_evidence_coverage !== 1)) {
    reasons.push("holdout_protection_pool_not_complete");
  }
  if (protection.some(row => row.recall_all_at_3 !== 1)) {
    reasons.push("holdout_protection_top3_not_complete");
  }
  for (const family of TARGET_FAMILIES) {
    const familyRows = rows.filter(row => row.family === family);
    if (familyRows.length !== Q4_RECALL_HINT_C2_HOLDOUT_CASES_PER_FAMILY) {
      reasons.push(`holdout_target_count_invalid:${family}`);
    }
    if (!familyRows.some(row => row.pool_miss)) {
      reasons.push(`holdout_target_has_no_pool_miss:${family}`);
    }
  }
  return {
    status: reasons.length === 0 ? "PASS" : "STOP",
    reasons,
  };
}

export async function runQ4RecallHintC2HoldoutPreflightV1({ keepTemp = false } = {}) {
  const corpus = buildQ4RecallHintC2FreshHoldoutCorpusV1();
  const normalized = validateQ4RecallHintC2HoldoutCorpusV1(corpus);
  const manifest = assertQ4RecallHintC2HoldoutFrozenIdentityV1(corpus);
  const materialized = materializeQ4RecallHintC2HoldoutCorpusV1(corpus);
  let runtime = null;
  try {
    runtime = createBenchmarkHybridRuntime(materialized, {
      topK: Q4_RECALL_HINT_MAX_POOL_DEPTH,
      topKPolicyMax: Q4_RECALL_HINT_MAX_POOL_DEPTH,
      lexicalConfidenceThreshold: 0,
      channelCapabilities: { isolatedKg: false, isolatedRecent: false },
      searchNowSec: Q4_RECALL_HINT_C2_HOLDOUT_BENCHMARK_NOW_SEC,
    });
    const rows = [];
    for (const record of normalized.cases) {
      const started = performance.now();
      const search = await hybridSearch(
        record.query,
        { topK: Q4_RECALL_HINT_MAX_POOL_DEPTH },
        runtime.runtime,
      );
      const latencyMs = performance.now() - started;
      const poolIds = uniqueIds(search?.results).slice(0, Q4_RECALL_HINT_MAX_POOL_DEPTH);
      const top3Ids = poolIds.slice(0, Q4_RECALL_HINT_TOP_K);
      rows.push(scoreCase(record, poolIds, top3Ids, latencyMs));
    }
    const families = Object.fromEntries(Q4_RECALL_HINT_C2_HOLDOUT_FAMILIES.map(family => [
      family,
      summarize(rows, row => row.family === family),
    ]));
    return {
      schema: Q4_RECALL_HINT_C2_HOLDOUT_PREFLIGHT_SCHEMA,
      profile: Q4_RECALL_HINT_C2_HOLDOUT_PREFLIGHT_PROFILE,
      evidence_class: "ZERO_PROVIDER_LEXICAL_CONTROL_PREFLIGHT_ONLY",
      quality_claim_authorized: false,
      manifest_sha256: manifest.manifest_sha256,
      corpus_sha256: manifest.corpus_identity.corpus_sha256,
      holdout_sha256: manifest.holdout_sha256,
      case_count: normalized.cases.length,
      candidate_depth: Q4_RECALL_HINT_MAX_POOL_DEPTH,
      top_k: Q4_RECALL_HINT_TOP_K,
      provider_calls: 0,
      vector_provider_calls: 0,
      rerank_provider_calls: 0,
      rows,
      holdout: summarize(rows, () => true),
      families,
      eligibility: evaluateEligibility(rows),
    };
  } finally {
    runtime?.close();
    if (!keepTemp) rmSync(materialized.root, { recursive: true, force: true });
  }
}
