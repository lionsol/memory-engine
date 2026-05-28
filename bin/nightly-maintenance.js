#!/usr/bin/env node
/**
 * Memory Engine Nightly Maintenance
 * Runs: detect-conflicts → archive → kg-bridge → status
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const HOME = process.env.HOME || '/home/lionsol';
const DB_PATH = path.resolve(HOME, '.openclaw/memory/main.sqlite');
const WORKSPACE = path.resolve(HOME, '.openclaw/workspace');
const KG_PATH = path.join(WORKSPACE, 'knowledge-graph.json');

const CONFLICT_THRESHOLD = 0.15; // min rtConf to flag a conflict pair
const CONFIG = { CONFLICT_PENALTY: 0.5 };

function withDb(fn) {
  const db = new Database(DB_PATH);
  try { return fn(db); } finally { db.close(); }
}

// ===== 1. DETECT CONFLICTS =====
// Conservative approach: only flag genuine contradictions
// 1. Same config key with different values (preference conflicts)
// 2. Near-duplicate chunks (redundancy)
// 3. Chunks within same category+date about the same subject with opposing claims
function detectConflicts() {
  console.log('--- STEP 1: detect-conflicts ---');
  withDb(db => {
    const candidates = db.prepare(`
      SELECT c.id, c.text, mc.confidence, mc.conflict_flag, mc.category, mc.hit_count
      FROM chunks c
      JOIN memory_confidence mc ON c.id = mc.chunk_id
      WHERE mc.is_archived = 0 AND mc.is_protected = 0
        AND length(c.text) > 30
    `).all();

    console.log(`  Scanning ${candidates.length} active chunks for conflicts...`);

    let conflictPairs = [];
    const seen = new Set();

    // Extract meaningful topic keywords (excluding metadata noise)
    function extractTopicTokens(text) {
      const cleaned = text
        .replace(/##\s*\d{4}-\d{2}-\d{2}T\d{4}_\w+/g, '')
        .replace(/Category:\s*\w+/g, '')
        .replace(/kg_data:[^\n]*/g, '')
        .replace(/配置：/g, '');
      const tokens = cleaned.match(/[\u4e00-\u9fff]{2,}|[a-zA-Z]{3,}/g) || [];
      return [...new Set(tokens.map(t => t.toLowerCase()))];
    }

    // Config key pattern: extract "key = value" from preference chunks
    function extractConfigPairs(text) {
      const pairs = [];
      const matches = text.matchAll(/([\w.-]+)\s*=\s*([^\n,}]+)/g);
      for (const m of matches) {
        // Normalize value: strip source annotations and whitespace
        let value = m[2].trim().replace(/（来源：[^）]*）/g, '').replace(/\(Source:[^)]*\)/g, '').trim();
        pairs.push({ key: m[1].toLowerCase().trim(), value });
      }
      return pairs;
    }

    // Check for config value conflicts (same key, different values)
    const configChunks = candidates.filter(c => c.category === 'preference');
    for (let i = 0; i < configChunks.length; i++) {
      const a = configChunks[i];
      const pairsA = extractConfigPairs(a.text);
      if (pairsA.length === 0) continue;

      for (let j = i + 1; j < configChunks.length; j++) {
        const b = configChunks[j];
        const key = [a.id, b.id].sort().join('::');
        if (seen.has(key)) continue;

        const pairsB = extractConfigPairs(b.text);
        for (const pA of pairsA) {
          for (const pB of pairsB) {
            if (pA.key === pB.key && pA.value !== pB.value) {
              // Skip whitespace-only differences
              if (pA.value.replace(/\s+/g, '') === pB.value.replace(/\s+/g, '')) continue;
              seen.add(key);
              conflictPairs.push({
                id_a_full: a.id, id_b_full: b.id,
                id_a: a.id.slice(0, 16), id_b: b.id.slice(0, 16),
                excerpt_a: a.text.replace(/\n/g, ' ').slice(0, 100),
                excerpt_b: b.text.replace(/\n/g, ' ').slice(0, 100),
                conflict_type: 'config_value_mismatch',
                config_key: pA.key,
                value_a: pA.value,
                value_b: pB.value,
                cat_a: 'preference', cat_b: 'preference',
              });
              break;
            }
          }
          if (seen.has(key)) break;
        }
      }
    }

    // Check for near-duplicate chunks (high jaccard similarity)
    const flaggedIds = new Set(conflictPairs.flatMap(p => [p.id_a_full, p.id_b_full]));
    const nonConfig = candidates.filter(c => 
      !flaggedIds.has(c.id)  // not already flagged
    );
    
    for (let i = 0; i < nonConfig.length; i++) {
      const a = nonConfig[i];
      const cleanedA = a.text.replace(/##[^\n]*|Category:[^\n]*|kg_data:[^\n]*|\d{4}-\d{2}-\d{2}T\d{4}/g, '');
      
      for (let j = i + 1; j < nonConfig.length; j++) {
        const b = nonConfig[j];
        const key = [a.id, b.id].sort().join('::');
        if (seen.has(key)) continue;

        const cleanedB = b.text.replace(/##[^\n]*|Category:[^\n]*|kg_data:[^\n]*|\d{4}-\d{2}-\d{2}T\d{4}/g, '');
        
        // Only compare same-category chunks about the same topic
        if (a.category !== b.category) continue;
        
        const sim = jaccardSimilarity(cleanedA, cleanedB);
        
        // High similarity = near-duplicate (redundant info)
        if (sim > 0.60) {
          seen.add(key);
          conflictPairs.push({
            id_a_full: a.id, id_b_full: b.id,
            id_a: a.id.slice(0, 16), id_b: b.id.slice(0, 16),
            excerpt_a: cleanedA.replace(/\n/g, ' ').slice(0, 80),
            excerpt_b: cleanedB.replace(/\n/g, ' ').slice(0, 80),
            conflict_type: 'near_duplicate',
            content_similarity: Math.round(sim * 1000) / 1000,
            cat_a: a.category, cat_b: b.category,
          });
        }
      }
    }

    // Apply conflict flags with appropriate penalty
    const uniqueIds = [...new Set(conflictPairs.flatMap(p => [p.id_a_full, p.id_b_full]))];
    if (uniqueIds.length > 0) {
      const placeholders = uniqueIds.map(() => '?').join(',');
      db.prepare(`UPDATE memory_confidence SET conflict_flag = 1 WHERE chunk_id IN (${placeholders})`).run(...uniqueIds);
      
      // Apply penalty: milder for near-duplicates, stronger for config mismatches
      const configConflictIds = [...new Set(
        conflictPairs.filter(p => p.conflict_type === 'config_value_mismatch')
          .flatMap(p => [p.id_a_full, p.id_b_full])
      )];
      
      if (configConflictIds.length > 0) {
        const pl2 = configConflictIds.map(() => '?').join(',');
        db.prepare(`UPDATE memory_confidence SET confidence = MAX(0.01, confidence - ${CONFIG.CONFLICT_PENALTY}) WHERE chunk_id IN (${pl2})`).run(...configConflictIds);
      }
      
      // Near-duplicates: reduce the older/lower-confidence one
      const dupIds = [...new Set(
        conflictPairs.filter(p => p.conflict_type === 'near_duplicate')
          .flatMap(p => [p.id_a_full, p.id_b_full])
      )];
      if (dupIds.length > 0) {
        const pl3 = dupIds.map(() => '?').join(',');
        db.prepare(`UPDATE memory_confidence SET confidence = MAX(0.01, confidence - 0.2) WHERE chunk_id IN (${pl3})`).run(...dupIds);
      }
    }

    // Report
    const configConflicts = conflictPairs.filter(p => p.conflict_type === 'config_value_mismatch');
    const dupConflicts = conflictPairs.filter(p => p.conflict_type === 'near_duplicate');
    console.log(`  ✅ Config value mismatches: ${configConflicts.length} | Near-duplicates: ${dupConflicts.length} | Total chunks affected: ${uniqueIds.length}`);
    
    if (conflictPairs.length > 0) {
      console.log('  Details:');
      conflictPairs.slice(0, 10).forEach(p => {
        if (p.conflict_type === 'config_value_mismatch') {
          console.log(`    ⚠ Config: [${p.id_a}] vs [${p.id_b}]`);
          console.log(`      Key: ${p.config_key} | "${p.value_a}" vs "${p.value_b}"`);
        } else {
          console.log(`    📋 Dup: [${p.id_a}] vs [${p.id_b}] (sim: ${p.content_similarity})`);
          console.log(`      A: ${p.excerpt_a}`);
          console.log(`      B: ${p.excerpt_b}`);
        }
      });
    } else {
      console.log('  ✅ No genuine conflicts detected');
    }
  });
}

