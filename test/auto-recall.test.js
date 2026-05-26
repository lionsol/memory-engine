import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldForceAutoRecall,
  shouldSkipAutoRecall,
  buildFtsFallbackQuery,
  buildLikeFallbackPatterns,
  formatAutoRecallContext,
  normalizeFtsQuery,
  parseCitedMemoryIds,
  rankFtsFallbackCandidates,
  sanitizeFtsQuery,
  shouldInjectCandidate,
  stripPromptMetadataPrefix,
} from "../auto-recall.js";

test("skips slash commands", () => {
  assert.equal(shouldSkipAutoRecall("/help"), true);
  assert.equal(shouldForceAutoRecall("/memory previous"), false);
});

test("skips greetings and acknowledgements", () => {
  assert.equal(shouldSkipAutoRecall("hello"), true);
  assert.equal(shouldSkipAutoRecall("ok"), true);
  assert.equal(shouldSkipAutoRecall("continue"), true);
});

test("forces recall for memory trigger phrases", () => {
  assert.equal(shouldForceAutoRecall("do you remember my last preference"), true);
  assert.equal(shouldSkipAutoRecall("previous"), false);
  assert.equal(shouldForceAutoRecall("recall my preference"), true);
});

test("does not skip substantive short prompt", () => {
  assert.equal(shouldSkipAutoRecall("fix startup dependency issue"), false);
});

test("keeps Chinese terms in FTS query sanitization", () => {
  const query = sanitizeFtsQuery("记忆：Win11 升级 + OpenClaw?");
  assert.equal(query, "记忆 Win11 升级 OpenClaw");
});

test("normalizes mixed zh/en tokenizer-sensitive query", () => {
  const query = normalizeFtsQuery("5.20+ 和 memory-engine 兼容性");
  assert.equal(query, "version_5_20 和 memory engine 兼容性");
});

test("builds bounded fallback FTS OR query", () => {
  const query = buildFtsFallbackQuery("记忆引擎插件加载 hook 触发");
  assert.match(query, / OR /);
  assert.match(query, /hook/);
  assert.ok(query.split(" OR ").length <= 8);
});

test("mixed query fallback hits smart-add memory row", () => {
  const rawQuery = "5.20+ 和 memory-engine 兼容性";
  const normalized = normalizeFtsQuery(rawQuery);
  const ftsFallback = buildFtsFallbackQuery(rawQuery);
  const likePatterns = buildLikeFallbackPatterns(rawQuery);
  const sample = {
    path: "memory/smart-add/2026-05-26.md",
    text: "today smart-add: OpenClaw memory-engine 在 5.20+ 版本兼容性正常。",
  };
  const haystack = `${sample.path}\n${sample.text}`.toLowerCase();
  const tokenTerms = ftsFallback.split(" OR ").map(token => token.toLowerCase());
  const tokenHit = tokenTerms.some(token => haystack.includes(token));
  const likeHit = likePatterns.some(pattern => {
    const term = pattern.replace(/^%|%$/g, "");
    return term.length > 0 && haystack.includes(term.toLowerCase());
  });
  assert.equal(normalized, "version_5_20 和 memory engine 兼容性");
  assert.equal(tokenHit, true);
  assert.equal(likeHit, true);
});

test("strips OpenClaw prompt timestamp prefix before query normalization", () => {
  const original = "[Tue 2026-05-26 20:19 GMT+8] 5.20+ 和 memory-engine 兼容性";
  const stripped = stripPromptMetadataPrefix(original);
  assert.equal(stripped, "5.20+ 和 memory-engine 兼容性");
});

test("fallback FTS query excludes timestamp/date noise tokens", () => {
  const original = "[Tue 2026-05-26 20:19 GMT+8] 5.20+ 和 memory-engine 兼容性";
  const fts = buildFtsFallbackQuery(original).toLowerCase();
  assert.doesNotMatch(fts, /\btue\b/);
  assert.doesNotMatch(fts, /\bgmt\b/);
  assert.doesNotMatch(fts, /\b2026\b/);
  assert.doesNotMatch(fts, /\b05\b/);
  assert.doesNotMatch(fts, /\b26\b/);
  assert.doesNotMatch(fts, /\b20\b/);
  assert.doesNotMatch(fts, /\b19\b/);
});

