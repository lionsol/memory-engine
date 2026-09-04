export const Q1_PRODUCT_METRIC_CONTRACT_SCHEMA = "memory_engine_q1_product_metric_contract_v1";
export const Q1_PRODUCT_METRIC_CONTRACT_V1_SCHEMA = Q1_PRODUCT_METRIC_CONTRACT_SCHEMA;

// This vocabulary is intentionally byte-for-byte compatible with Q0.
export const Q1_CASE_PROVENANCE = Object.freeze([
  "PRODUCTION_OBSERVED",
  "PRODUCTION_REPLAY",
  "BENCHMARK_DERIVED",
  "TARGETED_SYNTHETIC",
]);
export const Q1_PROVENANCE = Q1_CASE_PROVENANCE;
export const Q1_METRIC_PROVENANCE = Q1_CASE_PROVENANCE;

export const Q1_EVIDENCE_BUDGET = 3;
export const Q1_NOT_MEASURABLE = "NOT_MEASURABLE";
export const Q1_ANSWER_EVIDENCE_COVERAGE_STATUS = "NOT_MEASURABLE_WITH_CURRENT_AUTHORITY";
export const Q1_ANSWER_EVIDENCE_COVERAGE = Q1_ANSWER_EVIDENCE_COVERAGE_STATUS;

export const Q1_METRIC_REGISTRY = Object.freeze({
  evidence_ranking_at_3: Object.freeze([
    "recall_any@3",
    "recall_all@3",
    "ndcg@3",
    "evidence_coverage@3",
    "budget_feasible@3",
    "recall_all@3_feasible",
    "first_relevant_rank@3",
    "cross_session_evidence_coverage@3",
  ]),
  trigger: Object.freeze([
    "trigger_recall",
    "unnecessary_recall_rate",
    "trigger_precision",
  ]),
  top3_safety: Object.freeze([
    "top3_fill_rate",
    "stale_top3_slot_rate",
    "conflict_top3_slot_rate",
    "stale_or_conflict_top3_slot_rate",
  ]),
  injection_quality: Object.freeze([
    "irrelevant_injection_rate",
    "context_pollution_rate",
  ]),
  latency: Object.freeze([
    "recall_latency_p50_ms",
    "recall_latency_p95_ms",
    "incomplete_trace_rate",
    "error_or_timeout_rate",
  ]),
  answer_use: Object.freeze(["answer_evidence_coverage"]),
});
export const Q1_PRODUCT_METRIC_REGISTRY = Q1_METRIC_REGISTRY;

const RANKING_METRIC_KEYS = Object.freeze([
  "recall_any@3",
  "recall_all@3",
  "ndcg@3",
  "evidence_coverage@3",
  "budget_feasible@3",
  "recall_all@3_feasible",
  "first_relevant_rank@3",
]);

const RANKING_INPUT_GOLD_KEYS = Object.freeze([
  "gold_evidence_ids",
  "goldEvidenceIds",
  "required_evidence_ids",
  "requiredEvidenceIds",
  "evidence_ids",
  "gold_ids",
]);

const RANKING_INPUT_RETRIEVED_KEYS = Object.freeze([
  "ranked_retrieved_ids",
  "rankedRetrievedIds",
  "retrieved_ids",
  "retrievedIds",
  "ranked_ids",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function firstOwnField(sources, keys) {
  for (const source of sources) {
    if (!isRecord(source)) continue;
    for (const key of keys) {
      if (hasOwn(source, key) && source[key] !== undefined) return source[key];
    }
  }
  return undefined;
}

function firstMetadataField(sources, keys) {
  for (const source of sources) {
    if (!isRecord(source)) continue;
    for (const key of keys) {
      if (hasOwn(source, key) && source[key] !== undefined && source[key] !== null) return source[key];
    }
  }
  return undefined;
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null);
}

function isNonEmptyIdentity(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

function stableSerialize(value) {
  if (value === undefined) return '"__undefined__"';
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
}

function metadataFrom(value, defaults = {}) {
  const nested = [
    isRecord(value?.metric_provenance) ? value.metric_provenance : null,
    isRecord(value?.metadata) ? value.metadata : null,
    isRecord(defaults?.metric_provenance) ? defaults.metric_provenance : null,
    isRecord(defaults?.metadata) ? defaults.metadata : null,
  ];
  const sources = [value, ...nested, defaults];

  const rawProvenance = firstMetadataField(sources, ["provenance"]);
  const rawSource = firstMetadataField(sources, [
    "source_identity",
    "source",
    "source_ref",
  ]);
  const rawDataset = firstMetadataField(sources, [
    "dataset_identity",
    "dataset",
    "dataset_id",
    "dataset_name",
  ]);

  const sourceIdentity = rawSource === undefined
    ? (rawDataset === undefined ? null : rawDataset)
    : rawSource;
  const datasetIdentity = rawDataset === undefined
    ? (isRecord(sourceIdentity)
      ? firstDefined(sourceIdentity.dataset_identity, sourceIdentity.dataset, sourceIdentity.dataset_id)
      : null)
    : rawDataset;
  const provenance = rawProvenance === undefined ? null : rawProvenance;

  return {
    provenance,
    source_identity: sourceIdentity,
    dataset_identity: datasetIdentity,
    attribution_complete: Q1_CASE_PROVENANCE.includes(provenance) && isNonEmptyIdentity(sourceIdentity),
  };
}

function attributionFields(metadata) {
  return {
    provenance: metadata.provenance,
    source_identity: metadata.source_identity,
    dataset_identity: metadata.dataset_identity,
    // These aliases make the source boundary obvious to callers that use the
    // shorter vocabulary while source_identity/dataset_identity stay stable.
    source: metadata.source_identity,
    dataset: metadata.dataset_identity,
    attribution_complete: metadata.attribution_complete,
  };
}

function metadataGroupKey(metadata) {
  return [
    metadata.provenance === null ? "__UNKNOWN_PROVENANCE__" : stableSerialize(metadata.provenance),
    metadata.source_identity === null ? "__UNKNOWN_SOURCE__" : stableSerialize(metadata.source_identity),
    metadata.dataset_identity === null ? "__UNKNOWN_DATASET__" : stableSerialize(metadata.dataset_identity),
  ].join("\u0000");
}

function metadataGroupFields(metadata) {
  return {
    provenance: metadata.provenance,
    source_identity: metadata.source_identity,
    dataset_identity: metadata.dataset_identity,
    source: metadata.source_identity,
    dataset: metadata.dataset_identity,
  };
}

/**
 * Validate attribution before treating a collection as one metric statistic.
 * Missing attribution is reported as incomplete; incompatible known groups
 * are incompatible and must not be pooled.
 */
export function validateQ1MetricProvenance(input, options = {}) {
  const rows = Array.isArray(input)
    ? input
    : (input?.cases ?? input?.results ?? input?.turns ?? input?.items);
  if (!Array.isArray(rows)) {
    return {
      schema: Q1_PRODUCT_METRIC_CONTRACT_SCHEMA,
      valid: false,
      compatible: false,
      complete: false,
      mixed: false,
      case_count: 0,
      errors: ["INVALID_PROVENANCE_INPUT"],
      provenance_values: [],
      source_identities: [],
      groups: [],
    };
  }

  const containerDefaults = isRecord(input) ? { ...input, ...options } : options;

  const groups = new Map();
  const errors = [];
  const provenanceValues = new Set();
  const sourceIdentities = new Set();
  let missingProvenanceCount = 0;
  let missingSourceCount = 0;

  rows.forEach((row, index) => {
    const metadata = metadataFrom(row, containerDefaults);
    const groupKey = metadataGroupKey(metadata);
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        ...metadataGroupFields(metadata),
        group_id: groupKey,
        case_count: 0,
      });
    }
    groups.get(groupKey).case_count += 1;

    if (metadata.provenance === null) {
      missingProvenanceCount += 1;
    } else if (!Q1_CASE_PROVENANCE.includes(metadata.provenance)) {
      errors.push(`INVALID_PROVENANCE:${String(metadata.provenance)}:${index}`);
    } else {
      provenanceValues.add(metadata.provenance);
    }

    if (!isNonEmptyIdentity(metadata.source_identity)) {
      missingSourceCount += 1;
    } else {
      sourceIdentities.add(stableSerialize(metadata.source_identity));
    }
  });

  const mixed = groups.size > 1;
  if (mixed) errors.push("INCOMPATIBLE_PROVENANCE_OR_SOURCE");
  if (missingProvenanceCount > 0) errors.push("PROVENANCE_MISSING");
  if (missingSourceCount > 0) errors.push("SOURCE_IDENTITY_MISSING");

  const compatible = errors.every(error => (
    !error.startsWith("INVALID_PROVENANCE:")
    && error !== "INCOMPATIBLE_PROVENANCE_OR_SOURCE"
  ));
  const complete = missingProvenanceCount === 0 && missingSourceCount === 0;

  return {
    schema: Q1_PRODUCT_METRIC_CONTRACT_SCHEMA,
    valid: compatible && complete,
    compatible,
    complete,
    mixed,
    case_count: rows.length,
    errors: [...new Set(errors)],
    provenance_values: [...provenanceValues],
    source_identities: [...sourceIdentities].map(value => JSON.parse(value)),
    missing_provenance_count: missingProvenanceCount,
    missing_source_identity_count: missingSourceCount,
    groups: [...groups.values()],
  };
}

