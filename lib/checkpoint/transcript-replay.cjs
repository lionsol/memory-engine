"use strict";
const fs = require("node:fs"), path = require("node:path");
const { getRuntime } = require("./runtime");
const { collectTranscriptSources } = require("./transcript-source.cjs");
const batches = require("./derived-summary-batches.cjs");
const { snapshotEpisode, publishEpisode } = require("./episode-publication");
const derived = require("./derived-summary");

function previewLogs(logs, targetDate, extra = {}) {
  const stats = logs.checkpointStats;
  if (stats?.rawLogReadFailed || stats?.resetReadFailed || stats?.budgetCoverageComplete === false) {
    throw new Error("checkpoint_preview_input_incomplete");
  }
  const maxInputChars = Number(process.env.MEMORY_ENGINE_CHECKPOINT_SUMMARY_INPUT_CHARS ?? 200000);
  const summaryMaxChars = Number(process.env.MEMORY_ENGINE_CHECKPOINT_SUMMARY_OUTPUT_CHARS ?? 20000);
  let plan = null;
  if (logs.some(row => typeof row.text === "string" && row.text.trim())) {
    try { plan = batches.planBatches(logs, targetDate, { maxInputChars, summaryMaxChars }); }
    catch (error) { if (error.code !== "comparison_input") throw error; }
  }
  return { ok: true, dryRun: true, read_only: true, targetDate,
    rawCount: logs.length, combinedTextCharCount: logs.reduce((n, row) => n + String(row.text || "").length, 0),
    stats, plan: { max_input_chars: maxInputChars, max_output_chars: summaryMaxChars,
      batches: plan ? plan.batches.map(batch => ({ index: batch.index,
        input_chars: batch.request.system.length + batch.request.prompt.length,
        source_ids: batch.source_ids,
        units: batch.input.sources.reduce((n, source) => n + source.units.length, 0) })) : [] },
    flush: { performed: false, mayWriteSmartAddFiles: false },
    model_requests: 0, database_writes: 0, file_writes: 0, ...extra };
}

// Detailed file inventories belong in the immutable source snapshot, never in
// indexed episode text. Keep the summary bounded independently of file count.
function compactSourceAudit(audit = {}) {
  const source = audit.transcripts || audit, files = source.files || [];
  const excluded = { cron_session: 0, other: 0 };
  for (const file of files) {
    if (file.excluded) excluded[file.excluded === "cron_session" ? "cron_session" : "other"]++;
  }
  return {
    mode: audit.mode || "transcript_replay",
    smart_add: audit.smart_add || "not_used", db_read: audit.db_read || "not_used",
    files_read: files.length, files_with_target_records: files.filter(file => file.matched > 0).length,
    ignored_trajectory_files: source.ignored_trajectory_files || 0,
    excluded_files_by_reason: excluded,
    records_included: source.records_included || 0, duplicates: source.duplicates || 0,
    out_of_date_messages: source.out_of_date || 0, non_dialogue_records: source.non_dialogue || 0,
    detail: "source_snapshot; purpose=acceptance",
  };
}

function publishEmptyDay(logs, targetDate, sourceAudit, unchanged) {
  const rt = getRuntime(), directory = derived.archiveDirectory();
  const episodePath = path.join(rt.episodesDir, targetDate + ".md"), expected = snapshotEpisode(episodePath);
  if (expected.exists) {
    const previous = fs.readFileSync(episodePath, "utf8");
    // A missing source must never erase an already published summary.
    if (/^derivedSummary:/m.test(previous)
      || !/^status: empty$/m.test(previous) && !/数据不完整|source_type: checkpoint_fallback/.test(previous)) {
      throw new Error("empty_day_existing_episode_preserved");
    }
  }
  if (!unchanged()) throw new Error("source_version_changed");
  const snapshotId = batches.saveSnapshot(directory, logs, targetDate);
  const generatedAt = new Date(rt.now()).toISOString();
  const text = [
    "# Episode: " + targetDate, "",
    "targetDate: " + targetDate, "generatedAt: " + generatedAt, "timeZone: " + rt.timeZone,
    "status: empty", "source_type: checkpoint_empty",
    "source_snapshot_id: " + snapshotId, "sourceAudit: " + JSON.stringify(compactSourceAudit(sourceAudit)), "",
    "本次已读取的来源中没有当日可摘要内容；此状态不证明当天没有对话。",
    "来源记录与采集清单：memory_engine_get id=checkpoint:" + snapshotId + "；purpose=acceptance 查看完整清单。", "",
  ].join("\n");
  const publication = publishEpisode(episodePath, text, { expected, unchanged });
  return { ok: true, status: "empty", targetDate, source_snapshot_id: snapshotId, publication,
    businessStatus: { status: "empty", summary_status: "empty", input_complete: true,
      publication_complete: true, business_complete: true, vector_operation_status: "not_run" } };
}

async function replayTranscripts({ directory, targetDate, dryRun = false, parentDeadline }) {
  const rt = getRuntime();
  if (rt.checkpointSummaryMode !== "derived") throw new Error("transcript_replay_requires_derived_mode");
  const { logs, audit, unchanged } = collectTranscriptSources({ directory, targetDate, timeZone: rt.timeZone });
  const preview = previewLogs(logs, targetDate, { source_audit: audit, mode: "transcript_replay" });
  if (dryRun) return preview;
  if (!preview.plan.batches.length) return publishEmptyDay(logs, targetDate, audit, unchanged);
  const result = await derived.generateDerivedCheckpoint(logs, {
    targetDate, generatedAt: new Date(rt.now()).toISOString(),
    diagnostics: { replaySource: audit, evidenceDateFilter: "transcript message timestamp; " + rt.timeZone },
    rawLogStats: logs.checkpointStats, inputReady: true,
    generator: rt.derivedSummaryGenerator, parentDeadline,
  });
  return { ...result, ok: result.status === "valid_summary" && result.publication?.published === true,
    mode: "transcript_replay", source_audit: audit };
}

// Missing smart-add is an empty-day candidate, not proof of an empty day.
// Read DB inputs and every available transcript before taking this branch.
function tryEmptyCheckpoint(targetDate) {
  const rt = getRuntime();
  if (fs.existsSync(path.join(rt.smartAddDir, targetDate + ".md"))) return null;
  const logs = rt.readCheckpointRawLogs({ targetDate, timeZone: rt.timeZone });
  const stats = logs.checkpointStats;
  if (logs.some(row => String(row.text || "").trim()) || stats?.rawLogReadComplete !== true
    || stats.rawLogReadFailed || stats.rawLogSkippedMissingTimestamp > 0) return null;
  const transcripts = collectTranscriptSources({ directory: rt.sessionsDir, targetDate, timeZone: rt.timeZone });
  if (transcripts.logs.length) return null;
  const unchanged = () => transcripts.unchanged()
    && logs.segmentedInput?.unchanged() === true
    && !fs.existsSync(path.join(rt.smartAddDir, targetDate + ".md"));
  const audit = { mode: "nightly_empty_check", smart_add: "absent", db_read: "complete",
    transcripts: transcripts.audit };
  return publishEmptyDay(transcripts.logs, targetDate, audit, unchanged);
}
module.exports = { previewLogs, replayTranscripts, tryEmptyCheckpoint, publishEmptyDay, compactSourceAudit };
