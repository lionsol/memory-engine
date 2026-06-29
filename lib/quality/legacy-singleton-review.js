import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { readUnifiedMemoryEvents } from "../../console/services/metrics-service.js";
import {
  openAuditDb,
  resolveAuditDbPaths,
  writeAuditReport,
} from "./chunks-without-confidence-audit.js";
import { classifyQualityScope } from "./quality-scope.js";

const DEFAULT_TARGET_PATH = "memory/daily.md";

function maxDateTime(a, b) {
  if (!a) return b ?? null;
  if (!b) return a ?? null;
  return String(a) >= String(b) ? a : b;
}

function safePreview(text, maxLength = 160) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}

function normalizeForMatch(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function parseInteger(value, fallback = 20) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export function normalizeReviewPath(value = DEFAULT_TARGET_PATH) {
  const raw = String(value ?? "").trim().replace(/\\/g, "/");
  const normalized = path.posix.normalize(raw).replace(/^\.\/+/, "").replace(/^\/+/, "");
  if (!normalized.startsWith("memory/")) {
    throw new Error(`path must stay under memory/*: ${value}`);
  }
  if (normalized === "memory" || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`path must stay under memory/*: ${value}`);
  }
  return normalized;
}

function readSingletonRows(db, targetPath) {
  return db.prepare(`
    SELECT
      c.id AS id,
      c.path AS path,
      c.text AS text,
      c.updated_at AS updated_at,
      CASE WHEN mc.chunk_id IS NULL THEN 0 ELSE 1 END AS has_confidence_record
    FROM core.chunks c
    LEFT JOIN memory_confidence mc ON mc.chunk_id = c.id
    WHERE c.path = @targetPath
    ORDER BY c.updated_at DESC, c.id ASC
  `).all({ targetPath }).map(row => ({
    id: String(row.id || ""),
    path: String(row.path || ""),
    text: row.text ?? null,
    updated_at: row.updated_at ?? null,
    has_confidence_record: Boolean(row.has_confidence_record),
  }));
}

function eventMatchesChunk(row, metadata, chunkIds, chunkIdPrefixes, targetPath) {
  const explicitPath = String(metadata?.path ?? "").trim();
  if (explicitPath === targetPath) return true;

  const ids = [
    row?.memory_id,
    metadata?.memory_id,
    metadata?.chunk_id,
    metadata?.id,
  ].map(value => String(value ?? "").trim()).filter(Boolean);

  for (const id of ids) {
    if (chunkIds.has(id)) return true;
    if (chunkIdPrefixes.has(id)) return true;
  }
  return false;
}

function aggregateUsage(rows, targetPath, events = null) {
  const chunkIds = new Set(rows.items.map(item => item.id));
  const chunkIdPrefixes = new Set(rows.items.map(item => String(item.id).slice(0, 16)).filter(Boolean));
  const eventRows = Array.isArray(events) ? events : readUnifiedMemoryEvents(rows.db);
  let retrievedCount = 0;
  let injectedCount = 0;
  let lastRetrievedAt = null;
  let lastInjectedAt = null;

  for (const row of eventRows) {
    const eventType = String(row?.event_type ?? "");
    if (eventType !== "memory_candidate_retrieved" && eventType !== "memory_injected") {
      continue;
    }
    let metadata = {};
    if (row?.metadata_json) {
      try {
        metadata = JSON.parse(row.metadata_json);
      } catch {
        metadata = {};
      }
    }
    if (!eventMatchesChunk(row, metadata, chunkIds, chunkIdPrefixes, targetPath)) {
      continue;
    }
    if (eventType === "memory_candidate_retrieved") {
      retrievedCount += 1;
      lastRetrievedAt = maxDateTime(lastRetrievedAt, row?.created_at ?? null);
    }
    if (eventType === "memory_injected") {
      injectedCount += 1;
      lastInjectedAt = maxDateTime(lastInjectedAt, row?.created_at ?? null);
    }
  }

  return {
    retrieved_count: retrievedCount,
    injected_count: injectedCount,
    last_retrieved_at: lastRetrievedAt,
    last_injected_at: lastInjectedAt,
  };
}

function buildCombinedPreview(values, sampleLimit) {
  const unique = Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map(value => normalizeForMatch(value))
      .filter(Boolean),
  ));
  if (unique.length === 0) return "";
  return safePreview(unique.slice(0, sampleLimit).join("\n"));
}