export function assertQ1MetricProvenance(input, options = {}) {
  const report = validateQ1MetricProvenance(input, options);
  if (!report.compatible) {
    throw new Error(`q1_metric_provenance_incompatible:${report.errors.join(",")}`);
  }
  return report;
}

function nullRankingMetrics() {
  return Object.fromEntries(RANKING_METRIC_KEYS.map(key => [key, null]));
}

function rankingMetricsWithAliases(metrics) {
  return {
    ...metrics,
    // The underscore spelling is canonical. Keep the prose spelling usable
    // without making it a second metric in the registry.
    "recall_all@3-feasible": metrics["recall_all@3_feasible"],
  };
}

function rankingInput(input, retrievedArgument, optionsArgument) {
  if (Array.isArray(input)) {
    return {
      payload: {
        gold_evidence_ids: input,
        ranked_retrieved_ids: retrievedArgument,
      },
      options: isRecord(optionsArgument) ? optionsArgument : {},
    };
  }

  const payload = isRecord(input) ? input : {};
  const options = isRecord(retrievedArgument) && !Array.isArray(retrievedArgument)
    ? retrievedArgument
    : (isRecord(optionsArgument) ? optionsArgument : {});
  const withRetrievedOverride = Array.isArray(retrievedArgument)
    ? { ...payload, ranked_retrieved_ids: retrievedArgument }
    : payload;
  return { payload: withRetrievedOverride, options };
}

function unknownRankingScore(metadata, reason, extra = {}) {
  const metrics = rankingMetricsWithAliases(nullRankingMetrics());
  return {
    schema: Q1_PRODUCT_METRIC_CONTRACT_SCHEMA,
    metric_family: "evidence_ranking",
    budget_k: Q1_EVIDENCE_BUDGET,
    scoreable: false,
    unknown: true,
    unknown_or_unscoreable: true,
    unknown_reason: reason,
    gold_evidence_ids: null,
    ranked_retrieved_ids: null,
    gold_evidence_count: null,
    retrieved_top3_distinct_gold_count: null,
    first_relevant_rank: null,
    is_cross_session_evidence_case: null,
    metrics,
    ...metrics,
    ...attributionFields(metadata),
    ...extra,
  };
}

function validEvidenceId(value) {
  return typeof value === "string" && value.trim() !== "";
}

function uniqueIds(values) {
  return [...new Set(values)];
}

function dcg(relevances) {
  return relevances.reduce((sum, relevance, index) => (
    sum + (Number(relevance) || 0) / Math.log2(index + 2)
  ), 0);
}

/**
 * Score an already-ranked evidence list at the fixed production budget k=3.
 * The function accepts either ({ gold_evidence_ids, ranked_retrieved_ids })
 * or (goldEvidenceIds, rankedRetrievedIds). It never performs retrieval.
 */
