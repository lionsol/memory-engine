import {
  deriveCandidateSources,
  round4,
  toFiniteNumber,
} from "./normalize-candidate.js";

export function computeRecencyBoost(createdAtSec, nowSec, rankingConfig = {}) {
  if (!createdAtSec || !Number.isFinite(createdAtSec)) return 0;
  const ageDays = Math.max(0, (nowSec - createdAtSec) / 86400);
  const recencyCfg = rankingConfig?.recencyBoost || {};
  const base = toFiniteNumber(recencyCfg.base) ?? 0.06;
  const decayDays = toFiniteNumber(recencyCfg.decayDays) ?? 2.5;
  const safeDecay = decayDays > 0 ? decayDays : 2.5;
  const boost = base * Math.exp(-ageDays / safeDecay);
  return round4(boost);
}

function computeManagedCategoryBoost(category, text = "", rankingConfig = {}) {
  const managedCfg = rankingConfig?.categoryBoost?.managed || {};
  const cat = String(category || "").toLowerCase();
  const episodicBoost = Number(managedCfg.episodic);
  const sessionCheckpointBoost = Number(managedCfg.sessionCheckpoint);
  if (cat === "episodic") return Number.isFinite(episodicBoost) ? episodicBoost : 0.12;
  const raw = String(text || "").toLowerCase();
  if (raw.includes("session checkpoint") || raw.includes("session-checkpoint")) {
    return Number.isFinite(sessionCheckpointBoost) ? sessionCheckpointBoost : 0.1;
  }
  return 0;
}

export function categoryBoost(item, rankingConfig = {}) {
  if (item?.confidence_mode === "external") {
    const externalSourceBoost = rankingConfig?.categoryBoost?.external || {};
    const fallbackExternalBoost = Number(externalSourceBoost.external);
    const key = String(item?.category || "external").toLowerCase();
    if (Object.prototype.hasOwnProperty.call(externalSourceBoost, key)) {
      const value = Number(externalSourceBoost[key]);
      return Number.isFinite(value) ? value : 0;
    }
    return Number.isFinite(fallbackExternalBoost) ? fallbackExternalBoost : 0.03;
  }
  return computeManagedCategoryBoost(item?.category, item?.text, rankingConfig);
}

export function confidenceBoost(item, rankingConfig = {}) {
  if (item?.confidence_mode === "external") return 0;
  const conf = toFiniteNumber(item?.confidence);
  if (conf === null) return 0;
  const weight = toFiniteNumber(rankingConfig?.confidenceWeight) ?? 0.1;
  return round4(conf * weight);
}

export function externalBoost(item, rankingConfig = {}) {
  if (item?.confidence_mode !== "external") return 0;
  const excluded = Array.isArray(rankingConfig?.externalBoost?.excludedCategories)
    ? rankingConfig.externalBoost.excludedCategories
    : ["dreaming", "stats"];
  const category = String(item?.category || "external").toLowerCase();
  if (excluded.includes(category)) return 0;
  const value = toFiniteNumber(rankingConfig?.externalBoost?.value);
  return value === null ? 0.05 : value;
}

export function scoreCandidate(item) {
  return round4(
    (toFiniteNumber(item?.semanticScore) ?? 0) +
    (toFiniteNumber(item?.rrfScore) ?? 0) +
    (toFiniteNumber(item?.categoryBoost) ?? 0) +
    (toFiniteNumber(item?.recencyBoost) ?? 0) +
    (toFiniteNumber(item?.confidenceBoost) ?? 0) +
    (toFiniteNumber(item?.externalBoost) ?? 0)
  );
}

export function fuseChannels(channels, { rrfK, nowSec, rankingConfig }) {
  const names = Object.keys(channels).filter(name => Array.isArray(channels[name]) && channels[name].length > 0);
  const fusion = new Map();
  for (const [chName, rankedItems] of Object.entries(channels)) {
    rankedItems.forEach((item, idx) => {
      const exist = fusion.get(item.id) || {
        id: item.id,
        text: item.text,
        category: item.category,
        confidence_mode: item.confidence_mode,
        source_type: item.source_type,
        decay_eligible: item.decay_eligible,
        archive_eligible: item.archive_eligible,
        external_badge: item.external_badge,
        channels: [],
        semantic_sources: [],
        sources: [],
        semanticScore: item.semantic_score || 0,
        rrfScore: 0,
        recencyBoost: 0,
        categoryBoost: 0,
        confidenceBoost: 0,
        externalBoost: 0,
        finalScore: 0,
        similarity: item.similarity,
        confidence: item.confidence,
        hits: item.hit_count,
        created_at: item.created_at || 0,
        path: item.path || "",
        token_coverage: toFiniteNumber(item.token_coverage) ?? 0,
        exact_bonus: toFiniteNumber(item.exact_bonus) ?? 0,
        structured_match_bonus: toFiniteNumber(item.structured_match_bonus) ?? 0,
        lexical_signal_score: toFiniteNumber(item.lexical_signal_score) ?? 0,
      };
      if (!exist.channels.includes(chName)) exist.channels.push(chName);
      const semanticTags = deriveCandidateSources(item);
      for (const tag of semanticTags) {
        if (!exist.semantic_sources.includes(tag)) exist.semantic_sources.push(tag);
      }
      exist.rrfScore += 1 / (rrfK + idx + 1);
      exist.semanticScore = Math.max(exist.semanticScore, item.semantic_score || 0);
      exist.token_coverage = Math.max(exist.token_coverage, toFiniteNumber(item.token_coverage) ?? 0);
      exist.exact_bonus = Math.max(exist.exact_bonus, toFiniteNumber(item.exact_bonus) ?? 0);
      exist.structured_match_bonus = Math.max(exist.structured_match_bonus, toFiniteNumber(item.structured_match_bonus) ?? 0);
      exist.lexical_signal_score = Math.max(exist.lexical_signal_score, toFiniteNumber(item.lexical_signal_score) ?? 0);
      if (!exist.path && item.path) exist.path = item.path;
      if (!exist.category && item.category) exist.category = item.category;
      if (!exist.confidence_mode && item.confidence_mode) exist.confidence_mode = item.confidence_mode;
      if (!exist.source_type && item.source_type) exist.source_type = item.source_type;
      if (exist.confidence === null || exist.confidence === undefined) exist.confidence = item.confidence;
      if (!exist.created_at && item.created_at) exist.created_at = item.created_at;
      fusion.set(item.id, exist);
    });
  }

  const fused = Array.from(fusion.values()).map(item => {
    item.semanticScore = round4(item.semanticScore);
    item.rrfScore = round4(item.rrfScore);
    item.recencyBoost = computeRecencyBoost(item.created_at, nowSec, rankingConfig);
    item.categoryBoost = round4(categoryBoost(item, rankingConfig));
    item.confidenceBoost = confidenceBoost(item, rankingConfig);
    item.externalBoost = externalBoost(item, rankingConfig);
    item.finalScore = scoreCandidate(item);
    item.sources = [...new Set([...item.channels, ...item.semantic_sources])];
    item.token_coverage = round4(item.token_coverage);
    item.exact_bonus = round4(item.exact_bonus);
    item.structured_match_bonus = round4(item.structured_match_bonus);
    item.lexical_signal_score = round4(item.lexical_signal_score);
    return item;
  });

  return { names, fused };
}
