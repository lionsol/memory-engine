import test from "node:test";
import assert from "node:assert/strict";

import {
  categoryBoost,
  confidenceBoost,
  computeRecencyBoost,
  externalBoost,
  fuseChannels,
  scoreCandidate,
} from "../lib/recall/hybrid/fusion.js";

test("categoryBoost keeps known and fallback semantics", () => {
  assert.equal(categoryBoost({ category: "episodic", confidence_mode: "managed" }, {}), 0.12);
  assert.equal(categoryBoost({ category: "unknown", confidence_mode: "managed" }, {}), 0);
  assert.equal(categoryBoost({ category: "project", confidence_mode: "external" }, {
    categoryBoost: { external: { project: 0.09, external: 0.03 } },
  }), 0.09);
  assert.equal(categoryBoost({ category: "missing", confidence_mode: "external" }, {
    categoryBoost: { external: { external: 0.04 } },
  }), 0.04);
});

test("confidenceBoost keeps managed and invalid-confidence behavior", () => {
  assert.equal(confidenceBoost({ confidence_mode: "managed", confidence: 0.82 }, {}), 0.082);
  assert.equal(confidenceBoost({ confidence_mode: "managed", confidence: "bad" }, {}), 0);
  assert.equal(confidenceBoost({ confidence_mode: "external", confidence: 0.82 }, {}), 0);
});

test("externalBoost keeps external-only semantics", () => {
  assert.equal(externalBoost({ confidence_mode: "external", category: "project" }, {}), 0.05);
  assert.equal(externalBoost({ confidence_mode: "external", category: "stats" }, {}), 0);
  assert.equal(externalBoost({ confidence_mode: "managed", category: "project" }, {}), 0);
});

test("computeRecencyBoost decays and handles invalid timestamps", () => {
  const nowSec = 1710000000;
  const recent = computeRecencyBoost(nowSec - 3600, nowSec, {});
  const old = computeRecencyBoost(nowSec - (86400 * 10), nowSec, {});
  assert.equal(recent > old, true);
  assert.equal(recent > 0, true);
  assert.equal(computeRecencyBoost(null, nowSec, {}), 0);
  assert.equal(computeRecencyBoost("bad", nowSec, {}), 0);
});

test("scoreCandidate keeps additive formula and rounding", () => {
  const score = scoreCandidate({
    semanticScore: 0.55555,
    rrfScore: 0.11111,
    categoryBoost: 0.12,
    recencyBoost: 0.06444,
    confidenceBoost: 0.08222,
    externalBoost: 0.05,
  });
  assert.equal(score, 0.9833);
});

test("fuseChannels merges duplicate ids, accumulates RRF, and deduplicates sources", () => {
  const { names, fused } = fuseChannels({
    kg: [{
      id: "a",
      text: "checkpoint text",
      category: "episodic",
      confidence_mode: "managed",
      source_type: "memory-engine-managed",
      semantic_score: 0.7,
      similarity: 0.7,
      confidence: 0.9,
      hit_count: 2,
      created_at: 1710000000,
      path: "memory/episodes/session-checkpoint.md",
      token_coverage: 1,
      exact_bonus: 0.12,
      structured_match_bonus: 0.2,
      lexical_signal_score: 0.7,
    }],
    fts: [{
      id: "a",
      text: "checkpoint text",
      category: "episodic",
      confidence_mode: "managed",
      source_type: "memory-engine-managed",
      semantic_score: 0.5,
      similarity: 0.5,
      confidence: 0.9,
      hit_count: 2,
      created_at: 1710000000,
      path: "memory/episodes/session-checkpoint.md",
      token_coverage: 0.6,
      exact_bonus: 0,
      structured_match_bonus: 0.1,
      lexical_signal_score: 0.5,
    }],
  }, {
    rrfK: 60,
    nowSec: 1710003600,
    rankingConfig: {},
  });

  assert.deepEqual(names, ["kg", "fts"]);
  assert.equal(fused.length, 1);
  assert.equal(fused[0].semanticScore, 0.7);
  assert.equal(fused[0].rrfScore, 0.0328);
  assert.deepEqual(fused[0].channels, ["kg", "fts"]);
  assert.deepEqual(fused[0].semantic_sources, ["episodic", "session_checkpoint"]);
  assert.deepEqual(fused[0].sources, ["kg", "fts", "episodic", "session_checkpoint"]);
});

test("fuseChannels keeps stable topK ranking fixture across mixed candidates", () => {
  const { fused } = fuseChannels({
    kg: [{
      id: "hybrid",
      text: "session checkpoint project note",
      category: "episodic",
      confidence_mode: "managed",
      source_type: "memory-engine-managed",
      semantic_score: 0.62,
      similarity: 0.62,
      confidence: 0.9,
      hit_count: 3,
      created_at: 1710000000,
      path: "memory/episodes/session-checkpoint.md",
    }],
    fts: [{
      id: "hybrid",
      text: "session checkpoint project note",
      category: "episodic",
      confidence_mode: "managed",
      source_type: "memory-engine-managed",
      semantic_score: 0.5,
      similarity: 0.5,
      confidence: 0.9,
      hit_count: 3,
      created_at: 1710000000,
      path: "memory/episodes/session-checkpoint.md",
    }],
    vector: [{
      id: "vector-only",
      text: "vector memory",
      category: "raw_log",
      confidence_mode: "managed",
      source_type: "memory-engine-managed",
      semantic_score: 0.83,
      similarity: 0.83,
      confidence: 0.65,
      hit_count: 1,
      created_at: 1709999000,
      path: "memory/smart-add/2026-06-18.md",
    }],
    like: [{
      id: "external-1",
      text: "external design doc",
      category: "project",
      confidence_mode: "external",
      source_type: "openclaw-core",
      external_badge: true,
      semantic_score: 0.35,
      similarity: 0.35,
      confidence: null,
      hit_count: 0,
      created_at: 1709990000,
      path: "docs/project/design.md",
    }],
  }, {
    rrfK: 60,
    nowSec: 1710003600,
    rankingConfig: {
      categoryBoost: { external: { project: 0.06, external: 0.03 } },
    },
  });

  const topIds = [...fused].sort((a, b) => b.finalScore - a.finalScore).slice(0, 3).map(item => item.id);
  assert.deepEqual(topIds, ["vector-only", "hybrid", "external-1"]);
});
