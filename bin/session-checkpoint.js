#!/usr/bin/env node
/**
 * session-checkpoint.js — 每日 Session 结束前的强制检查点
 *
 * 运行方式：cron 每日 03:55（系统切 session 前）
 * 功能：
 *   1. 检查今天的 raw_log，提取潜在配置信息
 *   2. 未识别的配置自动写入 preference 记忆
 *   3. 生成今日摘要（episode），供新 session 注入
 */

const { spawnSync } = require("node:child_process");
const { existsSync, readdirSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const checkpointDate = require("../lib/checkpoint/date");
const checkpointCompleteness = require("../lib/checkpoint/completeness");
const { resolveConfigConflicts } = require("../lib/checkpoint/conflict-resolver");
const {
  inspectConfidenceBinding,
  writeConfidence,
} = require("../lib/checkpoint/confidence-writer");
const {
  inspectBusyTimeouts,
  inspectCheckpointBusyTimeouts,
} = require("../lib/checkpoint/db");
const { writeEpisodeFiles } = require("../lib/checkpoint/episode-writer");
const { snapshotEpisode } = require("../lib/checkpoint/episode-publication");
const checkpointLlm = require("../lib/checkpoint/llm");
const summaryFacts = require("../lib/checkpoint/ordinary-summary-facts");
const { writeEmptyEpisode, writeIncompleteEpisode, writeLLMTimeoutEpisode } = require("../lib/checkpoint/markers");
const { repairOrphanVectors } = require("../lib/checkpoint/orphan-repair");
const { reconcileSessionFlushManagedState } = require("../lib/checkpoint/session-flush-reconciliation.js");
const checkpointRawLog = require("../lib/checkpoint/raw-log");
const {
  SMART_ADD_PROVENANCE,
  mapToCategory,
  appendSmartAdd,
  readSmartAddFingerprints,
  resolveSmartAddEntryId,
  isDuplicate,
  resolveOutputTarget,
} = require("../lib/checkpoint/smart-add-writer");
const { getRuntime, withRuntime } = require("../lib/checkpoint/runtime");
const runtimeRegistry = require("../lib/checkpoint/runtime");
const { parseSmartAddEntries } = require("../lib/smart-add-entry-contract.cjs");

const MAX_PENDING_RETRY_FILES = 7;
const MAX_PENDING_RETRY_ENTRIES = 50;

function nonNegativeSafeIntegerOrNull(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function currentIsoString() {
  return new Date(getRuntime().now()).toISOString();
}

function todayDateStr() {
  const rt = getRuntime();
  return checkpointDate.todayDateStr(rt.now(), rt.timeZone);
}

/**
 * Returns YESTERDAY's date string (YYYY-MM-DD) in business timezone (Asia/Shanghai).
 * The script runs at 03:55 CST to process the previous day's data.
 */
function yesterdayDateStr(now = null) {
  const rt = getRuntime();
  return checkpointDate.yesterdayDateStr(now || rt.now(), rt.timeZone);
}

function resolveTargetDate(options = {}) {
  return options.targetDate || yesterdayDateStr();
}

function parseCliArgs(argv = []) {
  const options = {
    dryRun: false,
    targetDate: null,
    legacyResetDirectParse: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--target-date") {
      options.targetDate = argv[index + 1] || null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--target-date=")) {
      options.targetDate = arg.slice("--target-date=".length) || null;
      continue;
    }
    if (arg === "--legacy-reset-direct-parse") {
      options.legacyResetDirectParse = true;
    }
  }

  return options;
}

function buildCheckpointEvidenceDiagnostics(targetDate, rawLogStats = null) {
  const rt = getRuntime();
  const stats = rawLogStats && typeof rawLogStats === "object" ? rawLogStats : {};
  return {
    targetDate,
    timeZone: rt.timeZone,
    smartAddPath: stats.smartAddPath || `memory/smart-add/${targetDate}.md`,
    smartAddInputPolicy: stats.smartAddInputPolicy || checkpointRawLog.SMART_ADD_INPUT_POLICY,
    smartAddIncluded: stats.smartAddIncluded || 0,
    smartAddConversationIncluded: stats.smartAddConversationIncluded || 0,
    smartAddSkippedUnknownProvenance: stats.smartAddSkippedUnknownProvenance || 0,
    smartAddSkippedCheckpointGenerated: stats.smartAddSkippedCheckpointGenerated || 0,
    budgetCoverageComplete: stats.budgetCoverageComplete !== false,
    budgetExcludedCount: stats.droppedByBudgetCount || 0,
    budgetTruncatedCount: stats.budgetTruncatedCount || 0,
    budgetUncoveredEntries: Array.isArray(stats.budgetUncoveredEntries) ? stats.budgetUncoveredEntries : [],
    generatedEpisodePath: resolve(rt.episodesDir, `${targetDate}.md`),
    evidenceDateFilter: stats.evidenceDateFilter
      || `targetDate=${targetDate}; timeZone=${rt.timeZone}; smartAdd=memory/smart-add/${targetDate}.md; raw_log=event_at/legacy_event_time bounded to targetDate`,
    rawLogTimeBasis: stats.rawLogTimeBasis || "event_at/legacy_event_time",
    rawLogTimeBasisNote: stats.rawLogTimeBasisNote || "prefer event_at as original event time; legacy fallback is only allowed before event_at exists",
    rawLogIncluded: stats.rawLogIncluded || 0,
    rawLogSkippedOutOfTargetDate: stats.rawLogSkippedOutOfTargetDate || 0,
    resetDirectParseEnabled: stats.resetDirectParseEnabled === true,
    resetFilesScanned: stats.resetFilesScanned || 0,
    resetEventsIncluded: stats.resetEventsIncluded || 0,
    resetEventsSkippedOutOfTargetDate: stats.resetEventsSkippedOutOfTargetDate || 0,
    resetEventsSkippedMissingTimestamp: stats.resetEventsSkippedMissingTimestamp || 0,
  };
}

function runFlushSessionRawlogCheckpoint({
  spawnSyncImpl = spawnSync,
  nodeExecPath = process.execPath,
  scriptPath = resolve(__dirname, "flush-session-rawlog.js"),
  cwd = resolve(__dirname, ".."),
  env = process.env,
  targetDate,
} = {}) {
  const args = [scriptPath, "--checkpoint"];
  if (targetDate) args.push("--target-date", targetDate);
  const runtime = getRuntime();
  const result = spawnSyncImpl(nodeExecPath, args, {
    cwd,
    env: { ...env, MEMORY_ENGINE_TIME_ZONE: runtime.timeZone },
    encoding: "utf8",
  });
  const status = Number.isInteger(result?.status) ? result.status : null;
  const stdout = String(result?.stdout || "");
  const stderr = String(result?.stderr || "");
  if (status !== 0) {
    const message = stderr.trim() || stdout.trim() || "flush-session-rawlog checkpoint exited with non-zero status";
    throw new Error(message);
  }
  return { ok: true, status, stdout, stderr };
}

function buildNightlyEntryId({ targetDate, category = "episodic", generatedAt = null } = {}) {
  const rt = getRuntime();
  return checkpointDate.buildNightlyEntryId({
    targetDate,
    category,
    generatedAt: generatedAt || rt.now(),
    timeZone: rt.timeZone,
  });
}

function mergeKgData(existingKgData, patch = {}) {
  let base = {};
  if (existingKgData && typeof existingKgData === "object") {
    base = { ...existingKgData };
  } else if (typeof existingKgData === "string" && existingKgData.trim()) {
    try {
      base = JSON.parse(existingKgData);
    } catch (_) {
      base = {};
    }
  }
  if (patch && typeof patch === "object") {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) base[key] = value;
    }
  }
  return JSON.stringify(base);
}

