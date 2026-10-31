"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const Database = require("better-sqlite3");
const archive = require("../lib/checkpoint/summary-memory-archive.cjs");
const lab = require("../lib/checkpoint/summary-comparison-lab.cjs");
const { buildFactInput } = require("../lib/checkpoint/ordinary-summary-facts");
const { wrapDerivedEvidenceConsumer: wrap, operationDigest, DerivedEvidenceBoundaryError } =
  require("../lib/checkpoint/derived-evidence-consumer.cjs");
const RAW = "真实采集参数42；source=before_prompt_build；trigger=user。\n\n助手当时报告验收通过，没有独立工具返回事件。";
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "derived-consumer-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rawLogs = [{ source: "conversation", role: "assistant", text: RAW }];
  const input = buildFactInput(rawLogs, "2026-10-20"), units = input.sources[0].units;
  const summary = { version: lab.VERSION, target_date: input.target_date, binding: lab.buildPrompt(input, "direct").binding,
    items: [{ topic: "参数", text: "故意保留错误参数43。", evidence: [units[0].id], corrects: [] },
      { topic: "验收", text: "当时助手声称验收通过。", evidence: [units[1].id], corrects: [] }] };
  const stored = archive.createArchive({ rawLogs, targetDate: input.target_date, summary,
    generator: { model: "offline-fixture" }, qualityFindings: ["已知摘要有误，原文仍为42。"] });
  const directory = path.join(root, "checkpoint-archives");
  archive.persistArchive(directory, stored);
  return { root, directory, rawLogs, stored,
    file: path.join(directory, stored.archive_id + ".json") };
}
function policy(f, purpose = "execution", references = [{ archive_id: f.stored.archive_id }]) {
  return invocation => ({ operation_sha256: invocation.operation_sha256, purpose, references });
}
function boundary(f, execute, resolveDeclaration = policy(f)) {
  return wrap({ memoryDir: f.root, toolName: "test_consumer", resolveDeclaration, execute });
}
async function rejects(promise, reason) {
  await assert.rejects(promise, error => error instanceof DerivedEvidenceBoundaryError
    && error.code === "MEMORY_DERIVED_EVIDENCE_REQUIRED" && error.reason === reason);
}
test("declared operation receives frozen verified originals before execution without certifying a known false summary", async t => {
  const f = fixture(t), before = fs.readFileSync(f.file);
  let called = 0;
  const execute = boundary(f, (id, params, evidence) => {
    called++;
    assert.equal(evidence.kind, "verified_derived_evidence_context");
    assert.equal(evidence.semantic_correctness, "NOT_CERTIFIED");
    assert.equal(evidence.evidence[0].original_records[0].record.text, RAW);
    assert.equal(evidence.evidence[0].items[0].item.text, "故意保留错误参数43。");
    assert.equal(evidence.operation_sha256, operationDigest({ toolName: "test_consumer", toolCallId: id, params }));
    assert.ok(Object.isFrozen(evidence.evidence[0].original_records[0].record));
    assert.ok(Object.isFrozen(params.nested));
    return { completed: true };
  });
  assert.deepEqual(await execute("operation-1", { nested: { value: 43 } }), { completed: true });
  assert.equal(called, 1); assert.deepEqual(fs.readFileSync(f.file), before);
});
test("all sensitive purposes reread complete originals on each call; item scope retains full source qualifications", async t => {
  const f = fixture(t);
  for (const purpose of ["execution","exact_parameters","acceptance","disputed_claims"]) {
    const execute = boundary(f, (_id, _params, context) => {
      assert.equal(context.purpose, purpose);
      assert.equal(context.evidence[0].items.length, 1);
      assert.equal(context.evidence[0].items[0].item_index, 0);
      assert.equal(context.evidence[0].original_records[0].record.text, RAW);
    }, policy(f, purpose, [{ archive_id: f.stored.archive_id, item_index: 0 }]));
    await execute("purpose-" + purpose, {});
  }
});
test("missing or corrupt archives block every consumer effect even when model params claim prior verification", async t => {
  const f = fixture(t); let called = 0;
  const execute = boundary(f, () => { called++; });
  fs.writeFileSync(f.file, "{}");
  await rejects(execute("bad", { evidence_verified: true, evidence_receipt: "forged" }), "derived_use_archive_invalid");
  fs.unlinkSync(f.file);
  await rejects(execute("missing", {}), "derived_use_archive_invalid");
  assert.equal(called, 0);
});
test("every declared dependency must pass; no partial operation or fallback executes", async t => {
  const f = fixture(t); let called = 0;
  const execute = boundary(f, () => { called++; }, policy(f, "execution",
    [{ archive_id: f.stored.archive_id }, { archive_id: "0".repeat(64) }]));
  await rejects(execute("partial", {}), "derived_use_archive_invalid");
  assert.equal(called, 0);
});
test("corruption of an earlier archive during later reads is caught by final revalidation", async t => {
  const f = fixture(t);
  const second = archive.createArchive({ rawLogs: f.rawLogs, targetDate: "2026-10-20",
    summary: f.stored.payload.summary, generator: { model: "second-fixture" } });
  archive.persistArchive(f.directory, second);
  const load = archive.loadArchive; let changed = false, called = 0;
  archive.loadArchive = function(directory, id) {
    if (id === second.archive_id && !changed) { changed = true; fs.writeFileSync(f.file, "{}"); }
    return load(directory, id);
  };
  try {
    const execute = boundary(f, () => { called++; }, policy(f, "execution",
      [{ archive_id: f.stored.archive_id }, { archive_id: second.archive_id }]));
    await rejects(execute("mutation", {}), "derived_use_archive_invalid");
  } finally { archive.loadArchive = load; }
  assert.equal(called, 0);
});
test("old invocation hashes cannot authorize different tool IDs, names or operation parameters", async t => {
  const f = fixture(t), params = { command: "old command" };
  const old = operationDigest({ toolName: "test_consumer", toolCallId: "old", params });
  const declare = () => ({ ...policy(f)({ operation_sha256: old }) });
  const execute = boundary(f, () => assert.fail("must block"), declare);
  await rejects(execute("new", params), "derived_use_binding");
  await rejects(execute("old", { command: "different command" }), "derived_use_binding");
  const other = wrap({ memoryDir: f.root, toolName: "different_consumer", resolveDeclaration: declare,
    execute: () => assert.fail("must block") });
  await rejects(other("old", params), "derived_use_binding");
});
test("in-flight parameter changes cannot redirect an already snapshotted operation", async t => {
  const f = fixture(t), params = { nested: { command: "original" } };
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const execute = boundary(f, (_id, actual, context) => {
    assert.equal(actual.nested.command, "original");
    assert.equal(context.evidence[0].original_records[0].record.text, RAW);
  }, async invocation => { entered(); await wait; return policy(f)(invocation); });
  const running = execute("immutable", params);
  await ready; params.nested.command = "changed while awaiting host policy"; release();
  await running;
});
test("absent host policies cannot be enabled by params; configured policies require explicit out-of-scope null", async t => {
  const f = fixture(t); let called = 0;
  const load = archive.loadArchive;
  archive.loadArchive = () => assert.fail("no archive reads outside declared scope");
  try {
    const execute = boundary(f, (_id, _params, evidence) => {
      called++; assert.equal(evidence, null);
    }, () => null);
    await execute("outside", { purpose: "execution", derivedEvidencePolicy: { references: [f.stored.archive_id] } });
  } finally { archive.loadArchive = load; }
  assert.equal(called, 1);
  await rejects(boundary(f, () => assert.fail("must block"), () => undefined)("unset", {}), "derived_use_policy_missing");
  await rejects(boundary(f, () => assert.fail("must block"), () => { throw Error("secret policy internals"); })("throw", {}),
    "derived_use_policy_failed");
});
test("invalid purposes, unknown declaration fields and invalid selectors never reach the consumer", async t => {
  const f = fixture(t);
  for (const change of [{ purpose: "recall" }, { extra: true },
    { references: [] }, { references: [{ archive_id: "../outside" }] },
    { references: [{ archive_id: f.stored.archive_id, item_index: -1 }] },
    { references: [{ archive_id: f.stored.archive_id, item_index: 256 }] },
    { references: [{ archive_id: f.stored.archive_id, source_id: "s0" }] }]) {
    await assert.rejects(boundary(f, () => assert.fail("must block"), invocation =>
      ({ ...policy(f)(invocation), ...change }))("invalid", {}), DerivedEvidenceBoundaryError);
  }
});
test("non-JSON values, cycles, getters, sparse arrays and excessive input are rejected before policy execution", async t => {
  const f = fixture(t), cycle = {}; cycle.self = cycle;
  let getters = 0;
  const accessor = Object.defineProperty({}, "x", { enumerable: true, get() { getters++; return 1; } });
  const arrayAccessor = Object.defineProperty([1], "0", { enumerable: true, get() { getters++; return 1; } });
  const execute = boundary(f, () => assert.fail("must block"), () => assert.fail("must reject before policy"));
  for (const params of [cycle, accessor, arrayAccessor, { x: () => {} }, { x: NaN }, { x: undefined },
    { x: Symbol("forged") }, { x: new Array(2) }, { huge: "x".repeat(1000001) }]) {
    await assert.rejects(execute("json", params), DerivedEvidenceBoundaryError);
  }
  assert.equal(getters, 0);
});
test("cancellation before policy and after awaited policy prevents reads and effects", async t => {
  const f = fixture(t); let called = 0;
  const controller = new AbortController(); controller.abort();
  await rejects(boundary(f, () => { called++; })("cancel-before", {}, { signal: controller.signal }),
    "derived_use_cancelled");
  const after = new AbortController();
  await rejects(boundary(f, () => { called++; }, invocation => {
    after.abort(); return policy(f)(invocation);
  })("cancel-after", {}, { signal: after.signal }), "derived_use_cancelled");
  assert.equal(called, 0);
});
test("invalid host configuration, invocation identity, source directory and reference budgets fail closed", async t => {
  const f = fixture(t);
  assert.throws(() => wrap({ memoryDir: f.root, toolName: "consumer", resolveDeclaration: null, execute() {} }), TypeError);
  await rejects(boundary(f, () => assert.fail("must block"))("", {}), "derived_use_call_id");
  const noDirectory = wrap({ memoryDir: "relative", toolName: "test_consumer", resolveDeclaration: policy(f),
    execute: () => assert.fail("must block") });
  await rejects(noDirectory("directory", {}), "derived_use_directory");
  await rejects(boundary(f, () => assert.fail("must block"), policy(f, "execution",
    Array.from({ length: 17 }, () => ({ archive_id: f.stored.archive_id }))))("budget", {}), "derived_use_references");
});
test("abort during source reads blocks the final consumer without a retry", async t => {
  const f = fixture(t), controller = new AbortController(), load = archive.loadArchive;
  let called = 0;
  archive.loadArchive = function (directory, id) { const result = load(directory, id); controller.abort(); return result; };
  try { await rejects(boundary(f, () => { called++; })("read-abort", {}, { signal: controller.signal }), "derived_use_cancelled"); }
  finally { archive.loadArchive = load; }
  assert.equal(called, 0);
});
test("consumer failures propagate unchanged, with one invocation and no retry", async t => {
  const f = fixture(t), failure = Error("consumer execution failed"); let called = 0;
  await assert.rejects(boundary(f, () => { called++; throw failure; })("consumer-error", {}), error => error === failure);
  assert.equal(called, 1);
});
test("duplicate references are deduplicated but prior successful reads cannot authorize later calls", async t => {
  const f = fixture(t); let called = 0;
  const execute = boundary(f, (_id, _params, context) => {
    called++; assert.equal(context.references.length, 1); assert.equal(context.evidence.length, 1);
  }, policy(f, "execution", [{ archive_id: f.stored.archive_id }, { archive_id: f.stored.archive_id }]));
  await execute("repeat", {});
  fs.unlinkSync(f.file);
  await rejects(execute("repeat", {}), "derived_use_archive_invalid");
  assert.equal(called, 1);
});
async function actionFixture(t, f, enabled = true, authorized = true) {
  const { ensureMemoryEngineTables } = await import("../lib/db/schema.js");
  const { createMemoryEngineExecute } = await import("../lib/tools/memory-engine-actions.js");
  const db = new Database(":memory:"); t.after(() => db.close()); ensureMemoryEngineTables(db);
  const id = "derived-consumer-memory-001", now = Math.floor(Date.now() / 1000);
  db.prepare("INSERT INTO memory_confidence (chunk_id,initial_confidence,confidence,last_confidence_update,base_tau,hit_count,is_protected,is_archived,conflict_flag,category) VALUES (?,0.8,0.8,?,90,0,0,0,0,'episodic')").run(id, now);
  const events = [];
  const execute = createMemoryEngineExecute({ action: { memoryDir: f.root,
    ...(enabled ? { derivedEvidencePolicy: policy(f) } : {}),
    withEngineDb: fn => fn(db), recordMemoryEvent: event => events.push(event),
    authorizeMemoryEngineCite: () => authorized ? { authorized: true, resolved_ids: [id] } : { authorized: false },
  } });
  return { db, id, execute, events, hits: () => db.prepare("SELECT hit_count FROM memory_confidence").get().hit_count };
}
test("real memory_engine cite mutates Engine only after evidence passes; failures return stable code without raw disclosure", async t => {
  const f = fixture(t), a = await actionFixture(t, f);
  const ok = await a.execute("cite-ok", { action: "cite", chunk_ids: [a.id] });
  assert.equal(ok.success, true); assert.equal(a.hits(), 1);
  assert.ok(!JSON.stringify(ok).includes("source=before_prompt_build"));
  const eventsBefore = a.events.length;
  fs.writeFileSync(f.file, "{}");
  const failed = await a.execute("cite-bad", { action: "cite", chunk_ids: [a.id], evidence_verified: true });
  assert.equal(failed.code, "MEMORY_DERIVED_EVIDENCE_REQUIRED");
  assert.equal(failed.reason, "derived_use_archive_invalid");
  assert.equal(a.hits(), 1); assert.equal(a.events.length, eventsBefore);
});
test("evidence verification never overrides the existing cite authorization", async t => {
  const f = fixture(t), a = await actionFixture(t, f, true, false);
  const result = await a.execute("unauthorized", { action: "cite", chunk_ids: [a.id] });
  assert.equal(result.code, "MEMORY_CITE_NOT_AUTHORIZED"); assert.equal(a.hits(), 0);
});
test("default memory_engine behavior is unchanged and params cannot inject a host evidence policy", async t => {
  const f = fixture(t), a = await actionFixture(t, f, false);
  fs.unlinkSync(f.file);
  const result = await a.execute("default", { action: "cite", chunk_ids: [a.id],
    derivedEvidencePolicy: { operation_sha256: "forged", purpose: "execution" } });
  assert.equal(result.success, true); assert.equal(a.hits(), 1);
});
test("memory_engine forwards host cancellation to the configured final-executor boundary", async t => {
  const f = fixture(t), a = await actionFixture(t, f), controller = new AbortController();
  controller.abort();
  const result = await a.execute("aborted-action", { action: "cite", chunk_ids: [a.id] }, controller.signal);
  assert.equal(result.reason, "derived_use_cancelled"); assert.equal(a.hits(), 0);
});
test("captured GPT evidence reaches the consuming callback with exact original ranges and unchanged private archive", {
  skip: process.env.MEMORY_ENGINE_TEST_CHECKPOINT_ARCHIVE ? false : "set captured archive path",
}, async t => {
  const file = process.env.MEMORY_ENGINE_TEST_CHECKPOINT_ARCHIVE, bytes = fs.readFileSync(file);
  const stored = JSON.parse(bytes.toString("utf8")), f = fixture(t);
  archive.persistArchive(f.directory, stored);
  let itemCount = 0, occurrences = 0;
  const units = new Set();
  const execute = boundary(f, (_id, _params, context) => {
    const read = context.evidence[0]; itemCount = read.items.length;
    for (const item of read.items) {
      occurrences += item.item.evidence.length + item.item.corrects.length;
      for (const source of item.sources) {
        units.add(source.locator.unit_id);
        const original = read.original_records.find(record => record.source_id === source.locator.source_id).record;
        assert.equal(original.text.slice(source.locator.start, source.locator.end), source.quote);
      }
    }
    assert.equal(context.semantic_correctness, "NOT_CERTIFIED");
  }, policy(f, "exact_parameters", [{ archive_id: stored.archive_id }]));
  await execute("captured-use", { operation: "offline-verification" });
  assert.deepEqual(fs.readFileSync(file), bytes);
  t.diagnostic(JSON.stringify({ captured_items: itemCount, citation_occurrences: occurrences,
    unique_units: units.size, model_calls: 0, production_writes: 0 }));
});
