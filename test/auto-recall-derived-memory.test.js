import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import projections from "../lib/checkpoint/episode-projection.cjs";
import episodeWriter from "../lib/checkpoint/episode-writer.js";
import { createMemoryEngineGetExecute } from "../lib/tools/memory-engine-actions.js";
import Database from "better-sqlite3";
import archive from "../lib/checkpoint/summary-memory-archive.cjs";
import locator from "../lib/checkpoint/derived-summary-locator.cjs";
import lab from "../lib/checkpoint/summary-comparison-lab.cjs";
import facts from "../lib/checkpoint/ordinary-summary-facts.js";
import { composeCanonicalMemoryObject } from "../lib/canonical/memory-object.js";
import { ensureMemoryEngineTables } from "../lib/db/schema.js";
import { projectCandidateToMemoryCard, projectCanonicalMemoryToMemoryCard } from "../lib/recall/auto-recall-memory-card.js";
import { buildAutoRecallCardContext, formatAutoRecallContext } from "../auto-recall.js";
import { buildOwnerDisclosurePreview } from "../lib/recall/disclosure/owner-attestable-projection.js";
import { assertDisclosureAttestation, createDisclosureAttestationAuthorityProvider, deriveDisclosureAttestationBinding } from "../lib/recall/disclosure/owner-attestation.js";
import { evaluateDirectCardProductionBoundary } from "../lib/recall/disclosure/direct-card-production-boundary.js";
import { formatDirectCardContext } from "../lib/recall/disclosure/direct-card-formatter.js";

