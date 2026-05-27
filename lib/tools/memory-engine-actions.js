export function createMemoryEngineExecute(runtime) {
  const {
    api,
    autoRouteCategory,
    dateStrInTimeZone,
    SMART_ADD_TIME_ZONE,
    resolve,
    WORKSPACE,
    SMART_ADD_DIR,
    buildSmartAddFingerprint,
    appendSmartAdd,
    syncIndexIfNeeded,
    catParams,
    withDb,
    getLancedbTable,
    generateEmbedding,
    recordMemoryEvent,
    getMemorySearchManager,
    sanitizeFtsQuery,
    calcRealtimeConf,
    existsSync,
    readFileSync,
    KG_PATH,
    resolvePrefixes,
    batchReinforce,
    CATEGORY_MAP,
    calcTau,
  } = runtime;

  return async function executeMemoryEngineAction(_toolCallId, params) {
    const lancedbTable = getLancedbTable();
        const { action, text, category, protected: isProtected, chunk_id, hit, top_k, deep } = params;
        const k = top_k || 5;
        const nowSec = Math.floor(Date.now() / 1000);

        try {
          if (action === "add") {
            if (!text) return { error: "text required for add" };
            // ── Auto-route category via rule engine ──
            const cat = autoRouteCategory(text, { category });
            const now = new Date();
            const dateStr = dateStrInTimeZone(0, SMART_ADD_TIME_ZONE, now);
            const ts = now.toISOString().replace(/[:.]/g, "").slice(0, 15);
            const entryId = `${ts}_${cat}`;
            const fileDir = resolve(WORKSPACE, SMART_ADD_DIR);
            const filePath = resolve(fileDir, `${dateStr}.md`);
            const fingerprint = buildSmartAddFingerprint(text, cat, isProtected);
            const appendResult = appendSmartAdd({
              fileDir,
              filePath,
              entryId,
              category: cat,
              isProtected,
              text,
              fingerprint,
              syncCli: false,
            });
            if (!appendResult.appended) {
              return {
                success: true,
                deduped: true,
                reason: appendResult.reason,
                category: cat,
              };
            }

            // Sync via manager — populates SQLite chunks + FTS5
            try {
              await syncIndexIfNeeded("memory_engine.add");
            } catch (e) {
              // fallback: reindex may happen on next cycle
            }

            // Get new chunks
            const { conf, tau } = catParams(cat, isProtected);
            let lanceWritten = 0;

            const result = withDb(db => {
              const fileRel = filePath.replace(WORKSPACE + "/", "");
              const newChunks = db.prepare([
                "SELECT id FROM chunks WHERE path = ?",
                "AND id NOT IN (SELECT chunk_id FROM memory_confidence)"
              ].join(" ")).all(fileRel);

              if (newChunks.length <= 0) {
                return { chunks_added: 0, category: cat, confidence: conf, tau };
              }

              // ① Write SQLite confidence first (lightweight, instantaneous)
              const insert = db.prepare([
                "INSERT INTO memory_confidence",
                "(chunk_id, initial_confidence, confidence, last_confidence_update,",
                "base_tau, hit_count, is_archived, is_protected, conflict_flag, category)",
                "VALUES (?, ?, ?, ?, ?, 0, 0, ?, 0, ?)"
              ].join(" "));
              const txn = db.transaction(() => {
                for (const row of newChunks) {
                  insert.run(row.id, conf, conf, nowSec, tau, isProtected ? 1 : 0, cat);
                }
              });
              txn();

              return { chunks_added: newChunks.length, category: cat, confidence: conf, tau, newChunks };
            });

            // ② Generate embedding + write LanceDB (synchronous, with rollback)
            if (result.newChunks && lancedbTable) {
              try {
                const vec = await generateEmbedding(text);
                if (vec && vec.length > 0) {
                  await lancedbTable.add([{
                    id: result.newChunks[0].id,
                    text: text.slice(0, 2000),
                    vector: vec,
                    timestamp: Date.now()
                  }]);
                  lanceWritten = 1;
                }
              } catch (e) {
                // LanceDB write failed → rollback SQLite to avoid orphan
                console.warn("[memory-engine] LanceDB write failed, rolling back SQLite:", e.message);
                withDb(db => {
                  const del = db.prepare("DELETE FROM memory_confidence WHERE chunk_id = ?");
                  for (const row of result.newChunks) {
                    del.run(row.id);
                  }
                });
                // Re-throw so the caller knows the add failed
                throw new Error(`LanceDB write failed, SQLite rolled back: ${e.message}`);
              }
            }

            if (result.newChunks) {
              for (const row of result.newChunks) {
                recordMemoryEvent({ event_type: "memory_created", memory_id: row.id, source: "memory_engine.add", metadata_json: { category: result.category, confidence: result.confidence, tau: result.tau, lance_written: lanceWritten } });
              }
            }
            return { success: true, chunks_added: result.chunks_added, category: result.category, confidence: result.confidence, tau: result.tau, lance_written: lanceWritten };
          }

          if (action === "search") {
            if (!text) return { error: "query text required for search" };

            // Channel 1: Vector search via OpenClaw manager
            let vectorCandidates = [];
            try {
              const { manager } = await getMemorySearchManager({});
              if (manager) {
                const raw = await manager.search(text, { limit: 30 });
                vectorCandidates = raw?.entries || raw || [];
              }
            } catch (e) {}

            // Channel 1b: LanceDB vector search (if initialized)
            let lanceCandidates = [];
            if (lancedbTable) {
              try {
                const queryVec = await generateEmbedding(text);
                if (queryVec && queryVec.length > 0) {
                  const rawLance = await lancedbTable.search(queryVec).limit(30).execute();
                  if (rawLance) {
                    // LanceDB v2 returns async iterable, not Array
                    let lanceRows = [];
                    if (typeof rawLance[Symbol.asyncIterator] === 'function') {
                      for await (const batch of rawLance) {
                        for (const row of batch) lanceRows.push(row);
                      }
                    } else if (Array.isArray(rawLance)) {
                      lanceRows = rawLance;
                    }

                    if (lanceRows.length > 0) {
                      lanceCandidates = withDb(db => {
                        const confMap = new Map();
                        const confRows = db.prepare(`SELECT chunk_id, confidence, last_confidence_update, base_tau, hit_count, is_protected, conflict_flag, category FROM memory_confidence`).all();
                        for (const r of confRows) confMap.set(r.chunk_id, r);
                        return lanceRows
                          .filter(l => confMap.has(l.id))
                          .map(l => {
                            const meta = confMap.get(l.id);
                            return {
                              id: l.id, text: (l.text || '').slice(0, 600),
                              category: meta.category,
                              similarity: l._distance !== undefined ? 1 - l._distance : 0.6,
                              confidence_realtime: meta.is_protected ? meta.confidence
                                : Math.round(calcRealtimeConf(meta, nowSec) * 10000) / 10000,
                              hit_count: meta.hit_count,
                              is_protected: meta.is_protected,
                              conflict_flag: meta.conflict_flag,
                            };
                          })
                          .sort((a, b) => b.similarity - a.similarity)
                          .slice(0, 30);
                      });
                    }
                  }
                }
              } catch (e) {
                // LanceDB query failed, non-fatal
              }
            }

            // Channel 2: FTS5 full-text search
            let ftsCandidates = [];
            try {
              const safeQuery = sanitizeFtsQuery(text);
              if (safeQuery) {
                withDb(db => {
                  ftsCandidates = db.prepare(`
                    SELECT c.id, c.text,
                      COALESCE(mc.confidence, 0.5) as confidence,
                      mc.last_confidence_update, COALESCE(mc.base_tau, 7.0) as base_tau,
                      COALESCE(mc.hit_count, 0) as hit_count, COALESCE(mc.is_protected, 0) as is_protected,
                      COALESCE(mc.conflict_flag, 0) as conflict_flag, COALESCE(mc.category, 'raw_log') as category
                    FROM chunks_fts f
                    JOIN chunks c ON c.id = f.id
                    LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
                    WHERE chunks_fts MATCH ?
                      AND COALESCE(mc.is_archived, 0) = 0
                    ORDER BY bm25(chunks_fts, 0)
                    LIMIT 20
                  `).all(safeQuery);
                });
              }
            } catch (e) {}

            // Channel 3: KG bridge (if kg.js exists)
            let kgCandidates = [];
            let kgActive = false;
            const kgJsonPath = resolve(WORKSPACE, 'knowledge-graph.json');
            const kgModulePath = resolve(WORKSPACE, 'skills/jpeng-knowledge-graph-memory');
            try {
              if (existsSync(kgJsonPath) && existsSync(resolve(kgModulePath, 'index.js'))) {
                const KG = require(kgModulePath);
                const data = JSON.parse(readFileSync(kgJsonPath, 'utf-8'));
                const kg = KG.KnowledgeGraph.fromJSON(data);
                const concepts = kg.search({ name: text });
                if (Array.isArray(concepts) && concepts.length > 0) {
                  kgActive = true;
                  const names = concepts.map(c => c.name).filter(Boolean);
                  if (names.length > 0) {
                    withDb(db => {
                      const seen = new Set();
                      for (const name of names) {
                        const safeName = sanitizeFtsQuery(name);
                        if (!safeName || safeName.length < 2) continue;
                        const rows = db.prepare([
                          'SELECT DISTINCT c.id, c.text,',
                          '  COALESCE(mc.confidence, 0.5) as confidence,',
                          '  mc.last_confidence_update, COALESCE(mc.base_tau, 7.0) as base_tau,',
                          '  COALESCE(mc.hit_count, 0) as hit_count, COALESCE(mc.is_protected, 0) as is_protected,',
                          '  COALESCE(mc.conflict_flag, 0) as conflict_flag, COALESCE(mc.category, \'raw_log\') as category',
                          'FROM chunks_fts f',
                          'JOIN chunks c ON c.id = f.id',
                          'LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id',
                          'WHERE chunks_fts MATCH ?',
                          '  AND COALESCE(mc.is_archived, 0) = 0',
                          'ORDER BY bm25(chunks_fts, 0)',
                          'LIMIT 3'
                        ].join('\n')).all(safeName);
                        for (const row of rows) {
                          if (seen.has(row.id)) continue;
                          seen.add(row.id);
                          kgCandidates.push(row);
                          if (kgCandidates.length >= 15) break;
                        }
                        if (kgCandidates.length >= 15) break;
                      }
                    });
                  }
                }
              }
            } catch (e) {}

            // Build channels from candidates
            const channels = {};

            if (vectorCandidates.length > 0) {
              const scored = withDb(db => {
                const confRows = db.prepare(`SELECT chunk_id, confidence, last_confidence_update, base_tau, hit_count, is_protected, conflict_flag, category, is_archived FROM memory_confidence`).all();
                const confMap = new Map(confRows.map(r => [r.chunk_id, r]));
                const res = [];
                for (const c of vectorCandidates) {
                  const id = c.id || c.chunkId;
                  if (!id) continue;
                  const meta = confMap.get(id);
                  if (!meta || meta.is_archived) continue;
                  const rtConf = meta.is_protected ? meta.confidence : calcRealtimeConf(meta, nowSec);
                  const sim = c.similarity ?? c.score ?? 0.5;
                  res.push({
                    id, text: (c.text || c.content || "").slice(0, 600),
                    category: meta.category,
                    similarity: Math.round(sim * 10000) / 10000,
                    confidence_realtime: Math.round(rtConf * 10000) / 10000,
                    hit_count: meta.hit_count,
                    is_protected: meta.is_protected,
                    conflict_flag: meta.conflict_flag,
                  });
                }
                res.sort((a, b) => b.similarity - a.similarity);
                return res.slice(0, 30);
              });
              if (scored.length > 0) channels.vector = scored;
            }

            // Channel 1b: LanceDB
            if (lanceCandidates.length > 0) {
              channels.lance = lanceCandidates;
            }

            if (ftsCandidates.length > 0) {
              channels.fts = ftsCandidates.map(row => ({
                id: row.id, text: row.text.slice(0, 600),
                category: row.category,
                similarity: 0.5,
                confidence_realtime: row.is_protected ? row.confidence
                  : Math.round(calcRealtimeConf(row, nowSec) * 10000) / 10000,
                hit_count: row.hit_count,
                is_protected: row.is_protected,
                conflict_flag: row.conflict_flag,
              }));
            }

            if (kgCandidates.length > 0) {
              channels.kg = kgCandidates.map(row => ({
                id: row.id, text: row.text.slice(0, 600),
                category: row.category,
                similarity: 0.5,
                confidence_realtime: row.is_protected ? row.confidence
                  : Math.round(calcRealtimeConf(row, nowSec) * 10000) / 10000,
                hit_count: row.hit_count,
                is_protected: row.is_protected,
                conflict_flag: row.conflict_flag,
              }));
            }

            const channelCount = Object.keys(channels).length;
            if (channelCount === 0) {
              return { pool: 0, results: [], channels: [], note: "no channels returned results" };
            }

            // RRF fusion
            const fusion = new Map();
            for (const [chName, rankedItems] of Object.entries(channels)) {
              rankedItems.forEach((item, idx) => {
                const exist = fusion.get(item.id) || {
                  id: item.id, text: item.text, category: item.category,
                  sources: [], rrfScore: 0,
                  similarity: item.similarity, confidence_realtime: item.confidence_realtime,
                  hits: item.hit_count,
                };
                exist.sources.push(chName);
                let acc = 0;
                for (const [cn, items] of Object.entries(channels)) {
                  const rank = items.findIndex(i => i.id === item.id);
                  if (rank >= 0) acc += 1 / (60 + rank + 1);
                }
                exist.rrfScore = Math.round(acc * 10000) / 10000;
                fusion.set(item.id, exist);
              });
            }

            const fused = Array.from(fusion.values());
            fused.sort((a, b) => b.rrfScore - a.rrfScore);
            const results = fused.slice(0, k).map(item => ({
              id: item.id.slice(0, 16),
              text: item.text.slice(0, 200),
              category: item.category,
              rrf_score: item.rrfScore,
              sources: item.sources,
              similarity: item.similarity,
              confidence: item.confidence_realtime,
              hits: item.hits,
            }));

            return {
              pool: fused.length,
              channels: Object.keys(channels),
              channel_sizes: Object.fromEntries(Object.entries(channels).map(([k, v]) => [k, v.length])),
              kg_active: kgActive,
              results,
            };
          }
          if (action === "cite") {
            if (!chunk_ids || chunk_ids.length === 0) return { error: "chunk_ids array required" };
            return withDb(db => {
              const fullIds = resolvePrefixes(db, chunk_ids);
              if (fullIds.length === 0) return { success: true, reinforced: 0, note: "no matching chunks found" };
              const count = batchReinforce(db, fullIds, nowSec);
              for (const id of fullIds) {
                recordMemoryEvent({ event_type: "memory_cited", memory_id: id, cited_count: 1, source: "memory_engine.cite" });
                recordMemoryEvent({ event_type: "memory_reinforced", memory_id: id, source: "memory_engine.cite" });
              }
              return {
                success: true,
                reinforced: count,
                ids: fullIds.map(id => id.slice(0, 16)),
                next_confidence: (0.5 + count * 0.1).toFixed(2),
              };
            });
          }

          if (action === "update") {
            if (!chunk_id) return { error: "chunk_id required" };
            return withDb(db => {
              const matches = db.prepare([
                "SELECT chunk_id FROM memory_confidence WHERE chunk_id LIKE ? || '%' LIMIT 2"
              ].join("")).all(chunk_id);
              if (matches.length === 0) return { error: "no match" };
              if (matches.length > 1) return { error: "multiple matches", matches: matches.map(r => r.chunk_id.slice(0, 16)) };
              const fullId = matches[0].chunk_id;
              const sets = ["last_confidence_update = ?"];
              const vals = [nowSec];
              if (category) {
                const rule = CATEGORY_MAP[category];
                if (rule) {
                  sets.push("category = ?", "initial_confidence = ?", "confidence = ?", "base_tau = ?");
                  vals.push(category, rule.conf, rule.conf, rule.tau);
                }
              }
              if (hit) sets.push("hit_count = hit_count + 1");
              if (isProtected !== undefined) { sets.push("is_protected = ?"); vals.push(isProtected ? 1 : 0); }
              vals.push(fullId);
              db.prepare(`UPDATE memory_confidence SET ${sets.join(", ")} WHERE chunk_id = ?`).run(...vals);
              return { success: true, chunk_id: fullId.slice(0, 16) };
            });
          }

          if (action === "status") {
            return withDb(db => {
              const total = db.prepare("SELECT COUNT(*) as c FROM chunks").get();
              const c = db.prepare([
                "SELECT COUNT(*) as total, SUM(is_archived) as archived,",
                "SUM(is_protected) as protected, SUM(conflict_flag) as conflicted,",
                "ROUND(AVG(confidence), 4) as avg_conf, ROUND(AVG(base_tau), 2) as avg_tau,",
                "ROUND(AVG(hit_count), 2) as avg_hits FROM memory_confidence"
              ].join(" ")).get();
              const cat = db.prepare("SELECT category, COUNT(*) as count FROM memory_confidence GROUP BY category ORDER BY count DESC").all();
              const missing = db.prepare("SELECT COUNT(*) as c FROM chunks c LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id WHERE mc.chunk_id IS NULL").get();
              return {
                chunks_total: total.c, confidence_tracked: c.total || 0,
                archived: c.archived || 0, protected: c.protected || 0,
                conflicted: c.conflicted || 0, avg_confidence: c.avg_conf || 0,
                avg_tau: c.avg_tau || 0, avg_hits: c.avg_hits || 0,
                chunks_missing_confidence: missing.c || 0, by_category: cat,
              };
            });
          }

          if (action === "archive") {
            const threshold = api.config?.archiveThreshold ?? 0.15;
            return withDb(db => {
              const rows = db.prepare([
                "SELECT chunk_id, confidence, last_confidence_update, hit_count,",
                "base_tau, is_protected, category FROM memory_confidence",
                "WHERE is_archived = 0 AND is_protected = 0 AND category != 'user_identity'"
              ].join(" ")).all();
              const toArchive = [];
              for (const row of rows) {
                if (!row.last_confidence_update) continue;
                const deltaDays = (nowSec - row.last_confidence_update) / 86400;
                const t = calcTau(row.hit_count, row.base_tau);
                const rc = row.confidence * Math.exp(-deltaDays / t);
                if (rc < threshold) toArchive.push(row.chunk_id);
              }
              if (toArchive.length > 0) {
                const ph = toArchive.map(() => "?").join(",");
                db.prepare(`UPDATE memory_confidence SET is_archived = 1 WHERE chunk_id IN (${ph})`).run(...toArchive);
                for (const id of toArchive) recordMemoryEvent({ event_type: "memory_archived", memory_id: id, source: "memory_engine.archive", metadata_json: { threshold } });
              }
              return { archived: toArchive.length, threshold };
            });
          }

          if (action === "kg-bridge") {
            // Read knowledge-graph.json and write kg_data for matching chunks
            if (!existsSync(KG_PATH)) return { error: "knowledge-graph.json not found" };
            const kgRaw = JSON.parse(readFileSync(KG_PATH, "utf-8"));
            const nodes = kgRaw.nodes || kgRaw.concepts || [];
            const edges = kgRaw.edges || kgRaw.relationships || [];
            return withDb(db => {
              const subgraph = {
                node_count: nodes.length,
                edge_count: edges.length,
                nodes: nodes.slice(0, 20).map(n => ({
                  id: n.id || n.name,
                  name: n.name || n.id,
                  type: n.type || "concept",
                  properties: n.properties || {},
                })),
                edges: edges.slice(0, 30).map(e => ({
                  source: e.source || e.from,
                  target: e.target || e.to,
                  type: e.type || "RELATED_TO",
                })),
              };
              const kgJson = JSON.stringify(subgraph);
              // Write kg_data for all matching concept chunks
              const chunkMatches = db.prepare([
                "SELECT chunk_id FROM memory_confidence",
                "WHERE category IN ('kg_node', 'raw_log')",
              ].join(" ")).all();
              const update = db.prepare([
                "UPDATE memory_confidence SET kg_data = ? WHERE chunk_id = ?"
              ].join(" "));
              for (const row of chunkMatches.slice(0, 10)) {
                update.run(kgJson, row.chunk_id);
              }
              return {
                success: true,
                nodes: nodes.length,
                edges: edges.length,
                chunks_updated: Math.min(chunkMatches.length, 10),
              };
            });
          }

          if (action === "detect-conflicts") {
            return withDb(db => {
              const now = Math.floor(Date.now() / 1000);
              // Simple heuristic: find chunks with same category that have divergent confidence
              const rows = db.prepare([
                "SELECT m1.chunk_id as id1, m2.chunk_id as id2,",
                "m1.category, m1.confidence as c1, m2.confidence as c2,",
                "m1.hit_count as h1, m2.hit_count as h2",
                "FROM memory_confidence m1",
                "JOIN memory_confidence m2 ON m1.category = m2.category",
                "AND m1.chunk_id < m2.chunk_id",
                "WHERE m1.is_archived = 0 AND m2.is_archived = 0",
                "AND ABS(m1.confidence - m2.confidence) > 0.3",
                "AND ABS(m1.hit_count - m2.hit_count) > 3"
              ].join(" ")).all();

              let flagged = 0;
              const flagStmt = db.prepare([
                "UPDATE memory_confidence SET conflict_flag = 1 WHERE chunk_id = ?"
              ].join(" "));
              for (const row of rows) {
                // Flag the lower-confidence one as possibly outdated
                const lowerId = row.c1 < row.c2 ? row.id1 : row.id2;
                flagStmt.run(lowerId);
                flagged++;
              }
              return {
                success: true,
                pairs_checked: rows.length,
                flagged_as_conflict: flagged,
                note: "Lower-confidence chunks in same category with divergent hit counts flagged",
              };
            });
          }

          return { error: "unknown action", available: ["add", "search", "cite", "update", "status", "archive", "kg-bridge", "detect-conflicts"] };
        } catch (e) {
          return { error: e.message };
        }
  };
}
