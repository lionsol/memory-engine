export const RECALL_HINT_V1_VERSION = "recall_hint_v1";

export const RECALL_HINT_V1_RELATIONS = Object.freeze([
  "before",
  "after",
  "during",
  "latest",
  "earliest",
]);

export const RECALL_HINT_V1_BOUNDS = Object.freeze({
  projectCodePoints: 96,
  maxEntities: 4,
  entityCodePoints: 96,
  anchorCodePoints: 96,
  maxQueryFacets: 2,
  queryFacetCodePoints: 120,
});

const TOP_LEVEL_FIELDS = new Set([
  "version",
  "project",
  "entities",
  "time_relation",
  "query_facets",
]);

const TIME_RELATION_FIELDS = new Set(["relation", "anchor"]);

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function codePointLength(value) {
  return Array.from(value).length;
}

function trimOptionalString(value, field, maxCodePoints, errors) {
  if (value === undefined) return null;
  if (typeof value !== "string") {
    errors.push(`${field}_must_be_string`);
    return null;
  }
  const normalized = value.trim();
  if (!normalized) return null;
  if (codePointLength(normalized) > maxCodePoints) {
    errors.push(`${field}_exceeds_code_point_bound`);
    return null;
  }
  return normalized;
}

function normalizeBoundedStringArray(value, field, maxItems, maxCodePoints, errors) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${field}_must_be_array`);
    return [];
  }
  if (value.length > maxItems) {
    errors.push(`${field}_exceeds_item_bound`);
    return [];
  }

  const normalized = [];
  const seen = new Set();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string") {
      errors.push(`${field}[${index}]_must_be_string`);
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (codePointLength(trimmed) > maxCodePoints) {
      errors.push(`${field}[${index}]_exceeds_code_point_bound`);
      continue;
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function freezeNormalizedHint(hint) {
  if (Array.isArray(hint.entities)) Object.freeze(hint.entities);
  if (Array.isArray(hint.query_facets)) Object.freeze(hint.query_facets);
  if (hint.time_relation) Object.freeze(hint.time_relation);
  return Object.freeze(hint);
}

/**
 * Validate and normalize an injected Recall Hint without consulting runtime,
 * memory, network, or any other source of context.
 */
export function validateRecallHintV1(input) {
  const errors = [];
  if (!isPlainObject(input)) {
    return { valid: false, normalized: null, errors: ["hint_must_be_object"] };
  }

  for (const field of Object.keys(input)) {
    if (!TOP_LEVEL_FIELDS.has(field)) errors.push(`unknown_field:${field}`);
  }

  if (input.version !== RECALL_HINT_V1_VERSION) {
    errors.push("version_must_be_recall_hint_v1");
  }

  const project = trimOptionalString(
    input.project,
    "project",
    RECALL_HINT_V1_BOUNDS.projectCodePoints,
    errors,
  );
  const entities = normalizeBoundedStringArray(
    input.entities,
    "entities",
    RECALL_HINT_V1_BOUNDS.maxEntities,
    RECALL_HINT_V1_BOUNDS.entityCodePoints,
    errors,
  );
  const queryFacets = normalizeBoundedStringArray(
    input.query_facets,
    "query_facets",
    RECALL_HINT_V1_BOUNDS.maxQueryFacets,
    RECALL_HINT_V1_BOUNDS.queryFacetCodePoints,
    errors,
  );

  let timeRelation = null;
  if (input.time_relation !== undefined) {
    if (!isPlainObject(input.time_relation)) {
      errors.push("time_relation_must_be_object");
    } else {
      for (const field of Object.keys(input.time_relation)) {
        if (!TIME_RELATION_FIELDS.has(field)) errors.push(`unknown_time_relation_field:${field}`);
      }

      const relation = input.time_relation.relation;
      if (!RECALL_HINT_V1_RELATIONS.includes(relation)) {
        errors.push("time_relation_relation_invalid");
      } else {
        const anchor = trimOptionalString(
          input.time_relation.anchor,
          "time_relation_anchor",
          RECALL_HINT_V1_BOUNDS.anchorCodePoints,
          errors,
        );
        // before/after/during need producer evidence in the anchor. A missing
        // or whitespace-only anchor is a valid no-op, never an invented date.
        if (["before", "after", "during"].includes(relation) && !anchor) {
          timeRelation = null;
        } else {
          timeRelation = anchor ? { relation, anchor } : { relation };
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, normalized: null, errors: [...new Set(errors)] };
  }

  const normalized = { version: RECALL_HINT_V1_VERSION };
  if (project) normalized.project = project;
  if (entities.length > 0) normalized.entities = entities;
  if (timeRelation) normalized.time_relation = timeRelation;
  if (queryFacets.length > 0) normalized.query_facets = queryFacets;
  return {
    valid: true,
    normalized: freezeNormalizedHint(normalized),
    errors: [],
  };
}

/**
 * Return the normalized Hint or null when the input is not a valid v1 Hint.
 */
export function normalizeRecallHintV1(input) {
  return validateRecallHintV1(input).normalized;
}
