"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { createHash } = require("node:crypto"), { spawnSync } = require("node:child_process");
const Database = require("better-sqlite3");
const archive = require("../lib/checkpoint/summary-memory-archive.cjs");
const locator = require("../lib/checkpoint/derived-summary-locator.cjs");
const lab = require("../lib/checkpoint/summary-comparison-lab.cjs");
const { buildFactInput } = require("../lib/checkpoint/ordinary-summary-facts");
const { runCheckpointArchiveMaintenance: run } = require("../lib/checkpoint/archive-maintenance.cjs");
const DATE = "2026-10-20", RAW = "source=before_prompt_build；trigger=user。工具实际执行结果没有独立采集。";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function makeArchive(revision, previousArchiveId = null) {
  const rawLogs = [{ source: "conversation", role: "assistant", text: RAW + "\n\n助手当时报告参数42。" }];
  const input = buildFactInput(rawLogs, DATE), units = input.sources[0].units;
  return archive.createArchive({ rawLogs, targetDate: DATE, previousArchiveId,
    createdAt: "2026-10-30T00:00:00.000Z", generator: { model: "offline-fixture" },
    qualityFindings: ["摘要有损；未核实独立工具返回。"],
    summary: { version: lab.VERSION, target_date: DATE, binding: lab.buildPrompt(input, "direct").binding,
      items: [{ topic: "摘要" + revision, text: "派生概述" + revision, evidence: [units[0].id, units[1].id], corrects: [] }] } });
}
function episodeText(stored, body = locator.renderDerivedItemLines(stored).join("\n")) {
  return "# Episode " + DATE + "\n\ngeneratedAt: 2026-10-30T00:00:00.000Z\nderivedSummary: "
    + JSON.stringify({ archive_id: stored.archive_id, previous_archive_id: stored.payload.previous_archive_id })
    + "\n\n" + body + "\n";
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archive-maintenance-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const memoryDir = path.join(root, "memory"), episodesDir = path.join(memoryDir, "episodes");
  const directory = path.join(memoryDir, "checkpoint-archives"), backupDir = path.join(root, "backup");
  fs.mkdirSync(episodesDir, { recursive: true });
  const old = makeArchive("old"), current = makeArchive("current", old.archive_id), uncited = makeArchive("uncited");
  for (const stored of [old, current, uncited]) archive.persistArchive(directory, stored);
  const episode = path.join(episodesDir, DATE + ".md"), previous = episode + ".old.previous";
  fs.writeFileSync(episode, episodeText(current));
  fs.writeFileSync(previous, episodeText(old));
  fs.writeFileSync(path.join(episodesDir, "2026-10-19.md"), "legacy unlinked episode");
  const source = fs.readdirSync(directory).map(name => ({ name, bytes: fs.readFileSync(path.join(directory, name)) }));
  return { root, memoryDir, episodesDir, directory, backupDir, old, current, uncited, episode, previous, source };
}
function unchanged(f) {
  for (const file of f.source) assert.deepEqual(fs.readFileSync(path.join(f.directory, file.name)), file.bytes);
}
function manifest(f, result) {
  const bytes = fs.readFileSync(path.join(f.backupDir, "manifests", result.backup.snapshot_id + ".json"));
  const data = JSON.parse(bytes.toString("utf8"));
  assert.equal(hash(JSON.stringify(data.payload)), data.snapshot_id);
  assert.equal(data.snapshot_id, result.backup.snapshot_id);
  return data.payload;
}
function assertNoManifest(f) {
  const dir = path.join(f.backupDir, "manifests");
  assert.ok(!fs.existsSync(dir) || fs.readdirSync(dir).length === 0);
}

