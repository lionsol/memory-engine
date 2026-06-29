import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, relative, dirname } from "node:path";

const SUSPICIOUS_MATCHERS = [
  { term: "opencode", test: /opencode/i },
  { term: "OpenCode", test: /OpenCode/ },
  { term: "env:", test: /env:/i },
  { term: "env 前缀", test: /env\s*前缀/i },
];

function normalizePath(value) {
  return String(value ?? "").replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

function compareStrings(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function safePreview(text, maxLength = 220) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}

function extractPathDate(path) {
  const match = String(path || "").match(/(\d{4}-\d{2}-\d{2})\.md$/);
  return match ? match[1] : null;
}

function extractEntryDate(entryId) {
  const match = String(entryId || "").match(/^(\d{4}-\d{2}-\d{2})(?:_|T)/);
  return match ? match[1] : null;
}

function extractIsoDates(text) {
  const matches = String(text ?? "").match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
  return Array.from(new Set(matches)).sort(compareStrings);
}

function extractChineseMonthDayDates(text, defaultYear) {
  const matches = [];
  const re = /(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/g;
  let match;
  while ((match = re.exec(String(text ?? ""))) !== null) {
    const year = Number(match[1] || defaultYear);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) continue;
    matches.push(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return Array.from(new Set(matches)).sort(compareStrings);
}

function filterPlausibleDates(targetDate, dates, { minDays = 1, maxDays = 30 } = {}) {
  return (dates || [])
    .filter(date => date && date !== targetDate && isRecentForwardGap(date, targetDate, { minDays, maxDays }))
    .sort((left, right) => {
      const leftGap = dayGap(left, targetDate);
      const rightGap = dayGap(right, targetDate);
      if (leftGap !== rightGap) return leftGap - rightGap;
      return compareStrings(left, right);
    });
}

function matchedTerms(text) {
  return SUSPICIOUS_MATCHERS
    .filter(item => item.test.test(String(text ?? "")))
    .map(item => item.term);
}

function isSuspiciousOpencodeTopic(text) {
  const raw = String(text ?? "");
  const hasOpenCode = /opencode/i.test(raw) || /OpenCode/.test(raw);
  const hasEnvPrefix = /env\s*前缀/i.test(raw) || /env:OPENCODE_API_KEY/i.test(raw);
  return hasOpenCode || hasEnvPrefix;
}

function hasContaminationLanguage(text) {
  const raw = String(text ?? "");
  return /昨天做了什么/.test(raw)
    || /数据污染|被污染|污染问题/.test(raw)
    || /实际(?:上)?是\d{1,2}日/.test(raw)
    || /写成了\s*6月\d{1,2}日/.test(raw)
    || /缺了env:\s*前缀/i.test(raw);
}

function listMarkdownFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".md"))
    .map(entry => resolve(dir, entry.name))
    .sort(compareStrings);
}

function parseSmartAddEntries(content) {
  const normalized = String(content || "").replace(/\r\n/g, "\n");
  const blockRe = /(?:<!--\s*smart-add-fingerprint:\s*[a-f0-9]{8,64}\s*-->\s*\n)?##\s+[\s\S]*?(?=\n(?:<!--\s*smart-add-fingerprint:\s*[a-f0-9]{8,64}\s*-->\s*\n)?##\s+|$)/gi;
  const blocks = (normalized.match(blockRe) || []).map(block => block.trim()).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split("\n");
    const headingLine = lines.find(line => /^\s*##\s+/.test(line)) || "";
    const entryId = String(headingLine || "").replace(/^\s*##\s*/, "").trim();
    const categoryLine = lines.find(line => /^\s*Category:\s*/i.test(line));
    const provenanceLine = lines.find(line => /^\s*Provenance:\s*/i.test(line));
    const category = categoryLine
      ? String(categoryLine.replace(/^\s*Category:\s*/i, "").split("|")[0] || "").trim()
      : null;
    const provenance = provenanceLine
      ? String(provenanceLine.replace(/^\s*Provenance:\s*/i, "") || "").trim().toLowerCase()
      : "unknown";
    const text = lines
      .filter((line) =>
        !/^\s*Category:\s*/i.test(line)
        && !/^\s*Provenance:\s*/i.test(line)
        && !/^\s*kg_data:\s*/i.test(line)
        && !/^\s*##\s*/.test(line)
        && !/^\s*<!--\s*smart-add-fingerprint:\s*[a-f0-9]{8,64}\s*-->\s*$/i.test(line)
      )
      .join("\n")
      .trim();
    return { entryId, category, provenance, text, raw: block };
  });
}

