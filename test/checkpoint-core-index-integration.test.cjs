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
  const Database = require("better-sqlite3");
  const totals = { offline_summary_calls: 0, offline_embedding_batches: 0, offline_query_embeddings: 0,
    initial_indexed_chunks: 0, initial_marker_free_reads: 0, restored_version_items: 0, initial_sensitive_reads: 0 };

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
    let manager = new MemoryIndexManager({ cacheKey: scenario.name, cfg, agentId, workspaceDir, settings,
      purpose: "cli", providerRequirement: { mode: "required", provider: provider.id },
      providerResult: { provider, requestedProvider: provider.id } });
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
  assert.equal(networkAttempts, 0);
  assert.ok(totals.offline_embedding_batches > 0);
  assert.ok(totals.offline_query_embeddings > 0);
  assert.ok(totals.initial_marker_free_reads > 0);
  t.diagnostic(JSON.stringify({ ...totals, network_attempts: networkAttempts,
    real_model_calls: 0, real_embedding_provider_calls: 0, production_writes: 0 }));
});
