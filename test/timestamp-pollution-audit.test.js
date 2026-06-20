import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { detectTimestampPollution } from "../lib/quality/timestamp-pollution.js";
import { evaluateQualityFlags } from "../lib/quality/quality-rules.js";

const require = createRequire(import.meta.url);
const checkpoint = require("../bin/session-checkpoint.js");
const checkpointEpisodeWriter = require("../lib/checkpoint/episode-writer.js");
const smartAddWriter = require("../lib/checkpoint/smart-add-writer.js");

async function importAuditModule(tag = Date.now()) {
  return import(`../lib/quality/timestamp-pollution-audit.js?ts=${tag}`);
}

function createCheckpointFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-timestamp-pollution-"));
  const memoryDir = resolve(root, "memory");
  const episodesDir = resolve(memoryDir, "episodes");
  const smartAddDir = resolve(memoryDir, "smart-add");
  mkdirSync(episodesDir, { recursive: true });
  mkdirSync(smartAddDir, { recursive: true });
  return { root, memoryDir, episodesDir, smartAddDir };
}

function buildCandidate(overrides = {}) {
  return {
    id: "chunk-1",
    path: "memory/smart-add/2026-06-18.md",
    text: "plain text",
    category: "raw_log",
    source: "memory",
    updated_at: 1781740800000,
    retrieved_count: 0,
    injected_count: 0,
    quality_scope_family: "smart_add",
    quality_scope_owner: "memory_engine_lifecycle",
    expected_confidence: true,
    default_quality_score_scope: true,
    diagnostic_scope: true,
    retrieval_visible: true,
    has_confidence_record: true,
    ...overrides,
  };
}

test("detectTimestampPollution detects current regex patterns deterministically", () => {
  const iso = detectTimestampPollution("completed at 2026-06-18T10:01:02Z");
  const spaced = detectTimestampPollution("completed at 2026-06-18 10:01:02");
  const bracketed = detectTimestampPollution("[flush 10:01:02] done");

  assert.deepEqual(iso, {
    detected: true,
    detected_pattern: "iso_utc_datetime",
    matched_text: "2026-06-18T10:01:02Z",
    classification: "embedded_log_timestamp",
    penalize: true,
    reason: "timestamp is embedded in memory content rather than isolated as structured document metadata",
  });
  assert.equal(spaced.detected_pattern, "spaced_datetime");
  assert.equal(bracketed.detected_pattern, "bracketed_time_prefix");
  assert.equal(bracketed.classification, "raw_log_operational_residue");
});

test("normal markdown date headings are not flagged as timestamp pollution", () => {
  const detected = detectTimestampPollution("## 2026-06-08 会议纪要\n\n这是一条正常笔记。");
  assert.deepEqual(detected, {
    detected: false,
    detected_pattern: null,
    matched_text: null,
    classification: null,
    penalize: false,
    reason: null,
  });
});

test("session headings and episode generatedAt metadata are not default timestamp pollution", () => {
  const sessionHeading = detectTimestampPollution("# Session: 2026-05-10 20:37:27 GMT+8\n\n## Conversation");
  const generatedField = detectTimestampPollution("generatedAt: 2026-06-18T01:23:45.000Z");
  const generatedFooter = detectTimestampPollution("_Generated at 2026-06-18T01:23:45.000Z — 基于 6/1 复盘补录_");

  assert.equal(sessionHeading.detected, false);
  assert.equal(sessionHeading.classification, "normal_session_heading");
  assert.equal(generatedField.detected, false);
  assert.equal(generatedField.classification, "structured_generated_metadata");
  assert.equal(generatedFooter.detected, false);
  assert.equal(generatedFooter.classification, "structured_generated_metadata");
});

test("episode writer output keeps structured timestamps but is not default pollution", async () => {
  const fixture = createCheckpointFixture();

  await checkpoint.withRuntime({
    episodesDir: fixture.episodesDir,
    memoryDir: fixture.memoryDir,
  }, async () => {
    checkpointEpisodeWriter.writeEpisodeFiles({
      episodeDate: "2026-06-17",
      generatedAt: "2026-06-18T01:23:45.000Z",
      episodeText: "episode summary body",
      configs: [],
    });
  });

  const content = readFileSync(resolve(fixture.episodesDir, "2026-06-17.md"), "utf8");
  const detection = detectTimestampPollution(content);
  const evaluated = evaluateQualityFlags({
    id: "episode-1",
    path: "memory/episodes/2026-06-17.md",
    text: content,
    category: "episodic",
    has_confidence_record: true,
  }, { nowSec: 1719000000 });

  assert.equal(detection.detected, false);
  assert.equal(detection.classification, "structured_generated_metadata");
  assert.equal(evaluated.p0_flags.includes("timestamp_pollution"), false);
});