test("empty maintenance and an unconfigured backup create no filesystem entries", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archive-empty-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const memoryDir = path.join(root, "absent");
  const result = run({ memoryDir });
  assert.equal(result.status, "verified");
  assert.equal(result.archive_count, 0);
  assert.equal(result.backup.status, "not_configured");
  assert.equal(fs.existsSync(memoryDir), false);
});
test("audit and dry-run preserve every revision and uncited original without creating a backup", t => {
  const f = fixture(t), result = run({ ...f, dryRun: true });
  assert.equal(result.archive_count, 3);
  assert.equal(result.history_links, 1);
  assert.equal(result.episode_files_scanned, 3);
  assert.equal(result.derived_episode_files, 2);
  assert.equal(result.marked_items, 2);
  assert.equal(result.backup.status, "planned");
  assert.equal(result.semantic_correctness, "NOT_CERTIFIED");
  assert.equal(fs.existsSync(f.backupDir), false);
  unchanged(f);
});
test("append-only backup is byte exact, reusable and restores evidence after the active source is removed", t => {
  const f = fixture(t), first = run(f), payload = manifest(f, first);
  assert.equal(first.backup.status, "complete");
  assert.equal(first.backup.objects_created, 5);
  assert.equal(payload.archives.length, 3);
  assert.equal(payload.episodes.length, 2);
  assert.ok(payload.archives.some(entry => entry.archive_id === f.uncited.archive_id));
  for (const file of f.source) {
    const destination = path.join(f.backupDir, "checkpoint-archives", file.name);
    assert.deepEqual(fs.readFileSync(destination), file.bytes);
    assert.equal(fs.statSync(destination).mode & 0o777, 0o600);
  }
  const again = run(f);
  assert.equal(again.backup.snapshot_id, first.backup.snapshot_id);
  assert.equal(again.backup.objects_created, 0);
  assert.equal(again.backup.objects_reused, 5);
  unchanged(f);
  fs.rmSync(f.memoryDir, { recursive: true });
  const record = archive.readOriginalRecord(path.join(f.backupDir, "checkpoint-archives"), f.uncited.archive_id, "s0");
  assert.equal(record.record.text, RAW + "\n\n助手当时报告参数42。");
  for (const entry of payload.episodes) {
    const bytes = fs.readFileSync(path.join(f.backupDir, "episode-objects", entry.sha256 + ".md"));
    assert.equal(hash(bytes), entry.sha256);
    const read = locator.resolveDerivedSnippet({ path: "memory/episodes/" + DATE + ".md", text: bytes.toString("utf8") },
      { memoryDir: f.backupDir, purpose: "acceptance" });
    assert.equal(read.metadata.archive_id, entry.archive_id);
    assert.equal(read.metadata.semantic_correctness, "NOT_CERTIFIED");
    assert.equal(read.evidence.original_records[0].record.text, record.record.text);
  }
});
test("corrupt archive fails without echoing raw record text or publishing completion", t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, f.current.archive_id + ".json"), '{"private":"' + RAW);
  assert.throws(() => run(f), error => error.code === "checkpoint_maintenance_archive_invalid"
    && !error.message.includes(RAW));
  assert.equal(fs.existsSync(f.backupDir), false);
});
test("a missing historical revision cannot be discarded merely because the current file exists", t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.directory, f.old.archive_id + ".json"));
  assert.throws(() => run(f), { code: "checkpoint_maintenance_history_missing" });
  assert.equal(fs.existsSync(f.backupDir), false);
});
test("missing references, changed projection, wrong date, conflicting IDs and broken header history reject", async t => {
  const scenarios = [
    ["missing", "checkpoint_maintenance_reference_missing", f =>
      fs.writeFileSync(f.episode, episodeText(f.current).replaceAll(f.current.archive_id, "f".repeat(64)))],
    ["text", "checkpoint_maintenance_episode_projection", f =>
      fs.writeFileSync(f.episode, episodeText(f.current).replace("派生概述current", "伪造参数43"))],
    ["date", "checkpoint_maintenance_episode_date", f =>
      fs.renameSync(f.episode, path.join(f.episodesDir, "2026-10-21.md"))],
    ["conflict", "checkpoint_maintenance_episode_conflict", f =>
      fs.appendFileSync(f.episode, locator.renderDerivedItemLines(f.old).join("\n"))],
    ["history", "checkpoint_maintenance_episode_history", f => {
      const text = episodeText(f.current);
      fs.writeFileSync(f.episode, text.replace('"previous_archive_id":"' + f.old.archive_id + '"', '"previous_archive_id":null'));
    }],
  ];
  for (const [label, code, change] of scenarios) await t.test(label, t => {
    const f = fixture(t); change(f);
    assert.throws(() => run(f), { code });
    assert.equal(fs.existsSync(f.backupDir), false);
    unchanged(f);
  });
});
test("unknown JSON filenames and symlink evidence fail instead of being silently skipped", async t => {
  for (const type of ["unknown_name", "symlink_file", "symlink_directory"]) await t.test(type, t => {
    const f = fixture(t);
    if (type === "unknown_name") fs.writeFileSync(path.join(f.directory, "lost-original.json"), "{}");
    else if (type === "symlink_file") {
      const file = path.join(f.directory, f.current.archive_id + ".json"), copy = path.join(f.root, "copy.json");
      fs.renameSync(file, copy); fs.symlinkSync(copy, file);
    } else {
      const copy = path.join(f.root, "archive-target");
      fs.renameSync(f.directory, copy); fs.symlinkSync(copy, f.directory);
    }
    assert.throws(() => run(f), { code: type === "unknown_name" ? "checkpoint_maintenance_archive_name"
      : type === "symlink_file" ? "checkpoint_maintenance_not_regular" : "checkpoint_maintenance_directory" });
  });
});
test("backup path aliases and overlapping source directories cannot receive backup writes", t => {
  const f = fixture(t), alias = path.join(f.root, "source-alias");
  fs.symlinkSync(f.directory, alias);
  for (const backupDir of [path.parse(f.root).root, f.memoryDir, f.directory, path.join(f.directory, "backup"),
    f.episodesDir, path.join(f.episodesDir, "backup"), alias]) {
    assert.throws(() => run({ ...f, backupDir }), { code: "checkpoint_maintenance_backup_overlap" });
  }
  assert.throws(() => run({ ...f, backupDir: "relative-backup" }), { code: "checkpoint_maintenance_backup_path" });
  unchanged(f);
});
test("an existing incompatible backup is rejected, preserved, and never marked complete", t => {
  const f = fixture(t), directory = path.join(f.backupDir, "checkpoint-archives");
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, f.source[0].name);
  fs.writeFileSync(target, "{}");
  assert.throws(() => run(f), { code: "checkpoint_maintenance_backup_conflict" });
  assert.equal(fs.readFileSync(target, "utf8"), "{}");
  assertNoManifest(f); unchanged(f);
});
test("an apparent backup hard-linked to live evidence is rejected as an independent copy", t => {
  const f = fixture(t), directory = path.join(f.backupDir, "checkpoint-archives");
  fs.mkdirSync(directory, { recursive: true });
  const source = path.join(f.directory, f.source[0].name), target = path.join(directory, f.source[0].name);
  fs.linkSync(source, target);
  assert.throws(() => run(f), { code: "checkpoint_maintenance_backup_alias" });
  assertNoManifest(f); unchanged(f);
});
test("a copy failure leaves source evidence and pre-existing temporary objects intact", t => {
  const f = fixture(t), directory = path.join(f.backupDir, "checkpoint-archives");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "older.tmp"), "do not prune");
  const link = fs.linkSync;
  fs.linkSync = () => { throw Object.assign(Error("injected failure"), { code: "EACCES" }); };
  try { assert.throws(() => run(f), { code: "EACCES" }); }
  finally { fs.linkSync = link; }
  assert.deepEqual(fs.readdirSync(directory), ["older.tmp"]);
  assertNoManifest(f); unchanged(f);
});
test("corruption of an earlier copied object is caught before manifest publication", t => {
  const f = fixture(t), link = fs.linkSync;
  let firstTarget;
  fs.linkSync = function (source, target) {
    const result = link.call(fs, source, target);
    if (target.startsWith(path.join(f.backupDir, "checkpoint-archives") + path.sep)) {
      if (!firstTarget) firstTarget = target;
      else fs.writeFileSync(firstTarget, "{}");
    }
    return result;
  };
  try { assert.throws(() => run(f), { code: "checkpoint_maintenance_backup_conflict" }); }
  finally { fs.linkSync = link; }
  assertNoManifest(f); unchanged(f);
});
test("concurrent archive publication prevents a completed inventory until the next maintenance run", t => {
  const f = fixture(t), extra = makeArchive("concurrent"), link = fs.linkSync;
  let injected = false;
  fs.linkSync = function (source, target) {
    const result = link.call(fs, source, target);
    if (!injected && target.startsWith(f.backupDir + path.sep)) {
      injected = true;
      archive.persistArchive(f.directory, extra);
    }
    return result;
  };
  try { assert.throws(() => run(f), { code: "checkpoint_maintenance_changed" }); }
  finally { fs.linkSync = link; }
  assertNoManifest(f); unchanged(f);
  const next = run(f);
  assert.equal(next.backup.archive_count, 4);
  assert.equal(next.backup.status, "complete");
});
test("active checkpoint locks defer capture; archive temp files are kept and header-only old projections are explicit", t => {
  const f = fixture(t), lock = f.episode + ".checkpoint.lock";
  fs.writeFileSync(lock, "busy");
  assert.throws(() => run(f), { code: "checkpoint_maintenance_busy" });
  fs.unlinkSync(lock);
  const temp = path.join(f.directory, "inflight.tmp");
  fs.writeFileSync(temp, "untouched temporary bytes");
  fs.writeFileSync(f.episode, episodeText(f.current, f.current.payload.body));
  const result = run(f), payload = manifest(f, result);
  assert.equal(payload.episodes.find(entry => entry.name === DATE + ".md").reference_scope, "header_only");
  assert.equal(fs.readFileSync(temp, "utf8"), "untouched temporary bytes");
});

