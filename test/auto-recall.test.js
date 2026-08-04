import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  shouldForceAutoRecall,
  shouldSkipAutoRecall,
  buildFtsFallbackQuery,
  buildLikeFallbackPatterns,
  buildAutoRecallCardContext,
  formatAutoRecallCardContext,
  formatAutoRecallContext,
  extractFtsFallbackTerms,
  extractQueryTokens,
  normalizeFtsQuery,
  parseCitedMemoryIds,
  rankFtsFallbackCandidates,
  sanitizeFtsQuery,
  shouldInjectCandidate,
  shouldUseAutoRecallCardRuntime,
  stripPromptMetadataPrefix,
} from "../auto-recall.js";
import { analyzeAutoRecallIntent } from "../lib/recall/auto-recall-intent.js";

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

test("extracts ordered unique FTS-safe fallback terms without treating OR as a term", () => {
  const cases = [
    ["", []],
    ["alpha", ["alpha"]],
    ["alpha OR alpha OR 中文", ["alpha", "中文"]],
    ["version_5_20 OR mixed7 OR 结合", ["version_5_20", "mixed7", "结合"]],
    [Array.from({ length: 8 }, (_, index) => `term_${index}`).join(" OR "), Array.from({ length: 8 }, (_, index) => `term_${index}`)],
    ["one OR two OR three OR four OR five OR six OR seven OR eight OR nine", ["one", "two", "three", "four", "five", "six", "seven", "eight"]],
  ];

  for (const [query, expected] of cases) {
    assert.deepEqual(extractFtsFallbackTerms(query), expected, query);
    assert.deepEqual(extractFtsFallbackTerms(query), extractFtsFallbackTerms(query));
    assert.equal(extractFtsFallbackTerms(query).includes("OR"), false);
    assert.equal(extractFtsFallbackTerms(query).every(term => /^[\p{L}\p{N}_]+$/u.test(term)), true);
  }
  assert.deepEqual(extractFtsFallbackTerms("one OR two OR three", 2), ["one", "two"]);
});

test("bounded fallback preserves late identifier components and Chinese semantics", () => {
  const rawQuery = "请回顾我们之前记录的项目情况，并告诉我 H5SENTINEL-4F7A9C2D 对应的 version_5_20 build_id 关键词";
  const ftsQuery = buildFtsFallbackQuery(rawQuery);
  const terms = ftsQuery.split(" OR ").filter(Boolean);

  assert.ok(terms.includes("h5sentinel"));
  assert.ok(terms.includes("4f7a9c2d"));
  assert.ok(terms.includes("version_5_20"));
  assert.ok(terms.includes("build_id"));
  assert.equal(terms.length <= 8, true);
  assert.equal(terms.some(term => /[\p{Script=Han}]/u.test(term)), true);
  assert.equal(ftsQuery, buildFtsFallbackQuery(rawQuery));

  const compositeTerms = buildFtsFallbackQuery(
    "请回顾我们之前记录的项目情况，并保留 release-candidate-12345678 的组成部分",
  ).split(" OR ");
  assert.ok(compositeTerms.includes("release"));
  assert.ok(compositeTerms.includes("candidate"));
  assert.ok(compositeTerms.includes("12345678"));
});

test("H5-C3 bounded fallback samples high-information tokens across query positions", () => {
  const rawQuery = [
    "结合之前上下文，请保留中文语义",
    "hybrid_search release_2026 build_17 hash_a1b2c3 uuid_1234 api_v2 fts_8 vector_30",
    "后置唯一标识符 H5POST-7B9A3E1C 必须可检索",
  ].join(" ");
  const terms = buildFtsFallbackQuery(rawQuery).split(" OR ").filter(Boolean);

  assert.equal(terms.length, 8);
  assert.equal(new Set(terms).size, terms.length);
  assert.ok(terms.includes("h5post"));
  assert.ok(terms.includes("7b9a3e1c"));
  assert.ok(terms.some(term => /[\p{Script=Han}]/u.test(term)));
  assert.notDeepEqual(
    terms.slice(0, 7),
    ["hybrid_search", "release_2026", "build_17", "hash_a1b2c3", "uuid_1234", "api_v2", "fts_8"],
  );
  assert.equal(buildFtsFallbackQuery(rawQuery), buildFtsFallbackQuery(rawQuery));
});