test("smart-add writer keeps clean facts clean but operational timestamps remain pollution", async () => {
  const fixture = createCheckpointFixture();

  await checkpoint.withRuntime({
    smartAddDir: fixture.smartAddDir,
    memoryDir: fixture.memoryDir,
    now: () => new Date("2026-06-18T01:23:45.000Z"),
  }, async () => {
    smartAddWriter.appendSmartAdd("clean user preference fact", "preference", {
      entryId: "clean_entry",
      targetDate: "2026-06-17",
      generatedAt: "2026-06-18T01:23:45.000Z",
    });
    smartAddWriter.appendSmartAdd("[2026-05-09 16:21:33][ERROR] Failed to load model", "raw_log", {
      entryId: "polluted_entry",
      targetDate: "2026-06-17",
      generatedAt: "2026-06-18T01:23:45.000Z",
    });
  });

  const content = readFileSync(resolve(fixture.smartAddDir, "2026-06-18.md"), "utf8");
  const cleanBlock = content.match(/## clean_entry[\s\S]*?(?=\n<!-- smart-add-fingerprint:|\s*$)/)?.[0] || "";
  const pollutedBlock = content.match(/## polluted_entry[\s\S]*?(?=\n<!-- smart-add-fingerprint:|\s*$)/)?.[0] || "";

  assert.equal(detectTimestampPollution(cleanBlock).detected, false);
  assert.equal(detectTimestampPollution(pollutedBlock).detected, true);
  assert.equal(detectTimestampPollution(pollutedBlock).classification, "raw_log_operational_residue");
});

test("likely source classification distinguishes raw-log, autoRecall, healthcheck, generated, and smart-add residue", async () => {
  const mod = await importAuditModule();
  assert.equal(
    mod.inferLikelySource(
      buildCandidate({ text: "**User:** hi\n**Assistant:** hello\n**User:** continue" }),
      { detected: true, detected_pattern: "spaced_datetime" },
    ),
    "checkpoint_input",
  );
  assert.equal(
    mod.inferLikelySource(
      buildCandidate({ text: "memory_candidate_retrieved final_score=0.88 lexical_confidence=0.7 2026-06-18T10:01:02Z" }),
      { detected: true, detected_pattern: "iso_utc_datetime" },
    ),
    "autoRecall_trace",
  );
  assert.equal(
    mod.inferLikelySource(
      buildCandidate({ text: "## 2026-06-08 01:00 硅基流动健康检查 ✅ LLM — OK ✅ Embedding — OK ✅ Vision — OK" }),
      { detected: true, detected_pattern: "spaced_datetime" },
    ),
    "healthcheck_note",
  );
  assert.equal(
    mod.inferLikelySource(
      buildCandidate({ path: "memory/dreaming/light/2026-06-18.md", quality_scope_family: "dreaming", quality_scope_owner: "memory_engine_generated_or_diagnostic", text: "2026-06-18T10:01:02Z dream output" }),
      { detected: true, detected_pattern: "iso_utc_datetime" },
    ),
    "generated_artifact",
  );
  assert.equal(
    mod.inferLikelySource(
      buildCandidate({ text: "fact with 2026-06-18T10:01:02Z embedded" }),
      { detected: true, detected_pattern: "iso_utc_datetime" },
    ),
    "smart_add_writer",
  );
});

test("buildTimestampPollutionAudit produces owner/scope breakdown and retrieval aggregation", async () => {
  const mod = await importAuditModule();
  const candidateSource = {
    candidates: [
      buildCandidate({
        id: "life-1",
        text: "[2026-06-18 10:01:02] sync complete",
        updated_at: 1781740800000,
        retrieved_count: 2,
        injected_count: 1,
      }),
      buildCandidate({
        id: "core-1",
        path: "memory/2026-06-18.md",
        quality_scope_family: "daily_memory",
        quality_scope_owner: "openclaw_core",
        default_quality_score_scope: false,
        retrieval_visible: true,
        category: null,
        text: "2026-06-18T10:01:02Z daily operational note",
        updated_at: 1781481600000,
      }),
      buildCandidate({
        id: "clean-1",
        text: "plain text without timestamp",
      }),
    ],
  };
  const pathMetadata = new Map([
    ["memory/smart-add/2026-06-18.md", { file_mtime: 1781740800000, file_source: "memory" }],
    ["memory/2026-06-18.md", { file_mtime: 1781481600000, file_source: "memory" }],
  ]);

  const report = mod.buildTimestampPollutionAudit({
    generatedAt: "2026-06-20T00:00:00.000Z",
    candidateSource,
    pathMetadata,
  });

  assert.equal(report.summary.timestamp_pollution_total, 2);
  assert.equal(report.summary.default_scope_count, 1);
  assert.equal(report.summary.all_scope_count, 2);
  assert.equal(report.summary.lifecycle_owned_count, 1);
  assert.equal(report.summary.core_owned_count, 1);
  assert.equal(report.summary.retrieved_count_total, 2);
  assert.equal(report.summary.injected_count_total, 1);
  assert.equal(report.summary.entries_ever_retrieved, 1);
  assert.equal(report.summary.entries_ever_injected, 1);
  assert.equal(report.breakdowns.by_owner[0].owner, "memory_engine_lifecycle");
});

test("buildTimestampPollutionAudit output is deterministic", async () => {
  const mod = await importAuditModule();
  const candidateSource = {
    candidates: [
      buildCandidate({
        id: "b",
        path: "memory/smart-add/2026-06-19.md",
        text: "2026-06-19T10:01:02Z later",
        updated_at: 1781827200000,
      }),
      buildCandidate({
        id: "a",
        text: "2026-06-18T10:01:02Z earlier",
        updated_at: 1781740800000,
      }),
    ],
  };
  const pathMetadata = new Map([
    ["memory/smart-add/2026-06-18.md", { file_mtime: 1781740800000, file_source: "memory" }],
    ["memory/smart-add/2026-06-19.md", { file_mtime: 1781827200000, file_source: "memory" }],
  ]);

  const first = mod.buildTimestampPollutionAudit({
    generatedAt: "2026-06-20T00:00:00.000Z",
    candidateSource,
    pathMetadata,
  });
  const second = mod.buildTimestampPollutionAudit({
    generatedAt: "2026-06-20T00:00:00.000Z",
    candidateSource,
    pathMetadata,
  });

  assert.deepEqual(first, second);
  assert.deepEqual(first.samples.default_scope_examples.map(item => item.chunk_id), ["a", "b"]);
});

test("historical vs ambiguous vs recent buckets are stable", async () => {
  const mod = await importAuditModule();
  const candidateSource = {
    candidates: [
      buildCandidate({
        id: "old",
        text: "2026-06-01T10:01:02Z old",
        updated_at: 1780272000000,
      }),
      buildCandidate({
        id: "window",
        path: "memory/smart-add/2026-06-16.md",
        text: "2026-06-16T10:01:02Z window",
        updated_at: 1781568000000,
      }),
      buildCandidate({
        id: "recent",
        path: "memory/smart-add/2026-06-20.md",
        text: "2026-06-20T10:01:02Z recent",
        updated_at: 1781913601000,
      }),
    ],
  };
  const pathMetadata = new Map([
    ["memory/smart-add/2026-06-18.md", { file_mtime: 1780272000000, file_source: "memory" }],
    ["memory/smart-add/2026-06-16.md", { file_mtime: 1781568000000, file_source: "memory" }],
    ["memory/smart-add/2026-06-20.md", { file_mtime: 1781913601000, file_source: "memory" }],
  ]);

  const report = mod.buildTimestampPollutionAudit({
    generatedAt: "2026-06-20T00:00:00.000Z",
    candidateSource,
    pathMetadata,
  });

  assert.equal(report.summary.created_before_raw_log_fix, 1);
  assert.equal(report.summary.unknown_fix_window, 1);
  assert.equal(report.summary.created_after_raw_log_fix, 1);
});
