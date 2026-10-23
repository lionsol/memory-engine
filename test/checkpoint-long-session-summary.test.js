import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
const require = createRequire(import.meta.url);
const { createRawLogReader } = require("../lib/checkpoint/raw-log-assembly");
const budget = require("../lib/checkpoint/raw-log-budget");
const { dedupeCollectedLogs } = require("../lib/checkpoint/raw-log-dedupe");
const { summarizeLongSession, segmentSource, coversSource } = require("../lib/checkpoint/long-session-summary");
const { createSummaryProvider, LIMITS } = require("../lib/checkpoint/bounded-summary-provider");
const { withRuntime } = require("../lib/checkpoint/runtime");
const { nightlyCheckpoint, main } = require("../bin/session-checkpoint");
const { snapshotEpisode, publishEpisode } = require("../lib/checkpoint/episode-publication");
const { withFakeHttps, emitJson, completion } = require("./checkpoint-summary-http-fixture.cjs");

const rawLog = require("../lib/checkpoint/raw-log");
const contract = require("../lib/smart-add-entry-contract.cjs");
const DATE = "2026-10-20";
const PROVIDERS = { primaryProvider: "deepseek", fallbackProvider: "siliconflow" };
function source(size = 22932) { return "**User:** " + "合".repeat(size - 10); }
function entry(text, id = "long") {
  return { text, entryId: id, sessionId: id, provenance: "session_flush",
    category: "raw_log", source: "conversation", sourceKind: "smartAdd",
    role: "other", timestampMs: null, dedupeKey: id };
}
function stats() {
  const chars = () => ({ smartAdd: 0, dbRawLog: 0, resetTranscript: 0 });
  return { droppedDuplicateCount: 0, droppedByBudgetCount: 0,
    sourceCharCountsAfter: chars(), charsBySourceAfterBudget: chars(),
    charsByRoleAfterBudget: { metadata_header: 0, note: 0, user: 0 } };
}
function reader(getEntries, budgets = {}) {
  return createRawLogReader({
    getRuntime: () => ({ timeZone: "Asia/Shanghai", now: () => Date.now() }),
    yesterdayDateStr: () => DATE, getTargetDateRange: () => ({}),
    makeCollectorStats: stats, getBudgetConfig: () => budget.getBudgetConfig({ budgets }),
    collectSmartAddLogs: () => getEntries().map(item => ({ ...item })),
    collectDbRawLogs: () => [], collectSessionTranscriptLogs: () => [],
    dedupeCollectedLogs, ...budget, inferRoleKey: () => "user", logger: { log() {} },
  });
}
function response(prompt) {
  if (prompt.includes("\nSOURCE\n")) {
    const header = prompt.split("\nSOURCE\n")[0].split("\n").at(-1);
    const meta = JSON.parse(header);
    return { segment_id: meta.segment_id, source_hash: meta.source_hash,
      evidence: [{ start: meta.start, end: meta.end, text: "Grounded fixture evidence" }] };
  }
  const meta = JSON.parse(prompt.split("\nMETADATA\n")[1].split("\nEVIDENCE\n")[0]);
  const maps = JSON.parse(prompt.split("\nEVIDENCE\n")[1].split("\nOTHER\n")[0]);
  const other = JSON.parse(prompt.split("\nOTHER\n")[1]);
  return { target_date: DATE, covered_segment_ids: maps.map(item => item.segment_id),
    covered_entry_ids: meta.entries.map(item => item.id),
    episode_summary: "Long session plus the other daily decision.",
    references: [...maps.map(item => ({ segment_id: item.segment_id,
      start: item.evidence[0].start, end: item.evidence[0].end })), ...other.map(item => ({ entry_id: item.id }))] };
}
// Synthetic shape/size fixture only: the real 347-unit response body was not retained.
function mapResponseOfSize(prompt, size) {
  const object = response(prompt);
  object.evidence[0].text = "";
  const remaining = size - JSON.stringify(object).length;
  assert.ok(remaining > 160);
  object.evidence[0].text = "😀".repeat(Math.floor(remaining / 2)) + (remaining % 2 ? "界" : "");
  assert.equal(JSON.stringify(object).length, size);
  return object;
}
async function fixture(fn, { entries = [entry(source()), entry("**User:** other daily decision", "other")] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "checkpoint-segments-"));
  const episodes = join(root, "episodes");
  mkdirSync(episodes);
  const path = join(episodes, DATE + ".md");
  writeFileSync(path, "OLD SUMMARY");
  const state = { entries };
  const read = reader(() => state.entries);
  const overrides = { workspaceDir: root, memoryDir: root, episodesDir: episodes,
    smartAddDir: join(root, "smart-add"), generatedSmartAddDir: join(root, "generated"),
    sessionsDir: join(root, "sessions"), coreDbPath: join(root, "core.sqlite"),
    engineDbPath: join(root, "engine.sqlite"), configJsonPath: join(root, "absent.json"),
    lancedbDir: join(root, "lance"), timeZone: "Asia/Shanghai" };
  try {
    return await withRuntime(overrides, () => fn({ state, read, path, root, overrides }));
  } finally { rmSync(root, { recursive: true, force: true }); }
}
function options(logs, transport, extra = {}) {
  return { targetDate: DATE, stats: logs.checkpointStats, inputReady: true,
    providers: PROVIDERS, transport, ...extra };
}

