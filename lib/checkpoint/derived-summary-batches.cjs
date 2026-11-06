"use strict";
// Local snapshots and resumable batches. No provider, database or background worker.
const fs = require("node:fs"), path = require("node:path"), { createHash, randomUUID } = require("node:crypto");
const { buildFactInput } = require("./ordinary-summary-facts");
const lab = require("./summary-comparison-lab.cjs");
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const copy = value => JSON.parse(JSON.stringify(value));
const isNoise = unit => ["HEARTBEAT_OK", "[OpenClaw heartbeat poll]"].includes(unit.text.trim());
const fail = code => { throw Object.assign(new Error(code), { code }); };
const ID = /^[a-f0-9]{64}$/;
function file(directory, id) {
  if (!ID.test(id)) fail("derived_snapshot_id");
  return path.join(directory, id + ".json");
}
function writeJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = target + "." + randomUUID() + ".tmp";
  try { fs.writeFileSync(temp, JSON.stringify(value)); fs.renameSync(temp, target); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function snapshotDirectory(directory) { return path.join(path.dirname(directory), "checkpoint-sources"); }
function saveSnapshot(directory, logs, targetDate) {
  const payload = { version: "checkpoint-source-snapshot-v1", target_date: targetDate,
    raw_records: copy(Array.from(logs)), segmented_input: logs.segmentedInput ? copy(logs.segmentedInput) : null };
  const doc = { snapshot_id: hash(payload), payload }, target = file(snapshotDirectory(directory), doc.snapshot_id);
  if (!fs.existsSync(target)) writeJson(target, doc);
  loadSnapshot(directory, doc.snapshot_id);
  return doc.snapshot_id;
}
function loadSnapshot(directory, id) {
  const doc = JSON.parse(fs.readFileSync(file(snapshotDirectory(directory), id), "utf8"));
  if (doc.snapshot_id !== id || hash(doc.payload) !== id
    || doc.payload?.version !== "checkpoint-source-snapshot-v1" || !Array.isArray(doc.payload.raw_records)) {
    fail("derived_snapshot_integrity");
  }
  return doc;
}
function readSnapshot(directory, id, { purpose = "recall", sourceId, itemIndex } = {}) {
  const p = loadSnapshot(directory, id).payload;
  if (itemIndex !== undefined) fail("archive_item");
  const records = p.raw_records.map((record, index) => ({ record, record_index: index }))
    .filter(row => typeof row.record?.text === "string" && row.record.text.trim());
  const source_catalog = records.map((row, index) => ({ source_id: "s" + index,
    record_index: row.record_index, source: row.record.source,
    entry_id: row.record.entry_id || row.record.chunk_id || null }));
  const original = index => ({ archive_id: id, source_id: "s" + index, ...copy(records[index]) });
  if (sourceId !== undefined) {
    const index = source_catalog.findIndex(source => source.source_id === sourceId);
    if (index < 0) fail("archive_source_id");
    return { kind: "raw_snapshot", ...original(index) };
  }
  return { kind: "raw_snapshot", archive_id: id, source_snapshot_id: id, target_date: p.target_date,
    source_catalog, items: [], body: "", summary_status: "not_available",
    original_records: purpose === "recall" ? [] : records.map((_, index) => original(index)),
    ...(purpose === "acceptance" && p.segmented_input?.source_audit
      ? { source_audit: copy(p.segmented_input.source_audit) } : {}) };
}
function requestFor(input, maxInputChars, summaryMaxChars) {
  if (input.sources.reduce((n, source) => n + source.units.length, 0) > 512) fail("summary_input_units");
  return lab.buildPrompt(input, "direct", { maxInputChars, summaryMaxChars });
}
function planBatches(logs, targetDate, { maxInputChars = 200000, summaryMaxChars = 20000 } = {}) {
  const input = buildFactInput(logs, targetDate, { maxUnits: Infinity });
  const subset = pairs => ({ ...input, sources: input.sources.flatMap(source => {
    const units = pairs.filter(pair => pair.source === source.id).map(pair => pair.unit);
    return units.length ? [{ ...source, units }] : [];
  }) });
  const fits = pairs => {
    try { requestFor(subset(pairs), maxInputChars, summaryMaxChars); return true; }
    catch (error) {
      if (["comparison_input_budget", "summary_input_units"].includes(error.code)) return false;
      throw error;
    }
  };
  // Split only an oversized paragraph, retaining offsets into the complete original record.
  for (const source of input.sources) {
    const expanded = [];
    for (const unit of source.units) {
      if (isNoise(unit)) { expanded.push(unit); continue; }
      if (fits([{ source: source.id, unit }])) { expanded.push(unit); continue; }
      let start = 0, part = 0;
      while (start < unit.text.length) {
        const nonSpace = unit.text.slice(start).search(/\S/u);
        if (nonSpace < 0) break;
        start += nonSpace;
        let low = start + 1, high = unit.text.length, end = start;
        const piece = stop => ({ ...unit, id: part ? unit.id + ".c" + part : unit.id,
          start: unit.start + start, end: unit.start + stop, text: unit.text.slice(start, stop) });
        while (low <= high) {
          let middle = Math.floor((low + high) / 2);
          // Never cut between a UTF-16 surrogate pair.
          if (middle < unit.text.length && /[\uDC00-\uDFFF]/.test(unit.text[middle])
            && /[\uD800-\uDBFF]/.test(unit.text[middle - 1])) middle--;
          if (middle <= start) { low++; continue; }
          if (fits([{ source: source.id, unit: piece(middle) }])) { end = middle; low = Math.max(low + 1, middle + 1); }
          else high = middle - 1;
        }
        if (end === start) fail("comparison_input_budget");
        if (end < unit.text.length) {
          const newline = unit.text.lastIndexOf("\n", end - 1);
          if (newline > start + (end - start) / 2) end = newline + 1;
        }
        const segment = piece(end);
        // Whitespace between split segments remains in the saved raw record.
        if (segment.text.trim()) expanded.push(segment);
        start = end; part++;
      }
    }
    source.units = expanded;
  }
  input.sources.flatMap(source => source.units).forEach((unit, index) => { unit.index = index; });
  const groups = new Map(), evidence = logs.segmentedInput?.entries || [];
  for (const source of input.sources) {
    const entry = evidence.find(entry => (entry.entryId && entry.entryId === source.entry_id)
      || (entry.chunk_id && entry.chunk_id === source.entry_id));
    const key = entry?.sessionId || source.entry_id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(...source.units.filter(unit => !isNoise(unit))
      .map(unit => ({ source: source.id, unit })));
  }
  const chunks = [];
  let current = [];
  const flush = () => { if (current.length) chunks.push(current); current = []; };
  for (const group of groups.values()) {
    if (!group.length) continue;
    if (fits(group)) {
      if (current.length && !fits([...current, ...group])) flush();
      current.push(...group);
    } else {
      flush();
      for (const pair of group) {
        if (current.length && !fits([...current, pair])) flush();
        current.push(pair);
      }
      flush();
    }
  }
  flush();
  const batches = chunks.map((pairs, index) => {
    const batchInput = subset(pairs), request = requestFor(batchInput, maxInputChars, summaryMaxChars);
    return { index, input: batchInput, request, source_ids: batchInput.sources.map(source => source.id) };
  });
  if (!batches.length) fail("comparison_input");
  return { input, batches };
}
function validateReply(batch, reply, summaryMaxChars) {
  if (!reply?.generator || typeof reply.generator.model !== "string" || !reply.generator.model.trim()) fail("archive_input");
  if (reply.qualityFindings !== undefined && (!Array.isArray(reply.qualityFindings)
    || reply.qualityFindings.some(finding => typeof finding !== "string" || !finding.trim()))) {
    fail("derived_quality_findings");
  }
  return lab.validateSummary(batch.input, reply.summary, summaryMaxChars, { allowDuplicateReferences: true });
}
async function runBatches({ directory, snapshotId, plan, generator, signal, active,
  summaryMaxChars, resumeKey = "default", onProgress = () => {} }) {
  const jobId = hash({ version: 1, snapshotId, resumeKey, summaryMaxChars,
    requests: plan.batches.map(batch => batch.request) });
  const target = file(path.join(path.dirname(directory), "checkpoint-summary-jobs"), jobId);
  let job = { version: 1, snapshot_id: snapshotId, entries: [] };
  if (fs.existsSync(target)) {
    job = JSON.parse(fs.readFileSync(target, "utf8"));
    if (job.snapshot_id !== snapshotId || !Array.isArray(job.entries)) fail("derived_job_invalid");
  }
  const entries = [];
  let calls = 0, reused = 0;
  for (const batch of plan.batches) {
    active();
    let entry = job.entries[batch.index];
    if (entry?.status === "complete" && entry.request_hash === hash(batch.request)) {
      validateReply(batch, entry.reply, summaryMaxChars); reused++;
    } else {
      let reply;
      const history = entry?.attempt_history || [];
      try {
        calls++;
        reply = await generator({ ...batch.request, targetDate: plan.input.target_date, signal,
          batchIndex: batch.index, batchCount: plan.batches.length });
        active(); validateReply(batch, reply, summaryMaxChars);
        entry = { status: "complete", request_hash: hash(batch.request), reply: copy(reply) };
      } catch (error) {
        // Cancellation/source changes retain earlier progress but stop this run.
        if (signal?.aborted || ["source_version_changed", "derived_deadline"].includes(error.code || error.message)) throw error;
        entry = { status: "failed", request_hash: hash(batch.request),
          ...(reply === undefined ? {} : { reply: copy(reply) }),
          reason: error.code || error.message || "derived_batch_failed" };
      }
      entry.attempt_history = [...history, { status: entry.status, reply: entry.reply, reason: entry.reason }];
      job.entries[batch.index] = entry; writeJson(target, job);
    }
    entries.push({ index: batch.index, input: batch.input, source_ids: batch.source_ids,
      input_chars: batch.request.inputChars, ...entry });
    onProgress({ completed: entries.filter(entry => entry.status === "complete").length,
      total: plan.batches.length, calls, reused });
  }
  const completed = entries.filter(entry => entry.status === "complete");
  const info = { version: 1, source_snapshot_id: snapshotId, job_id: jobId,
    total: entries.length, completed: completed.length, calls, reused, summary_max_chars: summaryMaxChars, entries };
  if (!completed.length) return { info, reason: entries[0]?.reason || "derived_batches_failed" };
  const base = lab.buildPrompt(plan.input, "direct", {
    maxInputChars: Number.MAX_SAFE_INTEGER, summaryMaxChars });
  const summary = { ...completed[0].reply.summary, binding: base.binding,
    items: completed.flatMap(entry => entry.reply.summary.items) };
  const maxItems = plan.batches.length * 256;
  const rendered = lab.validateSummary(plan.input, summary, Number.MAX_SAFE_INTEGER,
    { allowDuplicateReferences: true, maxItems });
  const generatorInfo = completed.length === 1 ? completed[0].reply.generator
    : { model: "batch-concatenation", transport: "programmatic",
      batches: completed.map(entry => entry.reply.generator) };
  return { info, summary, generator: generatorInfo, summaryMaxChars: rendered.body.length,
    qualityFindings: completed.flatMap(entry => entry.reply.qualityFindings || []),
    promptHash: hash(plan.batches.map(batch => ({ system: batch.request.system, prompt: batch.request.prompt }))) };
}
function verifyBatchInfo(info, input, summary) {
  if (info?.version !== 1 || !Array.isArray(info.entries) || !info.entries.length
    || info.total !== info.entries.length || !ID.test(info.source_snapshot_id)) fail("archive_batches");
  const complete = info.entries.filter(entry => entry.status === "complete");
  if (complete.length !== info.completed) fail("archive_batches");
  for (const entry of complete) validateReply(entry, entry.reply, info.summary_max_chars);
  if (JSON.stringify(complete.flatMap(entry => entry.reply.summary.items)) !== JSON.stringify(summary.items)) fail("archive_batches");
  const units = new Map(input.sources.flatMap(source => source.units.filter(unit => !isNoise(unit))
    .map(unit => [unit.id, { source: source.id, unit }]))), visited = new Set();
  for (const entry of info.entries) {
    if (!["complete", "failed"].includes(entry.status)) fail("archive_batches");
    for (const source of entry.input.sources) for (const unit of source.units) {
      const original = units.get(unit.id);
      if (!original || original.source !== source.id || visited.has(unit.id)
        || JSON.stringify(original.unit) !== JSON.stringify(unit)) fail("archive_batches");
      visited.add(unit.id);
    }
  }
  if (visited.size !== units.size) fail("archive_batches");
}
module.exports = { saveSnapshot, loadSnapshot, readSnapshot, planBatches, runBatches, verifyBatchInfo };