function warnConfidenceWriteFailure({ entryId, category, section, type, key, error }) {
  const message = error && error.message ? error.message : String(error);
  const fields = [
    `section=${section || "unknown"}`,
    type ? `type=${type}` : null,
    key ? `key=${key}` : null,
    `entryId=${entryId || "unknown"}`,
    `category=${category || "unknown"}`,
    `error=${message}`,
  ].filter(Boolean);
  console.warn(`[checkpoint] Confidence write failed: ${fields.join(" ")}`);
}

function recordConfidenceResult(writeStats, result) {
  if (result?.status === "pending") {
    writeStats.pending += 1;
    return;
  }
  if (result?.ok === false) {
    writeStats.failed += 1;
    return;
  }
  writeStats.confidence_bound += 1;
}

function emptyCheckpointWriteStats() {
  return {
    file_written: 0,
    confidence_bound: 0,
    pending: 0,
    failed: 0,
  };
}

function retryPendingCheckpointEntries({
  dates = null,
  maxFiles = MAX_PENDING_RETRY_FILES,
  maxEntries = MAX_PENDING_RETRY_ENTRIES,
} = {}) {
  const runtime = getRuntime();
  const fileLimit = Math.min(
    MAX_PENDING_RETRY_FILES,
    Math.max(0, Number.isFinite(Number(maxFiles)) ? Math.floor(Number(maxFiles)) : 0),
  );
  const entryLimit = Math.min(
    MAX_PENDING_RETRY_ENTRIES,
    Math.max(0, Number.isFinite(Number(maxEntries)) ? Math.floor(Number(maxEntries)) : 0),
  );
  const result = {
    files_scanned: 0,
    entries_examined: 0,
    entries_retried: 0,
    confidence_bound: 0,
    already_initialized: 0,
    pending: 0,
    deferred_pending: 0,
    deferred_ambiguous: 0,
    deferred_other: 0,
    failed: 0,
  };
  if (!existsSync(runtime.generatedSmartAddDir) || entryLimit <= 0 || fileLimit <= 0) return result;

  let candidateDates = Array.isArray(dates)
    ? dates.map(value => String(value || "").trim()).filter(Boolean)
    : readdirSync(runtime.generatedSmartAddDir)
      .map(name => String(name).match(/^(\d{4}-\d{2}-\d{2})\.md$/)?.[1] || null)
      .filter(Boolean)
      .sort((left, right) => right.localeCompare(left));
  candidateDates = [...new Set(candidateDates)].slice(0, fileLimit);

  for (const date of candidateDates) {
    if (result.entries_retried >= entryLimit) break;
    const filePath = resolve(runtime.generatedSmartAddDir, `${date}.md`);
    if (!existsSync(filePath)) continue;
    result.files_scanned += 1;
    let entries;
    try {
      entries = parseSmartAddEntries(readFileSync(filePath, "utf8"));
    } catch (_) {
      result.failed += 1;
      continue;
    }
    for (const entry of entries) {
      if (result.entries_retried >= entryLimit) break;
      if (entry.provenance !== SMART_ADD_PROVENANCE.CHECKPOINT_GENERATED) continue;
      result.entries_examined += 1;
      try {
        const inspection = inspectConfidenceBinding(
          entry.entryId,
          entry.category || "raw_log",
          { fileRel: `memory/generated-smart-add/${date}.md` },
        );
        if (inspection.status === "already_initialized") {
          result.already_initialized += 1;
          continue;
        }
        if (inspection.status === "pending") {
          result.pending += 1;
          result.deferred_pending += 1;
          continue;
        }
        if (inspection.status === "deferred") {
          if (inspection.reason === "ambiguous_core_identity") result.deferred_ambiguous += 1;
          else result.deferred_other += 1;
          continue;
        }
        if (result.entries_retried >= entryLimit) break;
        result.entries_retried += 1;
        const confidence = writeConfidence(
          entry.entryId,
          entry.text,
          entry.category || "raw_log",
          { fileRel: `memory/generated-smart-add/${date}.md` },
        );
        if (confidence?.status === "pending") result.pending += 1;
        else if (confidence?.status === "already_initialized") result.already_initialized += 1;
        else result.confidence_bound += 1;
      } catch (error) {
        result.failed += 1;
        result.deferred_other += 1;
        console.warn(`[checkpoint] Pending generated entry retry failed: entryId=${entry.entryId} date=${date} error=${error.message}`);
      }
    }
  }
  return result;
}

