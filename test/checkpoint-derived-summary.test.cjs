"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { withRuntime } = require("../lib/checkpoint/runtime");
const { nightlyCheckpoint } = require("../bin/session-checkpoint");
const derived = require("../lib/checkpoint/derived-summary");
const archive = require("../lib/checkpoint/summary-memory-archive.cjs");
const llm = require("../lib/checkpoint/llm");
const { withFakeHttps, emitJson, completion } = require("./checkpoint-summary-http-fixture.cjs");
const DATE = "2026-10-20";
function reply(request, text = "报告称样本有效，但具体资格请回读。") {
  const packet = JSON.parse(request.prompt), units = packet.SOURCE.sources.flatMap(s => s.units);
  return { summary: { version: packet.version, target_date: DATE, binding: packet.binding,
    items: [{ topic: "自然样本", text, evidence: [units[0][0]], corrects: [] }] },
    generator: { model: "offline-fixture", transport: "test" },
    qualityFindings: ["未保留所有资格"] };
}
async function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "checkpoint-derived-"));
  const episodesDir = path.join(root, "episodes"), episode = path.join(episodesDir, DATE + ".md");
  fs.mkdirSync(episodesDir); fs.writeFileSync(episode, "OLD EPISODE");
  const logs = [{ source: "conversation", role: "assistant", entry_id: "original",
    text: "source=before_prompt_build；trigger=user；valid=true。\n\n助手报告部署成功，尚未独立核验。😀" }];
  let calls = 0, legacy = 0;
  const runtime = { workspaceDir: root, memoryDir: root, episodesDir,
    configJsonPath: path.join(root, "absent.json"),
    checkpointSummaryMode: "derived", now: () => Date.parse("2026-10-30T00:00:00Z"),
    llmNightlyExtract: () => { legacy++; throw Error("legacy must not run"); },
    derivedSummaryGenerator: async request => { calls++; return reply(request); } };
  const run = (extra = {}) => nightlyCheckpoint(logs, {
    targetDate: DATE, rawLogStats: { budgetCoverageComplete: true }, inputReady: true, ...extra });
  try { return await withRuntime(runtime, () => fn({ root, logs, episode, runtime, run,
    counts: () => ({ calls, legacy }), directory: derived.archiveDirectory(root) })); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test("default checkpoint entry archives before publication and accepts quality findings without semantic certification", async t => {
  const previous = process.env.MEMORY_ENGINE_CHECKPOINT_SUMMARY_MODE;
  delete process.env.MEMORY_ENGINE_CHECKPOINT_SUMMARY_MODE;
  t.after(() => {
    if (previous === undefined) delete process.env.MEMORY_ENGINE_CHECKPOINT_SUMMARY_MODE;
    else process.env.MEMORY_ENGINE_CHECKPOINT_SUMMARY_MODE = previous;
  });
  await fixture(async ({ run, directory, episode, root, counts }) => {
    const result = await withRuntime({ checkpointSummaryMode: undefined }, run);
    assert.equal(result.status, "valid_summary"); assert.equal(result.publication.published, true);
    assert.equal(result.semantic_correctness, "NOT_CERTIFIED");
    assert.equal(fs.readFileSync(result.publication.backup, "utf8"), "OLD EPISODE");
    const stored = archive.loadArchive(directory, result.archive_id);
    assert.match(stored.payload.generator.prompt_sha256, /^[a-f0-9]{64}$/);
    assert.equal(stored.payload.generator.protocol_version, stored.payload.summary.version);
    assert.match(fs.readFileSync(episode, "utf8"), /derivedSummary: .*NOT_CERTIFIED/);
    assert.ok(fs.readFileSync(episode, "utf8").includes("checkpoint:" + result.archive_id));
    assert.ok(stored.payload.quality_findings.includes("未保留所有资格"));
    assert.deepEqual(counts(), { calls: 1, legacy: 0 });
    assert.equal(fs.existsSync(path.join(root, "generated-smart-add")), false);
    assert.deepEqual(result.writes, { file_written: 0, confidence_bound: 0, pending: 0, failed: 0 });
  });
});
test("revisions link the published predecessor and preserve old archives and exact raw text", async () => {
  await fixture(async ({ run, directory, logs }) => {
    const first = await run(), original = fs.readFileSync(path.join(directory, first.archive_id + ".json"));
    logs[0].text += "\n后来更正：部署结论需重新核实。";
    const second = await run();
    assert.equal(second.previous_archive_id, first.archive_id);
    assert.notEqual(second.archive_id, first.archive_id);
    assert.deepEqual(fs.readFileSync(path.join(directory, first.archive_id + ".json")), original);
    const read = derived.readDerivedSummary(second.archive_id, { directory, purpose: "acceptance" });
    assert.equal(read.previous_archive_id, first.archive_id);
    assert.equal(read.original_records[0].record.text, logs[0].text);
    assert.ok(read.items[0].sources[0].quote.includes("before_prompt_build"));
  });
});
test("all sensitive read purposes return complete originals; recall retains locators and correction quotes", async () => {
  await fixture(async ({ run, directory, logs }) => {
    const result = await run();
    const recalled = derived.readDerivedSummary(result.archive_id, { directory });
    assert.deepEqual(recalled.original_records, []);
    assert.equal(recalled.items[0].sources[0].locator.archive_id, result.archive_id);
    for (const purpose of ["execution", "exact_parameters", "disputed_claims", "acceptance"]) {
      const read = derived.readDerivedSummary(result.archive_id, { directory, purpose, itemIndex: 0 });
      assert.equal(read.original_records[0].record.text, logs[0].text);
      assert.equal(read.generator.model, "offline-fixture");
    }
    assert.equal(derived.readDerivedSummary(result.archive_id, { directory, sourceId: "s0" }).record.text, logs[0].text);
    for (const options of [{ itemIndex: -1 }, { itemIndex: 9 }, { sourceId: "../escape" }, { purpose: "unknown" }]) {
      assert.throws(() => derived.readDerivedSummary(result.archive_id, { directory, ...options }));
    }
  });
});
test("uncited sources remain discoverable and known semantic errors are nonblocking", async () => {
  await fixture(async ({ logs, run, directory }) => {
    logs.push({ source: "conversation", text: "另外一个来源：旧报告已被撤回。" });
    const r = await withRuntime({ derivedSummaryGenerator: async request =>
      reply(request, "已知错误摘要仍作为模型草稿保存。") }, run);
    assert.equal(r.status, "valid_summary");
    const read = derived.readDerivedSummary(r.archive_id, { directory });
    assert.deepEqual(read.source_catalog.map(s => s.source_id), ["s0", "s1"]);
    assert.equal(derived.readDerivedSummary(r.archive_id, { directory, sourceId: "s1" }).record.text, logs[1].text);
    assert.equal(read.policy.semantic_correctness, "NOT_CERTIFIED");
  });
});
test("item-scoped reads return only the selected summary and preserve evidence/corrects attribution", async () => {
  await fixture(async ({ logs, run, directory }) => {
    logs[0].text = "**Assistant:** 旧判断：部署已确认。\n\n**Assistant:** 更正：部署时刻待核实。";
    const r = await withRuntime({ derivedSummaryGenerator: async request => {
      const response = reply(request), packet = JSON.parse(request.prompt);
      const units = packet.SOURCE.sources[0].units;
      response.summary.items = [
        { topic: "部署", text: "待核实", evidence: [units[1][0]], corrects: [units[0][0]] },
        { topic: "另一事项", text: "独立草稿", evidence: [units[1][0]], corrects: [] },
      ];
      return response;
    } }, run);
    assert.equal(r.status, "valid_summary", r.reason);
    const read = derived.readDerivedSummary(r.archive_id, { directory, itemIndex: 0 });
    assert.equal(read.items.length, 1); assert.ok(!read.body.includes("独立草稿"));
    assert.deepEqual(read.items[0].sources[1].referenced_as, ["corrects"]);
  });
});
test("missing input readiness, truncation, no conversation and invalid mode stop without generator or legacy fallback", async () => {
  await fixture(async ({ run, logs, episode, counts }) => {
    for (const extra of [{ inputReady: false }, { inputReady: undefined },
      { rawLogStats: { budgetCoverageComplete: false } }]) {
      const r = await run(extra); assert.equal(r.publication.published, false);
    }
    logs[0].source = "note";
    assert.equal((await run()).publication.published, false);
    const invalid = await withRuntime({ checkpointSummaryMode: "typo" }, run);
    assert.equal(invalid.reason, "derived_mode_invalid");
    assert.deepEqual(counts(), { calls: 0, legacy: 0 });
    assert.equal(fs.readFileSync(episode, "utf8"), "OLD EPISODE");
  });
});
test("source changes during generation stop before archive or episode publication", async () => {
  await fixture(async ({ logs, run, directory, episode }) => {
    const result = await withRuntime({ derivedSummaryGenerator: async request => {
      logs[0].text += " changed"; return reply(request);
    } }, run);
    assert.equal(result.reason, "source_version_changed");
    assert.equal(fs.existsSync(directory), false);
    assert.equal(fs.readFileSync(episode, "utf8"), "OLD EPISODE");
  });
});
test("collector reread detects live source mutation even when captured array is unchanged", async () => {
  await fixture(async ({ logs, run, episode }) => {
    let valid = true;
    logs.segmentedInput = { targetDate: DATE, entries: [{ ...logs[0] }], unchanged: () => valid };
    const result = await withRuntime({ derivedSummaryGenerator: async request => {
      valid = false; return reply(request);
    } }, run);
    assert.equal(result.reason, "source_version_changed");
    assert.equal(fs.readFileSync(episode, "utf8"), "OLD EPISODE");
  });
});
test("unknown references, transport failure and cancellation never fall through to legacy or replace old episode", async () => {
  await fixture(async ({ run, episode, counts }) => {
    for (const generator of [
      async request => { const r = reply(request); r.summary.items[0].evidence = ["missing"]; return r; },
      async () => { throw Error("transport_down"); },
    ]) {
      const result = await withRuntime({ derivedSummaryGenerator: generator }, run);
      assert.equal(result.publication.published, false);
    }
    const controller = new AbortController(); controller.abort();
    assert.equal((await run({ signal: controller.signal })).reason, "derived_cancelled");
    assert.equal(counts().legacy, 0);
    assert.equal(fs.readFileSync(episode, "utf8"), "OLD EPISODE");
  });
});
test("archive storage failure rejects publication and preserves episode", async () => {
  await fixture(async ({ run, directory, episode }) => {
    fs.writeFileSync(directory, "blocked directory");
    const result = await run();
    assert.equal(result.publication.published, false); assert.equal(result.episode, false);
    assert.equal(fs.readFileSync(episode, "utf8"), "OLD EPISODE");
  });
});
test("concurrent episode changes retain an unreferenced archive but never overwrite concurrent output", async () => {
  await fixture(async ({ run, directory, episode }) => {
    const r = await withRuntime({ derivedSummaryGenerator: async request => {
      fs.writeFileSync(episode, "CONCURRENT"); return reply(request);
    } }, run);
    assert.equal(r.publication.published, false);
    assert.equal(fs.readFileSync(episode, "utf8"), "CONCURRENT");
    assert.ok(archive.loadArchive(directory, r.archive_id));
  });
});
test("missing or corrupted published predecessor blocks a new revision and reader rejects corrupted archive", async () => {
  await fixture(async ({ run, directory, episode }) => {
    const first = await run(), priorEpisode = fs.readFileSync(episode, "utf8");
    fs.writeFileSync(path.join(directory, first.archive_id + ".json"), "{}");
    assert.throws(() => derived.readDerivedSummary(first.archive_id, { directory }));
    const r = await run(); assert.equal(r.publication.published, false);
    assert.equal(fs.readFileSync(episode, "utf8"), priorEpisode);
  });
});
test("archive is revalidated immediately before episode commit", async () => {
  await fixture(async ({ run, episode }) => {
    const original = archive.loadArchive;
    let loads = 0;
    archive.loadArchive = (...args) => {
      if (++loads === 2) throw Error("archive_damaged_before_commit");
      return original(...args);
    };
    try {
      const r = await run(); assert.equal(r.reason, "archive_damaged_before_commit");
      assert.equal(r.publication.published, false);
      assert.equal(fs.readFileSync(episode, "utf8"), "OLD EPISODE");
    } finally { archive.loadArchive = original; }
  });
});
test("default HTTP adapter uses one real generation path with offline transport and records requested model identity", async () => {
  await fixture(async ({ run, directory }) => {
    let requests = 0;
    await withFakeHttps(async () => {
      const r = await withRuntime({ derivedSummaryGenerator: llm.llmDerivedSummary }, run);
      assert.equal(r.publication.published, true);
      const p = archive.loadArchive(directory, r.archive_id).payload;
      assert.equal(p.generator.model_identity, "requested_not_provider_verified");
      assert.equal(p.generator.transport, "chat-completions");
    }, (request, callback) => {
      requests++;
      const req = { prompt: request.body.messages.at(-1).content };
      emitJson(callback, completion(JSON.stringify(reply(req).summary)));
    });
    assert.equal(requests, 1);
  });
});
test("malformed HTTP output is rejected after one request without repair", async () => {
  await fixture(async ({ run, episode }) => {
    let requests = 0;
    await withFakeHttps(async () => {
      const r = await withRuntime({ derivedSummaryGenerator: llm.llmDerivedSummary }, run);
      assert.equal(r.reason, "summary_response_json");
      assert.equal(fs.readFileSync(episode, "utf8"), "OLD EPISODE");
    }, (_, callback) => { requests++; emitJson(callback, completion("invalid json")); });
    assert.equal(requests, 1);
  });
});
test("owner-authorized memory_engine_get reads exact checkpoint archive without DB access and denies non-owner", async () => {
  await fixture(async ({ run, root, directory, logs }) => {
    const { createMemoryEngineGetExecute } = await import("../lib/tools/memory-engine-actions.js");
    const { registerMemoryEngineTools } = await import("../lib/tools/register-memory-engine-tools.js");
    const execute = createMemoryEngineGetExecute({ get: { memoryDir: root,
      withCoreDb: () => { throw Error("must not access core"); },
      withEngineDb: () => { throw Error("must not access engine"); } } });
    const r = await run(), id = "checkpoint:" + r.archive_id;
    const read = await execute("read", { id, purpose: "execution", item_index: 0 });
    assert.equal(read.found, true); assert.equal(read.memory.kind, "derived_summary");
    assert.equal(read.memory.original_records[0].record.text, logs[0].text);
    const invalid = await execute("bad", { id: "checkpoint:../../escape" });
    assert.equal(invalid.code, "MEMORY_GET_DERIVED_INVALID");
    const missing = await execute("bad", { id: "checkpoint:" + "0".repeat(64) });
    assert.equal(missing.found, false);
    let getFactory;
    registerMemoryEngineTools({ registerTool: (tool, options) => {
      if (options?.name === "memory_engine_get") getFactory = tool;
    } }, { memoryEngineGet: execute });
    const denied = await getFactory({ senderIsOwner: false }).execute("read", { id });
    assert.equal(denied.code, "MEMORY_GET_OWNER_AUTH_REQUIRED");
    const allowed = await getFactory({ senderIsOwner: true }).execute("read", { id, source_id: "s0" });
    assert.equal(allowed.memory.record.text, logs[0].text);
    fs.unlinkSync(path.join(directory, r.archive_id + ".json"));
    assert.equal((await execute("read", { id })).found, false);
  });
});
