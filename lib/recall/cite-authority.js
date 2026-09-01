export const MEMORY_CITE_NOT_AUTHORIZED = "MEMORY_CITE_NOT_AUTHORIZED";

function normalizeId(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

export function citeIdsAreAuthorized(requestedIds, servedIds) {
  if (!Array.isArray(requestedIds) || requestedIds.length === 0) return false;
  const served = [...new Set((Array.isArray(servedIds) ? servedIds : [])
    .map(normalizeId)
    .filter(Boolean))];
  if (served.length === 0) return false;
  return requestedIds.every(value => {
    const requested = normalizeId(value);
    if (!requested) return false;
    const matches = served.filter(id => id.startsWith(requested));
    return matches.length === 1;
  });
}
