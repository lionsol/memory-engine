const QUERY_TOKEN_RE = /[\p{Script=Han}]{2,}|[\p{L}\p{N}_]{2,}/gu;
const EXACT_FRAGMENT_RE = /[\p{Script=Han}]{2,}|[\p{L}\p{N}]+(?:[.+-][\p{L}\p{N}]+)+/gu;
const BROAD_RELEVANCE_TOKENS = new Set(["memory", "engine", "model", "模型"]);
const WEEKDAY_TIME_TOKENS = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun", "gmt", "utc"]);
const TIMESTAMP_PREFIX_RE = /^\[(?:mon|tue|wed|thu|fri|sat|sun)\s+\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:gmt|utc)(?:[+-]\d{1,2}(?::?\d{2})?)?\]\s*/iu;
const VERSION_FRAGMENT_RE = /(?<!\d)\d+(?:[._]\d+)+(?:\+)?(?!\d)/gu;

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isBroadToken(token) {
  return BROAD_RELEVANCE_TOKENS.has(String(token || "").trim().toLowerCase());
}

function isInformativeFragment(fragment) {
  const normalized = normalizeFtsQuery(fragment);
  if (!normalized) return false;
  const terms = normalized.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return false;
  return terms.some(term => !isBroadToken(term));
}

export function stripPromptMetadataPrefix(query) {
  const raw = String(query || "");
  const stripped = raw.replace(TIMESTAMP_PREFIX_RE, "");
  return stripped.trim();
}

function tokenizeNormalizedText(normalized) {
  return String(normalized || "")
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean);
}

function shouldDropTimeNoiseToken(token) {
  const t = String(token || "").toLowerCase();
  if (!t) return true;
  if (WEEKDAY_TIME_TOKENS.has(t)) return true;
  if (/^20\d{2}$/u.test(t)) return true;
  if (/^\d{1,2}$/u.test(t)) return true;
  return false;
}

function replaceVersionsWithStableTokens(text) {
  return String(text || "").replace(VERSION_FRAGMENT_RE, fragment => {
    const canonical = String(fragment || "")
      .replace(/\+$/u, "")
      .replace(/[._]/gu, "_");
    if (!canonical) return fragment;
    return ` version_${canonical} `;
  });
}

