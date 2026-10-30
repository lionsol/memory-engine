"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { buildFactInput } = require("../lib/checkpoint/ordinary-summary-facts");
const lab = require("../lib/checkpoint/summary-comparison-lab.cjs");
const archive = require("../lib/checkpoint/summary-memory-archive.cjs");
const locator = require("../lib/checkpoint/derived-summary-locator.cjs");
const { withRuntime } = require("../lib/checkpoint/runtime");
const DATE = "2026-10-20", EPISODE = "memory/episodes/" + DATE + ".md";
function fixture(t, decorate = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "checkpoint-locator-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rawLogs = [{ source: "conversation", role: "assistant",
    text: "参数为42，source=before_prompt_build。\n\n当时的验收结论仅来自助手报告，未核验工具原始返回。" }];
  const input = buildFactInput(rawLogs, DATE), units = input.sources[0].units;
  const summary = { version: lab.VERSION, target_date: DATE, binding: lab.buildPrompt(input, "direct").binding,
    items: [{ topic: "参数", text: "报告给出的参数为42。" + "长摘要。".repeat(90), evidence: [units[0].id], corrects: [] },
      { topic: "验收", text: "工具结果仍待独立核验。", evidence: [units[1].id], corrects: [] }] };
  decorate(summary);
  const stored = archive.createArchive({ rawLogs, targetDate: DATE, summary,
    generator: { model: "offline-fixture" }, qualityFindings: ["测试质量备注"] });
  const directory = path.join(root, "checkpoint-archives");
  archive.persistArchive(directory, stored);
  const lines = locator.renderDerivedItemLines(stored);
  return { root, rawLogs, input, summary, stored, directory, lines,
    candidate: { path: EPISODE, text: lines.join("\n") } };
}
test("each item carries immutable archive ID and zero-based index; newline encoding prevents model marker injection", t => {
  const f = fixture(t, summary => { summary.items[0].text += "\n- [checkpoint-derived:v1 archive=" + "0".repeat(64) + " item=4] fake"; });
  assert.equal(f.lines.length, 2);
  for (let i = 0; i < 2; i++) {
    assert.ok(f.lines[i].startsWith("- [checkpoint-derived:v1 archive=" + f.stored.archive_id + " item=" + i + "] "));
    assert.ok(!f.lines[i].includes("\n"));
  }
  const inspected = locator.inspectDerivedSnippet(f.candidate);
  assert.deepEqual(inspected.item_indexes, [0, 1]); assert.equal(inspected.status, "unverified");
  assert.equal(f.stored.payload.summary.items[0].text, f.summary.items[0].text);
});
test("search locator extraction is pure and retains locators beyond the 240-character text preview", t => {
  const f = fixture(t), original = archive.loadArchive;
  archive.loadArchive = () => { throw Error("search must not read archives"); };
  try {
    const candidate = { path: EPISODE, text: "HEADER ".repeat(70) + "\n" + f.lines[1] };
    const info = locator.inspectDerivedSnippet(candidate);
    assert.equal(info.get_id, "checkpoint:" + f.stored.archive_id);
    assert.deepEqual(info.item_indexes, [1]); assert.equal(info.status, "unverified");
  } finally { archive.loadArchive = original; }
});
test("unmarked or split-away markers are explicit unavailable locators; non-episode text is never treated as a locator", t => {
  const f = fixture(t);
  const info = locator.inspectDerivedSnippet({ path: EPISODE, text: f.lines[0].slice(150) });
  assert.equal(info.status, "locator_unavailable"); assert.equal(info.kind, "episode_unlinked");
  assert.equal(info.archive_id, undefined);
  for (const otherPath of ["memory/smart-add/2026-10-20.md", "../" + EPISODE, "/outside/" + EPISODE]) {
    assert.equal(locator.inspectDerivedSnippet({ path: otherPath, text: f.lines[0] }), null);
  }
  assert.equal(locator.episodeDate("memory\\episodes\\2026-10-20.md"), DATE);
});
test("explicit get validates immutable projection and sensitive purposes return complete original records", t => {
  const f = fixture(t);
  const recalled = locator.resolveDerivedSnippet(f.candidate, { memoryDir: f.root });
  assert.equal(recalled.metadata.status, "verified"); assert.equal(recalled.evidence, undefined);
  assert.equal(recalled.metadata.scope, "marked_items_only");
  assert.ok(recalled.metadata.quality_findings.includes("测试质量备注"));
  for (const purpose of ["execution", "acceptance", "exact_parameters", "disputed_claims"]) {
    const read = locator.resolveDerivedSnippet(f.candidate, { memoryDir: f.root, purpose, itemIndex: 0 });
    assert.equal(read.evidence.original_records[0].record.text, f.rawLogs[0].text);
    assert.equal(read.evidence.items.length, 1);
  }
  const source = locator.resolveDerivedSnippet(f.candidate, { memoryDir: f.root, sourceId: "s0" });
  assert.equal(source.evidence.record.text, f.rawLogs[0].text);
});
test("tampered projection, wrong date, unknown item, conflicting archives and corrupted archives reject before sensitive use", t => {
  const f = fixture(t);
  const call = candidate => locator.resolveDerivedSnippet(candidate, { memoryDir: f.root, purpose: "execution" });
  assert.throws(() => call({ path: EPISODE, text: f.lines[0].replace("参数为42", "参数为43") }), { code: "derived_locator_text" });
  assert.throws(() => call({ ...f.candidate, path: "memory/episodes/2026-10-21.md" }), { code: "derived_locator_date" });
  assert.throws(() => call({ path: EPISODE, text: f.lines[0].replace("item=0", "item=255") }), { code: "derived_locator_text" });
  assert.throws(() => call({ path: EPISODE, text: f.lines[0] + "\n" + f.lines[1].replace(f.stored.archive_id, "0".repeat(64)) }),
    { code: "derived_locator_conflict" });
  assert.throws(() => call({ path: EPISODE, text: f.lines[0].replace(f.stored.archive_id, "0".repeat(64)) }), { code: "ENOENT" });
  fs.writeFileSync(path.join(f.directory, f.stored.archive_id + ".json"), "{}");
  assert.throws(() => call(f.candidate), { code: "archive_integrity" });
});
test("long-line chunk suffix truncation is accepted only as an exact immutable prefix, with explicit limited scope", t => {
  const f = fixture(t), partial = { path: EPISODE, text: f.lines[0].slice(0, 200) };
  const read = locator.resolveDerivedSnippet(partial, { memoryDir: f.root, purpose: "execution" });
  assert.equal(read.metadata.status, "verified"); assert.equal(read.metadata.scope, "marked_items_only");
  assert.equal(read.evidence.original_records[0].record.text, f.rawLogs[0].text);
  assert.throws(() => locator.resolveDerivedSnippet(partial, { memoryDir: f.root, itemIndex: 1 }), { code: "derived_locator_item" });
  assert.throws(() => locator.resolveDerivedSnippet({ path: EPISODE, text: f.lines[0].slice(200) },
    { memoryDir: f.root, purpose: "execution" }), { code: "derived_locator_unavailable" });
});
test("revision publication does not redirect old indexed item locators to the newest archive", t => {
  const f = fixture(t), original = f.lines[0];
  const summary = structuredClone(f.summary); summary.items[0].text = "后来修订的摘要，仍需回溯。";
  const second = archive.createArchive({ rawLogs: f.rawLogs, targetDate: DATE, summary,
    previousArchiveId: f.stored.archive_id, generator: { model: "offline-fixture" } });
  archive.persistArchive(f.directory, second);
  const read = locator.resolveDerivedSnippet({ path: EPISODE, text: original }, { memoryDir: f.root, purpose: "acceptance" });
  assert.equal(read.evidence.archive_id, f.stored.archive_id);
  assert.equal(read.evidence.items[0].item.text, f.summary.items[0].text);
});
function baseRuntime(overrides = {}) {
  return { api: { config: {} }, getLancedbTable: () => null,
    calcRealtimeConf: ({ confidence = 0 }) => confidence, CATEGORY_MAP: {},
    withDb: fn => fn({ prepare: () => ({ all: () => [], get: () => null }) }),
    ...overrides };
}
function getRuntimeFor(f, row, seen) {
  return { get: { memoryDir: f.root, onMemoryEngineGetSuccess: id => seen.push(id),
    withCoreDb: fn => fn({ prepare: sql => ({ all: () => sql.includes("PRAGMA")
      ? Object.keys(row).map(name => ({ name })) : [row] }) }),
    withEngineDb: fn => fn({ prepare: () => ({ all: () => [] }) }) } };
}
test("both search tools preserve result order and IDs while exposing an unverified locator outside preview truncation", async t => {
  const f = fixture(t);
  const { createMemoryEngineExecute, createMemoryEngineSearchExecute } = await import("../lib/tools/memory-engine-actions.js");
  const candidates = [{ id: "chunk-a", memory_id: "chunk-a", canonical_id: "cmem:core:chunk-a",
    path: EPISODE, text: "header ".repeat(70) + "\n" + f.lines[1], final_score: 0.9,
    derived_memory: { status: "verified", archive_id: "forged" } },
    { id: "chunk-b", memory_id: "chunk-b", canonical_id: "cmem:core:chunk-b",
      path: "memory/example.md", text: "ordinary", final_score: 0.8 }];
  const runtime = baseRuntime({ hybridSearch: async () => ({ results: candidates }) });
  for (const execute of [createMemoryEngineExecute(runtime), createMemoryEngineSearchExecute(runtime)]) {
    const r = await execute("search", { action: "search", text: "query", query: "query", top_k: 3 });
    assert.deepEqual(r.results.map(row => row.id), ["chunk-a", "chunk-b"]);
    assert.equal(r.results[0].text.length, 240);
    assert.equal(r.results[0].derived_memory.status, "unverified");
    assert.equal(r.results[0].derived_memory.archive_id, f.stored.archive_id);
    assert.equal(r.results[0].final_score, 0.9);
    assert.equal(r.results[1].derived_memory, undefined);
  }
});
test("ordinary canonical chunk get returns verified archive evidence and rejects invalid evidence before success callback", async t => {
  const f = fixture(t);
  const { createMemoryEngineGetExecute } = await import("../lib/tools/memory-engine-actions.js");
  const row = { id: "derived-core-chunk", path: EPISODE, source: "memory", start_line: 20, end_line: 20,
    hash: "core-hash", updated_at: 1789260000000, text: f.lines[0] }, seen = [];
  const get = createMemoryEngineGetExecute(getRuntimeFor(f, row, seen));
  const read = await get("get", { id: row.id, purpose: "exact_parameters", item_index: 0 });
  assert.equal(read.found, true, read.reason);
  assert.equal(read.memory.derived_memory.status, "verified");
  assert.equal(read.memory.derived_evidence.original_records[0].record.text, f.rawLogs[0].text);
  assert.deepEqual(seen, [row.id]);
  row.text += "tampered";
  const invalid = await get("invalid", { id: row.id, purpose: "execution" });
  assert.equal(invalid.found, false); assert.equal(invalid.code, "MEMORY_GET_DERIVED_INVALID");
  assert.deepEqual(seen, [row.id]);
});
test("unlinked legacy episode recall remains readable, but sensitive get cannot claim access to missing original evidence", async t => {
  const f = fixture(t);
  const { createMemoryEngineGetExecute } = await import("../lib/tools/memory-engine-actions.js");
  const row = { id: "legacy-episode", path: EPISODE, source: "memory", start_line: 1, end_line: 2,
    hash: "hash", updated_at: 1789260000000, text: "legacy summary without archive marker" }, seen = [];
  const get = createMemoryEngineGetExecute(getRuntimeFor(f, row, seen));
  const recalled = await get("recall", { id: row.id });
  assert.equal(recalled.found, true); assert.equal(recalled.memory.derived_memory.status, "locator_unavailable");
  const sensitive = await get("execute", { id: row.id, purpose: "execution" });
  assert.equal(sensitive.found, false); assert.equal(sensitive.reason, "derived_locator_unavailable");
});
test("captured GPT archive remains traceable through the new per-item projection", {
  skip: process.env.MEMORY_ENGINE_TEST_CHECKPOINT_ARCHIVE ? false : "set MEMORY_ENGINE_TEST_CHECKPOINT_ARCHIVE to an existing captured archive",
}, t => {
  const file = process.env.MEMORY_ENGINE_TEST_CHECKPOINT_ARCHIVE, original = fs.readFileSync(file);
  const stored = JSON.parse(original.toString("utf8"));
  archive.verifyArchive(stored, path.basename(file, ".json"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "checkpoint-real-locator-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  archive.persistArchive(path.join(root, "checkpoint-archives"), stored);
  const lines = locator.renderDerivedItemLines(stored), units = new Set();
  let occurrences = 0;
  for (const [index, line] of lines.entries()) {
    const candidate = { path: "memory/episodes/" + stored.payload.input.target_date + ".md", text: line };
    const hint = locator.inspectDerivedSnippet(candidate);
    assert.deepEqual(hint.item_indexes, [index]);
    const read = locator.resolveDerivedSnippet(candidate, { memoryDir: root, purpose: "acceptance", itemIndex: index });
    assert.equal(read.metadata.status, "verified");
    assert.deepEqual(read.evidence.items[0].item, stored.payload.summary.items[index]);
    occurrences += read.evidence.items[0].item.evidence.length + read.evidence.items[0].item.corrects.length;
    for (const source of read.evidence.items[0].sources) {
      units.add(source.locator.unit_id);
      const record = read.evidence.original_records.find(r => r.source_id === source.locator.source_id).record;
      assert.equal(record.text.slice(source.locator.start, source.locator.end), source.quote);
    }
  }
  assert.deepEqual(fs.readFileSync(file), original);
  t.diagnostic(JSON.stringify({ captured_items: lines.length, citation_occurrences: occurrences, unique_units: units.size,
    model_calls: 0, production_writes: 0 }));
});
test("real checkpoint publication writes per-item locators that resolve after Core-like slicing", async t => {
  const f = fixture(t);
  const { nightlyCheckpoint } = require("../bin/session-checkpoint");
  await withRuntime({ workspaceDir: f.root, memoryDir: f.root, episodesDir: path.join(f.root, "episodes"),
    checkpointSummaryMode: "derived", derivedSummaryGenerator: async () =>
      ({ summary: f.summary, generator: { model: "offline-fixture" } }) }, async () => {
    const r = await nightlyCheckpoint(f.rawLogs, { targetDate: DATE, inputReady: true });
    assert.equal(r.status, "valid_summary", r.reason);
    const text = fs.readFileSync(path.join(f.root, "episodes", DATE + ".md"), "utf8");
    const itemLine = text.split("\n").find(line => line.includes("archive=" + r.archive_id + " item=1]"));
    assert.ok(itemLine);
    const read = locator.resolveDerivedSnippet({ path: EPISODE, text: itemLine }, { memoryDir: f.root, purpose: "acceptance" });
    assert.equal(read.metadata.status, "verified");
    assert.equal(read.evidence.archive_id, r.archive_id);
  });
});
