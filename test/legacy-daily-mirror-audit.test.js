import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  LEGACY_DAILY_MIRROR_CONFIRM_TOKEN,
  generateLegacyDailyMirrorQuarantineReview,
  runLegacyDailyMirrorAudit,
} from "../lib/quality/legacy-daily-mirror-audit.js";

function createFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-legacy-daily-mirror-"));
  const memoryDir = resolve(root, "memory");
  const episodesDir = resolve(memoryDir, "episodes");
  mkdirSync(episodesDir, { recursive: true });
  return { root, memoryDir, episodesDir };
}

function writeCanonicalEpisode(episodesDir, date, summary, configs = []) {
  const configBlock = configs.length > 0
    ? `\n### 配置记忆\n${configs.map(item => `- ${item}`).join("\n")}\n`
    : "\n";
  writeFileSync(resolve(episodesDir, `${date}.md`), [
    `# Episode: ${date}`,
    "",
    `targetDate: ${date}`,
    "generatedAt: 2026-06-24T00:00:00.000Z",
    "category: episodic",
    "source_type: checkpoint_llm",
    "",
    summary,
    configBlock.trimEnd(),
    "",
    "---",
    "_Generated at 2026-06-24T00:00:00.000Z_",
    "",
  ].join("\n"));
}

function writeLegacyEpisode(episodesDir, date, summary, configs = []) {
  const lines = [
    `# Episode: ${date}`,
    "",
    summary,
  ];
  if (configs.length > 0) {
    lines.push("");
    lines.push("### 配置记忆");
    for (const item of configs) {
      lines.push(`- ${item}`);
    }
  }
  lines.push("");
  lines.push("---");
  lines.push("_Generated at 2026-06-24T00:00:00.000Z_");
  lines.push("");
  writeFileSync(resolve(episodesDir, `${date}.md`), lines.join("\n"));
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

test("audit identifies generated legacy daily mirror candidate", () => {
  const fixture = createFixture();
  writeCanonicalEpisode(fixture.episodesDir, "2026-06-20", "same summary body");
  writeFileSync(resolve(fixture.memoryDir, "2026-06-20.md"), "# 2026-06-20\n\nsame summary body\n\n");

  const report = runLegacyDailyMirrorAudit({
    rootDir: fixture.root,
    memoryDir: fixture.memoryDir,
  });

  assert.equal(report.mode, "dry_run");
  assert.equal(report.summary.legacy_daily_mirror_candidates, 1);
  assert.equal(report.summary.manual_daily_journal_candidates, 0);
  assert.equal(report.legacy_daily_mirror_candidates[0].path, "memory/2026-06-20.md");
  assert.equal(report.legacy_daily_mirror_candidates[0].episode_path, "memory/episodes/2026-06-20.md");
});

test("old-format episode plus same-body root daily is classified as legacy mirror candidate", () => {
  const fixture = createFixture();
  writeLegacyEpisode(fixture.episodesDir, "2026-06-24", "same summary body", ["theme = solarized"]);
  writeFileSync(resolve(fixture.memoryDir, "2026-06-24.md"), "# 2026-06-24\n\nsame summary body\n\n");

  const report = runLegacyDailyMirrorAudit({
    rootDir: fixture.root,
    memoryDir: fixture.memoryDir,
  });

  assert.equal(report.summary.legacy_daily_mirror_candidates, 1);
  assert.equal(report.legacy_daily_mirror_candidates[0].path, "memory/2026-06-24.md");
  assert.equal(report.legacy_daily_mirror_candidates[0].episode_format, "legacy");
});

test("audit does not misclassify daily journal with manual content as legacy mirror", () => {
  const fixture = createFixture();
  writeCanonicalEpisode(fixture.episodesDir, "2026-06-21", "same summary body");
  writeFileSync(
    resolve(fixture.memoryDir, "2026-06-21.md"),
    "# 2026-06-21\n\nsame summary body\n\n## Notes\n- manual follow-up\n",
  );

  const report = runLegacyDailyMirrorAudit({
    rootDir: fixture.root,
    memoryDir: fixture.memoryDir,
  });

  assert.equal(report.summary.legacy_daily_mirror_candidates, 0);
  assert.equal(report.summary.manual_daily_journal_candidates, 1);
  assert.equal(report.manual_daily_journal_candidates[0].path, "memory/2026-06-21.md");
});

test("old-format episode plus manually rewritten root daily is not a legacy mirror candidate", () => {
  const fixture = createFixture();
  writeLegacyEpisode(fixture.episodesDir, "2026-06-25", "same summary body");
  writeFileSync(
    resolve(fixture.memoryDir, "2026-06-25.md"),
    "# 2026-06-25\n\nsame summary body\n\n## Notes\n- rewritten by hand\n",
  );

  const report = runLegacyDailyMirrorAudit({
    rootDir: fixture.root,
    memoryDir: fixture.memoryDir,
  });

  assert.equal(report.summary.legacy_daily_mirror_candidates, 0);
  assert.equal(report.summary.manual_daily_journal_candidates, 1);
  assert.equal(report.manual_daily_journal_candidates[0].path, "memory/2026-06-25.md");
});

test("apply mode moves confirmed legacy mirror into quarantine", () => {
  const fixture = createFixture();
  writeCanonicalEpisode(fixture.episodesDir, "2026-06-22", "same summary body");
  const sourcePath = resolve(fixture.memoryDir, "2026-06-22.md");
  const destinationPath = resolve(fixture.memoryDir, "legacy-daily-mirrors", "2026-06-22.md");
  writeFileSync(sourcePath, "# 2026-06-22\n\nsame summary body\n\n");

  const report = runLegacyDailyMirrorAudit({
    rootDir: fixture.root,
    memoryDir: fixture.memoryDir,
    apply: true,
    confirm: LEGACY_DAILY_MIRROR_CONFIRM_TOKEN,
  });

  assert.equal(report.mode, "apply");
  assert.equal(report.summary.moved_count, 1);
  assert.equal(existsSync(sourcePath), false);
  assert.equal(existsSync(destinationPath), true);
  assert.equal(report.quarantine.moved[0].schema_version, 2);
  assert.equal(report.quarantine.moved[0].timestamp, report.quarantine.moved[0].moved_at);
  assert.equal(report.quarantine.moved[0].moved_from, "memory/2026-06-22.md");
  assert.equal(report.quarantine.moved[0].moved_to, "memory/legacy-daily-mirrors/2026-06-22.md");
  assert.equal(report.quarantine.moved[0].episode_path, "memory/episodes/2026-06-22.md");
  assert.equal(report.quarantine.moved[0].episode_format, "modern");
  assert.equal(
    report.quarantine.moved[0].daily_sha256,
    sha256("# 2026-06-22\n\nsame summary body\n\n"),
  );
  assert.equal(report.quarantine.moved[0].episode_summary_sha256, sha256("same summary body"));
  assert.match(
    readFileSync(resolve(fixture.memoryDir, "legacy-daily-mirrors", "quarantine-log.jsonl"), "utf8"),
    /"schema_version":2/,
  );
});

test("dry-run audit does not modify files", () => {
  const fixture = createFixture();
  writeCanonicalEpisode(fixture.episodesDir, "2026-06-23", "same summary body");
  const sourcePath = resolve(fixture.memoryDir, "2026-06-23.md");
  const quarantinePath = resolve(fixture.memoryDir, "legacy-daily-mirrors", "2026-06-23.md");
  writeFileSync(sourcePath, "# 2026-06-23\n\nsame summary body\n\n");

  const report = runLegacyDailyMirrorAudit({
    rootDir: fixture.root,
    memoryDir: fixture.memoryDir,
  });

  assert.equal(report.mode, "dry_run");
  assert.equal(existsSync(sourcePath), true);
  assert.equal(existsSync(quarantinePath), false);
});

test("review report supplements legacy moved entries without rewriting quarantine log", () => {
  const fixture = createFixture();
  writeLegacyEpisode(fixture.episodesDir, "2026-06-26", "legacy summary body");
  mkdirSync(resolve(fixture.memoryDir, "legacy-daily-mirrors"), { recursive: true });
  const quarantinePath = resolve(fixture.memoryDir, "legacy-daily-mirrors", "2026-06-26.md");
  const quarantinedContent = "# 2026-06-26\n\nlegacy summary body\n";
  writeFileSync(quarantinePath, quarantinedContent);
  const logPath = resolve(fixture.memoryDir, "legacy-daily-mirrors", "quarantine-log.jsonl");
  const originalLog = `${JSON.stringify({
    moved_at: "2026-06-24T00:00:00.000Z",
    moved_from: "memory/2026-06-26.md",
    moved_to: "memory/legacy-daily-mirrors/2026-06-26.md",
    reason: "legacy_daily_mirror_candidate",
    similarity: 1,
  })}\n`;
  writeFileSync(logPath, originalLog);

  const report = generateLegacyDailyMirrorQuarantineReview({
    rootDir: fixture.root,
    memoryDir: fixture.memoryDir,
    now: new Date("2026-06-24T12:00:00.000Z"),
  });

  assert.equal(readFileSync(logPath, "utf8"), originalLog);
  assert.equal(report.moved_entry_count, 1);
  assert.equal(report.reviewed_entries[0].episode_path, "memory/episodes/2026-06-26.md");
  assert.equal(report.reviewed_entries[0].episode_format, "legacy");
  assert.equal(report.reviewed_entries[0].daily_sha256, sha256(quarantinedContent));
  assert.equal(report.reviewed_entries[0].episode_summary_sha256, sha256("legacy summary body"));
  assert.deepEqual(report.reviewed_entries[0].hash, {
    daily_sha256: sha256(quarantinedContent),
    episode_summary_sha256: sha256("legacy summary body"),
  });
  assert.equal(report.reviewed_entries[0].review_result, "reviewed");
  assert.equal(
    existsSync(resolve(fixture.memoryDir, "legacy-daily-mirrors", "quarantine-review-2026-06-24.json")),
    true,
  );
});
