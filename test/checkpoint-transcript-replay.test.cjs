"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const checkpoint = require("../bin/session-checkpoint");
const derived = require("../lib/checkpoint/derived-summary");
const { collectTranscriptSources } = require("../lib/checkpoint/transcript-source.cjs");
const { tryEmptyCheckpoint, publishEmptyDay } = require("../lib/checkpoint/transcript-replay.cjs");
const DATE = "2026-10-21", NEXT = "2026-10-22";
function line(text, timestamp = "2026-10-20T16:30:00Z", role = "user") {
  return JSON.stringify({ type: "message", timestamp, message: { role, content: text } });
}
function inventory(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).sort().flatMap(name => {
    const p = path.join(root, name), stat = fs.statSync(p);
    return stat.isDirectory() ? inventory(p).map(x => name + "/" + x)
      : [name + ":" + fs.readFileSync(p).toString("hex")];
  });
}
async function fixture(t, action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "checkpoint-replay-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, "backup"), memoryDir = path.join(root, "memory");
  fs.mkdirSync(directory);
  const forbidden = () => { throw new Error("unexpected live operation"); };
  const runtime = { workspaceDir: root, memoryDir, episodesDir: path.join(memoryDir, "episodes"),
    sessionsDir: directory, smartAddDir: path.join(memoryDir, "smart-add"),
    checkpointSummaryMode: "derived", timeZone: "Asia/Shanghai", now: () => Date.parse("2026-11-06T01:00:00Z"),
    configJsonPath: path.join(root, "absent.json"), flushCheckpointRawLog: forbidden,
    syncCoreMemoryIndex: forbidden, reconcileSessionFlushManagedState: forbidden,
    resolveConfigConflicts: forbidden, repairOrphanVectors: forbidden,
    derivedSummaryGenerator: forbidden, readCheckpointRawLogs: forbidden };
  return checkpoint.withRuntime(runtime, () => action({ root, directory, memoryDir, runtime }));
}
function reply(request) {
  const p = JSON.parse(request.prompt), unit = p.SOURCE.sources.flatMap(s => s.units)[0];
  return { summary: { version: p.version, target_date: p.target_date, binding: p.binding,
    items: [{ topic: "历史记录", text: "来源报告，请回读原文。", evidence: [unit[0]], corrects: [] }] },
    generator: { model: "offline-fixture", transport: "test" } };
}
test("replay reads plain/reset/deleted files by Shanghai message date; preserves exact lines and duplicate locations", async t => {
  await fixture(t, ({ directory }) => {
    const original = line("跨日原文😀");
    fs.writeFileSync(path.join(directory, "a.jsonl"), original + "\n" + line("排除后一天", "2026-10-21T16:00:00Z") + "\n");
    fs.writeFileSync(path.join(directory, "a.jsonl.deleted.2026-11-04"), original + "\n");
    fs.writeFileSync(path.join(directory, "b.jsonl.reset.2026-11-01"), line("另一会话", "2026-10-21T01:00:00Z", "assistant") + "\n");
    fs.writeFileSync(path.join(directory, "stray-smart-add.md"), "今天对话不能进入历史输入");
    const r = collectTranscriptSources({ directory, targetDate: DATE, timeZone: "Asia/Shanghai" });
    assert.equal(r.logs.length, 2); assert.equal(r.audit.duplicates, 1); assert.equal(r.audit.out_of_date, 1);
    assert.equal(r.logs[0].original_jsonl_line, original); assert.equal(r.logs[0].transcript_locations.length, 2);
    assert.equal(r.audit.files.length, 3); assert.equal(r.unchanged(), true);
    fs.appendFileSync(path.join(directory, "a.jsonl"), line("变化") + "\n");
    assert.equal(r.unchanged(), false);
  });
});
test("dry-run replay plans actual prompts without any file, DB, flush or provider writes", async t => {
  await fixture(t, async ({ root, directory }) => {
    fs.writeFileSync(path.join(directory, "a.jsonl.deleted.old"), line("甲".repeat(70000)) + "\n");
    const before = inventory(root);
    const r = await checkpoint.main(["--target-date", DATE, "--replay-transcripts", directory, "--dry-run"]);
    assert.equal(r.ok, true); assert.equal(r.flush.performed, false);
    assert.equal(r.read_only, true); assert.equal(r.plan.batches.length, 1);
    assert.ok(r.plan.batches[0].input_chars <= 200000);
    assert.deepEqual(inventory(root), before);
  });
});
test("normal dry-run skips flush/index/reconciliation/model and writes nothing", async t => {
  await fixture(t, async ({ root }) => {
    const before = inventory(root);
    const r = await checkpoint.withRuntime({ readCheckpointRawLogs: () => [
      { source: "conversation", text: "**User:** 原文" },
    ] }, () => checkpoint.main(["--target-date", DATE, "--dry-run"]));
    assert.equal(r.flush.performed, false); assert.equal(r.plan.batches.length, 1);
    assert.deepEqual(inventory(root), before);
  });
});
test("replay archives before generation, works without smart-add/DBs, and reuses completed batches", async t => {
  await fixture(t, async ({ directory, memoryDir }) => {
    const original = line("**原始对话**：不要改写原文");
    fs.writeFileSync(path.join(directory, "a.jsonl.deleted.old"), original + "\n");
    let calls = 0;
    await checkpoint.withRuntime({ derivedSummaryGenerator: async request => {
      calls++;
      const ids = fs.readdirSync(path.join(memoryDir, "checkpoint-sources"));
      const source = derived.readDerivedSummary(ids[0].slice(0, -5), {
        directory: derived.archiveDirectory(memoryDir), purpose: "execution" });
      assert.equal(source.original_records[0].record.original_jsonl_line, original);
      return reply(request);
    } }, async () => {
      const argv = ["--target-date", DATE, "--replay-transcripts", directory];
      const first = await checkpoint.main(argv);
      assert.equal(first.ok, true); assert.equal(first.batches.completed, 1);
      const second = await checkpoint.main(argv);
      assert.equal(second.ok, true); assert.equal(second.batches.reused, 1); assert.equal(calls, 1);
      assert.equal(second.previous_archive_id, first.archive_id);
      const read = derived.readDerivedSummary(second.archive_id, {
        directory: derived.archiveDirectory(memoryDir), purpose: "execution" });
      assert.equal(read.original_records[0].record.original_jsonl_line, original);
    });
    assert.equal(fs.existsSync(path.join(memoryDir, "smart-add")), false);
  });
});
test("invalid JSON, missing timestamps and unreadable directories never publish empty or call live paths", async t => {
  await fixture(t, async ({ directory, memoryDir }) => {
    const file = path.join(directory, "a.jsonl");
    for (const bad of ["{broken", JSON.stringify({ type: "message", message: { role: "user", content: "未知日期" } })]) {
      fs.writeFileSync(file, bad + "\n");
      await assert.rejects(checkpoint.main(["--target-date", DATE, "--replay-transcripts", directory, "--dry-run"]),
        /transcript_invalid_json|transcript_missing_or_invalid_timestamp/);
    }
    await assert.rejects(checkpoint.main(["--target-date", DATE, "--replay-transcripts", path.join(directory, "absent")]), /ENOENT/);
    assert.equal(fs.existsSync(memoryDir), false);
  });
});
test("empty replay writes an explicit scoped marker; existing summaries survive", async t => {
  await fixture(t, async ({ directory, memoryDir }) => {
    fs.writeFileSync(path.join(directory, "a.jsonl"), line("另一日期") + "\n");
    const argv = ["--target-date", NEXT, "--replay-transcripts", directory];
    const r = await checkpoint.main(argv);
    assert.equal(r.status, "empty"); assert.equal(r.ok, true);
    const episode = path.join(memoryDir, "episodes", NEXT + ".md");
    assert.match(fs.readFileSync(episode, "utf8"), /^status: empty$/m);
    fs.writeFileSync(episode, "已有有效摘要");
    await assert.rejects(checkpoint.main(argv), /empty_day_existing_episode_preserved/);
    assert.equal(fs.readFileSync(episode, "utf8"), "已有有效摘要");
  });
});
test("nightly empty requires successful DB reads and no pending transcript; flush errors remain failures", async t => {
  await fixture(t, async ({ directory, memoryDir }) => {
    const logs = [];
    Object.defineProperty(logs, "checkpointStats", { value: { rawLogReadComplete: true } });
    Object.defineProperty(logs, "segmentedInput", { value: { unchanged: () => true } });
    await checkpoint.withRuntime({ readCheckpointRawLogs: () => logs }, async () => {
      fs.writeFileSync(path.join(directory, "a.jsonl.deleted.old"), line("尚未flush的历史原文") + "\n");
      assert.equal(tryEmptyCheckpoint(DATE), null);
      fs.writeFileSync(path.join(directory, "a.jsonl.deleted.old"), line("别的日期") + "\n");
      const r = await checkpoint.withRuntime({ flushCheckpointRawLog: () => ({ ok: true }) },
        () => checkpoint.main(["--target-date", NEXT]));
      assert.equal(r.status, "empty"); assert.equal(r.ok, true);
    });
    const argv = ["--target-date", "2026-10-23"];
    await assert.rejects(checkpoint.withRuntime({ flushCheckpointRawLog: () => ({ ok: false }) },
      () => checkpoint.main(argv)), /checkpoint_flush_failed/);
    assert.equal(fs.existsSync(path.join(memoryDir, "episodes", "2026-10-23.md")), false);
    await checkpoint.withRuntime({ readCheckpointRawLogs: () => [] }, () => assert.equal(tryEmptyCheckpoint(DATE), null));
  });
});
test("explicit cron sessions are excluded, ordinary conversations mentioning cron are retained", async t => {
  await fixture(t, ({ directory }) => {
    fs.writeFileSync(path.join(directory, "cron.jsonl.deleted.old"), line("[cron:job-123 Maintenance] Run maintenance") + "\n");
    fs.writeFileSync(path.join(directory, "user.jsonl"), line("请检查 cron") + "\n");
    const r = collectTranscriptSources({ directory, targetDate: DATE, timeZone: "Asia/Shanghai" });
    assert.equal(r.audit.excluded_cron_sessions, 1);
    assert.equal(r.logs.length, 1);
    assert.match(r.logs[0].text, /请检查 cron/);
  });
});
test("wrapper forwards replay flags and a failed dry-run never writes a fallback episode", async t => {
  await fixture(t, ({ directory, memoryDir, root }) => {
    const { spawnSync } = require("node:child_process");
    const envFile = path.join(root, "checkpoint.env");
    fs.writeFileSync(envFile, [
      "MEMORY_ENGINE_CHECKPOINT_SUMMARY_MODE=derived",
      "MEMORY_ENGINE_NODE_BIN=" + process.execPath,
      "MEMORY_ENGINE_MEMORY_DIR=" + memoryDir,
      "MEMORY_ENGINE_TIME_ZONE=Asia/Shanghai",
    ].join("\n"));
    const file = path.join(directory, "a.jsonl");
    const run = () => spawnSync("bash", [path.resolve("bin/run-session-checkpoint-direct.sh"),
      "--target-date", DATE, "--replay-transcripts", directory, "--dry-run"], {
      encoding: "utf8", env: { ...process.env, MEMORY_ENGINE_CHECKPOINT_ENV_FILE: envFile,
        NODE_OPTIONS: (process.env.NODE_OPTIONS || "") + " --require=" + path.resolve("test/checkpoint-dependency-loader.cjs") },
    });
    fs.writeFileSync(file, line("可预演") + "\n");
    const before = inventory(root), success = run();
    assert.equal(success.status, 0, success.stderr);
    assert.match(success.stdout, /"mode":"transcript_replay"/);
    assert.deepEqual(inventory(root), before);
    fs.writeFileSync(file, "{broken\n");
    const invalid = run();
    assert.equal(invalid.status, 1); assert.match(invalid.stderr, /transcript_invalid_json/);
    assert.equal(fs.existsSync(memoryDir), false);
  });
});
test("large audits stay in the snapshot and trajectory artifacts are never dialogue inputs", async t => {
  await fixture(t, ({ directory, memoryDir }) => {
    fs.writeFileSync(path.join(directory, "real.jsonl"), line("另一日期") + "\n");
    for (const name of ["a.trajectory.jsonl", "b.trajectory.jsonl.deleted.old", "c.trajectory.jsonl.reset.old"]) {
      fs.writeFileSync(path.join(directory, name), "not a transcript and not valid JSON");
    }
    const source = collectTranscriptSources({ directory, targetDate: NEXT, timeZone: "Asia/Shanghai" });
    assert.equal(source.logs.length, 0);
    assert.equal(source.audit.files.length, 1);
    assert.equal(source.audit.ignored_trajectory_files, 3);
    // Simulate years of inventory without filling the indexed episode.
    source.audit.files = Array.from({ length: 2000 }, (_, i) => ({
      file: "long-private-file-" + i + ".jsonl.deleted.old",
      sha256: String(i).padStart(64, "0"), matched: 0, excluded: "cron_session",
    }));
    const r = publishEmptyDay(source.logs, NEXT, source.audit, () => true);
    const text = fs.readFileSync(path.join(memoryDir, "episodes", NEXT + ".md"), "utf8");
    assert.ok(Buffer.byteLength(text) < 2000);
    assert.doesNotMatch(text, /long-private-file|sha256/);
    const summary = JSON.parse(text.split("\n").find(l => l.startsWith("sourceAudit: ")).slice(13));
    assert.equal(summary.files_read, 2000);
    assert.equal(summary.excluded_files_by_reason.cron_session, 2000);
    const options = { directory: derived.archiveDirectory(memoryDir) };
    const detailed = derived.readDerivedSummary(r.source_snapshot_id, { ...options, purpose: "acceptance" });
    assert.equal(detailed.source_audit.files.length, 2000);
    assert.equal(detailed.source_audit.files[1999].file, source.audit.files[1999].file);
    assert.equal(derived.readDerivedSummary(r.source_snapshot_id, options).source_audit, undefined);
  });
});
test("CLI rejects incomplete dates, replay without date, and unknown options before writing", () => {
  for (const args of [["--target-date"], ["--target-date="], ["--target-date", "--dry-run"],
    ["--target-date", "2026-02-30"], ["--replay-transcripts", "/backup"], ["--typo"]]) {
    assert.throws(() => checkpoint.parseCliArgs(args));
  }
});
