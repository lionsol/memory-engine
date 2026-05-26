#!/usr/bin/env node
/**
 * kg-bridge.js
 * Sync knowledge-graph.json nodes into memory_confidence as kg_node entries.
 * Strategy: For each node in the graph, check if it's already tracked; if not, find
 * the corresponding chunk(s) and ensure proper kg_node category + confidence.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const HOME = process.env.HOME || '/home/lionsol';
const WORKSPACE = HOME + '/.openclaw/workspace';
const DB_PATH = path.resolve(HOME, '.openclaw/memory/main.sqlite');
const KG_PATH = path.join(WORKSPACE, 'knowledge-graph.json');

const db = new Database(DB_PATH);

// Read knowledge graph
let kg;
try {
  kg = JSON.parse(fs.readFileSync(KG_PATH, 'utf-8'));
} catch (e) {
  console.log(JSON.stringify({ action: 'kg-bridge', status: 'error', message: e.message }));
  process.exit(1);
}

const nodes = kg.nodes || [];
let updated = 0;
let created = 0;
let skipped = 0;
let details = [];

for (const node of nodes) {
  const nodeName = node.name || node.id;
  const nodeProps = node.properties || {};

  // Build search text to match against chunks
  const searchTerms = [nodeName];
  if (nodeProps.name) searchTerms.push(nodeProps.name);
  if (nodeProps.type) searchTerms.push(nodeProps.type);
  if (nodeProps.notes) searchTerms.push(nodeProps.notes);
  if (nodeProps.url) searchTerms.push(nodeProps.url);

  // Try to find existing chunks mentioning this node name
  const likePattern = `%${nodeName}%`;
  const chunk = db.prepare(`
    SELECT c.id, mc.category, mc.confidence
    FROM chunks c
    LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
    WHERE c.text LIKE ?
    ORDER BY mc.confidence DESC
    LIMIT 1
  `).get(likePattern);

  if (chunk && chunk.id) {
    // Found a matching chunk — ensure it's categorized as kg_node
    if (!chunk.category || chunk.category !== 'kg_node') {
      db.prepare(`
        INSERT INTO memory_confidence (chunk_id, confidence, initial_confidence, hit_count, base_tau, is_protected, conflict_flag, category, last_confidence_update)
        VALUES (?, 0.85, 0.85, 1, 90.0, 0, 0, 'kg_node', strftime('%s','now'))
        ON CONFLICT(chunk_id) DO UPDATE SET
          category = 'kg_node',
          confidence = 0.85,
          initial_confidence = COALESCE(initial_confidence, 0.85),
          base_tau = 90.0,
          last_confidence_update = strftime('%s','now')
      `).run(chunk.id);
      updated++;
      details.push({ node: nodeName, action: 'upgraded', chunk: chunk.id.slice(0, 16) });
    } else {
      skipped++;
    }
  } else {
    // No existing chunk for this node — we'd need to add it, but that's out of scope for bridge
    // Just report it
    details.push({ node: nodeName, action: 'no_chunk_found' });
    skipped++;
  }
}

console.log(JSON.stringify({
  action: 'kg-bridge',
  status: 'complete',
  total_kg_nodes: nodes.length,
  updated_category: updated,
  skipped: skipped,
  details: details.slice(0, 30),
}));

db.close();
