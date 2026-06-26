import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

async function importModule(tag = Date.now()) {
  return import(`../lib/quality/smart-add-propagation-quarantine.js?quarantine=${tag}`);
}

function createFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "smart-add-propagation-quarantine-"));
  const memoryDir = resolve(root, "memory");
  const smartAddDir = resolve(memoryDir, "smart-add");
  const episodesDir = resolve(memoryDir, "episodes");
  mkdirSync(smartAddDir, { recursive: true });
  mkdirSync(episodesDir, { recursive: true });

  writeFileSync(resolve(root, "MEMORY.md"), "2026-06-10 fixed opencode provider env: prefix\n", "utf8");
  writeFileSync(resolve(smartAddDir, "2026-06-24.md"), [
    "# Smart Added Memory",
    "",
    "<!-- smart-add-fingerprint: aa11111111111111111111111111111111111111111111111111111111111111 -->",
    "## 2026-06-24_episodic_nightly_generated_keep001",
    "",
    "Category: episodic",
    "",
    "这是正常保留内容。",
    "",
    "<!-- smart-add-fingerprint: 3f503661019b1bb39b52571773a6e39eed6d77b6e270edefc8500f7d567df567 -->",
    "## 2026-06-23_episodic_nightly_generated_091523",
    "",
    "Category: episodic",
    "",
    "包含 OpenCode 配置覆盖引用，属于错误日期文件。",
    "",
    "<!-- smart-add-fingerprint: bb22222222222222222222222222222222222222222222222222222222222222 -->",
    "## 2026-06-23_preference_nightly_generated_091523",
    "",
    "Category: preference",
    "",
    "这是 6/23 old checkpoint output，不应进入 2026-06-24 文件。",
    "",
    "<!-- smart-add-fingerprint: 87c081eddbd6037e8f19c755ccdcc677c6b214b46092fb668541e58a0dc29a35 -->",
    "## 2026-06-24_episodic_nightly_generated_151036",
    "",
    "Category: episodic",
    "",
    "包含 OpenCode 配置覆盖 + 6/23 事件，确认为传播污染。",
    "",
    "## 2026-06-24T1930_raw_log_ab39d09f",
    "",
    "Category: raw_log",
    "<!-- smart-add-fingerprint: 178d411728ac508b3623366e3a55b551df599299 -->",
    "",
    "**User:** 昨天做了什么",
    "",
    "**Assistant:** 这里保留人工 review 对话块，不参与自动 quarantine。",
    "",
  ].join("\n"), "utf8");
  writeFileSync(resolve(episodesDir, "2026-06-25.md"), [
    "# Episode: 2026-06-25",
    "",
    "今天（6月25日，周四）的核心工作是修复opencode provider配置并排查网络连通性。上午确认了凌晨cron job全部正常执行。随后处理了opencode provider的apiKey缺失env:前缀问题，以及auth和headers配置缺失导致的ECONNRESET和401错误。下午排查了Tailscale问题。",
    "",
    "### 配置记忆",
    "- opencode provider apiKey = env:OPENCODE_API_KEY（openclaw.json兼容性修复）",
    "- cron.session-checkpoint.fallback = siliconflow/deepseek-ai/DeepSeek-V4-Flash（session-checkpoint cron job fallback provider）",
    "",
    "---",
    "_Generated at 2026-06-25T19:35:51.497Z_",
    "",
  ].join("\n"), "utf8");
  writeFileSync(resolve(smartAddDir, "2026-06-26.md"), [
    "# Smart Added Memory",
    "",
    "## 2026-06-26_keep_entry",
    "",
    "Category: raw_log",
    "",
    "suspected only but not confirmed",
    "",
  ].join("\n"), "utf8");
  return { root, memoryDir, smartAddDir, episodesDir };
}

test("fingerprint selector only quarantines the explicitly confirmed fingerprint and preserves clean blocks", async () => {
  const fixture = createFixture();
  const mod = await importModule();
  const beforeSmart = readFileSync(resolve(fixture.smartAddDir, "2026-06-24.md"), "utf8");

  const report = mod.runSmartAddPropagationQuarantine({
    rootDir: fixture.root,
    memoryDir: fixture.memoryDir,
    confirmedPaths: ["memory/smart-add/2026-06-24.md"],
    confirmedFingerprints: ["87c081ed"],
  });

  assert.equal(report.mode, "dry_run");
  assert.equal(report.confirmed_blocks_found, 1);
  assert.equal(report.confirmed_fingerprints_found, 1);
  assert.equal(report.confirmed_prefix_blocks_found, 0);
  assert.equal(report.preserved_clean_blocks, 3);
  assert.equal(report.would_quarantine_count, 1);
  assert.equal(report.requires_manual_review, 0);
  assert.equal(report.exact_changed_block_preview.length, 1);
  assert.equal(report.exact_changed_block_preview[0].fingerprint.startsWith("87c081ed"), true);
  assert.equal(readFileSync(resolve(fixture.smartAddDir, "2026-06-24.md"), "utf8"), beforeSmart);
  assert.equal(existsSync(resolve(fixture.memoryDir, "quarantined-smart-add-propagation")), false);
});