function bindCheckpointConfidence({
  entryId,
  text,
  category,
  fileRel,
  section,
  type,
  key,
  writeStats,
}) {
  if (!entryId) return false;
  try {
    const confidenceResult = writeConfidence(entryId, text, category, { fileRel });
    recordConfidenceResult(writeStats, confidenceResult);
  } catch (error) {
    writeStats.failed += 1;
    warnConfidenceWriteFailure({ entryId, category, section, type, key, error });
  }
  return true;
}

function resolveExistingCheckpointEntry(text, category, episodeDate) {
  return resolveSmartAddEntryId(text, category, {
    targetDate: episodeDate,
    provenance: SMART_ADD_PROVENANCE.CHECKPOINT_GENERATED,
  });
}

// ── Read today's raw content ──

// ── Unified Nightly Smart Extraction ──

/**
 * Run the full nightly checkpoint: one LLM call → 4 outputs.
 */
async function nightlyCheckpoint(rawLogs, options = {}) {
  const episodeDate = resolveTargetDate(options);
  const generatedAt = currentIsoString();
  const diagnostics = buildCheckpointEvidenceDiagnostics(episodeDate, options.rawLogStats);
  const writeStats = emptyCheckpointWriteStats();
  const assessment = checkpointCompleteness.assessCheckpointCompleteness(rawLogs);
  const allLogs = assessment.allLogs;

  if (options.rawLogStats?.budgetCoverageComplete === false) {
    const segmented = await require("../lib/checkpoint/long-session-summary").summarizeLongSession(rawLogs, {
      targetDate: episodeDate, stats: options.rawLogStats, inputReady: options.inputReady === true,
      parentDeadline: options.parentDeadline, signal: options.signal,
      transport: getRuntime().summaryTransport, providers: getRuntime().summaryProviders,
      generatedAt, diagnostics,
    });
    if (segmented) {
      console.log(`[checkpoint] Segmented summary ${JSON.stringify(segmented.report)}`);
      return {
        status: segmented.ok ? "valid_summary" : "input_incomplete",
        memories: 0, episode: segmented.ok, configs: 0, skipped: !segmented.ok,
        reason: segmented.report.reason, writes: writeStats, segmented: segmented.report,
      };
    }
    writeIncompleteEpisode(episodeDate, allLogs.length, {
      ...diagnostics,
      incompleteReason: "budget_coverage_incomplete",
    });
    return {
      status: "input_incomplete",
      memories: 0,
      episode: false,
      configs: 0,
      skipped: true,
      reason: "budget_coverage_incomplete",
      writes: writeStats,
    };
  }

  if (assessment.status === "no_raw_logs") {
    console.log("[checkpoint] No raw logs found — nothing to extract.");
    writeEmptyEpisode(episodeDate, diagnostics);
    return { status: "empty_input", memories: 0, episode: false, configs: 0, writes: writeStats };
  }

  if (assessment.status === "all_logs_empty") {
    console.log("[checkpoint] All logs empty — nothing to extract.");
    writeEmptyEpisode(episodeDate, diagnostics);
    return { status: "empty_input", memories: 0, episode: false, configs: 0, writes: writeStats };
  }

  if (assessment.status === "no_conversation") {
    console.log(`[checkpoint] No conversation logs found (${assessment.allCount} note entries only) — marking as incomplete, skipping LLM.`);
    writeIncompleteEpisode(episodeDate, assessment.allCount, diagnostics);
    return {
      status: "placeholder_skipped",
      memories: 0,
      episode: false,
      configs: 0,
      skipped: true,
      reason: "no_conversation_data",
      writes: writeStats,
    };
  }

  console.log(`[checkpoint] Conversation entries: ${assessment.conversationCount}, Total entries: ${assessment.allCount}`);

  // Capture versions BEFORE ordinary extraction, not when the response is ready.
  const sourceEvidence = rawLogs.segmentedInput;
  const episodePath = resolve(getRuntime().episodesDir, `${episodeDate}.md`);
  let expectedInput;
  let expectedEpisode;
  let publication;
  let sourceVersionValid = null;
  function versionFailure(reason) {
    console.warn(`[checkpoint] Ordinary summary not published: ${reason}`);
    return {
      status: reason.startsWith("source_") ? "input_incomplete" : "publication_incomplete",
      reason, memories: 0, episode: false, configs: 0, skipped: true,
      source_version_valid: reason.startsWith("source_") ? false : sourceVersionValid,
      publication: { published: false, reason }, writes: writeStats,
    };
  }
  try { expectedInput = JSON.stringify(rawLogs); }
  catch (_) { return versionFailure("source_version_unavailable"); }
  try { expectedEpisode = snapshotEpisode(episodePath); }
  catch (_) { return versionFailure("episode_version_unavailable"); }
  function sourceUnchanged() {
    return rawLogs.segmentedInput === sourceEvidence
      && (!sourceEvidence || (sourceEvidence.targetDate === episodeDate
        && typeof sourceEvidence.unchanged === "function" && sourceEvidence.unchanged() === true))
      && JSON.stringify(rawLogs) === expectedInput;
  }
  function versionReason() {
    try {
      sourceVersionValid = sourceUnchanged();
      if (!sourceVersionValid) return "source_version_changed";
    } catch (_) { sourceVersionValid = null; return "source_version_unavailable"; }
    try {
      if (JSON.stringify(snapshotEpisode(episodePath)) !== JSON.stringify(expectedEpisode)) {
        return "episode_version_changed";
      }
    } catch (_) { return "episode_version_unavailable"; }
    return null;
  }
  const beforeExtraction = versionReason();
  if (beforeExtraction) return versionFailure(beforeExtraction);

  // No output from this extraction may be persisted before this gate.
  let extracted;
  let factInput;
  function summaryFailure(code) {
    const reason = typeof code === "string" && /^(summary_[a-z_]+|output_budget)$/.test(code)
      ? code : "summary_extraction_failed";
    console.warn(`[checkpoint] Ordinary summary rejected: ${reason}`);
    return {
      status: reason.startsWith("summary_input") ? "input_incomplete" : "summary_invalid",
      reason, memories: 0, episode: false, configs: 0, skipped: true,
      source_version_valid: sourceVersionValid,
      summary_input_complete: !reason.startsWith("summary_input"),
      summary_validation: { evidence_valid: false, unit_coverage_complete: false,
        semantic_quality: "not_independently_verified", reason },
      publication: { published: false, reason }, writes: writeStats,
    };
  }
  try {
    factInput = summaryFacts.buildFactInput(rawLogs, episodeDate);
    extracted = await getRuntime().llmNightlyExtract(factInput);
  } catch (error) {
    const changed = versionReason();
    if (changed) return versionFailure(changed);
    return summaryFailure(error.code);
  }
  const afterExtraction = versionReason();
  if (afterExtraction) return versionFailure(afterExtraction);
  if (extracted?.error === "llm超时") return summaryFailure("summary_llm_unavailable");
  try {
    extracted = summaryFacts.validateAndRenderFacts(extracted, factInput);
  } catch (error) {
    return summaryFailure(error.code);
  }
  diagnostics.ordinarySummary = extracted.validation;

  // ── 1. Write structured memories (6 types) ──
  let memWritten = 0;
  const generatedFileRel = resolveOutputTarget({
    provenance: SMART_ADD_PROVENANCE.CHECKPOINT_GENERATED,
  }).fileRel;
  for (const item of extracted.smart_memories || []) {
    if (memWritten >= 10) break;
    if (!item.text || !item.type) continue;

    // Dedup check
    const cat = mapToCategory(item.type);
    const stableText = String(item.text || "").trim();
    if (!stableText) continue;
    if (isDuplicate(item.text, cat, {
      provenance: SMART_ADD_PROVENANCE.CHECKPOINT_GENERATED,
    })) {
      const existingEntryId = resolveExistingCheckpointEntry(stableText, cat, episodeDate);
      if (existingEntryId) {
        bindCheckpointConfidence({
          entryId: existingEntryId,
          text: stableText,
          category: cat,
          fileRel: generatedFileRel,
          section: "smart_memory_pending_recovery",
          type: item.type,
          writeStats,
        });
      } else {
        console.log(`  ↳ Skipped (duplicate): ${stableText.slice(0, 60)}`);
      }
      continue;
    }

    const entryId = appendSmartAdd(item.text, cat, {
      targetDate: episodeDate,
      generatedAt,
      provenance: SMART_ADD_PROVENANCE.CHECKPOINT_GENERATED,
    });
    const effectiveEntryId = entryId || resolveExistingCheckpointEntry(stableText, cat, episodeDate);
    if (!effectiveEntryId) {
      console.log(`  ↳ Skipped (duplicate/fingerprint): ${stableText.slice(0, 60)}`);
      continue;
    }
    if (entryId) {
      writeStats.file_written += 1;
    }
    bindCheckpointConfidence({
      entryId: effectiveEntryId,
      text: stableText,
      category: cat,
      fileRel: generatedFileRel,
      section: entryId ? "smart_memory" : "smart_memory_pending_recovery",
      type: item.type,
      writeStats,
    });
    memWritten++;
  }
  console.log(`[checkpoint] Wrote ${memWritten} structured memory(-ies)`);

  // ── 2. Write episode summary ──
  let episodeWritten = false;
  if (extracted.episode_summary && extracted.episode_summary.trim()) {
    const episodeText = extracted.episode_summary.trim();
    const kgData = mergeKgData(JSON.stringify({
      episode_of: rawLogs.map(r => r.chunk_id || '').filter(Boolean),
      date: episodeDate,
    }), {
      date: episodeDate,
      generatedAt,
      source_type: "checkpoint_llm",
      targetDate: episodeDate,
    });
    const entryId = appendSmartAdd(episodeText, 'episodic', {
      kg_data: kgData,
      targetDate: episodeDate,
      generatedAt,
      provenance: SMART_ADD_PROVENANCE.CHECKPOINT_GENERATED,
    });
    const effectiveEntryId = entryId || resolveExistingCheckpointEntry(episodeText, "episodic", episodeDate);
    if (effectiveEntryId) {
      if (entryId) writeStats.file_written += 1;
      bindCheckpointConfidence({
        entryId: effectiveEntryId,
        text: episodeText,
        category: "episodic",
        fileRel: generatedFileRel,
        section: entryId ? "episode_summary" : "episode_summary_pending_recovery",
        writeStats,
      });
    } else {
      console.log("[checkpoint] Episode smart-add append skipped by fingerprint dedup");
    }

    // Text and derivatives were rendered from validated source quotations above.
    episodeWritten = true;

    if (episodeWritten) {
      try {
        publication = writeEpisodeFiles({
          episodeDate, generatedAt, episodeText, configs: extracted.configs, diagnostics,
          publication: {
            expected: expectedEpisode,
            unchanged: () => { try { return sourceUnchanged(); } catch (_) { return false; } },
          },
        });
      } catch (error) {
        const reason = ["source_version_changed", "episode_version_changed"].includes(error.message)
          ? error.message : "publication_failed";
        const stopped = versionFailure(reason);
        return { ...stopped, memories: memWritten,
          publication: error.publication || stopped.publication, writes: writeStats };
      }
    }
  }

  if (!episodeWritten) {
    writeEmptyEpisode(episodeDate, diagnostics);
  }

  // ── 3. Write configs (existing logic, same format) ──
  let cfgWritten = 0;
  for (const cfg of extracted.configs || []) {
    if (cfgWritten >= 10) break;
    if (!cfg.key || !cfg.value) continue;

    const text = `配置：${cfg.key} = ${cfg.value}（来源：${cfg.context || 'checkpoint'}）`;
    const entryId = appendSmartAdd(text, 'preference', {
      targetDate: episodeDate,
      generatedAt,
      provenance: SMART_ADD_PROVENANCE.CHECKPOINT_GENERATED,
    });
    const effectiveEntryId = entryId || resolveExistingCheckpointEntry(text, "preference", episodeDate);
    if (!effectiveEntryId) {
      console.log(`  ↳ Skipped config (duplicate/fingerprint): ${cfg.key}`);
      continue;
    }
    if (entryId) writeStats.file_written += 1;
    bindCheckpointConfidence({
      entryId: effectiveEntryId,
      text,
      category: "preference",
      fileRel: generatedFileRel,
      section: entryId ? "config" : "config_pending_recovery",
      key: cfg.key,
      writeStats,
    });
    cfgWritten++;
  }
  console.log(`[checkpoint] Wrote ${cfgWritten} config(s)`);

  return {
    status: episodeWritten ? "valid_summary" : "placeholder_skipped",
    summary_validation: extracted.validation,
    memories: memWritten,
    episode: episodeWritten,
    configs: cfgWritten,
    targetDate: episodeDate,
    generatedAt,
    source_type: "checkpoint_llm",
    category: "episodic",
    source_version_valid: true,
    publication,
    writes: writeStats,
  };
}

