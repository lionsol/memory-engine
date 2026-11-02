"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { EventEmitter } = require("node:events"), { PassThrough, Writable } = require("node:stream");
const cli = require("../lib/checkpoint/codex-summary.cjs");
const lab = require("../lib/checkpoint/summary-comparison-lab.cjs");
const { buildFactInput } = require("../lib/checkpoint/ordinary-summary-facts");
const DATE = "2026-10-20";
const inputEnvelope = stdin => JSON.parse(stdin.slice(stdin.indexOf("\n") + 1));
const logs = () => [{ source: "conversation", role: "assistant",
  text: "助手报告：source=before_prompt_build；trigger=user；valid=true。😀" }];
function request() { return lab.buildPrompt(buildFactInput(logs(), DATE), "direct", { summaryMaxChars: 20000 }); }
function summary(stdin) {
  const packet = JSON.parse(inputEnvelope(stdin).source_packet);
  return { version: packet.version, target_date: packet.target_date, binding: packet.binding,
    items: [{ topic: "自然样本", text: "助手报告样本有效，资格需回查原文。",
      evidence: [packet.SOURCE.sources[0].units[0][0]], corrects: [] }] };
}
const start = () => [{ type: "thread.started", thread_id: "offline-thread" }, { type: "turn.started" }];
const message = value => ({ type: "item.completed",
  item: { id: "answer", type: "agent_message", text: typeof value === "string" ? value : JSON.stringify(value) } });