export function scoreQ1EvidenceRankingAt3(input, retrievedArgument, optionsArgument) {
  const { payload, options } = rankingInput(input, retrievedArgument, optionsArgument);
  const metadata = metadataFrom(payload, options);
  const rawGold = firstOwnField([payload], RANKING_INPUT_GOLD_KEYS);
  const rawRetrieved = firstOwnField([payload], RANKING_INPUT_RETRIEVED_KEYS);

  if (!Array.isArray(rawGold)) {
    return unknownRankingScore(metadata, "gold_evidence_ids_must_be_nonempty_array");
  }
  if (rawGold.length === 0 || rawGold.some(id => !validEvidenceId(id))) {
    return unknownRankingScore(metadata, "gold_evidence_ids_invalid");
  }
  if (!Array.isArray(rawRetrieved)) {
    return unknownRankingScore(metadata, "ranked_retrieved_ids_must_be_array");
  }
  if (rawRetrieved.some(id => !validEvidenceId(id))) {
    return unknownRankingScore(metadata, "ranked_retrieved_ids_invalid");
  }

  const goldEvidenceIds = uniqueIds(rawGold);
  const rankedRetrievedIds = [...rawRetrieved];
  const gold = new Set(goldEvidenceIds);
  const top3 = rankedRetrievedIds.slice(0, Q1_EVIDENCE_BUDGET);
  const observedGold = new Set(top3.filter(id => gold.has(id)));
  const firstIndex = top3.findIndex(id => gold.has(id));
  const relevances = [];
  const seenRelevant = new Set();
  for (const id of top3) {
    if (gold.has(id) && !seenRelevant.has(id)) {
      relevances.push(1);
      seenRelevant.add(id);
    } else {
      relevances.push(0);
    }
  }

  const idealDcg = dcg(Array.from({ length: Math.min(gold.size, Q1_EVIDENCE_BUDGET) }, () => 1));
  const metrics = rankingMetricsWithAliases({
    "recall_any@3": Number(observedGold.size > 0),
    "recall_all@3": Number(observedGold.size === gold.size),
    "ndcg@3": idealDcg === 0 ? 0 : dcg(relevances) / idealDcg,
    "evidence_coverage@3": observedGold.size / gold.size,
    "budget_feasible@3": gold.size <= Q1_EVIDENCE_BUDGET,
    "recall_all@3_feasible": gold.size <= Q1_EVIDENCE_BUDGET
      ? Number(observedGold.size === gold.size)
      : null,
    "first_relevant_rank@3": firstIndex < 0 ? null : firstIndex + 1,
  });

  return {
    schema: Q1_PRODUCT_METRIC_CONTRACT_SCHEMA,
    metric_family: "evidence_ranking",
    budget_k: Q1_EVIDENCE_BUDGET,
    scoreable: true,
    unknown: false,
    unknown_or_unscoreable: false,
    gold_evidence_ids: goldEvidenceIds,
    ranked_retrieved_ids: rankedRetrievedIds,
    retrieved_ids: rankedRetrievedIds,
    retrieved_top3_ids: top3,
    gold_evidence_count: gold.size,
    retrieved_top3_distinct_gold_count: observedGold.size,
    is_cross_session_evidence_case: gold.size >= 2,
    cross_session_case: gold.size >= 2,
    first_relevant_rank: metrics["first_relevant_rank@3"],
    metrics,
    ...metrics,
    ...attributionFields(metadata),
  };
}

function rankingMetric(score, key) {
  if (isRecord(score?.metrics)) {
    if (hasOwn(score.metrics, key)) return score.metrics[key];
    if (key === "recall_all@3_feasible" && hasOwn(score.metrics, "recall_all@3-feasible")) {
      return score.metrics["recall_all@3-feasible"];
    }
  }
  if (hasOwn(score, key)) return score[key];
  if (key === "recall_all@3_feasible" && hasOwn(score, "recall_all@3-feasible")) {
    return score["recall_all@3-feasible"];
  }
  return undefined;
}

function isValidRankingScore(score) {
  if (!isRecord(score) || score.scoreable !== true || !Number.isSafeInteger(score.gold_evidence_count)) return false;
  if (score.gold_evidence_count < 1) return false;
  const recallAny = rankingMetric(score, "recall_any@3");
  const recallAll = rankingMetric(score, "recall_all@3");
  const ndcg = rankingMetric(score, "ndcg@3");
  const coverage = rankingMetric(score, "evidence_coverage@3");
  const feasible = rankingMetric(score, "budget_feasible@3");
  const feasibleRecall = rankingMetric(score, "recall_all@3_feasible");
  const firstRank = rankingMetric(score, "first_relevant_rank@3");
  return (recallAny === 0 || recallAny === 1)
    && (recallAll === 0 || recallAll === 1)
    && Number.isFinite(ndcg)
    && Number.isFinite(coverage)
    && typeof feasible === "boolean"
    && (feasibleRecall === null || feasibleRecall === 0 || feasibleRecall === 1)
    && (firstRank === null || firstRank === 1 || firstRank === 2 || firstRank === 3);
}

function rankingScoreRows(input, options = {}) {
  if (!Array.isArray(input)) return null;
  return input.map(row => {
    if (isValidRankingScore(row) || (isRecord(row) && row.schema === Q1_PRODUCT_METRIC_CONTRACT_SCHEMA && row.scoreable === false)) {
      return row;
    }
    if (isRecord(row) && (
      RANKING_INPUT_GOLD_KEYS.some(key => hasOwn(row, key))
      || RANKING_INPUT_RETRIEVED_KEYS.some(key => hasOwn(row, key))
    )) {
      return scoreQ1EvidenceRankingAt3(row, options);
    }
    const metadata = metadataFrom(row, options);
    return unknownRankingScore(metadata, "case_not_a_q1_ranking_score");
  });
}

function extractCollection(input, keys) {
  if (Array.isArray(input)) return { rows: input, defaults: {} };
  if (!isRecord(input)) return { rows: null, defaults: {} };
  const rows = firstOwnField([input], keys);
  return { rows: Array.isArray(rows) ? rows : null, defaults: input };
}