test("actual reader -> budget -> nightly path: 22,932 source and other daily entry, six calls", async () => {
  await fixture(async ({ read, path, overrides }) => {
    const logs = read({ targetDate: DATE });
    assert.equal(logs.segmentedInput.entries[0].text.length, 22932);
    assert.equal(logs[0].text.length, 8000);
    assert.equal(logs.checkpointStats.budgetUncoveredEntries[0].session_only, true);
    assert.equal(Object.keys(logs).includes("segmentedInput"), false);
    const requests = [];
    const transport = async (prompt, system, opts) => {
      requests.push(prompt);
      assert.equal(system, null);
      assert.ok(opts.timeoutMs <= 30000);
      assert.ok(opts.signal);
      return JSON.stringify(response(prompt));
    };
    const result = await withRuntime({ ...overrides, summaryTransport: transport, summaryProviders: PROVIDERS },
      () => nightlyCheckpoint(logs, { targetDate: DATE, rawLogStats: logs.checkpointStats, inputReady: true }));
    assert.equal(result.status, "valid_summary");
    assert.equal(requests.length, 6);
    assert.ok(requests[5].includes("other daily decision"));
    assert.equal(result.segmented.day_coverage_complete, true);
    assert.equal(result.segmented.semantic_accuracy, "not_verified");
    assert.deepEqual(result.segmented.segments.map(({ start, end }) => [start, end]),
      [[0,6000],[5600,11600],[11200,17200],[16800,22800],[22400,22932]]);
    assert.match(readFileSync(path, "utf8"), /Long session plus/);
    assert.equal(readFileSync(result.segmented.publication.backup, "utf8"), "OLD SUMMARY");
  });
});