const completed = () => ({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
const events = stdin => [...start(), message(summary(stdin)), completed()];
function harness(t, behavior, extraEnv = {}, killBehavior) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "checkpoint-codex-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { PATH: "/explicit/bin", HOME: "/selected-home", CODEX_HOME: "/selected-codex-home",
    HTTPS_PROXY: "http://proxy-secret@fixture:7890", OPENAI_API_KEY: "must-not-forward",
    DEEPSEEK_API_KEY: "must-not-forward", NODE_OPTIONS: "must-not-forward", ...extraEnv };
  const invocations = [], kills = [];
  const spawnImpl = (binary, args, options) => {
    const child = new EventEmitter(); child.pid = 12345;
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.unref = () => {};
    let stdin = "", closed = false;
    const close = (code = 0, signal = null) => {
      if (closed) return; closed = true; child.emit("close", code, signal);
    };
    const lines = rows => rows.forEach(row => child.stdout.write(JSON.stringify(row) + "\n"));
    child.stdin = new Writable({ write(chunk, _, next) { stdin += chunk.toString(); next(); },
      final(next) { next(); queueMicrotask(() => {
        try { (behavior || ((c) => { c.lines(events(c.stdin)); c.close(); }))({ child, stdin, close, lines, options }); }
        catch (cause) { t.diagnostic(cause.stack); child.emit("error", cause); close(1); }
      }); } });
    child.testClose = close;
    invocations.push({ binary, args, options, child, input: () => stdin });
    return child;
  };
  const signalChildImpl = (child, signal) => {
    kills.push(signal);
    if (killBehavior) killBehavior(child, signal);
    else queueMicrotask(() => child.testClose(null, signal));
  };
  const options = { env, spawnImpl, signalChildImpl, tempRoot: root, killGraceMs: 10 };
  return { root, env, options, invocations, kills, generate: cli.createCodexSummaryGenerator(options) };
}
test("host-selected scoped summary schema preserves condition ownership through CLI and deterministic projection", async t => {
  const compose = require("../lib/checkpoint/summary-claim-compose.cjs");
  const source = buildFactInput(logs(), DATE);
  const f = harness(t, ({ stdin, lines, close }) => {
    const p = JSON.parse(inputEnvelope(stdin).source_packet), id = p.SOURCE.sources[0].units[0][0];
    lines([...start(), message({ version: p.version, target_date: p.target_date, binding: p.binding,
      items: [{ scope: "本轮自然样本", conclusion: "助手报告资格已记录",
        conditions: [{ scope: "自然样本", text: "valid=true", evidence: [id] }],
        unresolved: [], evidence: [id], corrects: [] }] }), completed()]);
    close();
  });
  const generate = cli.createCodexSummaryGenerator({ ...f.options, outputContract: "scoped_summary" });
  const reply = await generate(request()), projected = compose.projectScopedSummary(source, reply.summary);
  const args = f.invocations[0].args, selected = args[args.indexOf("--output-schema") + 1];
  assert.equal(path.basename(selected), "scoped-summary-schema.json");
  assert.equal(reply.generator.output_contract, "scoped_summary");
  assert.equal(reply.generator.schema_sha256, require("node:crypto").createHash("sha256").update(fs.readFileSync(selected)).digest("hex"));
  assert.equal(f.invocations.length, 1); assert.equal(reply.generator.tool_events, 0);
  assert.match(projected.body, /条件（自然样本）：valid=true/);
  assert.equal(projected.validation.scoped_fields_preserved, true);
});
test("host-selected claim inventory schema reaches the isolated CLI and literal-evidence projector", async t => {
  const claims = require("../lib/checkpoint/summary-claim-ledger.cjs");
  const source = buildFactInput(logs(), DATE);
  const f = harness(t, ({ stdin, lines, close }) => {
    const p = JSON.parse(inputEnvelope(stdin).source_packet), row = p.SOURCE.sources[0].fragments[0];
    lines([...start(), message({ version: p.version, target_date: p.target_date, binding: p.binding,
      claims: [{ id: "c1", scope: "本次观测", kind: "report", text: "样本资格需按原文核对",
        quotes: [{ fragment: row[0], quote: row[4] }], conditions: [], corrects: [] }],
      dispositions: [] }), completed()]);
    close();
  });
  const generate = cli.createCodexSummaryGenerator({ ...f.options, outputContract: "claim_ledger" });
  let metadata;
  const r = await claims.runClaimInventory(source, async request => {
    const reply = await generate(request); metadata = reply.generator; return JSON.stringify(reply.summary);
  });
  assert.equal(r.status, "READY_FOR_REVIEW"); assert.equal(r.semantic_correctness, "NOT_CERTIFIED");
  const args = f.invocations[0].args, selected = args[args.indexOf("--output-schema") + 1];
  assert.equal(path.basename(selected), "claim-ledger-schema.json");
  assert.equal(metadata.output_contract, "claim_ledger");
  assert.equal(metadata.schema_sha256, require("node:crypto").createHash("sha256").update(fs.readFileSync(selected)).digest("hex"));
  assert.equal(metadata.tool_events, 0); assert.equal(f.invocations.length, 1);
});
test("host-selected fragment-only schema uses ID evidence and retains the explicit experimental boundary", async t => {
  const claims = require("../lib/checkpoint/summary-claim-ledger.cjs");
  const source = buildFactInput(logs(), DATE);
  const f = harness(t, ({ stdin, lines, close }) => {
    const p = JSON.parse(inputEnvelope(stdin).source_packet), row = p.SOURCE.sources[0].fragments[0];
    lines([...start(), message({ version: p.version, target_date: p.target_date, binding: p.binding,
      claims: [{ id: "c1", scope: "本次观测", kind: "report", text: "资格需按原文核对",
        evidence: [row[0]], conditions: [], corrects: [] }], dispositions: [] }), completed()]);
    close();
  });
  const generate = cli.createCodexSummaryGenerator({ ...f.options, outputContract: "claim_ledger_fragments" });
  const r = await claims.runClaimInventory(source, async request => JSON.stringify((await generate(request)).summary),
    { referenceMode: "fragment_ids" });
  assert.equal(r.status, "READY_FOR_REVIEW"); assert.equal(r.evidence_origin, "PROGRAM_COPIED_FULL_FRAGMENTS");
  const args = f.invocations[0].args;
  assert.equal(path.basename(args[args.indexOf("--output-schema") + 1]), "claim-ledger-fragments-schema.json");
});
test("unknown host output schemas refuse before spawn and cannot become arbitrary file paths", async t => {
  const f = harness(t);
  for (const outputContract of ["unknown", "../arbitrary.json", null]) {
    const generate = cli.createCodexSummaryGenerator({ ...f.options, outputContract });
    await assert.rejects(generate(request()), { code: "derived_cli_output_contract" });
  }
  assert.equal(f.invocations.length, 0); assert.deepEqual(fs.readdirSync(f.root), []);
});
test("request data cannot select an experimental schema and default summary metadata remains unchanged", async t => {
  const f = harness(t), r = await f.generate({ ...request(), outputContract: "claim_ledger" });
  const args = f.invocations[0].args;
  assert.equal(path.basename(args[args.indexOf("--output-schema") + 1]), "derived-summary-schema.json");
  assert.equal(Object.hasOwn(r.generator, "output_contract"), false);
});
test("CLI uses explicit model/effort, stdin, empty private cwd and account/proxy allowlist without a shell", async t => {
  const f = harness(t, ({ child, stdin, close, options }) => {
    assert.deepEqual(fs.readdirSync(options.cwd), []);
    assert.equal(fs.statSync(options.cwd).mode & 0o777, 0o700);
    const bytes = Buffer.from(events(stdin).map(JSON.stringify).join("\n") + "\n");
    // Exercise streaming UTF-8 across every byte boundary.
    for (const byte of bytes) child.stdout.write(Buffer.from([byte]));
    close();
  });
  const req = request(), r = await f.generate(req), call = f.invocations[0];
  assert.equal(call.options.shell, false);
  assert.equal(call.options.detached, process.platform !== "win32");
  assert.equal(call.args.at(-1), "-");
  assert.equal(call.args[call.args.indexOf("--model") + 1], "gpt-6-luna");
  assert.ok(call.args.includes('model_reasoning_effort="xhigh"'));
  for (const flag of ["--ignore-user-config", "--ignore-rules", "--ephemeral", "--no-daemon"]) assert.ok(call.args.includes(flag));
  assert.equal(call.options.env.HTTPS_PROXY, f.env.HTTPS_PROXY);
  assert.equal(call.options.env.CODEX_HOME, f.env.CODEX_HOME);
  for (const key of ["DEEPSEEK_API_KEY", "OPENAI_API_KEY", "NODE_OPTIONS"]) assert.equal(call.options.env[key], undefined);
  assert.ok(!call.args.some(arg => arg.includes("source=before_prompt_build")));
  assert.equal(inputEnvelope(call.input()).instructions, req.system);
  assert.equal(inputEnvelope(call.input()).source_packet, req.prompt);
  assert.equal(r.generator.tool_events, 0); assert.equal(r.generator.process_exit_code, 0);
  assert.equal(r.generator.model_identity, "requested_not_provider_verified");
  assert.deepEqual(r.generator.proxy_env_keys, ["HTTPS_PROXY"]);
  assert.ok(!JSON.stringify(r).includes("proxy-secret"));
  assert.equal(lab.validateSummary(buildFactInput(logs(), DATE), r.summary, 20000).validation.reference_ids_valid, true);
  assert.deepEqual(fs.readdirSync(f.root), []);
});
test("explicit model, effort and binary overrides are preserved verbatim without model substitution", async t => {
  const f = harness(t, null, { MEMORY_ENGINE_CHECKPOINT_CODEX_MODEL: "explicit-model",
    MEMORY_ENGINE_CHECKPOINT_CODEX_EFFORT: "high", MEMORY_ENGINE_CHECKPOINT_CODEX_BINARY: "/path with spaces/codex" });
  const r = await f.generate(request());
  assert.equal(f.invocations[0].binary, "/path with spaces/codex");
  assert.equal(r.generator.model, "explicit-model"); assert.equal(r.generator.reasoning_effort, "high");
});
test("invalid configuration refuses before spawn rather than silently selecting another model", async t => {
  for (const env of [
    { MEMORY_ENGINE_CHECKPOINT_CODEX_MODEL: "--model=other" },
    { MEMORY_ENGINE_CHECKPOINT_CODEX_EFFORT: "unknown" },
    { MEMORY_ENGINE_CHECKPOINT_CODEX_TIMEOUT_MS: "NaN" },
    { MEMORY_ENGINE_CHECKPOINT_CODEX_MAX_OUTPUT_BYTES: "0" },
    { MEMORY_ENGINE_CHECKPOINT_CODEX_BINARY: "-unsafe" },
  ]) {
    const f = harness(t, null, env);
    await assert.rejects(f.generate(request()), { code: "derived_cli_config" });
    assert.equal(f.invocations.length, 0); assert.deepEqual(fs.readdirSync(f.root), []);
  }
});
test("tool, file, browser, MCP, plan and unknown item types terminate the process and reject the reply", async t => {
  for (const type of ["command_execution", "file_change", "mcp_tool_call", "web_search",
    "plan", "future_tool", "collab_tool_call"]) {
    const f = harness(t, ({ lines }) => lines([...start(), { type: "item.started", item: { type } }]));
    await assert.rejects(f.generate(request()), { code: "derived_cli_tool_event" });
    assert.deepEqual(f.kills, ["SIGTERM"]); assert.deepEqual(fs.readdirSync(f.root), []);
  }
});
test("malformed, incomplete or reordered event streams are never accepted", async t => {
  for (const rows of [
    [], [{ type: "turn.started" }], [...start(), completed()],
    [...start(), message("{}")], [...start(), message("{}"), message("{}"), completed()],
    [...start(), message("{}"), completed(), { type: "turn.started" }],
    [...start(), { type: "unexpected" }],
  ]) {
    const f = harness(t, ({ lines, close }) => { lines(rows); close(); });
    await assert.rejects(f.generate(request())); assert.deepEqual(fs.readdirSync(f.root), []);
  }
});
test("CLI error and turn.failed events reject even if the process eventually returns exit code zero", async t => {
  for (const type of ["error", "turn.failed"]) {
    const f = harness(t, ({ lines, close }) => { lines([...start(), { type, message: "secret diagnostic" }]); close(); });
    await assert.rejects(f.generate(request()), e => e.code === "derived_cli_turn_failed" && !e.message.includes("secret"));
  }
});
test("CLI startup item.error is classified as an initialization failure before turn.started", async t => {
  const f = harness(t, ({ lines }) => lines([
    { type: "thread.started", thread_id: "offline" },
    { type: "item.completed", item: { type: "error", message: "host unavailable" } },
  ]));
  await assert.rejects(f.generate(request()), { code: "derived_cli_turn_failed" });
  const cfg = cli.cliArgs(cli.resolveCodexSummaryConfig({}));
  assert.ok(!cfg.includes("code_mode_host"), "host availability is required by this CLI even with code_mode disabled");
  const disabled = cfg.flatMap((arg, i) => arg === "--disable" ? [cfg[i + 1]] : []);
  assert.ok(disabled.includes("code_mode"));
});
test("nonzero exit after valid output rejects without retry or fallback", async t => {
  const f = harness(t, ({ stdin, lines, close }) => { lines(events(stdin)); close(1); });
  await assert.rejects(f.generate(request()), { code: "derived_cli_exit" });
  assert.equal(f.invocations.length, 1);
});
test("final message must be raw JSON, not fenced text or a repaired response", async t => {
  const f = harness(t, ({ lines, close }) => { lines([...start(), message("invalid JSON"), completed()]); close(); });
  await assert.rejects(f.generate(request()), { code: "derived_cli_summary_json" });
  assert.equal(f.invocations.length, 1);
});
test("non-JSON stdout, invalid UTF-8 and stdout/stderr overflow stop the process", async t => {
  for (const [emit, code] of [
    [child => child.stdout.write("not JSON\n"), "derived_cli_events_json"],
    [child => child.stdout.write(Buffer.from([0xff, 0x0a])), "ERR_ENCODING_INVALID_ENCODED_DATA"],
    [child => child.stdout.write("x".repeat(2000)), "derived_cli_output_budget"],
    [child => child.stderr.write("s".repeat(65537)), "derived_cli_stderr_budget"],
  ]) {
    const f = harness(t, ({ child }) => emit(child), { MEMORY_ENGINE_CHECKPOINT_CODEX_MAX_OUTPUT_BYTES: "1024" });
    await assert.rejects(f.generate(request()), { code });
    assert.deepEqual(f.kills, ["SIGTERM"]); assert.deepEqual(fs.readdirSync(f.root), []);
  }
});
test("spawn failure is bounded and does not expose process environment or raw diagnostics", async t => {
  const f = harness(t);
  const generate = cli.createCodexSummaryGenerator({ ...f.options,
    spawnImpl: () => { throw Error("proxy-secret"); } });
  await assert.rejects(generate(request()), e => e.code === "derived_cli_spawn" && !e.message.includes("secret"));
  assert.deepEqual(fs.readdirSync(f.root), []);
});
test("already-cancelled requests never create a process", async t => {
  const f = harness(t), controller = new AbortController(); controller.abort();
  await assert.rejects(f.generate({ ...request(), signal: controller.signal }), { code: "derived_cli_cancelled" });
  assert.equal(f.invocations.length, 0); assert.deepEqual(fs.readdirSync(f.root), []);
});
test("mid-flight cancellation terminates and waits for process close before rejecting", async t => {
  const controller = new AbortController();
  const f = harness(t, () => controller.abort());
  await assert.rejects(f.generate({ ...request(), signal: controller.signal }), { code: "derived_cli_cancelled" });
  assert.deepEqual(f.kills, ["SIGTERM"]); assert.deepEqual(fs.readdirSync(f.root), []);
});
test("wall deadline escalates to SIGKILL when the process ignores SIGTERM", async t => {
  const f = harness(t, () => {}, { MEMORY_ENGINE_CHECKPOINT_CODEX_TIMEOUT_MS: "10" },
    (child, signal) => { if (signal === "SIGKILL") queueMicrotask(() => child.testClose(null, signal)); });
  await assert.rejects(f.generate(request()), { code: "derived_cli_timeout" });
  assert.deepEqual(f.kills, ["SIGTERM", "SIGKILL"]); assert.deepEqual(fs.readdirSync(f.root), []);
});
test("failure to observe termination cannot be reported as a successful timeout cleanup", async t => {
  const f = harness(t, () => {}, { MEMORY_ENGINE_CHECKPOINT_CODEX_TIMEOUT_MS: "5" }, () => {});
  await assert.rejects(f.generate(request()), { code: "derived_cli_termination_unconfirmed" });
  assert.deepEqual(f.kills, ["SIGTERM", "SIGKILL"]);
});
test("reasoning events are allowed, but only one completed final answer is accepted", async t => {
  const f = harness(t, ({ lines, stdin, close }) => {
    lines([...start(), { type: "item.started", item: { id: "r", type: "reasoning" } },
      { type: "item.completed", item: { id: "r", type: "reasoning", text: "opaque" } },
      message(summary(stdin)), completed()]); close();
  });
  const r = await f.generate(request()); assert.equal(r.generator.event_count, 6);
  assert.ok(!JSON.stringify(r).includes("opaque"));
});
test("transport dispatch reaches the real checkpoint archive, episode and original reader using offline CLI events", async t => {
  const f = harness(t);
  const llm = require("../lib/checkpoint/llm");
  const { withRuntime } = require("../lib/checkpoint/runtime");
  const { nightlyCheckpoint } = require("../bin/session-checkpoint");
  const derived = require("../lib/checkpoint/derived-summary");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "checkpoint-cli-entry-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { ...f.env, MEMORY_ENGINE_CHECKPOINT_DERIVED_TRANSPORT: "codex-cli" };
  await withRuntime({ memoryDir: root, workspaceDir: root, checkpointSummaryMode: "derived",
    episodesDir: path.join(root, "episodes"),
    derivedSummaryGenerator: req => llm.generateDerivedSummary(req, { ...f.options, env }),
    llmNightlyExtract: () => { throw Error("legacy must not run"); } }, async () => {
    const r = await nightlyCheckpoint(logs(), { targetDate: DATE, inputReady: true });
    assert.equal(r.status, "valid_summary", r.reason); assert.equal(r.publication.published, true);
    const read = derived.readDerivedSummary(r.archive_id, { purpose: "acceptance" });
    assert.equal(read.generator.transport, "codex-cli"); assert.equal(read.generator.reasoning_effort, "xhigh");
    assert.equal(read.original_records[0].record.text, logs()[0].text);
    assert.match(read.generator.prompt_sha256, /^[a-f0-9]{64}$/);
  });
  assert.equal(f.invocations.length, 1);
});
test("native offline subprocess streams through stdin/stdout and cleans its working directory", async t => {
  const { spawn } = require("node:child_process");
  const f = harness(t);
  let pid;
  const generate = cli.createCodexSummaryGenerator({ env: {}, tempRoot: f.root, spawnImpl: (_, __, options) => {
    const child = spawn(process.execPath, [path.join(__dirname, "checkpoint-codex-child-fixture.cjs")], options);
    pid = child.pid; return child;
  } });
  const result = await generate(request());
  assert.equal(result.generator.tool_events, 0);
  assert.ok(result.summary.items[0].text.includes("非模型结果"));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  assert.deepEqual(fs.readdirSync(f.root), []);
});
test("native process group cancellation closes descendant-held pipes after forced termination", {
  skip: process.platform === "win32" ? "POSIX process-group behavior" : false,
}, async t => {
  const { spawn } = require("node:child_process");
  const f = harness(t);
  let pid;
  const generate = cli.createCodexSummaryGenerator({
    env: { MEMORY_ENGINE_CHECKPOINT_CODEX_TIMEOUT_MS: "300" }, tempRoot: f.root, killGraceMs: 100,
    spawnImpl: (_, __, options) => {
      const child = spawn(process.execPath, [path.join(__dirname, "checkpoint-codex-child-fixture.cjs")],
        { ...options, env: { ...options.env, CHECKPOINT_FIXTURE_MODE: "hang" } });
      pid = child.pid; return child;
    },
  });
  await assert.rejects(generate(request()), { code: "derived_cli_timeout" });
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  assert.deepEqual(fs.readdirSync(f.root), []);
});
test("unknown transport and invalid CLI evidence cannot publish an episode or trigger HTTP fallback", async t => {
  const f = harness(t, ({ stdin, lines, close }) => {
    const output = summary(stdin); output.items[0].evidence = ["missing"];
    lines([...start(), message(output), completed()]); close();
  });
  const llm = require("../lib/checkpoint/llm");
  assert.throws(() => llm.generateDerivedSummary(request(), { env: {
    MEMORY_ENGINE_CHECKPOINT_DERIVED_TRANSPORT: "unknown" } }), { code: "derived_transport_invalid" });
  const { withRuntime } = require("../lib/checkpoint/runtime"), { nightlyCheckpoint } = require("../bin/session-checkpoint");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "checkpoint-cli-invalid-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await withRuntime({ memoryDir: root, workspaceDir: root, checkpointSummaryMode: "derived",
    episodesDir: path.join(root, "episodes"),
    derivedSummaryGenerator: req => llm.generateDerivedSummary(req, { ...f.options,
      env: { ...f.env, MEMORY_ENGINE_CHECKPOINT_DERIVED_TRANSPORT: "codex-cli" } }) }, async () => {
    const r = await nightlyCheckpoint(logs(), { targetDate: DATE, inputReady: true });
    assert.equal(r.episode, false); assert.equal(r.publication.published, false);
    assert.equal(fs.existsSync(path.join(root, "checkpoint-archives")), false);
  });
  assert.equal(f.invocations.length, 1);
});
