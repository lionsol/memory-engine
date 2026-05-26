#!/usr/bin/env node
/**
 * detect-conflicts.js
 * Scan memory for potentially contradictory chunks.
 * Strategy: FTS5 search → group similar texts → flag pairs with conflicting patterns.
 */

const Database = require('better-sqlite3');
const path = require('path');

const HOME = process.env.HOME || '/home/lionsol';
const DB_PATH = path.resolve(HOME, '.openclaw/memory/main.sqlite');

const db = new Database(DB_PATH);

// 1. Get all non-archived, non-protected chunks with text
const chunks = db.prepare(`
  SELECT c.id, mc.category, mc.confidence, mc.conflict_flag, mc.hit_count, substr(c.text, 1, 200) as text
  FROM chunks c
  JOIN memory_confidence mc ON c.id = mc.chunk_id
  WHERE mc.is_archived = 0 AND c.text IS NOT NULL AND length(c.text) > 10
  ORDER BY mc.confidence DESC
`).all();

// 2. Conflict detection heuristics
// Look for chunks that discuss similar topics but with opposite stance
const conflictPatterns = [
  // Like ↔ Dislike pairs
  { pos: /喜欢|爱好|偏好|prefer|favorite|喜欢|爱/, neg: /不喜欢|讨厌|厌恶|反感|hate|dislike|厌恶/ },
  // Good ↔ Bad
  { pos: /好|不错|很棒|great|good|excellent/, neg: /差|糟糕|不行|poor|bad|terrible/ },
  // Want ↔ Don't want
  { pos: /想要|希望|想|want|wish|expect/, neg: /不要|不想|拒绝|don't want|refuse/ },
  // True ↔ False
  { pos: /是|对|正确|true|yes|correct/, neg: /不是|不对|错误|false|no|wrong/ },
];

const conflicts = [];
const checked = new Set();

for (let i = 0; i < chunks.length; i++) {
  for (let j = i + 1; j < chunks.length; j++) {
    const a = chunks[i];
    const b = chunks[j];
    const pairKey = [a.id, b.id].sort().join('|');
    if (checked.has(pairKey)) continue;
    checked.add(pairKey);

    // Check for topic overlap by shared keywords (nouns, names, concepts)
    const textA = a.text.toLowerCase();
    const textB = b.text.toLowerCase();

    // Simple topic overlap: extract potential topic words (2+ Chinese chars or English words 4+ chars)
    const topicWordsA = new Set(textA.match(/[\u4e00-\u9fff]{2,}/g) || []);
    const topicWordsB = new Set(textB.match(/[\u4e00-\u9fff]{2,}/g) || []);
    const engWordsA = new Set((textA.match(/\b[a-z]{4,}\b/g) || []).filter(w => !['that','this','with','from','have','been','were','what','when','where','which','their','there'].includes(w)));
    const engWordsB = new Set((textB.match(/\b[a-z]{4,}\b/g) || []).filter(w => !['that','this','with','from','have','been','were','what','when','where','which','their','there'].includes(w)));

    // All topic words
    const allTopicsA = new Set([...topicWordsA, ...engWordsA]);
    const allTopicsB = new Set([...topicWordsB, ...engWordsB]);

    // Find shared topics
    let sharedTopics = [];
    for (const word of allTopicsA) {
      if (allTopicsB.has(word)) sharedTopics.push(word);
    }

    // Also check if one topic is substring of another (for partial overlap)
    if (sharedTopics.length === 0) {
      for (const word of allTopicsA) {
        for (const word2 of allTopicsB) {
          if (word.length > 3 && word2.length > 3 &&
              (word.includes(word2) || word2.includes(word))) {
            sharedTopics.push(word);
          }
        }
      }
    }

    // Deduplicate
    sharedTopics = [...new Set(sharedTopics)];

    if (sharedTopics.length < 2) continue;

    // Check for conflicting patterns
    let conflictScore = 0;
    let conflictReason = '';

    for (const pattern of conflictPatterns) {
      const aPos = pattern.pos.test(textA), aNeg = pattern.neg.test(textA);
      const bPos = pattern.pos.test(textB), bNeg = pattern.neg.test(textB);
      if ((aPos && bNeg) || (aNeg && bPos)) {
        conflictScore += 1;
        conflictReason = `conflicting stance on topics: ${sharedTopics.slice(0, 3).join(', ')}`;
      }
    }

    if (conflictScore > 0) {
      conflicts.push({
        id_a: a.id.slice(0, 16),
        id_b: b.id.slice(0, 16),
        category: a.category,
        confidence_a: a.confidence,
        confidence_b: b.confidence,
        shared_topics: sharedTopics.slice(0, 5),
        reason: conflictReason,
        text_a: a.text.slice(0, 80),
        text_b: b.text.slice(0, 80),
      });
    }
  }
}

// 3. Report and optionally flag them
console.log(JSON.stringify({
  action: 'detect-conflicts',
  total_chunks_scanned: chunks.length,
  pairs_checked: checked.size,
  conflicts_found: conflicts.length,
  conflicts: conflicts.slice(0, 20),  // limit output
}));

db.close();
