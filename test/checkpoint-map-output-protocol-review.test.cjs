// Offline protocol measurements plus actual product-path regression. No real provider calls.
const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { segmentSource, summarizeLongSession, validateEvidence, parseMap } = require("../lib/checkpoint/long-session-summary");
const { LIMITS, createSummaryProvider } = require("../lib/checkpoint/bounded-summary-provider");
const { withRuntime } = require("../lib/checkpoint/runtime");
const { createRawLogReader } = require("../lib/checkpoint/raw-log-assembly");
const budget = require("../lib/checkpoint/raw-log-budget");
const { dedupeCollectedLogs } = require("../lib/checkpoint/raw-log-dedupe");
const { withFakeHttps, emitJson, completion } = require("./checkpoint-summary-http-fixture.cjs");
const DATE = "2026-10-20";
const providers = { primaryProvider: "deepseek", fallbackProvider: "siliconflow" };
const source = "**User:** " + "合".repeat(22922);
const segments = segmentSource(source);
function mapObject(segment, text) {
  return { segment_id: segment.id, source_hash: segment.hash,
    evidence: [{ start: segment.start, end: segment.end, text }] };
}
// Historical hex-tuple comparison; implemented wire uses all digest bytes as base64url.
function tuple(object) {
  const e = object.evidence[0];
  return [object.segment_id, object.source_hash, e.start, e.end, e.text];
}
function compactTuple(object) {
  const row = tuple(object);
  row[1] = Buffer.from(row[1], "hex").toString("base64url");
  return row;
}
function sizedWire(segment, size) {
  const row = compactTuple(mapObject(segment, ""));
  row[4] = "界".repeat(size - JSON.stringify(row).length);
  assert.equal(JSON.stringify(row).length, size);
  return row;
}
function sizedObject(segment, size) {
  const object = mapObject(segment, "");
  const remaining = size - JSON.stringify(object).length;
  assert.ok(remaining > 0);
  object.evidence[0].text = "界".repeat(remaining);
  assert.equal(JSON.stringify(object).length, size);
  return object;
}
function measure() {
  const perSegment = segments.map(segment => {
    const empty = mapObject(segment, "");
    const old = JSON.stringify(empty).length;
    const compact = JSON.stringify(tuple(empty)).length;
    const synthetic665 = sizedObject(segment, 665);
    return { segment_id: segment.id, start: segment.start, end: segment.end,
      historical_object_overhead: old, hex_tuple_overhead: compact,
      saved_metadata_units: old - compact,
      historical_text_capacity_under_600: 600 - old,
      hex_tuple_text_capacity_under_600: 600 - compact,
      synthetic_object_chars: JSON.stringify(synthetic665).length,
      same_text_tuple_chars: JSON.stringify(tuple(synthetic665)).length,
      implemented_tuple_overhead: JSON.stringify(compactTuple(empty)).length,
      implemented_text_capacity_under_600: 600 - JSON.stringify(compactTuple(empty)).length,
      implemented_total_saving: old - JSON.stringify(compactTuple(empty)).length,
      same_text_compact_tuple_chars: JSON.stringify(compactTuple(synthetic665)).length };
  });
  const budgetMatrix = [600, 665, 700, 800].map(mapLimit => ({
    map_limit: mapLimit, five_map_max: 5 * mapLimit,
    map_plus_reduce_retained_max: 5 * mapLimit + LIMITS.summary,
    retained_fits_7000: 5 * mapLimit + LIMITS.summary <= LIMITS.retained,
    all_primary_fallback_reservations: 2 * (5 * mapLimit + LIMITS.summary),
    reservations_fit_14000: 2 * (5 * mapLimit + LIMITS.summary) <= LIMITS.output,
    reducer_components_upper_bound: 5 * mapLimit + LIMITS.otherContext
      + LIMITS.reducerMetadata + LIMITS.reducerPrompt + 33,
    reducer_input_cap: LIMITS.reducerInput,
  }));
  return { status: "OFFLINE_REVIEW", base: "a036902076aea9023f199b28c862752ff03fbe0b",
    implementation: "tuple-sha256-base64url-v1; unchanged limits",
    units: "UTF-16 unless explicitly provider tokens", source_chars: source.length,
    segments: perSegment, budget_matrix: budgetMatrix,
    exact_budget_constants: LIMITS,
    limitations: ["The real 665-unit response body was not retained.",
      "The synthetic lossless comparison does not establish that the real response would fit.",
      "A compact protocol cannot guarantee future model compliance or semantic quality.",
      "Implemented tuple decoding is checked offline; real-provider compliance remains unverified.",
      "Per-component maxima need not be simultaneously reachable; actual reducer prompt is checked.",
      "No provider tokenization, billed tokens, or remote cancellation behavior was measured."],
    runtime_operations: 0, provider_calls: 0 };
}
function entry(text, id) {
  return { text, entryId: id, sessionId: id, provenance: "session_flush",
    category: "raw_log", source: "conversation", sourceKind: "smartAdd",
    role: "other", timestampMs: null, dedupeKey: id };
}
function collectorStats() {
  const chars = () => ({ smartAdd: 0, dbRawLog: 0, resetTranscript: 0 });
  return { droppedDuplicateCount: 0, droppedByBudgetCount: 0, sourceCharCountsAfter: chars(),
    charsBySourceAfterBudget: chars(), charsByRoleAfterBudget: { metadata_header: 0, note: 0, user: 0 } };
}
function makeReader(entries) {
  return createRawLogReader({
    getRuntime: () => ({ timeZone: "Asia/Shanghai", now: () => Date.now() }),
    yesterdayDateStr: () => DATE, getTargetDateRange: () => ({}),
    makeCollectorStats: collectorStats, getBudgetConfig: () => budget.getBudgetConfig({ budgets: {} }),
    collectSmartAddLogs: () => entries.map(item => ({ ...item })),
    collectDbRawLogs: () => [], collectSessionTranscriptLogs: () => [],
    dedupeCollectedLogs, ...budget, inferRoleKey: () => "user", logger: { log() {} },
  });
}
function reducerResponse(prompt) {
  const meta = JSON.parse(prompt.split("\nMETADATA\n")[1].split("\nEVIDENCE\n")[0]);
  const maps = JSON.parse(prompt.split("\nEVIDENCE\n")[1].split("\nOTHER\n")[0]);
  const other = JSON.parse(prompt.split("\nOTHER\n")[1]);
  assert.deepEqual(other.map(e => e.text.length), [366, 356, 360]);
  return { target_date: meta.target_date, covered_segment_ids: meta.covered_segment_ids,
    covered_entry_ids: meta.covered_entry_ids, episode_summary: "Synthetic review summary.",
    references: [...maps.map(m => ({ segment_id: m[0],
      start: m[2], end: m[3] })), ...other.map(e => ({ entry_id: e.id }))] };
}
async function exercise(size, formatWhitespace = false, mutation = null) {
  const root = mkdtempSync(join(tmpdir(), "map-protocol-review-"));
  const episodesDir = join(root, "episodes"); mkdirSync(episodesDir);
  const episode = join(episodesDir, DATE + ".md"); writeFileSync(episode, "OLD REVIEW SUMMARY");
  const entries = [entry(source, "long"), ...[366,356,360].map((n,i) =>
    entry("**User:** " + "他".repeat(n - 10), "other" + i))];
  const read = makeReader(entries);
  const logs = read({ targetDate: DATE });
  assert.equal(logs[0].text.length, 8000);
  assert.equal(logs.segmentedInput.entries[0].text.length, 22932);
  const overrides = { workspaceDir: root, memoryDir: root, episodesDir,
    smartAddDir: join(root,"smart-add"), generatedSmartAddDir: join(root,"generated"),
    sessionsDir: join(root,"sessions"), coreDbPath: join(root,"core.sqlite"),
    engineDbPath: join(root,"engine.sqlite"), configJsonPath: join(root,"none.json"),
    lancedbDir: join(root,"lance"), timeZone: "Asia/Shanghai" };
  try {
    return await withRuntime(overrides, () => withFakeHttps(async requests => {
      const result = await summarizeLongSession(logs, { targetDate: DATE,
        stats: logs.checkpointStats, inputReady: true, providers });
      const successful = size <= 600 && !formatWhitespace && !mutation;
      assert.equal(result.ok, successful);
      assert.equal(result.report.published, successful);
      assert.equal(result.report.day_coverage_complete, successful);
      assert.equal(result.report.semantic_accuracy, "not_verified");
      if (successful) {
        assert.equal(requests.length, 6);
        assert.equal(result.report.reducer_validation.status, "passed");
        assert.equal(readFileSync(result.report.publication.backup,"utf8"), "OLD REVIEW SUMMARY");
      } else {
        assert.equal(requests.length, 1);
        if (mutation) {
          assert.equal(result.report.failure_stage, mutation.code === "map_reference" ? "map_references" : "map_structure");
          assert.equal(result.report.reason, mutation.code);
        } else {
          assert.equal(result.report.failure_stage, "map_request");
          assert.equal(result.report.reason, "output_budget");
          assert.equal(result.report.provider.calls[0].output_budget_kind, "content");
          assert.equal(result.report.provider.calls[0].observed_output_chars, size);
        }
        assert.equal(result.report.reducer_validation.status, "not_started");
        assert.equal(readFileSync(episode,"utf8"), "OLD REVIEW SUMMARY");
      }
      assert.ok(requests.every(r => r.body.max_tokens === (r.body.messages[0].content.includes("\nSOURCE\n") ? 600 : 4000)));
      return { successful, requests: requests.length };
    }, (request, callback) => {
      const prompt = request.body.messages[0].content;
      let raw;
      if (prompt.includes("\nSOURCE\n")) {
        const meta = JSON.parse(prompt.split("\nSOURCE\n")[0].split("\n").at(-1));
        const map = sizedWire({ id: meta.segment_id, hash: Buffer.from(meta.source_hash_b64url, "base64url").toString("hex"), start: meta.start, end: meta.end },
          formatWhitespace ? 600 : size);
        raw = mutation ? mutation.run(map) : JSON.stringify(map) + (formatWhitespace ? " ".repeat(size - 600) : "");
        if (formatWhitespace) {
          assert.equal(JSON.stringify(JSON.parse(raw)).length, 600);
          assert.equal(raw.length, size);
        }
      } else raw = JSON.stringify(reducerResponse(prompt));
      emitJson(callback, completion(raw), { bytewise: true });
    }));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

if (process.argv.includes("--measure")) {
  console.log(JSON.stringify(measure(), null, 2));
} else {
  for (const size of [581, 600, 601, 665]) {
    test("actual reader/HTTPS/summary path obeys raw " + size + "-unit response cap with mixed daily inputs", () => exercise(size));
  }
  test("a formatted 665-unit response still fails even when canonical JSON is 600; no trim-to-fit", () => exercise(665, true));
  test("historical hex-tuple measurement retains ID/hash/range/text without shrinking evidence", () => {
    const measured = measure();
    assert.equal(measured.source_chars, 22932);
    assert.equal(measured.segments.length, 5);
    for (const segment of segments) {
      const object = sizedObject(segment, 665);
      const row = tuple(object);
      assert.equal(row.length, 5);
      const decoded = { segment_id: row[0], source_hash: row[1],
        evidence: [{ start: row[2], end: row[3], text: row[4] }] };
      assert.deepEqual(decoded, object);
      assert.doesNotThrow(() => validateEvidence(decoded, segment, source));
      assert.ok(JSON.stringify(row).length < JSON.stringify(object).length);
    }
  });
  test("full SHA-256 losslessly round-trips all 32 bytes; synthetic old 665 becomes 581 without trimming", () => {
    for (const segment of segments) {
      const old = sizedObject(segment, 665);
      const row = compactTuple(old);
      assert.equal(row[1].length, 43);
      assert.equal(Buffer.from(row[1], "base64url").length, 32);
      assert.equal(JSON.stringify(row).length, 581);
      assert.deepEqual(parseMap(JSON.stringify(row)).object, old);
      assert.deepEqual(sizedWire(segment,581)[4], old.evidence[0].text);
    }
    assert.throws(() => parseMap(JSON.stringify(compactTuple(sizedObject(segments[0],750)))),
      error => error.code === "output_budget");
  });
  const mutations = [
    { name: "extra_element", code: "map_structure", run: row => JSON.stringify([...row,"extra"]) },
    { name: "legacy_object", code: "map_structure", run: row => JSON.stringify({
      segment_id:row[0],source_hash:Buffer.from(row[1],"base64url").toString("hex"),
      evidence:[{start:row[2],end:row[3],text:row[4]}]}) },
    { name: "hash_prefix", code: "map_structure", run: row => { row[1]=row[1].slice(0,22);return JSON.stringify(row); } },
    { name: "hash_padding", code: "map_structure", run: row => { row[1]+="=";return JSON.stringify(row); } },
    { name: "noncanonical_hash_bits", code: "map_structure", run: row => {
      const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      const last=alphabet.indexOf(row[1].at(-1));
      row[1]=row[1].slice(0,-1)+alphabet[last|1];return JSON.stringify(row);
    } },
    { name: "last_hash_byte_changed", code: "map_reference", run: row => {
      const bytes=Buffer.from(row[1],"base64url");bytes[31]^=1;
      row[1]=bytes.toString("base64url");return JSON.stringify(row);
    } },
    { name: "wrong_segment", code: "map_reference", run: row => { row[0]++;return JSON.stringify(row); } },
    { name: "string_segment", code: "map_structure", run: row => { row[0]=String(row[0]);return JSON.stringify(row); } },
    { name: "narrow_range", code: "map_reference", run: row => { row[2]++;return JSON.stringify(row); } },
    { name: "wrong_end", code: "map_reference", run: row => { row[3]++;return JSON.stringify(row); } },
    { name: "invalid_unicode", code: "map_structure", run: row => { row[4]=String.fromCharCode(0xd800);return JSON.stringify(row); } },
    { name: "empty_evidence", code: "map_structure", run: row => { row[4]=" ";return JSON.stringify(row); } },
    { name: "broken_json", code: "output_structure", run: () => "[" },
  ];
  for (const mutation of mutations) {
    test("actual HTTPS -> strict map decoder rejects " + mutation.name + " and preserves old episode",
      () => exercise(300,false,mutation));
  }
  test("Unicode and escaping overhead measurements count serialized UTF-16, not text code points", () => {
    for (const text of ["界".repeat(300), "😀".repeat(150), '"\\\n'.repeat(100)]) {
      const object = mapObject(segments[0], text);
      const raw = JSON.stringify(object);
      const compact = JSON.stringify(tuple(object));
      assert.deepEqual(JSON.parse(compact)[4], text);
      assert.ok(text.isWellFormed());
      assert.equal(raw.length - compact.length,
        JSON.stringify(mapObject(segments[0],"")).length - JSON.stringify(tuple(mapObject(segments[0],""))).length);
    }
    assert.equal("😀".repeat(150).length, 300);
  });
  test("raising all five map caps alone breaks retained and all-fallback reservation envelopes", () => {
    const m = measure().budget_matrix;
    assert.equal(m[0].retained_fits_7000, true);
    assert.equal(m[0].reservations_fit_14000, true);
    for (const row of m.slice(1)) {
      assert.equal(row.retained_fits_7000, false);
      assert.equal(row.reservations_fit_14000, false);
    }
  });
  test("adapter reports provider tokens and character cap separately; output failure charges attempt without fallback", async () => {
    const seen = [];
    const adapter = createSummaryProvider({ providers, transport: async (_, system, opts) => {
      seen.push({ maxTokens: opts.maxTokens, maxResponseChars: opts.maxResponseChars });
      return "界".repeat(665);
    } });
    await assert.rejects(adapter.complete("synthetic", { kind: "map", outputLimit: 600 }),
      error => error.code === "output_budget");
    assert.deepEqual(seen, [{ maxTokens: 600, maxResponseChars: 600 }]);
    assert.equal(adapter.ledger.attempts, 1);
    assert.equal(adapter.ledger.output_reserved, 600);
    assert.equal(adapter.ledger.output_chars, 0);
    assert.equal(adapter.ledger.calls[0].observed_output_chars, 665);
  });
}
