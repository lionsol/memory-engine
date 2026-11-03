"use strict";
// Search projection is pure. Archive/projection IO happens only on an explicit get.
const path = require("node:path");
const lab = require("./summary-comparison-lab.cjs");
const archive = require("./summary-memory-archive.cjs");
const { readDerivedSummary } = require("./derived-summary");
const PREFIX = /^- \[checkpoint-derived:v1 archive=([a-f0-9]{64}) item=([0-9]+)\] /;
const PURPOSES = ["recall", "execution", "exact_parameters", "acceptance", "disputed_claims"];
const fail = code => { throw Object.assign(new Error(code), { code }); };
function episodeDate(value) {
  if (typeof value !== "string") return null;
  return value.replace(/\\/g, "/").match(/^memory\/episodes\/(\d{4}-\d{2}-\d{2})\.md$/)?.[1] || null;
}
function prefix(id, itemIndex) {
  return "- [checkpoint-derived:v1 archive=" + id + " item=" + itemIndex + "] ";
}
function oneLine(value) {
  return value.replace(/\\/g, "\\\\").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}
function renderDerivedItemLines(stored) {
  const p = stored.payload;
  return p.summary.items.map((item, index) => {
    const body = lab.validateSummary(p.input, { ...p.summary, items: [item] },
      p.summary_max_chars, { allowDuplicateReferences: true }).body;
    // Encoding line breaks prevents model text from introducing a second marker.
    return prefix(stored.archive_id, index) + oneLine(body.slice(2));
  });
}
function markedLines(text) {
  if (typeof text !== "string") return [];
  return text.split(/\r?\n/).flatMap(line => {
    const match = line.match(PREFIX);
    return match ? [{ archive_id: match[1], item_index: Number(match[2]), line }] : [];
  });
}
function inspectDerivedSnippet(candidate = {}) {
  if (!episodeDate(candidate.path)) return null;
  const marks = markedLines(candidate.text);
  const base = { kind: "derived_summary", lossy: true, semantic_correctness: "NOT_CERTIFIED",
    source_required_for: PURPOSES.filter(purpose => purpose !== "recall") };
  if (!marks.length) return { kind: "episode_unlinked", status: "locator_unavailable",
    semantic_correctness: "NOT_CERTIFIED", source_required_for: [...base.source_required_for] };
  const ids = [...new Set(marks.map(mark => mark.archive_id))];
  if (ids.length !== 1 || marks.some(mark => !Number.isSafeInteger(mark.item_index))) {
    return { ...base, status: "locator_conflict" };
  }
  return { ...base, status: "unverified", archive_id: ids[0],
    get_id: "checkpoint:" + ids[0],
    item_indexes: [...new Set(marks.map(mark => mark.item_index))].sort((a, b) => a - b),
    scope: "marked_items_only" };
}
function resolveDerivedSnippet(candidate, { memoryDir, purpose = "recall", itemIndex, sourceId } = {}) {
  const info = inspectDerivedSnippet(candidate);
  if (!info) return null;
  if (!PURPOSES.includes(purpose)) fail("derived_read_purpose");
  if (info.status === "locator_conflict") fail("derived_locator_conflict");
  const projected = require("./episode-projection.cjs").resolveProjectionChunk(candidate, {
    memoryDir, purpose, itemIndex, sourceId,
  });
  if (projected) return projected;
  if (info.status === "locator_unavailable") {
    if (purpose !== "recall" || itemIndex !== undefined || sourceId !== undefined) fail("derived_locator_unavailable");
    return { metadata: info };
  }
  if (typeof memoryDir !== "string" || !memoryDir) fail("derived_memory_directory_unavailable");
  const directory = path.resolve(memoryDir, "checkpoint-archives");
  const stored = archive.loadArchive(directory, info.archive_id);
  if (stored.payload.input.target_date !== episodeDate(candidate.path)) fail("derived_locator_date");
  const expected = renderDerivedItemLines(stored);
  for (const mark of markedLines(candidate.text)) {
    // Core may end a chunk midway through a long line. Only an exact prefix of
    // that immutable item's rendered line is accepted; added/changed text fails.
    if (!expected[mark.item_index]?.trimEnd().startsWith(mark.line.trimEnd())) fail("derived_locator_text");
  }
  if (itemIndex !== undefined && !info.item_indexes.includes(itemIndex)) fail("derived_locator_item");
  return { metadata: { ...info, status: "verified",
    previous_archive_id: stored.payload.previous_archive_id,
    quality_findings: [...stored.payload.quality_findings] },
    ...(purpose !== "recall" || sourceId !== undefined ? {
      evidence: readDerivedSummary(info.archive_id, { directory, purpose, itemIndex, sourceId }),
    } : {}) };
}
// Existing disclosure cards already attest source_hint. Keep the locator in
// that bounded presentation field, rather than adding an unattested payload.
function formatDerivedSourceHint(baseHint, info, memoryId) {
  if (!info || !["unverified", "locator_conflict", "locator_unavailable"].includes(info.status)) return baseHint;
  let suffix;
  if (info.status === "locator_unavailable") {
    if (info.kind !== "episode_unlinked") return baseHint;
    // A marker-free episode may be legacy text or a derived continuation.
    // Preserve uncertainty; only explicit Get may resolve immutable evidence.
    const id = typeof memoryId === "string" ? memoryId : "";
    const usableId = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(id) && !id.startsWith("checkpoint:");
    suffix = " | episode_unlinked semantic=NOT_CERTIFIED locator=unavailable"
      + (usableId ? " get=memory_engine_get:" + id : " get=unavailable");
  } else if (info.status === "locator_conflict") {
    suffix = " | derived_summary lossy=true semantic=NOT_CERTIFIED locator=conflict";
  } else {
    suffix = " | derived_summary lossy=true semantic=NOT_CERTIFIED";
    if (!/^[a-f0-9]{64}$/.test(info.archive_id) || !Array.isArray(info.item_indexes)
      || info.item_indexes.length < 1
      || info.item_indexes.some(index => !Number.isSafeInteger(index) || index < 0)) return baseHint;
    const indexes = [...new Set(info.item_indexes)].sort((a, b) => a - b);
    suffix += " locator=unverified archive=checkpoint:" + info.archive_id
      + " items=" + indexes.slice(0, 8).join(",")
      + (indexes.length > 8 ? ";more=" + (indexes.length - 8) : "");
  }
  suffix += " source_required_for=parameters,acceptance,execution,disputed_claims";
  const base = String(baseHint || "unknown source").replace(/\s+/g, " ").trim();
  return base.slice(0, Math.max(0, 512 - suffix.length)) + suffix;
}
module.exports = { episodeDate, renderDerivedItemLines, inspectDerivedSnippet, resolveDerivedSnippet,
  formatDerivedSourceHint };