test("prefix selector only quarantines the explicitly confirmed block prefix", async () => {
  const fixture = createFixture();
  const mod = await importModule();

  const report = mod.runSmartAddPropagationQuarantine({
    rootDir: fixture.root,
    memoryDir: fixture.memoryDir,
    confirmedPaths: ["memory/smart-add/2026-06-24.md"],
    confirmedPrefixes: ["2026-06-23_"],
  });

  assert.equal(report.confirmed_blocks_found, 2);
  assert.equal(report.confirmed_fingerprints_found, 0);
  assert.equal(report.confirmed_prefix_blocks_found, 2);
  assert.equal(report.preserved_clean_blocks, 2);
  assert.equal(report.exact_changed_block_preview.length, 2);
  assert.equal(report.exact_changed_block_preview.every(item => item.block_id.startsWith("2026-06-23_")), true);
});

test("apply only handles explicitly confirmed selectors and writes a complete quarantine log", async () => {
  const fixture = createFixture();
  const mod = await importModule();

  const report = mod.runSmartAddPropagationQuarantine({
    rootDir: fixture.root,
    memoryDir: fixture.memoryDir,
    apply: true,
    confirm: mod.SMART_ADD_PROPAGATION_CONFIRM_TOKEN,
    confirmedPaths: [
      "memory/smart-add/2026-06-24.md",
      "memory/episodes/2026-06-25.md",
    ],
    confirmedPrefixes: ["2026-06-23_"],
    confirmedFingerprints: ["87c081ed"],
  });

  assert.equal(report.mode, "apply");
  assert.equal(report.quarantined_count, 5);
  assert.equal(report.quarantine.applied, true);
  assert.equal(report.stale_cleanup_candidates.length, 2);

  const smartAfter = readFileSync(resolve(fixture.smartAddDir, "2026-06-24.md"), "utf8");
  assert.equal(/2026-06-24_episodic_nightly_generated_keep001/.test(smartAfter), true);
  assert.equal(/2026-06-23_episodic_nightly_generated_091523/.test(smartAfter), false);
  assert.equal(/2026-06-23_preference_nightly_generated_091523/.test(smartAfter), false);
  assert.equal(/87c081ed/.test(smartAfter), false);
  assert.equal(/2026-06-24T1930_raw_log_ab39d09f/.test(smartAfter), true);

  const episodeAfter = readFileSync(resolve(fixture.episodesDir, "2026-06-25.md"), "utf8");
  assert.equal(/apiKey缺失env:前缀/.test(episodeAfter), false);
  assert.equal(/env:OPENCODE_API_KEY/.test(episodeAfter), false);
  assert.equal(/Tailscale问题/.test(episodeAfter), true);
  assert.equal(/cron\.session-checkpoint\.fallback/.test(episodeAfter), true);

  const quarantinePathSmart = resolve(fixture.memoryDir, "quarantined-smart-add-propagation", "2026-06-24.md");
  const quarantinePathEpisode = resolve(fixture.memoryDir, "quarantined-smart-add-propagation", "2026-06-25.md");
  assert.equal(existsSync(quarantinePathSmart), true);
  assert.equal(existsSync(quarantinePathEpisode), true);
  assert.equal(readFileSync(quarantinePathSmart, "utf8").includes("OpenCode 配置覆盖"), true);
  assert.equal(readFileSync(quarantinePathEpisode, "utf8").includes("env:OPENCODE_API_KEY"), true);

  const logPath = resolve(fixture.memoryDir, "quarantined-smart-add-propagation", "quarantine-log.jsonl");
  const lines = readFileSync(logPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(lines.length, 5);
  for (const entry of lines) {
    assert.equal(typeof entry.schema_version, "number");
    assert.equal(Boolean(entry.quarantined_at), true);
    assert.equal(Boolean(entry.source_path), true);
    assert.equal(Boolean(entry.target_path), true);
    assert.equal(Boolean(entry.block_id), true);
    assert.equal(Boolean(entry.block_hash), true);
    assert.equal(Boolean(entry.reason), true);
    assert.equal(Boolean(entry.pollution_type), true);
    assert.equal(Boolean(entry.source_date_candidate), true);
    assert.equal(Boolean(entry.polluted_target_date), true);
    assert.equal(Boolean(entry.review_status), true);
    assert.equal(Array.isArray(entry.matched_terms), true);
  }
  const smartLogEntries = lines.filter(entry => entry.source_path === "memory/smart-add/2026-06-24.md");
  assert.equal(smartLogEntries.some(entry => entry.reason === "manual_confirmed_wrong_file_date"), true);
  assert.equal(smartLogEntries.some(entry => entry.reason === "manual_confirmed_opencode_propagation"), true);
});

test("suspected-only paths are not auto-applied without explicit confirmation input", async () => {
  const fixture = createFixture();
  const mod = await importModule();
  const before = readFileSync(resolve(fixture.smartAddDir, "2026-06-26.md"), "utf8");
  const beforeConfirmed = readFileSync(resolve(fixture.smartAddDir, "2026-06-24.md"), "utf8");

  const report = mod.runSmartAddPropagationQuarantine({
    rootDir: fixture.root,
    memoryDir: fixture.memoryDir,
    apply: true,
    confirm: mod.SMART_ADD_PROPAGATION_CONFIRM_TOKEN,
    confirmedPaths: ["memory/smart-add/2026-06-24.md"],
  });

  assert.equal(report.quarantined_count, 0);
  assert.equal(report.requires_manual_review, 1);
  assert.equal(readFileSync(resolve(fixture.smartAddDir, "2026-06-26.md"), "utf8"), before);
  assert.equal(readFileSync(resolve(fixture.smartAddDir, "2026-06-24.md"), "utf8"), beforeConfirmed);
});

test("unsafe confirmed paths fall back to requires_manual_review without modifying the source", async () => {
  const fixture = createFixture();
  writeFileSync(resolve(fixture.episodesDir, "2026-06-26.md"), [
    "# Episode: 2026-06-26",
    "",
    "这是一段提到了 opencode 但没有明确 env 前缀边界的混合段落。",
    "",
  ].join("\n"), "utf8");
  const mod = await importModule();
  const before = readFileSync(resolve(fixture.episodesDir, "2026-06-26.md"), "utf8");

  const report = mod.runSmartAddPropagationQuarantine({
    rootDir: fixture.root,
    memoryDir: fixture.memoryDir,
    apply: true,
    confirm: mod.SMART_ADD_PROPAGATION_CONFIRM_TOKEN,
    confirmedPaths: ["memory/episodes/2026-06-26.md"],
  });

  assert.equal(report.requires_manual_review, 1);
  assert.equal(report.quarantined_count, 0);
  assert.equal(report.review_report[0].path, "memory/episodes/2026-06-26.md");
  assert.equal(readFileSync(resolve(fixture.episodesDir, "2026-06-26.md"), "utf8"), before);
});

test("smart-add confirmed path without explicit selector still requires manual review", async () => {
  const fixture = createFixture();
  const mod = await importModule();
  const before = readFileSync(resolve(fixture.smartAddDir, "2026-06-24.md"), "utf8");

  const report = mod.runSmartAddPropagationQuarantine({
    rootDir: fixture.root,
    memoryDir: fixture.memoryDir,
    confirmedPaths: ["memory/smart-add/2026-06-24.md"],
  });

  assert.equal(report.requires_manual_review, 1);
  assert.equal(report.confirmed_blocks_found, 0);
  assert.equal(readFileSync(resolve(fixture.smartAddDir, "2026-06-24.md"), "utf8"), before);
});

test("CLI dry-run writes quarantine report", () => {
  const fixture = createFixture();
  const outPath = resolve(fixture.root, "reports", "smart-add-propagation-quarantine.json");
  const result = spawnSync(process.execPath, [
    resolve(process.cwd(), "bin/quarantine-smart-add-propagation.js"),
    "--json",
    "--root-dir", fixture.root,
    "--memory-dir", fixture.memoryDir,
    "--confirmed-path", "memory/smart-add/2026-06-24.md",
    "--confirmed-prefix", "2026-06-23_",
    "--confirmed-fingerprint", "87c081ed",
    "--out", outPath,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.equal(existsSync(outPath), true);
  const parsed = JSON.parse(readFileSync(outPath, "utf8"));
  assert.equal(parsed.confirmed_blocks_found, 3);
  assert.equal(parsed.confirmed_prefix_blocks_found, 2);
  assert.equal(parsed.confirmed_fingerprints_found, 1);
  assert.equal(parsed.mode, "dry_run");
});
