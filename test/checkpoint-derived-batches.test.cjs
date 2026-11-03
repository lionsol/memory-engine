"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const derived = require("../lib/checkpoint/derived-summary");
const batching = require("../lib/checkpoint/derived-summary-batches.cjs");
const archive = require("../lib/checkpoint/summary-memory-archive.cjs");
const { withRuntime } = require("../lib/checkpoint/runtime");
const DATE = "2026-10-20";
function logsFor(texts, sessions = texts.map((_, index) => "session-" + index)) {
  const logs = texts.map((text, index) => ({ source: "conversation", category: "raw_log",
    entry_id: "entry-" + index, text: "**User:** " + text }));
  logs.segmentedInput = { targetDate: DATE, entries: logs.map((log, index) => ({
    ...log, entryId: log.entry_id, sessionId: sessions[index], role: "user", provenance: "session_flush",
  })), unchanged: () => true };
  return logs;
}
function reply(request, { many = false, text = "本批摘要。" } = {}) {
  const packet = JSON.parse(request.prompt);
  const units = packet.SOURCE.sources.flatMap(source => source.units);
  return { summary: { version: packet.version, target_date: packet.target_date, binding: packet.binding,
    items: (many ? units.slice(0, 256) : units.slice(0, 1)).map((unit, index) => ({
      topic: "事项" + index, text, evidence: [unit[0]], corrects: [],
    })) }, generator: { model: "offline-fixture", transport: "test" } };
}
async function fixture(action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "derived-batches-"));
  const episodesDir = path.join(root, "episodes"), episode = path.join(episodesDir, DATE + ".md");
  fs.mkdirSync(episodesDir); fs.writeFileSync(episode, "OLD");
  const directory = derived.archiveDirectory(root);
  const run = (logs, generator, extra = {}) => derived.generateDerivedCheckpoint(logs, {
    targetDate: DATE, generatedAt: new Date().toISOString(), inputReady: true, generator, ...extra });
  try {
    await withRuntime({ memoryDir: root, workspaceDir: root, episodesDir,
      configJsonPath: path.join(root, "absent.json") },
    () => action({ root, directory, episode, run }));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test("raw snapshot is readable before the first request and survives all batch failures", async () => {
  await fixture(async ({ root, directory, episode, run }) => {
    const logs = logsFor(["甲".repeat(5000), "乙".repeat(5000), "丙".repeat(5000)]);
    let calls = 0, id;
    const result = await run(logs, async () => {
      calls++;
      id = fs.readdirSync(path.join(root, "checkpoint-sources"))[0].slice(0, -5);
      const read = derived.readDerivedSummary(id, { directory, purpose: "execution" });
      assert.deepEqual(read.original_records.map(row => row.record.text), logs.map(log => log.text));
      throw Error("provider_down");
    }, { maxInputChars: 9500 });
    assert.equal(result.publication.published, false); assert.equal(calls, 3);
    assert.equal(result.source_snapshot_id, id);
    assert.equal(result.batches.completed, 0); assert.equal(result.batches.total, 3);
    assert.equal(fs.readFileSync(episode, "utf8"), "OLD");
    assert.equal(derived.readDerivedSummary(id, { directory, sourceId: "s2" }).record.text, logs[2].text);
  });
});
test("planner packs complete sessions together even when their records are interleaved", () => {
  const logs = logsFor(["甲".repeat(4000), "乙".repeat(4000), "丙".repeat(4000), "丁".repeat(4000)],
    ["A", "B", "A", "B"]);
  const plan = batching.planBatches(logs, DATE, { maxInputChars: 13000 });
  assert.equal(plan.batches.length, 2);
  assert.deepEqual(plan.batches.map(batch => batch.source_ids), [["s0", "s2"], ["s1", "s3"]]);
  for (const batch of plan.batches) assert.ok(batch.request.inputChars <= 13000);
});
test("one oversized paragraph splits at Unicode-safe original offsets with no content loss", () => {
  const logs = logsFor(["🙂文".repeat(5000)]);
  const plan = batching.planBatches(logs, DATE, { maxInputChars: 5000 });
  assert.ok(plan.batches.length > 1);
  const units = plan.input.sources[0].units;
  assert.equal(units.map(unit => unit.text).join(""), "🙂文".repeat(5000));
  for (const unit of units) {
    assert.ok(unit.text.isWellFormed());
    assert.equal(logs[0].text.slice(unit.start, unit.end), unit.text);
  }
  for (const batch of plan.batches) {
    assert.ok(batch.request.inputChars <= 5000);
    assert.equal(batch.request.inputChars, batch.request.system.length + batch.request.prompt.length);
  }
});
test("partial daily output exceeds one-batch output budget and resumes only the failed batch", async () => {
  await fixture(async ({ directory, episode, run }) => {
    const logs = logsFor(["甲".repeat(5000), "乙".repeat(5000), "丙".repeat(5000)]);
    const attempted = [];
    const partial = await run(logs, async request => {
      attempted.push(request.batchIndex);
      const response = reply(request, { text: "摘".repeat(12000) });
      if (request.batchIndex === 1) response.summary.items[0].evidence = ["not-in-this-batch"];
      return response;
    }, { maxInputChars: 9500 });
    assert.deepEqual(attempted, [0, 1, 2]);
    assert.equal(partial.status, "partial_summary", partial.reason);
    assert.equal(partial.batches.completed, 2); assert.equal(partial.batches.total, 3);
    const firstArchive = fs.readFileSync(path.join(directory, partial.archive_id + ".json"));
    const stored = archive.loadArchive(directory, partial.archive_id);
    assert.ok(stored.payload.body.length > 20000);
    assert.match(fs.readFileSync(episode, "utf8"), /部分完成/);
    assert.match(fs.readFileSync(episode, "utf8"), /本批未完成/);
    for (let index = 0; index < logs.length; index++) {
      assert.equal(derived.readDerivedSummary(partial.archive_id, {
        directory, sourceId: "s" + index }).record.text, logs[index].text);
    }
    const resumedCalls = [];
    const complete = await run(logs, async request => {
      resumedCalls.push(request.batchIndex); return reply(request, { text: "摘".repeat(12000) });
    }, { maxInputChars: 9500 });
    assert.equal(complete.status, "valid_summary", complete.reason);
    assert.deepEqual(resumedCalls, [1]); assert.equal(complete.batches.reused, 2);
    assert.equal(complete.source_snapshot_id, partial.source_snapshot_id);
    assert.equal(complete.previous_archive_id, partial.archive_id);
    assert.deepEqual(fs.readFileSync(path.join(directory, partial.archive_id + ".json")), firstArchive);
    assert.match(fs.readFileSync(episode, "utf8"), /批次完成：3\/3/);
    assert.ok(archive.loadArchive(directory, complete.archive_id).payload.body.length > 30000);
    const job = JSON.parse(fs.readFileSync(path.join(path.dirname(directory), "checkpoint-summary-jobs",
      complete.batches.job_id + ".json")));
    assert.equal(job.entries[1].attempt_history.length, 2);
    assert.equal(job.entries[1].attempt_history[0].reply.summary.items[0].evidence[0], "not-in-this-batch");
    const { createMemoryEngineGetExecute } = await import("../lib/tools/memory-engine-actions.js");
    const execute = createMemoryEngineGetExecute({ get: { memoryDir: path.dirname(directory),
      withCoreDb: () => { throw Error("no DB"); }, withEngineDb: () => { throw Error("no DB"); } } });
    const get = await execute("snapshot", { id: "checkpoint:" + complete.source_snapshot_id, source_id: "s1" });
    assert.equal(get.found, true); assert.equal(get.memory.kind, "raw_snapshot");
    assert.equal(get.memory.record.text, logs[1].text);
  });
});
test("512-unit and 256-item limits apply per batch; item 300 remains traceable", async () => {
  await fixture(async ({ directory, episode, run }) => {
    const logs = logsFor([Array.from({ length: 600 }, (_, index) => "段落" + index).join("\n\n")]);
    let calls = 0;
    const result = await run(logs, async request => { calls++; return reply(request, { many: true }); });
    assert.equal(result.status, "valid_summary", result.reason); assert.equal(calls, 2);
    const p = archive.loadArchive(directory, result.archive_id).payload;
    assert.equal(p.input.sources[0].units.length, 600);
    assert.equal(p.summary.items.length, 344);
    const read = derived.readDerivedSummary(result.archive_id, { directory, itemIndex: 300, purpose: "execution" });
    assert.equal(read.items[0].item_index, 300); assert.equal(read.original_records[0].record.text, logs[0].text);
    const locator = require("../lib/checkpoint/derived-summary-locator.cjs");
    const info = locator.inspectDerivedSnippet({ path: "memory/episodes/" + DATE + ".md",
      text: fs.readFileSync(episode, "utf8") });
    assert.equal(info.status, "unverified"); assert.ok(info.item_indexes.includes(300));
  });
});
test("cancellation keeps earlier progress and a subsequent run continues it", async () => {
  await fixture(async ({ root, run }) => {
    const logs = logsFor(["甲".repeat(5000), "乙".repeat(5000), "丙".repeat(5000)]);
    const controller = new AbortController();
    const first = await run(logs, async request => {
      if (request.batchIndex === 1) controller.abort();
      return reply(request);
    }, { maxInputChars: 9500, signal: controller.signal });
    assert.equal(first.reason, "derived_cancelled");
    assert.ok(first.source_snapshot_id);
    const jobPath = path.join(root, "checkpoint-summary-jobs",
      fs.readdirSync(path.join(root, "checkpoint-summary-jobs"))[0]);
    assert.equal(JSON.parse(fs.readFileSync(jobPath)).entries[0].status, "complete");
    const attempts = [];
    const second = await run(logs, async request => { attempts.push(request.batchIndex); return reply(request); },
      { maxInputChars: 9500 });
    assert.equal(second.status, "valid_summary", second.reason);
    assert.deepEqual(attempts, [1, 2]);
  });
});
test("heartbeat-only source units do not prevent useful batches", () => {
  const logs = logsFor(["HEARTBEAT_OK", "[OpenClaw heartbeat poll]", "保留这个决定。"]);
  const plan = batching.planBatches(logs, DATE);
  assert.deepEqual(plan.batches[0].source_ids, ["s2"]);
});
test("main reports partial publication as incomplete and exposes the snapshot and retry status", async t => {
  const previous = process.env.MEMORY_ENGINE_CHECKPOINT_SUMMARY_INPUT_CHARS;
  process.env.MEMORY_ENGINE_CHECKPOINT_SUMMARY_INPUT_CHARS = "9500";
  t.after(() => {
    if (previous === undefined) delete process.env.MEMORY_ENGINE_CHECKPOINT_SUMMARY_INPUT_CHARS;
    else process.env.MEMORY_ENGINE_CHECKPOINT_SUMMARY_INPUT_CHARS = previous;
  });
  await fixture(async () => {
    const logs = logsFor(["甲".repeat(5000), "乙".repeat(5000), "丙".repeat(5000)]);
    let fail = true;
    await withRuntime({
      flushCheckpointRawLog: () => ({ ok: true }), readCheckpointRawLogs: () => logs,
      syncCoreMemoryIndex: async ({ targetDate }) => ({
        ok: true, index_invocation: { status: "succeeded" },
        target_date_coverage: { status: "complete", target_date: targetDate,
          path: "memory/smart-add/" + targetDate + ".md", required_fingerprints: 1,
          matched_fingerprints: 1, missing_fingerprints: 0 },
      }),
      reconcileSessionFlushManagedState: () => ({ ok: true, target_date_input_complete: true, eligibleCoreRows: [] }),
      repairOrphanVectors: () => ({ lance_completion_state: "no_active_rows",
        lance_membership_complete: true, lance_vector_validation_complete: true }),
      resolveConfigConflicts: () => 0,
      derivedSummaryGenerator: async request => {
        if (fail && request.batchIndex === 1) throw Error("temporary");
        return reply(request);
      },
    }, async () => {
      const { main } = require("../bin/session-checkpoint");
      const first = await main(["--target-date", DATE]);
      assert.equal(first.ok, false); assert.equal(first.businessStatus.status, "partial_summary");
      assert.equal(first.businessStatus.business_complete, false);
      assert.equal(first.businessStatus.summary_batches.completed, 2);
      assert.ok(first.businessStatus.summary_source_snapshot_id);
      fail = false;
      const second = await main(["--target-date", DATE]);
      assert.equal(second.ok, true); assert.equal(second.businessStatus.business_complete, true);
      assert.equal(second.businessStatus.summary_batches.calls, 1);
      assert.equal(second.businessStatus.summary_batches.reused, 2);
    });
  });
});
test("input limit too small for even one character still leaves a readable raw snapshot", async () => {
  await fixture(async ({ directory, run }) => {
    const logs = logsFor(["保留原文"]);
    const result = await run(logs, async () => { throw Error("must not call"); }, { maxInputChars: 1 });
    assert.equal(result.reason, "comparison_input_budget");
    assert.equal(derived.readDerivedSummary(result.source_snapshot_id, { directory, sourceId: "s0" }).record.text, logs[0].text);
  });
});
