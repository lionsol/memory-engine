import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const checkpoint = require("../bin/session-checkpoint.js");
const checkpointEpisodeWriter = require("../lib/checkpoint/episode-writer.js");

function createFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-checkpoint-episode-writer-"));
  const episodesDir = resolve(root, "episodes");
  const memoryDir = resolve(root, "memory");
  mkdirSync(episodesDir, { recursive: true });
  mkdirSync(memoryDir, { recursive: true });
  return { root, episodesDir, memoryDir };
}

test("writeEpisodeFiles writes memory/episodes file", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    episodesDir: fixture.episodesDir,
    memoryDir: fixture.memoryDir,
  }, async () => {
    checkpointEpisodeWriter.writeEpisodeFiles({
      episodeDate: "2026-06-17",
      generatedAt: "2026-06-18T01:23:45.000Z",
      episodeText: "episode text body",
      configs: [],
      diagnostics: {
        timeZone: "Asia/Shanghai",
        rawLogTimeBasis: "updated_at",
        rawLogIncluded: 2,
        resetDirectParseEnabled: false,
        evidenceDateFilter: "targetDate=2026-06-17",
      },
    });
  });

  const content = readFileSync(resolve(fixture.episodesDir, "2026-06-17.md"), "utf8");
  assert.match(content, /^# Episode: 2026-06-17/);
  assert.match(content, /episode text body/);
  assert.match(content, /targetDate: 2026-06-17/);
  assert.match(content, /generatedAt: 2026-06-18T01:23:45.000Z/);
  assert.match(content, /timeZone: Asia\/Shanghai/);
  assert.match(content, /category: episodic/);
  assert.match(content, /source_type: checkpoint_llm/);
  assert.match(content, /rawLogTimeBasis: updated_at/);
  assert.match(content, /rawLogIncluded: 2/);
  assert.match(content, /resetDirectParseEnabled: false/);
  assert.match(content, /evidenceDateFilter: targetDate=2026-06-17/);
  assert.match(content, /---\n_Generated at 2026-06-18T01:23:45.000Z_/);
});

test("episode metadata contains targetDate, generatedAt, category, source_type", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    episodesDir: fixture.episodesDir,
    memoryDir: fixture.memoryDir,
  }, async () => {
    checkpointEpisodeWriter.writeEpisodeFiles({
      episodeDate: "2026-06-17",
      generatedAt: "2026-06-18T01:23:45.000Z",
      episodeText: "episode text body",
      configs: [],
      diagnostics: {
        timeZone: "Asia/Shanghai",
        rawLogTimeBasis: "updated_at",
        rawLogIncluded: 2,
        resetDirectParseEnabled: false,
        evidenceDateFilter: "targetDate=2026-06-17",
      },
    });
  });

  const content = readFileSync(resolve(fixture.episodesDir, "2026-06-17.md"), "utf8");
  assert.match(content, /targetDate: 2026-06-17/);
  assert.match(content, /generatedAt: 2026-06-18T01:23:45.000Z/);
  assert.match(content, /category: episodic/);
  assert.match(content, /source_type: checkpoint_llm/);
  assert.match(content, /rawLogTimeBasis: updated_at/);
  assert.match(content, /rawLogIncluded: 2/);
  assert.match(content, /resetDirectParseEnabled: false/);
});

test("non-empty configs include 配置记忆 section", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    episodesDir: fixture.episodesDir,
    memoryDir: fixture.memoryDir,
  }, async () => {
    checkpointEpisodeWriter.writeEpisodeFiles({
      episodeDate: "2026-06-17",
      generatedAt: "2026-06-18T01:23:45.000Z",
      episodeText: "episode text body",
      configs: [{ key: "theme", value: "solarized", context: "mock" }],
    });
  });

  const content = readFileSync(resolve(fixture.episodesDir, "2026-06-17.md"), "utf8");
  assert.match(content, /### 配置记忆/);
  assert.match(content, /- theme = solarized（mock）/);
});

test("empty configs keep current format", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    episodesDir: fixture.episodesDir,
    memoryDir: fixture.memoryDir,
  }, async () => {
    checkpointEpisodeWriter.writeEpisodeFiles({
      episodeDate: "2026-06-17",
      generatedAt: "2026-06-18T01:23:45.000Z",
      episodeText: "episode text body",
      configs: [],
    });
  });

  const content = readFileSync(resolve(fixture.episodesDir, "2026-06-17.md"), "utf8");
  assert.doesNotMatch(content, /### 配置记忆/);
  assert.match(content, /---\n_Generated at 2026-06-18T01:23:45.000Z_/);
});

test("daily memory file is not created by default", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    episodesDir: fixture.episodesDir,
    memoryDir: fixture.memoryDir,
  }, async () => {
    checkpointEpisodeWriter.writeEpisodeFiles({
      episodeDate: "2026-06-17",
      generatedAt: "2026-06-18T01:23:45.000Z",
      episodeText: "episode text body",
      configs: [],
    });
  });

  assert.equal(existsSync(resolve(fixture.memoryDir, "2026-06-17.md")), false);
});

test("existing daily memory file is not modified", async () => {
  const fixture = createFixture();
  const dailyPath = resolve(fixture.memoryDir, "2026-06-17.md");
  writeFileSync(dailyPath, "preexisting daily content\n");

  await checkpoint.withRuntime({
    episodesDir: fixture.episodesDir,
    memoryDir: fixture.memoryDir,
  }, async () => {
    checkpointEpisodeWriter.writeEpisodeFiles({
      episodeDate: "2026-06-17",
      generatedAt: "2026-06-18T01:23:45.000Z",
      episodeText: "episode text body",
      configs: [],
    });
  });

  assert.equal(readFileSync(dailyPath, "utf8"), "preexisting daily content\n");
});

test("writer uses runtime episodesDir and does not populate memoryDir by default", async () => {
  const fixture = createFixture();
  const nestedEpisodesDir = resolve(fixture.root, "nested", "episodes");
  const nestedMemoryDir = resolve(fixture.root, "nested", "memory");

  await checkpoint.withRuntime({
    episodesDir: nestedEpisodesDir,
    memoryDir: nestedMemoryDir,
  }, async () => {
    checkpointEpisodeWriter.writeEpisodeFiles({
      episodeDate: "2026-06-17",
      generatedAt: "2026-06-18T01:23:45.000Z",
      episodeText: "episode text body",
      configs: [],
    });
  });

  assert.match(readFileSync(resolve(nestedEpisodesDir, "2026-06-17.md"), "utf8"), /episode text body/);
  assert.equal(existsSync(resolve(nestedMemoryDir, "2026-06-17.md")), false);
});

test("legacy daily mirror can be re-enabled explicitly", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    episodesDir: fixture.episodesDir,
    memoryDir: fixture.memoryDir,
    checkpointLegacyDailyMirror: true,
  }, async () => {
    checkpointEpisodeWriter.writeEpisodeFiles({
      episodeDate: "2026-06-17",
      generatedAt: "2026-06-18T01:23:45.000Z",
      episodeText: "episode text body",
      configs: [],
    });
  });

  assert.equal(readFileSync(resolve(fixture.memoryDir, "2026-06-17.md"), "utf8"), "# 2026-06-17\n\nepisode text body\n\n");
});