test("bounded fallback has explicit maxTerms policy for high-information and Chinese terms", () => {
  const rawQuery = [
    "结合之前上下文",
    "hybrid_search release_2026 build_17 hash_a1b2c3 uuid_1234 api_v2 fts_8 vector_30",
    "H5POST-7B9A3E1C 后置标识符",
  ].join(" ");
  const expected = new Map([
    [1, ["hash_a1b2c3"]],
    [2, ["hash_a1b2c3", "结合"]],
    [4, ["hybrid_search", "uuid_1234", "7b9a3e1c", "结合"]],
    [8, ["hybrid_search", "build_17", "hash_a1b2c3", "uuid_1234", "fts_8", "h5post", "7b9a3e1c", "结合"]],
  ]);

  for (const limit of [1, 2, 4, 8]) {
    const terms = buildFtsFallbackQuery(rawQuery, limit).split(" OR ").filter(Boolean);
    assert.equal(terms.length, limit, `maxTerms=${limit}`);
    assert.deepEqual(terms, expected.get(limit), `maxTerms=${limit}`);
    if (limit >= 2) {
      assert.ok(terms.some(term => /[\p{Script=Han}]/u.test(term)), `Chinese slot: ${limit}`);
    }
    if (limit >= 4) assert.ok(terms.includes("7b9a3e1c"), `tail identifier: ${limit}`);
  }
});

test("bounded fallback covers head, exact middle, and tail high-information positions", () => {
  for (const position of [0, 4, 8]) {
    const highInformation = Array.from({ length: 9 }, (_, index) => `prefix_${index}7`);
    highInformation[position] = "H5POSITION9";
    const terms = buildFtsFallbackQuery(highInformation.join(" "), 4)
      .split(" OR ")
      .filter(Boolean);
    assert.equal(terms.length, 4, `position=${position}`);
    assert.ok(terms.includes("h5position9"), `position=${position}`);
  }
});

test("bounded fallback fills remaining slots by maximum index dispersion", () => {
  const cases = [
    [9, 4, [0, 2, 4, 8]],
    [10, 5, [0, 2, 4, 6, 9]],
    [16, 7, [0, 3, 5, 7, 9, 11, 15]],
    [20, 8, [0, 2, 4, 6, 9, 11, 14, 19]],
  ];

  for (const [size, quota, expected] of cases) {
    const source = Array.from({ length: size }, (_, index) => `fair_${index}7`);
    const query = source.join(" ");
    const terms = buildFtsFallbackQuery(query, quota).split(" OR ").filter(Boolean);
    const selected = terms.map(term => source.indexOf(term));
    const middle = Math.floor((size - 1) / 2);

    assert.deepEqual(selected, expected, `${size}/${quota}`);
    assert.equal(selected.length, quota, `${size}/${quota} count`);
    assert.ok(selected.includes(0), `${size}/${quota} head`);
    assert.ok(selected.includes(middle), `${size}/${quota} exact middle`);
    assert.ok(selected.includes(size - 1), `${size}/${quota} tail`);
    assert.ok(selected.some(index => index >= middle && index < size - 1), `${size}/${quota} post-middle coverage`);
    assert.notDeepEqual(selected, [0, 1, 2, 4, 9], `${size}/${quota} head cluster`);
    assert.deepEqual(
      terms,
      buildFtsFallbackQuery(query, quota).split(" OR ").filter(Boolean),
      `${size}/${quota} deterministic`,
    );
  }
});

test("bounded fallback combines compound caps with position-fair fill", () => {
  const headCompound = ["a1b2c3", "d4e5f6", "a7b8c9", "d0e1f2"];
  const tailCompound = ["taila1b2c3", "tailb4c5d6", "tailc7d8e9"];
  const rawQuery = `${headCompound.join("-")} middlemarker9 centerflag8 ${tailCompound.join("-")}`;
  const terms = buildFtsFallbackQuery(rawQuery, 6).split(" OR ").filter(Boolean);
  const selectedHead = terms.filter(term => headCompound.includes(term));
  const selectedTail = terms.filter(term => tailCompound.includes(term));

  assert.ok(selectedHead.length >= 1);
  assert.ok(selectedHead.length <= 2);
  assert.ok(selectedTail.length >= 1);
  assert.ok(selectedTail.length <= 2);
  assert.ok(terms.includes("middlemarker9"));
  assert.ok(terms.includes("centerflag8"));
  assert.ok(terms.length <= 6);
  assert.ok(terms.some(term => !headCompound.includes(term)));
  assert.deepEqual(terms, buildFtsFallbackQuery(rawQuery, 6).split(" OR ").filter(Boolean));
});