for (const scenario of ["segment_failure", "reducer_failure", "missing_segment", "missing_other",
  "bad_reference", "invalid_json", "oversize_output", "source_changed", "episode_changed", "cancelled"]) {
  test(scenario + " preserves old episode and never publishes a partial day", async () => {
    await fixture(async ({ read, state, path }) => {
      const logs = read({ targetDate: DATE });
      const controller = new AbortController();
      let attempts = 0;
      const transport = async prompt => {
        attempts++;
        const isMap = prompt.includes("\nSOURCE\n");
        if (scenario === "segment_failure" && isMap) throw new Error("fake transport error");
        if (scenario === "reducer_failure" && !isMap) throw new Error("fake reducer error");
        if (scenario === "invalid_json") return "{";
        if (scenario === "oversize_output") return "x".repeat(601);
        if (scenario === "cancelled") controller.abort();
        const object = response(prompt);
        if (!isMap) {
          if (scenario === "missing_segment") object.covered_segment_ids.pop();
          if (scenario === "missing_other") object.covered_entry_ids.pop();
          if (scenario === "bad_reference") object.references[0].end++;
          if (scenario === "source_changed") state.entries[0] = entry(source().slice(0, -1) + "改");
          if (scenario === "episode_changed") writeFileSync(path, "CONCURRENT SUMMARY");
        }
        return JSON.stringify(object);
      };
      const result = await summarizeLongSession(logs, options(logs, transport, { signal: controller.signal }));
      assert.equal(result.ok, false);
      assert.equal(result.report.published, false);
      assert.equal(result.report.day_coverage_complete, false);
      assert.equal(readFileSync(path, "utf8"), scenario === "episode_changed" ? "CONCURRENT SUMMARY" : "OLD SUMMARY");
      assert.ok(attempts <= 7);
    });
  });
}

test("actual smart-add parser retains full source; header-only source version change blocks publication", async () => {
  for (const changeHeader of [false, true]) {
    await fixture(async ({ path, overrides }) => {
      mkdirSync(overrides.smartAddDir);
      const file = join(overrides.smartAddDir, DATE + ".md");
      const text = "# Source version one\n\n" + [
        contract.renderSmartAddEntry({ entryId: "long", category: "raw_log", provenance: "session_flush", text: source() }),
        contract.renderSmartAddEntry({ entryId: "other", category: "raw_log", provenance: "session_flush", text: "**User:** other decision" }),
      ].join("\n");
      writeFileSync(file, text);
      const logs = rawLog.readCheckpointRawLogs({ targetDate: DATE });
      assert.equal(logs.segmentedInput.entries[0].text.length, 22932);
      const result = await summarizeLongSession(logs, options(logs, async prompt => {
        if (changeHeader && prompt.includes("\nMETADATA\n")) writeFileSync(file, text.replace("version one", "version two"));
        return JSON.stringify(response(prompt));
      }));
      assert.equal(result.ok, !changeHeader);
      if (changeHeader) {
        assert.equal(result.report.reason, "source_version_changed");
        assert.equal(readFileSync(path, "utf8"), "OLD SUMMARY");
      }
    });
  }
});

test("collector read failure and unsupported provenance never enter segmentation", async () => {
  await fixture(async ({ read, path }) => {
    const logs = read({ targetDate: DATE });
    logs.checkpointStats.rawLogReadFailed = true;
    let calls = 0;
    assert.equal(await summarizeLongSession(logs, options(logs, async () => { calls++; })), null);
    assert.equal(calls, 0);
    assert.equal(readFileSync(path, "utf8"), "OLD SUMMARY");
  });
  await fixture(async ({ read }) => {
    const logs = read({ targetDate: DATE });
    assert.equal(await summarizeLongSession(logs, options(logs, async () => { throw new Error("must not run"); })), null);
  }, { entries: [{ ...entry(source()), provenance: "manual" }] });
});

test("all primary failures use at most one distinct fallback per logical call and count every input", async () => {
  await fixture(async ({ read }) => {
    const logs = read({ targetDate: DATE });
    const requests = [];
    const result = await summarizeLongSession(logs, options(logs, async (prompt, _, request) => {
      requests.push(prompt);
      if (request.provider === "deepseek") throw new Error("fake primary failed");
      return JSON.stringify(response(prompt));
    }));
    assert.equal(result.ok, true);
    assert.equal(result.report.provider.logical_calls, 6);
    assert.equal(result.report.provider.attempts, 12);
    assert.equal(result.report.provider.input_chars, requests.reduce((sum, text) => sum + text.length, 0));
    assert.equal(result.report.provider.output_reserved, 14000);
    assert.ok(result.report.provider.input_chars <= 80000);
  });
});