test("fallback rerank drops zero-coverage candidates and keeps smart-add episodic", () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const rows = [
    {
      id: "old-generic",
      path: "memory/archive/2025-01-01.md",
      text: "memory engine tuning notes",
      category: "raw_log",
      updated_at: nowSec - 120 * 86400,
    },
    {
      id: "smart-add-episodic",
      path: "memory/smart-add/2026-05-26.md",
      text: "兼容性检查：5.20+ 与 memory-engine 可用",
      category: "episodic",
      updated_at: nowSec - 300,
    },
  ];
  const query = "5.20+ 和 memory-engine 兼容性";
  const ranked = rankFtsFallbackCandidates(rows, {
    rawQuery: query,
    queryTerms: buildFtsFallbackQuery(query).split(" OR ").map(token => token.toLowerCase()),
    nowSec,
    topK: 10,
  });

  assert.equal(ranked.ranked.length, 1);
  assert.equal(ranked.ranked[0].id, "smart-add-episodic");
});

test("autoRecall injection gate rejects old raw_log and keeps smart-add episodic for compatibility query", () => {
  const query = "5.20+ 和 memory-engine 兼容性";
  const oldRawLog = {
    id: "old-raw-log",
    path: "memory/archive/2025-05-10.md",
    text: "5月9-10号模型对比 raw_log：memory engine model benchmark",
    category: "raw_log",
    final_score: 0.62,
  };
  const smartAddEpisodic = {
    id: "smart-add-episodic",
    path: "memory/smart-add/2026-05-26.md",
    text: "兼容性检查：OpenClaw memory-engine 在 5.20+ 版本正常",
    category: "episodic",
    final_score: 0.11,
  };

  const oldGate = shouldInjectCandidate(oldRawLog, query, {});
  const episodicGate = shouldInjectCandidate(smartAddEpisodic, query, {});

  assert.equal(oldGate.inject, false);
  assert.equal(oldGate.reason, "insufficient_key_class_match");
  assert.deepEqual(oldGate.matched_key_classes, ["project"]);
  assert.equal(episodicGate.inject, true);
  assert.deepEqual(episodicGate.matched_key_classes.sort(), ["project", "semantic", "version"]);
});

test("autoRecall injection gate does not allow broad keywords alone", () => {
  const query = "memory engine model 模型";
  const candidate = {
    id: "broad-only",
    path: "memory/archive/generic.md",
    text: "memory engine model 模型 调参记录",
    category: "raw_log",
    final_score: 0.9,
  };
  const gate = shouldInjectCandidate(candidate, query, {});
  assert.equal(gate.inject, false);
  assert.equal(gate.reason, "no_informative_terms");
});

test("raw_log requires version plus project or semantic on compatibility query", () => {
  const query = "5.20+ 和 memory-engine 兼容性";
  const candidate = {
    id: "project-semantic-no-version",
    path: "memory/archive/compat-note.md",
    text: "OpenClaw memory-engine 兼容性说明：旧版存在限制",
    category: "raw_log",
    final_score: 0.88,
  };
  const gate = shouldInjectCandidate(candidate, query, {});
  assert.equal(gate.inject, false);
  assert.equal(gate.reason, "insufficient_key_class_match");
  assert.deepEqual(gate.matched_key_classes.sort(), ["project", "semantic"]);
});

test("compatibility query only injects strong candidates after gate", () => {
  const query = "5.20+ 和 memory-engine 兼容性";
  const candidates = [
    {
      id: "weak-openai-agent",
      path: "memory/archive/openai-agent.md",
      text: "OpenAI 代理实验记录",
      category: "raw_log",
      final_score: 0.92,
    },
    {
      id: "weak-model-switch",
      path: "memory/archive/model-switch.md",
      text: "模型切换方案：memory engine route",
      category: "raw_log",
      final_score: 0.91,
    },
    {
      id: "strong-compat",
      path: "memory/smart-add/2026-05-26.md",
      text: "兼容性结论：OpenClaw memory-engine 在 5.20+ 可用",
      category: "episodic",
      final_score: 0.12,
    },
  ];
  const gated = candidates.filter(candidate => shouldInjectCandidate(candidate, query, {}).inject);
  assert.equal(gated.length, 1);
  assert.equal(gated[0].id, "strong-compat");
});

test("parses cited memory ids from assistant metadata", () => {
  assert.deepEqual(parseCitedMemoryIds('ok\\ncited_memory_ids: ["abcdef1234567890", "bad"]'), ["abcdef1234567890"]);
});

test("formats top memory results as prepend context", () => {
  const text = formatAutoRecallContext([
    {
      id: "abcdef1234567890",
      category: "preference",
      confidence: 0.82,
      sources: ["vector", "fts"],
      text: "User prefers explicit opt-in features.",
    },
  ]);

  assert.match(text, /Auto Recall/);
  assert.match(text, /abcdef1234567890/);
  assert.match(text, /preference/);
  assert.match(text, /cited_memory_ids/);
});