function resolveChunkMatchesFileExcerpt({ existsOnDisk, fileText, chunkTexts }) {
  if (!existsOnDisk) return "unknown";
  const normalizedFile = normalizeForMatch(fileText);
  const normalizedChunks = chunkTexts.map(normalizeForMatch).filter(Boolean);
  if (!normalizedFile || normalizedChunks.length === 0) return "unknown";
  return normalizedChunks.some(text => normalizedFile.includes(text));
}

function looksGeneratedOrHealthcheck(text) {
  const normalized = normalizeForMatch(text).toLowerCase();
  if (!normalized) return false;
  return /healthcheck|generated|diagnostic|heartbeat|smoke test|self-test|dry run/.test(normalized);
}

function resolveSuggestedAction({ hasConfidenceRecordCount, retrievedCount, injectedCount }) {
  if (hasConfidenceRecordCount > 0 || retrievedCount > 0 || injectedCount > 0) {
    return "manual_review_required";
  }
  return "safe_to_review_for_stale_index_or_legacy_file";
}

function resolveLikelyClassification({
  existsOnDisk,
  indexedChunkCount,
  chunkMatchesFileExcerpt,
  generatedLikeContent,
  suggestedAction,
}) {
  if (suggestedAction === "manual_review_required") {
    return "manual_review_required";
  }
  if (!existsOnDisk && indexedChunkCount > 0) {
    return "stale_index_candidate";
  }
  if (existsOnDisk && chunkMatchesFileExcerpt === true) {
    return "legacy_file_candidate";
  }
  if (existsOnDisk && generatedLikeContent) {
    return "legacy_file_candidate";
  }
  return "classification_rule_gap";
}

function resolveReason({
  targetPath,
  existsOnDisk,
  indexedChunkCount,
  hasConfidenceRecordCount,
  retrievedCount,
  injectedCount,
  chunkMatchesFileExcerpt,
  likelyClassification,
}) {
  if (hasConfidenceRecordCount > 0 || retrievedCount > 0 || injectedCount > 0) {
    return `${targetPath} has usage or confidence evidence (confidence=${hasConfidenceRecordCount}, retrieved=${retrievedCount}, injected=${injectedCount}); keep review manual and do not cleanup`;
  }
  if (likelyClassification === "stale_index_candidate") {
    return `${targetPath} is indexed (${indexedChunkCount} chunk(s)) but the file is absent on disk; this looks like stale index state and remains review-only`;
  }
  if (likelyClassification === "legacy_file_candidate" && chunkMatchesFileExcerpt === true) {
    return `${targetPath} exists on disk and indexed chunk text appears in the file; this looks like a legacy singleton file and remains review-only`;
  }
  if (likelyClassification === "legacy_file_candidate") {
    return `${targetPath} exists on disk and its content looks generated or healthcheck-like; this looks like a legacy singleton file and remains review-only`;
  }
  if (existsOnDisk) {
    return `${targetPath} exists on disk but evidence does not clearly distinguish stale index vs legacy singleton; treat this as a classification rule gap and keep review-only`;
  }
  return `${targetPath} has no on-disk file and no indexed chunks; this remains a classification rule gap and review-only`;
}