function mean(values) {
  const finite = values.filter(value => typeof value === "number" && Number.isFinite(value));
  return finite.length === 0 ? null : finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function rankingDistribution(scores) {
  const distribution = { rank_1: 0, rank_2: 0, rank_3: 0, miss: 0 };
  for (const score of scores) {
    const rank = rankingMetric(score, "first_relevant_rank@3");
    if (rank === 1) distribution.rank_1 += 1;
    else if (rank === 2) distribution.rank_2 += 1;
    else if (rank === 3) distribution.rank_3 += 1;
    else distribution.miss += 1;
  }
  return distribution;
}

function rankingCore(scores) {
  const validScores = scores.filter(isValidRankingScore);
  const feasible = validScores.filter(score => rankingMetric(score, "budget_feasible@3") === true);
  const infeasible = validScores.filter(score => rankingMetric(score, "budget_feasible@3") === false);
  const feasibleRecall = feasible.map(score => rankingMetric(score, "recall_all@3_feasible"));
  const crossSession = validScores.filter(score => score.gold_evidence_count >= 2);

  const metricValues = {
    "recall_any@3": mean(validScores.map(score => rankingMetric(score, "recall_any@3"))),
    "recall_all@3": mean(validScores.map(score => rankingMetric(score, "recall_all@3"))),
    "ndcg@3": mean(validScores.map(score => rankingMetric(score, "ndcg@3"))),
    "evidence_coverage@3": mean(validScores.map(score => rankingMetric(score, "evidence_coverage@3"))),
    "recall_all@3_feasible": mean(feasibleRecall),
  };

  return {
    scoreable_case_count: validScores.length,
    ...metricValues,
    budget_feasible_case_count: feasible.length,
    budget_infeasible_case_count: infeasible.length,
    cross_session_case_count: crossSession.length,
    "cross_session_evidence_coverage@3": mean(
      crossSession.map(score => rankingMetric(score, "evidence_coverage@3")),
    ),
    "first_relevant_rank@3": rankingDistribution(validScores),
  };
}

function rankingNullCore(scores) {
  const validScores = scores.filter(isValidRankingScore);
  const feasible = validScores.filter(score => rankingMetric(score, "budget_feasible@3") === true);
  const infeasible = validScores.filter(score => rankingMetric(score, "budget_feasible@3") === false);
  const crossSession = validScores.filter(score => score.gold_evidence_count >= 2);
  return {
    scoreable_case_count: validScores.length,
    "recall_any@3": null,
    "recall_all@3": null,
    "ndcg@3": null,
    "evidence_coverage@3": null,
    "recall_all@3_feasible": null,
    budget_feasible_case_count: feasible.length,
    budget_infeasible_case_count: infeasible.length,
    cross_session_case_count: crossSession.length,
    "cross_session_evidence_coverage@3": null,
    "first_relevant_rank@3": null,
  };
}

function rankingReportWithMetrics(core) {
  const metrics = rankingMetricsWithAliases({
    "recall_any@3": core["recall_any@3"],
    "recall_all@3": core["recall_all@3"],
    "ndcg@3": core["ndcg@3"],
    "evidence_coverage@3": core["evidence_coverage@3"],
    "recall_all@3_feasible": core["recall_all@3_feasible"],
  });
  return {
    ...core,
    metrics,
    ...metrics,
    "first_relevant_rank_distribution": core["first_relevant_rank@3"],
    "recall_all@3-feasible": core["recall_all@3_feasible"],
  };
}

function unknownReasons(rows) {
  const counts = {};
  for (const row of rows) {
    if (isValidRankingScore(row)) continue;
    const reason = row?.unknown_reason ?? "invalid_or_unscoreable_case";
    counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
}

function groupRows(rows, options) {
  const groups = new Map();
  for (const row of rows) {
    const metadata = metadataFrom(row, options);
    const key = metadataGroupKey(metadata);
    if (!groups.has(key)) groups.set(key, { metadata, rows: [] });
    groups.get(key).rows.push(row);
  }
  return groups;
}

/**
 * Macro-aggregate Q1 evidence-ranking case scores. Known incompatible
 * provenance/source groups are returned separately and never pooled.
 */
export function aggregateQ1EvidenceRankingAt3(input, options = {}) {
  const collection = extractCollection(input, ["cases", "scores", "results"]);
  if (!Array.isArray(collection.rows)) {
    const empty = rankingReportWithMetrics(rankingNullCore([]));
    return {
      schema: Q1_PRODUCT_METRIC_CONTRACT_SCHEMA,
      metric_family: "evidence_ranking",
      budget_k: Q1_EVIDENCE_BUDGET,
      valid: false,
      aggregation_status: "INVALID_INPUT",
      aggregation_refused: true,
      case_count: 0,
      unknown_or_unscoreable_case_count: 0,
      unknown_or_unscoreable_by_reason: {},
      provenance: null,
      source_identity: null,
      dataset_identity: null,
      source: null,
      dataset: null,
      attribution_complete: false,
      provenance_validation: validateQ1MetricProvenance([], options),
      by_provenance_source: [],
      ...empty,
    };
  }

  const effectiveOptions = { ...collection.defaults, ...options };
  const rows = rankingScoreRows(collection.rows, effectiveOptions);
  const provenanceValidation = validateQ1MetricProvenance(rows, effectiveOptions);
  const core = provenanceValidation.compatible ? rankingCore(rows) : rankingNullCore(rows);
  const scoredCount = rows.filter(isValidRankingScore).length;
  const groups = groupRows(rows, effectiveOptions);
  const breakdown = [...groups.values()].map(({ metadata, rows: group }) => ({
    ...metadataGroupFields(metadata),
    ...rankingReportWithMetrics(rankingCore(group)),
    case_count: group.length,
    unknown_or_unscoreable_case_count: group.length - group.filter(isValidRankingScore).length,
    unknown_or_unscoreable_by_reason: unknownReasons(group),
    attribution_complete: metadata.attribution_complete,
  }));
  const attribution = groups.size === 1
    ? attributionFields([...groups.values()][0].metadata)
    : {
      provenance: null,
      source_identity: null,
      dataset_identity: null,
      source: null,
      dataset: null,
      attribution_complete: false,
    };

  const status = !provenanceValidation.compatible
    ? "REFUSED_INCOMPATIBLE_PROVENANCE"
    : (provenanceValidation.complete ? "READY" : "INCOMPLETE_PROVENANCE");
  return {
    schema: Q1_PRODUCT_METRIC_CONTRACT_SCHEMA,
    metric_family: "evidence_ranking",
    budget_k: Q1_EVIDENCE_BUDGET,
    valid: provenanceValidation.valid,
    aggregation_status: status,
    aggregation_refused: !provenanceValidation.compatible,
    case_count: rows.length,
    unknown_or_unscoreable_case_count: rows.length - scoredCount,
    unknown_or_unscoreable_by_reason: unknownReasons(rows),
    ...attribution,
    provenance_validation: provenanceValidation,
    by_provenance_source: breakdown,
    ...rankingReportWithMetrics(core),
  };
}

export const aggregateQ1EvidenceRanking = aggregateQ1EvidenceRankingAt3;

function triggerInput(input, actualArgument, optionsArgument) {
  if (isRecord(input)) {
    const options = isRecord(actualArgument)
      ? actualArgument
      : (isRecord(optionsArgument) ? optionsArgument : {});
    return {
      payload: input,
      options,
      expected: firstOwnField([input], ["expected_should_recall", "expectedShouldRecall"]),
      actual: firstOwnField([input], ["actual_should_recall", "actualShouldRecall"]),
    };
  }
  return {
    payload: {},
    options: isRecord(optionsArgument) ? optionsArgument : {},
    expected: input,
    actual: actualArgument,
  };
}

function unknownTriggerScore(metadata, reason, expected = null) {
  return {
    schema: Q1_PRODUCT_METRIC_CONTRACT_SCHEMA,
    metric_family: "trigger_decision",
    scoreable: false,
    unknown: true,
    unknown_or_unscoreable: true,
    unknown_reason: reason,
    expected_should_recall: expected,
    actual_should_recall: null,
    classification: "UNKNOWN",
    ...attributionFields(metadata),
  };
}

/** Score one labeled trigger turn without coercing an unknown actual result. */
export function scoreQ1TriggerDecision(input, actualArgument, optionsArgument) {
  const { payload, options, expected, actual } = triggerInput(input, actualArgument, optionsArgument);
  const metadata = metadataFrom(payload, options);
  if (typeof expected !== "boolean") {
    return unknownTriggerScore(metadata, "expected_should_recall_must_be_boolean", null);
  }
  if (typeof actual !== "boolean") {
    return {
      schema: Q1_PRODUCT_METRIC_CONTRACT_SCHEMA,
      metric_family: "trigger_decision",
      scoreable: true,
      unknown: true,
      unknown_or_unscoreable: false,
      unknown_reason: "actual_should_recall_unknown",
      expected_should_recall: expected,
      actual_should_recall: null,
      classification: "UNKNOWN",
      ...attributionFields(metadata),
    };
  }

  let classification;
  if (expected && actual) classification = "TP";
  else if (!expected && !actual) classification = "TN";
  else if (!expected && actual) classification = "FP";
  else classification = "FN";
  return {
    schema: Q1_PRODUCT_METRIC_CONTRACT_SCHEMA,
    metric_family: "trigger_decision",
    scoreable: true,
    unknown: false,
    unknown_or_unscoreable: false,
    unknown_reason: null,
    expected_should_recall: expected,
    actual_should_recall: actual,
    classification,
    ...attributionFields(metadata),
  };
}

export const scoreQ1TriggerTurn = scoreQ1TriggerDecision;

function isTriggerScore(row) {
  return isRecord(row)
    && typeof row.expected_should_recall === "boolean"
    && ["TP", "TN", "FP", "FN", "UNKNOWN"].includes(row.classification)
    && row.schema === Q1_PRODUCT_METRIC_CONTRACT_SCHEMA;
}

function triggerRows(input, options) {
  if (!Array.isArray(input)) return null;
  return input.map(row => {
    if (isTriggerScore(row)) return row;
    if (isRecord(row) && (
      hasOwn(row, "expected_should_recall") || hasOwn(row, "expectedShouldRecall")
    )) return scoreQ1TriggerDecision(row, options);
    return unknownTriggerScore(metadataFrom(row, options), "turn_not_a_q1_trigger_case");
  });
}

function triggerCore(rows) {
  const labeled = rows.filter(row => typeof row?.expected_should_recall === "boolean");
  const counts = { TP: 0, TN: 0, FP: 0, FN: 0 };
  let unknownDecisionCount = 0;
  for (const row of labeled) {
    if (counts[row.classification] !== undefined) counts[row.classification] += 1;
    else unknownDecisionCount += 1;
  }
  const positiveDenominator = counts.TP + counts.FN;
  const negativeDenominator = counts.FP + counts.TN;
  const precisionDenominator = counts.TP + counts.FP;
  const metrics = {
    trigger_recall: positiveDenominator === 0 ? null : counts.TP / positiveDenominator,
    unnecessary_recall_rate: negativeDenominator === 0 ? null : counts.FP / negativeDenominator,
    trigger_precision: precisionDenominator === 0 ? null : counts.TP / precisionDenominator,
  };
  return {
    labeled_turn_count: labeled.length,
    labeled_positive_count: labeled.filter(row => row.expected_should_recall === true).length,
    labeled_negative_count: labeled.filter(row => row.expected_should_recall === false).length,
    unknown_decision_count: unknownDecisionCount,
    classified_turn_count: counts.TP + counts.TN + counts.FP + counts.FN,
    ...counts,
    ...metrics,
    metrics,
  };
}

function triggerNullCore(rows) {
  const core = triggerCore(rows);
  return {
    ...core,
    trigger_recall: null,
    unnecessary_recall_rate: null,
    trigger_precision: null,
    metrics: {
      trigger_recall: null,
      unnecessary_recall_rate: null,
      trigger_precision: null,
    },
  };
}

/** Aggregate trigger decisions, excluding UNKNOWN actual results. */
export function aggregateQ1TriggerDecision(input, options = {}) {
  const collection = extractCollection(input, ["turns", "decisions", "cases", "results"]);
  if (!Array.isArray(collection.rows)) {
    return {
      schema: Q1_PRODUCT_METRIC_CONTRACT_SCHEMA,
      metric_family: "trigger_decision",
      valid: false,
      aggregation_status: "INVALID_INPUT",
      aggregation_refused: true,
      unknown_or_unscoreable_turn_count: 0,
      unknown_or_unscoreable_by_reason: {},
      provenance: null,
      source_identity: null,
      dataset_identity: null,
      source: null,
      dataset: null,
      attribution_complete: false,
      provenance_validation: validateQ1MetricProvenance([], options),
      ...triggerNullCore([]),
    };
  }

  const effectiveOptions = { ...collection.defaults, ...options };
  const rows = triggerRows(collection.rows, effectiveOptions);
  const provenanceValidation = validateQ1MetricProvenance(rows, effectiveOptions);
  const core = provenanceValidation.compatible ? triggerCore(rows) : triggerNullCore(rows);
  const groups = groupRows(rows, effectiveOptions);
  const breakdown = [...groups.values()].map(({ metadata, rows: group }) => ({
    ...metadataGroupFields(metadata),
    ...triggerCore(group),
    case_count: group.length,
    unknown_or_unscoreable_turn_count: group.filter(row => typeof row?.expected_should_recall !== "boolean").length,
    attribution_complete: metadata.attribution_complete,
  }));
  const unknownCount = rows.filter(row => typeof row?.expected_should_recall !== "boolean").length;
  const attribution = groups.size === 1
    ? attributionFields([...groups.values()][0].metadata)
    : {
      provenance: null,
      source_identity: null,
      dataset_identity: null,
      source: null,
      dataset: null,
      attribution_complete: false,
    };
  const status = !provenanceValidation.compatible
    ? "REFUSED_INCOMPATIBLE_PROVENANCE"
    : (provenanceValidation.complete ? "READY" : "INCOMPLETE_PROVENANCE");
  return {
    schema: Q1_PRODUCT_METRIC_CONTRACT_SCHEMA,
    metric_family: "trigger_decision",
    valid: provenanceValidation.valid,
    aggregation_status: status,
    aggregation_refused: !provenanceValidation.compatible,
    case_count: rows.length,
    unknown_or_unscoreable_turn_count: unknownCount,
    unknown_or_unscoreable_by_reason: Object.fromEntries(
      rows.filter(row => typeof row?.expected_should_recall !== "boolean")
        .reduce((map, row) => {
          const reason = row?.unknown_reason ?? "turn_not_scoreable";
          map.set(reason, (map.get(reason) ?? 0) + 1);
          return map;
        }, new Map()),
    ),
    ...attribution,
    provenance_validation: provenanceValidation,
    by_provenance_source: breakdown,
    ...core,
  };
}

export const aggregateQ1TriggerMetrics = aggregateQ1TriggerDecision;
export const aggregateQ1Trigger = aggregateQ1TriggerDecision;

function safetyAuthorityPresent(candidate, kind) {
  const directKeys = kind === "stale"
    ? ["stale_authority", "lifecycle_authority", "supersession_authority", "lifecycle_state_authority"]
    : [
      "conflict_authority",
      "canonical_conflict_authority",
      "canonical_conflict_state",
      "gold_conflict_authority",
      "frozen_gold_label",
      "conflict_gold_label",
    ];
  for (const key of directKeys) {
    if (hasOwn(candidate, key) && isNonEmptyIdentity(candidate[key])) return true;
  }
  for (const key of ["safety_authority", "authority"]) {
    const authority = candidate?.[key];
    if (!isRecord(authority)) continue;
    if (isNonEmptyIdentity(authority[kind]) || isNonEmptyIdentity(authority[`${kind}_authority`])) return true;
  }
  return false;
}

function safetyLabel(candidate, key) {
  if (!hasOwn(candidate, key)) return { present: false, known: false, value: null };
  const value = candidate[key];
  if (value === true || value === false) return { present: true, known: true, value };
  return { present: true, known: false, value: null };
}

function safetyCandidates(input) {
  if (Array.isArray(input)) return { candidates: input, payload: {} };
  if (!isRecord(input)) return { candidates: null, payload: {} };
  return {
    candidates: firstOwnField([input], ["candidates", "ranked_candidates", "top3", "served_candidates"]),
    payload: input,
  };
}

/** Score safety labels for an already-ranked top-three candidate list. */
export function scoreQ1Top3Safety(input, options = {}) {
  const { candidates, payload } = safetyCandidates(input);
  const metadata = metadataFrom(payload, options);
  if (!Array.isArray(candidates)) {
    const metrics = {
      top3_fill_rate: null,
      stale_top3_slot_rate: null,
      conflict_top3_slot_rate: null,
      stale_or_conflict_top3_slot_rate: null,
    };
    return {
      schema: Q1_PRODUCT_METRIC_CONTRACT_SCHEMA,
      metric_family: "top3_safety",
      safety_evidence_status: "INSUFFICIENT_EVIDENCE",
      insufficient_evidence: true,
      insufficient_evidence_reasons: ["served_candidates_must_be_array"],
      served_top3_count: null,
      top3_fill_rate: null,
      stale_top3_slot_rate: null,
      conflict_top3_slot_rate: null,
      stale_or_conflict_top3_slot_rate: null,
      metrics,
      ...attributionFields(metadata),
    };
  }

  const served = candidates.slice(0, Q1_EVIDENCE_BUDGET);
  let staleCount = 0;
  let conflictCount = 0;
  let unionCount = 0;
  const reasons = [];

  served.forEach((candidate, index) => {
    if (!isRecord(candidate)) {
      reasons.push(`candidate_${index}_must_be_object`);
      return;
    }
    const stale = safetyLabel(candidate, "stale");
    const conflict = safetyLabel(candidate, "conflict");
    if (!stale.present) reasons.push(`candidate_${index}_stale_label_missing`);
    else if (!stale.known) reasons.push(`candidate_${index}_stale_label_unknown`);
    if (!conflict.present) reasons.push(`candidate_${index}_conflict_label_missing`);
    else if (!conflict.known) reasons.push(`candidate_${index}_conflict_label_unknown`);
    if (stale.known && stale.value === true && !safetyAuthorityPresent(candidate, "stale")) {
      reasons.push(`candidate_${index}_stale_authority_missing`);
    }
    if (conflict.known && conflict.value === true && !safetyAuthorityPresent(candidate, "conflict")) {
      reasons.push(`candidate_${index}_conflict_authority_missing`);
    }
    if (stale.known && stale.value === true) staleCount += 1;
    if (conflict.known && conflict.value === true) conflictCount += 1;
    if (stale.known && stale.value === true || conflict.known && conflict.value === true) unionCount += 1;
  });

  const servedCount = served.length;
  const fillRate = servedCount / Q1_EVIDENCE_BUDGET;
  const complete = servedCount > 0 && reasons.length === 0;
  const metrics = {
    top3_fill_rate: fillRate,
    stale_top3_slot_rate: complete ? staleCount / servedCount : null,
    conflict_top3_slot_rate: complete ? conflictCount / servedCount : null,
    stale_or_conflict_top3_slot_rate: complete ? unionCount / servedCount : null,
  };
  if (servedCount === 0) reasons.push("no_served_top3_slots");
  return {
    schema: Q1_PRODUCT_METRIC_CONTRACT_SCHEMA,
    metric_family: "top3_safety",
    safety_evidence_status: complete ? "MEASURED" : "INSUFFICIENT_EVIDENCE",
    insufficient_evidence: !complete,
    insufficient_evidence_reasons: [...new Set(reasons)],
    served_top3_count: servedCount,
    stale_top3_slot_count: staleCount,
    conflict_top3_slot_count: conflictCount,
    stale_or_conflict_top3_slot_count: unionCount,
    ...metrics,
    metrics,
    ...attributionFields(metadata),
  };
}

export const scoreQ1Top3SafetyContract = scoreQ1Top3Safety;
export const scoreQ1Top3StaleConflictSafety = scoreQ1Top3Safety;

const IRRELEVANT_KEYS = Object.freeze([
  "irrelevant",
  "is_irrelevant",
  "irrelevant_label",
  "label_irrelevant",
]);
const SEVERE_CONFLICT_KEYS = Object.freeze([
  "severe_context_conflict",
  "severe_conflict",
  "context_conflict",
  "label_severe_context_conflict",
]);
const STALE_INAPPROPRIATE_KEYS = Object.freeze([
  "stale_or_superseded_inappropriate",
  "stale_or_superseded_inappropriate_for_context",
  "stale_or_superseded",
  "stale_inappropriate",
  "stale_inappropriate_for_context",
  "superseded_inappropriate",
  "stale_or_superseded_content_inappropriate",
]);

function reviewLabel(item, keys) {
  if (!isRecord(item)) return { present: false, known: false, value: null };
  for (const key of keys) {
    if (!hasOwn(item, key)) continue;
    const value = item[key];
    return value === true || value === false
      ? { present: true, known: true, value }
      : { present: true, known: false, value: null };
  }
  return { present: false, known: false, value: null };
}

/** Score explicit item-level injection review labels. */
export function scoreQ1InjectionReviewItem(item, options = {}) {
  const metadata = metadataFrom(item, options);
  const irrelevant = reviewLabel(item, IRRELEVANT_KEYS);
  const severeConflict = reviewLabel(item, SEVERE_CONFLICT_KEYS);
  const staleInappropriate = reviewLabel(item, STALE_INAPPROPRIATE_KEYS);
  const labelsComplete = irrelevant.known && severeConflict.known && staleInappropriate.known;
  return {
    schema: Q1_PRODUCT_METRIC_CONTRACT_SCHEMA,
    metric_family: "injection_quality",
    scoreable: isRecord(item),
    reviewed: item?.reviewed !== false,
    irrelevant: irrelevant.known ? irrelevant.value : null,
    severe_context_conflict: severeConflict.known ? severeConflict.value : null,
    stale_or_superseded_inappropriate: staleInappropriate.known ? staleInappropriate.value : null,
    labels_complete: labelsComplete,
    context_pollution: labelsComplete
      ? Boolean(irrelevant.value || severeConflict.value || staleInappropriate.value)
      : null,
    unknown_label_count: [irrelevant, severeConflict, staleInappropriate].filter(label => !label.known).length,
    ...attributionFields(metadata),
  };
}

function pollutionCollection(input) {
  if (Array.isArray(input)) return { items: input, defaults: {}, aggregate: null };
  if (isRecord(input) && Array.isArray(input.items)) return { items: input.items, defaults: input, aggregate: null };
  return { items: null, defaults: isRecord(input) ? input : {}, aggregate: isRecord(input) ? input : null };
}

function countField(input, keys) {
  const value = firstOwnField([input], keys);
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function pollutionReportFields(metadata) {
  return {
    ...attributionFields(metadata),
    schema: Q1_PRODUCT_METRIC_CONTRACT_SCHEMA,
    metric_family: "injection_quality",
  };
}

/**
 * Aggregate item-level review labels, or preserve NOT_MEASURABLE for an
 * aggregate-only input whose pollution overlap cannot be reconstructed.
 */
export function aggregateQ1InjectionReview(input, options = {}) {
  const collection = pollutionCollection(input);
  if (Array.isArray(collection.items)) {
    const effectiveOptions = { ...collection.defaults, ...options };
    const scored = collection.items.map(item => scoreQ1InjectionReviewItem(item, effectiveOptions));
    const reviewed = scored.filter(item => item.scoreable && item.reviewed);
    const irrelevantLabelsKnown = reviewed.every(item => item.irrelevant !== null);
    const contextLabelsKnown = reviewed.every(item => item.labels_complete);
    const irrelevantCount = reviewed.filter(item => item.irrelevant === true).length;
    const severeConflictCount = reviewed.filter(item => item.severe_context_conflict === true).length;
    const staleCount = reviewed.filter(item => item.stale_or_superseded_inappropriate === true).length;
    const pollutedItems = reviewed.filter(item => item.context_pollution === true);
    const provenanceValidation = validateQ1MetricProvenance(scored, effectiveOptions);
    const groups = groupRows(scored, effectiveOptions);
    const metadata = groups.size === 1
      ? [...groups.values()][0].metadata
      : metadataFrom(input, effectiveOptions);
    const provenanceCompatible = provenanceValidation.compatible;
    const reviewedCount = reviewed.length;
    const irrelevantRate = reviewedCount === 0
      ? null
      : (irrelevantLabelsKnown && provenanceCompatible ? irrelevantCount / reviewedCount : Q1_NOT_MEASURABLE);
    const contextRate = reviewedCount === 0
      ? null
      : (contextLabelsKnown && provenanceCompatible ? pollutedItems.length / reviewedCount : Q1_NOT_MEASURABLE);
    return {
      ...pollutionReportFields(metadata),
      mode: "ITEM_LEVEL",
      aggregation_status: !provenanceCompatible
        ? "REFUSED_INCOMPATIBLE_PROVENANCE"
        : (provenanceValidation.complete ? "READY" : "INCOMPLETE_PROVENANCE"),
      aggregation_refused: !provenanceCompatible,
      provenance_validation: provenanceValidation,
      by_provenance_source: provenanceValidation.groups,
      reviewed_injection_count: reviewedCount,
      reviewed_injected_memory_count: reviewedCount,
      irrelevant_count: irrelevantCount,
      irrelevant_injection_count: irrelevantCount,
      severe_context_conflict_count: severeConflictCount,
      stale_or_superseded_inappropriate_count: staleCount,
      context_pollution_unique_count: contextLabelsKnown && provenanceCompatible ? pollutedItems.length : null,
      irrelevant_injection_rate: irrelevantRate,
      context_pollution_rate: contextRate,
      context_pollution_status: reviewedCount === 0
        ? "NO_REVIEWED_SAMPLES"
        : (!provenanceCompatible
          ? "REFUSED_INCOMPATIBLE_PROVENANCE"
          : (contextLabelsKnown ? "MEASURABLE" : Q1_NOT_MEASURABLE)),
      unknown_review_item_count: scored.length - reviewed.length,
      unknown_irrelevant_label_count: reviewed.filter(item => item.irrelevant === null).length,
      unknown_context_label_count: reviewed.filter(item => !item.labels_complete).length,
      metrics: {
        irrelevant_injection_rate: irrelevantRate,
        context_pollution_rate: contextRate,
      },
    };
  }

  const aggregate = collection.aggregate;
  const metadata = metadataFrom(aggregate, options);
  const provenanceValidation = validateQ1MetricProvenance([aggregate], options);
  const reviewedCount = countField(aggregate, ["reviewed_injection_count", "reviewed_injected_memory_count"]);
  const irrelevantCount = countField(aggregate, ["irrelevant_count", "irrelevant_injection_count"]);
  const severeConflictCount = countField(aggregate, [
    "severe_context_conflict_count",
    "severe_conflict_count",
    "severe_irrelevant_or_context_conflict_count",
  ]);
  const staleCount = countField(aggregate, [
    "stale_or_superseded_inappropriate_count",
    "stale_inappropriate_count",
  ]);
  const explicitPollutionCount = countField(aggregate, [
    "context_pollution_unique_count",
    "context_pollution_count",
  ]);
  const irrelevantRate = reviewedCount === null || reviewedCount === 0 || irrelevantCount === null
    ? null
    : irrelevantCount / reviewedCount;
  const contextRate = reviewedCount === null || reviewedCount === 0
    ? null
    : (explicitPollutionCount === null ? Q1_NOT_MEASURABLE : explicitPollutionCount / reviewedCount);
  return {
    ...pollutionReportFields(metadata),
    mode: "AGGREGATE_ONLY",
    aggregation_status: provenanceValidation.complete ? "READY" : "INCOMPLETE_PROVENANCE",
    aggregation_refused: false,
    provenance_validation: provenanceValidation,
    by_provenance_source: provenanceValidation.groups,
    reviewed_injection_count: reviewedCount,
    reviewed_injected_memory_count: reviewedCount,
    irrelevant_count: irrelevantCount,
    irrelevant_injection_count: irrelevantCount,
    severe_context_conflict_count: severeConflictCount,
    stale_or_superseded_inappropriate_count: staleCount,
    context_pollution_unique_count: explicitPollutionCount,
    irrelevant_injection_rate: irrelevantRate,
    context_pollution_rate: contextRate,
    context_pollution_status: reviewedCount === null || reviewedCount === 0
      ? "NO_REVIEWED_SAMPLES"
      : (explicitPollutionCount === null ? Q1_NOT_MEASURABLE : "MEASURABLE"),
    unknown_review_item_count: 0,
    unknown_irrelevant_label_count: 0,
    unknown_context_label_count: explicitPollutionCount === null && reviewedCount > 0 ? 1 : 0,
    aggregate_overlap_reconstructed: explicitPollutionCount !== null,
    metrics: {
      irrelevant_injection_rate: irrelevantRate,
      context_pollution_rate: contextRate,
    },
  };
}

export const aggregateQ1InjectionQuality = aggregateQ1InjectionReview;
export const scoreQ1InjectionQuality = aggregateQ1InjectionReview;
export const scoreQ1ContextPollution = aggregateQ1InjectionReview;
export const aggregateQ1ContextPollution = aggregateQ1InjectionReview;

function latencyField(input, keys) {
  return firstOwnField([input], keys);
}

function nonNegativeCount(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function latencySampleValue(sample) {
  if (typeof sample === "number") return sample;
  if (isRecord(sample)) {
    const value = firstOwnField([sample], ["latency_ms", "recall_latency_ms", "duration_ms", "value"]);
    return value;
  }
  return null;
}

function nearestRankPercentile(values, probability) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(probability * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/** Summarize a latency window without applying any pass/fail threshold. */
export function summarizeQ1LatencyWindow(input, options = {}) {
  const payload = isRecord(input) ? input : {};
  const metadata = metadataFrom(payload, options);
  const startedRaw = latencyField(payload, ["started_trace_count", "recall_started_count", "started_count"]);
  const samplesRaw = latencyField(payload, [
    "completed_latency_samples",
    "completed_latencies_ms",
    "latency_samples",
  ]);
  const incompleteRaw = latencyField(payload, ["incomplete_trace_count", "incomplete_count"]);
  const errorRaw = latencyField(payload, ["error_or_timeout_count", "error_timeout_count"]);
  const started = nonNegativeCount(startedRaw);
  const incomplete = nonNegativeCount(incompleteRaw);
  const errorOrTimeout = nonNegativeCount(errorRaw);
  const samplesPresent = Array.isArray(samplesRaw);
  const samples = samplesPresent
    ? samplesRaw.map(latencySampleValue).filter(value => typeof value === "number" && Number.isFinite(value) && value >= 0)
    : [];
  const invalidSampleCount = samplesPresent ? samplesRaw.length - samples.length : 0;
  const countsComplete = started !== null && incomplete !== null && errorOrTimeout !== null && samplesPresent;
  const p50 = samples.length === 0 ? null : nearestRankPercentile(samples, 0.5);
  const p95 = samples.length === 0 ? null : nearestRankPercentile(samples, 0.95);
  const metrics = {
    latency_sample_count: samples.length,
    recall_latency_p50_ms: p50,
    recall_latency_p95_ms: p95,
    incomplete_trace_count: incomplete,
    incomplete_trace_rate: started === null || started === 0 || incomplete === null ? null : incomplete / started,
    error_or_timeout_count: errorOrTimeout,
    error_or_timeout_rate: started === null || started === 0 || errorOrTimeout === null
      ? null
      : errorOrTimeout / started,
  };
  return {
    schema: Q1_PRODUCT_METRIC_CONTRACT_SCHEMA,
    metric_family: "latency",
    latency_evidence_status: countsComplete ? "MEASURED" : "INCOMPLETE_EVIDENCE",
    started_trace_count: started,
    completed_latency_sample_count: samples.length,
    invalid_latency_sample_count: invalidSampleCount,
    ...metrics,
    metrics,
    ...attributionFields(metadata),
  };
}

export const summarizeQ1RecallLatency = summarizeQ1LatencyWindow;
export const summarizeQ1Latency = summarizeQ1LatencyWindow;

export function getQ1AnswerEvidenceCoverageStatus() {
  return Q1_ANSWER_EVIDENCE_COVERAGE_STATUS;
}

/**
 * Deliberately does not score answer use. Retrieval, injection, citation,
 * rank, and disclosure signals are not authoritative semantic-use labels.
 */
export function scoreQ1AnswerEvidenceCoverage(input = {}, options = {}) {
  const metadata = metadataFrom(input, options);
  return {
    schema: Q1_PRODUCT_METRIC_CONTRACT_SCHEMA,
    metric: "answer_evidence_coverage",
    answer_evidence_coverage: Q1_ANSWER_EVIDENCE_COVERAGE_STATUS,
    status: Q1_ANSWER_EVIDENCE_COVERAGE_STATUS,
    reason: "authoritative_final_answer_evidence_use_labels_are_not_available",
    ...attributionFields(metadata),
  };
}

export const answerEvidenceCoverageStatus = Q1_ANSWER_EVIDENCE_COVERAGE_STATUS;
