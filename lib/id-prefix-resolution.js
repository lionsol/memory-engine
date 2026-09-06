export function escapeSqliteGlobLiteral(value) {
  return String(value ?? "")
    .replace(/\[/g, "[[]")
    .replace(/\*/g, "[*]")
    .replace(/\?/g, "[?]");
}

export function buildLiteralPrefixGlob(value) {
  return `${escapeSqliteGlobLiteral(value)}*`;
}

export function resolveExactOrUniquePrefixRows(rows, lookupId, idField) {
  const normalizedId = typeof lookupId === "string" ? lookupId.trim() : "";
  if (!normalizedId) return { status: "invalid", row: null, matches: [] };
  const candidates = (Array.isArray(rows) ? rows : []).filter(row => {
    const id = row?.[idField];
    return (typeof id === "string" || typeof id === "number")
      && String(id).startsWith(normalizedId);
  });
  const exact = candidates.find(row => String(row[idField]) === normalizedId);
  if (exact) return { status: "resolved", row: exact, matches: [exact] };
  if (candidates.length === 0) return { status: "not_found", row: null, matches: [] };
  if (candidates.length === 1) return { status: "resolved", row: candidates[0], matches: candidates };
  return { status: "ambiguous", row: null, matches: candidates.slice(0, 2) };
}