function databases(f) {
  const corePath = path.join(f.root, "core.sqlite"), enginePath = path.join(f.root, "engine.sqlite");
  const core = new Database(corePath);
  core.exec("CREATE TABLE chunks (id TEXT PRIMARY KEY,text TEXT,path TEXT)");
  core.prepare("INSERT INTO chunks VALUES (?,?,?)").run("derived-low", fs.readFileSync(f.episode, "utf8"), "memory/episodes/" + DATE + ".md");
  core.close();
  const engine = new Database(enginePath);
  engine.exec("CREATE TABLE memory_confidence (chunk_id TEXT PRIMARY KEY,confidence REAL,last_confidence_update INTEGER,hit_count INTEGER,base_tau REAL,is_protected INTEGER,is_archived INTEGER,conflict_flag INTEGER,category TEXT,kg_data TEXT); CREATE TABLE memory_events (id INTEGER PRIMARY KEY,event_type TEXT,memory_id TEXT,source TEXT,metadata_json TEXT)");
  engine.prepare("INSERT INTO memory_confidence VALUES (?,0.01,1,0,1,0,0,0,'episodic',NULL)").run("derived-low");
  engine.close();
  return { corePath, enginePath };
}
function nightly(f, dbs, args = []) {
  return spawnSync(process.execPath, ["--require", path.join(__dirname, "checkpoint-dependency-loader.cjs"),
    path.join(__dirname, "../bin/nightly-maintenance-command.cjs"), ...args], {
    env: { ...process.env, MEMORY_ENGINE_WORKSPACE_DIR: f.root, MEMORY_ENGINE_MEMORY_DIR: f.memoryDir,
      MEMORY_ENGINE_DB_PATH: dbs.enginePath, MEMORY_ENGINE_CORE_DB: dbs.corePath,
      MEMORY_ENGINE_KG_PATH: path.join(f.root, "missing-kg.json"),
      MEMORY_ENGINE_CHECKPOINT_ARCHIVE_BACKUP_DIR: f.backupDir, MEMORY_ENGINE_ARCHIVE_THRESHOLD: "0.15" },
    encoding: "utf8", timeout: 10000,
  });
}
test("Nightly dry-run is read-only; lifecycle archiving retains readable originals and reports completed backup", t => {
  const f = fixture(t), dbs = databases(f);
  const originalCore = fs.readFileSync(dbs.corePath), originalEngine = fs.readFileSync(dbs.enginePath);
  const dry = nightly(f, dbs, ["--dry-run"]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(JSON.parse(dry.stdout).result.checkpoint_archives.backup.status, "planned");
  assert.deepEqual(fs.readFileSync(dbs.enginePath), originalEngine);
  assert.equal(fs.existsSync(f.backupDir), false);
  const applied = nightly(f, dbs);
  assert.equal(applied.status, 0, applied.stderr);
  const result = JSON.parse(applied.stdout).result;
  assert.equal(result.checkpoint_archives.backup.status, "complete");
  assert.equal(result.archive.archived, 1);
  const engine = new Database(dbs.enginePath, { readonly: true });
  try {
    assert.equal(engine.prepare("SELECT is_archived FROM memory_confidence").get().is_archived, 1);
    const completed = engine.prepare("SELECT metadata_json FROM memory_events WHERE event_type='nightly_maintenance_completed'").get();
    assert.equal(JSON.parse(completed.metadata_json).checkpoint_archives.archive_count, 3);
  } finally { engine.close(); }
  assert.deepEqual(fs.readFileSync(dbs.corePath), originalCore);
  unchanged(f);
  assert.equal(archive.readOriginalRecord(f.directory, f.old.archive_id, "s0").record.text, RAW + "\n\n助手当时报告参数42。");
});
test("Nightly follows the same startup memory-directory override as checkpoint generation", t => {
  const f = fixture(t), dbs = databases(f), custom = path.join(f.root, "custom-checkpoint-memory");
  fs.renameSync(f.memoryDir, custom);
  const result = nightly({ ...f, memoryDir: custom }, dbs, ["--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).result.checkpoint_archives.archive_count, 3);
  assert.equal(fs.existsSync(f.memoryDir), false);
});
test("Nightly evidence or backup failure exits before lifecycle writes and emits no success event", async t => {
  for (const type of ["archive", "backup"]) await t.test(type, t => {
    const f = fixture(t), dbs = databases(f), before = fs.readFileSync(dbs.enginePath);
    if (type === "archive") fs.writeFileSync(path.join(f.directory, f.current.archive_id + ".json"), "{}");
    else {
      const directory = path.join(f.backupDir, "checkpoint-archives");
      fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, f.source[0].name), "{}");
    }
    const result = nightly(f, dbs);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /checkpoint_maintenance_(archive_invalid|backup_conflict)/);
    assert.deepEqual(fs.readFileSync(dbs.enginePath), before);
    assertNoManifest(f);
  });
});
test("captured GPT archive can be backed up and traced without active sources or a model request", {
  skip: process.env.MEMORY_ENGINE_TEST_CHECKPOINT_ARCHIVE ? false : "set MEMORY_ENGINE_TEST_CHECKPOINT_ARCHIVE for captured archive",
}, t => {
  const file = process.env.MEMORY_ENGINE_TEST_CHECKPOINT_ARCHIVE, bytes = fs.readFileSync(file);
  const stored = JSON.parse(bytes.toString("utf8")), f = fixture(t);
  // Replace only synthetic fixture data, never the captured source.
  fs.rmSync(f.memoryDir, { recursive: true });
  fs.mkdirSync(f.episodesDir, { recursive: true });
  const directory = path.join(f.memoryDir, "checkpoint-archives");
  const all = new Map([[stored.archive_id, stored]]);
  let previous = stored.payload.previous_archive_id;
  while (previous !== null) {
    const prior = archive.loadArchive(path.dirname(file), previous);
    all.set(previous, prior); previous = prior.payload.previous_archive_id;
  }
  for (const value of [...all.values()].reverse()) archive.persistArchive(directory, value);
  fs.writeFileSync(f.episode, episodeText(stored));
  const result = run(f), payload = manifest(f, result);
  fs.rmSync(f.memoryDir, { recursive: true });
  const entry = payload.episodes[0], text = fs.readFileSync(path.join(f.backupDir, "episode-objects", entry.sha256 + ".md"), "utf8");
  const read = locator.resolveDerivedSnippet({ path: "memory/episodes/" + DATE + ".md", text },
    { memoryDir: f.backupDir, purpose: "acceptance" });
  const units = new Set(), items = read.evidence.items;
  let occurrences = 0;
  for (const item of items) {
    occurrences += item.item.evidence.length + item.item.corrects.length;
    for (const source of item.sources) {
      units.add(source.locator.unit_id);
      const original = read.evidence.original_records.find(r => r.source_id === source.locator.source_id).record;
      assert.equal(original.text.slice(source.locator.start, source.locator.end), source.quote);
    }
  }
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.deepEqual(fs.readFileSync(path.join(f.backupDir, "checkpoint-archives", stored.archive_id + ".json")),
    Buffer.from(JSON.stringify(stored) + "\n"));
  t.diagnostic(JSON.stringify({ captured_items: items.length, citation_occurrences: occurrences,
    unique_units: units.size, model_calls: 0, production_writes: 0 }));
});
