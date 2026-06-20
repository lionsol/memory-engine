import crypto from "node:crypto";
import { buildSmartAddFingerprint } from "../../smart-add-fingerprint.js";
import { collectQualityCandidates } from "./collect-quality-candidates.js";
import { resolveAuditDbPaths } from "./chunks-without-confidence-audit.js";

function normalizeDuplicateExactText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function compareStrings(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function toShare(count, total) {
  const n = Number(count) || 0;
  const d = Number(total) || 0;
  if (d <= 0) return 0;
  return Math.round((n / d) * 10000) / 10000;
}

function toIsoDateTime(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const millis = raw > 1e12 ? raw : raw * 1000;
  return new Date(millis).toISOString();
}

function safePreview(text, maxLength = 160) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}

function extractOccurrenceDateKey(path, createdAt) {
  const normalizedPath = String(path || "");
  const smartAddMatch = normalizedPath.match(/^memory\/smart-add\/(\d{4}-\d{2}-\d{2})\.md$/);
  if (smartAddMatch) return smartAddMatch[1];
  const dailyMatch = normalizedPath.match(/^memory\/(\d{4}-\d{2}-\d{2})[^/]*\.md$/);
  if (dailyMatch) return dailyMatch[1];
  if (createdAt && /^\d{4}-\d{2}-\d{2}T/.test(String(createdAt))) {
    return String(createdAt).slice(0, 10);
  }
  return null;
}

function toDayNumber(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) return null;
  const millis = Date.parse(`${dateKey}T00:00:00.000Z`);
  if (!Number.isFinite(millis)) return null;
  return Math.floor(millis / 86400000);
}

function computeDateStats(dateKeys) {
  const normalized = Array.from(new Set((dateKeys || []).filter(Boolean))).sort(compareStrings);
  if (normalized.length === 0) {
    return {
      allKnown: false,
      earliest: null,
      latest: null,
      spanDays: null,
      adjacent: false,
    };
  }
  const dayNumbers = normalized.map(toDayNumber);
  if (dayNumbers.some(value => value === null)) {
    return {
      allKnown: false,
      earliest: normalized[0],
      latest: normalized[normalized.length - 1],
      spanDays: null,
      adjacent: false,
    };
  }
  let adjacent = true;
  for (let i = 1; i < dayNumbers.length; i += 1) {
    if (dayNumbers[i] - dayNumbers[i - 1] > 1) {
      adjacent = false;
      break;
    }
  }
  return {
    allKnown: true,
    earliest: normalized[0],
    latest: normalized[normalized.length - 1],
    spanDays: dayNumbers[dayNumbers.length - 1] - dayNumbers[0],
    adjacent: adjacent && normalized.length > 1,
  };
}

