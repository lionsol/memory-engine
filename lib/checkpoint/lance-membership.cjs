const LANCE_QUERY_BATCH_SIZE = 400;

function chunked(values, size = LANCE_QUERY_BATCH_SIZE) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function buildIdPredicate(ids) {
  const escaped = ids.map(id => `'${String(id).replace(/'/g, "''")}'`);
  return escaped.length === 1
    ? `id = ${escaped[0]}`
    : `id IN (${escaped.join(", ")})`;
}

async function materializeRows(value) {
  const resolved = await value;
  if (Array.isArray(resolved)) return resolved;
  if (resolved && typeof resolved[Symbol.asyncIterator] === "function") {
    const rows = [];
    for await (const page of resolved) rows.push(...(Array.isArray(page) ? page : [page]));
    return rows;
  }
  if (resolved && typeof resolved[Symbol.iterator] === "function") return [...resolved];
  return [];
}

async function readScopedLanceIds(table, ids) {
  const lanceIds = new Set();
  for (const batch of chunked(ids)) {
    if (batch.length === 0) continue;
    let query = typeof table?.query === "function"
      ? table.query()
      : typeof table?.search === "function"
        ? table.search(new Array(2560).fill(0))
        : null;
    if (!query || typeof query.where !== "function") {
      throw new Error("scoped Lance reconciliation requires filtered query support");
    }
    query = query.where(buildIdPredicate(batch)) || query;
    if (typeof query.select === "function") query = query.select(["id"]) || query;
    if (typeof query.limit === "function") query = query.limit(batch.length) || query;
    let rows;
    if (typeof query.toArray === "function") {
      rows = await materializeRows(query.toArray());
    } else if (typeof query.execute === "function") {
      rows = await materializeRows(query.execute());
    } else if (query && typeof query[Symbol.asyncIterator] === "function") {
      rows = [];
      for await (const page of query) rows.push(...(Array.isArray(page) ? page : [page]));
    } else {
      throw new Error("scoped Lance reconciliation requires a materializable filtered query");
    }
    for (const row of rows || []) {
      if (row?.id !== undefined && row?.id !== null) lanceIds.add(String(row.id));
    }
  }
  return lanceIds;
}

module.exports = {
  LANCE_QUERY_BATCH_SIZE,
  readScopedLanceIds,
};