test("bounded fallback caps high-information components from one delimited compound", () => {
  const compoundComponents = ["a1b2c3", "d4e5f6", "a7b8c9", "d0e1f2", "b3c4d5", "e6f7a8"];
  const rawQuery = `${compoundComponents.join("-")} tailmarker9 中文语义`;
  const terms = buildFtsFallbackQuery(rawQuery, 8).split(" OR ").filter(Boolean);
  const selectedCompoundComponents = terms.filter(term => compoundComponents.includes(term));

  assert.ok(selectedCompoundComponents.length >= 1);
  assert.ok(selectedCompoundComponents.length <= 2);
  assert.ok(terms.includes("tailmarker9"));
  assert.ok(terms.some(term => /[\p{Script=Han}]/u.test(term)));
  assert.ok(terms.length <= 8);
  assert.deepEqual(terms, buildFtsFallbackQuery(rawQuery, 8).split(" OR ").filter(Boolean));
});

test("bounded fallback limits one long compound while covering multiple compounds", () => {
  const rawQuery = "alpha-beta-gamma-delta-12345678 release-candidate-87654321";
  const terms = buildFtsFallbackQuery(rawQuery, 8).split(" OR ").filter(Boolean);
  const firstCompound = terms.filter(term => ["alpha", "beta", "gamma", "delta", "12345678"].includes(term));
  const secondCompound = terms.filter(term => ["release", "candidate", "87654321"].includes(term));

  assert.equal(terms.length, 6);
  assert.ok(firstCompound.length >= 2);
  assert.ok(firstCompound.length <= 3);
  assert.equal(secondCompound.length, 3);
  assert.deepEqual(terms, buildFtsFallbackQuery(rawQuery, 8).split(" OR ").filter(Boolean));
});

test("bounded fallback remains FTS5-safe and matches a tail-only identifier", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE VIRTUAL TABLE memories USING fts5(id UNINDEXED, text)");
    db.prepare("INSERT INTO memories (id, text) VALUES (?, ?)").run(
      "broad",
      "memory engine session hybrid_search release_2026 build_17 hash_a1b2c3 uuid_1234 api_v2 fts_8 vector_30",
    );
    db.prepare("INSERT INTO memories (id, text) VALUES (?, ?)").run(
      "target",
      "H5POST-7B9A3E1C",
    );

    const rawQuery = "结合之前上下文 hybrid_search release_2026 build_17 hash_a1b2c3 uuid_1234 api_v2 fts_8 vector_30 H5POST-7B9A3E1C";
    const ftsQuery = buildFtsFallbackQuery(rawQuery, 8);
    assert.doesNotThrow(() => db.prepare("SELECT id FROM memories WHERE memories MATCH ?").all(ftsQuery));
    assert.ok(ftsQuery.split(" OR ").every(term => /^[\p{L}\p{N}_]+$/u.test(term)));
    const ids = db.prepare("SELECT id FROM memories WHERE memories MATCH ?").all(ftsQuery).map(row => row.id);
    assert.ok(ids.includes("target"));
  } finally {
    db.close();
  }
});

