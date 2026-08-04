const QUERY_TOKEN_RE = /[\p{Script=Han}]{2,}|[\p{L}\p{N}_]{2,}/gu;
const EXACT_FRAGMENT_RE = /[\p{Script=Han}]{2,}|[\p{L}\p{N}]+(?:[.+-][\p{L}\p{N}]+)+/gu;
const BROAD_RELEVANCE_TOKENS = new Set(["memory", "engine", "model", "模型"]);
const WEEKDAY_TIME_TOKENS = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun", "gmt", "utc"]);
const TIMESTAMP_PREFIX_RE = /^\[(?:mon|tue|wed|thu|fri|sat|sun)\s+\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:gmt|utc)(?:[+-]\d{1,2}(?::?\d{2})?)?\]\s*/iu;
const VERSION_FRAGMENT_RE = /(?<!\d)\d+(?:[._]\d+)+(?:\+)?(?!\d)/gu;
const DELIMITED_QUERY_TOKEN_RE = /[\p{L}\p{N}_]+(?:[-+./\\:@#=|][\p{L}\p{N}_]+)+/gu;
const MAX_COMPOUND_COMPONENTS = 3;
const MAX_HIGH_INFORMATION_COMPOUND_COMPONENTS = 2;
const FTS_SAFE_TERM_RE = /^[\p{L}\p{N}_]+$/u;

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

function extractNormalizedQueryTokens(normalized) {
  const rawTokens = String(normalized || "").match(QUERY_TOKEN_RE) || [];
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

  return [...new Set(expanded)];
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

function isChineseQueryToken(token) {
  return /^[\p{Script=Han}]+$/u.test(String(token || ""));
}

function highInformationStrength(token) {
  const value = String(token || "").toLowerCase();
  const hasLetters = /\p{L}/u.test(value);
  const hasNumbers = /\p{N}/u.test(value);
  const suffix = value.slice(value.lastIndexOf("_") + 1);
  const hashLike = candidate => (
    candidate.length >= 6 &&
    /[a-z]/u.test(candidate) &&
    /\d/u.test(candidate) &&
    /^[0-9a-f]+$/u.test(candidate)
  );

  // A hex-shaped component is the most discriminative form after query
  // normalization. This also covers UUID/hash components split on hyphens.
  if (
    (hashLike(value) || (value.includes("_") && hashLike(suffix)))
  ) return 4;

  if (!value.includes("_") && hasLetters && hasNumbers) return 3;
  if (value.includes("_") && hasNumbers) return 2;
  if (value.includes("_")) return 1;
  return 0;
}

function selectHighInformationTokens(tokens, quota, termGroups) {
  const source = Array.isArray(tokens) ? tokens : [];
  const limit = Math.max(0, Math.trunc(Number(quota)));
  if (limit === 0 || source.length === 0) return [];

  const effectiveLimit = Math.min(limit, source.length);
  const items = source.map((token, index) => ({
    token,
    index,
    group: termGroups.get(token) || null,
    strength: highInformationStrength(token),
  }));

  const groupCounts = new Map();
  const compoundLimit = group => {
    if (!group) return Number.POSITIVE_INFINITY;
    const hasAlternativeGroup = items.some(item => item.group !== group);
    return hasAlternativeGroup
      ? Math.min(MAX_HIGH_INFORMATION_COMPOUND_COMPONENTS, Math.max(1, effectiveLimit - 1))
      : MAX_HIGH_INFORMATION_COMPOUND_COMPONENTS;
  };
  const canSelect = item => {
    if (!item.group) return true;
    return (groupCounts.get(item.group) || 0) < compoundLimit(item.group);
  };
  const select = item => {
    groupCounts.set(item.group, (groupCounts.get(item.group) || 0) + 1);
  };

  if (effectiveLimit === 1) {
    const strongest = [...items]
      .sort((left, right) => right.strength - left.strength || left.index - right.index)
      .find(canSelect);
    return strongest ? [strongest.token] : [];
  }

  const selectedIndexes = new Set();
  const selectNearest = target => {
    const nearest = items
      .filter(item => !selectedIndexes.has(item.index) && canSelect(item))
      .sort((left, right) => (
        Math.abs(left.index - target) - Math.abs(right.index - target) ||
        right.strength - left.strength ||
        left.index - right.index
      ))[0];
    if (!nearest) return false;
    selectedIndexes.add(nearest.index);
    select(nearest);
    return true;
  };

  const middleIndex = Math.floor((source.length - 1) / 2);
  const anchors = effectiveLimit === 2
    ? [0, source.length - 1]
    : [0, middleIndex, source.length - 1];
  for (const target of anchors) {
    if (selectedIndexes.size >= effectiveLimit) break;
    selectNearest(target);
  }

  // If an anchor selected a compound component, retain one nearby legal
  // component before spending the remaining budget on unrelated tokens.
  // This keeps compounds searchable without allowing one compound to fill the
  // high-information quota.
  const anchoredGroups = [...new Set(
    items.filter(item => selectedIndexes.has(item.index) && item.group).map(item => item.group),
  )];
  for (const group of anchoredGroups) {
    while (
      selectedIndexes.size < effectiveLimit &&
      (groupCounts.get(group) || 0) < compoundLimit(group)
    ) {
      const groupItems = items
        .filter(item => item.group === group && !selectedIndexes.has(item.index))
        .sort((left, right) => (
          right.strength - left.strength || left.index - right.index
        ));
      if (groupItems.length === 0) break;
      const next = groupItems[0];
      selectedIndexes.add(next.index);
      select(next);
    }
  }

  // Fill remaining slots by maximum dispersion from the positions already
  // selected. This avoids reusing anchor targets and prevents a tie from
  // turning into a forward scan near the head of the query.
  const distanceToSelected = index => Math.min(
    ...[...selectedIndexes].map(selectedIndex => Math.abs(index - selectedIndex)),
  );
  const isUncoveredCompound = item => Boolean(item.group) && (groupCounts.get(item.group) || 0) === 0;
  while (selectedIndexes.size < effectiveLimit) {
    const next = items
      .filter(item => !selectedIndexes.has(item.index) && canSelect(item))
      .sort((left, right) => (
        Number(isUncoveredCompound(right)) - Number(isUncoveredCompound(left)) ||
        distanceToSelected(right.index) - distanceToSelected(left.index) ||
        right.strength - left.strength ||
        left.index - right.index
      ))[0];
    if (!next) break;
    selectedIndexes.add(next.index);
    select(next);
  }

  return source.filter((_, index) => selectedIndexes.has(index));
}

function collectDelimitedTermGroups(text) {
  const termGroups = new Map();
  let groupId = 0;
  const stripped = stripPromptMetadataPrefix(text).normalize("NFKC");
  for (const fragment of stripped.match(DELIMITED_QUERY_TOKEN_RE) || []) {
    const terms = extractNormalizedQueryTokens(normalizeFtsQuery(fragment));
    if (terms.length < 2) continue;
    const group = `compound_${groupId}`;
    groupId += 1;
    for (const term of terms) {
      if (!termGroups.has(term)) termGroups.set(term, group);
    }
  }
  return termGroups;
}

function structuredTokenStrength(token) {
  const value = String(token || "").toLowerCase();
  if (isBroadToken(value)) return 0;
  if (/^\d{3,}$/u.test(value)) return 3;
  if (isChineseQueryToken(value)) return 1;
  return 2;
}

function selectStructuredOrdinaryTokens(tokens, limit, termGroups) {
  const source = Array.isArray(tokens) ? tokens : [];
  const capacity = Math.max(0, Math.trunc(Number(limit)));
  if (capacity === 0 || source.length === 0) return new Set();

  const groups = new Map();
  for (const token of source) {
    const group = termGroups.get(token) || `term_${token}`;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(token);
  }

  const orderedGroups = [...groups.entries()]
    .map(([group, groupTokens], firstIndex) => ({
      group,
      groupTokens: [...groupTokens].sort((left, right) => (
        structuredTokenStrength(right) - structuredTokenStrength(left)
      )),
      priority: Math.max(...groupTokens.map(structuredTokenStrength)),
      firstIndex,
    }))
    .sort((left, right) => right.priority - left.priority || left.firstIndex - right.firstIndex);

  // Round-robin compound components so one long delimited phrase cannot
  // consume every ordinary slot. A three-part compound remains fully
  // searchable when the bounded query has room for it.
  const selected = new Set();
  const selectedPerGroup = new Map();
  while (selected.size < capacity) {
    let madeProgress = false;
    for (const { group, groupTokens } of orderedGroups) {
      const count = selectedPerGroup.get(group) || 0;
      if (count >= MAX_COMPOUND_COMPONENTS) continue;
      const next = groupTokens.find(token => !selected.has(token));
      if (!next) continue;
      selected.add(next);
      selectedPerGroup.set(group, count + 1);
      madeProgress = true;
      if (selected.size >= capacity) break;
    }
    if (!madeProgress) break;
  }
  return selected;
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

export function extractFtsFallbackTerms(query, maxTerms = 8) {
  const limit = Math.min(8, Math.max(0, Math.trunc(Number(maxTerms) || 0)));
  if (limit === 0) return [];

  const seen = new Set();
  const terms = [];
  for (const rawTerm of String(query || "").split(/\s+/u)) {
    if (!rawTerm || rawTerm === "OR") continue;
    const term = rawTerm.toLowerCase();
    if (!FTS_SAFE_TERM_RE.test(term) || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length >= limit) break;
  }
  return terms;
}

export function extractQueryTokens(text, maxTerms = 16) {
  const normalized = normalizeFtsQuery(text);
  return extractNormalizedQueryTokens(normalized)
    .slice(0, Math.max(1, Number(maxTerms) || 16));
}

export function buildFtsFallbackQuery(text, maxTerms = 8) {
  const limit = Math.max(0, Math.trunc(Number(maxTerms)));
  if (limit === 0) return "";

  const normalized = normalizeFtsQuery(text);
  const tokens = extractNormalizedQueryTokens(normalized);
  if (tokens.length === 0) return "";

  const delimitedTermGroups = collectDelimitedTermGroups(text);
  const delimitedTerms = new Set(delimitedTermGroups.keys());

  const highInformation = tokens.filter(token => {
    const hasLetters = /\p{L}/u.test(token);
    const hasNumbers = /\p{N}/u.test(token);
    return (hasLetters && hasNumbers) || token.includes("_");
  });
  const highInformationSet = new Set(highInformation);
  const chineseTerms = tokens.filter(isChineseQueryToken);
  const structuredOrdinary = tokens.filter(token => (
    delimitedTerms.has(token) && !highInformationSet.has(token)
  ));
  const ordinary = tokens.filter(token => (
    !highInformationSet.has(token) && !structuredOrdinary.includes(token)
  ));

  const highQuota = Math.min(
    highInformation.length,
    Math.max(0, limit - (limit >= 2 && chineseTerms.length > 0 ? 1 : 0)),
  );
  const selected = selectHighInformationTokens(highInformation, highQuota, delimitedTermGroups);
  if (selected.length === 0 && structuredOrdinary.length === 0) {
    return tokens.slice(0, limit).join(" OR ");
  }

  const selectedSet = new Set(selected);
  const append = token => {
    if (selected.length >= limit || selectedSet.has(token)) return;
    selected.push(token);
    selectedSet.add(token);
  };

  // Reserve a Chinese semantic representative, then give compound parts a
  // chance before filling the remaining budget in normalized query order.
  if (chineseTerms.length > 0) append(chineseTerms[0]);
  const structuredCapacity = Math.max(0, limit - selected.length);
  const selectedStructured = selectStructuredOrdinaryTokens(
    structuredOrdinary,
    structuredCapacity,
    delimitedTermGroups,
  );
  for (const token of structuredOrdinary) {
    if (selectedStructured.has(token)) append(token);
  }
  for (const token of ordinary.filter(token => !chineseTerms.includes(token))) append(token);
  for (const token of ordinary) append(token);

  return selected.slice(0, limit).join(" OR ");
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