const DATE = "2026-10-20", EPISODE = "memory/episodes/" + DATE + ".md";
const RAW_SENTINEL = "ORIGINAL_ONLY_NO_INDEPENDENT_TOOL_RESULT";
const ID = "auto-recall-derived-canonical-001", FAKE_ID = "f".repeat(64);
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-recall-derived-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rawLogs = [{ source: "conversation", role: "assistant",
    text: "参数42；source=before_prompt_build。\n\n助手报告验收通过，工具返回未独立核验。" + RAW_SENTINEL }];
  const input = facts.buildFactInput(rawLogs, DATE), units = input.sources[0].units;
  const summary = { version: lab.VERSION, target_date: DATE, binding: lab.buildPrompt(input, "direct").binding,
    items: [{ topic: "参数", text: "摘要只概述参数。", evidence: [units[0].id], corrects: [] },
      { topic: "验收", text: "工具结果待核验。", evidence: [units[1].id], corrects: [] }] };
  const stored = archive.createArchive({ rawLogs, targetDate: DATE, summary,
    generator: { model: "offline-fixture" }, qualityFindings: ["对话转述不等于工具实际执行结果"] });
  archive.persistArchive(path.join(root, "checkpoint-archives"), stored);
  const lines = locator.renderDerivedItemLines(stored);
  // Put the locator after both the generic and production card preview limits.
  const text = "bounded historical preview ".repeat(20) + "\n" + lines.join("\n");
  const core = { id: ID, path: EPISODE, source: "openclaw_core", start_line: 1,
    end_line: 3, hash: null, text, updated_at: 1756000000 };
  const engine = { chunk_id: ID, initial_confidence: 0.82, confidence: 0.82,
    last_confidence_update: 1756000000, base_tau: 90, hit_count: 1,
    is_archived: 0, is_protected: 0, conflict_flag: 0, category: "episodic" };
  const canonical = composeCanonicalMemoryObject(core, engine);
  const candidate = { id: ID.slice(0, 16), memory_id: ID, canonical_id: canonical.canonical_id,
    path: EPISODE, text, category: "episodic", kind: "episode", confidence: 0.82,
    rank: 1, final_score: 0.42, sources: ["fts"] };
  return { root, rawLogs, stored, lines, text, core, engine, canonical, candidate };
}
function assertHint(hint, id, items = "0,1") {
  assert.ok(hint.length <= 512);
  assert.ok(hint.includes("archive=checkpoint:" + id));
  assert.ok(hint.includes("items=" + items));
  assert.match(hint, /lossy=true semantic=NOT_CERTIFIED locator=unverified/);
  assert.match(hint, /source_required_for=parameters,acceptance,execution,disputed_claims/);
  assert.doesNotMatch(hint, /locator=verified/);
}
function dbFixture(t, f) {
  const coreDb = new Database(":memory:"), engineDb = new Database(":memory:");
  t.after(() => { coreDb.close(); engineDb.close(); });
  coreDb.exec("CREATE TABLE chunks (id TEXT PRIMARY KEY,path TEXT NOT NULL,source TEXT NOT NULL,start_line INTEGER,end_line INTEGER,hash TEXT,text TEXT NOT NULL,updated_at INTEGER)");
  coreDb.prepare("INSERT INTO chunks VALUES (?,?,?,?,?,?,?,?)").run(...["id","path","source","start_line","end_line","hash","text","updated_at"].map(k => f.core[k]));
  ensureMemoryEngineTables(engineDb);
  engineDb.prepare("INSERT INTO memory_confidence (chunk_id,initial_confidence,confidence,last_confidence_update,base_tau,hit_count,is_archived,is_protected,conflict_flag,category) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(...["chunk_id","initial_confidence","confidence","last_confidence_update","base_tau","hit_count","is_archived","is_protected","conflict_flag","category"].map(k => f.engine[k]));
  const readonly = db => ({ readonly: true, prepare: sql => db.prepare(sql) });
  return { coreDb, engineDb, withHybridDbAccessScope: async fn => fn({
    withCoreDb: cb => cb(readonly(coreDb)), withEngineDb: cb => cb(readonly(engineDb)),
  }) };
}

test("card and raw fallback retain complete unverified locators beyond bounded preview without reading archives", t => {
  const f = fixture(t), load = archive.loadArchive;
  archive.loadArchive = () => { throw Error("AutoRecall must not load archives"); };
  try {
    const { memory_card: card } = projectCandidateToMemoryCard(f.candidate);
    assertHint(card.source_hint, f.stored.archive_id);
    assert.ok(card.summary.length <= 240);
    assert.ok(!card.summary.includes(f.stored.archive_id));
    assert.equal(card.get_token, "memory_engine_get:" + ID);
    const ordinary = { ...f.candidate, id: "ordinary", memory_id: "ordinary",
      path: "memory/projects/example.md", text: "ordinary project", category: "project", kind: "project_state" };
    const context = buildAutoRecallCardContext([f.candidate, ordinary], { agentScope: "edi" });
    assert.deepEqual(context.cards.map(c => c.memory_id), [ID, "ordinary"]);
    assertHint(context.cards[0].source_hint, f.stored.archive_id);
    for (const text of [context.context, formatAutoRecallContext([f.candidate])]) {
      assert.ok(text.includes("archive=checkpoint:" + f.stored.archive_id));
      assert.ok(!text.includes(RAW_SENTINEL));
    }
    assert.ok(Object.values(context.side_effects).every(value => value === false));
  } finally { archive.loadArchive = load; }
});

test("Canonical locator authority rejects forged runtime previews and ignores supplied derived metadata", t => {
  const f = fixture(t);
  const forged = { ...f.candidate, text: f.lines[0].replaceAll(f.stored.archive_id, FAKE_ID),
    derived_memory: { status: "verified", archive_id: FAKE_ID, get_id: "outside:/secret" } };
  const actual = projectCanonicalMemoryToMemoryCard(f.canonical, forged);
  assertHint(actual.memory_card.source_hint, f.stored.archive_id);
  assert.ok(!actual.memory_card.source_hint.includes(FAKE_ID));
  assert.equal(actual.memory_object.content_ref.derived_memory.status, "unverified");
  for (const source of [{ ...f.core, text: "legacy unmarked episode" },
    { ...f.core, path: "memory/projects/plain.md" }]) {
    const canonical = composeCanonicalMemoryObject(source, f.engine);
    const card = projectCanonicalMemoryToMemoryCard(canonical, forged);
    if (source.path === EPISODE) {
      assert.equal(card.memory_object.content_ref.derived_memory.status, "locator_unavailable");
      assert.match(card.memory_card.source_hint, /episode_unlinked semantic=NOT_CERTIFIED locator=unavailable/);
      assert.ok(card.memory_card.source_hint.includes("get=memory_engine_get:" + ID));
      assert.ok(!card.memory_card.source_hint.includes(FAKE_ID));
    } else assert.equal(card.memory_object.content_ref.derived_memory, undefined);
    assert.ok(!card.memory_card.source_hint.includes("checkpoint:"));
  }
});

test("source hints remain bounded, preserve the full archive ID, and never choose among conflicting locators", t => {
  const f = fixture(t), info = locator.inspectDerivedSnippet(f.candidate);
  const many = locator.formatDerivedSourceHint("long path ".repeat(100),
    { ...info, get_id: "outside:/secret", item_indexes: Array.from({ length: 256 }, (_, i) => 255 - i) });
  assertHint(many, f.stored.archive_id, "0,1,2,3,4,5,6,7;more=248");
  assert.equal(many.length, 512);
  assert.ok(!many.includes("outside:"));
  for (const changed of [{ archive_id: "../x" }, { item_indexes: [-1] }, { item_indexes: [256] },
    { item_indexes: [0.5] }, { item_indexes: [] }, { status: "verified" }]) {
    assert.equal(locator.formatDerivedSourceHint("base", { ...info, ...changed }), "base");
  }
  const conflict = { ...f.candidate, text: f.lines[0] + "\n" + f.lines[1].replaceAll(f.stored.archive_id, FAKE_ID) };
  const card = projectCandidateToMemoryCard(conflict).memory_card;
  assert.match(card.source_hint, /locator=conflict/);
  assert.doesNotMatch(card.source_hint, /archive=checkpoint:/);
  assert.throws(() => locator.resolveDerivedSnippet(conflict, { memoryDir: f.root, purpose: "execution" }),
    { code: "derived_locator_conflict" });
});

test("unmarked and split-away episode cards retain Get routes without guessing an archive; other paths stay unchanged", t => {
  const f = fixture(t);
  for (const candidate of [{ ...f.candidate, text: "legacy episode" },
    { ...f.candidate, text: f.lines[0].slice(150) },
    { ...f.candidate, path: "memory/projects/plain.md" }]) {
    const card = projectCandidateToMemoryCard(candidate).memory_card;
    if (candidate.path === EPISODE) {
      assert.ok(card.source_hint.startsWith(candidate.path + ":0-0"));
      assert.match(card.source_hint, /episode_unlinked semantic=NOT_CERTIFIED locator=unavailable/);
      assert.ok(card.source_hint.includes("get=memory_engine_get:" + ID));
      assert.ok(formatAutoRecallContext([candidate]).includes("get=memory_engine_get:" + ID));
    } else assert.equal(card.source_hint, candidate.path + ":0-0");
    assert.ok(!formatAutoRecallContext([candidate]).includes("archive=checkpoint:"));
  }
});

test("Owner attestation hashes the locator inside the existing payload and rejects source-hint-only tampering", t => {
  const f = fixture(t), db = dbFixture(t, f), preview = buildOwnerDisclosurePreview(f.canonical);
  assertHint(preview.artifact.payload.source_hint, f.stored.archive_id);
  assert.ok(preview.artifact.payload.summary.length <= 240);
  for (const key of ["derived_memory", "get_token", "full_content", "source_text"]) {
    assert.equal(preview.artifact.payload[key], undefined);
  }
  assertDisclosureAttestation(db.engineDb, preview.binding, { now: 100 });
  const provider = createDisclosureAttestationAuthorityProvider({ withEngineDbReadonly: fn => fn(db.engineDb) });
  assert.equal(provider.getSafeToDiscloseEvidence({ canonicalMemory: f.canonical,
    projectionArtifact: preview.artifact }).safe_to_disclose, true);
  // Source bytes and all other card fields are unchanged: the locator itself is hashed.
  const tampered = structuredClone(preview.artifact);
  tampered.payload.source_hint = tampered.payload.source_hint.replace(f.stored.archive_id, FAKE_ID);
  const binding = deriveDisclosureAttestationBinding(f.canonical, tampered);
  assert.equal(binding.valid, true);
  assert.notEqual(binding.binding.projection_hash, preview.projection_hash);
  assert.equal(provider.getSafeToDiscloseEvidence({ canonicalMemory: f.canonical,
    projectionArtifact: tampered }).safe_to_disclose, false);
});

test("production AutoRecall requires unchanged Owner authority, then explicit source read resolves exact original records", async t => {
  const f = fixture(t), db = dbFixture(t, f);
  const candidate = { ...f.candidate, text: f.lines[0].replaceAll(f.stored.archive_id, FAKE_ID) };
  const evaluate = event => evaluateDirectCardProductionBoundary({
    event, candidates: [candidate], runtimeAgentScope: "edi",
    withHybridDbAccessScope: db.withHybridDbAccessScope });
  const missing = await evaluate({ senderIsOwner: true });
  assert.equal(missing.selected.length, 0);
  assert.equal(formatDirectCardContext(missing.selected), "");
  assertDisclosureAttestation(db.engineDb, buildOwnerDisclosurePreview(f.canonical).binding, { now: 100 });
  const nonOwner = await evaluate({ senderIsOwner: false });
  assert.equal(nonOwner.selected.length, 0);
  const allowed = await evaluate({ senderIsOwner: true });
  assert.equal(allowed.capabilityResults[0].capability, "CARD_DISCLOSABLE");
  assert.equal(allowed.selected.length, 1);
  assertHint(allowed.selected[0].card.source_hint, f.stored.archive_id);
  const context = formatDirectCardContext(allowed.selected);
  assert.ok(context.includes("archive=checkpoint:" + f.stored.archive_id));
  assert.ok(!context.includes(FAKE_ID));
  assert.ok(!context.includes(RAW_SENTINEL));
  const read = locator.resolveDerivedSnippet(f.candidate, { memoryDir: f.root,
    purpose: "exact_parameters", itemIndex: 0 });
  assert.equal(read.metadata.status, "verified");
  assert.equal(read.metadata.semantic_correctness, "NOT_CERTIFIED");
  assert.equal(read.evidence.original_records[0].record.text, f.rawLogs[0].text);
});


test("unlinked episode hints bound exact Get IDs and reject malformed or reserved IDs without claiming an archive", () => {
  const info = locator.inspectDerivedSnippet({ path: EPISODE, text: "unmarked continuation" });
  const fullId = "a".repeat(256);
  const hint = locator.formatDerivedSourceHint("long source ".repeat(100), info, fullId);
  assert.equal(hint.length, 512);
  assert.ok(hint.includes("get=memory_engine_get:" + fullId));
  assert.match(hint, /source_required_for=parameters,acceptance,execution,disputed_claims/);
  assert.doesNotMatch(hint, /derived_summary|lossy=true|archive=|items=|locator=verified/);
  for (const id of ["", "a".repeat(257), "checkpoint:" + FAKE_ID, "../outside", "id with spaces",
    "line\nbreak", "id\u0000tail", "路径", undefined]) {
    const unavailable = locator.formatDerivedSourceHint("base", info, id);
    assert.match(unavailable, /locator=unavailable get=unavailable/);
    assert.ok(unavailable.length <= 512);
    assert.ok(!unavailable.includes("get=memory_engine_get:"));
    assert.ok(!/[\n\r\u0000]/.test(unavailable));
  }
  assert.equal(locator.formatDerivedSourceHint("base", { ...info, kind: "derived_summary" }, ID), "base");
});

test("Owner-attested marker-free card leads through exact Canonical Get to originals, while corrupt evidence still rejects", async t => {
  const f = fixture(t);
  const text = episodeWriter.renderEpisodeFile({ episodeDate: DATE, generatedAt: f.stored.payload.created_at,
    configs: [], episodeText: f.lines.join("\n"), diagnostics: { derivedSummary: {
      archive_id: f.stored.archive_id, previous_archive_id: null } } });
  const projection = projections.createProjection(f.stored, text);
  projections.persistProjection(f.root, projection);
  const line = projections.verifyProjection(projection, f.stored).itemLines[0].line;
  const fragment = f.lines[0].slice(f.lines[0].indexOf("] ") + 2);
  const core = { ...f.core, text: fragment, hash: createHash("sha256").update(fragment).digest("hex"),
    start_line: line, end_line: line };
  const canonical = composeCanonicalMemoryObject(core, f.engine);
  const db = dbFixture(t, { ...f, core });
  const forged = { ...f.candidate, id: "forged-short", memory_id: "forged-get-id",
    text: f.lines[0].replaceAll(f.stored.archive_id, FAKE_ID),
    derived_memory: { archive_id: FAKE_ID, status: "verified" }, get_token: "outside:/secret" };
  const originalLoad = archive.loadArchive, originalResolve = projections.resolveProjectionChunk;
  let preview;
  archive.loadArchive = () => { throw Error("card projection must not load archives"); };
  projections.resolveProjectionChunk = () => { throw Error("card projection must not resolve disk snapshots"); };
  try {
    const projected = projectCanonicalMemoryToMemoryCard(canonical, forged);
    const card = projected.memory_card;
    assert.ok(card.source_hint.includes("get=memory_engine_get:" + ID));
    assert.equal(card.get_token, "memory_engine_get:" + ID);
    assert.ok(!card.source_hint.includes("forged"));
    assert.ok(!card.source_hint.includes(FAKE_ID));
    assert.ok(!card.source_hint.includes("archive="));
    assert.equal(projected.memory_object.content_ref.derived_memory.status, "locator_unavailable");
    preview = buildOwnerDisclosurePreview(canonical);
    assert.equal(preview.artifact.payload.source_hint, card.source_hint);
  } finally { archive.loadArchive = originalLoad; projections.resolveProjectionChunk = originalResolve; }

  const stale = structuredClone(preview.artifact);
  stale.payload.source_hint = EPISODE + ":" + line + "-" + line;
  const oldBinding = deriveDisclosureAttestationBinding(canonical, stale);
  assert.equal(oldBinding.valid, true);
  assert.notEqual(oldBinding.binding.projection_hash, preview.projection_hash);
  assertDisclosureAttestation(db.engineDb, oldBinding.binding, { now: 100 });
  const evaluate = (event, candidates = [{ ...forged, memory_id: ID }]) =>
    evaluateDirectCardProductionBoundary({ event, candidates,
      runtimeAgentScope: "edi", withHybridDbAccessScope: db.withHybridDbAccessScope });
  assert.equal((await evaluate({ senderIsOwner: true }, [forged])).selected.length, 0,
    "a forged lookup ID must not be rebound to the Canonical row");
  assert.equal((await evaluate({ senderIsOwner: true })).selected.length, 0,
    "an old card attestation cannot authorize the changed Get hint");
  assertDisclosureAttestation(db.engineDb, preview.binding, { now: 101 });
  assert.equal((await evaluate({ senderIsOwner: false })).selected.length, 0);
  const allowed = await evaluate({ senderIsOwner: true });
  assert.equal(allowed.selected.length, 1);
  const context = formatDirectCardContext(allowed.selected);
  assert.ok(context.includes("get=memory_engine_get:" + ID));
  for (const secret of [FAKE_ID, RAW_SENTINEL, "source=before_prompt_build", "archive=checkpoint:"])
    assert.ok(!context.includes(secret));
  const access = await db.withHybridDbAccessScope(value => value), successes = [];
  const get = createMemoryEngineGetExecute({ get: { memoryDir: f.root, ...access,
    onMemoryEngineGetSuccess: id => successes.push(id) } });
  const read = await get("card-explicit-get", { id: ID, purpose: "exact_parameters", item_index: 0 });
  assert.equal(read.found, true, read.reason);
  assert.equal(read.memory.derived_memory.archive_id, f.stored.archive_id);
  assert.deepEqual(read.memory.derived_memory.item_indexes, [0]);
  assert.deepEqual(read.memory.derived_evidence.original_records[0].record, f.rawLogs[0]);
  assert.deepEqual(successes, [ID]);
  fs.writeFileSync(path.join(f.root, "checkpoint-archives", f.stored.archive_id + ".json"), "{}");
  const corrupt = await get("card-corrupt-get", { id: ID, purpose: "execution" });
  assert.equal(corrupt.found, false);
  assert.equal(corrupt.code, "MEMORY_GET_DERIVED_INVALID");
  assert.deepEqual(successes, [ID]);
});

test("legacy unmarked episode Get hint does not invent an archive or grant sensitive evidence", async t => {
  const f = fixture(t), core = { ...f.core, text: "legacy episode without immutable publication evidence" };
  const canonical = composeCanonicalMemoryObject(core, f.engine), db = dbFixture(t, { ...f, core });
  const preview = buildOwnerDisclosurePreview(canonical);
  assert.ok(preview.artifact.payload.source_hint.includes("get=memory_engine_get:" + ID));
  assert.ok(!preview.artifact.payload.source_hint.includes("archive="));
  const access = await db.withHybridDbAccessScope(value => value), successes = [];
  const get = createMemoryEngineGetExecute({ get: { memoryDir: f.root, ...access,
    onMemoryEngineGetSuccess: id => successes.push(id) } });
  const read = await get("legacy-recall", { id: ID });
  assert.equal(read.found, true, read.reason);
  assert.equal(read.memory.derived_memory.status, "locator_unavailable");
  const sensitive = await get("legacy-sensitive", { id: ID, purpose: "acceptance" });
  assert.equal(sensitive.found, false);
  assert.equal(sensitive.reason, "derived_locator_unavailable");
  assert.deepEqual(successes, [ID]);
});

test("captured GPT items retain AutoRecall locators and exact original evidence without a model call", {
  skip: process.env.MEMORY_ENGINE_TEST_CHECKPOINT_ARCHIVE ? false : "set MEMORY_ENGINE_TEST_CHECKPOINT_ARCHIVE for captured archive",
}, t => {
  const file = process.env.MEMORY_ENGINE_TEST_CHECKPOINT_ARCHIVE, bytes = fs.readFileSync(file);
  const stored = JSON.parse(bytes.toString("utf8"));
  archive.verifyArchive(stored, path.basename(file, ".json"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-recall-captured-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  archive.persistArchive(path.join(root, "checkpoint-archives"), stored);
  let occurrences = 0;
  const units = new Set(), lines = locator.renderDerivedItemLines(stored);
  for (const [index, line] of lines.entries()) {
    const candidate = { id: ID, path: "memory/episodes/" + stored.payload.input.target_date + ".md",
      text: "bounded preview ".repeat(40) + "\n" + line, category: "episodic", kind: "episode", confidence: 0.82 };
    const canonical = composeCanonicalMemoryObject({ id: ID, path: candidate.path, source: "openclaw_core",
      start_line: 1, end_line: 2, text: candidate.text, hash: null, updated_at: 1756000000 },
    { chunk_id: ID, category: "episodic", initial_confidence: 0.82, confidence: 0.82,
      last_confidence_update: 1756000000, base_tau: 90, hit_count: 1,
      is_archived: 0, is_protected: 0, conflict_flag: 0 });
    const preview = buildOwnerDisclosurePreview(canonical);
    assertHint(preview.artifact.payload.source_hint, stored.archive_id, String(index));
    assert.ok(!preview.artifact.payload.summary.includes(stored.archive_id));
    const read = locator.resolveDerivedSnippet(candidate, { memoryDir: root, purpose: "acceptance", itemIndex: index });
    assert.deepEqual(read.evidence.items[0].item, stored.payload.summary.items[index]);
    occurrences += read.evidence.items[0].item.evidence.length + read.evidence.items[0].item.corrects.length;
    for (const source of read.evidence.items[0].sources) {
      units.add(source.locator.unit_id);
      const record = read.evidence.original_records.find(r => r.source_id === source.locator.source_id).record;
      assert.equal(record.text.slice(source.locator.start, source.locator.end), source.quote);
    }
  }
  assert.deepEqual(fs.readFileSync(file), bytes);
  t.diagnostic(JSON.stringify({ captured_items: lines.length, citation_occurrences: occurrences,
    unique_units: units.size, model_calls: 0, production_writes: 0 }));
});
