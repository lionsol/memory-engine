import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveCandidateSources,
  inferCategoryFromChunk,
  inferCategoryFromPath,
  isRetrievalExcludedPath,
  isCandidateAllowedForRerank,
  normalizeExternalMemory,
  normalizeUnixSeconds,
} from "../lib/recall/hybrid/normalize-candidate.js";

test("normalizeExternalMemory keeps managed candidate semantics", () => {
  const candidate = normalizeExternalMemory({
    id: "chunk-123",
    text: "Managed memory text",
    path: "memory/smart-add/2026-06-18.md",
    category: "raw_log",
    similarity: 0.833333,
    confidence: 0.82,
    confidence_realtime: 0.81444,
    hit_count: 3,
    is_protected: 0,
    conflict_flag: 1,
    is_archived: 0,
    updated_at: 1710000000,
  }, {
    nowSec: 1710000100,
    calcRealtimeConf: () => 0.5,
  });

  assert.equal(candidate.id, "chunk-123");
  assert.equal(candidate.text, "Managed memory text");
  assert.equal(candidate.path, "memory/smart-add/2026-06-18.md");
  assert.equal(candidate.category, "raw_log");
  assert.equal(candidate.confidence, 0.8144);
  assert.equal(candidate.source_type, "memory-engine-managed");
  assert.equal(candidate.confidence_mode, "managed");
  assert.equal(candidate.external_badge, false);
  assert.equal(candidate.decay_eligible, true);
  assert.equal(candidate.archive_eligible, true);
  assert.equal(candidate.created_at, 1710000000);
});

test("normalizeExternalMemory keeps external candidate semantics and rerank allowance", () => {
  const candidate = normalizeExternalMemory({
    id: "ext-1",
    text: "External notes about session checkpoint",
    path: "docs/session-checkpoint.md",
    similarity: 0.6,
    hit_count: 2,
    is_protected: 1,
    conflict_flag: 0,
    is_archived: 1,
    timestamp: 1710000000000,
  }, {
    nowSec: 1710000100,
  });

  assert.equal(candidate.source_type, "openclaw-core");
  assert.equal(candidate.confidence_mode, "external");
  assert.equal(candidate.confidence, null);
  assert.equal(candidate.external_badge, true);
  assert.equal(candidate.decay_eligible, false);
  assert.equal(candidate.archive_eligible, false);
  assert.equal(candidate.is_protected, 1);
  assert.equal(candidate.is_archived, 1);
  assert.equal(candidate.created_at, 1710000000);
  assert.equal(isCandidateAllowedForRerank(candidate, 0.95), true);
});

test("normalizeExternalMemory preserves protected and archived eligibility semantics for managed candidates", () => {
  const archived = normalizeExternalMemory({
    id: "managed-archived",
    text: "Archived managed memory",
    path: "memory/episodes/e1.md",
    confidence: 0.7,
    is_protected: 0,
    is_archived: 1,
  }, {
    nowSec: 1710000000,
    calcRealtimeConf: row => row.confidence,
  });
  const protectedCandidate = normalizeExternalMemory({
    id: "managed-protected",
    text: "Protected managed memory",
    path: "memory/episodes/e2.md",
    confidence: 0.7,
    is_protected: 1,
    is_archived: 0,
  }, {
    nowSec: 1710000000,
    calcRealtimeConf: row => row.confidence,
  });

  assert.equal(archived.decay_eligible, false);
  assert.equal(archived.archive_eligible, false);
  assert.equal(protectedCandidate.decay_eligible, false);
  assert.equal(protectedCandidate.archive_eligible, false);
  assert.equal(isCandidateAllowedForRerank(archived, 0.6), true);
  assert.equal(isCandidateAllowedForRerank(protectedCandidate, 0.6), true);
});

test("category inference keeps explicit, path, and fallback behavior", () => {
  const withExplicitCategory = normalizeExternalMemory({
    id: "explicit-cat",
    text: "Category: project",
    path: "docs/misc.md",
    category: "Preference",
  });
  const fromPath = normalizeExternalMemory({
    id: "path-cat",
    text: "No explicit category here",
    path: "memory/episodes/e1.md",
    confidence: 0.8,
  }, {
    nowSec: 1710000000,
    calcRealtimeConf: row => row.confidence,
  });
  const fallbackCategory = inferCategoryFromChunk("docs/other.md", "plain text", null, "external");

  assert.equal(withExplicitCategory.category, "preference");
  assert.equal(fromPath.category, "episodic");
  assert.equal(fallbackCategory, "external");
  assert.equal(inferCategoryFromPath("memory/smart-add/2026-06-18.md"), "raw_log");
  assert.equal(inferCategoryFromPath("memory/generated-smart-add/2026-06-18.md"), "generated");
});

test("normalizeUnixSeconds handles seconds, milliseconds, and invalid timestamps", () => {
  assert.equal(normalizeUnixSeconds(1710000000), 1710000000);
  assert.equal(normalizeUnixSeconds(1710000000123), 1710000000);
  assert.equal(normalizeUnixSeconds("1710000000123"), 1710000000);
  assert.equal(normalizeUnixSeconds(null), 0);
  assert.equal(normalizeUnixSeconds("invalid"), 0);
  assert.equal(normalizeUnixSeconds(-1), 0);
});

test("invalid candidates stay non-throwing and keep existing id/text handling", () => {
  assert.equal(normalizeExternalMemory({ text: "missing id" }), null);

  assert.equal(isRetrievalExcludedPath("memory/generated-smart-add/2026-06-18.md"), true);
  assert.equal(normalizeExternalMemory({
    id: "generated-1",
    text: "checkpoint generated text",
    path: "memory/generated-smart-add/2026-06-18.md",
    similarity: 0.9,
  }), null);

  const missingText = normalizeExternalMemory({
    id: "missing-text",
    path: "docs/other.md",
    similarity: 0.2,
  });
  assert.equal(missingText.text, "");
  assert.equal(missingText.id, "missing-text");
  assert.equal(isCandidateAllowedForRerank(null, 0.5), false);
  assert.equal(
    isCandidateAllowedForRerank({ id: "generated-2", path: "memory/generated-smart-add/2026-06-18.md", confidence_mode: "external" }, 0.5),
    false,
  );
  assert.equal(isCandidateAllowedForRerank({ id: "managed", confidence_mode: "managed", confidence: null }, 0.5), false);
});

test("deriveCandidateSources keeps source tagging rules", () => {
  assert.deepEqual(
    deriveCandidateSources({
      path: "memory/smart-add/2026-06-18.md",
      category: "episodic",
      text: "session checkpoint id: abc",
      confidence_mode: "external",
    }),
    ["smart-add", "episodic", "session_checkpoint", "external"]
  );
});