function jaccardSimilarity(a, b) {
  const setA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const setB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

// ===== 2. ARCHIVE =====
function runArchive() {
  console.log('--- STEP 2: archive ---');
  try {
    const output = execSync('node scripts/memory-engine.js archive', {
      cwd: WORKSPACE, encoding: 'utf-8', timeout: 30000
    });
    const parsed = JSON.parse(output.trim());
    console.log(`  ✅ Archived ${parsed.archived} low-confidence chunks (threshold: ${parsed.threshold})`);
  } catch (e) {
    console.error('  ❌ Archive failed:', e.message);
  }
}

// ===== 3. KG BRIDGE =====
function kgBridge() {
  console.log('--- STEP 3: kg-bridge ---');
  try {
    const kgData = JSON.parse(fs.readFileSync(KG_PATH, 'utf-8'));
    const kgNodes = kgData.nodes || [];
    const kgEdges = kgData.edges || [];

    console.log(`  Loaded ${kgNodes.length} KG nodes, ${kgEdges.length} edges`);

    const kgString = JSON.stringify(kgData);
    const kgHash = require('crypto').createHash('sha256').update(kgString).digest('hex').slice(0, 16);

    withDb(db => {
      let nodesMatched = 0;
      let newEntries = 0;

      for (const node of kgNodes) {
        const name = node.name || '';
        const notes = node.properties?.notes || '';
        const nodeStr = name + ' ' + notes;

        // Find matching chunks by keyword
        const searchTerms = name.split(/\s+/).filter(w => w.length > 1);
        if (searchTerms.length === 0) continue;

        let matched = false;
        for (const term of searchTerms) {
          try {
            const chunks = db.prepare(`
              SELECT c.id FROM chunks c
              WHERE c.text LIKE ? ESCAPE '\\'
              LIMIT 1
            `).all(`%${term}%`);

            if (chunks.length > 0) {
              const chunkId = chunks[0].id;
              // Update kg_data field with node info
              db.prepare(`
                UPDATE memory_confidence
                SET kg_data = ?, confidence = MAX(confidence, 0.85), category = 'kg_node'
                WHERE chunk_id = ?
              `).run(JSON.stringify({ kg_hash: kgHash, node_id: node.id, node_name: name }), chunkId);
              nodesMatched++;
              matched = true;

              if (db.prepare('SELECT changes()').get()['changes()'] > 0) {
                newEntries++;
              }
              break;
            }
          } catch (e) { /* skip */ }
        }
      }

      // Store KG sync metadata
      const metaKey = 'kg_last_sync';
      const existing = db.prepare("SELECT value FROM meta WHERE key = ?").get(metaKey);
      const syncRecord = JSON.stringify({
        hash: kgHash,
        nodes: kgNodes.length,
        edges: kgEdges.length,
        matched: nodesMatched,
        timestamp: new Date().toISOString(),
      });
      if (existing) {
        db.prepare("UPDATE meta SET value = ? WHERE key = ?").run(syncRecord, metaKey);
      } else {
        db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(metaKey, syncRecord);
      }

      console.log(`  ✅ KG bridge: ${nodesMatched}/${kgNodes.length} nodes matched, ${newEntries} confidence entries updated`);
      console.log(`  Sync hash: ${kgHash}`);
    });
  } catch (e) {
    console.error('  ❌ KG bridge failed:', e.message);
  }
}

// ===== 4. STATUS =====
function showStatus() {
  console.log('--- STEP 4: status ---');
  try {
    const output = execSync('node scripts/memory-engine.js status', {
      cwd: WORKSPACE, encoding: 'utf-8', timeout: 15000
    });
    const parsed = JSON.parse(output.trim());
    console.log(JSON.stringify(parsed, null, 2));
  } catch (e) {
    console.error('  ❌ Status failed:', e.message);
  }
}

// ===== MAIN =====
console.log('⚡ Memory Engine Nightly Maintenance');
console.log(`   Started: ${new Date().toISOString()}`);
console.log('');

detectConflicts();
console.log('');
runArchive();
console.log('');
kgBridge();
console.log('');
showStatus();
console.log('');
console.log('✅ Nightly maintenance complete');
