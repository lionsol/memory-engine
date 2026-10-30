const { resolve } = require("node:path");
const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { getRuntime } = require("./runtime");
const { buildFactInput } = require("./ordinary-summary-facts");
const lab = require("./summary-comparison-lab.cjs");
const archive = require("./summary-memory-archive.cjs");
const { snapshotEpisode } = require("./episode-publication");
const { writeEpisodeFiles } = require("./episode-writer");

function archiveDirectory(memoryDir = getRuntime().memoryDir) {
  return resolve(memoryDir, "checkpoint-archives");
}
function readDerivedSummary(id, { purpose = "recall", itemIndex, sourceId,
  directory = archiveDirectory() } = {}) {
  if (!["recall", "execution", "exact_parameters", "disputed_claims", "acceptance"].includes(purpose)) {
    throw new Error("derived_read_purpose");
  }
  const stored = archive.loadArchive(directory, id), p = stored.payload;
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
    source_catalog: p.input.sources.map(source => ({ source_id: source.id,
      entry_id: source.entry_id, source_hash: source.source_hash,
      source: source.source, provenance: source.provenance,
      collected_timestamp_ms: source.collected_timestamp_ms })),
    body: lab.validateSummary(p.input, { ...p.summary,
      items: resolved.map(r => r.item) }, p.summary_max_chars, { allowDuplicateReferences: true }).body,
    items: resolved.map(r => ({ item_index: r.item_index, item: r.item,
      sources: r.sources })),
    // Exact parameters and conclusions may have qualifications outside the cited paragraph.
    original_records: purpose === "recall" ? [] : originalIds.map(source =>
      archive.readOriginalRecord(directory, id, source)),
    evidence_scope: "archived_collected_records_only; dialogue_is_not_independent_tool_verification" };
}
function previousArchive(path, expected, directory, targetDate) {
  if (!expected.exists) return null;
  // Only trusted episode metadata, never archive-like text in the generated body.
  const metadata = readFileSync(path, "utf8").split(/\r?\n\r?\n/)[1] || "";
  const line = metadata.split(/\r?\n/).find(row => row.startsWith("derivedSummary: "));
  if (!line) return null;
  const prior = JSON.parse(line.slice("derivedSummary: ".length));
  const stored = archive.loadArchive(directory, prior.archive_id);
  if (stored.payload.input.target_date !== targetDate) throw new Error("derived_revision_date");
  return prior.archive_id;
}
async function generateDerivedCheckpoint(rawLogs, { targetDate, generatedAt, diagnostics = {},
  rawLogStats, inputReady, conversationReady = true, generator, signal,
  maxInputChars = 200000, summaryMaxChars = 20000 } = {}) {
  const writes = { file_written: 0, confidence_bound: 0, pending: 0, failed: 0 };
  const stopped = (reason, saved) => ({ status: "summary_invalid", reason, skipped: true,
    memories: 0, configs: 0, episode: false, writes, archive_id: saved?.archive_id,
    publication: { published: false, reason } });
  if (rawLogStats?.budgetCoverageComplete === false || inputReady !== true || !conversationReady) {
    return stopped("derived_input_incomplete");
  }
  let saved;
  try {
    const sourceEvidence = rawLogs.segmentedInput;
    const before = JSON.stringify(rawLogs);
    const evidenceBefore = JSON.stringify(sourceEvidence);
    const logs = JSON.parse(before);
    if (sourceEvidence) logs.segmentedInput = JSON.parse(evidenceBefore);
    const unchanged = () => JSON.stringify(rawLogs) === before
      && rawLogs.segmentedInput === sourceEvidence
      && JSON.stringify(sourceEvidence) === evidenceBefore
      && (!sourceEvidence || (sourceEvidence.targetDate === targetDate
        && typeof sourceEvidence.unchanged === "function" && sourceEvidence.unchanged() === true));
    const active = () => { if (signal?.aborted) throw new Error("derived_cancelled"); };
    active();
    if (!unchanged()) return stopped("source_version_changed");
    const directory = archiveDirectory();
    const episodePath = resolve(getRuntime().episodesDir, targetDate + ".md");
    const expected = snapshotEpisode(episodePath);
    const previousArchiveId = previousArchive(episodePath, expected, directory, targetDate);
    const input = buildFactInput(logs, targetDate);
    const request = lab.buildPrompt(input, "direct", { maxInputChars, summaryMaxChars });
    if (typeof generator !== "function") return stopped("derived_generator_unavailable");
    const reply = await generator({ ...request, targetDate, signal });
    active();
    if (!unchanged()) return stopped("source_version_changed");
    if (reply.qualityFindings !== undefined && !Array.isArray(reply.qualityFindings)) {
      throw new Error("derived_quality_findings");
    }
    const candidate = archive.createArchive({ rawLogs: logs, targetDate,
      summary: reply.summary, generator: { ...reply.generator,
        prompt_sha256: createHash("sha256").update(JSON.stringify({
          system: request.system, prompt: request.prompt })).digest("hex"),
        protocol_version: lab.VERSION },
      createdAt: generatedAt, previousArchiveId,
      qualityFindings: ["Model summary is lossy and semantic correctness is not certified.",
        "Archive verifies collected statements, not independent tool execution.",
        ...(reply.qualityFindings ?? [])], summaryMaxChars });
    saved = archive.persistArchive(directory, candidate);
    const stored = archive.loadArchive(directory, saved.archive_id);
    const episodeText = [
      "模型派生摘要（有损，事实正确性未认证）；具体参数、验收结论、争议判断或执行前须回查原文。",
      "回溯：memory_engine_get id=checkpoint:" + saved.archive_id
        + "；purpose=execution|exact_parameters|acceptance|disputed_claims 返回原文。",
      "item_index 从0开始；source_id 可读取完整来源记录。更正关系为模型标注，旧原文保持不变。",
      stored.payload.body,
    ].join("\n\n");
    const publication = writeEpisodeFiles({ episodeDate: targetDate, generatedAt, episodeText,
      configs: [], diagnostics: { ...diagnostics, derivedSummary: {
        archive_id: saved.archive_id, previous_archive_id: previousArchiveId,
        kind: "derived_summary", lossy: true, semantic_correctness: "NOT_CERTIFIED",
        item_count: stored.payload.summary.items.length,
        quality_findings: stored.payload.quality_findings,
      } }, publication: { expected, unchanged, beforeCommit: () => {
        active();
        archive.loadArchive(directory, saved.archive_id);
      } } });
    return { status: "valid_summary", memories: 0, configs: 0, episode: true,
      targetDate, generatedAt, archive_id: saved.archive_id, previous_archive_id: previousArchiveId,
      source_version_valid: true, semantic_correctness: "NOT_CERTIFIED",
      quality_findings: stored.payload.quality_findings, publication, writes };
  } catch (error) {
    return { ...stopped(error.code || error.message || "derived_summary_failed", saved),
      ...(error.publication ? { publication: error.publication } : {}) };
  }
}
module.exports = { archiveDirectory, readDerivedSummary, generateDerivedCheckpoint };