test("extra unhandled entry, second long entry, source cap and other-context overflow fail closed", async () => {
  for (const entries of [
    [entry(source()), entry(source(), "second")],
    [entry(source(26001))],
    [entry(source()), entry("**User:** " + "x".repeat(1500), "other")],
  ]) {
    await fixture(async ({ read, path }) => {
      const logs = read({ targetDate: DATE });
      let calls = 0;
      const result = await summarizeLongSession(logs, options(logs, async () => { calls++; return "{}"; }));
      assert.ok(result === null || result.ok === false);
      assert.equal(calls, 0);
      assert.equal(readFileSync(path, "utf8"), "OLD SUMMARY");
    }, { entries });
  }
});

test("gates, remaining parent deadline and pre-cancel prevent any attempt", async () => {
  await fixture(async ({ read, path }) => {
    const logs = read({ targetDate: DATE });
    const controller = new AbortController();
    controller.abort();
    for (const extra of [{ inputReady: false }, { parentDeadline: performance.now() + 449000 }, { signal: controller.signal }]) {
      let calls = 0;
      const result = await summarizeLongSession(logs, options(logs, async () => { calls++; }, extra));
      assert.equal(result.ok, false);
      assert.equal(calls, 0);
    }
    assert.equal(readFileSync(path, "utf8"), "OLD SUMMARY");
  });
});

test("UTF-16 segment boundaries preserve surrogate pairs and cover the source", async () => {
  const text = "**User:** " + "😀".repeat(11461);
  const segments = segmentSource(text);
  assert.ok(coversSource(segments, text.length));
  for (const part of segments) {
    assert.ok(text.slice(part.start, part.end).isWellFormed());
    assert.ok(part.end - part.start <= 6000);
  }
  assert.equal(coversSource([segments[0], ...segments.slice(2)], text.length), false);
  await fixture(async ({ read }) => {
    const logs = read({ targetDate: DATE });
    const result = await summarizeLongSession(logs, options(logs, async prompt => JSON.stringify(response(prompt))));
    assert.equal(result.ok, true);
  }, { entries: [entry(text), entry("**User:** other", "other")] });
});

test("provider total call/input/output budgets cannot be bypassed by fallback", async () => {
  const adapter = createSummaryProvider({ providers: PROVIDERS, transport: async () => "x" });
  for (let index = 0; index < 6; index++) await adapter.complete("x", { kind: "map", outputLimit: 600 });
  await assert.rejects(adapter.complete("x", { kind: "map", outputLimit: 600 }), /logical_budget/);
  const input = createSummaryProvider({ providers: PROVIDERS, transport: async () => "x" });
  input.ledger.input_chars = LIMITS.input;
  await assert.rejects(input.complete("x", { kind: "map", outputLimit: 600 }), /attempt_budget/);
  const output = createSummaryProvider({ providers: PROVIDERS, transport: async () => "x" });
  output.ledger.output_reserved = LIMITS.output;
  await assert.rejects(output.complete("x", { kind: "map", outputLimit: 600 }), /attempt_budget/);
});

test("deadline aborts an unresolved attempt without retrying beyond the round", async () => {
  let started = 0;
  let cancelled = 0;
  const adapter = createSummaryProvider({ providers: PROVIDERS, parentDeadline: performance.now() + 20,
    transport: async (_, __, opts) => {
      started++;
      opts.signal.addEventListener("abort", () => { cancelled++; });
      return new Promise(() => {});
    } });
  await assert.rejects(adapter.complete("x", { kind: "map", outputLimit: 600 }));
  assert.equal(started, 1);
  assert.equal(cancelled, 1);
});

test("monotonic stage deadline rejects a late resolution even before timer delivery", async () => {
  let clock = 0;
  let calls = 0;
  const adapter = createSummaryProvider({ providers: PROVIDERS, now: () => clock,
    transport: async () => { calls++; clock += 60001; return "late"; } });
  await assert.rejects(adapter.complete("x", { kind: "map", outputLimit: 600 }), /stage_deadline/);
  assert.equal(calls, 1);
});

