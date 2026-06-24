import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";
import { createHash } from "node:crypto";

export const LEGACY_DAILY_MIRROR_CONFIRM_TOKEN = "quarantine-legacy-daily-mirrors";
export const LEGACY_DAILY_MIRROR_LOG_SCHEMA_VERSION = 2;

function normalizePath(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

function compareStrings(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function isDailyRootFile(name) {
  return /^\d{4}-\d{2}-\d{2}\.md$/.test(String(name || ""));
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function preview(value, maxLength = 160) {
  const text = normalizeText(value).replace(/\n+/g, " ");
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}

function extractDailyHeading(content) {
  const match = String(content ?? "").match(/^#\s+(\d{4}-\d{2}-\d{2})\s*(?:\n|$)/);
  return match?.[1] || null;
}

function stripDailyHeading(content) {
  return String(content ?? "").replace(/^#\s+\d{4}-\d{2}-\d{2}\s*\n?/, "").trim();
}

function hasCanonicalEpisodeMarkers(content) {
  const text = String(content ?? "");
  return /(?:^|\n)targetDate:\s*\d{4}-\d{2}-\d{2}\b/.test(text)
    || /(?:^|\n)generatedAt:\s*\S+/.test(text)
    || /(?:^|\n)category:\s*episodic\b/.test(text)
    || /(?:^|\n)source_type:\s*checkpoint_llm\b/.test(text);
}

function hasGeneratedFooter(content) {
  return /\n---\n_Generated at [^\n]+_\s*$/.test(String(content ?? ""));
}

function parseCanonicalEpisode(content) {
  const text = String(content ?? "");
  const heading = text.match(/^# Episode(?::\s*([^\n]+))?\n/);
  const targetDate = text.match(/(?:^|\n)targetDate:\s*(\d{4}-\d{2}-\d{2})\s*(?:\n|$)/);
  const generatedAt = text.match(/(?:^|\n)generatedAt:\s*([^\n]+)\n/);
  const category = text.match(/(?:^|\n)category:\s*([^\n]+)\n/);
  const footer = text.match(/\n---\n(_Generated at [^\n]+_)\s*$/);
  const sourceMarker = "\nsource_type: checkpoint_llm\n";
  const sourceIndex = text.indexOf(sourceMarker);
  const summaryStart = sourceIndex >= 0 ? sourceIndex + sourceMarker.length + 1 : -1;
  const configIndex = text.indexOf("\n### 配置记忆\n");
  const footerIndex = text.indexOf("\n---\n_Generated at ");
  const summaryEnd = configIndex >= 0 ? configIndex : footerIndex;
  let summary = summaryStart >= 0 && summaryEnd > summaryStart
    ? text.slice(summaryStart, summaryEnd).trim()
    : "";
  let episodeFormat = "unknown";

  if (summary) {
    episodeFormat = "modern";
  } else if (heading) {
    const legacyWithoutHeading = text.replace(/^# Episode(?::[^\n]+)?\n+/, "");
    const legacyWithoutFooter = legacyWithoutHeading
      .replace(/\n---\n_Generated at [^\n]+_\s*$/, "")
      .trim();
    const legacyConfigIndex = legacyWithoutFooter.indexOf("\n### 配置记忆\n");
    summary = (legacyConfigIndex >= 0
      ? legacyWithoutFooter.slice(0, legacyConfigIndex)
      : legacyWithoutFooter).trim();
    if (summary) {
      episodeFormat = "legacy";
    }
  }

  return {
    exists: Boolean(text),
    headingDate: heading?.[1]?.match(/\d{4}-\d{2}-\d{2}/)?.[0] || null,
    targetDate: targetDate?.[1] || null,
    generatedAt: generatedAt?.[1]?.trim() || null,
    category: category?.[1]?.trim() || null,
    footer: footer?.[1] || null,
    episode_format: episodeFormat,
    summary,
    hasCanonicalMetadata: Boolean(targetDate && generatedAt && category),
    hasGeneratedFooter: Boolean(footer),
  };
}

function readEpisodeDetails(memoryDir, date) {
  const episodePath = resolve(memoryDir, "episodes", `${date}.md`);
  if (!existsSync(episodePath)) {
    return {
      episode_path: null,
      episode_format: "unknown",
      summary: "",
      summary_sha256: null,
    };
  }
  const episodeContent = readFileSync(episodePath, "utf8");
  const parsed = parseCanonicalEpisode(episodeContent);
  return {
    episode_path: normalizePath(relative(resolve(memoryDir, ".."), episodePath)),
    episode_format: parsed.episode_format || "unknown",
    summary: parsed.summary || "",
    summary_sha256: parsed.summary ? sha256(parsed.summary) : null,
  };
}

function parseQuarantineEntry(raw) {
  const movedAt = raw?.moved_at || null;
  return {
    schema_version: Number.isFinite(Number(raw?.schema_version))
      ? Number(raw.schema_version)
      : 1,
    moved_at: movedAt,
    timestamp: raw?.timestamp || movedAt,
    moved_from: normalizePath(raw?.moved_from),
    moved_to: normalizePath(raw?.moved_to),
    episode_path: raw?.episode_path ? normalizePath(raw.episode_path) : null,
    episode_format: raw?.episode_format ? String(raw.episode_format) : "unknown",
    reason: String(raw?.reason || ""),
    similarity: raw?.similarity ?? null,
    daily_sha256: raw?.daily_sha256 || null,
    episode_summary_sha256: raw?.episode_summary_sha256 || null,
  };
}

function readQuarantineLogEntries(quarantineDir) {
  const logPath = resolve(quarantineDir, "quarantine-log.jsonl");
  if (!existsSync(logPath)) return { logPath, entries: [] };
  const entries = readFileSync(logPath, "utf8")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      try {
        return parseQuarantineEntry(JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return { logPath, entries };
}

function bigrams(value) {
  const text = normalizeText(value);
  if (!text) return [];
  if (text.length === 1) return [text];
  const grams = [];
  for (let i = 0; i < text.length - 1; i += 1) {
    grams.push(text.slice(i, i + 2));
  }
  return grams;
}

function diceSimilarity(a, b) {
  const left = bigrams(a);
  const right = bigrams(b);
  if (!left.length && !right.length) return 1;
  if (!left.length || !right.length) return 0;
  const counts = new Map();
  for (const gram of left) {
    counts.set(gram, (counts.get(gram) || 0) + 1);
  }
  let overlap = 0;
  for (const gram of right) {
    const current = counts.get(gram) || 0;
    if (current > 0) {
      overlap += 1;
      counts.set(gram, current - 1);
    }
  }
  return (2 * overlap) / (left.length + right.length);
}

function hasManualStructure(text) {
  const value = String(text ?? "");
  return /(^|\n)(##|###)\s+\S/m.test(value)
    || /(^|\n)(- |\* |\d+\. )\S/m.test(value)
    || /(^|\n)>\s+\S/m.test(value)
    || /<!--[\s\S]*?-->/.test(value)
    || /\n---\n/.test(value);
}

function classifyDailyFile({ rootDir, memoryDir, date, dailyContent, episodeContent }) {
  const dailyRelativePath = normalizePath(relative(rootDir, resolve(memoryDir, `${date}.md`)));
  const episodeRelativePath = normalizePath(relative(rootDir, resolve(memoryDir, "episodes", `${date}.md`)));
  const headingDate = extractDailyHeading(dailyContent);
  const body = stripDailyHeading(dailyContent);
  const episode = parseCanonicalEpisode(episodeContent);
  const normalizedBody = normalizeText(body);
  const normalizedEpisodeSummary = normalizeText(episode.summary);
  const similarity = Number(diceSimilarity(normalizedBody, normalizedEpisodeSummary).toFixed(4));
  const missingCanonicalMetadata = !hasCanonicalEpisodeMarkers(dailyContent);
  const missingGeneratedFooter = !hasGeneratedFooter(dailyContent);
  const manualStructure = hasManualStructure(body);
  const extraChars = Math.max(0, normalizedBody.length - normalizedEpisodeSummary.length);
  const bodyContainsEpisode = normalizedBody.includes(normalizedEpisodeSummary) && normalizedEpisodeSummary.length > 0;
  const episodeContainsBody = normalizedEpisodeSummary.includes(normalizedBody) && normalizedBody.length > 0;
  const noObviousManualAppend = !manualStructure && extraChars <= 24;

  const base = {
    path: dailyRelativePath,
    date,
    episode_path: existsSync(resolve(memoryDir, "episodes", `${date}.md`)) ? episodeRelativePath : null,
    similarity,
    heading_matches_date: headingDate === date,
    missing_canonical_metadata: missingCanonicalMetadata,
    missing_generated_footer: missingGeneratedFooter,
    manual_structure_detected: manualStructure,
    body_preview: preview(body),
    episode_preview: preview(episode.summary),
  };

  if (headingDate !== date) {
    return {
      bucket: "manual_daily_journal_candidates",
      ...base,
      reason: "daily root file heading does not match the date filename, so it does not look like a generated checkpoint mirror",
    };
  }

  if (!episode.exists || !normalizedEpisodeSummary) {
    return {
      bucket: "ambiguous_daily_files",
      ...base,
      reason: "matching canonical episode is missing or does not expose a usable summary, so legacy mirror confidence is insufficient",
    };
  }

  const exactMirror = normalizedBody === normalizedEpisodeSummary;
  const canonicalEpisodeUsable = episode.hasGeneratedFooter || episode.episode_format === "modern";
  const highSimilarityMirror = similarity >= 0.97 && missingCanonicalMetadata && missingGeneratedFooter && noObviousManualAppend;
  if (
    canonicalEpisodeUsable
    && (exactMirror || highSimilarityMirror)
    && (bodyContainsEpisode || episodeContainsBody || exactMirror)
  ) {
    return {
      bucket: "legacy_daily_mirror_candidates",
      ...base,
      episode_format: episode.episode_format,
      reason: "daily root file matches the canonical episode summary and lacks canonical metadata/footer, which fits the old checkpoint mirror pattern",
    };
  }

  if (manualStructure || extraChars > 24 || similarity < 0.7) {
    return {
      bucket: "manual_daily_journal_candidates",
      ...base,
      reason: "daily root file diverges materially from the canonical episode summary or contains extra manual structure",
    };
  }

  return {
    bucket: "ambiguous_daily_files",
    ...base,
    reason: "daily root file partially overlaps the canonical episode summary but does not meet a safe mirror or manual-journal threshold",
  };
}

function listDailyRootFiles(memoryDir) {
  if (!existsSync(memoryDir)) return [];
  return readdirSync(memoryDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && isDailyRootFile(entry.name))
    .map(entry => entry.name.slice(0, -3))
    .sort(compareStrings);
}

export function auditLegacyDailyMirrors({ rootDir = process.cwd(), memoryDir = resolve(rootDir, "memory") } = {}) {
  const dates = listDailyRootFiles(memoryDir);
  const report = {
    generatedAt: new Date().toISOString(),
    rootDir: normalizePath(rootDir),
    memoryDir: normalizePath(memoryDir),
    quarantineDir: normalizePath(resolve(memoryDir, "legacy-daily-mirrors")),
    summary: {
      scanned_daily_root_files: dates.length,
      legacy_daily_mirror_candidates: 0,
      manual_daily_journal_candidates: 0,
      ambiguous_daily_files: 0,
      moved_count: 0,
    },
    legacy_daily_mirror_candidates: [],
    manual_daily_journal_candidates: [],
    ambiguous_daily_files: [],
  };

  for (const date of dates) {
    const dailyPath = resolve(memoryDir, `${date}.md`);
    const episodePath = resolve(memoryDir, "episodes", `${date}.md`);
    const dailyContent = readFileSync(dailyPath, "utf8");
    const episodeContent = existsSync(episodePath) ? readFileSync(episodePath, "utf8") : "";
    const classification = classifyDailyFile({
      rootDir,
      memoryDir,
      date,
      dailyContent,
      episodeContent,
    });
    report[classification.bucket].push(classification);
  }

  report.legacy_daily_mirror_candidates.sort((a, b) => compareStrings(a.path, b.path));
  report.manual_daily_journal_candidates.sort((a, b) => compareStrings(a.path, b.path));
  report.ambiguous_daily_files.sort((a, b) => compareStrings(a.path, b.path));
  report.summary.legacy_daily_mirror_candidates = report.legacy_daily_mirror_candidates.length;
  report.summary.manual_daily_journal_candidates = report.manual_daily_journal_candidates.length;
  report.summary.ambiguous_daily_files = report.ambiguous_daily_files.length;
  return report;
}

export function applyLegacyDailyMirrorQuarantine(report, {
  rootDir = process.cwd(),
  memoryDir = resolve(rootDir, "memory"),
  confirm = null,
} = {}) {
  if (confirm !== LEGACY_DAILY_MIRROR_CONFIRM_TOKEN) {
    throw new Error(`apply mode requires --confirm ${LEGACY_DAILY_MIRROR_CONFIRM_TOKEN}`);
  }

  const quarantineDir = resolve(memoryDir, "legacy-daily-mirrors");
  const logPath = resolve(quarantineDir, "quarantine-log.jsonl");
  mkdirSync(quarantineDir, { recursive: true });

  const moved = [];
  const skipped = [];
  for (const candidate of report.legacy_daily_mirror_candidates || []) {
    const sourcePath = resolve(rootDir, candidate.path);
    const destinationPath = resolve(quarantineDir, `${candidate.date}.md`);
    const destinationRelative = normalizePath(relative(rootDir, destinationPath));
    if (!existsSync(sourcePath)) {
      skipped.push({
        path: candidate.path,
        reason: "source_missing",
      });
      continue;
    }
    if (existsSync(destinationPath)) {
      skipped.push({
        path: candidate.path,
        destination: destinationRelative,
        reason: "destination_exists",
      });
      continue;
    }
    renameSync(sourcePath, destinationPath);
    const sourceContent = readFileSync(destinationPath, "utf8");
    const episode = readEpisodeDetails(memoryDir, candidate.date);
    const movedAt = new Date().toISOString();
    const logEntry = {
      schema_version: LEGACY_DAILY_MIRROR_LOG_SCHEMA_VERSION,
      moved_at: movedAt,
      timestamp: movedAt,
      moved_from: candidate.path,
      moved_to: destinationRelative,
      episode_path: candidate.episode_path || episode.episode_path,
      episode_format: candidate.episode_format || episode.episode_format,
      reason: "legacy_daily_mirror_candidate",
      similarity: candidate.similarity,
      daily_sha256: sha256(sourceContent),
      episode_summary_sha256: episode.summary_sha256,
    };
    appendFileSync(logPath, `${JSON.stringify(logEntry)}\n`);
    moved.push(logEntry);
  }

  return {
    applied: true,
    confirm_token: LEGACY_DAILY_MIRROR_CONFIRM_TOKEN,
    quarantine_dir: normalizePath(quarantineDir),
    log_path: normalizePath(logPath),
    moved,
    skipped,
  };
}

export function generateLegacyDailyMirrorQuarantineReview({
  rootDir = process.cwd(),
  memoryDir = resolve(rootDir, "memory"),
  now = new Date(),
} = {}) {
  const quarantineDir = resolve(memoryDir, "legacy-daily-mirrors");
  const { logPath, entries } = readQuarantineLogEntries(quarantineDir);
  const reviewDate = new Date(now).toISOString().slice(0, 10);
  const reportPath = resolve(quarantineDir, `quarantine-review-${reviewDate}.json`);
  const movedEntries = entries.filter(entry => entry.moved_from && entry.moved_to);
  const reviewed_entries = movedEntries.map(entry => {
    const movedToAbsolute = resolve(rootDir, entry.moved_to);
    const quarantinedContent = existsSync(movedToAbsolute)
      ? readFileSync(movedToAbsolute, "utf8")
      : "";
    const date = entry.moved_from.match(/(\d{4}-\d{2}-\d{2})\.md$/)?.[1] || null;
    const episode = date
      ? readEpisodeDetails(memoryDir, date)
      : { episode_path: null, episode_format: "unknown", summary_sha256: null };
    const dailySha = quarantinedContent ? sha256(quarantinedContent) : null;
    const reviewResult = !date
      ? "missing_date"
      : !existsSync(movedToAbsolute)
        ? "missing_quarantined_file"
        : !episode.episode_path
          ? "missing_episode"
          : "reviewed";
    const dailySha256 = entry.daily_sha256 || dailySha;
    const episodeSummarySha256 = entry.episode_summary_sha256 || episode.summary_sha256;
    return {
      moved_from: entry.moved_from,
      moved_to: entry.moved_to,
      timestamp: entry.timestamp || entry.moved_at || null,
      moved_at: entry.moved_at || null,
      schema_version: entry.schema_version,
      episode_path: entry.episode_path || episode.episode_path,
      episode_format: entry.episode_format === "unknown" ? episode.episode_format : entry.episode_format,
      reason: entry.reason,
      similarity: entry.similarity,
      daily_sha256: dailySha256,
      episode_summary_sha256: episodeSummarySha256,
      hash: {
        daily_sha256: dailySha256,
        episode_summary_sha256: episodeSummarySha256,
      },
      review_result: reviewResult,
    };
  });
  const report = {
    generated_at: new Date(now).toISOString(),
    root_dir: normalizePath(rootDir),
    memory_dir: normalizePath(memoryDir),
    quarantine_log_path: normalizePath(logPath),
    review_report_path: normalizePath(reportPath),
    moved_entry_count: movedEntries.length,
    reviewed_entry_count: reviewed_entries.length,
    reviewed_entries,
  };
  mkdirSync(quarantineDir, { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function runLegacyDailyMirrorAudit({
  rootDir = process.cwd(),
  memoryDir = resolve(rootDir, "memory"),
  apply = false,
  confirm = null,
} = {}) {
  const report = auditLegacyDailyMirrors({ rootDir, memoryDir });
  if (!apply) {
    return {
      mode: "dry_run",
      ...report,
      quarantine: {
        applied: false,
        confirm_token_required: LEGACY_DAILY_MIRROR_CONFIRM_TOKEN,
        moved: [],
        skipped: [],
      },
    };
  }

  const quarantine = applyLegacyDailyMirrorQuarantine(report, { rootDir, memoryDir, confirm });
  return {
    mode: "apply",
    ...report,
    summary: {
      ...report.summary,
      moved_count: quarantine.moved.length,
    },
    quarantine,
  };
}
