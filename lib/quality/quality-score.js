import { actions, grades } from "./quality-types.js";

const HARD_CAPS = new Map([
  ["missing_content", 20],
  ["content_empty", 20],
  ["raw_log_leak", 40],
  ["debug_noise", 55],
  ["duplicate_exact", 60],
  ["conflict_flagged", 65],
  ["category_path_mismatch", 75],
  ["chunks_without_confidence", 70],
  ["too_generic", 70],
]);

const PENALTY_RULES = new Map([
  ["missing_content", { points: 85, reason: "content field is missing; item is not reviewable as memory text" }],
  ["content_empty", { points: 80, reason: "content is empty after trimming; memory carries no usable substance" }],
  ["content_too_short", { points: 12, reason: "content is too short to preserve enough memory context" }],
  ["timestamp_pollution", { points: 10, reason: "content appears polluted by timestamps or log framing noise" }],
  ["raw_log_leak", { points: 45, reason: "content leaks raw conversation/log transcript instead of distilled memory" }],
  ["debug_noise", { points: 32, reason: "content contains debug stack trace or error noise that should be cleaned" }],
  ["missing_category", { points: 10, reason: "category metadata is missing" }],
  ["unknown_category", { points: 8, reason: "category metadata is unknown to the deterministic evaluator" }],
  ["category_path_mismatch", { points: 18, reason: "path family and category conflict in an obvious way" }],
  ["duplicate_exact", { points: 30, reason: "content is an exact duplicate after deterministic normalization" }],
  ["conflict_flagged", { points: 22, reason: "memory is already conflict-flagged and needs review" }],
  ["too_generic", { points: 16, reason: "content is too generic and lacks concrete reusable detail" }],
  ["chunks_without_confidence", { points: 18, reason: "chunk is missing its confidence-side metadata record" }],
  ["content_too_long", { points: 6, reason: "content is overly long for a compact reusable memory item" }],
  ["duplicate_near", { points: 10, reason: "content is near-duplicate and may need consolidation" }],
  ["never_retrieved", { points: 6, reason: "memory has not been retrieved after clearing the age gate" }],
  ["old_and_unused", { points: 14, reason: "memory is old, unretrieved, and uninjected after the age gate" }],
]);

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function resolveGrade(score) {
  if (score >= 85) return grades.A;
  if (score >= 70) return grades.B;
  if (score >= 50) return grades.C;
  return grades.D;
}

function getSuggestedAction(flags, score) {
  const set = new Set(flags || []);
  if (set.has("duplicate_exact")) return actions.dedupe_candidate;
  if (set.has("chunks_without_confidence")) return actions.repair_candidate;
  if (set.has("raw_log_leak")) {
    return set.has("old_and_unused") || score < 35
      ? actions.archive_candidate
      : actions.repair_candidate;
  }
  if (set.has("debug_noise")) return actions.repair_candidate;
  if (set.has("conflict_flagged")) return actions.review;
  if (score >= 85) return actions.keep;
  if (score < 50) return set.has("old_and_unused") ? actions.archive_candidate : actions.review;
  return actions.review;
}

export function scoreQualityItem(flags, candidate = {}) {
  const normalizedFlags = Array.from(new Set(Array.isArray(flags) ? flags : []));
  let rawScore = 100;
  let hardCap = null;
  const penalties = [];

  for (const flag of normalizedFlags) {
    const rule = PENALTY_RULES.get(flag);
    if (!rule) continue;
    rawScore -= rule.points;
    const penalty = {
      flag,
      points: rule.points,
      reason: rule.reason,
    };
    const maxScore = HARD_CAPS.get(flag);
    if (typeof maxScore === "number") {
      penalty.max_score = maxScore;
      hardCap = hardCap === null ? maxScore : Math.min(hardCap, maxScore);
    }
    penalties.push(penalty);
  }

  let score = clampScore(rawScore);
  if (hardCap !== null) score = Math.min(score, hardCap);

  const grade = resolveGrade(score);
  const suggested_action = getSuggestedAction(normalizedFlags, score, candidate);

  return {
    score,
    grade,
    penalties,
    suggested_action,
  };
}