test("canary-shaped focused query keeps the tail identifier without Gateway", () => {
  const prompt = [
    "结合项目历史，请定位 hybrid_search release_2026 build_17 hash_a1b2c3 uuid_1234 api_v2 fts_8 vector_30 与 H5POST-7B9A3E1C。",
    "需要检查 memory_search memory_engine_search memory_engine_get cited_memory_ids current_turn_memory_engine_get_ids，并保留中文语义。",
    "请给出 citation 字段。",
    ...Array.from({ length: 36 }, (_, index) => `历史上下文补充行 ${index}，只用于触发 focused-query 路径。`),
  ].join("\n");
  const intent = analyzeAutoRecallIntent(prompt);
  const searchPrompt = intent.long_input_detected && intent.should_recall
    ? intent.focused_query
    : prompt;
  const terms = buildFtsFallbackQuery(searchPrompt, 8).split(" OR ").filter(Boolean);

  assert.equal(intent.long_input_detected, true);
  assert.equal(intent.should_recall, true);
  assert.equal(searchPrompt, intent.focused_query);
  assert.match(searchPrompt, /H5POST-7B9A3E1C/u);
  assert.ok(terms.includes("h5post") || terms.includes("7b9a3e1c"));
  assert.match(searchPrompt, /H5POST-7B9A3E1C[\s\S]*memory_search[\s\S]*current_turn_memory_engine_get_ids/u);

  const toolTerms = [
    "memory_search",
    "memory_engine_search",
    "memory_engine_get",
    "cited_memory_ids",
    "current_turn_memory_engine_get_ids",
    "citation",
  ];
  const selectedToolTerms = toolTerms.filter(term => terms.includes(term));
  assert.ok(selectedToolTerms.length <= 2);
  assert.ok(terms.some(term => /[\p{Script=Han}]/u.test(term)));
  assert.ok(terms.length <= 8);
  assert.equal(buildFtsFallbackQuery(searchPrompt, 8), buildFtsFallbackQuery(searchPrompt, 8));

  const db = new Database(":memory:");
  try {
    db.exec("CREATE VIRTUAL TABLE memories USING fts5(id UNINDEXED, text)");
    db.prepare("INSERT INTO memories (id, text) VALUES (?, ?)").run(
      "broad",
      "memory engine memory_search memory_engine_get current_turn_memory_engine_get_ids",
    );
    db.prepare("INSERT INTO memories (id, text) VALUES (?, ?)").run(
      "target",
      "H5POST-7B9A3E1C",
    );
    const ids = db.prepare("SELECT id FROM memories WHERE memories MATCH ?")
      .all(buildFtsFallbackQuery(searchPrompt, 8))
      .map(row => row.id);
    assert.ok(ids.includes("target"));
  } finally {
    db.close();
  }
});

test("bounded fallback preserves safe behavior for empty, Chinese, and ordinary input", () => {
  for (const input of ["", "!!!", "记忆语义", "plain ordinary words at the tail"]) {
    const terms = buildFtsFallbackQuery(input).split(" OR ").filter(Boolean);
    assert.ok(terms.length <= 8, input);
    assert.ok(terms.every(term => /^[\p{L}\p{N}_]+$/u.test(term)), input);
  }
  assert.notEqual(buildFtsFallbackQuery("纯中文语义检索"), "");
});

test("bounded fallback OR terms match a memory row containing a late identifier", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE VIRTUAL TABLE memories USING fts5(text)");
    db.prepare("INSERT INTO memories (text) VALUES (?)").run(
      "项目记录：H5SENTINEL-4F7A9C2D 对应关键词为 bounded-fallback",
    );

    const ftsQuery = buildFtsFallbackQuery(
      "请回顾我们之前记录的项目情况，并告诉我 H5SENTINEL-4F7A9C2D 对应的关键词",
    );
    const row = db.prepare("SELECT rowid FROM memories WHERE memories MATCH ?").get(ftsQuery);

    assert.ok(row);
  } finally {
    db.close();
  }
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

test("fallback rerank coverage uses only the bounded terms and keeps exact bonus separate", () => {
  const rawQuery = "alpha_1 beta_2 gamma_3 delta_4 epsilon_5 zeta_6 eta_7 theta_8 H5POST-7B9A3E1C";
  const boundedQuery = buildFtsFallbackQuery(rawQuery, 8);
  const boundedTerms = extractFtsFallbackTerms(boundedQuery);
  const normalizedTerms = extractQueryTokens(normalizeFtsQuery(rawQuery), 16);
  const omittedTerm = normalizedTerms.find(term => !boundedTerms.includes(term));
  const target = {
    id: "late-target",
    path: "memory/archive/late-target.md",
    text: "H5POST-7B9A3E1C",
    category: "raw_log",
    updated_at: 0,
  };
  const broad = {
    id: "omitted-broad",
    path: "memory/archive/omitted-broad.md",
    text: omittedTerm,
    category: "raw_log",
    updated_at: 0,
  };
  const ranked = rankFtsFallbackCandidates([broad, target], {
    rawQuery,
    queryTerms: boundedTerms,
    nowSec: 1_710_000_000,
    topK: 8,
  });

  assert.ok(omittedTerm);
  assert.ok(boundedTerms.includes("h5post") || boundedTerms.includes("7b9a3e1c"));
  assert.equal(ranked.ranked.some(row => row.id === "omitted-broad"), false);
  assert.equal(ranked.ranked[0].id, "late-target");
  assert.ok(ranked.ranked[0].token_coverage > 0);
  assert.ok(ranked.ranked[0].exact_bonus > 0);
  assert.equal(
    ranked.ranked[0].fallback_score,
    Math.round((ranked.ranked[0].token_coverage * 1.6 + ranked.ranked[0].exact_bonus) * 10000) / 10000,
  );
});

