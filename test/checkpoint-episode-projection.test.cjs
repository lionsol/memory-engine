"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { createHash } = require("node:crypto"), { pathToFileURL } = require("node:url");
const archive = require("../lib/checkpoint/summary-memory-archive.cjs");
const locator = require("../lib/checkpoint/derived-summary-locator.cjs");
const projections = require("../lib/checkpoint/episode-projection.cjs");
const lab = require("../lib/checkpoint/summary-comparison-lab.cjs");
const { buildFactInput } = require("../lib/checkpoint/ordinary-summary-facts");
const { renderEpisodeFile } = require("../lib/checkpoint/episode-writer");
const { withRuntime } = require("../lib/checkpoint/runtime");
const { runCheckpointArchiveMaintenance } = require("../lib/checkpoint/archive-maintenance.cjs");
const DATE = "2026-10-20", EPISODE = "memory/episodes/" + DATE + ".md";
const hash = value => createHash("sha256").update(value).digest("hex");
function fixture(t, { persist = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "episode-projection-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rawLogs = [{ source: "conversation", role: "assistant",
    text: "参数42；source=before_prompt_build；trigger=user。\n\n助手报告验收通过，但没有独立工具返回事件。" }];
  const input = buildFactInput(rawLogs, DATE), units = input.sources[0].units;
  const summary = { version: lab.VERSION, target_date: DATE, binding: lab.buildPrompt(input, "direct").binding,
    items: [{ topic: "参数", text: "参数42; abcdefghijklmnopqrstuvwxyz。🦊 ".repeat(65),
      evidence: [units[0].id], corrects: [] },
      { topic: "验收", text: "验收仍需独立工具证据。", evidence: [units[1].id], corrects: [] }] };
  const stored = archive.createArchive({ rawLogs, targetDate: DATE, summary,
    createdAt: "2026-10-31T00:00:00.000Z", generator: { model: "offline-fixture" },
    qualityFindings: ["有损摘要；工具执行未独立验证。"] });
  archive.persistArchive(path.join(root, "checkpoint-archives"), stored);
  const text = document(stored), doc = projections.createProjection(stored, text);
  if (persist) projections.persistProjection(root, doc);
  const verified = projections.verifyProjection(doc, stored);
  const line = verified.itemLines[0].line;
  const fragment = Array.from(verified.lines[line - 1].slice(125)).slice(10, 120).join("");
  const candidate = { path: EPISODE, text: fragment, hash: hash(fragment), start_line: line, end_line: line };
  return { root, rawLogs, summary, stored, text, doc, candidate };
}
function document(stored) {
  return renderEpisodeFile({ episodeDate: DATE, generatedAt: stored.payload.created_at,
    configs: [], episodeText: "模型派生摘要，未认证事实正确性。\n\n" + locator.renderDerivedItemLines(stored).join("\n"),
    diagnostics: { derivedSummary: { archive_id: stored.archive_id,
      previous_archive_id: stored.payload.previous_archive_id } } });
}
test("projection snapshots are immutable, byte exact and preserve all publication diagnostics", t => {
  const f = fixture(t), file = path.join(f.root, projections.ROOT, DATE, f.doc.projection_id + ".json");
  const bytes = fs.readFileSync(file);
  assert.equal(projections.persistProjection(f.root, f.doc), f.doc.projection_id);
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.equal(projections.readProjection(f.root, DATE, f.doc.projection_id).doc.payload.text, f.text);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  fs.writeFileSync(file, "{}");
  assert.throws(() => projections.persistProjection(f.root, f.doc), { code: "derived_projection_integrity" });
  assert.equal(fs.readFileSync(file, "utf8"), "{}");
});
test("creation rejects changed item text, omitted items, duplicate markers and forged archive headers", t => {
  const f = fixture(t);
  for (const text of [f.text.replace("参数42;", "参数43;"),
    f.text.replace(locator.renderDerivedItemLines(f.stored)[1], ""),
    f.text + locator.renderDerivedItemLines(f.stored)[1],
    f.text.replace(f.stored.archive_id, "f".repeat(64))]) {
    assert.throws(() => projections.createProjection(f.stored, text));
  }
});
test("range matching allows only inserted segment separators and retains real line boundaries and whitespace", () => {
  const lines = ["ab cd", "ef", "", "🦊 xyz"];
  assert.equal(projections.matchesRange(lines, 1, 2, "b \ncd\ne"), true);
  assert.equal(projections.matchesRange(lines, 1, 2, "b cde"), false);
  assert.equal(projections.matchesRange(lines, 1, 2, "b\ncd\ne"), false);
  assert.equal(projections.matchesRange(lines, 2, 4, "ef\n\n🦊 \nxy"), true);
  assert.equal(projections.matchesRange(lines, 2, 4, "ef\n🦊 xy"), false);
  assert.equal(projections.matchesRange(lines, 4, 4, "🦊\n xyz"), true);
  assert.equal(projections.matchesRange(lines, 0, 4, "xyz"), false);
});
test("a fully marker-free canonical chunk resolves complete originals without reading the live episode", t => {
  const f = fixture(t);
  assert.equal(locator.inspectDerivedSnippet(f.candidate).status, "locator_unavailable");
  const read = locator.resolveDerivedSnippet(f.candidate, { memoryDir: f.root, purpose: "exact_parameters", itemIndex: 0 });
  assert.equal(read.metadata.status, "verified");
  assert.equal(read.metadata.scope, "archived_projection_line_range");
  assert.equal(read.metadata.archive_id, f.stored.archive_id);
  assert.equal(read.metadata.semantic_correctness, "NOT_CERTIFIED");
  assert.deepEqual(read.evidence.original_records[0].record, f.rawLogs[0]);
  assert.throws(() => locator.resolveDerivedSnippet(f.candidate, { memoryDir: f.root, itemIndex: 1 }),
    { code: "derived_locator_item" });
});
test("prepared but unpublished snapshots never participate in source lookup", t => {
  const f = fixture(t, { persist: false });
  const prepared = projections.createProjection(f.stored, f.text, "prepared");
  projections.persistProjection(f.root, prepared);
  assert.equal(projections.inventory(f.root).length, 1);
  assert.throws(() => locator.resolveDerivedSnippet(f.candidate, { memoryDir: f.root, purpose: "execution" }),
    { code: "derived_locator_unavailable" });
});
test("wrong hash, wrong line range, changed non-newline characters and missing projection cannot claim traceability", t => {
  const f = fixture(t);
  for (const candidate of [{ ...f.candidate, hash: "a".repeat(64) },
    { ...f.candidate, start_line: 1, end_line: 1 },
    { ...f.candidate, text: f.candidate.text + "伪造", hash: hash(f.candidate.text + "伪造") }]) {
    assert.throws(() => locator.resolveDerivedSnippet(candidate, { memoryDir: f.root, purpose: "execution" }),
      { code: "derived_locator_unavailable" });
  }
  fs.rmSync(path.join(f.root, projections.ROOT), { recursive: true });
  assert.throws(() => locator.resolveDerivedSnippet(f.candidate, { memoryDir: f.root, purpose: "execution" }),
    { code: "derived_locator_unavailable" });
});
test("multiple projections of the same archive are equivalent; matching different revisions remains ambiguous", t => {
  const f = fixture(t);
  const equivalent = projections.createProjection(f.stored, f.text + "\n");
  projections.persistProjection(f.root, equivalent);
  assert.equal(locator.resolveDerivedSnippet(f.candidate, { memoryDir: f.root }).metadata.projection_ids.length, 2);
  const summary = structuredClone(f.summary); summary.items[1].text += " 后续更正。";
  const second = archive.createArchive({ rawLogs: f.rawLogs, targetDate: DATE, summary,
    previousArchiveId: f.stored.archive_id, generator: { model: "offline-fixture" } });
  archive.persistArchive(path.join(f.root, "checkpoint-archives"), second);
  projections.persistProjection(f.root, projections.createProjection(second, document(second)));
  assert.throws(() => locator.resolveDerivedSnippet(f.candidate, { memoryDir: f.root, purpose: "acceptance" }),
    { code: "derived_projection_ambiguous" });
});
test("a unique old continuation remains on its original revision after a newer incorrect summary is published", t => {
  const f = fixture(t), summary = structuredClone(f.summary);
  summary.items[0].text = summary.items[0].text.replaceAll("参数42", "参数43");
  const second = archive.createArchive({ rawLogs: f.rawLogs, targetDate: DATE, summary,
    previousArchiveId: f.stored.archive_id, generator: { model: "offline-fixture" },
    qualityFindings: ["故意错误的派生摘要也必须保留原文与质量备注。"] });
  archive.persistArchive(path.join(f.root, "checkpoint-archives"), second);
  projections.persistProjection(f.root, projections.createProjection(second, document(second)));
  const read = locator.resolveDerivedSnippet(f.candidate, { memoryDir: f.root, purpose: "acceptance" });
  assert.equal(read.metadata.archive_id, f.stored.archive_id);
  assert.equal(read.evidence.items[0].item.text, f.summary.items[0].text);
  assert.equal(read.metadata.semantic_correctness, "NOT_CERTIFIED");
});
test("a valid initial marker cannot certify tampered continuation text for a registered projection", t => {
  const f = fixture(t), info = projections.verifyProjection(f.doc, f.stored), line = info.itemLines[0].line;
  const text = info.lines[line - 1].slice(0, 150) + "\\nFORGED_CONTINUATION";
  assert.throws(() => locator.resolveDerivedSnippet({ path: EPISODE, text, hash: hash(text),
    start_line: line, end_line: line }, { memoryDir: f.root, purpose: "execution" }),
  { code: "derived_projection_mismatch" });
});
test("corrupted projection and directory aliases fail closed; search extraction remains free of archive IO", t => {
  const f = fixture(t), file = path.join(f.root, projections.ROOT, DATE, f.doc.projection_id + ".json");
  const inventory = projections.inventory;
  projections.inventory = () => { throw Error("search must not read"); };
  try { assert.equal(locator.inspectDerivedSnippet(f.candidate).status, "locator_unavailable"); }
  finally { projections.inventory = inventory; }
  fs.writeFileSync(file, "{}");
  assert.throws(() => locator.resolveDerivedSnippet(f.candidate, { memoryDir: f.root, purpose: "execution" }));
  const moved = path.join(f.root, "elsewhere");
  fs.renameSync(path.join(f.root, projections.ROOT), moved); fs.symlinkSync(moved, path.join(f.root, projections.ROOT));
  assert.throws(() => projections.inventory(f.root), { code: "derived_projection_directory" });
});
test("real checkpoint publication saves the exact projection first and keeps publication bytes unchanged", async t => {
  const f = fixture(t, { persist: false }), episodesDir = path.join(f.root, "episodes");
  const { nightlyCheckpoint } = require("../bin/session-checkpoint");
  const result = await withRuntime({ workspaceDir: f.root, memoryDir: f.root, episodesDir,
    checkpointSummaryMode: "derived", derivedSummaryGenerator: async () =>
      ({ summary: f.summary, generator: { model: "offline-fixture" } }) },
  () => nightlyCheckpoint(f.rawLogs, { targetDate: DATE, inputReady: true }));
  assert.equal(result.status, "valid_summary", result.reason);
  const saved = projections.readProjection(f.root, DATE, result.projection_id);
  assert.equal(saved.doc.payload.archive_id, result.archive_id);
  assert.equal(saved.doc.payload.text, fs.readFileSync(path.join(episodesDir, DATE + ".md"), "utf8"));
});
test("projection write failure rejects publication while preserving old episode and the collected raw archive", async t => {
  const f = fixture(t, { persist: false }), episodesDir = path.join(f.root, "episodes");
  fs.mkdirSync(episodesDir); const file = path.join(episodesDir, DATE + ".md");
  fs.writeFileSync(file, "old legacy episode");
  const { nightlyCheckpoint } = require("../bin/session-checkpoint"), link = fs.linkSync;
  fs.linkSync = function (source, target) {
    if (target.includes(path.sep + projections.ROOT + path.sep)) throw Object.assign(Error("injected"), { code: "EIO" });
    return link.call(fs, source, target);
  };
  try {
    const result = await withRuntime({ workspaceDir: f.root, memoryDir: f.root, episodesDir,
      checkpointSummaryMode: "derived", derivedSummaryGenerator: async () =>
        ({ summary: f.summary, generator: { model: "offline-fixture" } }) },
    () => nightlyCheckpoint(f.rawLogs, { targetDate: DATE, inputReady: true }));
    assert.equal(result.status, "summary_invalid"); assert.equal(result.reason, "EIO");
    assert.ok(archive.loadArchive(path.join(f.root, "checkpoint-archives"), result.archive_id));
  } finally { fs.linkSync = link; }
  assert.equal(fs.readFileSync(file, "utf8"), "old legacy episode");
});
test("registration failure after commit retains the published fact and leaves only a non-resolvable prepared snapshot", async t => {
  const f = fixture(t, { persist: false }), episodesDir = path.join(f.root, "episodes");
  const { nightlyCheckpoint } = require("../bin/session-checkpoint"), link = fs.linkSync;
  fs.linkSync = function (source, target) {
    if (target.includes(path.sep + projections.ROOT + path.sep)
      && JSON.parse(fs.readFileSync(source, "utf8")).payload.publication_status === "published") {
      throw Object.assign(Error("injected registration failure"), { code: "EIO" });
    }
    return link.call(fs, source, target);
  };
  let result;
  try {
    result = await withRuntime({ workspaceDir: f.root, memoryDir: f.root, episodesDir,
      checkpointSummaryMode: "derived", derivedSummaryGenerator: async () =>
        ({ summary: f.summary, generator: { model: "offline-fixture" } }) },
    () => nightlyCheckpoint(f.rawLogs, { targetDate: DATE, inputReady: true }));
  } finally { fs.linkSync = link; }
  assert.equal(result.status, "summary_invalid"); assert.equal(result.reason, "EIO");
  assert.equal(result.publication.published, true); assert.equal(result.episode, true);
  assert.equal(result.publication.projection_registered, false);
  assert.ok(fs.readFileSync(path.join(episodesDir, DATE + ".md"), "utf8").includes(result.archive_id));
  const files = projections.inventory(f.root);
  assert.equal(files.length, 1); assert.equal(files[0].doc.payload.publication_status, "prepared");
  const line = files[0].itemLines[0].line;
  const text = Array.from(files[0].lines[line - 1]).slice(140, 200).join("");
  assert.throws(() => locator.resolveDerivedSnippet({ path: EPISODE, text, hash: hash(text), start_line: line, end_line: line },
    { memoryDir: f.root, purpose: "execution" }), { code: "derived_locator_unavailable" });
});
test("memory_engine_get forwards Canonical hash and lines; invalid projection never triggers success reinforcement", async t => {
  const f = fixture(t), { createMemoryEngineGetExecute } = await import("../lib/tools/memory-engine-actions.js");
  const row = { ...f.candidate, id: "marker-free-core", source: "memory", updated_at: 1789260000000 }, seen = [];
  const execute = createMemoryEngineGetExecute({ get: { memoryDir: f.root,
    onMemoryEngineGetSuccess: id => seen.push(id),
    withCoreDb: fn => fn({ prepare: sql => ({ all: () => sql.includes("PRAGMA")
      ? Object.keys(row).map(name => ({ name })) : [row] }) }),
    withEngineDb: fn => fn({ prepare: () => ({ all: () => [] }) }) } });
  const read = await execute("get", { id: row.id, purpose: "exact_parameters", item_index: 0 });
  assert.equal(read.found, true, read.reason);
  assert.deepEqual(read.memory.derived_evidence.original_records[0].record, f.rawLogs[0]);
  fs.writeFileSync(path.join(f.root, projections.ROOT, DATE, f.doc.projection_id + ".json"), "{}");
  const bad = await execute("get", { id: row.id, purpose: "execution" });
  assert.equal(bad.found, false); assert.equal(bad.code, "MEMORY_GET_DERIVED_INVALID");
  assert.deepEqual(seen, [row.id]);
});
test("Nightly backs up immutable projections and restores marker-free reads after live evidence is removed", t => {
  const f = fixture(t), backupDir = path.join(f.root, "backup"), memoryDir = f.root;
  const result = runCheckpointArchiveMaintenance({ memoryDir, backupDir });
  assert.equal(result.projection_count, 1);
  assert.equal(result.backup.projection_count, 1);
  const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, "manifests", result.backup.snapshot_id + ".json"), "utf8"));
  assert.equal(manifest.payload.version, "checkpoint-archive-backup-v2");
  assert.equal(manifest.payload.projections[0].projection_id, f.doc.projection_id);
  fs.rmSync(path.join(f.root, "checkpoint-archives"), { recursive: true });
  fs.rmSync(path.join(f.root, projections.ROOT), { recursive: true });
  const restored = locator.resolveDerivedSnippet(f.candidate, { memoryDir: backupDir, purpose: "acceptance" });
  assert.deepEqual(restored.evidence.original_records[0].record, f.rawLogs[0]);
});
test("Nightly rejects corrupted or conflicting projection backups and never publishes a completion manifest", t => {
  const f = fixture(t), backupDir = path.join(f.root, "backup");
  const target = path.join(backupDir, projections.ROOT, DATE, f.doc.projection_id + ".json");
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, "{}");
  assert.throws(() => runCheckpointArchiveMaintenance({ memoryDir: f.root, backupDir }),
    { code: "checkpoint_maintenance_backup_conflict" });
  assert.equal(fs.existsSync(path.join(backupDir, "manifests")), false);
  fs.writeFileSync(path.join(f.root, projections.ROOT, DATE, f.doc.projection_id + ".json"), "{}");
  assert.throws(() => runCheckpointArchiveMaintenance({ memoryDir: f.root }));
});
const coreRoot = process.env.MEMORY_ENGINE_TEST_OPENCLAW_ROOT;
test("installed Core chunkMarkdown resolves all item-bearing chunks across token, overlap and Unicode boundaries", {
  skip: coreRoot ? false : "set MEMORY_ENGINE_TEST_OPENCLAW_ROOT to test the real installed Core chunker",
  timeout: 30000,
}, async t => {
  const f = fixture(t), sdk = path.join(coreRoot, "dist/plugin-sdk/memory-core-host-engine-storage.js");
  const { chunkMarkdown } = await import(pathToFileURL(sdk).href);
  const version = JSON.parse(fs.readFileSync(path.join(coreRoot, "package.json"), "utf8")).version;
  const itemLines = projections.verifyProjection(f.doc, f.stored).itemLines.map(item => item.line);
  let checked = 0, markerFree = 0, insertedNewlines = 0;
  for (const options of [{tokens:8,overlap:0},{tokens:16,overlap:8},{tokens:32,overlap:16},
    {tokens:128,overlap:32},{tokens:400,overlap:80}]) {
    for (const chunk of chunkMarkdown(f.text, options)) {
      if (!itemLines.some(line => line >= chunk.startLine && line <= chunk.endLine)) continue;
      const candidate = { path: EPISODE, text: chunk.text, hash: chunk.hash,
        start_line: chunk.startLine, end_line: chunk.endLine };
      const read = locator.resolveDerivedSnippet(candidate, { memoryDir: f.root, purpose: "exact_parameters" });
      assert.equal(read.metadata.scope, "archived_projection_line_range");
      assert.deepEqual(read.evidence.original_records[0].record, f.rawLogs[0]);
      checked++;
      if (locator.inspectDerivedSnippet(candidate).status === "locator_unavailable") markerFree++;
      if (chunk.startLine === chunk.endLine && chunk.text.includes("\n")) insertedNewlines++;
    }
  }
  assert.ok(markerFree > 0); assert.ok(insertedNewlines > 0);
  t.diagnostic(JSON.stringify({ core_version: version, sdk_sha256: hash(fs.readFileSync(sdk)),
    chunks_checked: checked, marker_free: markerFree, inserted_newline_chunks: insertedNewlines,
    core_database_writes: 0, provider_calls: 0 }));
});
test("captured GPT archive stays traceable through actual Core continuation chunks and immutable projection backup", {
  skip: coreRoot && process.env.MEMORY_ENGINE_TEST_CHECKPOINT_ARCHIVE ? false : "set both Core root and captured archive",
  timeout: 30000,
}, async t => {
  const file = process.env.MEMORY_ENGINE_TEST_CHECKPOINT_ARCHIVE, bytes = fs.readFileSync(file);
  const stored = JSON.parse(bytes.toString("utf8")), f = fixture(t, { persist: false });
  archive.persistArchive(path.join(f.root, "checkpoint-archives"), stored);
  const text = document(stored), doc = projections.createProjection(stored, text);
  projections.persistProjection(f.root, doc);
  const backupDir = path.join(f.root, "backup");
  runCheckpointArchiveMaintenance({ memoryDir: f.root, backupDir });
  fs.rmSync(path.join(f.root, "checkpoint-archives"), { recursive: true });
  fs.rmSync(path.join(f.root, projections.ROOT), { recursive: true });
  const { chunkMarkdown } = await import(pathToFileURL(path.join(coreRoot, "dist/plugin-sdk/memory-core-host-engine-storage.js")).href);
  const items = projections.verifyProjection(doc, stored).itemLines.map(item => item.line);
  let checked = 0, markerFree = 0, occurrences = 0;
  const seen = new Set(), units = new Set();
  for (const chunk of chunkMarkdown(text, { tokens:64, overlap:16 })) {
    if (!items.some(line => line >= chunk.startLine && line <= chunk.endLine)) continue;
    const candidate = { path: EPISODE, text: chunk.text, hash: chunk.hash,
      start_line: chunk.startLine, end_line: chunk.endLine };
    const read = locator.resolveDerivedSnippet(candidate, { memoryDir: backupDir });
    assert.equal(read.metadata.archive_id, stored.archive_id);
    for (const index of read.metadata.item_indexes) {
      if (seen.has(index)) continue;
      seen.add(index);
      const originalRead = locator.resolveDerivedSnippet(candidate, { memoryDir: backupDir, purpose: "acceptance", itemIndex: index });
      const item = originalRead.evidence.items[0];
      occurrences += item.item.evidence.length + item.item.corrects.length;
      for (const source of item.sources) {
        units.add(source.locator.unit_id);
        const original = originalRead.evidence.original_records.find(r => r.source_id === source.locator.source_id).record;
        assert.equal(original.text.slice(source.locator.start, source.locator.end), source.quote);
      }
    }
    checked++;
    if (locator.inspectDerivedSnippet(candidate).status === "locator_unavailable") markerFree++;
  }
  assert.ok(markerFree > 0);
  assert.equal(seen.size, stored.payload.summary.items.length);
  assert.deepEqual(fs.readFileSync(file), bytes);
  t.diagnostic(JSON.stringify({ captured_items: stored.payload.summary.items.length,
    chunks_checked: checked, marker_free: markerFree, citation_occurrences: occurrences,
    unique_units: units.size, model_calls: 0, production_writes: 0 }));
});
