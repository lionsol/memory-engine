import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { runSmartAddPropagationAudit } from "./smart-add-propagation-audit.js";

export const SMART_ADD_PROPAGATION_CONFIRM_TOKEN = "quarantine-smart-add-propagation";
export const SMART_ADD_PROPAGATION_LOG_SCHEMA_VERSION = 1;

function normalizePath(value) {
  return String(value ?? "").replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

function compareStrings(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
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

function defaultPaths(options = {}) {
  const home = homedir();
  const rootDir = options.rootDir || process.env.MEMORY_ENGINE_WORKSPACE_DIR || resolve(home, ".openclaw/workspace");
  const memoryDir = options.memoryDir || resolve(rootDir, "memory");
  return { rootDir, memoryDir };
}

function listConfirmedPaths(input = []) {
  return Array.from(new Set((input || []).map(normalizePath).filter(Boolean))).sort(compareStrings);
}

function listConfirmedSelectors(input = []) {
  return Array.from(new Set((input || []).map(value => String(value ?? "").trim()).filter(Boolean)));
}

function parseSmartAddEntries(content) {
  const normalized = String(content || "").replace(/\r\n/g, "\n");
  const blockRe = /(?:<!--\s*smart-add-fingerprint:\s*[a-f0-9]{8,64}\s*-->\s*\n)?##\s+[\s\S]*?(?=\n(?:<!--\s*smart-add-fingerprint:\s*[a-f0-9]{8,64}\s*-->\s*\n)?##\s+|$)/gi;
  const blocks = (normalized.match(blockRe) || []).map(block => block.trim()).filter(Boolean);
  return blocks.map((block, index) => {
    const lines = block.split("\n");
    const headingLine = lines.find(line => /^\s*##\s+/.test(line)) || "";
    const entryId = String(headingLine || "").replace(/^\s*##\s*/, "").trim();
    const categoryLine = lines.find(line => /^\s*Category:\s*/i.test(line));
    const category = categoryLine
      ? String(categoryLine.replace(/^\s*Category:\s*/i, "").split("|")[0] || "").trim()
      : null;
    const fingerprintMatch = block.match(/<!--\s*smart-add-fingerprint:\s*([a-f0-9]{8,64})\s*-->/i);
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
    return {
      index,
      entryId,
      blockId: entryId,
      category,
      fingerprint: fingerprintMatch ? fingerprintMatch[1].toLowerCase() : null,
      text,
      raw: block,
      block_hash: sha256(block),
    };
  });
}

function renderSmartAddFile(entries) {
  const normalizedEntries = (entries || []).map(entry => String(entry.raw || "").trim()).filter(Boolean);
  if (normalizedEntries.length === 0) return "# Smart Added Memory\n";
  return `# Smart Added Memory\n\n${normalizedEntries.join("\n\n")}\n`;
}

function splitSentences(text) {
  const source = String(text || "");
  const matches = source.match(/[^。！？!?]+[。！？!?]?/g) || [];
  return matches.map(item => item.trim()).filter(Boolean);
}

function cleanEpisodeContent(content) {
  return String(content || "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n+---\n/g, "\n\n---\n")
    .trimEnd() + "\n";
}

function renderQuarantineEntry(item) {
  const matchedTerms = Array.isArray(item.matched_terms) ? item.matched_terms.join(", ") : "";
  return [
    `## ${item.block_hash}`,
    "",
    `- schema_version: ${SMART_ADD_PROPAGATION_LOG_SCHEMA_VERSION}`,
    `- source_path: ${item.source_path}`,
    `- target_path: ${item.target_path}`,
    `- block_id: ${item.block_id || "unknown"}`,
    `- fingerprint: ${item.fingerprint || "unknown"}`,
    `- block_hash: ${item.block_hash}`,
    `- reason: ${item.reason}`,
    `- pollution_type: ${item.pollution_type}`,
    `- source_date_candidate: ${item.source_date_candidate || "unknown"}`,
    `- polluted_target_date: ${item.polluted_target_date || "unknown"}`,
    `- review_status: ${item.review_status}`,
    `- matched_terms: ${matchedTerms || "none"}`,
    "",
    "```md",
    String(item.content || "").trim(),
    "```",
    "",
  ].join("\n");
}

function appendQuarantineTarget(targetPath, entries) {
  const header = "# Quarantined Smart-Add Propagation\n\n";
  const content = entries.map(renderQuarantineEntry).join("\n");
  mkdirSync(dirname(targetPath), { recursive: true });
  if (!existsSync(targetPath)) {
    writeFileSync(targetPath, `${header}${content}`, "utf8");
    return;
  }
  appendFileSync(targetPath, `\n${content}`, "utf8");
}

function appendQuarantineLog(logPath, rows) {
  mkdirSync(dirname(logPath), { recursive: true });
  for (const row of rows) {
    appendFileSync(logPath, `${JSON.stringify(row)}\n`, "utf8");
  }
}

function buildManualReviewItem({
  path,
  reason,
  pollutionType,
  sourceDateCandidate = null,
  pollutedTargetDate = null,
  preview = "",
}) {
  return {
    path,
    reason,
    pollution_type: pollutionType,
    source_date_candidate: sourceDateCandidate,
    polluted_target_date: pollutedTargetDate,
    requires_manual_review: true,
    preview,
  };
}

function extractEntryDate(entryId) {
  const match = String(entryId || "").match(/^(\d{4}-\d{2}-\d{2})_/);
  return match ? match[1] : null;
}

function isGeneratedSmartAddEntry(entry) {
  return /^\d{4}-\d{2}-\d{2}_.+_nightly_generated_/i.test(String(entry?.entryId || ""));
}

function buildChangedBlockPreview(item) {
  return {
    source_path: item.source_path,
    block_id: item.block_id,
    fingerprint: item.fingerprint,
    reason: item.reason,
    pollution_type: item.pollution_type,
    source_date_candidate: item.source_date_candidate,
    polluted_target_date: item.polluted_target_date,
    content: String(item.content || "").trim(),
  };
}

function selectConfirmedSmartAddBlocks(relPath, content, selectorOptions = {}) {
  const entries = parseSmartAddEntries(content);
  const targetDate = extractPathDate(relPath);
  const confirmedFingerprints = listConfirmedSelectors(selectorOptions.confirmedFingerprints).map(value => value.toLowerCase());
  const confirmedPrefixes = listConfirmedSelectors(selectorOptions.confirmedPrefixes);

  if (confirmedFingerprints.length > 0 || confirmedPrefixes.length > 0) {
    const selectedEntries = [];
    let confirmedFingerprintCount = 0;
    let confirmedPrefixCount = 0;

    for (const entry of entries) {
      const fingerprintMatched = Boolean(entry.fingerprint)
        && confirmedFingerprints.some(value => entry.fingerprint.startsWith(value));
      const prefixMatched = confirmedPrefixes.some(value => String(entry.entryId || "").startsWith(value));
      if (!fingerprintMatched && !prefixMatched) continue;
      if (fingerprintMatched) confirmedFingerprintCount += 1;
      if (prefixMatched) confirmedPrefixCount += 1;

      const reason = fingerprintMatched
        ? "manual_confirmed_opencode_propagation"
        : "manual_confirmed_wrong_file_date";
      const matchedTerms = [];
      if (fingerprintMatched && entry.fingerprint) matchedTerms.push(`fingerprint:${entry.fingerprint.slice(0, 8)}`);
      if (prefixMatched) {
        const matchedPrefix = confirmedPrefixes.find(value => String(entry.entryId || "").startsWith(value));
        matchedTerms.push(`prefix:${matchedPrefix}`);
      }
      if (/(opencode|OpenCode)/i.test(entry.raw)) matchedTerms.push("OpenCode");
      if (/env:\s*前缀/i.test(entry.raw)) matchedTerms.push("env:前缀");

      selectedEntries.push({
        kind: "smart_add_block",
        source_path: relPath,
        source_date_candidate: extractEntryDate(entry.entryId) || targetDate,
        polluted_target_date: targetDate,
        matched_terms: matchedTerms,
        pollution_type: reason === "manual_confirmed_opencode_propagation"
          ? "smart_add_opencode_propagation"
          : "smart_add_wrong_file_date",
        reason,
        review_status: "manual_confirmed",
        block_hash: entry.block_hash,
        block_id: entry.blockId,
        fingerprint: entry.fingerprint,
        content: entry.raw,
        entry_id: entry.entryId,
      });
    }

    if (selectedEntries.length === 0) {
      return {
        status: "manual_review",
        items: [],
        review: buildManualReviewItem({
          path: relPath,
          reason: "explicit smart-add selectors did not match any safe generated block in the confirmed file",
          pollutionType: "manual_confirmed_selector_miss",
          sourceDateCandidate: null,
          pollutedTargetDate: targetDate,
          preview: safePreview(content),
        }),
      };
    }

    const selectedHashes = new Set(selectedEntries.map(item => item.block_hash));
    const remainingEntries = entries.filter(entry => !selectedHashes.has(entry.block_hash));
    const preservedGeneratedBlocks = remainingEntries.filter(isGeneratedSmartAddEntry).length;

    return {
      status: "confirmed",
      items: selectedEntries,
      remaining_entries: remainingEntries,
      confirmed_fingerprints_found: confirmedFingerprintCount,
      confirmed_prefix_blocks_found: confirmedPrefixCount,
      preserved_clean_blocks: preservedGeneratedBlocks,
      changed_block_previews: selectedEntries.map(buildChangedBlockPreview),
    };
  }

  const confirmed = entries.filter(entry =>
    String(entry.category || "").toLowerCase() === "raw_log"
    && /昨天做了什么/.test(entry.raw)
    && /env:\s*前缀/i.test(entry.raw)
    && /(opencode|OpenCode)/i.test(entry.raw),
  );

  if (confirmed.length > 0) {
    return {
      status: "confirmed",
      items: confirmed.map(entry => ({
        kind: "smart_add_block",
        source_path: relPath,
        source_date_candidate: "2026-06-10",
        polluted_target_date: extractPathDate(relPath),
        matched_terms: ["opencode", "env 前缀"],
        pollution_type: "smart_add_feedback_loop",
        reason: "confirmed opencode env-prefix contamination recorded inside smart-add raw_log block",
        review_status: "confirmed",
        block_hash: entry.block_hash,
        block_id: entry.blockId,
        fingerprint: entry.fingerprint,
        content: entry.raw,
        entry_id: entry.entryId,
      })),
      remaining_entries: entries.filter(entry => !confirmed.some(item => item.block_hash === entry.block_hash)),
      confirmed_fingerprints_found: 0,
      confirmed_prefix_blocks_found: 0,
      preserved_clean_blocks: entries.filter(entry => !confirmed.some(item => item.block_hash === entry.block_hash) && isGeneratedSmartAddEntry(entry)).length,
      changed_block_previews: confirmed.map(buildChangedBlockPreview),
    };
  }

  return {
    status: "manual_review",
    items: [],
    review: buildManualReviewItem({
      path: relPath,
      reason: "confirmed smart-add path did not expose a safe raw_log block boundary for the known opencode env-prefix contamination",
      pollutionType: "smart_add_feedback_loop",
      sourceDateCandidate: "2026-06-10",
      pollutedTargetDate: extractPathDate(relPath),
      preview: safePreview(content),
    }),
  };
}

function selectConfirmedEpisodeSegments(relPath, content) {
  const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
  const targetDate = extractPathDate(relPath);
  const summaryLineIndex = lines.findIndex((line, index) => index > 0 && line.trim());
  const summaryLine = summaryLineIndex >= 0 ? lines[summaryLineIndex] : "";
  const summarySentence = splitSentences(summaryLine).find(sentence => /apiKey缺失env:\s*前缀/.test(sentence));
  const bulletLineIndex = lines.findIndex(line => /^\s*-\s+.*env:OPENCODE_API_KEY/.test(line));
  const bulletLine = bulletLineIndex >= 0 ? lines[bulletLineIndex] : "";

  const items = [];
  if (summarySentence) {
    items.push({
      kind: "episode_sentence",
      source_path: relPath,
      source_date_candidate: "2026-06-10",
      polluted_target_date: targetDate,
      matched_terms: ["opencode", "env 前缀"],
      pollution_type: "episode_propagation",
      reason: "confirmed propagated episode sentence about the historical opencode env-prefix fix",
      review_status: "confirmed",
      block_hash: sha256(summarySentence),
      block_id: `${targetDate || "unknown-date"}:summary:${summaryLineIndex}`,
      fingerprint: null,
      content: summarySentence,
      line_index: summaryLineIndex,
    });
  }
  if (bulletLine) {
    items.push({
      kind: "episode_line",
      source_path: relPath,
      source_date_candidate: "2026-06-10",
      polluted_target_date: targetDate,
      matched_terms: ["env:", "OPENCODE_API_KEY"],
      pollution_type: "episode_propagation",
      reason: "confirmed propagated episode config bullet about env:OPENCODE_API_KEY",
      review_status: "confirmed",
      block_hash: sha256(bulletLine),
      block_id: `${targetDate || "unknown-date"}:config:${bulletLineIndex}`,
      fingerprint: null,
      content: bulletLine,
      line_index: bulletLineIndex,
    });
  }

  if (items.length === 0) {
    return {
      status: "manual_review",
      items: [],
      review: buildManualReviewItem({
        path: relPath,
        reason: "confirmed episode path did not expose a safe sentence or bullet boundary for the known opencode env-prefix contamination",
        pollutionType: "episode_propagation",
        sourceDateCandidate: "2026-06-10",
        pollutedTargetDate: targetDate,
        preview: safePreview(content),
      }),
    };
  }

  const nextLines = [...lines];
  if (summarySentence) {
    nextLines[summaryLineIndex] = summaryLine.replace(summarySentence, "").replace(/\s+/g, " ").trim();
  }
  if (bulletLine) {
    nextLines[bulletLineIndex] = "";
  }

  return {
    status: "confirmed",
    items,
    next_content: cleanEpisodeContent(nextLines.join("\n")),
  };
}

function buildConfirmedTarget(relPath, memoryDir, rootDir) {
  const absolute = resolve(rootDir, relPath);
  const pathDate = extractPathDate(relPath);
  const quarantineDir = resolve(memoryDir, "quarantined-smart-add-propagation");
  const quarantinePath = resolve(quarantineDir, `${pathDate || "unknown-date"}.md`);
  return {
    path: relPath,
    absolute_path: absolute,
    target_date: pathDate,
    quarantine_path: quarantinePath,
    quarantine_path_relative: normalizePath(relative(rootDir, quarantinePath)),
  };
}

function buildStaleCleanupCandidates(quarantineAppliedItems) {
  const byPath = new Map();
  for (const item of quarantineAppliedItems) {
    const key = String(item.source_path || "");
    if (!key) continue;
    const existing = byPath.get(key) || {
      source_path: key,
      pollution_types: new Set(),
      source_date_candidates: new Set(),
      block_hashes: [],
      cleanup_scope: "confirmed_quarantined_path_only",
    };
    existing.pollution_types.add(String(item.pollution_type || "unknown"));
    if (item.source_date_candidate) existing.source_date_candidates.add(String(item.source_date_candidate));
    existing.block_hashes.push(String(item.block_hash));
    byPath.set(key, existing);
  }
  return Array.from(byPath.values())
    .map(item => ({
      source_path: item.source_path,
      pollution_types: Array.from(item.pollution_types).sort(compareStrings),
      source_date_candidates: Array.from(item.source_date_candidates).sort(compareStrings),
      block_hashes: item.block_hashes.sort(compareStrings),
      cleanup_scope: item.cleanup_scope,
    }))
    .sort((a, b) => compareStrings(a.source_path, b.source_path));
}

export function runSmartAddPropagationQuarantine(options = {}) {
  const { rootDir, memoryDir } = defaultPaths(options);
  const auditCoreDbPath = options.coreDbPath || resolve(rootDir, "main.sqlite");
  const confirmedPaths = listConfirmedPaths(options.confirmedPaths);
  const confirmedFingerprints = listConfirmedSelectors(options.confirmedFingerprints).map(value => value.toLowerCase());
  const confirmedPrefixes = listConfirmedSelectors(options.confirmedPrefixes);
  const audit = runSmartAddPropagationAudit({ rootDir, memoryDir, coreDbPath: auditCoreDbPath });
  const suspectedTotal = Number(audit?.summary?.suspected_wrong_date_smart_add || 0)
    + Number(audit?.summary?.suspected_propagated_episode || 0);

  const report = {
    mode: options.apply ? "apply" : "dry_run",
    generated_at: new Date().toISOString(),
    root_dir: normalizePath(rootDir),
    memory_dir: normalizePath(memoryDir),
    confirm_token_required: SMART_ADD_PROPAGATION_CONFIRM_TOKEN,
    confirmed_paths: confirmedPaths,
    confirmed_fingerprints: confirmedFingerprints,
    confirmed_prefixes: confirmedPrefixes,
    confirmed_blocks_found: 0,
    confirmed_fingerprints_found: 0,
    confirmed_prefix_blocks_found: 0,
    preserved_clean_blocks: 0,
    requires_manual_review: 0,
    would_quarantine_count: 0,
    quarantined_count: 0,
    untouched_suspected_count: suspectedTotal,
    exact_changed_block_preview: [],
    confirmed_targets: [],
    quarantine: {
      applied: false,
      quarantine_dir: normalizePath(resolve(memoryDir, "quarantined-smart-add-propagation")),
      log_path: normalizePath(resolve(memoryDir, "quarantined-smart-add-propagation", "quarantine-log.jsonl")),
      moved: [],
      skipped: [],
    },
    review_report: [],
    stale_cleanup_candidates: [],
  };

  if (options.apply && options.confirm !== SMART_ADD_PROPAGATION_CONFIRM_TOKEN) {
    throw new Error(`apply mode requires --confirm ${SMART_ADD_PROPAGATION_CONFIRM_TOKEN}`);
  }

  const confirmedAppliedItems = [];

  for (const relPath of confirmedPaths) {
    const target = buildConfirmedTarget(relPath, memoryDir, rootDir);
    if (!existsSync(target.absolute_path)) {
      report.review_report.push(buildManualReviewItem({
        path: relPath,
        reason: "confirmed path missing from filesystem",
        pollutionType: "confirmed_path_missing",
        pollutedTargetDate: target.target_date,
      }));
      continue;
    }

    const content = readFileSync(target.absolute_path, "utf8");
    let selection;
    if (relPath.startsWith("memory/smart-add/")) {
      selection = selectConfirmedSmartAddBlocks(relPath, content, {
        confirmedFingerprints,
        confirmedPrefixes,
      });
    } else if (relPath.startsWith("memory/episodes/")) {
      selection = selectConfirmedEpisodeSegments(relPath, content);
    } else {
      selection = {
        status: "manual_review",
        items: [],
        review: buildManualReviewItem({
          path: relPath,
          reason: "confirmed path is outside smart-add/episodes quarantine handlers",
          pollutionType: "unsupported_confirmed_path",
          pollutedTargetDate: target.target_date,
          preview: safePreview(content),
        }),
      };
    }

    if (selection.status !== "confirmed") {
      report.requires_manual_review += 1;
      report.review_report.push(selection.review);
      report.confirmed_targets.push({
        path: relPath,
        status: "requires_manual_review",
        would_quarantine: 0,
      });
      continue;
    }

    const targetItems = selection.items.map(item => ({
      ...item,
      target_path: target.quarantine_path_relative,
    }));
    report.confirmed_blocks_found += targetItems.length;
    report.confirmed_fingerprints_found += Number(selection.confirmed_fingerprints_found || 0);
    report.confirmed_prefix_blocks_found += Number(selection.confirmed_prefix_blocks_found || 0);
    report.preserved_clean_blocks += Number(selection.preserved_clean_blocks || 0);
    report.would_quarantine_count += targetItems.length;
    report.exact_changed_block_preview.push(...(selection.changed_block_previews || []));
    report.confirmed_targets.push({
      path: relPath,
      status: options.apply ? "quarantined" : "confirmed",
      would_quarantine: targetItems.length,
      target_path: target.quarantine_path_relative,
      block_hashes: targetItems.map(item => item.block_hash),
      confirmed_fingerprints_found: Number(selection.confirmed_fingerprints_found || 0),
      confirmed_prefix_blocks_found: Number(selection.confirmed_prefix_blocks_found || 0),
      preserved_clean_blocks: Number(selection.preserved_clean_blocks || 0),
      exact_changed_block_preview: selection.changed_block_previews || [],
    });

    if (!options.apply) continue;

    if (relPath.startsWith("memory/smart-add/")) {
      writeFileSync(target.absolute_path, renderSmartAddFile(selection.remaining_entries), "utf8");
    } else if (relPath.startsWith("memory/episodes/")) {
      writeFileSync(target.absolute_path, selection.next_content, "utf8");
    }

    const quarantinedAt = new Date().toISOString();
    const logRows = targetItems.map(item => ({
      schema_version: SMART_ADD_PROPAGATION_LOG_SCHEMA_VERSION,
      quarantined_at: quarantinedAt,
      source_path: item.source_path,
      target_path: item.target_path,
      block_id: item.block_id || item.entry_id || null,
      fingerprint: item.fingerprint || null,
      block_hash: item.block_hash,
      reason: item.reason,
      pollution_type: item.pollution_type,
      source_date_candidate: item.source_date_candidate,
      polluted_target_date: item.polluted_target_date,
      review_status: item.review_status,
      matched_terms: item.matched_terms,
    }));
    appendQuarantineTarget(target.quarantine_path, targetItems);
    appendQuarantineLog(resolve(memoryDir, "quarantined-smart-add-propagation", "quarantine-log.jsonl"), logRows);
    report.quarantine.moved.push(...logRows);
    report.quarantined_count += targetItems.length;
    confirmedAppliedItems.push(...targetItems);
  }

  report.requires_manual_review = report.review_report.length;
  report.untouched_suspected_count = Math.max(0, suspectedTotal - report.confirmed_blocks_found);
  if (options.apply) {
    report.quarantine.applied = true;
    report.stale_cleanup_candidates = buildStaleCleanupCandidates(confirmedAppliedItems);
  }
  return report;
}

export function renderSmartAddPropagationQuarantineMarkdown(report) {
  const targets = (report.confirmed_targets || [])
    .map(item => `- ${item.path} :: ${item.status} :: would_quarantine=${item.would_quarantine}`)
    .join("\n") || "- none";
  const reviews = (report.review_report || [])
    .map(item => `- ${item.path} :: ${item.reason}`)
    .join("\n") || "- none";
  const stale = (report.stale_cleanup_candidates || [])
    .map(item => `- ${item.source_path} :: blocks=${item.block_hashes.length}`)
    .join("\n") || "- none";
  return `# Smart Add Propagation Quarantine

## Summary

- mode: ${report.mode}
- confirmed_blocks_found: ${report.confirmed_blocks_found}
- confirmed_fingerprints_found: ${report.confirmed_fingerprints_found}
- confirmed_prefix_blocks_found: ${report.confirmed_prefix_blocks_found}
- preserved_clean_blocks: ${report.preserved_clean_blocks}
- requires_manual_review: ${report.requires_manual_review}
- would_quarantine_count: ${report.would_quarantine_count}
- quarantined_count: ${report.quarantined_count}
- untouched_suspected_count: ${report.untouched_suspected_count}

## Confirmed Targets

${targets}

## Review Report

${reviews}

## Stale Cleanup Candidates

${stale}
`;
}

export function writeQuarantineReport(content, outPath) {
  const targetPath = resolve(process.cwd(), outPath);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content, "utf8");
  return targetPath;
}
