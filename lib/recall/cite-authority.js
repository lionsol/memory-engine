import { AMBIGUOUS_MEMORY_ID } from "../memory-confidence.js";

export const MEMORY_CITE_NOT_AUTHORIZED = "MEMORY_CITE_NOT_AUTHORIZED";

function normalizeId(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function uniqueExactIds(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const id = normalizeId(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function denied(code = MEMORY_CITE_NOT_AUTHORIZED) {
  return {
    authorized: false,
    resolved_ids: [],
    error: code,
    code,
  };
}

export function resolveAuthorizedMemoryIds(requestedIds, authorizedFullIds) {
  if (!Array.isArray(requestedIds) || requestedIds.length === 0) return denied();
  const authorized = uniqueExactIds(authorizedFullIds);
  if (authorized.length === 0) return denied();

  const resolved = [];
  const seen = new Set();
  for (const value of requestedIds) {
    const requested = normalizeId(value);
    if (!requested) return denied();

    const exactMatches = authorized.filter(id => id === requested);
    const matches = exactMatches.length > 0
      ? exactMatches
      : authorized.filter(id => id.startsWith(requested));
    if (matches.length === 0) return denied();
    if (matches.length > 1) return denied(AMBIGUOUS_MEMORY_ID);

    const exactId = matches[0];
    if (seen.has(exactId)) continue;
    seen.add(exactId);
    resolved.push(exactId);
  }

  return {
    authorized: true,
    resolved_ids: resolved,
    error: null,
    code: null,
  };
}

export function citeIdsAreAuthorized(requestedIds, servedIds) {
  return resolveAuthorizedMemoryIds(requestedIds, servedIds).authorized;
}