// ── 配置冲突自动标记 ──

// ── Main ──

async function main(argv = process.argv.slice(2)) {
  const start = Date.now();
  const checkpointDeadline = require("node:perf_hooks").performance.now() + 900000;
  const options = parseCliArgs(argv);
  const targetDate = resolveTargetDate(options);
  console.log(`[checkpoint] === Session Checkpoint ${todayDateStr()} ===`);

  try {
    const flushResult = getRuntime().flushCheckpointRawLog({ targetDate });
    console.log(`[checkpoint] flush status ${JSON.stringify({
      performed: true,
      ok: flushResult?.ok !== false,
      may_write_smart_add_files: true,
      dry_run: options.dryRun,
    })}`);

    let coreIngestion = options.dryRun
      ? { status: "skipped_dry_run", index_invocation: { status: "skipped" }, target_date_coverage: { status: "skipped" } }
      : { status: "failed", error: "Core index ingress was not available", index_invocation: { status: "not_started" }, target_date_coverage: { status: "unverified" } };
    if (!options.dryRun) {
      const runtimeSync = getRuntime().syncCoreMemoryIndex;
      const syncCoreMemoryIndex = runtimeSync || (require.main === module
        ? require("./sync-memory-index.js").runSyncMemoryIndex
        : null);
      if (typeof syncCoreMemoryIndex === "function") {
        try {
          const result = await syncCoreMemoryIndex({ targetDate, force: false });
          const invocation = result?.index_invocation || { status: "unverified", error: null };
          const coverage = result?.target_date_coverage || { status: "unverified", reason: "target-date coverage evidence missing" };
          const expectedPath = `memory/smart-add/${targetDate}.md`;
          const requiredFingerprints = nonNegativeSafeIntegerOrNull(coverage.required_fingerprints);
          const matchedFingerprints = nonNegativeSafeIntegerOrNull(coverage.matched_fingerprints);
          const missingFingerprints = nonNegativeSafeIntegerOrNull(coverage.missing_fingerprints);
          const invocationComplete = invocation.status === "succeeded";
          const coverageComplete = coverage.status === "complete"
            && coverage.target_date === targetDate
            && coverage.path === expectedPath
            && Number.isSafeInteger(requiredFingerprints)
            && requiredFingerprints > 0
            && matchedFingerprints === requiredFingerprints;
          const complete = invocationComplete && coverageComplete && result?.ok !== false;
          const failureReason = result?.error
            || invocation.error
            || coverage.reason
            || (!invocationComplete ? "Core index invocation did not succeed" : null)
            || (!coverageComplete ? "target-date input coverage was not verified" : null);
          coreIngestion = {
            status: complete ? "complete" : "failed",
            target_date: targetDate,
            index_invocation: {
              status: invocation.status || "unverified",
              via: invocation.via || null,
              error: invocation.error || null,
            },
            target_date_coverage: {
              status: coverage.status || "unverified",
              target_date: coverage.target_date || null,
              path: coverage.path || null,
              required_fingerprints: requiredFingerprints,
              matched_fingerprints: matchedFingerprints,
              missing_fingerprints: missingFingerprints,
              reason: coverage.reason || null,
            },
            indexed_files: result?.file_scan?.indexed ?? null,
            updated_files: result?.file_scan?.updated ?? null,
            skipped_files: result?.file_scan?.skipped ?? null,
            error: complete ? null : failureReason || "Core target-date input coverage incomplete",
          };
        } catch (error) {
          coreIngestion = {
            status: "failed",
            error: error?.message ? String(error.message) : String(error),
            index_invocation: { status: "failed", error: error?.message ? String(error.message) : String(error) },
            target_date_coverage: { status: "not_checked", target_date: targetDate, path: `memory/smart-add/${targetDate}.md` },
          };
        }
      }
    }
    console.log(`[checkpoint] Core index ingress ${JSON.stringify(coreIngestion)}`);
    const coreTargetDateCoverageCounts = {
      required_fingerprints: coreIngestion.target_date_coverage?.required_fingerprints ?? null,
      matched_fingerprints: coreIngestion.target_date_coverage?.matched_fingerprints ?? null,
      missing_fingerprints: coreIngestion.target_date_coverage?.missing_fingerprints ?? null,
    };

    // Reconciliation must settle the flushed session_flush input before it is
    // collected for LLM extraction. The sanctioned OpenClaw index ingress
    // runs after flush; dry-run skips it because it may write Core state.
    let engineReconciliation = null;
    let lanceReconciliation = null;
    let lanceSummary = null;
    if (!options.dryRun) {
      try {
        if (coreIngestion.status === "failed") {
          throw new Error(`Core memory index ingress incomplete: ${coreIngestion.error || "target-date coverage unverified"}`);
        }
        engineReconciliation = await getRuntime().reconcileSessionFlushManagedState({
          trigger: "nightly_checkpoint",
          targetDate,
        });
        console.log(`[checkpoint] session_flush Engine reconciliation ${JSON.stringify({
          eligible_core_examined: engineReconciliation?.eligible_core_examined || 0,
          eligible_session_flush: engineReconciliation?.eligible_session_flush || 0,
          excluded_non_session_flush: engineReconciliation?.excluded_non_session_flush || 0,
          ambiguous_chunk_count: engineReconciliation?.ambiguous_chunk_count || 0,
          engine_existing: engineReconciliation?.engine_existing || 0,
          engine_inserted: engineReconciliation?.engine_inserted || 0,
          engine_identity_repaired: engineReconciliation?.engine_identity_repaired || 0,
          engine_identity_missing_before: engineReconciliation?.engine_identity_missing_before || 0,
          engine_identity_missing_after: engineReconciliation?.engine_identity_missing_after || 0,
          engine_backlog_remaining: engineReconciliation?.engine_backlog_remaining || 0,
          engine_converged: engineReconciliation?.engine_converged === true,
          target_date_input_complete: engineReconciliation?.target_date_input_complete === true,
          target_date_backlog_remaining: engineReconciliation?.target_date_backlog_remaining || 0,
          historical_backlog_remaining: engineReconciliation?.historical_backlog_remaining || 0,
          historical_ambiguous_chunk_count: engineReconciliation?.historical_ambiguous_chunk_count || 0,
          stable_identity_state: engineReconciliation?.stable_identity_state || "unknown",
          error: engineReconciliation?.error || null,
        })}`);
        if (engineReconciliation?.ok === false && engineReconciliation.error) {
          console.warn(`[checkpoint] session_flush Engine reconciliation incomplete: ${engineReconciliation.error}`);
        }
      } catch (error) {
        engineReconciliation = {
          ok: false,
          trigger: "nightly_checkpoint",
          eligibleCoreRows: [],
          engine_converged: false,
          target_date_input_complete: false,
          error: error?.message ? String(error.message) : String(error),
        };
        console.warn(`[checkpoint] session_flush Engine reconciliation incomplete: ${engineReconciliation.error}`);
      }
    }

    // Step 1: Gather raw logs after reconciliation so the first run can see
    // the inputs whose Engine associations were just completed.
    const rawLogs = getRuntime().readCheckpointRawLogs({
      targetDate,
      timeZone: getRuntime().timeZone,
      resetDirectParseEnabled: options.legacyResetDirectParse,
    });
    const rawLogStats = checkpointRawLog.getRawLogCollectionStats(rawLogs);
    const diagnostics = buildCheckpointEvidenceDiagnostics(targetDate, rawLogStats);
    console.log(`[checkpoint] Found ${rawLogs.length} raw log entries (targetDate: ${targetDate}, timeZone: ${getRuntime().timeZone})`);
    if (rawLogStats) {
      console.log(`[checkpoint] Input stats ${JSON.stringify(rawLogStats)}`);
    }

    if (options.dryRun) {
      const assessment = checkpointCompleteness.assessCheckpointCompleteness(rawLogs);
      if (rawLogStats) {
        rawLogStats.finalCombinedTextCharCount = assessment.combinedText.length;
      }
      console.log(`[checkpoint] Dry run summary ${JSON.stringify({
        targetDate,
        timeZone: getRuntime().timeZone,
        rawCount: assessment.rawCount,
        allCount: assessment.allCount,
        conversationCount: assessment.conversationCount,
        noteCount: assessment.noteCount,
        combinedTextCharCount: assessment.combinedText.length,
        rawLogIncluded: diagnostics.rawLogIncluded,
        rawLogSkippedOutOfTargetDate: diagnostics.rawLogSkippedOutOfTargetDate,
        rawLogTimeBasis: diagnostics.rawLogTimeBasis,
        resetDirectParseEnabled: diagnostics.resetDirectParseEnabled,
        resetFilesScanned: diagnostics.resetFilesScanned,
        resetEventsIncluded: diagnostics.resetEventsIncluded,
        resetEventsSkippedOutOfTargetDate: diagnostics.resetEventsSkippedOutOfTargetDate,
        resetEventsSkippedMissingTimestamp: diagnostics.resetEventsSkippedMissingTimestamp,
        smartAddPath: diagnostics.smartAddPath,
        smartAddInputPolicy: diagnostics.smartAddInputPolicy,
        smartAddIncluded: diagnostics.smartAddIncluded,
        smartAddConversationIncluded: diagnostics.smartAddConversationIncluded,
        smartAddSkippedUnknownProvenance: diagnostics.smartAddSkippedUnknownProvenance,
        smartAddSkippedCheckpointGenerated: diagnostics.smartAddSkippedCheckpointGenerated,
        budgetCoverageComplete: diagnostics.budgetCoverageComplete,
        budgetExcludedCount: diagnostics.budgetExcludedCount,
        budgetTruncatedCount: diagnostics.budgetTruncatedCount,
        budgetUncoveredEntries: diagnostics.budgetUncoveredEntries,
        generatedEpisodePath: diagnostics.generatedEpisodePath,
        flushPerformed: true,
        flushMayWriteSmartAddFiles: true,
      })}`);
      return {
        dryRun: true,
        targetDate,
        flush: { performed: true, mayWriteSmartAddFiles: true },
        stats: rawLogStats,
        assessment,
      };
    }

    const engineComplete = options.dryRun || (
      engineReconciliation?.ok !== false
      && (engineReconciliation?.target_date_input_complete === undefined
        ? engineReconciliation?.engine_converged === true
        : engineReconciliation?.target_date_input_complete === true)
    );
    if (!engineComplete) {
      const reasons = [];
      if (engineReconciliation?.error) reasons.push(`Engine=${engineReconciliation.error}`);
      if (engineReconciliation?.target_date_backlog_remaining) {
        reasons.push(`target_date_backlog=${engineReconciliation.target_date_backlog_remaining}`);
      }
      if (engineReconciliation?.target_date_ambiguous_chunk_count) {
        reasons.push(`target_date_ambiguous=${engineReconciliation.target_date_ambiguous_chunk_count}`);
      }
      if (reasons.length === 0) reasons.push("target_date_not_converged");
      const reason = reasons.join("; ");
      console.error(`[checkpoint] ❌ Input incomplete after session_flush reconciliation; LLM skipped: ${reason}`);
      const incompleteStatus = {
        status: "input_incomplete",
        business_complete: false,
        summary_status: "not_run",
        core_ingestion: coreIngestion.status,
        core_index_invocation: coreIngestion.index_invocation?.status || "unknown",
        core_target_date_coverage: coreIngestion.target_date_coverage?.status || "unknown",
        core_target_date_coverage_counts: coreTargetDateCoverageCounts,
        input_complete: false,
        budget_coverage_complete: diagnostics.budgetCoverageComplete,
        budget_uncovered_entries: diagnostics.budgetUncoveredEntries,
        reason,
      };
      console.log(`[checkpoint] Business status ${JSON.stringify(incompleteStatus)}`);
      writeIncompleteEpisode(targetDate, rawLogs.length, {
        ...diagnostics,
        incompleteReason: reason,
      });
      getRuntime().resolveConfigConflicts();
      const incomplete = new Error(`checkpoint input incomplete: ${reason}`);
      incomplete.code = "CHECKPOINT_INPUT_INCOMPLETE";
      incomplete.businessStatus = incompleteStatus;
      incomplete.reconciliation = engineReconciliation;
      throw incomplete;
    }

    const pendingRecovery = retryPendingCheckpointEntries();
    console.log(`[checkpoint] Pending generated-entry recovery ${JSON.stringify(pendingRecovery)}`);

    // Step 2: Ordinary extraction or the bounded, fully covered long-session summary.
    const result = await nightlyCheckpoint(rawLogs, { targetDate, rawLogStats,
      inputReady: engineComplete && coreIngestion.status === "complete",
      parentDeadline: checkpointDeadline,
    });

    // Step 2.5: Reconcile only active session_flush Engine IDs into LanceDB.
    // This remains after LLM extraction: Engine convergence gates the input,
    // while a retryable vector backlog must be reported independently.
    try {
      lanceReconciliation = await getRuntime().repairOrphanVectors({
        scope: "session_flush",
        trigger: "nightly_checkpoint",
        eligibleCoreRows: engineReconciliation?.eligibleCoreRows || [],
        engineReconciliation,
      });
      lanceSummary = typeof lanceReconciliation === "number"
        ? { lance_added: lanceReconciliation, lance_converged: true }
        : lanceReconciliation || {};
      console.log(`[checkpoint] session_flush Lance reconciliation ${JSON.stringify({
        lance_eligible: lanceSummary.lance_eligible || 0,
        lance_existing: lanceSummary.lance_existing || 0,
        lance_added: lanceSummary.lance_added || 0,
        lance_failed: lanceSummary.lance_failed || 0,
        lance_operation_failed: lanceSummary.lance_operation_failed || 0,
        lance_write_failed: lanceSummary.lance_write_failed || 0,
        lance_limit_backlog_remaining: lanceSummary.lance_limit_backlog_remaining || 0,
        lance_backlog_remaining: lanceSummary.lance_backlog_remaining || 0,
        lance_converged: lanceSummary.lance_converged === true,
        lance_membership_complete: lanceSummary.lance_membership_complete === true,
        lance_membership_state: lanceSummary.lance_membership_state || "unknown",
        lance_vector_validation_complete: lanceSummary.lance_vector_validation_complete === true,
        lance_vector_validation_state: lanceSummary.lance_vector_validation_state || "unknown",
        lance_fingerprint_conflicts: lanceSummary.lance_fingerprint_conflicts || 0,
        lance_skipped_unknown_legacy: lanceSummary.lance_skipped_unknown_legacy || 0,
        lance_input_state: lanceSummary.lance_input_state || "unknown",
        lance_completion_state: lanceSummary.lance_completion_state || "unknown",
        fingerprint_verification: lanceSummary.fingerprint_verification || "unverified",
        fingerprint_verification_reason: lanceSummary.fingerprint_verification_reason || null,
        error: lanceSummary.error || null,
      })}`);
      if (lanceSummary.ok === false) {
        console.warn(`[checkpoint] session_flush Lance reconciliation incomplete: ${lanceSummary.error || lanceSummary.lance_vector_validation_state || "unknown reason"}`);
      }
    } catch (error) {
      lanceReconciliation = {
        ok: false,
        lance_converged: false,
        error: error?.message ? String(error.message) : String(error),
      };
      lanceSummary = lanceReconciliation;
      console.warn(`[checkpoint] session_flush Lance reconciliation incomplete: ${lanceReconciliation.error}`);
    }

    const repaired = typeof lanceReconciliation === "number"
      ? lanceReconciliation
      : Number(lanceReconciliation?.lance_added || 0);

    // Step 3: Resolve config conflicts (existing logic, kept)
    const conflicts = getRuntime().resolveConfigConflicts();

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    if (result.publication?.published === false) {
      console.log(`[checkpoint] Summary not published: ${result.reason || "publication_incomplete"} — ${elapsed}s`);
    } else if (result.timeout) {
      console.log(`[checkpoint] ⏰ llm超时 — completed in ${elapsed}s`);
    } else if (result.status === "empty_input") {
      console.log(`[checkpoint] Empty input — no summary generated (${elapsed}s)`);
    } else if (result.skipped) {
      console.log(`[checkpoint] ⏭ Skipped (no conversation data) — ${elapsed}s`);
    } else if (result.status !== "valid_summary") {
      console.log(`[checkpoint] Placeholder/skipped output — no valid summary (${elapsed}s)`);
    } else {
      console.log(`[checkpoint] ✅ Completed in ${elapsed}s — ${result.memories} memories, ${result.episode ? 'episode' : 'no episode'}, ${result.configs} configs, writes=${JSON.stringify(result.writes || emptyCheckpointWriteStats())}, ${repaired} vectors repaired, ${conflicts} conflicts`);
    }
    const vectorTaskComplete = ["empty_input", "no_active_rows"].includes(lanceSummary?.lance_completion_state)
      || (lanceSummary?.lance_membership_complete === true
        && lanceSummary?.lance_vector_validation_complete === true);
    const vectorTaskBlockedByIsolation = Number(lanceSummary?.lance_skipped_unknown_legacy || 0) > 0;
    const vectorFailureCounts = [
      lanceSummary?.lance_failed, lanceSummary?.lance_operation_failed,
      lanceSummary?.lance_write_failed, lanceSummary?.lance_fingerprint_conflicts,
    ];
    // Scoped repair's ok=false also means capped membership. Only this fully
    // evidenced, error-free deferral may avoid turning a valid summary into a
    // process failure; it still cannot imply vector/business convergence.
    const vectorLimitDeferred = lanceSummary?.ok === false
      && lanceSummary.lance_input_state === "present"
      && lanceSummary.lance_completion_state === "limit_backlog"
      && lanceSummary.lance_membership_state === "limit_backlog"
      && lanceSummary.lance_membership_complete === false
      && lanceSummary.lance_converged === false
      && Number.isSafeInteger(lanceSummary.lance_limit_backlog_remaining)
      && lanceSummary.lance_limit_backlog_remaining > 0
      && lanceSummary.lance_backlog_remaining === lanceSummary.lance_limit_backlog_remaining
      && lanceSummary.lance_skipped_unknown_legacy === 0
      && ["verified", "unverified"].includes(lanceSummary.lance_vector_validation_state)
      && vectorFailureCounts.every(value => value === 0)
      && !lanceSummary.error;
    const vectorResultKnown = typeof lanceSummary?.ok === "boolean"
      || typeof lanceReconciliation === "number" || vectorTaskComplete
      || lanceSummary?.lance_converged === true
      || ["empty_input", "no_active_rows"].includes(lanceSummary?.lance_completion_state);
    const vectorOperationFailed = !vectorResultKnown
      || vectorFailureCounts.some(value => value !== undefined
        && (!Number.isSafeInteger(value) || value !== 0))
      || Boolean(lanceSummary?.error)
      || lanceSummary?.lance_vector_validation_state === "conflict"
      || ["write_failed", "operation_failed"].includes(lanceSummary?.lance_completion_state)
      || (lanceSummary?.ok === false && !vectorLimitDeferred);
    const vectorOperationStatus = vectorOperationFailed ? "failed"
      : vectorLimitDeferred ? "deferred_limit" : "completed";
    const summaryInputComplete = result.source_version_valid !== false
      && result.summary_input_complete !== false
      && (diagnostics.budgetCoverageComplete !== false || result.segmented?.day_coverage_complete === true);
    const summaryPublication = result.segmented?.publication || result.publication;
    const publicationComplete = summaryPublication?.published !== false
      && summaryPublication?.cleanup_complete !== false
      && summaryPublication?.mirror?.status !== "failed";
    const businessStatus = {
      publication_complete: publicationComplete,
      segmented_summary: result.segmented || null,
      ordinary_publication: result.publication || null,
      ordinary_source_version_valid: result.source_version_valid ?? null,
      ordinary_summary_validation: result.summary_validation || null,
      summary_input_complete: summaryInputComplete,
      status: !summaryInputComplete
        || engineReconciliation?.target_date_input_complete !== true
        ? "input_incomplete"
        : result.status || (result.timeout ? "timeout" : result.skipped ? "placeholder_skipped" : "valid_summary"),
      business_complete: summaryInputComplete && publicationComplete
        && engineReconciliation?.target_date_input_complete === true
        && result.status === "valid_summary"
        && !vectorOperationFailed
        && vectorTaskComplete
        && !vectorTaskBlockedByIsolation,
      summary_status: result.status || (result.timeout ? "timeout" : result.skipped ? "placeholder_skipped" : "valid_summary"),
      core_ingestion: coreIngestion.status,
      core_index_invocation: coreIngestion.index_invocation?.status || "unknown",
      core_target_date_coverage: coreIngestion.target_date_coverage?.status || "unknown",
      core_target_date_coverage_counts: coreTargetDateCoverageCounts,
      input_complete: engineReconciliation?.target_date_input_complete === true,
      budget_coverage_complete: diagnostics.budgetCoverageComplete !== false,
      budget_uncovered_entries: diagnostics.budgetUncoveredEntries,
      engine_identity_repaired: engineReconciliation?.engine_identity_repaired || 0,
      engine_identity_missing_before: engineReconciliation?.engine_identity_missing_before || 0,
      engine_identity_missing_after: engineReconciliation?.engine_identity_missing_after || 0,
      extraction: result.status || (result.timeout ? "timeout" : result.skipped ? "placeholder_skipped" : "valid_summary"),
      vector_operation_status: vectorOperationStatus,
      vector_completion: lanceSummary?.lance_completion_state || "unknown",
      vector_membership_complete: lanceSummary?.lance_membership_complete === true,
      vector_membership_state: lanceSummary?.lance_membership_state || "unknown",
      vector_validation_complete: lanceSummary?.lance_vector_validation_complete === true,
      vector_validation_state: lanceSummary?.lance_vector_validation_state || lanceSummary?.fingerprint_verification || "unknown",
      vector_fingerprint_conflicts: lanceSummary?.lance_fingerprint_conflicts || 0,
      vector_skipped_unknown_legacy: lanceSummary?.lance_skipped_unknown_legacy || 0,
      vector_write_failures: lanceSummary?.lance_write_failed || 0,
      vector_operation_failures: lanceSummary?.lance_operation_failed || 0,
      vector_limit_backlog: lanceSummary?.lance_limit_backlog_remaining || 0,
      vector_input: lanceSummary?.lance_input_state || "unknown",
    };
    console.log(`[checkpoint] Business status ${JSON.stringify(businessStatus)}`);
    return {
      ok: publicationComplete && businessStatus.status !== "input_incomplete"
        && businessStatus.status !== "publication_incomplete"
        && businessStatus.status !== "timeout"
        && businessStatus.vector_validation_state !== "conflict"
        && !vectorOperationFailed,
      businessStatus,
    };
  } catch (e) {
    console.error("[checkpoint] ❌ Failed:", e.message);
    if (require.main !== module) throw e;
    process.exit(1);
  }
}

runtimeRegistry.installRuntimeFallbacks({
  llmNightlyExtract: checkpointLlm.llmNightlyExtract,
  readCheckpointRawLogs: checkpointRawLog.readCheckpointRawLogs,
  readYesterdayRawLogs: checkpointRawLog.readYesterdayRawLogs,
  flushCheckpointRawLog: runFlushSessionRawlogCheckpoint,
  reconcileSessionFlushManagedState,
  repairOrphanVectors,
  resolveConfigConflicts,
});

if (require.main === module) {
  main().then(result => {
    if (result?.ok === false) process.exitCode = 1;
  }).catch(error => {
    console.error("[checkpoint] ❌ Failed:", error?.message || error);
    process.exitCode = 1;
  });
}

// Public/legacy exports used by tests and external callers.
module.exports = {
  inspectBusyTimeouts,
  inspectCheckpointBusyTimeouts,
  main,
  yesterdayDateStr,
  resolveTargetDate,
  buildNightlyEntryId,
  buildCheckpointEvidenceDiagnostics,
  mergeKgData,
  nightlyCheckpoint,
  retryPendingCheckpointEntries,
  parseCliArgs,
  runFlushSessionRawlogCheckpoint,
  withRuntime,
};