test("publication checks versions and respects an existing cooperative lock", async () => {
  await fixture(async ({ path }) => {
    const expected = snapshotEpisode(path);
    writeFileSync(path + ".checkpoint.lock", "another writer");
    assert.throws(() => publishEpisode(path, "NEW", { expected }), /EEXIST/);
    assert.equal(readFileSync(path, "utf8"), "OLD SUMMARY");
    assert.equal(readFileSync(path + ".checkpoint.lock", "utf8"), "another writer");
  });
});

test("full main reports a published summary but incomplete cleanup without false business success", async () => {
  await fixture(async ({ read, overrides, path }) => {
    const fs = require("node:fs");
    const unlink = fs.unlinkSync;
    fs.unlinkSync = target => {
      if (target === path + ".checkpoint.lock") throw Object.assign(new Error("fixture"), { code: "EACCES" });
      return unlink(target);
    };
    try {
      const result = await withRuntime({ ...overrides, readCheckpointRawLogs: read,
        summaryProviders: PROVIDERS, summaryTransport: async prompt => JSON.stringify(response(prompt)),
        flushCheckpointRawLog: () => ({ ok: true }),
        syncCoreMemoryIndex: () => ({ ok: true, index_invocation: { status: "succeeded" },
          target_date_coverage: { status: "complete", target_date: DATE, path: "memory/smart-add/" + DATE + ".md",
            required_fingerprints: 4, matched_fingerprints: 4 } }),
        reconcileSessionFlushManagedState: () => ({ ok: true, target_date_input_complete: true, eligibleCoreRows: [] }),
        repairOrphanVectors: () => ({ lance_membership_complete: true, lance_vector_validation_complete: true }),
        resolveConfigConflicts: () => 0,
      }, () => main(["--target-date", DATE]));
      assert.equal(result.ok, false);
      assert.equal(result.businessStatus.summary_status, "valid_summary");
      assert.equal(result.businessStatus.segmented_summary.published, true);
      assert.equal(result.businessStatus.publication_complete, false);
      assert.equal(result.businessStatus.business_complete, false);
      assert.match(readFileSync(path, "utf8"), /Long session plus/);
    } finally { fs.unlinkSync = unlink; }
  });
});

test("full main reports segmented daily coverage separately from original clipping and Lance backlog", async () => {
  await fixture(async ({ read, overrides }) => {
    const result = await withRuntime({ ...overrides,
      readCheckpointRawLogs: read, summaryProviders: PROVIDERS,
      summaryTransport: async prompt => JSON.stringify(response(prompt)),
      flushCheckpointRawLog: () => ({ ok: true }),
      syncCoreMemoryIndex: () => ({ ok: true, index_invocation: { status: "succeeded" },
        target_date_coverage: { status: "complete", target_date: DATE, path: "memory/smart-add/" + DATE + ".md",
          required_fingerprints: 4, matched_fingerprints: 4, missing_fingerprints: 0 } }),
      reconcileSessionFlushManagedState: () => ({ ok: true, target_date_input_complete: true, eligibleCoreRows: [] }),
      repairOrphanVectors: () => ({ lance_membership_complete: false, lance_vector_validation_complete: false,
        lance_completion_state: "limit_backlog", lance_limit_backlog_remaining: 1870 }),
      resolveConfigConflicts: () => 0,
    }, () => main(["--target-date", DATE]));
    assert.equal(result.businessStatus.summary_status, "valid_summary");
    assert.equal(result.businessStatus.summary_input_complete, true);
    assert.equal(result.businessStatus.budget_coverage_complete, false);
    assert.equal(result.businessStatus.business_complete, false);
    assert.equal(result.businessStatus.vector_limit_backlog, 1870);
  });
});

