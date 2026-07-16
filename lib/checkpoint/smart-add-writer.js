const crypto = require("node:crypto");
const { appendFileSync, existsSync, mkdirSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const checkpointDate = require("./date");
const { withDb, withCheckpointDbs } = require("./db");
const { parseSmartAddEntries } = require("./raw-log");
const { getRuntime } = require("./runtime");
const SMART_ADD_DUPLICATE_BATCH_SIZE = 500;

const SMART_ADD_PROVENANCE = Object.freeze({
  MANUAL: "manual",
  AGENT_SMART_ADD: "agent_smart_add",
  CHECKPOINT_GENERATED: "checkpoint_generated",
  MIGRATED_LEGACY: "migrated_legacy",
  UNKNOWN: "unknown",
});

function normalizeProvenance(value, fallback = SMART_ADD_PROVENANCE.UNKNOWN) {
  const normalized = String(value || "").trim().toLowerCase();
  switch (normalized) {
    case SMART_ADD_PROVENANCE.MANUAL:
    case SMART_ADD_PROVENANCE.AGENT_SMART_ADD:
    case SMART_ADD_PROVENANCE.CHECKPOINT_GENERATED:
    case SMART_ADD_PROVENANCE.MIGRATED_LEGACY:
    case SMART_ADD_PROVENANCE.UNKNOWN:
      return normalized;
    default:
      return fallback;
  }
}

function resolveOutputTarget(opts = {}) {
  const rt = getRuntime();
  const provenance = normalizeProvenance(opts.provenance, SMART_ADD_PROVENANCE.CHECKPOINT_GENERATED);
  const today = checkpointDate.todayDateStr(rt.now(), rt.timeZone);
  if (provenance === SMART_ADD_PROVENANCE.CHECKPOINT_GENERATED) {
    return {
      provenance,
      today,
      fileDir: rt.generatedSmartAddDir,
      filePath: resolve(rt.generatedSmartAddDir, `${today}.md`),
      fileRel: `memory/generated-smart-add/${today}.md`,
    };
  }
  return {
    provenance,
    today,
    fileDir: rt.smartAddDir,
    filePath: resolve(rt.smartAddDir, `${today}.md`),
    fileRel: `memory/smart-add/${today}.md`,
  };
}

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
  const target = resolveOutputTarget(opts);
  const today = target.today;
  const fileDir = target.fileDir;
  const filePath = target.filePath;
  mkdirSync(fileDir, { recursive: true });
  const fingerprint = smartAddFingerprint({ category, raw: text, kg_data: opts.kg_data });
  const existing = readSmartAddFingerprints(today, { provenance: target.provenance });
  if (existing.has(fingerprint)) return null;

  const generatedAt = opts.generatedAt || rt.now();
  const entryId = opts.entryId || checkpointDate.buildNightlyEntryId({
    targetDate: opts.targetDate || checkpointDate.yesterdayDateStr(generatedAt, rt.timeZone),
    category,
    generatedAt,
    timeZone: rt.timeZone,
  });
  const entry = `<!-- smart-add-fingerprint: ${fingerprint} -->\n## ${entryId}\n\nCategory: ${category}${opts.protected ? " | Protected" : ""}\nProvenance: ${target.provenance}${opts.kg_data ? `\n\nkg_data: ${opts.kg_data}` : ""}\n\n${text.trim()}\n\n`;

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

function readSmartAddFingerprints(date = null, opts = {}) {
  const rt = getRuntime();
  const resolvedDate = date || checkpointDate.todayDateStr(rt.now(), rt.timeZone);
  const provenance = normalizeProvenance(opts.provenance, SMART_ADD_PROVENANCE.AGENT_SMART_ADD);
  const filePath = provenance === SMART_ADD_PROVENANCE.CHECKPOINT_GENERATED
    ? resolve(rt.generatedSmartAddDir, `${resolvedDate}.md`)
    : resolve(rt.smartAddDir, `${resolvedDate}.md`);
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

function chunkItems(items, batchSize = SMART_ADD_DUPLICATE_BATCH_SIZE) {
  const chunks = [];
  for (let index = 0; index < items.length; index += batchSize) {
    chunks.push(items.slice(index, index + batchSize));
  }
  return chunks;
}

function readEligibleChunkIds(engineDb) {
  return engineDb.prepare(`
    SELECT chunk_id
    FROM memory_confidence
    WHERE is_archived = 0
  `).all().map((row) => String(row.chunk_id || ""));
}

function hasCoreFtsDuplicate(coreDb, matchQuery) {
  if (!matchQuery) return false;
  const row = coreDb.prepare(`
    SELECT COUNT(*) as cnt FROM chunks_fts
    WHERE chunks_fts MATCH ?
  `).get(matchQuery);
  return row && Number(row.cnt || 0) > 0;
}

function countEligibleLikeDuplicates(coreDb, eligibleChunkIds, likePatterns) {
  if (eligibleChunkIds.length === 0) return 0;
  let total = 0;
  for (const batch of chunkItems(eligibleChunkIds)) {
    if (batch.length === 0) continue;
    const placeholders = batch.map(() => "?").join(", ");
    const row = coreDb.prepare(`
      SELECT COUNT(*) AS cnt
      FROM chunks
      WHERE id IN (${placeholders})
        AND (text LIKE ? OR text LIKE ? OR text LIKE ?)
    `).get(...batch, ...likePatterns);
    total += Number(row?.cnt || 0);
    if (total >= 2) return total;
  }
  return total;
}

function isDuplicate(text, category = "raw_log", options = {}) {
  try {
    const rt = getRuntime();
    const today = checkpointDate.todayDateStr(rt.now(), rt.timeZone);
    const fp = smartAddFingerprint({ category, raw: text });
    const todayFp = readSmartAddFingerprints(today, {
      provenance: normalizeProvenance(options.provenance, SMART_ADD_PROVENANCE.AGENT_SMART_ADD),
    });
    if (todayFp.has(fp)) return true;

    const matchQuery = text.replace(/[^\w\u4e00-\u9fff]/g, " ").split(/\s+/).filter(Boolean).slice(0, 5).join(" ");
    const ftsDuplicate = withDb((coreDb) => hasCoreFtsDuplicate(coreDb, matchQuery));
    if (ftsDuplicate) return true;

    const keyFrags = text.match(/[\u4e00-\u9fff\w]{4,}/g) || [];
    const sig = keyFrags.slice(0, 3).join("|");
    if (!sig) return false;

    return withCheckpointDbs(({ engineDb, coreDb }) => {
      const eligibleChunkIds = readEligibleChunkIds(engineDb);
      if (eligibleChunkIds.length === 0) return false;

      const existingCount = countEligibleLikeDuplicates(
        coreDb,
        eligibleChunkIds,
        [`%${keyFrags[0] || ""}%`, `%${keyFrags[1] || ""}%`, `%${keyFrags[2] || ""}%`],
      );
      return existingCount >= 2;
    }, { readonlyEngine: true });
  } catch (e) {
    return false;
  }
}

module.exports = {
  SMART_ADD_PROVENANCE,
  mapToCategory,
  normalizeProvenance,
  resolveOutputTarget,
  appendSmartAdd,
  canonicalizeSmartAddEntry,
  smartAddFingerprint,
  parseNodeProperties,
  readSmartAddFingerprints,
  isDuplicate,
};
