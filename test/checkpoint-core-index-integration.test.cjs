"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { pathToFileURL } = require("node:url"), { createHash } = require("node:crypto");
const coreRoot = process.env.MEMORY_ENGINE_TEST_OPENCLAW_ROOT;
const DATE = "2026-10-20", EPISODE = "memory/episodes/" + DATE + ".md";
const digest = value => createHash("sha256").update(value).digest("hex");

// Deliberately version-scoped: the constructor/providerResult injection is an
// installed Core implementation API, not a plugin production dependency.
test("published derived memory survives the real Core index/search/Get/backup chain", {
  skip: coreRoot ? false : "set MEMORY_ENGINE_TEST_OPENCLAW_ROOT for isolated real Core indexing",
  timeout: 60000,
}, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "checkpoint-core-chain-"));
  const names = ["OPENCLAW_HOME", "OPENCLAW_STATE_DIR", "OPENCLAW_CONFIG_PATH", "OPENCLAW_LOG_LEVEL"];
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  process.env.OPENCLAW_HOME = path.join(root, "home");
  process.env.OPENCLAW_STATE_DIR = path.join(root, "state");
  process.env.OPENCLAW_CONFIG_PATH = path.join(root, "openclaw.json");
  process.env.OPENCLAW_LOG_LEVEL = "silent";
  fs.writeFileSync(process.env.OPENCLAW_CONFIG_PATH, "{}\n");
  t.after(() => {
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  let networkAttempts = 0;
  const denyNetwork = () => { networkAttempts++; throw Error("network forbidden in Core integration test"); };
  t.mock.method(globalThis, "fetch", denyNetwork);
  t.mock.method(require("node:http"), "request", denyNetwork);
  t.mock.method(require("node:https"), "request", denyNetwork);
  t.mock.method(require("node:net").Socket.prototype, "connect", denyNetwork);

  const pkg = JSON.parse(fs.readFileSync(path.join(coreRoot, "package.json"), "utf8"));
  assert.equal(pkg.version, "2026.7.1-2", "review Core API and isolation before testing a different build");
  const load = file => import(pathToFileURL(path.join(coreRoot, "dist", file)).href);
  const logging = await load("logging-B385Vb17.js");
  logging.setLoggerOverride({ level: "silent", file: path.join(root, "core.log") });
  const [{ t: MemoryIndexManager }, { resolveMemorySearchConfig }] = await Promise.all([
    load("manager-DB4_iNu4.js"), load("plugin-sdk/memory-core-host-engine-foundation.js"),
  ]);
  const { withRuntime } = require("../lib/checkpoint/runtime");
  const { nightlyCheckpoint } = require("../bin/session-checkpoint");
  const archive = require("../lib/checkpoint/summary-memory-archive.cjs");
  const projections = require("../lib/checkpoint/episode-projection.cjs");
  const locator = require("../lib/checkpoint/derived-summary-locator.cjs");
  const { buildFactInput } = require("../lib/checkpoint/ordinary-summary-facts");
  const lab = require("../lib/checkpoint/summary-comparison-lab.cjs");
  const { runCheckpointArchiveMaintenance } = require("../lib/checkpoint/archive-maintenance.cjs");
  const [{ createMemoryEngineSearchExecute, createMemoryEngineGetExecute }, dbAccess, { ensureMemoryConfidenceTable }] =
    await Promise.all([import("../lib/tools/memory-engine-actions.js"), import("../lib/db/isolated-dbs.js"),
      import("../lib/db/schema.js")]);
  const { createIsolatedHybridDbAccessScope } = await import("../lib/recall/hybrid/db-access.js");
  const { composeCanonicalMemoryObject } = await import("../lib/canonical/memory-object.js");
  const { buildOwnerDisclosurePreview } = await import("../lib/recall/disclosure/owner-attestable-projection.js");
  const Database = require("better-sqlite3");
  const totals = { offline_summary_calls: 0, offline_embedding_batches: 0, offline_query_embeddings: 0,
    initial_indexed_chunks: 0, initial_marker_free_reads: 0, restored_version_items: 0, initial_sensitive_reads: 0 };

  function createManager(scenario, workspaceDir, coreDbPath) {
    assert.ok(path.resolve(workspaceDir).startsWith(root + path.sep));
    const provider = { id: "offline-checkpoint-fixture", model: "offline-deterministic-v1", maxInputTokens: scenario.cap,
      embedBatch: async texts => { totals.offline_embedding_batches++; return texts.map(() => [1, 0, 0]); },
      embedQuery: async () => { totals.offline_query_embeddings++; return [1, 0, 0]; } };
    const agentId = "checkpoint-offline-test";
    const cfg = { agents: { defaults: { workspace: workspaceDir, memorySearch: {
      provider: provider.id, model: provider.model, fallback: "none", sources: ["memory"],
      chunking: scenario.chunking, store: { vector: { enabled: false } }, cache: { enabled: false },
      sync: { watch: false, onSearch: false, onSessionStart: false, intervalMinutes: 0 },
      query: { minScore: 0, maxResults: 100, hybrid: { enabled: true } },
    } }, list: [{ id: agentId, agentDir: path.join(root, scenario.name + "-agent") }] } };
    const settings = resolveMemorySearchConfig(cfg, agentId);
    // Core config resolves its normal DB default itself. Override BEFORE opening
    // the real constructor, which also registers this DB in the isolated state.
    settings.store.databasePath = coreDbPath;
    assert.ok(path.resolve(coreDbPath).startsWith(root + path.sep));
    return new MemoryIndexManager({ cacheKey: scenario.name, cfg, agentId, workspaceDir, settings,
      purpose: "cli", providerRequirement: { mode: "required", provider: provider.id },
      providerResult: { provider, requestedProvider: provider.id } });
  }

  for (const scenario of [
    { name: "primary-overlap", chunking: { tokens: 64, overlap: 16 }, cap: 8192 },
    { name: "provider-parent-window", chunking: { tokens: 10000, overlap: 0 }, cap: 128 },
  ]) await t.test(scenario.name, { timeout: 25000 }, async () => {
    const workspaceDir = path.join(root, scenario.name), memoryDir = path.join(workspaceDir, "memory");
    const episodesDir = path.join(memoryDir, "episodes"), backupDir = path.join(root, scenario.name + "-backup");
    const coreDbPath = path.join(root, scenario.name + ".sqlite"), engineDbPath = path.join(root, scenario.name + "-engine.sqlite");
    const dbOptions = { coreDbPath, engineDbPath };
    const rawLogs = [
      { source: "conversation", role: "user", text: "参数42；source=before_prompt_build；trigger=user。" },
      { source: "conversation", role: "assistant", text: "助手报告验收通过；没有独立工具调用或返回事件。\n\n旧判断撤回，需要重新核实。" },
    ];
    const publish = async revision => {
      const input = buildFactInput(rawLogs, DATE);
      const summary = { version: lab.VERSION, target_date: DATE, binding: lab.buildPrompt(input, "direct").binding,
        items: [
          { topic: "参数", text: Array.from({ length: 26 }, (_, i) =>
            "checkpointparamalpha" + i + " 参数" + (revision ? "43" : "42") + " 中文🦊 abcdefghijklmnopqrstuvwxyz.").join(" "),
            evidence: [input.sources[0].units[0].id], corrects: [] },
          { topic: "验收", text: "checkpointacceptbeta：仅记录助手的验收转述，旧判断撤回，需独立证据。",
            evidence: [input.sources[1].units[0].id], corrects: [input.sources[1].units[1].id] },
        ] };
      return withRuntime({ workspaceDir, memoryDir, episodesDir, configJsonPath: process.env.OPENCLAW_CONFIG_PATH,
        checkpointSummaryMode: "derived", derivedSummaryGenerator: async () => {
          totals.offline_summary_calls++;
          return { summary, generator: { model: "offline-core-integration-fixture" },
            qualityFindings: ["有损摘要；不认证语义或实际工具执行。"] };
        } }, () => nightlyCheckpoint(rawLogs, { targetDate: DATE, inputReady: true }));
    };
    const first = await publish(false);
    assert.equal(first.status, "valid_summary", first.reason);
    assert.equal(first.publication.published, true);
    const oldFile = path.join(memoryDir, "checkpoint-archives", first.archive_id + ".json");
    const oldBytes = fs.readFileSync(oldFile);
    let manager = createManager(scenario, workspaceDir, coreDbPath);
    const provider = manager.provider;
    try {
      await manager.sync({ reason: "checkpoint-offline-integration", force: true });
      assert.equal(manager.settings.store.databasePath, coreDbPath);
      assert.equal(manager.provider, provider);
      assert.equal(manager.watcher, null);
      assert.equal(manager.intervalTimer, null);
      assert.equal(manager.fts.available, true, manager.fts.loadError);
      const rows = manager.db.prepare("SELECT * FROM memory_index_chunks ORDER BY start_line, id").all();
      assert.ok(rows.length > 4);
      assert.ok(rows.every(row => row.path === EPISODE && row.hash === digest(row.text)));
      totals.initial_indexed_chunks += rows.length;
      if (scenario.cap === 128) assert.ok(rows.every(row => Buffer.byteLength(row.text, "utf8") <= 128));
      // Real schema/FTS from Core; only Engine lifecycle fixture is initialized here.
      const engine = new Database(engineDbPath);
      try { ensureMemoryConfidenceTable(engine); } finally { engine.close(); }
      const withCoreDb = fn => dbAccess.withCoreDbReadonly(fn, dbOptions);
      const withEngineDb = fn => dbAccess.withEngineDbIsolated(fn, { ...dbOptions, readonly: true });
      withCoreDb(db => {
        assert.equal(db.readonly, true);
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chunks").get().n, rows.length);
        assert.throws(() => db.prepare("DELETE FROM memory_index_chunks").run(), /readonly/);
      });
      const successes = [];
      const get = directory => createMemoryEngineGetExecute({ get: { memoryDir: directory,
        withCoreDb, withEngineDb, onMemoryEngineGetSuccess: id => successes.push(id) } });
      const activeGet = get(memoryDir);
      const readItems = new Map();
      for (const row of rows) {
        const candidate = { path: row.path, text: row.text, hash: row.hash,
          start_line: row.start_line, end_line: row.end_line };
        let linked;
        try { linked = locator.resolveDerivedSnippet(candidate, { memoryDir }); }
        catch (error) {
          assert.equal(error.code, "derived_projection_ambiguous");
          continue; // No invented origin when a tiny literal is shared by scopes.
        }
        if (linked?.metadata.status !== "verified") continue;
        const recalled = await activeGet("real-core-recall", { id: row.id });
        assert.equal(recalled.found, true, recalled.reason);
        assert.equal(recalled.memory.derived_memory.archive_id, first.archive_id);
        assert.equal(recalled.memory.derived_memory.semantic_correctness, "NOT_CERTIFIED");
        if (!locator.inspectDerivedSnippet(candidate).archive_id) totals.initial_marker_free_reads++;
        for (const index of linked.metadata.item_indexes) {
          readItems.set(index, row);
          const read = await activeGet("real-core-sensitive", { id: row.id, purpose: "acceptance", item_index: index });
          assert.equal(read.found, true, read.reason);
          const evidence = read.memory.derived_evidence;
          for (const original of evidence.original_records)
            assert.deepEqual(original.record, rawLogs[original.record_index]);
          for (const item of evidence.items) for (const source of item.sources) {
            const { record_index, start, end } = source.locator;
            assert.equal(rawLogs[record_index].text.slice(start, end), source.quote);
          }
          totals.initial_sensitive_reads++;
        }
      }
      assert.deepEqual([...readItems.keys()].sort(), [0, 1]);
      const rawCoreHits = await manager.search("checkpointacceptbeta", { maxResults: 100, minScore: 0 });
      assert.ok(rawCoreHits.length > 0, "real Core FTS/vector fallback must return indexed data");
      const search = createMemoryEngineSearchExecute({
        withHybridDbAccessScope: createIsolatedHybridDbAccessScope(dbOptions),
        getMemorySearchManager: async () => ({ manager }), getLancedbTable: () => null,
        syncIndexIfNeeded: async () => ({}), generateEmbedding: provider.embedQuery,
        recordMemoryEvent: () => {}, calcRealtimeConf: () => 0.8, CATEGORY_MAP: {},
      });
      const hits = await search("real-search", { query: "checkpointacceptbeta", top_k: 8 });
      assert.ok(hits.results?.length > 0, JSON.stringify(hits));
      assert.ok(hits.results.every(hit => rows.some(row => row.id === hit.id)));
      assert.ok(hits.results.some(hit => hit.text.includes("checkpointacceptbeta")));
      for (const hit of hits.results) {
        const read = await activeGet("search-then-get", { id: hit.id });
        assert.equal(read.found, true, read.reason);
      }

      // Reindex a new published revision; old content-addressed evidence survives.
      rawLogs[0].text = "更正：参数43；source=before_prompt_build；trigger=user。";
      const second = await publish(true);
      assert.equal(second.status, "valid_summary", second.reason);
      assert.equal(second.previous_archive_id, first.archive_id);
      assert.deepEqual(fs.readFileSync(oldFile), oldBytes);
      assert.equal(fs.readFileSync(second.publication.backup, "utf8").includes(first.archive_id), true);
      await manager.sync({ reason: "checkpoint-revision", force: true });
      const updatedRows = manager.db.prepare("SELECT * FROM memory_index_chunks ORDER BY id").all();
      const secondRow = updatedRows.find(row => {
        if (!row.text.includes("43")) return false;
        try {
          const linked = locator.resolveDerivedSnippet({ path: row.path, text: row.text, hash: row.hash,
            start_line: row.start_line, end_line: row.end_line }, { memoryDir });
          return linked?.metadata.archive_id === second.archive_id && linked.metadata.item_indexes.includes(0);
        } catch (error) {
          if (error.code === "derived_projection_ambiguous") return false;
          throw error;
        }
      });
      assert.ok(secondRow, "updated Core index must include the new publication: " +
        JSON.stringify(updatedRows.map(row => ({ path: row.path, text: row.text.slice(0, 180) }))));
      const latest = await activeGet("latest-core", { id: secondRow.id, purpose: "exact_parameters" });
      assert.equal(latest.found, true, latest.reason);
      assert.equal(latest.memory.derived_memory.archive_id, second.archive_id);
      assert.deepEqual(latest.memory.derived_evidence.original_records[0].record, rawLogs[0]);
      const maintenance = runCheckpointArchiveMaintenance({ memoryDir, backupDir });
      assert.equal(maintenance.archive_count, 2);
      assert.equal(maintenance.backup.status, "complete");
      await manager.close(); manager = null;
      const coreBytes = fs.readFileSync(coreDbPath);
      const engineBytes = fs.readFileSync(engineDbPath);
      fs.rmSync(memoryDir, { recursive: true });
      const restoredGet = get(backupDir);
      const restored = await restoredGet("backup-core-get", { id: secondRow.id, purpose: "acceptance" });
      assert.equal(restored.found, true, restored.reason);
      assert.equal(restored.memory.derived_memory.archive_id, second.archive_id);
      for (const id of [first.archive_id, second.archive_id]) {
        const read = await restoredGet("backup-direct", { id: "checkpoint:" + id, purpose: "execution" });
        assert.equal(read.found, true, read.reason);
        assert.equal(read.memory.policy.semantic_correctness, "NOT_CERTIFIED");
        totals.restored_version_items += read.memory.items.length;
        const expectedRecords = id === first.archive_id ? JSON.parse(oldBytes).payload.raw_records : rawLogs;
        for (const original of read.memory.original_records)
          assert.deepEqual(original.record, expectedRecords[original.record_index]);
        const indexedUnits = new Map(archive.verifyArchive(
          archive.loadArchive(path.join(backupDir, "checkpoint-archives"), id)).units);
        for (const item of read.memory.items) for (const source of item.sources)
          assert.equal(source.quote, indexedUnits.get(source.locator.unit_id).unit.text);
      }
      assert.deepEqual(fs.readFileSync(path.join(backupDir, "checkpoint-archives", first.archive_id + ".json")), oldBytes);
      assert.equal(projections.inventory(backupDir).length, 4);
      const successCount = successes.length;
      const latestFile = path.join(backupDir, "checkpoint-archives", second.archive_id + ".json");
      fs.writeFileSync(latestFile, "{}");
      const corrupt = await restoredGet("corrupt-backup", { id: secondRow.id, purpose: "execution" });
      assert.equal(corrupt.found, false);
      assert.equal(corrupt.code, "MEMORY_GET_DERIVED_INVALID");
      assert.equal(successes.length, successCount);
      const intactOld = await restoredGet("intact-old-version", { id: "checkpoint:" + first.archive_id,
        purpose: "exact_parameters" });
      assert.equal(intactOld.found, true, intactOld.reason);
      assert.deepEqual(intactOld.memory.original_records[0].record, JSON.parse(oldBytes).payload.raw_records[0]);
      assert.deepEqual(fs.readFileSync(coreDbPath), coreBytes, "readers must not mutate the Core main file");
      assert.deepEqual(fs.readFileSync(engineDbPath), engineBytes, "no lifecycle writes in this read-only harness");
      assert.ok(archive.verifyArchive(JSON.parse(oldBytes)));
      assert.equal(fs.existsSync(memoryDir), false, "backup reads cannot recreate active evidence");
    } finally { if (manager) await manager.close(); }
  });

  // Private captured output is opt-in and never checked into the repository.
  const capturedPath = process.env.MEMORY_ENGINE_TEST_CHECKPOINT_ARCHIVE;
  for (const mode of [
    { name: "captured-primary-overlap", chunking: { tokens: 64, overlap: 16 }, cap: 8192 },
    { name: "captured-provider-window", chunking: { tokens: 10000, overlap: 0 }, cap: 128 },
  ]) await t.test(mode.name, {
    skip: capturedPath ? false : "set MEMORY_ENGINE_TEST_CHECKPOINT_ARCHIVE for captured GPT replay",
    timeout: 25000,
  }, async st => {
    const sourceBytes = fs.readFileSync(capturedPath), captured = JSON.parse(sourceBytes);
    const { units } = archive.verifyArchive(captured);
    st.after(() => assert.deepEqual(fs.readFileSync(capturedPath), sourceBytes,
      "the original private archive must remain byte-identical"));
    assert.equal(captured.archive_id, "660bc9d48e7ce66bb4e41f00c81656512d294b075ed8b3a8c7a42baf7863f591",
      "this regression pins the documented captured GPT sample");
    assert.equal(captured.payload.input.target_date, DATE);
    assert.equal(captured.payload.segmented_input, null, "review replay reconstruction for segmented inputs");
    const rawLogs = structuredClone(captured.payload.raw_records), summary = structuredClone(captured.payload.summary);
    assert.equal(summary.items.length, 14);
    assert.equal(summary.items.reduce((n, item) => n + item.evidence.length + item.corrects.length, 0), 99);
    assert.deepEqual(buildFactInput(rawLogs, DATE), captured.payload.input);
    const workspaceDir = path.join(root, mode.name), memoryDir = path.join(workspaceDir, "memory");
    const coreDbPath = path.join(root, mode.name + ".sqlite"), engineDbPath = path.join(root, mode.name + "-engine.sqlite");
    const dbOptions = { coreDbPath, engineDbPath }, backupDir = path.join(root, mode.name + "-backup");
    let replayCalls = 0;
    const publication = await withRuntime({ workspaceDir, memoryDir, episodesDir: path.join(memoryDir, "episodes"),
      configJsonPath: process.env.OPENCLAW_CONFIG_PATH, checkpointSummaryMode: "derived",
      derivedSummaryGenerator: async () => {
        replayCalls++;
        return { summary, generator: { model: "captured-gpt-output-replay", transport: "offline-replay",
          replay_of_archive_id: captured.archive_id, replay_of_archive_sha256: digest(sourceBytes),
          original_generator: captured.payload.generator },
          qualityFindings: [...captured.payload.quality_findings] };
      } }, () => nightlyCheckpoint(rawLogs, { targetDate: DATE, inputReady: true }));
    assert.equal(publication.status, "valid_summary", publication.reason);
    assert.equal(publication.publication.published, true);
    assert.equal(publication.publication.projection_registered, true);
    assert.equal(replayCalls, 1);
    const replay = archive.loadArchive(path.join(memoryDir, "checkpoint-archives"), publication.archive_id);
    assert.deepEqual(replay.payload.summary, captured.payload.summary, "do not rewrite captured model output");
    assert.deepEqual(replay.payload.raw_records, captured.payload.raw_records);
    assert.equal(replay.payload.generator.replay_of_archive_id, captured.archive_id);
    assert.equal(replay.payload.policy.semantic_correctness, "NOT_CERTIFIED");
    assert.ok(captured.payload.quality_findings.every(finding => replay.payload.quality_findings.includes(finding)));
    const published = projections.readProjection(memoryDir, DATE, publication.projection_id);
    assert.equal(published.doc.payload.text, fs.readFileSync(publication.publication.path, "utf8"));
    // For the single-parent provider case, independently derive item scopes
    // from literal offsets in the published bytes, without using the matcher.
    let offset = 0;
    const itemByLine = new Map(published.itemLines.map(item => [item.line, item.item_index]));
    const spans = published.lines.map((line, i) => {
      const span = { start: offset, end: offset + line.length, index: itemByLine.get(i + 1) };
      offset += line.length + 1; return span;
    }).filter(span => span.index !== undefined);
    const literalScopes = text => {
      const scopes = new Map();
      for (let pos = published.doc.payload.text.indexOf(text); pos !== -1;
        pos = published.doc.payload.text.indexOf(text, pos + 1)) {
        const indexes = spans.filter(span => {
          const left = Math.max(pos, span.start), right = Math.min(pos + text.length, span.end);
          return right > left && published.doc.payload.text.slice(left, right).trim().length > 0;
        }).map(span => span.index);
        scopes.set(JSON.stringify(indexes), indexes);
      }
      return scopes;
    };
    let manager = createManager(mode, workspaceDir, coreDbPath);
    const provider = manager.provider, firstBatches = totals.offline_embedding_batches;
    const report = { indexed_chunks: 0, verified_chunks: 0, marker_free_chunks: 0,
      ambiguous_chunks: 0, unclaimed_chunks: 0, items: 0, citation_occurrences: 0,
      unique_units: 0, search_verified_hits: 0, restored_items: 0 };
    try {
      await manager.sync({ reason: "captured-checkpoint-offline-replay", force: true });
      assert.equal(manager.settings.store.databasePath, coreDbPath);
      assert.equal(manager.watcher, null);
      const rows = manager.db.prepare("SELECT * FROM memory_index_chunks ORDER BY start_line, id").all();
      report.indexed_chunks = rows.length;
      assert.ok(rows.length > summary.items.length);
      assert.ok(rows.every(row => row.path === EPISODE && row.hash === digest(row.text)));
      if (mode.cap === 128) assert.ok(rows.every(row => Buffer.byteLength(row.text, "utf8") <= 128
        && row.start_line === 1 && row.end_line === published.lines.length));
      const engine = new Database(engineDbPath);
      try { ensureMemoryConfidenceTable(engine); } finally { engine.close(); }
      const successes = [], withCoreDb = fn => dbAccess.withCoreDbReadonly(fn, dbOptions);
      const withEngineDb = fn => dbAccess.withEngineDbIsolated(fn, { ...dbOptions, readonly: true });
      const get = directory => createMemoryEngineGetExecute({ get: { memoryDir: directory, withCoreDb, withEngineDb,
        onMemoryEngineGetSuccess: id => successes.push(id) } });
      const activeGet = get(memoryDir), seen = new Map(), referencedUnits = new Set(), verifiedRows = [];
      const verifyEvidence = (evidence, expectedIndexes) => {
        assert.equal(evidence.policy.semantic_correctness, "NOT_CERTIFIED");
        assert.deepEqual(evidence.items.map(item => item.item_index), expectedIndexes);
        assert.ok(evidence.original_records.length > 0);
        for (const original of evidence.original_records)
          assert.deepEqual(original.record, captured.payload.raw_records[original.record_index]);
        for (const item of evidence.items) {
          assert.deepEqual(item.item, summary.items[item.item_index]);
          assert.ok(item.sources.length > 0);
          for (const source of item.sources) {
            const loc = source.locator;
            assert.equal(source.quote, units.get(loc.unit_id).unit.text);
            assert.equal(rawLogs[loc.record_index].text.slice(loc.start, loc.end), source.quote);
            const original = evidence.original_records.find(record => record.source_id === loc.source_id);
            assert.ok(original); assert.equal(original.record.text.slice(loc.start, loc.end), source.quote);
          }
        }
      };
      for (const row of rows) {
        const count = successes.length, scopes = mode.cap === 128 ? literalScopes(row.text) : null;
        if (scopes) assert.ok(scopes.size > 0, "a provider child must be a literal published substring");
        const read = await activeGet("captured-core-get", { id: row.id, purpose: "acceptance" });
        if (scopes?.size > 1) {
          assert.equal(read.found, false);
          assert.equal(read.reason, "derived_projection_ambiguous");
        }
        if (!read.found) {
          assert.equal(read.code, "MEMORY_GET_DERIVED_INVALID");
          assert.ok(["derived_projection_ambiguous", "derived_locator_unavailable"].includes(read.reason), read.reason);
          assert.equal(successes.length, count);
          if (read.reason === "derived_projection_ambiguous") report.ambiguous_chunks++;
          else {
            report.unclaimed_chunks++;
            if (scopes) assert.deepEqual([...scopes.values()], [[]]);
          }
          continue;
        }
        assert.equal(read.memory.derived_memory.status, "verified");
        assert.equal(read.memory.derived_memory.archive_id, publication.archive_id);
        const indexes = read.memory.derived_memory.item_indexes;
        if (scopes) assert.deepEqual([...scopes.values()], [indexes]);
        // Omitted item_index deliberately reads the complete archive for context;
        // the verified chunk's metadata scope is checked independently above.
        verifyEvidence(read.memory.derived_evidence, summary.items.map((_, i) => i));
        report.verified_chunks++; verifiedRows.push(row);
        if (!locator.inspectDerivedSnippet({ path: row.path, text: row.text }).archive_id) {
          const card = buildOwnerDisclosurePreview(composeCanonicalMemoryObject(row)).artifact.payload;
          assert.ok(card.source_hint.includes("get=memory_engine_get:" + row.id));
          assert.match(card.source_hint, /episode_unlinked semantic=NOT_CERTIFIED locator=unavailable/);
          assert.ok(card.source_hint.length <= 512);
          assert.ok(!card.source_hint.includes("archive="), "AutoRecall must not infer an archive without IO");
          report.marker_free_chunks++;
        }
        for (const index of indexes) seen.set(index, row);
      }
      assert.deepEqual([...seen.keys()].sort((a, b) => a - b), summary.items.map((_, i) => i));
      assert.ok(report.marker_free_chunks > 0);
      for (const [index, row] of seen) {
        const read = await activeGet("captured-scoped-item", {
          id: row.id, purpose: "acceptance", item_index: index });
        assert.equal(read.found, true, read.reason);
        verifyEvidence(read.memory.derived_evidence, [index]);
        const item = read.memory.derived_evidence.items[0];
        report.citation_occurrences += item.item.evidence.length + item.item.corrects.length;
        for (const source of item.sources) referencedUnits.add(source.locator.unit_id);
      }
      report.items = seen.size; report.unique_units = referencedUnits.size;
      assert.equal(report.citation_occurrences, 99); assert.equal(report.unique_units, 93);

      const terms = [...new Set(summary.items.flatMap(item =>
        item.text.match(/[A-Za-z][A-Za-z_0-9]{7,}/g) || []))];
      const query = terms.find(term => verifiedRows.some(row => row.text.includes(term)));
      assert.ok(query, "the captured summary must supply an intact indexed search term");
      const coreHits = await manager.search(query, { maxResults: 100, minScore: 0 });
      assert.ok(coreHits.length > 0);
      const search = createMemoryEngineSearchExecute({
        withHybridDbAccessScope: createIsolatedHybridDbAccessScope(dbOptions),
        getMemorySearchManager: async () => ({ manager }), getLancedbTable: () => null,
        syncIndexIfNeeded: async () => ({}), generateEmbedding: provider.embedQuery,
        recordMemoryEvent: () => {}, calcRealtimeConf: () => 0.8, CATEGORY_MAP: {},
      });
      const hits = await search("captured-search", { query, top_k: 8 });
      assert.ok(hits.results?.length > 0);
      for (const hit of hits.results) {
        assert.ok(rows.some(row => row.id === hit.id));
        assert.equal(hit.text.length <= 240, true);
        const read = await activeGet("captured-search-get", { id: hit.id, purpose: "execution" });
        if (!read.found) {
          assert.ok(["derived_projection_ambiguous", "derived_locator_unavailable"].includes(read.reason), read.reason);
          continue;
        }
        verifyEvidence(read.memory.derived_evidence, summary.items.map((_, i) => i));
        report.search_verified_hits++;
      }
      assert.ok(report.search_verified_hits > 0, "search must lead to at least one verified original read");

      const backup = runCheckpointArchiveMaintenance({ memoryDir, backupDir });
      assert.equal(backup.backup.status, "complete"); assert.equal(backup.archive_count, 1);
      await manager.close(); manager = null;
      const coreBytes = fs.readFileSync(coreDbPath), engineBytes = fs.readFileSync(engineDbPath);
      fs.rmSync(memoryDir, { recursive: true });
      const restoredGet = get(backupDir);
      for (const [index, row] of seen) {
        const read = await restoredGet("captured-backup-get", { id: row.id, purpose: "exact_parameters", item_index: index });
        assert.equal(read.found, true, read.reason);
        verifyEvidence(read.memory.derived_evidence, [index]); report.restored_items++;
      }
      const direct = await restoredGet("captured-backup-all", {
        id: "checkpoint:" + publication.archive_id, purpose: "disputed_claims" });
      assert.equal(direct.found, true, direct.reason);
      verifyEvidence(direct.memory, summary.items.map((_, i) => i));
      assert.equal(direct.memory.source_catalog.length, 4);
      for (const source of direct.memory.source_catalog) {
        const original = await restoredGet("captured-backup-source", {
          id: "checkpoint:" + publication.archive_id, source_id: source.source_id });
        assert.equal(original.found, true, original.reason);
        assert.deepEqual(original.memory.record, rawLogs[original.memory.record_index]);
      }
      assert.equal(report.restored_items, 14);
      assert.deepEqual(fs.readFileSync(coreDbPath), coreBytes);
      assert.deepEqual(fs.readFileSync(engineDbPath), engineBytes);
      assert.deepEqual(archive.loadArchive(path.join(backupDir, "checkpoint-archives"),
        publication.archive_id).payload.summary, captured.payload.summary);
      assert.equal(fs.existsSync(memoryDir), false);
      st.diagnostic(JSON.stringify({ ...report, replay_calls: replayCalls,
        offline_embedding_batches: totals.offline_embedding_batches - firstBatches,
        source_archive_id: captured.archive_id, source_archive_file_sha256: digest(sourceBytes),
        real_model_calls: 0, real_embedding_provider_calls: 0, production_writes: 0 }));
    } finally { if (manager) await manager.close(); }
  });
  assert.equal(networkAttempts, 0);
  assert.ok(totals.offline_embedding_batches > 0);
  assert.ok(totals.offline_query_embeddings > 0);
  assert.ok(totals.initial_marker_free_reads > 0);
  t.diagnostic(JSON.stringify({ ...totals, network_attempts: networkAttempts,
    real_model_calls: 0, real_embedding_provider_calls: 0, production_writes: 0 }));
});
