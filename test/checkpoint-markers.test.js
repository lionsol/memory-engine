import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const checkpoint = require("../bin/session-checkpoint.js");
const checkpointMarkers = require("../lib/checkpoint/markers.js");

function createFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-checkpoint-markers-"));
  const episodesDir = resolve(root, "episodes");
  mkdirSync(episodesDir, { recursive: true });
  return { root, episodesDir };
}

test("writeEmptyEpisode writes marker in original format", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    episodesDir: fixture.episodesDir,
    now: () => Date.parse("2026-06-18T01:23:45.000Z"),
  }, async () => {
    checkpointMarkers.writeEmptyEpisode("2026-06-17");
  });

  const content = readFileSync(resolve(fixture.episodesDir, "2026-06-17.md"), "utf8");
  assert.match(content, /^# Episode: 2026-06-17/);
  assert.match(content, /targetDate: 2026-06-17/);
  assert.match(content, /generatedAt: 2026-06-18T01:23:45\.000Z/);
  assert.match(content, /category: episodic/);
  assert.match(content, /source_type: checkpoint_llm/);
  assert.match(content, /（无今日内容）/);
  assert.match(content, /_Generated at 2026-06-18T01:23:45\.000Z_/);
});

test("writeEmptyEpisode does not overwrite existing file", async () => {
  const fixture = createFixture();
  const episodePath = resolve(fixture.episodesDir, "2026-06-17.md");
  writeFileSync(episodePath, "preexisting episode\n");

  await checkpoint.withRuntime({
    episodesDir: fixture.episodesDir,
    now: () => Date.parse("2026-06-18T01:23:45.000Z"),
  }, async () => {
    checkpointMarkers.writeEmptyEpisode("2026-06-17");
  });

  assert.equal(readFileSync(episodePath, "utf8"), "preexisting episode\n");
});

test("writeIncompleteEpisode writes original format and noteCount", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    episodesDir: fixture.episodesDir,
    now: () => Date.parse("2026-06-18T01:23:45.000Z"),
  }, async () => {
    checkpointMarkers.writeIncompleteEpisode("2026-06-17", 3);
  });

  const content = readFileSync(resolve(fixture.episodesDir, "2026-06-17.md"), "utf8");
  assert.match(content, /^# Episode: 2026-06-17/);
  assert.match(content, /generatedAt: 2026-06-18T01:23:45\.000Z/);
  assert.match(content, /⚠️ \*\*数据不完整 — 当日无有效对话记录\*\*/);
  assert.match(content, /仅包含 3 条配置笔记\/自动写入条目。/);
  assert.match(content, /_Generated at 2026-06-18T01:23:45\.000Z_/);
});

test("writeIncompleteEpisode preserves an existing non-empty episode", async () => {
  const fixture = createFixture();
  const episodePath = resolve(fixture.episodesDir, "2026-06-17.md");
  writeFileSync(episodePath, "# valid completed episode\n");

  await checkpoint.withRuntime({
    episodesDir: fixture.episodesDir,
    now: () => Date.parse("2026-06-18T01:23:45.000Z"),
  }, async () => {
    const result = checkpointMarkers.writeIncompleteEpisode("2026-06-17", 3, {
      incompleteReason: "engine backlog",
    });
    assert.equal(result.preserved, true);
  });

  assert.equal(readFileSync(episodePath, "utf8"), "# valid completed episode\n");
});

test("writeIncompleteEpisode identifies budget coverage gaps", async () => {
  const fixture = createFixture();
  await checkpoint.withRuntime({
    episodesDir: fixture.episodesDir,
    now: () => Date.parse("2026-06-18T01:23:45.000Z"),
  }, async () => {
    checkpointMarkers.writeIncompleteEpisode("2026-06-17", 2, {
      incompleteReason: "budget_coverage_incomplete",
      budgetCoverageComplete: false,
      budgetUncoveredEntries: [{ entry_id: "entry-1", coverage: "truncated" }],
    });
  });
  const content = readFileSync(resolve(fixture.episodesDir, "2026-06-17.md"), "utf8");
  assert.match(content, /预算裁剪未覆盖全部输入/);
  assert.match(content, /未调用 LLM/);
  assert.match(content, /entry-1/);
});

test("writeLLMTimeoutEpisode preserves an existing valid episode", async () => {
  const fixture = createFixture();
  const episodePath = resolve(fixture.episodesDir, "2026-06-17.md");
  try {
    writeFileSync(episodePath, "# Existing valid episode\n\nverified summary\n");
    const result = await checkpoint.withRuntime({
      episodesDir: fixture.episodesDir,
      now: () => Date.parse("2026-06-18T01:23:45.000Z"),
    }, () => checkpointMarkers.writeLLMTimeoutEpisode("2026-06-17"));
    assert.equal(result.preserved, true);
    assert.equal(readFileSync(episodePath, "utf8"), "# Existing valid episode\n\nverified summary\n");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("writeLLMTimeoutEpisode writes original timeout marker format", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    episodesDir: fixture.episodesDir,
    now: () => Date.parse("2026-06-18T01:23:45.000Z"),
  }, async () => {
    checkpointMarkers.writeLLMTimeoutEpisode("2026-06-17");
  });

  const content = readFileSync(resolve(fixture.episodesDir, "2026-06-17.md"), "utf8");
  assert.match(content, /^# Episode: 2026-06-17/);
  assert.match(content, /targetDate: 2026-06-17/);
  assert.match(content, /generatedAt: 2026-06-18T01:23:45\.000Z/);
  assert.match(content, /⚠️ llm超时 — 当日日志未处理（SiliconFlow \+ DeepSeek 均不可用）/);
  assert.match(content, /_Generated at 2026-06-18T01:23:45\.000Z_/);
});

test("marker writers use runtime episodesDir and generatedAt stays ISO", async () => {
  const fixture = createFixture();
  const nestedEpisodesDir = resolve(fixture.root, "nested", "episodes");

  await checkpoint.withRuntime({
    episodesDir: nestedEpisodesDir,
    now: () => Date.parse("2026-06-18T09:10:11.000Z"),
  }, async () => {
    checkpointMarkers.writeLLMTimeoutEpisode("2026-06-17");
  });

  const content = readFileSync(resolve(nestedEpisodesDir, "2026-06-17.md"), "utf8");
  assert.match(content, /generatedAt: 2026-06-18T09:10:11\.000Z/);
});