test("fallback rerank preserves legitimate coverage from multiple selected terms", () => {
  const query = "alpha_1 beta_2 gamma_3 delta_4 epsilon_5 zeta_6 eta_7 theta_8 H5POST-7B9A3E1C";
  const terms = extractFtsFallbackTerms(buildFtsFallbackQuery(query, 8));
  const competitorTerms = terms.slice(0, 2);
  const ranked = rankFtsFallbackCandidates([
    {
      id: "legitimate-competitor",
      path: "memory/archive/competitor.md",
      text: competitorTerms.join(" "),
      category: "raw_log",
      updated_at: 0,
    },
  ], {
    rawQuery: query,
    queryTerms: terms,
    nowSec: 1_710_000_000,
    topK: 8,
  });

  assert.equal(ranked.ranked.length, 1);
  assert.equal(ranked.ranked[0].id, "legitimate-competitor");
  assert.equal(ranked.ranked[0].token_coverage, 2 / terms.length);
  assert.ok(ranked.ranked[0].fallback_score > 0);
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

test("does not treat ordinary SHA or candidate IDs as citations", () => {
  assert.deepEqual(
    parseCitedMemoryIds("config sha 16b564a433300dce and candidate cd1ff729539f234e"),
    [],
  );
});

test("parses citations only from explicit metadata", () => {
  assert.deepEqual(
    parseCitedMemoryIds('config sha 16b564a433300dce\ncited_memory_ids: ["abcdef1234567890"]'),
    ["abcdef1234567890"],
  );
});

test("filters invalid explicit IDs and preserves valid order with Set deduplication", () => {
  assert.deepEqual(
    parseCitedMemoryIds(
      'cited_memory_ids: ["abcdef1234567890", "bad", "ABCDEF1234567890", "abcdef1234567890"]',
    ),
    ["abcdef1234567890", "ABCDEF1234567890"],
  );
});

test("does not fall back to hexadecimal scanning after invalid citation metadata", () => {
  assert.deepEqual(
    parseCitedMemoryIds('broken cited_memory_ids: ["abcdef1234567890"\nsha deadbeefdeadbeef'),
    [],
  );
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

test("card-first runtime is disabled by default and inherits the AutoRecall agent gate", () => {
  assert.equal(shouldUseAutoRecallCardRuntime({}, { agentId: "edi" }), false);
  assert.equal(shouldUseAutoRecallCardRuntime({ cardFirstRuntime: { enabled: false } }, { agentId: "edi" }), false);
  assert.equal(shouldUseAutoRecallCardRuntime({ cardFirstRuntime: { enabled: true } }, { agentId: "task-planner" }), false);
  assert.equal(shouldUseAutoRecallCardRuntime({ cardFirstRuntime: { enabled: true } }, { agentId: "edi" }), true);
  assert.equal(shouldUseAutoRecallCardRuntime({ agentAllowlist: ["main"], cardFirstRuntime: { enabled: true } }, { agentId: "main", allowed: true }), true);
  assert.equal(shouldUseAutoRecallCardRuntime({ agentAllowlist: ["main"], cardFirstRuntime: { enabled: true } }, { agentId: "task-planner", allowed: true }), false);
  assert.equal(shouldUseAutoRecallCardRuntime({ agentAllowlist: ["main"], cardFirstRuntime: { enabled: true } }, { agentId: "main", allowed: false }), false);
  assert.equal(shouldUseAutoRecallCardRuntime({ cardFirstRuntime: { enabled: true, mode: "raw_text" } }, { agentId: "edi" }), false);
});

test("formats card-first runtime context without using raw formatter body", () => {
  const text = formatAutoRecallCardContext([
    {
      id: "abcdef1234567890",
      category: "project",
      kind: "decision",
      confidence: 0.82,
      sources: ["fts", "kg"],
      path: "memory/projects/memory-engine.md",
      start_line: 10,
      end_line: 12,
      title: "P4 card-first decision",
      summary: "Use memory cards before full content.",
      text: "Full original body should not be formatted directly by card runtime.",
    },
  ], { topK: 1, agentScope: "edi", traceId: "trace-card" });

  assert.match(text, /Auto Recall - memory cards/);
  assert.match(text, /card-only previews/);
  assert.match(text, /abcdef1234567890/);
  assert.match(text, /P4 card-first decision/);
  assert.match(text, /Use memory cards before full content/);
  assert.match(text, /memory_engine_get:abcdef1234567890/);
  assert.match(text, /cited_memory_ids/);
  assert.doesNotMatch(text, /Full original body should not be formatted directly/);
});

test("card-first runtime withholds raw log and tool output body", () => {
  const report = buildAutoRecallCardContext([
    {
      id: "feedfacecafebeef",
      category: "raw_log",
      confidence: 0.6,
      sources: ["fts"],
      path: "memory/smart-add/2026-07-02.md",
      text: "2026-07-02 10:00:00 ERROR request failed\nTraceback at Object.handle (/tmp/runtime/index.js:42)",
    },
  ], { topK: 1, agentScope: "edi" });

  assert.equal(report.cards.length, 1);
  assert.equal(report.cards[0].risk_flags.includes("raw_log_like"), true);
  assert.equal(report.cards[0].risk_flags.includes("tool_output_like"), true);
  assert.match(report.context, /withheld/i);
  assert.doesNotMatch(report.context, /Traceback|Object\.handle|2026-07-02 10:00:00/);
  assert.deepEqual(report.side_effects, {
    db_writes: false,
    memory_file_mutation: false,
    dataset_file_mutation: false,
    retrieval: false,
    injection: false,
    cleanup_apply: false,
    archive: false,
    quarantine: false,
    reinforce: false,
    llm: false,
    network: false,
    runtime_report_files: false,
  });
});

test("clean SmartAdd project facts stay in a bounded injectable memory card", () => {
  const marker = "CLEAN_SMART_ADD_TAIL_MARKER";
  const text = [
    "Category: project",
    "H5-C2 keeps clean SmartAdd project facts available to card-first answers.",
    "The fact remains compact and useful while this filler only exercises the summary bound.",
    "bounded fact ".repeat(24),
    marker,
  ].join("\n");

  assert.ok(text.length > 240);
  const report = buildAutoRecallCardContext([{
    id: "clean-smart-add-123456",
    path: "memory/smart-add/2026-07-30.md",
    category: "project",
    lifecycle_state: "active",
    confidence: 0.9,
    sources: ["fts"],
    text,
  }], { topK: 1, agentScope: "edi", traceId: "trace-clean-smart-add" });

  assert.equal(report.cards.length, 1);
  const card = report.cards[0];
  assert.equal(card.risk_flags.includes("raw_log_like"), false);
  assert.equal(card.risk_flags.includes("tool_output_like"), false);
  assert.equal(card.disclosure_level, "memory_card");
  assert.equal(report.memory_objects[0].policy.can_inject_card, true);
  assert.match(card.summary, /H5-C2 keeps clean SmartAdd project facts/);
  assert.ok(card.summary.length <= 240);
  assert.equal(card.get_token, "memory_engine_get:clean-smart-add-123456");
  assert.match(report.context, /H5-C2 keeps clean SmartAdd project facts/);
  assert.match(report.context, /cited_memory_ids/);
  assert.match(report.context, /memory_engine_get:clean-smart-add-123456/);
  assert.doesNotMatch(report.context, new RegExp(marker));
});

test("SmartAdd path does not override actual raw-log and tool-output classification", () => {
  const report = buildAutoRecallCardContext([{
    id: "smart-add-real-log-1234",
    path: "memory/smart-add/2026-07-30.md",
    category: "project",
    confidence: 0.9,
    sources: ["fts"],
    text: "2026-07-30 10:00:00 ERROR request failed\nTraceback at Object.handle (/tmp/runtime/index.js:42)",
  }], { topK: 1, agentScope: "edi" });

  assert.equal(report.cards.length, 1);
  const card = report.cards[0];
  assert.equal(card.risk_flags.includes("raw_log_like"), true);
  assert.equal(card.risk_flags.includes("tool_output_like"), true);
  assert.match(report.context, /withheld/i);
  assert.doesNotMatch(report.context, /2026-07-30 10:00:00|ERROR|Traceback|Object\.handle/);
});