export function normalizeFtsQuery(text) {
  const stripped = stripPromptMetadataPrefix(text);
  const withVersionTokens = replaceVersionsWithStableTokens(stripped);
  const normalized = withVersionTokens
    .normalize("NFKC")
    .replace(/[-+:/\\.,!?()[\]{}<>"'`~@#$%^&*=|;]/g, " ")
    .replace(/[^\p{L}\p{N}_\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  const filtered = tokenizeNormalizedText(normalized).filter(token => !shouldDropTimeNoiseToken(token));
  return filtered.join(" ");
}

export function sanitizeFtsQuery(text) {
  return normalizeFtsQuery(text);
}

export function extractQueryTokens(text, maxTerms = 16) {
  const normalized = normalizeFtsQuery(text);
  const rawTokens = normalized.match(QUERY_TOKEN_RE) || [];
  const expanded = [];

  for (const token of rawTokens) {
    if (/^[\p{Script=Han}]+$/u.test(token) && token.length > 4) {
      for (let index = 0; index <= token.length - 2; index += 1) {
        expanded.push(token.slice(index, index + 2));
      }
      continue;
    }
    expanded.push(token.toLowerCase());
  }

  return [...new Set(expanded)].slice(0, Math.max(1, Number(maxTerms) || 16));
}

export function buildFtsFallbackQuery(text, maxTerms = 8) {
  const tokens = extractQueryTokens(text, Math.max(8, maxTerms * 2));
  return [...new Set(tokens)].slice(0, maxTerms).join(" OR ");
}

export function buildLikeFallbackPatterns(text, maxTerms = 8) {
  return extractQueryTokens(text, maxTerms)
    .filter(term => term.length >= 2)
    .map(term => `%${term}%`);
}

export function extractExactQueryFragments(text, maxTerms = 8) {
  const raw = stripPromptMetadataPrefix(text);
  const fragments = raw.match(EXACT_FRAGMENT_RE) || [];
  return [...new Set(
    fragments
      .map(part => part.trim())
      .filter(part => part.length >= 2)
      .map(part => part.toLowerCase())
  )].slice(0, maxTerms);
}

export function tokenCoverage(haystack, queryTerms) {
  const text = String(haystack || "").toLowerCase();
  const terms = Array.isArray(queryTerms) ? queryTerms.filter(Boolean) : [];
  if (terms.length === 0) return 0;
  let hit = 0;
  for (const term of terms) {
    const normalizedTerm = String(term).toLowerCase();
    if (/^\d+$/u.test(normalizedTerm)) {
      const numericBoundary = new RegExp(`(^|[^\\d])${escapeRegExp(normalizedTerm)}([^\\d]|$)`, "u");
      if (numericBoundary.test(text)) hit += 1;
      continue;
    }
    if (text.includes(normalizedTerm)) hit += 1;
  }
  return hit / terms.length;
}

export function rankFtsFallbackCandidates(rows, { rawQuery, queryTerms, nowSec = Math.floor(Date.now() / 1000), topK = 20 } = {}) {
  const informativeTerms = (Array.isArray(queryTerms) ? queryTerms : []).filter(term => !isBroadToken(term));
  const exactFragments = extractExactQueryFragments(rawQuery, 8).filter(isInformativeFragment);
  const scored = [];
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const haystack = `${row.path || ""}\n${row.text || ""}`;
    const coverage = tokenCoverage(haystack, informativeTerms);
    const normalizedHaystack = haystack.toLowerCase();
    let exactHitCount = 0;
    for (const fragment of exactFragments) {
      if (normalizedHaystack.includes(fragment)) exactHitCount += 1;
    }
    const exactBonus = Math.min(0.36, exactHitCount * 0.12);
    if (coverage <= 0 && exactBonus <= 0) continue;

    const path = String(row.path || "");
    const raw = String(row.text || "").toLowerCase();
    const category = String(row.category || "").toLowerCase();
    let categoryBoost = 0;
    if (path.startsWith("memory/smart-add/")) categoryBoost += 0.18;
    if (path.startsWith("memory/episodes/") || category === "episodic") categoryBoost += 0.12;
    if (/session\s*checkpoint|session[_ -]?key|session[_ -]?id/.test(raw) || /session[-_]?checkpoint/i.test(path)) {
      categoryBoost += 0.08;
    }

    const updatedAt = Number(row.updated_at || 0);
    let recencyBoost = 0;
    if (updatedAt > 0 && Number.isFinite(updatedAt)) {
      const ageDays = Math.max(0, (nowSec - updatedAt) / 86400);
      recencyBoost = 0.08 * Math.exp(-ageDays / 2.5);
    }

    const fallbackScore = coverage * 1.6 + exactBonus + categoryBoost + recencyBoost;
    scored.push({
      ...row,
      token_coverage: Math.round(coverage * 10000) / 10000,
      exact_bonus: Math.round(exactBonus * 10000) / 10000,
      category_boost_local: Math.round(categoryBoost * 10000) / 10000,
      recency_boost_local: Math.round(recencyBoost * 10000) / 10000,
      fallback_score: Math.round(fallbackScore * 10000) / 10000,
    });
  }

  scored.sort((a, b) => b.fallback_score - a.fallback_score);
  return {
    ranked: scored.slice(0, topK),
    post_rerank_topK: scored.slice(0, Math.min(topK, 8)).map(row => ({
      id: String(row.id || "").slice(0, 16),
      score: row.fallback_score,
      token_coverage: row.token_coverage,
      exact_bonus: row.exact_bonus,
      category_boost: row.category_boost_local,
      recency_boost: row.recency_boost_local,
      path: row.path || "",
    })),
  };
}
