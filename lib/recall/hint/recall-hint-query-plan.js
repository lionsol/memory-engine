import {
  normalizeRecallHintV1,
} from "./recall-hint-v1.js";

export const RECALL_HINT_V1_VECTOR_QUERY_MAX_CODE_POINTS = 512;

function truncateCodePoints(value, maxCodePoints) {
  return Array.from(value).slice(0, maxCodePoints).join("");
}

function contextTerms(normalizedHint) {
  const terms = [];
  if (normalizedHint.project) terms.push(`project:${normalizedHint.project}`);
  if (normalizedHint.entities?.length > 0) {
    terms.push(`entities:${normalizedHint.entities.join(" ")}`);
  }
  if (normalizedHint.time_relation) {
    terms.push(`time_relation:${normalizedHint.time_relation.relation}`);
    if (normalizedHint.time_relation.anchor) {
      terms.push(`time_anchor:${normalizedHint.time_relation.anchor}`);
    }
  }
  return terms;
}

function boundedExpansion(value, originalQuery) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  const bounded = truncateCodePoints(trimmed, RECALL_HINT_V1_VECTOR_QUERY_MAX_CODE_POINTS).trim();
  if (!bounded || bounded === originalQuery) return null;
  return bounded;
}

function uniqueExpansions(expansions, originalQuery) {
  const result = [];
  const seen = new Set();
  for (const expansion of expansions) {
    const bounded = boundedExpansion(expansion, originalQuery);
    if (!bounded || seen.has(bounded)) continue;
    seen.add(bounded);
    result.push(bounded);
    if (result.length === 2) break;
  }
  return result;
}

/**
 * Build only additional vector queries. The vector channel owns prepending
 * the original query and all candidate fusion/ranking behavior.
 */
export function buildRecallHintVectorQueryPlan(originalQuery, normalizedHint) {
  if (typeof originalQuery !== "string") return null;
  const query = originalQuery.trim();
  if (!query) return null;

  const hint = normalizeRecallHintV1(normalizedHint);
  if (!hint) return null;

  const context = contextTerms(hint);
  const expansions = [];
  if (hint.query_facets?.length > 0) {
    for (const facet of hint.query_facets) {
      expansions.push([query, facet, ...context].join(" "));
    }
  } else if (context.length > 0) {
    expansions.push([query, ...context].join(" "));
  }

  const queries = uniqueExpansions(expansions, query);
  if (queries.length === 0) return null;
  return Object.freeze({
    mode: "recall_hint_v1",
    queries: Object.freeze(queries),
  });
}