export function buildLegacySingletonReview({
  db,
  targetPath = DEFAULT_TARGET_PATH,
  projectRoot = process.cwd(),
  sampleLimit = 20,
} = {}) {
  if (!db) {
    throw new Error("buildLegacySingletonReview requires an open db");
  }
  const normalizedTargetPath = normalizeReviewPath(targetPath);
  const scope = classifyQualityScope(normalizedTargetPath);
  const rows = readSingletonRows(db, normalizedTargetPath);
  const resolvedSampleLimit = parseInteger(sampleLimit, 20);
  const filePath = path.resolve(projectRoot, normalizedTargetPath);
  const existsOnDisk = existsSync(filePath);
  const fileText = existsOnDisk ? readFileSync(filePath, "utf8") : "";
  const usage = aggregateUsage({ db, items: rows }, normalizedTargetPath);
  const chunkTexts = rows.map(row => row.text).filter(Boolean).slice(0, resolvedSampleLimit);
  const chunkMatchesFileExcerpt = resolveChunkMatchesFileExcerpt({
    existsOnDisk,
    fileText,
    chunkTexts,
  });
  const hasConfidenceRecordCount = rows.filter(row => row.has_confidence_record).length;
  const suggestedAction = resolveSuggestedAction({
    hasConfidenceRecordCount,
    retrievedCount: usage.retrieved_count,
    injectedCount: usage.injected_count,
  });
  const likelyClassification = resolveLikelyClassification({
    existsOnDisk,
    indexedChunkCount: rows.length,
    chunkMatchesFileExcerpt,
    generatedLikeContent: scope.family === "unknown" && looksGeneratedOrHealthcheck(fileText),
    suggestedAction,
  });

  return {
    mode: "readonly",
    target_path: normalizedTargetPath,
    exists_on_disk: existsOnDisk,
    indexed_chunk_count: rows.length,
    chunk_ids: rows.map(row => row.id).slice(0, resolvedSampleLimit),
    has_confidence_record_count: hasConfidenceRecordCount,
    retrieved_count: usage.retrieved_count,
    injected_count: usage.injected_count,
    last_retrieved_at: usage.last_retrieved_at,
    last_injected_at: usage.last_injected_at,
    text_preview: buildCombinedPreview(chunkTexts, resolvedSampleLimit),
    file_preview: safePreview(fileText),
    chunk_matches_file_excerpt: chunkMatchesFileExcerpt,
    likely_classification: likelyClassification,
    suggested_action: suggestedAction,
    reason: resolveReason({
      targetPath: normalizedTargetPath,
      existsOnDisk,
      indexedChunkCount: rows.length,
      hasConfidenceRecordCount,
      retrievedCount: usage.retrieved_count,
      injectedCount: usage.injected_count,
      chunkMatchesFileExcerpt,
      likelyClassification,
    }),
    side_effects: {
      db_writes: false,
      memory_file_mutation: false,
      config_mutation: false,
      archive: false,
      quarantine: false,
      reinforce: false,
      confidence_backfill: false,
      llm: false,
      network: false,
    },
  };
}

export function renderLegacySingletonReviewMarkdown(report) {
  const chunkIds = (report?.chunk_ids || []).map(id => `- ${id}`).join("\n") || "- none";
  return `# Legacy Singleton Review

## Summary

- mode: ${report.mode}
- target_path: ${report.target_path}
- exists_on_disk: ${report.exists_on_disk}
- indexed_chunk_count: ${report.indexed_chunk_count}
- has_confidence_record_count: ${report.has_confidence_record_count}
- retrieved_count: ${report.retrieved_count}
- injected_count: ${report.injected_count}
- last_retrieved_at: ${report.last_retrieved_at ?? "null"}
- last_injected_at: ${report.last_injected_at ?? "null"}
- chunk_matches_file_excerpt: ${report.chunk_matches_file_excerpt}
- likely_classification: ${report.likely_classification}
- suggested_action: ${report.suggested_action}
- reason: ${report.reason}

## Chunk IDs

${chunkIds}

## Previews

- text_preview: ${report.text_preview || "(empty)"}
- file_preview: ${report.file_preview || "(empty)"}

## Side Effects

- db_writes: ${report.side_effects.db_writes}
- memory_file_mutation: ${report.side_effects.memory_file_mutation}
- config_mutation: ${report.side_effects.config_mutation}
- archive: ${report.side_effects.archive}
- quarantine: ${report.side_effects.quarantine}
- reinforce: ${report.side_effects.reinforce}
- confidence_backfill: ${report.side_effects.confidence_backfill}
- llm: ${report.side_effects.llm}
- network: ${report.side_effects.network}
`;
}

export function runLegacySingletonReview(options = {}) {
  const dbPaths = options.dbPaths || resolveAuditDbPaths();
  const db = openAuditDb(dbPaths);
  try {
    return buildLegacySingletonReview({
      db,
      targetPath: options.targetPath || DEFAULT_TARGET_PATH,
      projectRoot: options.projectRoot || process.cwd(),
      sampleLimit: options.sampleLimit,
    });
  } finally {
    db.close();
  }
}

export {
  DEFAULT_TARGET_PATH,
  resolveAuditDbPaths,
  writeAuditReport,
};
