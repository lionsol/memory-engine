"use strict";
// Maintenance of collected evidence, independent of confidence and retrieval.
// No archive pruning, summary generation, database access, or network calls.
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const archive = require("./summary-memory-archive.cjs");
const locator = require("./derived-summary-locator.cjs");
const projectionStore = require("./episode-projection.cjs");

const VERSION = "checkpoint-archive-backup-v2";
const ID = /^[a-f0-9]{64}$/;
const EPISODE = /^(\d{4}-\d{2}-\d{2})\.md(?:\.[a-zA-Z0-9-]+\.previous)?$/;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
function fail(code) { throw Object.assign(new Error(code), { code }); }
function entries(directory, kind) {
  let stat;
  try { stat = fs.lstatSync(directory); } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("checkpoint_maintenance_directory");
  const names = fs.readdirSync(directory).sort();
  if (kind === "archives") {
    if (names.some(name => name.endsWith(".json") && !/^[a-f0-9]{64}\.json$/.test(name))) {
      fail("checkpoint_maintenance_archive_name");
    }
    return names.filter(name => /^[a-f0-9]{64}\.json$/.test(name));
  }
  if (names.some(name => /\.checkpoint\.lock$/.test(name))) fail("checkpoint_maintenance_busy");
  return names.filter(name => EPISODE.test(name));
}
function readRegular(file) {
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink()) fail("checkpoint_maintenance_not_regular");
  const bytes = fs.readFileSync(file), after = fs.lstatSync(file);
  if (["dev", "ino", "size", "mtimeMs", "ctimeMs"].some(key => before[key] !== after[key])) {
    fail("checkpoint_maintenance_changed");
  }
  return bytes;
}
function parseArchive(bytes, id) {
  try {
    const stored = JSON.parse(bytes.toString("utf8"));
    archive.verifyArchive(stored, id);
    return stored;
  } catch { fail("checkpoint_maintenance_archive_invalid"); }
}
function headerReference(text) {
  // Match the same trusted metadata block used by checkpoint revisions.
  const block = text.split(/\r?\n\r?\n/)[1] || "";
  const lines = block.split(/\r?\n/).filter(line => line.startsWith("derivedSummary: "));
  if (!lines.length) return null;
  if (lines.length !== 1) fail("checkpoint_maintenance_episode_header");
  try {
    const value = JSON.parse(lines[0].slice("derivedSummary: ".length));
    if (!value || !ID.test(value.archive_id)) fail("checkpoint_maintenance_episode_header");
    return value;
  } catch { fail("checkpoint_maintenance_episode_header"); }
}
function capture(memoryDir, episodesDir) {
  const directory = path.join(memoryDir, "checkpoint-archives");
  const archiveNames = entries(directory, "archives"), episodeNames = entries(episodesDir, "episodes");
  const archives = archiveNames.map(name => {
    const bytes = readRegular(path.join(directory, name)), id = name.slice(0, -5);
    return { name, bytes, stored: parseArchive(bytes, id) };
  });
  const projections = projectionStore.inventory(memoryDir);
  const projectionFingerprint = files => JSON.stringify(files.map(file => ({
    path: file.relative_path, sha256: digest(file.bytes),
  })));
  const byId = new Map(archives.map(file => [file.stored.archive_id, file.stored]));
  let historyLinks = 0;
  for (const { stored } of archives) {
    const previous = stored.payload.previous_archive_id;
    if (previous === null) continue;
    const old = byId.get(previous);
    if (!old) fail("checkpoint_maintenance_history_missing");
    if (old.payload.input.target_date !== stored.payload.input.target_date) fail("checkpoint_maintenance_history_date");
    historyLinks += 1;
  }
  const checkedEpisodes = [], episodes = [];
  let headerReferences = 0, markedItems = 0;
  for (const name of episodeNames) {
    const bytes = readRegular(path.join(episodesDir, name)), text = bytes.toString("utf8");
    checkedEpisodes.push({ name, bytes });
    const date = name.match(EPISODE)[1];
    const candidate = { path: "memory/episodes/" + date + ".md", text };
    const header = headerReference(text), info = locator.inspectDerivedSnippet(candidate);
    if (info.status === "locator_conflict") fail("checkpoint_maintenance_episode_conflict");
    const ids = new Set();
    if (header) { ids.add(header.archive_id); headerReferences += 1; }
    if (info.status === "unverified") { ids.add(info.archive_id); markedItems += info.item_indexes.length; }
    if (ids.size > 1) fail("checkpoint_maintenance_episode_conflict");
    if (!ids.size) continue; // Legacy text has no inferred archive or provenance.
    const id = [...ids][0], stored = byId.get(id);
    if (!stored) fail("checkpoint_maintenance_reference_missing");
    if (stored.payload.input.target_date !== date) fail("checkpoint_maintenance_episode_date");
    if (header && header.previous_archive_id !== stored.payload.previous_archive_id) {
      fail("checkpoint_maintenance_episode_history");
    }
    if (info.status === "unverified") {
      try { locator.resolveDerivedSnippet(candidate, { memoryDir }); }
      catch { fail("checkpoint_maintenance_episode_projection"); }
    }
    episodes.push({ name, bytes, archive_id: id,
      reference_scope: info.status === "unverified" ? "marked_items_only" : "header_only" });
  }
  function unchanged() {
    if (projectionFingerprint(projections) !== projectionFingerprint(projectionStore.inventory(memoryDir))) {
      fail("checkpoint_maintenance_changed");
    }
    if (JSON.stringify(archiveNames) !== JSON.stringify(entries(directory, "archives"))
      || JSON.stringify(episodeNames) !== JSON.stringify(entries(episodesDir, "episodes"))) {
      fail("checkpoint_maintenance_changed");
    }
    for (const file of archives) {
      if (!readRegular(path.join(directory, file.name)).equals(file.bytes)) fail("checkpoint_maintenance_changed");
    }
    for (const file of checkedEpisodes) {
      if (!readRegular(path.join(episodesDir, file.name)).equals(file.bytes)) fail("checkpoint_maintenance_changed");
    }
  }
  unchanged();
  return { directory, archives, episodes, projections, unchanged, report: {
    status: "verified", archive_count: archives.length,
    archive_bytes: archives.reduce((total, file) => total + file.bytes.length, 0), history_links: historyLinks,
    projection_count: projections.length,
    episode_files_scanned: episodeNames.length, derived_episode_files: episodes.length,
    header_references: headerReferences, marked_items: markedItems,
    semantic_correctness: "NOT_CERTIFIED", retention: "keep_all_versions_no_pruning",
    verification_scope: "collected_records_and_observed_file_references",
  } };
}
function physicalPath(value) {
  const absolute = path.resolve(value);
  let parent = absolute;
  while (true) {
    try { return path.resolve(fs.realpathSync(parent), path.relative(parent, absolute)); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      const next = path.dirname(parent);
      if (next === parent) throw error;
      parent = next;
    }
  }
}
function overlaps(left, right) {
  const contains = (parent, child) => {
    const relative = path.relative(parent, child);
    return relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep)
      && !path.isAbsolute(relative));
  };
  return contains(left, right) || contains(right, left);
}
function backupDestination(value, sources) {
  if (typeof value !== "string" || !path.isAbsolute(value)) fail("checkpoint_maintenance_backup_path");
  const destination = physicalPath(value);
  if (sources.some(source => overlaps(destination, physicalPath(source)))) {
    fail("checkpoint_maintenance_backup_overlap");
  }
  return destination;
}
function ensureDirectory(directory) {
  const firstCreated = fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("checkpoint_maintenance_directory");
  if (firstCreated) {
    const stop = path.dirname(firstCreated);
    for (let current = directory; ; current = path.dirname(current)) {
      syncDirectory(current);
      if (current === stop) break;
    }
  }
}
function syncDirectory(directory) {
  const fd = fs.openSync(directory, "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function publishBytes(directory, name, bytes) {
  ensureDirectory(directory);
  const target = path.join(directory, name), temporary = target + "." + randomUUID() + ".tmp";
  let fd, created = false;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    try { fs.linkSync(temporary, target); created = true; }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    syncDirectory(directory);
    if (!readRegular(target).equals(bytes)) fail("checkpoint_maintenance_backup_conflict");
    return created;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}
function assertIndependentCopy(source, target) {
  const original = fs.statSync(source), copied = fs.statSync(target);
  if (original.dev === copied.dev && original.ino === copied.ino) fail("checkpoint_maintenance_backup_alias");
}
function runCheckpointArchiveMaintenance({ memoryDir, episodesDir,
  backupDir, dryRun = false } = {}) {
  if (typeof memoryDir !== "string" || !memoryDir) fail("checkpoint_maintenance_memory_dir");
  memoryDir = path.resolve(memoryDir);
  episodesDir = episodesDir === undefined ? path.join(memoryDir, "episodes") : path.resolve(episodesDir);
  const snapshot = capture(memoryDir, episodesDir);
  const report = { ...snapshot.report, dry_run: Boolean(dryRun),
    backup: { status: "not_configured" } };
  if (backupDir === undefined || backupDir === null || backupDir === "") return report;
  const destination = backupDestination(backupDir, [snapshot.directory, episodesDir,
    path.join(memoryDir, projectionStore.ROOT)]);
  const payload = { version: VERSION,
    consistency: "observed_stable_inventory_not_atomic_filesystem_snapshot",
    retention: "keep_all_versions_no_pruning",
    archives: snapshot.archives.map(file => ({ archive_id: file.stored.archive_id,
      bytes: file.bytes.length, sha256: digest(file.bytes),
      previous_archive_id: file.stored.payload.previous_archive_id })),
    projections: snapshot.projections.map(file => ({ path: file.relative_path,
      projection_id: file.doc.projection_id, archive_id: file.doc.payload.archive_id,
      publication_status: file.doc.payload.publication_status, bytes: file.bytes.length, sha256: digest(file.bytes) })),
    episodes: snapshot.episodes.map(file => ({ name: file.name, archive_id: file.archive_id,
      bytes: file.bytes.length, sha256: digest(file.bytes), reference_scope: file.reference_scope })) };
  const snapshotId = digest(JSON.stringify(payload));
  report.backup = { status: dryRun ? "planned" : "complete", directory: destination,
    snapshot_id: snapshotId, archive_count: payload.archives.length, episode_count: payload.episodes.length,
    projection_count: payload.projections.length };
  if (dryRun) return report;
  ensureDirectory(destination);
  let created = 0, reused = 0;
  for (const file of snapshot.archives) {
    if (publishBytes(path.join(destination, "checkpoint-archives"), file.name, file.bytes)) created += 1;
    else reused += 1;
  }
  for (const file of snapshot.projections) {
    if (publishBytes(path.join(destination, projectionStore.ROOT, path.dirname(file.relative_path)),
      path.basename(file.relative_path), file.bytes)) created += 1;
    else reused += 1;
  }
  for (const file of snapshot.episodes) {
    if (publishBytes(path.join(destination, "episode-objects"), digest(file.bytes) + ".md", file.bytes)) created += 1;
    else reused += 1;
  }
  // Partial copied objects remain recoverable, but do not publish a completed
  // inventory if the source changed or any copy failed verification.
  snapshot.unchanged();
  for (const file of snapshot.archives) {
    const target = path.join(destination, "checkpoint-archives", file.name);
    if (!readRegular(target).equals(file.bytes)) fail("checkpoint_maintenance_backup_conflict");
    assertIndependentCopy(path.join(snapshot.directory, file.name), target);
  }
  for (const file of snapshot.episodes) {
    const target = path.join(destination, "episode-objects", digest(file.bytes) + ".md");
    if (!readRegular(target).equals(file.bytes)) fail("checkpoint_maintenance_backup_conflict");
    assertIndependentCopy(path.join(episodesDir, file.name), target);
  }
  for (const file of snapshot.projections) {
    const target = path.join(destination, projectionStore.ROOT, file.relative_path);
    if (!readRegular(target).equals(file.bytes)) fail("checkpoint_maintenance_backup_conflict");
    assertIndependentCopy(path.join(memoryDir, projectionStore.ROOT, file.relative_path), target);
  }
  const manifest = Buffer.from(JSON.stringify({ snapshot_id: snapshotId, payload }) + "\n");
  publishBytes(path.join(destination, "manifests"), snapshotId + ".json", manifest);
  syncDirectory(destination);
  report.backup.objects_created = created;
  report.backup.objects_reused = reused;
  return report;
}
module.exports = { VERSION, runCheckpointArchiveMaintenance };
