import {
  buildFtsFallbackQuery,
  buildLikeFallbackPatterns,
  extractExactQueryFragments,
  extractQueryTokens,
  normalizeFtsQuery,
  rankFtsFallbackCandidates,
  sanitizeFtsQuery,
  stripPromptMetadataPrefix,
  tokenCoverage,
} from "./query-utils.js";
export {
  buildFtsFallbackQuery,
  buildLikeFallbackPatterns,
  extractExactQueryFragments,
  extractQueryTokens,
  normalizeFtsQuery,
  rankFtsFallbackCandidates,
  sanitizeFtsQuery,
  stripPromptMetadataPrefix,
  tokenCoverage,
} from "./query-utils.js";

const MEMORY_TRIGGER_RE = /\b(remember|recall|memory|memories|previous|last time|said before|preference|preferences|habit|habits)\b|[\u8bb0\u5fc6]|\u8bb0\u5f97|\u4e4b\u524d|\u4e0a\u6b21|\u6211\u8bf4\u8fc7|\u4f60\u8fd8\u8bb0\u5f97|\u56de\u5fc6|\u504f\u597d|\u4e60\u60ef/i;

const GREETING_RE = /^(hi|hello|hey|yo|good morning|good evening|\u4f60\u597d|\u55e8|\u65e9|\u65e9\u4e0a\u597d|\u665a\u5b89)[.!?\s]*$/i;
const ACK_RE = /^(ok|okay|k|yes|yep|yeah|sure|thanks|thank you|got it|continue|go on|\u597d|\u597d\u7684|\u53ef\u4ee5|\u55ef|\u884c|\u6536\u5230|\u7ee7\u7eed)[.!?\s]*$/i;
const BROAD_RELEVANCE_TOKENS = new Set(["memory", "engine", "model", "模型"]);
const BROAD_ONLY_RELEVANCE_TOKENS = ["memory", "engine", "openai", "代理", "模型切换"];
const SESSION_CHECKPOINT_RE = /session\s*checkpoint|session[_ -]?key|session[_ -]?id|session[-_]?checkpoint/i;
const VERSION_FRAGMENT_RE = /(?<!\d)\d+(?:[._]\d+)+(?:\+)?(?!\d)/g;
const SEMANTIC_TERM_SPECS = [
  { key: "兼容性", regex: /兼容性|不兼容/u },
  { key: "compatibility", regex: /\bcompatibility\b|\bcompatible\b|\bincompatible\b/i },
  { key: "break", regex: /\bbreak\b|\bbreaking\b|\bbreakage\b/i },
];

function isBroadToken(token) {
  const normalized = String(token || "").trim().toLowerCase();
  return BROAD_RELEVANCE_TOKENS.has(normalized);
}

function isInformativeFragment(fragment) {
  const normalized = normalizeFtsQuery(fragment);
  if (!normalized) return false;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.some(token => !isBroadToken(token));
}

function buildCandidateGateMetrics(candidate, query) {
  const haystack = `${candidate?.path || ""}\n${candidate?.text || ""}`;
  const queryTokens = extractQueryTokens(query, 16);
  const informativeTerms = queryTokens.filter(token => !isBroadToken(token));
  const coverage = tokenCoverage(haystack, informativeTerms);
  const exactFragments = extractExactQueryFragments(query, 8).filter(isInformativeFragment);
  const normalizedHaystack = haystack.toLowerCase();
  let exactHitCount = 0;
  for (const fragment of exactFragments) {
    if (normalizedHaystack.includes(String(fragment).toLowerCase())) exactHitCount += 1;
  }
  const exactBonus = Math.min(0.36, exactHitCount * 0.12);
  return {
    informative_terms: informativeTerms,
    token_coverage: Math.round(coverage * 10000) / 10000,
    exact_bonus: Math.round(exactBonus * 10000) / 10000,
    exact_hit_count: exactHitCount,
  };
}

function buildVersionMatchers(query) {
  const raw = String(query || "");
  const found = [];
  for (const match of raw.matchAll(VERSION_FRAGMENT_RE)) {
    const token = String(match[0] || "").trim();
    const canonical = token.replace(/\+$/u, "").replace(/_/g, ".");
    if (!canonical) continue;
    if (!found.some(item => item.canonical === canonical)) {
      const parts = canonical.split(".").filter(Boolean);
      if (parts.length >= 2) {
        const expr = `(^|[^\\d])${parts.join("[\\s._-]*")}(?:\\+)?([^\\d]|$)`;
        found.push({ canonical, regex: new RegExp(expr, "iu") });
      }
    }
  }
  return found;
}

function detectProjectTerms(query) {
  const raw = String(query || "");
  const normalized = normalizeFtsQuery(raw).toLowerCase();
  return {
    hasMemoryEngine: /memory[\s_-]*engine/i.test(raw) || normalized.includes("memory engine"),
    hasOpenClaw: /\bopenclaw\b/i.test(raw) || normalized.includes("openclaw"),
  };
}

