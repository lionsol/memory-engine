"use strict";
// Immutable published projections bind marker-free Core chunks to raw archives.
// No Core/Engine writes, model calls, or runtime indexing.
const fs = require("node:fs"), path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const archive = require("./summary-memory-archive.cjs");
const locator = require("./derived-summary-locator.cjs");
const VERSION = "checkpoint-episode-projection-v1", ROOT = "checkpoint-projections";
const ID = /^[a-f0-9]{64}$/, DATE = /^\d{4}-\d{2}-\d{2}$/;
const digest = value => createHash("sha256").update(value).digest("hex");
const fail = code => { throw Object.assign(new Error(code), { code }); };
function regularBytes(file) {
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink()) fail("derived_projection_not_regular");
  const bytes = fs.readFileSync(file), after = fs.lstatSync(file);
  if (["dev","ino","size","mtimeMs","ctimeMs"].some(key => before[key] !== after[key])) fail("derived_projection_changed");
  return bytes;
}
function names(directory) {
  try {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("derived_projection_directory");
    return fs.readdirSync(directory).sort();
  } catch (error) { if (error.code === "ENOENT") return []; throw error; }
}
function verifyProjection(doc, stored, expectedId = doc?.projection_id) {
  archive.verifyArchive(stored);
  const p = doc?.payload;
  if (!doc || Object.keys(doc).length !== 2 || !ID.test(doc.projection_id) || doc.projection_id !== expectedId
    || !p || digest(JSON.stringify(p)) !== doc.projection_id) fail("derived_projection_integrity");
  if (Object.keys(p).length !== 5 || p.version !== VERSION || p.archive_id !== stored.archive_id
    || !["prepared", "published"].includes(p.publication_status)
    || p.path !== "memory/episodes/" + stored.payload.input.target_date + ".md"
    || typeof p.text !== "string" || !p.text.isWellFormed() || p.text.length > 2000000) fail("derived_projection_schema");
  const lines = p.text.split("\n"), block = p.text.split(/\r?\n\r?\n/)[1] || "";
  const headers = block.split(/\r?\n/).filter(line => line.startsWith("derivedSummary: "));
  let header;
  try { if (headers.length !== 1) throw Error(); header = JSON.parse(headers[0].slice(16)); }
  catch { fail("derived_projection_header"); }
  if (!header || header.archive_id !== p.archive_id || header.previous_archive_id !== stored.payload.previous_archive_id) fail("derived_projection_header");
  const expected = locator.renderDerivedItemLines(stored);
  const itemLines = expected.map((line, index) => {
    const positions = lines.flatMap((value, offset) => value === line ? [offset + 1] : []);
    if (positions.length !== 1) fail("derived_projection_items");
    return { line: positions[0], item_index: index };
  });
  const marked = locator.inspectDerivedSnippet({ path: p.path, text: p.text });
  if (marked.status !== "unverified" || marked.archive_id !== p.archive_id
    || lines.filter(line => /^- \[checkpoint-derived:v1 /.test(line)).length !== expected.length) fail("derived_projection_items");
  return { lines, itemLines };
}
function createProjection(stored, text, publicationStatus = "published") {
  const payload = { version: VERSION, archive_id: stored.archive_id, publication_status: publicationStatus,
    path: "memory/episodes/" + stored.payload.input.target_date + ".md", text };
  const doc = { projection_id: digest(JSON.stringify(payload)), payload };
  verifyProjection(doc, stored); return doc;
}
function readProjection(memoryDir, date, id) {
  if (!DATE.test(date) || !ID.test(id)) fail("derived_projection_id");
  const relative_path = date + "/" + id + ".json";
  const bytes = regularBytes(path.join(memoryDir, ROOT, relative_path));
  let doc;
  try { doc = JSON.parse(bytes.toString("utf8")); } catch { fail("derived_projection_integrity"); }
  if (!doc || Object.keys(doc).length !== 2 || !doc.payload || !ID.test(doc.payload.archive_id || "")
    || doc.projection_id !== id || digest(JSON.stringify(doc.payload)) !== id) fail("derived_projection_integrity");
  const stored = archive.loadArchive(path.join(memoryDir, "checkpoint-archives"), doc?.payload?.archive_id);
  const verified = verifyProjection(doc, stored, id);
  if (stored.payload.input.target_date !== date) fail("derived_projection_date");
  return { relative_path, bytes, doc, stored, ...verified };
}
function persistProjection(memoryDir, doc) {
  const date = locator.episodeDate(doc?.payload?.path);
  const stored = archive.loadArchive(path.join(memoryDir, "checkpoint-archives"), doc?.payload?.archive_id);
  verifyProjection(doc, stored);
  const root = path.join(memoryDir, ROOT), directory = path.join(root, date);
  // Reject directory aliases before publishing any evidence.
  names(root); fs.mkdirSync(root, { recursive: true, mode: 0o700 }); names(directory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, doc.projection_id + ".json"), temp = target + "." + randomUUID() + ".tmp";
  let fd;
  try {
    fd = fs.openSync(temp, "wx", 0o600); fs.writeFileSync(fd, JSON.stringify(doc) + "\n"); fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    try { fs.linkSync(temp, target); } catch (error) { if (error.code !== "EEXIST") throw error; }
    for (const dir of [directory, root, memoryDir]) {
      const directoryFd = fs.openSync(dir, "r");
      try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    }
    const found = readProjection(memoryDir, date, doc.projection_id);
    if (JSON.stringify(found.doc) !== JSON.stringify(doc)) fail("derived_projection_conflict");
    return doc.projection_id;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}
function inventory(memoryDir, onlyDate, maxFiles = Infinity) {
  if (onlyDate !== undefined && !DATE.test(onlyDate)) fail("derived_projection_date");
  const root = path.join(memoryDir, ROOT), dates = names(root);
  if (dates.some(date => !DATE.test(date))) fail("derived_projection_inventory");
  const result = [];
  for (const date of dates.filter(value => onlyDate === undefined || value === onlyDate)) {
    const files = names(path.join(root, date));
    if (files.some(name => name.endsWith(".json") && !/^[a-f0-9]{64}\.json$/.test(name))) fail("derived_projection_inventory");
    for (const file of files.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      if (result.length >= maxFiles) fail("derived_projection_budget");
      result.push(readProjection(memoryDir, date, file.slice(0, -5)));
    }
  }
  return result;
}
// Core inserts separators inside long source lines. Provider byte splitting
// then takes exact substrings while keeping the parent's line bounds. Preserve
// all original line boundaries; never trim spaces or drop real blank lines.
function matchLineWindow(lines, start, end, text) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start
    || end > lines.length || typeof text !== "string" || !text.trim() || !text.isWellFormed()
    || text.length > 131072) return [];
  const parts = text.split("\n"), found = new Map();
  let work = 0;
  function* offsets(line) {
    if (parts[0] !== "") {
      for (let offset = line.indexOf(parts[0]); offset !== -1; offset = line.indexOf(parts[0], offset + 1)) yield offset;
      return;
    }
    // A child may begin with a separator cut from a parent. At most one
    // synthetic separator can occur here; further blank lines remain real.
    if (line === "") { yield 0; return; }
    if (parts[1]) for (let offset = line.indexOf(parts[1], 1); offset !== -1;
      offset = line.indexOf(parts[1], offset + 1)) yield offset;
    yield line.length;
  }
  for (let firstRow = start - 1; firstRow < end; firstRow++) {
    if (++work > 1000000) fail("derived_projection_budget");
    for (const offset of offsets(lines[firstRow])) {
      let row = firstRow, cursor = offset, valid = true;
      const contentLines = new Set();
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i], line = lines[row];
        work += Math.max(1, part.length);
        if (work > 1000000) fail("derived_projection_budget");
        const boundaryEmpty = (i === 0 && offset > 0) || i === parts.length - 1;
        if ((part === "" && line !== "" && !boundaryEmpty) || !line.startsWith(part, cursor)) {
          valid = false; break;
        }
        if (part.trim()) contentLines.add(row + 1);
        cursor += part.length;
        if (i < parts.length - 1) {
          if (cursor === line.length && row < end - 1) { row++; cursor = 0; }
          else if (cursor >= line.length || (part === "" && i !== 0)) { valid = false; break; }
        }
      }
      if (!valid || !contentLines.size) continue;
      const location = { start_line: firstRow + 1, end_line: row + 1, content_lines: [...contentLines] };
      const key = location.start_line + ":" + location.end_line + ":" + location.content_lines.join(",");
      found.set(key, location);
      if (found.size > 256) fail("derived_projection_budget");
    }
  }
  return [...found.values()];
}
function matchesRange(lines, start, end, text) {
  return matchLineWindow(lines, start, end, text).some(match => match.start_line === start && match.end_line === end);
}
function resolveProjectionChunk(candidate, { memoryDir, purpose = "recall", itemIndex, sourceId } = {}) {
  const date = locator.episodeDate(candidate.path);
  if (!date || typeof memoryDir !== "string" || !memoryDir) return null;
  if (!ID.test(candidate.hash || "") || digest(candidate.text || "") !== candidate.hash) return null;
  const start = candidate.start_line, end = candidate.end_line;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) return null;
  const files = inventory(memoryDir, date, 256).filter(file => file.doc.payload.publication_status === "published");
  const matches = [];
  for (const file of files) {
    for (const location of matchLineWindow(file.lines, start, end, candidate.text)) {
      const indexes = file.itemLines.filter(item => location.content_lines.includes(item.line)).map(item => item.item_index);
      matches.push({ ...file, location, indexes });
      if (matches.length > 256) fail("derived_projection_budget");
    }
  }
  if (!matches.length) {
    const marked = locator.inspectDerivedSnippet(candidate);
    if (marked.archive_id && files.some(file => file.stored.archive_id === marked.archive_id)) {
      fail("derived_projection_mismatch");
    }
    return null;
  }
  if (matches.every(file => file.indexes.length === 0)) return null;
  // Empty item scopes participate too: a header occurrence must not be silently
  // discarded in favor of an identical phrase in a summary item.
  const identities = new Set(matches.map(file => file.stored.archive_id + ":" + file.indexes.join(",")));
  if (identities.size !== 1) fail("derived_projection_ambiguous");
  const found = matches[0], id = found.stored.archive_id;
  const exactRange = matches.every(file => file.location.start_line === start && file.location.end_line === end);
  const spans = [...new Map(matches.map(file => {
    const span = { projection_id: file.doc.projection_id,
      start_line: file.location.start_line, end_line: file.location.end_line };
    return [JSON.stringify(span), span];
  })).values()];
  if (itemIndex !== undefined && !found.indexes.includes(itemIndex)) fail("derived_locator_item");
  const metadata = { kind: "derived_summary", lossy: true, semantic_correctness: "NOT_CERTIFIED",
    source_required_for: ["execution","exact_parameters","acceptance","disputed_claims"],
    status: "verified", archive_id: id, get_id: "checkpoint:" + id, item_indexes: found.indexes,
    scope: exactRange ? "archived_projection_line_range" : "archived_projection_line_window",
    projection_ids: [...new Set(matches.map(file => file.doc.projection_id))],
    core_line_window: { start_line: start, end_line: end }, matched_source_spans: spans,
    provenance_basis: "exact_projection_match_not_core_ingestion_attestation",
    newline_policy: "core_inserted_segment_separators_only",
    previous_archive_id: found.stored.payload.previous_archive_id,
    quality_findings: [...found.stored.payload.quality_findings] };
  return { metadata, ...(purpose !== "recall" || sourceId !== undefined ? {
    evidence: require("./derived-summary").readDerivedSummary(id, {
      directory: path.join(memoryDir, "checkpoint-archives"), purpose, itemIndex, sourceId,
    }),
  } : {}) };
}
module.exports = { VERSION, ROOT, createProjection, verifyProjection, readProjection, persistProjection,
  inventory, matchesRange, matchLineWindow, resolveProjectionChunk };