function parseEpisodeContent(content) {
  const normalized = String(content || "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const metadata = {};
  let index = 0;
  if (/^\s*#\s+Episode:\s+\d{4}-\d{2}-\d{2}\s*$/.test(lines[index] || "")) {
    index += 1;
  }
  while (index < lines.length && !String(lines[index] || "").trim()) {
    index += 1;
  }

  let bodyStartIndex = index;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      bodyStartIndex = index + 1;
      break;
    }
    const match = line.match(/^([A-Za-z][A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) {
      bodyStartIndex = index;
      break;
    }
    metadata[match[1]] = match[2];
    bodyStartIndex = index + 1;
  }
  return {
    metadata,
    body: lines.slice(bodyStartIndex).join("\n").trim(),
  };
}

function parseNonNegativeInt(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function isCleanCanonicalCheckpointEpisode({ targetDate, parsed }) {
  const metadata = parsed?.metadata || {};
  return metadata.targetDate === targetDate
    && String(metadata.source_type || "").toLowerCase() === "checkpoint_llm"
    && String(metadata.category || "").toLowerCase() === "episodic"
    && /trusted_only/i.test(String(metadata.smartAddInputPolicy || ""))
    && parseNonNegativeInt(metadata.rawLogIncluded) > 0
    && parseNonNegativeInt(metadata.smartAddIncluded) === 0;
}

function scoreSourceDateCandidate({ targetDate, entryDate, explicitDates, evidenceDates }) {
  if (entryDate && entryDate !== targetDate) return entryDate;
  const explicit = filterPlausibleDates(targetDate, explicitDates);
  if (explicit.length > 0) return explicit[0];
  const evidence = filterPlausibleDates(targetDate, evidenceDates);
  if (evidence.length > 0) return evidence[0];
  return null;
}

function dayGap(fromDate, toDate) {
  const left = Date.parse(`${fromDate}T00:00:00.000Z`);
  const right = Date.parse(`${toDate}T00:00:00.000Z`);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return Math.round((right - left) / 86400000);
}

function previousDate(dateKey) {
  const millis = Date.parse(`${dateKey}T00:00:00.000Z`);
  if (!Number.isFinite(millis)) return null;
  return new Date(millis - 86400000).toISOString().slice(0, 10);
}

function looksGeneratedSmartAdd(entry) {
  return /_nightly_generated_/i.test(String(entry?.entryId || ""))
    || String(entry?.provenance || "").toLowerCase() === "checkpoint_generated"
    || /^(episodic|preference)$/i.test(String(entry?.category || ""));
}

function isRecentForwardGap(sourceDate, targetDate, { minDays = 1, maxDays = 30 } = {}) {
  const gap = sourceDate && targetDate ? dayGap(sourceDate, targetDate) : null;
  return Number.isFinite(gap) && gap >= minDays && gap <= maxDays;
}

function makeQuarantineSuggestion(item, kind) {
  const datePart = item.target_date_polluted || "unknown-date";
  if (kind === "smart_add") {
    return {
      action: "quarantine_marker",
      target_path: item.path,
      target_block: item.entry_id,
      suggested_marker: `<!-- polluted-generated quarantine source_date_candidate=${item.source_date_candidate || "unknown"} target_date_polluted=${datePart} -->`,
      suggested_move_path: `memory/polluted-generated/smart-add/${datePart}--${String(item.entry_id || "entry").replace(/[^\w.-]+/g, "_")}.md`,
    };
  }
  return {
    action: "quarantine_marker",
    target_path: item.path,
    suggested_marker: `<!-- polluted-generated quarantine source_date_candidate=${item.source_date_candidate || "unknown"} target_date_polluted=${datePart} -->`,
    suggested_move_path: `memory/polluted-generated/episodes/${datePart}.md`,
  };
}

function defaultPaths(options = {}) {
  const home = homedir();
  const rootDir = options.rootDir || process.env.MEMORY_ENGINE_WORKSPACE_DIR || resolve(home, ".openclaw/workspace");
  const memoryDir = options.memoryDir || resolve(rootDir, "memory");
  const coreDbPath = options.coreDbPath
    || process.env.MEMORY_ENGINE_CORE_DB
    || process.env.MEMORY_ENGINE_CORE_DB_PATH
    || resolve(home, ".openclaw/memory/main.sqlite");
  return { rootDir, memoryDir, coreDbPath };
}

function openCoreDb(coreDbPath) {
  if (!existsSync(coreDbPath)) return null;
  const db = new Database(coreDbPath, { readonly: true, fileMustExist: true });
  db.pragma("busy_timeout = 5000");
  return db;
}

function chunkStatsForPath(db, relPath) {
  if (!db) return { chunk_count: 0, fts_row_count: 0, chunk_ids: [] };
  const path = normalizePath(relPath);
  const chunkRows = db.prepare(
    "SELECT id FROM chunks WHERE path = ? ORDER BY updated_at DESC, id ASC LIMIT 50",
  ).all(path);
  const chunkCountRow = db.prepare(
    "SELECT COUNT(*) AS c FROM chunks WHERE path = ?",
  ).get(path);
  const ftsCountRow = db.prepare(
    "SELECT COUNT(*) AS c FROM chunks_fts WHERE path = ?",
  ).get(path);
  return {
    chunk_count: Number(chunkCountRow?.c || 0),
    fts_row_count: Number(ftsCountRow?.c || 0),
    chunk_ids: chunkRows.map(row => String(row.id || "")),
  };
}

function buildEvidenceIndex(evidenceFiles, rootDir) {
  const index = [];
  for (const filePath of evidenceFiles) {
    const content = readFileSync(filePath, "utf8");
    const relPath = normalizePath(relative(rootDir, filePath));
    const pathDate = extractPathDate(relPath);
    const terms = matchedTerms(content);
    if (terms.length === 0) continue;
    index.push({
      path: relPath,
      path_date: pathDate,
      terms,
      dates: [
        ...extractIsoDates(content),
        ...extractChineseMonthDayDates(content, Number((pathDate || "0000").slice(0, 4)) || new Date().getUTCFullYear()),
      ].filter(Boolean),
    });
  }
  return index;
}

function matchingEvidenceDates(evidenceIndex, terms, targetDate) {
  const matched = evidenceIndex.filter(item => terms.some(term => item.terms.includes(term)));
  const dates = new Set();
  for (const item of matched) {
    if (item.path_date && item.path_date !== targetDate) dates.add(item.path_date);
    for (const date of item.dates) {
      if (date && date !== targetDate) dates.add(date);
    }
  }
  return Array.from(dates).sort(compareStrings);
}

function collectSmartAddFileSignals({ content, entries, targetDate }) {
  const fileTerms = matchedTerms(content);
  const generatedCrossDayEntries = entries
    .map((entry) => ({
      entry,
      entryDate: extractEntryDate(entry.entryId),
      generatedLike: looksGeneratedSmartAdd(entry),
    }))
    .filter(({ entryDate, generatedLike }) =>
      generatedLike
      && entryDate
      && entryDate !== targetDate
      && isRecentForwardGap(entryDate, targetDate, { minDays: 1, maxDays: 7 }),
    );

  return {
    file_terms: fileTerms,
    file_has_opencode_topic: isSuspiciousOpencodeTopic(content),
    file_has_contamination_language: hasContaminationLanguage(content),
    generated_cross_day_entries: generatedCrossDayEntries,
  };
}

export function runSmartAddPropagationAudit(options = {}) {
  const { rootDir, memoryDir, coreDbPath } = defaultPaths(options);
  const smartAddDir = options.smartAddDir || resolve(memoryDir, "smart-add");
  const episodesDir = options.episodesDir || resolve(memoryDir, "episodes");
  const evidenceFiles = [
    ...listMarkdownFiles(smartAddDir),
    ...listMarkdownFiles(episodesDir),
  ];
  const extraEvidenceFiles = [
    resolve(rootDir, "MEMORY.md"),
  ].filter(path => existsSync(path));
  const evidenceIndex = buildEvidenceIndex([...evidenceFiles, ...extraEvidenceFiles], rootDir);
  const db = openCoreDb(coreDbPath);

  try {
    const report = {
      generated_at: new Date().toISOString(),
      mode: "read_only",
      root_dir: normalizePath(rootDir),
      memory_dir: normalizePath(memoryDir),
      core_db_path: normalizePath(coreDbPath),
      suspicious_terms: SUSPICIOUS_MATCHERS.map(item => item.term),
      scanned: {
        smart_add_dir: normalizePath(relative(rootDir, smartAddDir)),
        episodes_dir: normalizePath(relative(rootDir, episodesDir)),
        smart_add_file_count: listMarkdownFiles(smartAddDir).length,
        episode_file_count: listMarkdownFiles(episodesDir).length,
      },
      suspected_wrong_date_smart_add: [],
      suspected_propagated_episode: [],
      skipped_canonical_checkpoint_episode: [],
      remediation: {
        quarantinable_smart_add_blocks: [],
        quarantinable_episodes: [],
        stale_index_cleanup_candidates: [],
      },
      summary: {
        suspected_wrong_date_smart_add: 0,
        suspected_propagated_episode: 0,
        skipped_canonical_checkpoint_episode: 0,
        stale_index_cleanup_path_count: 0,
        stale_index_cleanup_chunk_count: 0,
      },
    };

    const smartAddCandidates = [];
    for (const filePath of listMarkdownFiles(smartAddDir)) {
      const relPath = normalizePath(relative(rootDir, filePath));
      const targetDate = extractPathDate(relPath);
      const content = readFileSync(filePath, "utf8");
      const entries = parseSmartAddEntries(content);
      const fileSignals = collectSmartAddFileSignals({ content, entries, targetDate });
      for (const entry of entries) {
        const terms = matchedTerms(entry.raw || entry.text);
        const entryTextHasTopic = terms.length > 0 && isSuspiciousOpencodeTopic(entry.raw || entry.text);
        const fileContextHasTopic = fileSignals.file_has_opencode_topic
          && fileSignals.file_has_contamination_language
          && fileSignals.generated_cross_day_entries.some(item => item.entry.entryId === entry.entryId);
        if (!entryTextHasTopic && !fileContextHasTopic) continue;
        const explicitDates = [
          ...extractIsoDates(entry.raw || entry.text),
          ...extractChineseMonthDayDates(entry.raw || entry.text, Number((targetDate || "0000").slice(0, 4)) || new Date().getUTCFullYear()),
        ].filter(Boolean);
        const evidenceDates = matchingEvidenceDates(
          evidenceIndex,
          terms.length > 0 ? terms : fileSignals.file_terms,
          targetDate,
        );
        const sourceDateCandidate = scoreSourceDateCandidate({
          targetDate,
          entryDate: extractEntryDate(entry.entryId),
          explicitDates,
          evidenceDates,
        });
        const pathStats = chunkStatsForPath(db, relPath);
        const item = {
          path: relPath,
          entry_id: entry.entryId,
          category: entry.category,
          provenance: entry.provenance,
          matched_terms: terms.length > 0 ? terms : fileSignals.file_terms,
          source_date_candidate: sourceDateCandidate,
          target_date_polluted: targetDate,
          detection_context: fileContextHasTopic ? "file_level_topic_with_cross_day_generated_entry" : "entry_level_topic",
          file_has_contamination_language: fileSignals.file_has_contamination_language,
          indexed_chunk_count: pathStats.chunk_count,
          indexed_fts_row_count: pathStats.fts_row_count,
          indexed_chunk_ids: pathStats.chunk_ids,
          preview: safePreview(entry.text || entry.raw),
        };
        const entryDate = extractEntryDate(entry.entryId);
        const generatedLike = looksGeneratedSmartAdd(entry);
        const crossDay = entryDate && entryDate !== targetDate && isRecentForwardGap(entryDate, targetDate, { minDays: 1, maxDays: 7 });
        const olderSource = isRecentForwardGap(sourceDateCandidate, targetDate, { minDays: 2, maxDays: 30 });
        const contaminatedCrossDay = crossDay && fileSignals.file_has_opencode_topic;
        if (contaminatedCrossDay || (generatedLike && olderSource)) {
          smartAddCandidates.push(item);
        }
      }
    }

    smartAddCandidates.sort((a, b) => compareStrings(a.path, b.path) || compareStrings(a.entry_id, b.entry_id));
    report.suspected_wrong_date_smart_add = smartAddCandidates;
    report.remediation.quarantinable_smart_add_blocks = smartAddCandidates.map(item => makeQuarantineSuggestion(item, "smart_add"));

    const suspiciousSmartAddByDate = new Map();
    for (const item of smartAddCandidates) {
      const arr = suspiciousSmartAddByDate.get(item.target_date_polluted) || [];
      arr.push(item);
      suspiciousSmartAddByDate.set(item.target_date_polluted, arr);
    }

    for (const filePath of listMarkdownFiles(episodesDir)) {
      const relPath = normalizePath(relative(rootDir, filePath));
      const targetDate = extractPathDate(relPath);
      const content = readFileSync(filePath, "utf8");
      const terms = matchedTerms(content);
      if (terms.length === 0 || !isSuspiciousOpencodeTopic(content)) continue;
      const parsed = parseEpisodeContent(content);
      if (isCleanCanonicalCheckpointEpisode({ targetDate, parsed })) {
        report.skipped_canonical_checkpoint_episode.push({
          path: relPath,
          target_date: targetDate,
          metadata_target_date: parsed.metadata.targetDate || null,
          metadata_generated_at: parsed.metadata.generatedAt || null,
          source_type: parsed.metadata.source_type || null,
          smart_add_input_policy: parsed.metadata.smartAddInputPolicy || null,
          smart_add_included: parseNonNegativeInt(parsed.metadata.smartAddIncluded),
          raw_log_included: parseNonNegativeInt(parsed.metadata.rawLogIncluded),
          reason: "canonical_checkpoint_raw_log_first_episode",
        });
        continue;
      }
      const explicitDates = [
        ...extractIsoDates(content),
        ...extractChineseMonthDayDates(content, Number((targetDate || "0000").slice(0, 4)) || new Date().getUTCFullYear()),
      ].filter(Boolean);
      const evidenceDates = matchingEvidenceDates(evidenceIndex, terms, targetDate);
      const sourceDateCandidate = scoreSourceDateCandidate({
        targetDate,
        entryDate: parsed.metadata.targetDate || null,
        explicitDates,
        evidenceDates,
      });
      const pathStats = chunkStatsForPath(db, relPath);
      const item = {
        path: relPath,
        matched_terms: terms,
        source_date_candidate: sourceDateCandidate,
        target_date_polluted: targetDate,
        metadata_target_date: parsed.metadata.targetDate || null,
        metadata_generated_at: parsed.metadata.generatedAt || null,
        indexed_chunk_count: pathStats.chunk_count,
        indexed_fts_row_count: pathStats.fts_row_count,
        indexed_chunk_ids: pathStats.chunk_ids,
        preview: safePreview(parsed.body || content),
      };
      const previousDay = previousDate(targetDate);
      const previousDaySmartAdd = previousDay ? (suspiciousSmartAddByDate.get(previousDay) || []) : [];
      const previousDayPropagation = previousDaySmartAdd.some(candidate =>
        candidate.matched_terms.some(term => item.matched_terms.includes(term)),
      );
      if (previousDayPropagation) {
        const propagatedSources = previousDaySmartAdd
          .map(candidate => candidate.source_date_candidate || candidate.target_date_polluted)
          .filter(Boolean)
          .sort((left, right) => compareStrings(left, right));
        if (propagatedSources.length > 0) item.source_date_candidate = propagatedSources[0];
      }
      const olderSource = isRecentForwardGap(sourceDateCandidate, targetDate, { minDays: 2, maxDays: 30 });
      if (previousDayPropagation || olderSource) {
        report.suspected_propagated_episode.push(item);
        report.remediation.quarantinable_episodes.push(makeQuarantineSuggestion(item, "episode"));
      }
    }

    const staleByPath = new Map();
    for (const item of [...report.suspected_wrong_date_smart_add, ...report.suspected_propagated_episode]) {
      if (Number(item.indexed_chunk_count || 0) <= 0 && Number(item.indexed_fts_row_count || 0) <= 0) continue;
      if (!staleByPath.has(item.path)) {
        staleByPath.set(item.path, {
          path: item.path,
          source_date_candidate: item.source_date_candidate,
          target_date_polluted: item.target_date_polluted,
          chunk_count: item.indexed_chunk_count,
          fts_row_count: item.indexed_fts_row_count,
          chunk_ids: item.indexed_chunk_ids,
        });
      }
    }
    report.remediation.stale_index_cleanup_candidates = Array.from(staleByPath.values()).sort((a, b) => compareStrings(a.path, b.path));
    report.suspected_wrong_date_smart_add.sort((a, b) => compareStrings(a.path, b.path) || compareStrings(a.entry_id, b.entry_id));
    report.suspected_propagated_episode.sort((a, b) => compareStrings(a.path, b.path));
    report.skipped_canonical_checkpoint_episode.sort((a, b) => compareStrings(a.path, b.path));
    report.summary.suspected_wrong_date_smart_add = report.suspected_wrong_date_smart_add.length;
    report.summary.suspected_propagated_episode = report.suspected_propagated_episode.length;
    report.summary.skipped_canonical_checkpoint_episode = report.skipped_canonical_checkpoint_episode.length;
    report.summary.stale_index_cleanup_path_count = report.remediation.stale_index_cleanup_candidates.length;
    report.summary.stale_index_cleanup_chunk_count = report.remediation.stale_index_cleanup_candidates.reduce(
      (sum, item) => sum + Number(item.chunk_count || 0),
      0,
    );
    return report;
  } finally {
    db?.close();
  }
}

export function renderSmartAddPropagationAuditMarkdown(report) {
  const smartAdd = (report?.suspected_wrong_date_smart_add || [])
    .map(item => `- ${item.path} :: ${item.entry_id} :: source_date_candidate=${item.source_date_candidate || "unknown"} :: target_date_polluted=${item.target_date_polluted}`)
    .join("\n") || "- none";
  const episodes = (report?.suspected_propagated_episode || [])
    .map(item => `- ${item.path} :: source_date_candidate=${item.source_date_candidate || "unknown"} :: target_date_polluted=${item.target_date_polluted}`)
    .join("\n") || "- none";
  const stale = (report?.remediation?.stale_index_cleanup_candidates || [])
    .map(item => `- ${item.path}: chunks=${item.chunk_count}, fts=${item.fts_row_count}`)
    .join("\n") || "- none";

  return `# Smart Add Propagation Audit

## Summary

- generated_at: ${report.generated_at}
- suspected_wrong_date_smart_add: ${report.summary.suspected_wrong_date_smart_add}
- suspected_propagated_episode: ${report.summary.suspected_propagated_episode}
- skipped_canonical_checkpoint_episode: ${report.summary.skipped_canonical_checkpoint_episode || 0}
- stale_index_cleanup_path_count: ${report.summary.stale_index_cleanup_path_count}
- stale_index_cleanup_chunk_count: ${report.summary.stale_index_cleanup_chunk_count}

## suspected_wrong_date_smart_add

${smartAdd}

## suspected_propagated_episode

${episodes}

## stale_index_cleanup_candidates

${stale}
`;
}

export function writeAuditReport(content, outPath) {
  const targetPath = resolve(process.cwd(), outPath);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content, "utf8");
  return targetPath;
}