function detectSemanticKeys(query) {
  const raw = String(query || "");
  const keys = [];
  for (const spec of SEMANTIC_TERM_SPECS) {
    if (spec.regex.test(raw)) keys.push(spec.key);
  }
  return keys;
}

function buildKeyTokenProfile(query) {
  const versionMatchers = buildVersionMatchers(query);
  const project = detectProjectTerms(query);
  const semanticKeys = detectSemanticKeys(query);
  const availableClasses = [];
  if (versionMatchers.length > 0) availableClasses.push("version");
  if (project.hasMemoryEngine || project.hasOpenClaw) availableClasses.push("project");
  if (semanticKeys.length > 0) availableClasses.push("semantic");
  return {
    versionMatchers,
    project,
    semanticKeys,
    availableClasses,
    applyClassGate: availableClasses.length >= 2,
  };
}

function matchKeyClasses(candidate, profile) {
  const haystack = `${candidate?.path || ""}\n${candidate?.text || ""}`;
  const normalizedHaystack = haystack.toLowerCase();
  const matched = {
    version: [],
    project: [],
    semantic: [],
    broadOnly: [],
  };

  for (const item of profile.versionMatchers || []) {
    if (item.regex.test(haystack)) matched.version.push(item.canonical);
  }
  if (profile.project?.hasMemoryEngine && /memory[\s_-]*engine/i.test(haystack)) {
    matched.project.push("memory-engine");
  }
  if (profile.project?.hasOpenClaw && normalizedHaystack.includes("openclaw")) {
    matched.project.push("openclaw");
  }
  for (const key of profile.semanticKeys || []) {
    const spec = SEMANTIC_TERM_SPECS.find(item => item.key === key);
    if (spec && spec.regex.test(haystack)) matched.semantic.push(key);
  }
  for (const token of BROAD_ONLY_RELEVANCE_TOKENS) {
    if (token === "模型切换") {
      if (normalizedHaystack.includes("模型切换")) matched.broadOnly.push(token);
      continue;
    }
    if (token === "代理") {
      if (normalizedHaystack.includes("代理")) matched.broadOnly.push(token);
      continue;
    }
    if (normalizedHaystack.includes(token)) matched.broadOnly.push(token);
  }

  const matchedKeyClasses = [];
  if (matched.version.length > 0) matchedKeyClasses.push("version");
  if (matched.project.length > 0) matchedKeyClasses.push("project");
  if (matched.semantic.length > 0) matchedKeyClasses.push("semantic");
  return { matched, matchedKeyClasses };
}

function hasRawLogClassMatch(matched) {
  return matched.version.length > 0 && (matched.project.length > 0 || matched.semantic.length > 0);
}

function hasRelaxedClassMatch(matched) {
  return (matched.project.length > 0 && matched.semantic.length > 0) ||
    (matched.version.length > 0 && (matched.project.length > 0 || matched.semantic.length > 0));
}

export function shouldInjectCandidate(candidate, query, debug = null) {
  const row = candidate || {};
  const category = String(row.category || "raw_log").toLowerCase();
  const path = String(row.path || "");
  const text = String(row.text || "");
  const finalScore = Number(row.final_score ?? row.finalScore ?? row.rrf_score ?? 0);
  const metrics = buildCandidateGateMetrics(row, query);
  const isSessionCheckpoint = SESSION_CHECKPOINT_RE.test(`${path}\n${text}`);
  const isRelaxedSource =
    path.startsWith("memory/smart-add/") ||
    path.startsWith("memory/episodes/") ||
    category === "episodic" ||
    isSessionCheckpoint;
  const minCoverage = isRelaxedSource ? 0.25 : 0.5;
  const keyProfile = buildKeyTokenProfile(query);
  const keyMatch = matchKeyClasses(row, keyProfile);
  const matchedKeyClasses = keyMatch.matchedKeyClasses;
  const classRejectReason = "insufficient_key_class_match";

  if (keyProfile.applyClassGate) {
    const hasEnoughClasses = matchedKeyClasses.length >= 2;
    const rawLogRequiresVersion = category === "raw_log" && keyProfile.versionMatchers.length > 0;
    const rawLogAllowed = !rawLogRequiresVersion || hasRawLogClassMatch(keyMatch.matched);
    const relaxedAllowed = !isRelaxedSource || hasRelaxedClassMatch(keyMatch.matched);
    if (!hasEnoughClasses || !rawLogAllowed || !relaxedAllowed) {
      return {
        inject: false,
        reason: classRejectReason,
        rejected_reason: classRejectReason,
        matched_key_classes: matchedKeyClasses,
        matched_key_tokens: keyMatch.matched,
        ...metrics,
        min_coverage: minCoverage,
        final_score: finalScore,
      };
    }
  }

  if (metrics.informative_terms.length === 0 && metrics.exact_bonus <= 0) {
    return {
      inject: false,
      reason: "no_informative_terms",
      rejected_reason: "no_informative_terms",
      matched_key_classes: matchedKeyClasses,
      matched_key_tokens: keyMatch.matched,
      ...metrics,
      min_coverage: minCoverage,
      final_score: finalScore,
    };
  }
  if (metrics.token_coverage < minCoverage && metrics.exact_bonus <= 0) {
    return {
      inject: false,
      reason: isRelaxedSource ? "relaxed_source_low_coverage_no_exact" : "raw_log_low_coverage_no_exact",
      rejected_reason: isRelaxedSource ? "relaxed_source_low_coverage_no_exact" : "raw_log_low_coverage_no_exact",
      matched_key_classes: matchedKeyClasses,
      matched_key_tokens: keyMatch.matched,
      ...metrics,
      min_coverage: minCoverage,
      final_score: finalScore,
    };
  }
  if (category === "raw_log" && finalScore < 0.05) {
    return {
      inject: false,
      reason: "raw_log_final_score_below_minimum",
      rejected_reason: "raw_log_final_score_below_minimum",
      matched_key_classes: matchedKeyClasses,
      matched_key_tokens: keyMatch.matched,
      ...metrics,
      min_coverage: minCoverage,
      final_score: finalScore,
    };
  }
  if (category === "episodic" && finalScore < 0.02) {
    return {
      inject: false,
      reason: "episodic_final_score_below_minimum",
      rejected_reason: "episodic_final_score_below_minimum",
      matched_key_classes: matchedKeyClasses,
      matched_key_tokens: keyMatch.matched,
      ...metrics,
      min_coverage: minCoverage,
      final_score: finalScore,
    };
  }

  return {
    inject: true,
    reason: null,
    rejected_reason: null,
    matched_key_classes: matchedKeyClasses,
    matched_key_tokens: keyMatch.matched,
    ...metrics,
    min_coverage: minCoverage,
    final_score: finalScore,
  };
}