function hashText(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

function buildOccurrence(candidate, normalizedText) {
  const createdAt = toIsoDateTime(candidate?.updated_at);
  const occurrenceDate = extractOccurrenceDateKey(candidate?.path, createdAt);
  const category = String(candidate?.category ?? "").trim() || null;
  const isProtected = Number(candidate?.is_protected || 0) === 1;
  return {
    chunk_id: String(candidate?.id || ""),
    path: String(candidate?.path || ""),
    source_type: String(candidate?.source || "unknown") || "unknown",
    family: String(candidate?.quality_scope_family || "unknown"),
    owner: String(candidate?.quality_scope_owner || "unknown"),
    category,
    created_at: createdAt,
    occurrence_date: occurrenceDate,
    retrieved_count: Number(candidate?.retrieved_count || 0),
    injected_count: Number(candidate?.injected_count || 0),
    expected_confidence: Boolean(candidate?.expected_confidence),
    default_quality_score_scope: Boolean(candidate?.default_quality_score_scope),
    diagnostic_scope: Boolean(candidate?.diagnostic_scope),
    retrieval_visible: Boolean(candidate?.retrieval_visible),
    content_preview: safePreview(candidate?.text),
    fingerprint_hash: buildSmartAddFingerprint(candidate?.text ?? "", category ?? "", isProtected),
    normalized_content_hash: hashText(normalizedText),
    scope_included: candidate?.quality_scope_family === "smart_add"
      && candidate?.quality_scope_owner === "memory_engine_lifecycle",
  };
}

function compareOccurrences(a, b) {
  return (
    compareStrings(a.occurrence_date, b.occurrence_date)
    || compareStrings(a.created_at, b.created_at)
    || compareStrings(a.path, b.path)
    || compareStrings(a.chunk_id, b.chunk_id)
  );
}

function buildCategoryBreakdown(occurrences) {
  const counts = new Map();
  for (const occurrence of occurrences) {
    const key = String(occurrence.category ?? "null");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => Number(b.count || 0) - Number(a.count || 0) || compareStrings(a.category, b.category));
}

function classifyDuplicateGroup(scopeOccurrences, allOccurrences) {
  const hasNonScopeOccurrence = allOccurrences.some(occurrence => !occurrence.scope_included);
  const retrievedCountTotal = allOccurrences.reduce((sum, occurrence) => sum + Number(occurrence.retrieved_count || 0), 0);
  const injectedCountTotal = allOccurrences.reduce((sum, occurrence) => sum + Number(occurrence.injected_count || 0), 0);
  const hasUsage = retrievedCountTotal > 0 || injectedCountTotal > 0;
  const categories = Array.from(new Set(scopeOccurrences.map(occurrence => String(occurrence.category ?? "null"))));
  const dateStats = computeDateStats(scopeOccurrences.map(occurrence => occurrence.occurrence_date));

  if (hasNonScopeOccurrence) {
    return {
      classification: "unsafe_to_cleanup",
      cleanup_eligibility: false,
      risk_level: "high",
      likely_cause: "duplicate content crosses smart-add lifecycle memory and non-smart-add diagnostic/core/manual memory paths",
    };
  }

  if (hasUsage) {
    return {
      classification: "unsafe_to_cleanup",
      cleanup_eligibility: false,
      risk_level: "high",
      likely_cause: "duplicate content has already been retrieved or injected by recall, so cleanup would be risky",
    };
  }

  if (categories.length === 1 && dateStats.allKnown && dateStats.adjacent) {
    return {
      classification: "ingestion_bug_candidate",
      cleanup_eligibility: true,
      risk_level: "low",
      likely_cause: "same normalized smart-add content repeated across adjacent dated files with no observed recall usage",
    };
  }

  if (dateStats.allKnown && Number(dateStats.spanDays || 0) >= 7) {
    return {
      classification: "repeated_confirmation_candidate",
      cleanup_eligibility: false,
      risk_level: "medium",
      likely_cause: "same fact appears to be reaffirmed across a long time window rather than a narrow ingestion glitch",
    };
  }

  return {
    classification: "mixed_or_unclear",
    cleanup_eligibility: false,
    risk_level: "medium",
    likely_cause: "duplicate content exists, but path/date/category evidence is not strong enough to distinguish ingestion bug from intentional repetition",
  };
}

function pickKeepCandidate(occurrences) {
  return occurrences.slice().sort((a, b) => (
    Number(b.injected_count || 0) - Number(a.injected_count || 0)
    || Number(b.retrieved_count || 0) - Number(a.retrieved_count || 0)
    || compareOccurrences(a, b)
  ))[0] || null;
}

function toCandidateRef(occurrence) {
  if (!occurrence) return null;
  return {
    chunk_id: occurrence.chunk_id,
    path: occurrence.path,
    category: occurrence.category,
    occurrence_date: occurrence.occurrence_date,
    created_at: occurrence.created_at,
    retrieved_count: Number(occurrence.retrieved_count || 0),
    injected_count: Number(occurrence.injected_count || 0),
    owner: occurrence.owner,
    family: occurrence.family,
  };
}

function buildGroupStats(normalizedText, occurrences) {
  const sortedOccurrences = occurrences.slice().sort(compareOccurrences);
  const scopeOccurrences = sortedOccurrences.filter(occurrence => occurrence.scope_included);
  return {
    normalizedText,
    sortedOccurrences,
    scopeOccurrences,
    scopeOccurrenceCount: scopeOccurrences.length,
    ownersTouched: Array.from(new Set(sortedOccurrences.map(occurrence => occurrence.owner))).sort(compareStrings),
    familiesTouched: Array.from(new Set(sortedOccurrences.map(occurrence => occurrence.family))).sort(compareStrings),
  };
}

function buildGroup(groupStats) {
  const {
    normalizedText,
    sortedOccurrences,
    scopeOccurrences,
    ownersTouched,
    familiesTouched,
  } = groupStats;
  const classification = classifyDuplicateGroup(scopeOccurrences, sortedOccurrences);
  const keep = pickKeepCandidate(scopeOccurrences);
  const deleteCandidates = classification.cleanup_eligibility
    ? scopeOccurrences.filter(occurrence => occurrence.chunk_id !== keep?.chunk_id).map(toCandidateRef)
    : [];
  const retrievedCountTotal = sortedOccurrences.reduce((sum, occurrence) => sum + Number(occurrence.retrieved_count || 0), 0);
  const injectedCountTotal = sortedOccurrences.reduce((sum, occurrence) => sum + Number(occurrence.injected_count || 0), 0);
  const chunksEverRetrieved = sortedOccurrences.filter(occurrence => Number(occurrence.retrieved_count || 0) > 0).length;
  const chunksEverInjected = sortedOccurrences.filter(occurrence => Number(occurrence.injected_count || 0) > 0).length;
  const createdValues = sortedOccurrences.map(occurrence => occurrence.created_at).filter(Boolean).sort(compareStrings);

  return {
    group_hash: hashText(normalizedText),
    normalized_content_hash: hashText(normalizedText),
    duplicate_count: scopeOccurrences.length,
    all_occurrence_count: sortedOccurrences.length,
    earliest_occurrence: createdValues[0] || null,
    latest_occurrence: createdValues[createdValues.length - 1] || null,
    all_occurrence_paths: sortedOccurrences.map(occurrence => occurrence.path),
    all_occurrence_dates: sortedOccurrences.map(occurrence => occurrence.occurrence_date),
    category_breakdown: buildCategoryBreakdown(sortedOccurrences),
    source_file_paths: sortedOccurrences.map(occurrence => occurrence.path),
    retrieved_count_total: retrievedCountTotal,
    injected_count_total: injectedCountTotal,
    chunks_ever_retrieved: chunksEverRetrieved,
    chunks_ever_injected: chunksEverInjected,
    representative_content_preview: safePreview(normalizedText),
    suggested_keep_candidate: toCandidateRef(keep),
    suggested_delete_candidates: deleteCandidates,
    cleanup_eligibility: classification.cleanup_eligibility,
    risk_level: classification.risk_level,
    likely_cause: classification.likely_cause,
    classification: classification.classification,
    fingerprint_hashes: Array.from(new Set(sortedOccurrences.map(occurrence => occurrence.fingerprint_hash))).sort(compareStrings),
    owners_touched: ownersTouched,
    families_touched: familiesTouched,
    occurrences: sortedOccurrences.map(occurrence => ({
      chunk_id: occurrence.chunk_id,
      path: occurrence.path,
      occurrence_date: occurrence.occurrence_date,
      created_at: occurrence.created_at,
      category: occurrence.category,
      owner: occurrence.owner,
      family: occurrence.family,
      source_type: occurrence.source_type,
      fingerprint_hash: occurrence.fingerprint_hash,
      retrieved_count: Number(occurrence.retrieved_count || 0),
      injected_count: Number(occurrence.injected_count || 0),
      scope_included: Boolean(occurrence.scope_included),
    })),
  };
}

function buildSummary(groups) {
  const duplicateExactEntries = groups.reduce((sum, group) => sum + Number(group.duplicate_count || 0), 0);
  const cleanupEligibleGroups = groups.filter(group => group.cleanup_eligibility);
  return {
    duplicate_exact_groups: groups.length,
    duplicate_exact_entries: duplicateExactEntries,
    cleanup_eligible_groups: cleanupEligibleGroups.length,
    cleanup_eligible_entries: cleanupEligibleGroups.reduce((sum, group) => sum + Number(group.duplicate_count || 0), 0),
    retrieved_duplicate_groups: groups.filter(group => Number(group.retrieved_count_total || 0) > 0).length,
    injected_duplicate_groups: groups.filter(group => Number(group.injected_count_total || 0) > 0).length,
    ingestion_bug_candidate_groups: groups.filter(group => group.classification === "ingestion_bug_candidate").length,
    repeated_confirmation_groups: groups.filter(group => group.classification === "repeated_confirmation_candidate").length,
    mixed_or_unclear_groups: groups.filter(group => group.classification === "mixed_or_unclear").length,
    unsafe_to_cleanup_groups: groups.filter(group => group.classification === "unsafe_to_cleanup").length,
  };
}

function buildDiagnostics(allGroups, includedGroups) {
  const excludedGroups = allGroups.filter(group => Number(group.scopeOccurrenceCount || 0) < 2);
  const excludedOccurrenceCount = excludedGroups.reduce(
    (sum, group) => sum + Number(group?.sortedOccurrences?.length || 0),
    0,
  );
  return {
    all_exact_duplicate_groups: allGroups.length,
    all_exact_duplicate_occurrences: allGroups.reduce((sum, group) => sum + Number(group?.sortedOccurrences?.length || 0), 0),
    excluded_by_scope_groups: excludedGroups.length,
    excluded_by_scope_occurrences: excludedOccurrenceCount,
    groups_touching_non_scope_paths: includedGroups.filter(group => group.owners_touched.some(owner => owner !== "memory_engine_lifecycle")).length,
  };
}

export function buildSmartAddDuplicateAudit({
  generatedAt = new Date().toISOString(),
  candidateSource = null,
  scope = "smart_add_lifecycle_owned",
} = {}) {
  const candidateResult = candidateSource || collectQualityCandidates({ scope: "all" });
  const allCandidates = Array.isArray(candidateResult?.candidates) ? candidateResult.candidates : [];
  const duplicateMap = new Map();

  for (const candidate of allCandidates) {
    const normalizedText = normalizeDuplicateExactText(candidate?.text);
    if (!normalizedText) continue;
    const key = hashText(normalizedText);
    const group = duplicateMap.get(key) || { normalizedText, occurrences: [] };
    group.occurrences.push(buildOccurrence(candidate, normalizedText));
    duplicateMap.set(key, group);
  }

  const allExactGroupStats = Array.from(duplicateMap.values())
    .filter(group => group.occurrences.length > 1)
    .map(group => buildGroupStats(group.normalizedText, group.occurrences));

  const includedGroups = allExactGroupStats
    .filter(group => group.scopeOccurrenceCount >= 2)
    .map(buildGroup);

  includedGroups.sort((a, b) => (
    Number(b.duplicate_count || 0) - Number(a.duplicate_count || 0)
    || compareStrings(a.earliest_occurrence, b.earliest_occurrence)
    || compareStrings(a.group_hash, b.group_hash)
  ));

  const dbPaths = resolveAuditDbPaths();
  const report = {
    generated_at: generatedAt,
    mode: "read_only",
    scope,
    db_paths: {
      engine: dbPaths.engineDbPath,
      core: dbPaths.coreDbPath,
    },
    summary: buildSummary(includedGroups),
    diagnostics: buildDiagnostics(allExactGroupStats, includedGroups),
    groups: includedGroups,
  };

  return report;
}

export function renderSmartAddDuplicateAuditMarkdown(report) {
  const summary = report?.summary || {};
  const topGroups = (report?.groups || []).slice(0, 10).map(group => (
    `- ${group.group_hash.slice(0, 16)}: duplicate_count=${group.duplicate_count}, classification=${group.classification}, risk=${group.risk_level}, keep=${group.suggested_keep_candidate?.path || "none"}`
  )).join("\n") || "- none";

  return `# Smart-Add Duplicate Audit

## Summary

- generated_at: ${report.generated_at}
- mode: ${report.mode}
- scope: ${report.scope}
- engine_db: ${report.db_paths.engineDbPath || report.db_paths.engine || "unknown"}
- core_db: ${report.db_paths.coreDbPath || report.db_paths.core || "unknown"}
- duplicate_exact_groups: ${summary.duplicate_exact_groups}
- duplicate_exact_entries: ${summary.duplicate_exact_entries}
- cleanup_eligible_groups: ${summary.cleanup_eligible_groups}
- cleanup_eligible_entries: ${summary.cleanup_eligible_entries}
- retrieved_duplicate_groups: ${summary.retrieved_duplicate_groups}
- injected_duplicate_groups: ${summary.injected_duplicate_groups}
- ingestion_bug_candidate_groups: ${summary.ingestion_bug_candidate_groups}
- repeated_confirmation_groups: ${summary.repeated_confirmation_groups}
- mixed_or_unclear_groups: ${summary.mixed_or_unclear_groups}
- unsafe_to_cleanup_groups: ${summary.unsafe_to_cleanup_groups}

## Top Groups

${topGroups}
`;
}

export function runSmartAddDuplicateAudit(options = {}) {
  return buildSmartAddDuplicateAudit({
    generatedAt: options.generatedAt || new Date().toISOString(),
    candidateSource: options.candidateSource || null,
    scope: options.scope || "smart_add_lifecycle_owned",
  });
}
