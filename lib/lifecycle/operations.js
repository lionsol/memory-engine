function tokenizeConflictText(text) {
  return String(text || "")
    .toLowerCase()
    .match(/[\p{L}\p{N}_-]{2,}/gu) || [];
}

export function conflictTextOverlap(row) {
  const left = new Set(tokenizeConflictText(`${row.path1 || ""}\n${row.text1 || ""}`));
  const right = new Set(tokenizeConflictText(`${row.path2 || ""}\n${row.text2 || ""}`));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared / Math.min(left.size, right.size);
}

export function archiveLowConfidence(db, {
  threshold,
  shouldArchive,
  dryRun = false,
  onArchived = null,
} = {}) {
  if (!db || typeof db.prepare !== "function") throw new TypeError("archiveLowConfidence requires a database handle");
  if (!Number.isFinite(Number(threshold))) throw new TypeError("archiveLowConfidence requires a finite threshold");
  if (typeof shouldArchive !== "function") throw new TypeError("archiveLowConfidence requires shouldArchive(row)");

  const rows = db.prepare([
    "SELECT chunk_id, confidence, last_confidence_update, hit_count, base_tau,",
    "is_protected, category",
    "FROM memory_confidence",
    "WHERE is_archived = 0 AND is_protected = 0 AND category != 'user_identity'",
  ].join(" ")).all();
  const ids = [...new Set(rows.filter(row => shouldArchive(row, Number(threshold))).map(row => row.chunk_id))];

  if (!dryRun && ids.length > 0) {
    const update = db.prepare("UPDATE memory_confidence SET is_archived = 1 WHERE chunk_id = ? AND is_archived = 0");
    const transaction = db.transaction(() => {
      for (const id of ids) {
        const info = update.run(id);
        if (Number(info?.changes ?? 1) > 0 && typeof onArchived === "function") onArchived(id);
      }
    });
    transaction();
  }

  return {
    scanned: rows.length,
    archived: ids.length,
    ids,
    threshold: Number(threshold),
    dry_run: Boolean(dryRun),
  };
}

export function buildKgSubgraph(nodes = [], edges = []) {
  return {
    node_count: nodes.length,
    edge_count: edges.length,
    nodes: nodes.slice(0, 20).map(node => ({
      id: node.id || node.name,
      name: node.name || node.id,
      type: node.type || "concept",
      properties: node.properties || {},
    })),
    edges: edges.slice(0, 30).map(edge => ({
      source: edge.source || edge.from,
      target: edge.target || edge.to,
      type: edge.type || "RELATED_TO",
    })),
  };
}

export function applyKgBridge(db, {
  nodes = [],
  edges = [],
  limit = 10,
  dryRun = false,
  onCompleted = null,
} = {}) {
  if (!db || typeof db.prepare !== "function") throw new TypeError("applyKgBridge requires a database handle");
  const normalizedLimit = Math.max(0, Number(limit) || 0);
  const matches = db.prepare([
    "SELECT chunk_id FROM memory_confidence",
    "WHERE category IN ('kg_node', 'raw_log')",
    "ORDER BY last_confidence_update DESC",
    "LIMIT ?",
  ].join(" ")).all(normalizedLimit);
  const subgraph = buildKgSubgraph(nodes, edges);

  if (!dryRun && matches.length > 0) {
    const update = db.prepare("UPDATE memory_confidence SET kg_data = ? WHERE chunk_id = ?");
    const payload = JSON.stringify(subgraph);
    const transaction = db.transaction(() => {
      for (const row of matches) update.run(payload, row.chunk_id);
      if (typeof onCompleted === "function") onCompleted({
        nodes: nodes.length,
        edges: edges.length,
        chunks_updated: matches.length,
      });
    });
    transaction();
  }

  return {
    success: true,
    nodes: nodes.length,
    edges: edges.length,
    chunks_updated: matches.length,
    dry_run: Boolean(dryRun),
  };
}

export function detectRelatedConflicts(db, {
  overlapThreshold = 0.2,
  dryRun = false,
  onFlagged = null,
  chunksTable = "chunks",
} = {}) {
  if (!db || typeof db.prepare !== "function") throw new TypeError("detectRelatedConflicts requires a database handle");
  if (!["chunks", "core.chunks"].includes(chunksTable)) {
    throw new TypeError("detectRelatedConflicts chunksTable must be chunks or core.chunks");
  }
  const rows = db.prepare([
    "SELECT m1.chunk_id AS id1, m2.chunk_id AS id2,",
    "m1.category, m1.confidence AS c1, m2.confidence AS c2,",
    "m1.hit_count AS h1, m2.hit_count AS h2,",
    "c1.text AS text1, c2.text AS text2,",
    "c1.path AS path1, c2.path AS path2",
    "FROM memory_confidence m1",
    "JOIN memory_confidence m2 ON m1.category = m2.category",
    "AND m1.chunk_id < m2.chunk_id",
    `JOIN ${chunksTable} c1 ON c1.id = m1.chunk_id`,
    `JOIN ${chunksTable} c2 ON c2.id = m2.chunk_id`,
    "WHERE m1.is_archived = 0 AND m2.is_archived = 0",
    "AND ABS(m1.confidence - m2.confidence) > 0.3",
    "AND ABS(m1.hit_count - m2.hit_count) > 3",
    "ORDER BY m1.category, MAX(m1.last_confidence_update, m2.last_confidence_update) DESC",
    "LIMIT 500",
  ].join(" ")).all();

  const ids = [...new Set(rows
    .filter(row => conflictTextOverlap(row) >= Number(overlapThreshold))
    .map(row => Number(row.c1) < Number(row.c2) ? row.id1 : row.id2))];

  if (!dryRun && ids.length > 0) {
    const update = db.prepare("UPDATE memory_confidence SET conflict_flag = 1 WHERE chunk_id = ? AND is_archived = 0");
    const transaction = db.transaction(() => {
      for (const id of ids) {
        const info = update.run(id);
        if (Number(info?.changes ?? 1) > 0 && typeof onFlagged === "function") onFlagged(id, rows.length);
      }
    });
    transaction();
  }

  return {
    success: true,
    pairs_checked: rows.length,
    flagged_as_conflict: ids.length,
    ids,
    dry_run: Boolean(dryRun),
    note: "Lower-confidence related chunks in same category with divergent hit counts flagged",
  };
}
