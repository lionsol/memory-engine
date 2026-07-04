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
const { resolve } = require("node:path");
const checkpointDate = require("../lib/checkpoint/date");
const checkpointCompleteness = require("../lib/checkpoint/completeness");
const { resolveConfigConflicts } = require("../lib/checkpoint/conflict-resolver");
const { writeConfidence } = require("../lib/checkpoint/confidence-writer");
const { inspectBusyTimeouts } = require("../lib/checkpoint/db");
const { writeEpisodeFiles } = require("../lib/checkpoint/episode-writer");
const checkpointLlm = require("../lib/checkpoint/llm");
const { writeEmptyEpisode, writeIncompleteEpisode, writeLLMTimeoutEpisode } = require("../lib/checkpoint/markers");
const { repairOrphanVectors } = require("../lib/checkpoint/orphan-repair");
const checkpointRawLog = require("../lib/checkpoint/raw-log");
const {
  SMART_ADD_PROVENANCE,
  mapToCategory,
  appendSmartAdd,
  readSmartAddFingerprints,
  isDuplicate,
  resolveOutputTarget,
} = require("../lib/checkpoint/smart-add-writer");
const { getRuntime, withRuntime } = require("../lib/checkpoint/runtime");
const runtimeRegistry = require("../lib/checkpoint/runtime");

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
    smartAddSkippedUnknownProvenance: stats.smartAddSkippedUnknownProvenance || 0,
    smartAddSkippedCheckpointGenerated: stats.smartAddSkippedCheckpointGenerated || 0,
    generatedEpisodePath: resolve(rt.episodesDir, `${targetDate}.md`),
    evidenceDateFilter: stats.evidenceDateFilter
      || `targetDate=${targetDate}; timeZone=${rt.timeZone}; smartAdd=memory/smart-add/${targetDate}.md; raw_log=created_at/event_time bounded to targetDate`,
    rawLogTimeBasis: stats.rawLogTimeBasis || "created_at/event_time",
    rawLogTimeBasisNote: stats.rawLogTimeBasisNote || "prefer original event creation time; fallback requires updated_at to carry event time, not flush time",
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
} = {}) {
  const result = spawnSyncImpl(nodeExecPath, [scriptPath, "--checkpoint"], {
    cwd,
    env,
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

// ── Read today's raw content ──

// ── Unified Nightly Smart Extraction ──

/**
 * Run the full nightly checkpoint: one LLM call → 4 outputs.
 */
async function nightlyCheckpoint(rawLogs, options = {}) {
  const episodeDate = resolveTargetDate(options);
  const generatedAt = currentIsoString();
  const diagnostics = buildCheckpointEvidenceDiagnostics(episodeDate, options.rawLogStats);
  const assessment = checkpointCompleteness.assessCheckpointCompleteness(rawLogs);
  const conversationLogs = assessment.conversationLogs;
  const allLogs = assessment.allLogs;
  const combinedText = assessment.combinedText;

  if (assessment.status === "no_raw_logs") {
    console.log("[checkpoint] No raw logs found — nothing to extract.");
    writeEmptyEpisode(episodeDate, diagnostics);
    return { memories: 0, episode: false, configs: 0 };
  }

  if (assessment.status === "all_logs_empty") {
    console.log("[checkpoint] All logs empty — nothing to extract.");
    writeEmptyEpisode(episodeDate, diagnostics);
    return { memories: 0, episode: false, configs: 0 };
  }

  if (assessment.status === "no_conversation") {
    console.log(`[checkpoint] No conversation logs found (${assessment.allCount} note entries only) — marking as incomplete, skipping LLM.`);
    writeIncompleteEpisode(episodeDate, assessment.allCount, diagnostics);
    return { memories: 0, episode: false, configs: 0, skipped: true, reason: "no_conversation_data" };
  }

  console.log(`[checkpoint] Conversation entries: ${assessment.conversationCount}, Total entries: ${assessment.allCount}`);

  // ── Single LLM call ──
  let extracted;
  try {
    extracted = await getRuntime().llmNightlyExtract(combinedText);
  } catch (error) {
    console.error(`[checkpoint] LLM extraction failed: ${error.message}`);
    writeLLMTimeoutEpisode(episodeDate, diagnostics);
    return { memories: 0, episode: false, configs: 0, timeout: true, error: error.message };
  }

  // ── Timeout guard: llm超时 → write marker episode and exit early ──
  if (extracted.error === "llm超时") {
    console.log("[checkpoint] llm超时 — both providers failed");
    writeLLMTimeoutEpisode(episodeDate, diagnostics);
    return { memories: 0, episode: false, configs: 0, timeout: true };
  }

  // ── 1. Write structured memories (6 types) ──
  let memWritten = 0;
  const generatedFileRel = resolveOutputTarget({
    provenance: SMART_ADD_PROVENANCE.CHECKPOINT_GENERATED,
  }).fileRel;
  for (const item of extracted.smart_memories || []) {
    if (memWritten >= 10) break;
    if (!item.text || !item.type) continue;

    // Dedup check
    if (isDuplicate(item.text, mapToCategory(item.type), {
      provenance: SMART_ADD_PROVENANCE.CHECKPOINT_GENERATED,
    })) {
      console.log(`  ↳ Skipped (duplicate): ${item.text.slice(0, 60)}`);
      continue;
    }

    const cat = mapToCategory(item.type);
    const stableText = String(item.text || "").trim();
    if (!stableText) continue;
    const entryId = appendSmartAdd(item.text, cat, {
      targetDate: episodeDate,
      generatedAt,
      provenance: SMART_ADD_PROVENANCE.CHECKPOINT_GENERATED,
    });
    if (!entryId) {
      console.log(`  ↳ Skipped (duplicate/fingerprint): ${stableText.slice(0, 60)}`);
      continue;
    }
    try {
      writeConfidence(entryId, item.text, cat, { fileRel: generatedFileRel });
    } catch (e) {
      warnConfidenceWriteFailure({
        entryId,
        category: cat,
        section: "smart_memory",
        type: item.type,
        error: e,
      });
    }
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
    if (entryId) {
      try {
        writeConfidence(entryId, episodeText, 'episodic', { fileRel: generatedFileRel });
      } catch (e) {
        warnConfidenceWriteFailure({
          entryId,
          category: "episodic",
          section: "episode_summary",
          error: e,
        });
      }
    } else {
      console.log("[checkpoint] Episode smart-add append skipped by fingerprint dedup");
    }

    // Default to valid; will be overridden if hallucination detected
    episodeWritten = true;

    // Validate: if no real conversation data found, any "讨论/进行/决定" is hallucination
    if (conversationLogs.length === 0) {
      const halluPatterns = [
        /讨论了/, /进行了/, /决定/, /确认/, /提到/,
        /讨论/, /对话/, /交流/, /沟通/, /商议/
      ];
      const isHallucinated = halluPatterns.some(p => p.test(episodeText));
      if (isHallucinated) {
        console.warn(`[checkpoint] ⚠️ Episode hallucinated (0 conversation logs, ${allLogs.length} note entries). Discarding.`);
        episodeWritten = false;
        writeIncompleteEpisode(episodeDate, allLogs.length, diagnostics);
      } else {
        // No conversation but no hallucination keywords — write data-only episode
        console.log(`[checkpoint] No conversation logs, but episode text doesn't mention discussion. Writing as-is.`);
      }
    }

    if (episodeWritten) {
      writeEpisodeFiles({
        episodeDate,
        generatedAt,
        episodeText,
        configs: extracted.configs,
        diagnostics,
      });
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
    if (!entryId) {
      console.log(`  ↳ Skipped config (duplicate/fingerprint): ${cfg.key}`);
      continue;
    }
    try {
      writeConfidence(entryId, text, 'preference', { fileRel: generatedFileRel });
    } catch (e) {
      warnConfidenceWriteFailure({
        entryId,
        category: "preference",
        section: "config",
        key: cfg.key,
        error: e,
      });
    }
    cfgWritten++;
  }
  console.log(`[checkpoint] Wrote ${cfgWritten} config(s)`);

  return {
    memories: memWritten,
    episode: episodeWritten,
    configs: cfgWritten,
    targetDate: episodeDate,
    generatedAt,
    source_type: "checkpoint_llm",
    category: "episodic",
  };
}

// ── 配置冲突自动标记 ──

// ── Main ──

async function main(argv = process.argv.slice(2)) {
  const start = Date.now();
  const options = parseCliArgs(argv);
  const targetDate = resolveTargetDate(options);
  console.log(`[checkpoint] === Session Checkpoint ${todayDateStr()} ===`);

  try {
    getRuntime().flushCheckpointRawLog();

    // Step 1: Gather raw logs
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
        smartAddSkippedUnknownProvenance: diagnostics.smartAddSkippedUnknownProvenance,
        smartAddSkippedCheckpointGenerated: diagnostics.smartAddSkippedCheckpointGenerated,
        generatedEpisodePath: diagnostics.generatedEpisodePath,
      })}`);
      return {
        dryRun: true,
        targetDate,
        stats: rawLogStats,
        assessment,
      };
    }

    // Step 2: Unified nightly checkpoint (1 LLM call → 3 outputs)
    const result = await nightlyCheckpoint(rawLogs, { targetDate, rawLogStats });

    // Step 2.5: Repair orphan vectors (SQLite has, LanceDB missing)
    const repaired = await getRuntime().repairOrphanVectors();

    // Step 3: Resolve config conflicts (existing logic, kept)
    const conflicts = getRuntime().resolveConfigConflicts();

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    if (result.timeout) {
      console.log(`[checkpoint] ⏰ llm超时 — completed in ${elapsed}s`);
    } else if (result.skipped) {
      console.log(`[checkpoint] ⏭ Skipped (no conversation data) — ${elapsed}s`);
    } else {
      console.log(`[checkpoint] ✅ Completed in ${elapsed}s — ${result.memories} memories, ${result.episode ? 'episode' : 'no episode'}, ${result.configs} configs, ${repaired} vectors repaired, ${conflicts} conflicts`);
    }
  } catch (e) {
    console.error("[checkpoint] ❌ Failed:", e.message);
    process.exit(1);
  }
}

runtimeRegistry.installRuntimeFallbacks({
  llmNightlyExtract: checkpointLlm.llmNightlyExtract,
  readCheckpointRawLogs: checkpointRawLog.readCheckpointRawLogs,
  readYesterdayRawLogs: checkpointRawLog.readYesterdayRawLogs,
  flushCheckpointRawLog: runFlushSessionRawlogCheckpoint,
  repairOrphanVectors,
  resolveConfigConflicts,
});

if (require.main === module) {
  main();
}

// Public/legacy exports used by tests and external callers.
module.exports = {
  inspectBusyTimeouts,
  main,
  yesterdayDateStr,
  resolveTargetDate,
  buildNightlyEntryId,
  buildCheckpointEvidenceDiagnostics,
  mergeKgData,
  nightlyCheckpoint,
  parseCliArgs,
  runFlushSessionRawlogCheckpoint,
  withRuntime,
};
