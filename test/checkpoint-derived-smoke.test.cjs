"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { parseArgs, prepare, runSmoke } = require("../bin/checkpoint-derived-smoke.cjs");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "checkpoint-smoke-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, "source.md"), out = path.join(root, "new-evidence");
  const text = "# 2026-10-20\n\n## fixture\nCategory: raw_log\nProvenance: session_flush\n\n"
    + "**User:** 请核对部署。\n\n**Assistant:** 旧判断已撤回，实际启用时刻待核实。\n";
  fs.writeFileSync(input, text);
  let calls = 0;
  const generator = async request => {
    calls++;
    const packet = JSON.parse(request.prompt), units = packet.SOURCE.sources[0].units;
    return { summary: { version: packet.version, target_date: packet.target_date, binding: packet.binding,
      items: [{ topic: "部署", text: "启用时刻待核实。", evidence: [units.at(-1)[0]], corrects: [] }] },
      generator: { model: "offline-fixture", transport: "test" }, qualityFindings: ["测试质量备注"] };
  };
  return { root, input, out, text, generator, calls: () => calls,
    options: { input, out, targetDate: "2026-10-20", execute: true } };
}
test("smoke plan reads the supplied sample but performs no generation or filesystem publication", async t => {
  const f = fixture(t), r = await runSmoke({ ...f.options, execute: false }, { generator: f.generator, env: {} });
  assert.equal(r.status, "PLAN_ONLY"); assert.equal(f.calls(), 0);
  assert.equal(r.record_count, 1); assert.equal(fs.existsSync(f.out), false);
  assert.equal(fs.readFileSync(f.input, "utf8"), f.text);
});
test("controlled smoke saves exact source bytes, archives output and resolves original evidence without a publisher", async t => {
  const f = fixture(t), r = await runSmoke(f.options, { generator: f.generator, env: {} });
  assert.equal(r.status, "PASS_TRACEABILITY_NOT_SEMANTICS");
  assert.equal(r.generator_invocations, 1); assert.equal(r.item_count, 1);
  assert.equal(r.production_publications, 0); assert.equal(r.database_operations, 0);
  assert.equal(r.semantic_correctness, "NOT_CERTIFIED"); assert.equal(f.calls(), 1);
  assert.equal(fs.readFileSync(path.join(f.out, "source.md"), "utf8"), f.text);
  const read = JSON.parse(fs.readFileSync(path.join(f.out, "resolved-items.json"), "utf8"));
  assert.ok(read.original_records[0].record.text.includes("实际启用时刻待核实"));
  assert.equal(fs.readFileSync(f.input, "utf8"), f.text);
  assert.ok(r.quality_findings.includes("测试质量备注"));
  assert.equal(fs.statSync(f.out).mode & 0o777, 0o700);
});
test("existing evidence directories are preserved and refuse a second model invocation", async t => {
  const f = fixture(t);
  await runSmoke(f.options, { generator: f.generator, env: {} });
  const original = fs.readFileSync(path.join(f.out, "result.json"));
  await assert.rejects(runSmoke(f.options, { generator: f.generator, env: {} }), { code: "EEXIST" });
  assert.equal(f.calls(), 1); assert.deepEqual(fs.readFileSync(path.join(f.out, "result.json")), original);
});
test("changed source or invalid references retain failure evidence without accepting a summary", async t => {
  for (const scenario of ["changed", "invalid"]) {
    const f = fixture(t);
    const r = await runSmoke(f.options, { env: {}, generator: async request => {
      const reply = await f.generator(request);
      if (scenario === "changed") fs.appendFileSync(f.input, "CONCURRENT");
      else reply.summary.items[0].evidence = ["missing"];
      return reply;
    } });
    assert.equal(r.status, "FAILED"); assert.equal(r.generator_invocations, 1);
    assert.equal(fs.existsSync(path.join(f.out, "archives")), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.out, "result.json"), "utf8")).status, "FAILED");
    assert.equal(fs.readFileSync(path.join(f.out, "source.md"), "utf8"), f.text);
  }
});
test("generator failures are recorded without printing raw diagnostics or trying another provider", async t => {
  const f = fixture(t);
  const r = await runSmoke(f.options, { env: {}, generator: async () => { throw Error("secret diagnostic"); } });
  assert.equal(r.status, "FAILED"); assert.equal(r.error, "smoke_failed");
  assert.ok(!JSON.stringify(r).includes("secret"));
  assert.equal(fs.existsSync(path.join(f.out, "archives")), false);
});
test("saved GPT response can be replayed byte-for-byte with duplicate citations and no generation", async t => {
  const f = fixture(t), data = prepare(f.options), reply = await f.generator(data.request);
  reply.summary.items[0].evidence.push(reply.summary.items[0].evidence[0]);
  const responseFile = path.join(f.root, "response.json"), bytes = Buffer.from(JSON.stringify(reply, null, 2) + "\n");
  fs.writeFileSync(responseFile, bytes);
  const before = f.calls();
  const r = await runSmoke({ ...f.options, responseFile }, { env: {},
    generator: () => { throw Error("replay must not invoke any generator"); } });
  assert.equal(r.status, "PASS_TRACEABILITY_NOT_SEMANTICS");
  assert.equal(r.response_replay, true); assert.equal(r.generator_invocations, 0);
  assert.equal(f.calls(), before); assert.equal(r.citation_occurrences, 2);
  assert.ok(r.quality_findings.some(x => x.includes("Duplicate reference IDs retained")));
  assert.deepEqual(fs.readFileSync(path.join(f.out, "replayed-response.json")), bytes);
  const stored = JSON.parse(fs.readFileSync(path.join(f.out, "archives", r.archive_id + ".json")));
  assert.deepEqual(stored.payload.summary, reply.summary);
});
test("replayed output with the wrong source binding remains rejected without a model request", async t => {
  const f = fixture(t), reply = await f.generator(prepare(f.options).request);
  reply.summary.binding = "wrong";
  const responseFile = path.join(f.root, "response.json");
  fs.writeFileSync(responseFile, JSON.stringify(reply));
  const r = await runSmoke({ ...f.options, responseFile }, { env: {} });
  assert.equal(r.status, "FAILED"); assert.equal(r.error, "comparison_binding");
  assert.equal(r.generator_invocations, 0); assert.equal(fs.existsSync(path.join(f.out, "archives")), false);
});
test("experimental smoke preserves the actual request and its archive prompt hash", async t => {
  const f = fixture(t), options = { ...f.options, promptVariant: "qualifier_review_v1" };
  let sent;
  const r = await runSmoke(options, { env: {}, generator: async request => {
    sent = structuredClone(request); return f.generator(request);
  } });
  assert.equal(r.status, "PASS_TRACEABILITY_NOT_SEMANTICS");
  assert.equal(r.prompt_variant, "qualifier_review_v1");
  assert.equal(r.semantic_correctness, "NOT_CERTIFIED");
  const recorded = JSON.parse(fs.readFileSync(path.join(f.out, "request.json"), "utf8"));
  assert.deepEqual(recorded, sent);
  assert.notEqual(recorded.system, prepare(f.options).request.system);
  const stored = JSON.parse(fs.readFileSync(path.join(f.out, "archives", r.archive_id + ".json"), "utf8"));
  const digest = require("node:crypto").createHash("sha256").update(JSON.stringify({
    system: sent.system, prompt: sent.prompt })).digest("hex");
  assert.equal(stored.payload.generator.prompt_sha256, digest);
  assert.equal(f.calls(), 1);
});
test("unknown experimental smoke variant refuses before generation or evidence-directory creation", async t => {
  const f = fixture(t);
  await assert.rejects(runSmoke({ ...f.options, promptVariant: "unknown" },
    { env: {}, generator: f.generator }), { code: "comparison_input" });
  assert.equal(f.calls(), 0); assert.equal(fs.existsSync(f.out), false);
});
test("CLI parser rejects unknown arguments and incomplete options", () => {
  assert.deepEqual(parseArgs(["--input", "/a", "--target-date", "2026-10-20", "--execute", "--out", "/b"]),
    { input: "/a", targetDate: "2026-10-20", execute: true, out: "/b" });
  assert.equal(parseArgs(["--prompt-variant", "qualifier_review_v1"]).promptVariant, "qualifier_review_v1");
  for (const args of [["--unknown"], ["--input"], ["--input", "--execute"], ["--input", "/a", "--input", "/b"], ["--prompt-variant"], ["--prompt-variant", "baseline", "--prompt-variant", "qualifier_review_v1"]]) {
    assert.throws(() => parseArgs(args), { code: "smoke_arguments" });
  }
});
