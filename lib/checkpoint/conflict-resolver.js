const { withMeDb } = require("./db");

function extractConfigKey(text) {
  const match = text.match(/配置[：:]\s*(\S[^=\n]*?)\s*[=:=]\s*\S/);
  if (match) return match[1].trim().toLowerCase();
  const fallback = text.match(/^\s*(\S[\w\-\/]+)\s*[=:=]\s*\S/);
  if (fallback) return fallback[1].trim().toLowerCase();
  return null;
}

function resolveConfigConflicts() {
  console.log("[checkpoint] Resolving config conflicts...");
  let flagged = 0;

  withMeDb((db) => {
    const rows = db.prepare([
      "SELECT mc.chunk_id, c.text, mc.last_confidence_update, mc.conflict_flag",
      "FROM memory_confidence mc",
      "JOIN chunks_db.chunks c ON c.id = mc.chunk_id",
      "WHERE mc.category = 'preference'",
      "AND mc.is_archived = 0",
      "ORDER BY mc.last_confidence_update DESC",
    ].join(" ")).all();

    const groups = {};
    for (const row of rows) {
      const key = extractConfigKey(row.text || "");
      if (!key) continue;
      if (!groups[key]) groups[key] = [];
      groups[key].push({
        chunk_id: row.chunk_id,
        text: (row.text || "").slice(0, 80),
        updated: row.last_confidence_update || 0,
        already_flagged: row.conflict_flag === 1,
      });
    }

    const updateStmt = db.prepare("UPDATE memory_confidence SET conflict_flag = 1 WHERE chunk_id = ?");
    const unflagStmt = db.prepare("UPDATE memory_confidence SET conflict_flag = 0 WHERE chunk_id = ?");

    for (const [key, entries] of Object.entries(groups)) {
      if (entries.length <= 1) {
        if (entries[0].already_flagged) {
          unflagStmt.run(entries[0].chunk_id);
          console.log(`  ↳ 解除冲突标记: ${key}（唯一条目）`);
        }
        continue;
      }

      entries.sort((a, b) => b.updated - a.updated);
      const newest = entries[0];

      if (newest.already_flagged) {
        unflagStmt.run(newest.chunk_id);
        console.log(`  ↳ 解除最新条目冲突标记: ${key}`);
      }

      for (let i = 1; i < entries.length; i++) {
        const entry = entries[i];
        if (!entry.already_flagged) {
          updateStmt.run(entry.chunk_id);
          flagged++;
          console.log(`  ⚠️  冲突标记: ${key} | 旧: ${entry.text.slice(0, 50)} | 新: ${newest.text.slice(0, 50)}`);
        }
      }
    }
  });

  console.log(`[checkpoint] Config conflict resolution: ${flagged} conflict(s) flagged`);
  return flagged;
}

module.exports = {
  extractConfigKey,
  resolveConfigConflicts,
};