test("real JS main + HTTPS decoder: 347-unit maps with 22,932 source and three same-day entries", async () => {
  const entries = [entry(source()), ...[366,356,360].map((size, index) => entry(source(size), "other-" + index))];
  await fixture(async ({ read, path, overrides }) => {
    await withFakeHttps(async requests => {
      const result = await withRuntime({ ...overrides, readCheckpointRawLogs: read, summaryProviders: PROVIDERS,
        flushCheckpointRawLog: () => ({ ok: true }),
        syncCoreMemoryIndex: () => ({ ok: true, index_invocation: { status: "succeeded" },
          target_date_coverage: { status: "complete", target_date: DATE, path: "memory/smart-add/" + DATE + ".md",
            required_fingerprints: 4, matched_fingerprints: 4, missing_fingerprints: 0 } }),
        reconcileSessionFlushManagedState: () => ({ ok: true, target_date_input_complete: true, eligibleCoreRows: [] }),
        repairOrphanVectors: () => ({ lance_membership_complete: false, lance_vector_validation_complete: false,
          lance_completion_state: "limit_backlog", lance_limit_backlog_remaining: 1860 }),
        resolveConfigConflicts: () => 0,
      }, () => main(["--target-date", DATE]));
      const report = result.businessStatus.segmented_summary;
      assert.equal(requests.length, 6);
      assert.equal(report.source_chars, 22932);
      assert.equal(report.entries.length, 4);
      assert.equal(report.calls_complete, true);
      assert.equal(report.output_structure_valid, true);
      assert.equal(report.references_valid, true);
      assert.equal(report.day_coverage_complete, true);
      assert.equal(report.semantic_accuracy, "not_verified");
      assert.ok(report.segments.every(segment => segment.status === "validated"));
      assert.equal(report.provider.attempts, 6);
      assert.ok(report.provider.calls.filter(call => call.kind === "map").every(call => call.output_chars === 347));
      assert.ok(report.provider.input_chars <= 80000);
      assert.ok(report.provider.output_reserved <= 14000);
      assert.ok(report.retained_output_chars <= 7000);
      assert.equal(result.businessStatus.summary_status, "valid_summary");
      assert.equal(result.businessStatus.summary_input_complete, true);
      assert.equal(result.businessStatus.budget_coverage_complete, false);
      assert.equal(result.businessStatus.business_complete, false);
      assert.equal(result.businessStatus.vector_limit_backlog, 1860);
      assert.match(readFileSync(path, "utf8"), /Long session plus/);
      assert.equal(readFileSync(report.publication.backup, "utf8"), "OLD SUMMARY");
    }, (request, callback) => {
      const prompt = request.body.messages[0].content;
      const object = prompt.includes("\nSOURCE\n") ? mapResponseOfSize(prompt, 347) : response(prompt);
      if (prompt.includes("\nSOURCE\n")) {
        const header = prompt.split("\nSOURCE\n")[0];
        assert.ok(header.length + 8 <= 800);
        assert.match(header, /Exactly one evidence/);
        assert.ok(object.evidence[0].text.length > 160);
      } else {
        const other = JSON.parse(prompt.split("\nOTHER\n")[1]);
        assert.equal(other.length, 3);
        assert.deepEqual(other.map(item => item.text.length), [366,356,360]);
      }
      assert.ok(JSON.stringify(object).length <= (prompt.includes("\nSOURCE\n") ? 600 : 4000));
      emitJson(callback, completion(JSON.stringify(object)), { bytewise: true });
    });
  }, { entries });
});

for (const kind of ["content", "response_envelope", "provider_tokens"]) {
  test("real nightly/HTTPS " + kind + " failure preserves old episode and marks first map failed", async () => {
    await fixture(async ({ read, path }) => {
      const logs = read({ targetDate: DATE });
      await withFakeHttps(async requests => {
        const result = await summarizeLongSession(logs, options(logs, undefined));
        assert.equal(result.ok, false);
        assert.equal(result.report.reason, "output_budget");
        assert.equal(result.report.failure_stage, "map_request");
        assert.equal(result.report.segments[0].status, "failed");
        assert.equal(result.report.segments[0].reason, "output_budget");
        assert.ok(result.report.segments.slice(1).every(part => part.status === "pending"));
        assert.equal(result.report.source_range_coverage, true);
        assert.equal(result.report.calls_complete, false);
        assert.equal(result.report.day_coverage_complete, false);
        assert.equal(result.report.published, false);
        assert.equal(requests.length, 1);
        assert.equal(result.report.provider.attempts, 1);
        assert.equal(result.report.provider.calls[0].output_budget_kind, kind);
        assert.equal(readFileSync(path, "utf8"), "OLD SUMMARY");
      }, (_, callback) => emitJson(callback, kind === "response_envelope"
        ? completion("short", "stop", { reasoning_content: "private".repeat(2000) })
        : kind === "provider_tokens" ? completion('{"evidence":', "length")
        : completion("x".repeat(601))));
    });
  });
}


