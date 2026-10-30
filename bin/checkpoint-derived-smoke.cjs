#!/usr/bin/env node
"use strict";
// Controlled generation/backtrace smoke only. No checkpoint main, DB or publisher.
const fs = require("node:fs"), path = require("node:path");
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const { parseSmartAddEntries } = require("../lib/smart-add-entry-contract.cjs");
const { buildFactInput } = require("../lib/checkpoint/ordinary-summary-facts");
const lab = require("../lib/checkpoint/summary-comparison-lab.cjs");
const archive = require("../lib/checkpoint/summary-memory-archive.cjs");
const { readDerivedSummary } = require("../lib/checkpoint/derived-summary");
const { createCodexSummaryGenerator, resolveCodexSummaryConfig } = require("../lib/checkpoint/codex-summary.cjs");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = code => { throw Object.assign(new Error(code), { code }); };
function parseArgs(args) {
  const options = { execute: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--execute") { options.execute = true; continue; }
    const key = { "--input": "input", "--target-date": "targetDate", "--out": "out", "--response-file": "responseFile" }[arg];
    if (!key || !args[i + 1] || args[i + 1].startsWith("--") || options[key] !== undefined) fail("smoke_arguments");
    options[key] = args[++i];
  }
  return options;
}
function prepare(options) {
  if (!path.isAbsolute(options.input || "") || !/^\d{4}-\d{2}-\d{2}$/.test(options.targetDate || "")) fail("smoke_arguments");
  const stat = fs.lstatSync(options.input);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1048576) fail("smoke_input");
  const bytes = fs.readFileSync(options.input);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const records = parseSmartAddEntries(text).filter(entry => entry.provenance === "session_flush")
    .map(entry => ({ text: entry.text, source: "conversation", provenance: entry.provenance,
      entry_id: entry.entryId, category: entry.category, source_file_sha256: hash(bytes) }));
  if (!records.length) fail("smoke_no_session_flush");
  const input = buildFactInput(records, options.targetDate);
  const request = lab.buildPrompt(input, "direct", { maxInputChars: 200000, summaryMaxChars: 20000 });
  return { bytes, records, input, request, sourceHash: hash(bytes) };
}
function save(directory, name, value) {
  fs.writeFileSync(path.join(directory, name), typeof value === "string" || Buffer.isBuffer(value)
    ? value : JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
async function runSmoke(options, { env = process.env, generator } = {}) {
  const data = prepare(options), cfg = resolveCodexSummaryConfig(env);
  const plan = { status: "PLAN_ONLY", target_date: options.targetDate, source_sha256: data.sourceHash,
    record_count: data.records.length, unit_count: data.input.sources.reduce((n, s) => n + s.units.length, 0),
    input_chars: data.request.inputChars, requested_model: cfg.model, reasoning_effort: cfg.effort,
    semantic_correctness: "NOT_CERTIFIED", generator_invocations: 0,
    response_replay: Boolean(options.responseFile),
    production_publications: 0, database_operations: 0, deployments: 0 };
  if (!options.execute) return plan;
  if (!path.isAbsolute(options.out || "")) fail("smoke_output_required");
  // New directory only. No overwrite and no cleanup of prior evidence.
  fs.mkdirSync(options.out, { mode: 0o700 });
  const captured = { stdout: [], stderr: [] }, lengths = { stdout: 0, stderr: 0 };
  const spawnCapture = (binary, args, spawnOptions) => {
    const child = spawn(binary, args, spawnOptions);
    for (const channel of ["stdout", "stderr"]) child[channel].on("data", chunk => {
      const bytes = Buffer.from(chunk), cap = channel === "stdout" ? cfg.maxOutputBytes : 65536;
      const remaining = Math.max(0, cap - lengths[channel]);
      if (remaining) captured[channel].push(bytes.subarray(0, remaining));
      lengths[channel] += bytes.length;
    });
    return child;
  };
  let result = { ...plan, status: "FAILED" };
  try {
    save(options.out, "source.md", data.bytes);
    save(options.out, "input-records.json", data.records);
    save(options.out, "request.json", data.request);
    save(options.out, "plan.json", plan);
    let reply;
    if (options.responseFile) {
      if (!path.isAbsolute(options.responseFile)) fail("smoke_response_file");
      const bytes = fs.readFileSync(options.responseFile);
      if (bytes.length > cfg.maxOutputBytes) fail("smoke_response_budget");
      reply = JSON.parse(bytes.toString("utf8"));
      result.response_file_sha256 = hash(bytes);
      // Preserve the response bytes as well as the parsed object; never repair it.
      save(options.out, "replayed-response.json", bytes);
    } else {
      const invoke = generator || createCodexSummaryGenerator({ env, spawnImpl: spawnCapture });
      result.generator_invocations = 1;
      reply = await invoke(data.request);
    }
    save(options.out, "response.json", reply);
    if (hash(fs.readFileSync(options.input)) !== data.sourceHash) fail("smoke_source_changed");
    const candidate = archive.createArchive({ rawLogs: data.records, targetDate: options.targetDate,
      summary: reply.summary, generator: { ...reply.generator,
        prompt_sha256: hash(JSON.stringify({ system: data.request.system, prompt: data.request.prompt })),
        protocol_version: lab.VERSION }, qualityFindings: [
        "Semantic quality not independently evaluated by this smoke.",
        "Dialogue records do not independently verify tool execution.",
        ...(reply.qualityFindings || []),
      ], summaryMaxChars: 20000 });
    const directory = path.join(options.out, "archives"), stored = archive.persistArchive(directory, candidate);
    const resolved = readDerivedSummary(stored.archive_id, { directory, purpose: "acceptance" });
    let occurrences = 0;
    const units = new Set();
    for (const item of resolved.items) {
      occurrences += item.item.evidence.length + item.item.corrects.length;
      for (const source of item.sources) {
        units.add(source.locator.unit_id);
        const original = archive.readOriginalRecord(directory, stored.archive_id, source.locator.source_id);
        if (original.record.text.slice(source.locator.start, source.locator.end) !== source.quote) fail("smoke_backtrace");
      }
    }
    save(options.out, "resolved-items.json", resolved);
    result = { ...result, status: "PASS_TRACEABILITY_NOT_SEMANTICS", archive_id: stored.archive_id,
      source_unchanged: true, item_count: resolved.items.length, body_chars: candidate.payload.body.length,
      citation_occurrences: occurrences, unique_cited_units: units.size,
      generator: reply.generator, quality_findings: candidate.payload.quality_findings };
  } catch (cause) {
    result.error = typeof cause.code === "string" ? cause.code : "smoke_failed";
  } finally {
    for (const channel of ["stdout", "stderr"]) save(options.out, "raw-" + channel + ".log",
      Buffer.concat(captured[channel]));
    save(options.out, "result.json", result);
  }
  return result;
}
if (require.main === module) {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (cause) { console.error(cause.code || "smoke_arguments"); process.exitCode = 1; }
  if (options) runSmoke(options).then(result => {
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "FAILED") process.exitCode = 1;
  }).catch(cause => { console.error(cause.code || "smoke_failed"); process.exitCode = 1; });
}
module.exports = { parseArgs, prepare, runSmoke };
