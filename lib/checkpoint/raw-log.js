const { existsSync, readFileSync, readdirSync, statSync } = require("node:fs");
const { resolve } = require("node:path");
const checkpointDate = require("./date");
const { withMeDb } = require("./db");
const { getRuntime } = require("./runtime");

function inferCategoryFromEntry(text) {
  const raw = String(text || "");
  if (/^KG_concept_/mi.test(raw)) return "kg_node";
  if (/^Node:\s*/mi.test(raw) && /^Properties:\s*/mi.test(raw)) return "kg_node";
  return "raw_log";
}

function parseSmartAddEntries(content) {
  const normalized = String(content || "").replace(/\r\n/g, "\n");
  const blockRe = /(?:<!--\s*smart-add-fingerprint:\s*[a-f0-9]{8,64}\s*-->\s*\n)?##\s+[\s\S]*?(?=\n(?:<!--\s*smart-add-fingerprint:\s*[a-f0-9]{8,64}\s*-->\s*\n)?##\s+|$)/gi;
  const blocks = (normalized.match(blockRe) || []).map((b) => b.trim());

  const entries = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length === 0) continue;
    const entryId = String(lines[0] || "").replace(/^##\s*/, "").trim();
    const categoryLine = lines.find((line) => /^\s*Category:\s*/i.test(line));
    const category = categoryLine
      ? String(categoryLine.replace(/^\s*Category:\s*/i, "").split("|")[0] || "").trim()
      : null;
    const text = lines
      .filter((line) =>
        !/^\s*Category:\s*/i.test(line)
        && !/^\s*kg_data:\s*/i.test(line)
        && !/^\s*##\s*/.test(line)
        && !/^\s*<!--\s*smart-add-fingerprint:\s*[a-f0-9]{8,64}\s*-->\s*$/i.test(line)
      )
      .join("\n")
      .trim();

    if (!text) continue;
    entries.push({ entryId, category, text, raw: block });
  }
  return entries;
}

function readYesterdayRawLogs() {
  const rt = getRuntime();
  const yesterday = checkpointDate.yesterdayDateStr(rt.now(), rt.timeZone);
  const logs = [];

  const smartAddPath = resolve(rt.smartAddDir, `${yesterday}.md`);
  if (existsSync(smartAddPath)) {
    const content = readFileSync(smartAddPath, "utf-8");
    const entries = parseSmartAddEntries(content);
    for (const parsed of entries) {
      const cat = parsed.category || inferCategoryFromEntry(parsed.raw || parsed.text);
      const body = parsed.text || parsed.raw || "";
      if (!body.trim()) continue;
      logs.push({
        category: cat,
        text: body,
        source: "note",
      });
    }
  }

  try {
    if (existsSync(rt.engineDbPath)) {
      withMeDb((meDb) => {
        const rows = meDb
          .prepare(
            `SELECT c.text, mc.category
             FROM chunks_db.chunks c
             JOIN memory_confidence mc ON c.id = mc.chunk_id
             WHERE mc.category = 'raw_log'
             ORDER BY c.updated_at DESC
             LIMIT 100`
          )
          .all();

        for (const row of rows) {
          logs.push({ category: "raw_log", text: row.text, source: "conversation" });
        }
      }, { readonly: true });
    }
  } catch (e) {
    console.error("[checkpoint] DB read warning:", e.message);
  }

  try {
    if (existsSync(rt.sessionsDir)) {
      // Only scan sessions from the previous calendar day
      const yesterdayStart = new Date();
      yesterdayStart.setHours(0, 0, 0, 0);
      const yesterdayStartMs = yesterdayStart.getTime() - 86400000;
      const yesterdayEndMs = yesterdayStart.getTime();

      const allFiles = readdirSync(rt.sessionsDir);
      const sessionFiles = allFiles.filter(f => {
        if (f.includes(".trajectory.")) return false;
        // .reset files: include if file content was modified yesterday or today
        // (rename doesn't change mtime, so content dated 2+ days ago is naturally skipped)
        if (f.includes(".reset.")) {
          try { const st = statSync(resolve(rt.sessionsDir, f)); return st.mtimeMs >= yesterdayStartMs; }
          catch (_) { return false; }
        }
        // Live .jsonl: include only if modified yesterday and no .reset counterpart exists
        if (f.endsWith(".jsonl")) {
          const base = f.replace(/\.jsonl$/, "");
          if (allFiles.some(rf => rf.startsWith(base) && rf.includes(".reset."))) return false;
          try {
            const st = statSync(resolve(rt.sessionsDir, f));
            return st.mtimeMs >= yesterdayStartMs && st.mtimeMs < yesterdayEndMs;
          } catch (_) { return false; }
        }
        return false;
      });
      for (const file of sessionFiles) {
        const filePath = resolve(rt.sessionsDir, file);
        const fileContent = readFileSync(filePath, "utf-8");
        const lines = fileContent.split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.type === "message" && entry.message) {
              const msg = entry.message;
              const role = msg.role || "";
              const content = msg.content || "";
              if (role === "user" && typeof content === "string" && content.length > 3) {
                logs.push({ category: "raw_log", text: `**User:** ${content}`, source: "conversation" });
              } else if (role === "assistant") {
                let text = "";
                if (typeof content === "string") text = content;
                else if (Array.isArray(content)) {
                  text = content
                    .filter(x => x && x.type === "text" && x.text)
                    .map(x => x.text)
                    .join(" ");
                }
                if (text.length > 5) {
                  logs.push({ category: "raw_log", text: `**Assistant:** ${text}`, source: "conversation" });
                }
              }
            }
          } catch (e) {
            // skip malformed lines
          }
        }
      }
      if (sessionFiles.length > 0) {
        console.log(`[checkpoint] Scanned ${sessionFiles.length} session files (reset + stale .jsonl), extracted raw_log entries`);
      }
    }
  } catch (e) {
    console.error("[checkpoint] Reset file scan warning:", e.message);
  }

  return logs;
}

module.exports = {
  parseSmartAddEntries,
  readYesterdayRawLogs,
};