function normalizePrompt(prompt) {
  return String(prompt || "").trim();
}

export function shouldForceAutoRecall(prompt) {
  const text = normalizePrompt(prompt);
  if (!text || text.startsWith("/")) return false;
  return MEMORY_TRIGGER_RE.test(text);
}

export function shouldSkipAutoRecall(prompt) {
  return explainAutoRecallSkip(prompt) !== null;
}

export function explainAutoRecallSkip(prompt) {
  const text = normalizePrompt(prompt);
  if (!text) return "empty_prompt";
  if (text.startsWith("/")) return "slash_command";
  if (shouldForceAutoRecall(text)) return null;
  if (GREETING_RE.test(text)) return "greeting";
  if (ACK_RE.test(text)) return "acknowledgement";

  const compact = text.replace(/\s+/g, "");
  const words = text.split(/\s+/).filter(Boolean);
  if (compact.length <= 3) return "too_short_compact_le_3";
  if (compact.length <= 8 && words.length <= 2) return "too_short_compact_le_8_words_le_2";
  return null;
}

function trimMemoryText(text, maxLength = 240) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}...`;
}

export function parseCitedMemoryIds(text) {
  const raw = String(text || "");
  const found = new Set();
  const jsonLike = raw.match(/cited_memory_ids\s*[:=]\s*(\[[^\]\n]*\])/i);

  if (jsonLike) {
    try {
      const parsed = JSON.parse(jsonLike[1]);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const id = String(item || "").trim();
          if (/^[a-f0-9]{8,64}$/i.test(id)) found.add(id);
        }
      }
    } catch {}
  }

  for (const match of raw.matchAll(/\b[0-9a-f]{16,64}\b/gi)) {
    found.add(match[0]);
  }

  return [...found];
}

export function formatAutoRecallContext(results, options = {}) {
  const topK = Math.max(1, Number(options.topK || 3));
  const items = Array.isArray(results) ? results.slice(0, topK) : [];
  if (items.length === 0) return "";

  const lines = [
    "## Auto Recall - relevant memory",
    "",
    "The following memories may help answer this turn. Use only if relevant.",
    "If your answer relies on any item, include a final metadata line exactly like: cited_memory_ids: [\"memory_id\"] using the IDs shown below.",
    "",
  ];

  items.forEach((item, index) => {
    const id = String(item.id || "").slice(0, 16);
    const category = item.category || "raw_log";
    const confidenceMode = item.confidence_mode || "managed";
    const sourceType = item.source_type || "memory-engine-managed";
    const externalBadge = item.external_badge ? "external" : "managed";
    const confidence = item.confidence ?? item.confidence_realtime ?? "n/a";
    const sources = Array.isArray(item.sources) ? item.sources.join(",") : (item.sources || "unknown");
    lines.push(`${index + 1}. [${id}] category=${category} confidence=${confidence} confidence_mode=${confidenceMode} source_type=${sourceType} badge=${externalBadge} sources=${sources}`);
    const memoryText = trimMemoryText(item.text);
    if (memoryText) lines.push(`   ${memoryText}`);
  });

  return lines.join("\n");
}