for (const size of [347, 600, 601]) {
  test("real map JSON of " + size + " UTF-16 units obeys the total response cap without a text sublimit", async () => {
    await fixture(async ({ read, path }) => {
      const logs = read({ targetDate: DATE });
      await withFakeHttps(async requests => {
        const result = await summarizeLongSession(logs, options(logs, undefined));
        if (size <= 600) {
          assert.equal(result.ok, true);
          assert.equal(requests.length, 6);
          assert.equal(result.report.calls_complete, true);
          assert.equal(result.report.references_valid, true);
          assert.equal(result.report.day_coverage_complete, true);
          assert.equal(result.report.semantic_accuracy, "not_verified");
          assert.ok(result.report.provider.calls.filter(call => call.kind === "map")
            .every(call => call.output_chars === size && call.output_limit_chars === 600));
          assert.equal(result.report.published, true);
          assert.equal(readFileSync(result.report.publication.backup, "utf8"), "OLD SUMMARY");
        } else {
          assert.equal(result.ok, false);
          assert.equal(requests.length, 1);
          assert.equal(result.report.reason, "output_budget");
          assert.equal(result.report.failure_stage, "map_request");
          assert.equal(result.report.segments[0].status, "failed");
          assert.equal(result.report.provider.attempts, 1);
          assert.equal(result.report.provider.calls[0].output_budget_kind, "content");
          assert.equal(result.report.provider.calls[0].observed_output_chars, 601);
          assert.equal(result.report.provider.calls[0].output_limit_chars, 600);
          assert.equal(result.report.published, false);
          assert.equal(readFileSync(path, "utf8"), "OLD SUMMARY");
        }
      }, (request, callback) => {
        const prompt = request.body.messages[0].content;
        const object = prompt.includes("\nSOURCE\n") ? mapResponseOfSize(prompt, size) : response(prompt);
        emitJson(callback, completion(JSON.stringify(object)), { bytewise: true });
      });
    });
  });
}

for (const scenario of ["multiple_evidence", "extra_keys", "narrow_range", "invalid_unicode"]) {
  test("map contract rejects " + scenario + " before reducer and preserves old episode", async () => {
    await fixture(async ({ read, path }) => {
      const logs = read({ targetDate: DATE });
      let attempts = 0;
      const result = await summarizeLongSession(logs, options(logs, async prompt => {
        attempts++;
        const object = response(prompt);
        if (scenario === "multiple_evidence") object.evidence.push({ ...object.evidence[0] });
        if (scenario === "extra_keys") object.unexpected = true;
        if (scenario === "narrow_range") object.evidence[0].start++;
        if (scenario === "invalid_unicode") object.evidence[0].text = "\ud800";
        const raw = JSON.stringify(object);
        assert.ok(raw.length <= 600);
        return raw;
      }));
      assert.equal(result.ok, false);
      assert.equal(attempts, 1);
      assert.equal(result.report.segments[0].status, "failed");
      assert.equal(result.report.failure_stage, scenario === "narrow_range" ? "map_references" : "map_structure");
      assert.equal(result.report.reason, scenario === "narrow_range" ? "map_reference" : "map_structure");
      assert.equal(result.report.published, false);
      assert.equal(readFileSync(path, "utf8"), "OLD SUMMARY");
    });
  });
}
