const crypto = require("node:crypto");
const { appendFileSync, existsSync, mkdirSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const checkpointDate = require("./date");
const { withDb, withMeDb } = require("./db");
const { parseSmartAddEntries } = require("./raw-log");
const { getRuntime } = require("./runtime");

function mapToCategory(type) {
  const map = {
    profile: "user_identity",
    preference: "preference",
    entity: "kg_node",
    event: "episodic",
    case: "episodic",
    pattern: "preference",
  };
  return map[type] || "raw_log";
}

function appendSmartAdd(text, category, opts = {}) {
  const rt = getRuntime();
  const today = checkpointDate.todayDateStr(rt.now(), rt.timeZone);
  const fileDir = rt.smartAddDir;
  const filePath = resolve(fileDir, `${today}.md`);
  mkdirSync(fileDir, { recursive: true });
  const fingerprint = smartAddFingerprint({ category, raw: text, kg_data: opts.kg_data });
  const existing = readSmartAddFingerprints(today);
  if (existing.has(fingerprint)) return null;

  const generatedAt = opts.generatedAt || rt.now();
  const entryId = opts.entryId || checkpointDate.buildNightlyEntryId({
    targetDate: opts.targetDate || checkpointDate.yesterdayDateStr(generatedAt, rt.timeZone),
    category,
    generatedAt,
    timeZone: rt.timeZone,
  });
  const entry = `<!-- smart-add-fingerprint: ${fingerprint} -->\n## ${entryId}\n\nCategory: ${category}${opts.protected ? " | Protected" : ""}${opts.kg_data ? `\n\nkg_data: ${opts.kg_data}` : ""}\n\n${text.trim()}\n\n`;

  const header = !existsSync(filePath) ? "# Smart Added Memory\n\n" : "";
  appendFileSync(filePath, header ? `${header}${entry}` : `\n${entry}`);

  return entryId;
}

function canonicalizeSmartAddEntry({ raw = "", category = "", kg_data = "" }) {
  const normalized = String(raw || "").replace(/\r\n/g, "\n");
  const withoutTitle = normalized.replace(/^\s*##\s+.*\n?/, "");
  const withoutComments = withoutTitle.replace(/<!--[\s\S]*?-->/g, "");
  const cat = String(category || "").trim();
  const kg = String(kg_data || "").trim();
  const base = cat ? `Category: ${cat}${kg ? `\n\nkg_data: ${kg}` : ""}\n\n${withoutComments}` : withoutComments;
  return base.replace(/\s+/g, " ").trim();
}

function smartAddFingerprint(entry) {
  const canonical = canonicalizeSmartAddEntry(entry || {});
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function parseNodeProperties(text) {
  const raw = String(text || "");
  const nodeMatch = raw.match(/^Node:\s*(.+)$/mi);
  const propsMatch = raw.match(/^Properties:\s*(.+)$/mi);
  return {
    node: nodeMatch ? nodeMatch[1].trim() : "",
    properties: propsMatch ? propsMatch[1].trim() : "",
  };
}

function readSmartAddFingerprints(date = null) {
  const rt = getRuntime();
  const resolvedDate = date || checkpointDate.todayDateStr(rt.now(), rt.timeZone);
  const filePath = resolve(rt.smartAddDir, `${resolvedDate}.md`);
  if (!existsSync(filePath)) return new Set();
  const content = readFileSync(filePath, "utf-8");
  const fpCommentRe = /<!--\s*smart-add-fingerprint:\s*([a-f0-9]{8,64})\s*-->/gi;
  const parsed = parseSmartAddEntries(content);
  const set = new Set();
  let match;
  while ((match = fpCommentRe.exec(content)) !== null) {
    if (match[1]) set.add(String(match[1]).toLowerCase());
  }
  for (const entry of parsed) {
    const fp = smartAddFingerprint({ raw: entry.raw || entry.text });
    set.add(fp);
  }
  return set;
}

function isDuplicate(text, category = "raw_log") {
  try {
    const rt = getRuntime();
    const today = checkpointDate.todayDateStr(rt.now(), rt.timeZone);
    const fp = smartAddFingerprint({ category, raw: text });
    const todayFp = readSmartAddFingerprints(today);
    if (todayFp.has(fp)) return true;

    const ftsMatch = withDb((db) => {
      const fts = db.prepare(`
        SELECT COUNT(*) as cnt FROM chunks_fts
        WHERE chunks_fts MATCH ?
      `).get(text.replace(/[^\w\u4e00-\u9fff]/g, " ").split(/\s+/).filter(Boolean).slice(0, 5).join(" "));
      return fts && fts.cnt > 0;
    });
    if (ftsMatch) return true;

    const keyFrags = text.match(/[\u4e00-\u9fff\w]{4,}/g) || [];
    const sig = keyFrags.slice(0, 3).join("|");
    if (!sig) return false;

    return withMeDb((db) => {
      const existing = db.prepare(`
        SELECT COUNT(*) as cnt FROM chunks_db.chunks c
        JOIN memory_confidence mc ON c.id = mc.chunk_id
        WHERE mc.is_archived = 0
        AND (c.text LIKE ? OR c.text LIKE ? OR c.text LIKE ?)
      `).get(`%${keyFrags[0] || ""}%`, `%${keyFrags[1] || ""}%`, `%${keyFrags[2] || ""}%`);
      return (existing && existing.cnt >= 2);
    });
  } catch (e) {
    return false;
  }
}

module.exports = {
  mapToCategory,
  appendSmartAdd,
  canonicalizeSmartAddEntry,
  smartAddFingerprint,
  parseNodeProperties,
  readSmartAddFingerprints,
  isDuplicate,
};
