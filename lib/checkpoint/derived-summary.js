const { resolve } = require("node:path");
const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { getRuntime } = require("./runtime");
const lab = require("./summary-comparison-lab.cjs");
const archive = require("./summary-memory-archive.cjs");
const batches = require("./derived-summary-batches.cjs");
const { snapshotEpisode } = require("./episode-publication");
const { writeEpisodeFiles, renderEpisodeFile } = require("./episode-writer");

function archiveDirectory(memoryDir = getRuntime().memoryDir) {
  return resolve(memoryDir, "checkpoint-archives");
}
function batchStatus(info) {
  return info && { total: info.total, completed: info.completed, calls: info.calls, reused: info.reused,
    source_snapshot_id: info.source_snapshot_id, job_id: info.job_id,
    entries: info.entries.map(entry => ({ index: entry.index, status: entry.status,
      reason: entry.reason, source_ids: entry.source_ids, input_chars: entry.input_chars })) };
}
function readDerivedSummary(id, { purpose = "recall", itemIndex, sourceId,
  directory = archiveDirectory() } = {}) {
  if (!["recall", "execution", "exact_parameters", "disputed_claims", "acceptance"].includes(purpose)) {
    throw new Error("derived_read_purpose");
  }
  let stored;
  try { stored = archive.loadArchive(directory, id); }
  catch (error) {
    if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
    return batches.readSnapshot(directory, id, { purpose, itemIndex, sourceId });
  }
  const p = stored.payload;
  if (sourceId !== undefined) {
    return { policy: p.policy, ...archive.readOriginalRecord(directory, id, sourceId) };
  }
  const indexes = itemIndex === undefined ? p.summary.items.map((_, i) => i) : [itemIndex];
  const resolved = indexes.map(i => archive.resolveItem(directory, id, i));
  const sources = resolved.flatMap(r => r.sources);
  const originalIds = [...new Set(sources.map(s => s.locator.source_id))];
  return { archive_id: id, target_date: p.input.target_date, created_at: p.created_at,
    previous_archive_id: p.previous_archive_id, generator: p.generator,
    policy: p.policy, quality_findings: p.quality_findings,
    ...(p.batches ? { batches: batchStatus(p.batches) } : {}),
    source_catalog: p.input.sources.map(source => ({ source_id: source.id,
      entry_id: source.entry_id, source_hash: source.source_hash,
      source: source.source, provenance: source.provenance,
      collected_timestamp_ms: source.collected_timestamp_ms })),
    body: lab.validateSummary(p.input, { ...p.summary,
      items: resolved.map(r => r.item) }, p.summary_max_chars,
    { allowDuplicateReferences: true, maxItems: p.batches ? p.batches.total * 256 : 256 }).body,
    items: resolved.map(r => ({ item_index: r.item_index, item: r.item, sources: r.sources })),
    original_records: purpose === "recall" ? [] : originalIds.map(source =>
      archive.readOriginalRecord(directory, id, source)),
    evidence_scope: "archived_collected_records_only; dialogue_is_not_independent_tool_verification" };
}
function previousArchive(path, expected, directory, targetDate) {
  if (!expected.exists) return null;
  const metadata = readFileSync(path, "utf8").split(/\r?\n\r?\n/)[1] || "";
  const line = metadata.split(/\r?\n/).find(row => row.startsWith("derivedSummary: "));
  if (!line) return null;
  const prior = JSON.parse(line.slice("derivedSummary: ".length));
  const stored = archive.loadArchive(directory, prior.archive_id);
  if (stored.payload.input.target_date !== targetDate) throw new Error("derived_revision_date");
  return prior.archive_id;
}
function renderBatchLines(stored) {
  const lines = require("./derived-summary-locator.cjs").renderDerivedItemLines(stored);
  const info = stored.payload.batches;
  if (!info || info.total === 1) return lines.join("\n");
  let offset = 0;
  return info.entries.map(entry => {
    const heading = "### 第" + (entry.index + 1) + "批（来源 " + entry.source_ids.join(", ") + "）";
    if (entry.status !== "complete") return heading + "\n\n本批未完成；请回读原文或补跑。";
    const count = entry.reply.summary.items.length, body = lines.slice(offset, offset + count).join("\n");
    offset += count;
    return heading + "\n\n" + body;
  }).join("\n\n");
}
function cacheKey(key) {
  let config = "";
  try { config = readFileSync(getRuntime().configJsonPath, "utf8"); } catch (_) {}
  return createHash("sha256").update(JSON.stringify({ key, config,
    transport: process.env.MEMORY_ENGINE_CHECKPOINT_DERIVED_TRANSPORT ?? "http",
    model: process.env.MEMORY_ENGINE_CHECKPOINT_CODEX_MODEL ?? "gpt-6-luna",
    effort: process.env.MEMORY_ENGINE_CHECKPOINT_CODEX_EFFORT ?? "xhigh",
  })).digest("hex");
}
async function generateDerivedCheckpoint(rawLogs, { targetDate, generatedAt, diagnostics = {},
  rawLogStats, inputReady, conversationReady = true, generator, signal, parentDeadline,
  maxInputChars = Number(process.env.MEMORY_ENGINE_CHECKPOINT_SUMMARY_INPUT_CHARS ?? 200000),
  summaryMaxChars = Number(process.env.MEMORY_ENGINE_CHECKPOINT_SUMMARY_OUTPUT_CHARS ?? 20000),
  resumeKey = process.env.MEMORY_ENGINE_CHECKPOINT_SUMMARY_CACHE_KEY ?? "default" } = {}) {
  const writes = { file_written: 0, confidence_bound: 0, pending: 0, failed: 0 };
  let sourceSnapshotId, batchInfo, saved, publication;
  const stopped = reason => ({ status: "summary_invalid", reason, skipped: true,
    memories: 0, configs: 0, episode: false, writes, archive_id: saved?.archive_id,
    source_snapshot_id: sourceSnapshotId, batches: batchStatus(batchInfo),
    publication: { published: false, reason } });
  if (rawLogStats?.rawLogReadFailed || rawLogStats?.resetReadFailed
    || rawLogStats?.budgetCoverageComplete === false || inputReady !== true || !conversationReady) {
    return stopped("derived_input_incomplete");
  }
  try {
    const sourceEvidence = rawLogs.segmentedInput;
    const before = JSON.stringify(rawLogs), evidenceBefore = JSON.stringify(sourceEvidence);
    const logs = JSON.parse(before);
    if (sourceEvidence) logs.segmentedInput = JSON.parse(evidenceBefore);
    const unchanged = () => JSON.stringify(rawLogs) === before
      && rawLogs.segmentedInput === sourceEvidence
      && JSON.stringify(sourceEvidence) === evidenceBefore
      && (!sourceEvidence || (sourceEvidence.targetDate === targetDate
        && typeof sourceEvidence.unchanged === "function" && sourceEvidence.unchanged() === true));
    const active = () => {
      if (signal?.aborted) throw new Error("derived_cancelled");
      if (parentDeadline !== undefined && performance.now() >= parentDeadline) throw new Error("derived_deadline");
      if (!unchanged()) throw new Error("source_version_changed");
    };
    active();
    const directory = archiveDirectory();
    // This durable snapshot exists even if planning or every model call fails.
    sourceSnapshotId = batches.saveSnapshot(directory, logs, targetDate);
    const episodePath = resolve(getRuntime().episodesDir, targetDate + ".md");
    const expected = snapshotEpisode(episodePath);
    const previousArchiveId = previousArchive(episodePath, expected, directory, targetDate);
    const plan = batches.planBatches(logs, targetDate, { maxInputChars, summaryMaxChars });
    if (typeof generator !== "function") return stopped("derived_generator_unavailable");
    const result = await batches.runBatches({ directory, snapshotId: sourceSnapshotId,
      plan, generator, signal, active, summaryMaxChars, resumeKey: cacheKey(resumeKey) });
    batchInfo = result.info;
    if (!result.summary) return stopped(result.reason);
    active();
    const partial = batchInfo.completed !== batchInfo.total;
    const qualityFindings = ["Model summary is lossy and semantic correctness is not certified.",
      "Archive verifies collected statements, not independent tool execution.",
      ...result.qualityFindings];
    if (partial) qualityFindings.push("Partial summary: " + batchInfo.completed + "/" + batchInfo.total
      + " batches complete; unfinished sources remain available in the source snapshot.");
    const candidate = archive.createArchive({ rawLogs: logs, targetDate,
      sourceInput: plan.input, batchInfo, summary: result.summary,
      generator: { ...result.generator, prompt_sha256: result.promptHash, protocol_version: lab.VERSION },
      createdAt: generatedAt, previousArchiveId, qualityFindings, summaryMaxChars: result.summaryMaxChars });
    saved = archive.persistArchive(directory, candidate);
    const stored = archive.loadArchive(directory, saved.archive_id);
    const episodeText = [
      "模型派生摘要（有损，事实正确性未认证）；具体参数、验收结论、争议判断或执行前须回查原文。",
      "回溯：memory_engine_get id=checkpoint:" + saved.archive_id
        + "；purpose=execution|exact_parameters|acceptance|disputed_claims 返回原文。",
      "完整原文快照：memory_engine_get id=checkpoint:" + sourceSnapshotId
        + "；source_id 可读取完整来源记录，包含未完成批次。",
      "批次完成：" + batchInfo.completed + "/" + batchInfo.total
        + (partial ? "（部分完成，不能视为全天摘要已完成）" : "")
        + "。item_index 从0开始；修订不覆盖原文。",
      renderBatchLines(stored),
    ].join("\n\n");
    const episodeOptions = { episodeDate: targetDate, generatedAt, episodeText,
      configs: [], diagnostics: { ...diagnostics, derivedSummary: {
        archive_id: saved.archive_id, previous_archive_id: previousArchiveId,
        source_snapshot_id: sourceSnapshotId, batches: batchStatus(batchInfo),
        kind: "derived_summary", lossy: true, semantic_correctness: "NOT_CERTIFIED",
        item_count: stored.payload.summary.items.length, quality_findings: stored.payload.quality_findings,
      } } };
    const projections = require("./episode-projection.cjs");
    const projection = projections.createProjection(stored, renderEpisodeFile(episodeOptions), "prepared");
    const preparedProjectionId = projections.persistProjection(getRuntime().memoryDir, projection);
    publication = writeEpisodeFiles({ ...episodeOptions, publication: { expected, unchanged, beforeCommit: () => {
      active(); archive.loadArchive(directory, saved.archive_id);
      projections.readProjection(getRuntime().memoryDir, targetDate, preparedProjectionId);
    } } });
    if (readFileSync(episodePath, "utf8") !== projection.payload.text) throw new Error("projection_publication_changed");
    const projectionId = projections.persistProjection(getRuntime().memoryDir,
      projections.createProjection(stored, projection.payload.text, "published"));
    publication.projection_registered = true;
    return { status: partial ? "partial_summary" : "valid_summary", memories: 0, configs: 0, episode: true,
      targetDate, generatedAt, archive_id: saved.archive_id, previous_archive_id: previousArchiveId,
      source_snapshot_id: sourceSnapshotId, batches: batchStatus(batchInfo),
      projection_id: projectionId, prepared_projection_id: preparedProjectionId,
      source_version_valid: true, semantic_correctness: "NOT_CERTIFIED",
      quality_findings: stored.payload.quality_findings, publication, writes };
  } catch (error) {
    return { ...stopped(error.code || error.message || "derived_summary_failed"),
      ...(publication ? { publication: { ...publication, projection_registered: false },
        episode: publication.published === true }
        : error.publication ? { publication: error.publication } : {}) };
  }
}
module.exports = { archiveDirectory, readDerivedSummary, generateDerivedCheckpoint };
