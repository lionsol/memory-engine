const { createHash } = require("node:crypto");

function createSmartAddCollector({
  existsSync,
  readFileSync,
  resolve,
  getRuntime,
  parseSmartAddEntries,
  inferCategoryFromEntry,
  buildDedupeKey,
  trustedProvenance,
}) {
  if (typeof existsSync !== "function") throw new Error("existsSync is required");
  if (typeof readFileSync !== "function") throw new Error("readFileSync is required");
  if (typeof resolve !== "function") throw new Error("resolve is required");
  if (typeof getRuntime !== "function") throw new Error("getRuntime is required");
  if (typeof parseSmartAddEntries !== "function") throw new Error("parseSmartAddEntries is required");
  if (typeof inferCategoryFromEntry !== "function") throw new Error("inferCategoryFromEntry is required");
  if (typeof buildDedupeKey !== "function") throw new Error("buildDedupeKey is required");

  const allowedProvenance = trustedProvenance instanceof Set
    ? trustedProvenance
    : new Set(trustedProvenance || []);

  function isSessionFlushDialogue(entry) {
    if (String(entry?.provenance || "").toLowerCase() !== "session_flush") return false;
    if (String(entry?.category || "").toLowerCase() !== "raw_log") return false;
    const firstBodyLine = String(entry?.text || "")
      .split("\n")
      .find(line => String(line || "").trim());
    return /^\*\*(?:User|Assistant):\*\*\s+\S/i.test(String(firstBodyLine || "").trim());
  }

  return function collectSmartAddLogs(targetDate, stats) {
    const rt = getRuntime();
    const collected = [];
    const smartAddPath = resolve(rt.smartAddDir, `${targetDate}.md`);
    if (!existsSync(smartAddPath)) return collected;

    const content = readFileSync(smartAddPath, "utf-8");
    const sourceFileHash = createHash("sha256").update(content).digest("hex");
    const entries = parseSmartAddEntries(content);
    for (const parsed of entries) {
      const provenance = String(parsed.provenance || "unknown").toLowerCase();
      if (!allowedProvenance.has(provenance)) {
        if (provenance === "checkpoint_generated") {
          stats.smartAddSkippedCheckpointGenerated += 1;
        } else {
          stats.smartAddSkippedUnknownProvenance += 1;
        }
        continue;
      }
      const category = parsed.category || inferCategoryFromEntry(parsed.raw || parsed.text);
      const body = String(parsed.text || parsed.raw || "").trim();
      if (!body) continue;
      const sessionFlushConversation = isSessionFlushDialogue(parsed);
      stats.sourceCounts.smartAdd += 1;
      stats.sourceCharCountsBefore.smartAdd += body.length;
      stats.smartAddIncluded += 1;
      if (sessionFlushConversation) {
        stats.smartAddConversationIncluded = (Number(stats.smartAddConversationIncluded) || 0) + 1;
      }
      collected.push({
        category,
        sourceFileHash,
        text: body,
        source: sessionFlushConversation ? "conversation" : "note",
        sourceKind: "smartAdd",
        role: sessionFlushConversation ? "other" : "note",
        provenance,
        entryId: parsed.entryId || null,
        dedupeKey: buildDedupeKey(category, body),
        timestampMs: null,
        sessionId: sessionFlushConversation ? parsed.entryId || null : null,
      });
    }
    return collected;
  };
}

module.exports = {
  createSmartAddCollector,
};
