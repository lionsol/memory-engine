import {
  extractQueryTokens,
  tokenCoverage,
} from "../../../query-utils.js";
import { resolveEffectiveLexicalConfidenceThreshold } from "../../config/effective-hybrid-runtime-config.js";
import {
  round4,
  toFiniteNumber,
} from "./normalize-candidate.js";

export function tokenizeQuery(text, maxTerms = 10) {
  return extractQueryTokens(text, maxTerms);
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

export { resolveEffectiveLexicalConfidenceThreshold as resolveLexicalConfidenceThreshold };

export function computeStructuredMatchBonus(item, queryTerms = [], exactFragments = []) {
  const path = String(item?.path || "").toLowerCase();
  const category = String(item?.category || "").toLowerCase();
  const fileName = path.split("/").filter(Boolean).pop() || "";
  const moduleName = path.split("/").filter(Boolean).slice(0, -1).pop() || "";
  let bonus = 0;
  for (const term of queryTerms) {
    const normalizedTerm = String(term || "").toLowerCase();
    if (!normalizedTerm) continue;
    if (category && category.includes(normalizedTerm)) bonus += 0.08;
    if (fileName && fileName.includes(normalizedTerm)) bonus += 0.08;
    if (moduleName && moduleName.includes(normalizedTerm)) bonus += 0.06;
    if (path && path.includes(normalizedTerm)) bonus += 0.04;
  }
  for (const fragment of exactFragments) {
    const normalizedFragment = String(fragment || "").toLowerCase();
    if (!normalizedFragment) continue;
    if (category && category.includes(normalizedFragment)) bonus += 0.1;
    if (fileName && fileName.includes(normalizedFragment)) bonus += 0.1;
    if (moduleName && moduleName.includes(normalizedFragment)) bonus += 0.08;
    if (path && path.includes(normalizedFragment)) bonus += 0.06;
  }
  return round4(Math.min(0.4, bonus));
}

export function enrichLexicalCandidate(item, { queryTerms = [], exactFragments = [] } = {}) {
  const haystack = `${item?.path || ""}\n${item?.text || ""}\n${item?.category || ""}`;
  const coverage = round4(tokenCoverage(haystack, queryTerms));
  const normalizedHaystack = haystack.toLowerCase();
  let exactHitCount = 0;
  for (const fragment of exactFragments) {
    if (normalizedHaystack.includes(String(fragment || "").toLowerCase())) exactHitCount += 1;
  }
  const exactBonus = round4(Math.min(0.36, exactHitCount * 0.12));
  const structuredMatchBonus = computeStructuredMatchBonus(item, queryTerms, exactFragments);
  const lexicalSignalScore = round4(
    (coverage * 0.55) +
    (Math.min(1, exactBonus / 0.36) * 0.2) +
    (Math.min(1, structuredMatchBonus / 0.4) * 0.15) +
    (Math.min(1, Number(item?.semantic_score || 0)) * 0.1)
  );
  return {
    ...item,
    token_coverage: coverage,
    exact_bonus: exactBonus,
    structured_match_bonus: structuredMatchBonus,
    lexical_signal_score: lexicalSignalScore,
  };
}

export function computeLexicalConfidence(fusedLexical = []) {
  const lexicalCandidates = Array.isArray(fusedLexical) ? fusedLexical : [];
  const top = lexicalCandidates[0] || null;
  const candidateCount = lexicalCandidates.length;
  const topScore = round4(toFiniteNumber(top?.finalScore) ?? 0);
  const countComponent = Math.min(1, candidateCount / 3) * 0.15;
  const scoreComponent = Math.min(1, topScore / 1.2) * 0.15;
  const coverageComponent = clamp01(toFiniteNumber(top?.token_coverage) ?? 0) * 0.25;
  const exactComponent = Math.min(1, (toFiniteNumber(top?.exact_bonus) ?? 0) / 0.36) * 0.15;
  const structuredComponent = Math.min(1, (toFiniteNumber(top?.structured_match_bonus) ?? 0) / 0.4) * 0.2;
  const channelSupportComponent = Math.min(1, (Array.isArray(top?.channels) ? top.channels.length : 0) / 2) * 0.1;
  const confidence = round4(
    countComponent +
    scoreComponent +
    coverageComponent +
    exactComponent +
    structuredComponent +
    channelSupportComponent
  );
  return {
    lexical_candidate_count: candidateCount,
    lexical_top_score: topScore,
    lexical_confidence: confidence,
  };
}
