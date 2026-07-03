#!/usr/bin/env node
/**
 * Export annotation candidates for archived smart-add raw_log rescue.
 *
 * Read-only by design:
 * - reads memory-engine DB and attached OpenClaw core DB
 * - writes only reports/ candidate files
 * - performs no unarchive, category update, delete, quarantine, or reinforce
 */

const Database = require('better-sqlite3');
const { existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { homedir } = require('node:os');
const { dirname, resolve } = require('node:path');
const {
  DEFAULT_RESCUE_KEYWORDS,
  describeSignalPolarity,
  inferArchivedRawLogRescueSignals,
} = require('../lib/annotation/archived-raw-log-rescue-signals.cjs');

const HOME = homedir();
const DEFAULT_ENGINE_DB = resolve(HOME, '.openclaw/memory/memory-engine/memory-engine.sqlite');
const DEFAULT_CORE_DB = resolve(HOME, '.openclaw/memory/main.sqlite');
const DEFAULT_KEYWORDS = DEFAULT_RESCUE_KEYWORDS;
const ALLOWED_FORMATS = new Set(['jsonl', 'md']);

function readFlag(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  if (index >= 0 && index + 1 < argv.length) return argv[index + 1];
  const prefix = `${name}=`;
  const inline = argv.find(arg => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  return fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function toPositiveInteger(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeKeywords(value) {
  if (!value) return DEFAULT_KEYWORDS;
  const items = String(value).split(',').map(item => item.trim()).filter(Boolean);
  return items.length ? Array.from(new Set(items)) : DEFAULT_KEYWORDS;
}

function timestampForFile(now = new Date()) {
  return now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
}

function defaultOutPath(format, now = new Date()) {
  return resolve(process.cwd(), 'reports', `archived-raw-log-rescue-candidates-${timestampForFile(now)}.${format}`);
}

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

function readablePreview(text, maxLength = 900) {
  const normalized = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function riskScoreFor(row, signals) {
  let score = 0;
  score += Math.min(40, signals.length * 6);
  if (signals.includes('decision_signal')) score += 25;
  if (signals.includes('preference_signal')) score += 25;
  if (signals.includes('todo_signal')) score += 18;
  if (signals.includes('project:memory-engine')) score += 16;
  if (signals.includes('project:openclaw')) score += 12;
  if (signals.includes('project_progress_signal')) score += 10;
  if (signals.includes('engineering_evidence_signal')) score += 18;
  if (signals.includes('runtime_verification_signal')) score += 12;
  if (signals.includes('test_result_summary_signal')) score += 10;
  if (signals.includes('architecture_explanation_signal')) score += 12;
  if (signals.includes('memory_policy_signal')) score += 14;
  if (signals.includes('transient_runtime_noise_signal')) score -= 30;
  if (signals.includes('pure_tool_output_signal')) score -= 10;
  score += Math.min(8, Number(row.text_length || 0) / 1000);
  return Math.max(0, Math.round(score * 10) / 10);
}

function primaryBucket(signals) {
  if (signals.includes('transient_runtime_noise_signal') && !signals.includes('engineering_evidence_signal')) {
    return 'archived_raw_log_transient';
  }
  if (signals.includes('decision_signal')) return 'archived_raw_log_decision';
  if (signals.includes('preference_signal')) return 'archived_raw_log_preference';
  if (signals.includes('todo_signal')) return 'archived_raw_log_todo';
  if (signals.includes('project:memory-engine') || signals.includes('project:openclaw') || signals.includes('engineering_evidence_signal')) return 'archived_raw_log_project';
  return 'archived_raw_log_keyword';
}

function buildWhereClause(keywords) {
  const keywordPredicates = keywords.map(() => 'c.text LIKE ?').join(' OR ');
  return {
    sql: [
      'mc.is_archived = 1',
      "AND mc.category = 'raw_log'",
      "AND c.path LIKE 'memory/smart-add/%'",
      keywordPredicates ? `AND (${keywordPredicates})` : '',
    ].filter(Boolean).join(' '),
    params: keywords.map(keyword => `%${keyword}%`),
  };
}

function queryCandidates({ engineDbPath, coreDbPath, keywords, limit, offset }) {
  if (!existsSync(engineDbPath)) throw new Error(`engine DB not found: ${engineDbPath}`);
  if (!existsSync(coreDbPath)) throw new Error(`core DB not found: ${coreDbPath}`);

  const db = new Database(engineDbPath, { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  db.exec(`ATTACH DATABASE '${escapeSqlString(coreDbPath)}' AS core`);
  try {
    const where = buildWhereClause(keywords);
    return db.prepare([
      'SELECT',
      'mc.chunk_id, mc.category, mc.confidence, mc.last_confidence_update, mc.hit_count,',
      'mc.base_tau, mc.conflict_flag, mc.is_archived,',
      'c.path, c.updated_at, LENGTH(c.text) AS text_length, c.text',
      'FROM memory_confidence mc',
      'JOIN core.chunks c ON c.id = mc.chunk_id',
      `WHERE ${where.sql}`,
      'ORDER BY',
      "CASE WHEN c.text LIKE '%决定%' OR c.text LIKE '%结论%' THEN 0 ELSE 1 END,",
      "CASE WHEN c.text LIKE '%偏好%' THEN 0 ELSE 1 END,",
      "CASE WHEN c.text LIKE '%待办%' THEN 0 ELSE 1 END,",
      'c.path DESC, LENGTH(c.text) DESC, mc.chunk_id ASC',
      'LIMIT ? OFFSET ?',
    ].join(' ')).all(...where.params, limit, offset);
  } finally {
    db.close();
  }
}

function buildSample(row, { keywords, previewChars }) {
  const signals = inferArchivedRawLogRescueSignals(row.text, { keywords });
  const signalPolarity = describeSignalPolarity(signals);
  const bucket = primaryBucket(signals);
  const signalBuckets = [];
  if (signalPolarity.positive_evidence.length) signalBuckets.push('archived_raw_log_engineering_evidence');
  if (signalPolarity.negative_evidence.length) signalBuckets.push('archived_raw_log_transient_noise');
  const fileDateMatch = String(row.path || '').match(/memory\/smart-add\/(\d{4}-\d{2}-\d{2})\.md/);
  return {
    sample_type: 'memory',
    sample_subtype: 'archived_raw_log_rescue',
    sample_id: `rescue:${row.chunk_id}`,
    memory_id: row.chunk_id,
    chunk_id: row.chunk_id,
    path: row.path,
    source_path: row.path,
    path_family: 'smart-add',
    source_file_date: fileDateMatch ? fileDateMatch[1] : null,
    category: row.category,
    is_archived: true,
    confidence: row.confidence,
    hit_count: Number(row.hit_count || 0),
    conflict_flag: Number(row.conflict_flag || 0),
    last_confidence_update: row.last_confidence_update,
    updated_at: row.updated_at,
    text_length: Number(row.text_length || 0),
    primary_bucket: bucket,
    sample_buckets: Array.from(new Set([bucket, ...signalBuckets, 'archived_raw_log_rescue'])),
    risk_signals: signals,
    signal_polarity: signalPolarity,
    quality_flags: ['archived_raw_log', 'raw_log_leak'],
    risk_score: riskScoreFor(row, signals),
    content_preview: readablePreview(row.text, previewChars),
    content_missing_reason: null,
    annotation: {
      quality: null,
      currency: null,
      auto_recall_eligible: null,
      preferred_action: null,
      keep_active: null,
      target_category: null,
      rescue_confidence: null,
      reason: null,
      notes: null,
    },
  };
}

function pickStratifiedSamples(samples, limit) {
  const bucketPriority = [
    'archived_raw_log_decision',
    'archived_raw_log_preference',
    'archived_raw_log_todo',
    'archived_raw_log_project',
    'archived_raw_log_transient',
    'archived_raw_log_keyword',
  ];
  const selected = [];
  const selectedIds = new Set();
  const perBucketLimit = Math.max(10, Math.ceil(limit / bucketPriority.length));

  for (const bucket of bucketPriority) {
    let count = 0;
    for (const sample of samples) {
      if (count >= perBucketLimit) break;
      if (sample.primary_bucket !== bucket) continue;
      if (selectedIds.has(sample.sample_id)) continue;
      selected.push(sample);
      selectedIds.add(sample.sample_id);
      count += 1;
      if (selected.length >= limit) return selected;
    }
  }

  for (const sample of samples) {
    if (selected.length >= limit) break;
    if (selectedIds.has(sample.sample_id)) continue;
    selected.push(sample);
    selectedIds.add(sample.sample_id);
  }
  return selected;
}

function renderJsonl(samples) {
  return `${samples.map(sample => JSON.stringify(sample)).join('\n')}\n`;
}

function renderMarkdown(samples, report) {
  const lines = [
    '# Archived Raw Log Rescue Candidates',
    '',
    `- generated_at: ${report.generated_at}`,
    `- sample_count: ${samples.length}`,
    '- mode: read_only_candidate_export',
    `- keywords: ${report.keywords.join(', ')}`,
    '',
  ];
  for (const sample of samples) {
    lines.push(`## ${sample.sample_id}`);
    lines.push('');
    lines.push(`- chunk_id: ${sample.chunk_id}`);
    lines.push(`- path: ${sample.path}`);
    lines.push(`- source_file_date: ${sample.source_file_date}`);
    lines.push(`- primary_bucket: ${sample.primary_bucket}`);
    lines.push(`- risk_score: ${sample.risk_score}`);
    lines.push(`- risk_signals: ${sample.risk_signals.join(', ') || 'none'}`);
    lines.push(`- annotation.keep_active: ${sample.annotation.keep_active}`);
    lines.push(`- annotation.target_category: ${sample.annotation.target_category}`);
    lines.push(`- annotation.rescue_confidence: ${sample.annotation.rescue_confidence}`);
    lines.push('');
    lines.push('```text');
    lines.push(sample.content_preview || '(empty)');
    lines.push('```');
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, '--help') || hasFlag(argv, '-h')) {
    console.log(`Usage:\n  node bin/export-archived-raw-log-rescue-candidates.cjs [options]\n\nOptions:\n  --limit <n>          Number of candidates to export (default: 100)\n  --offset <n>         Offset into ranked candidates (default: 0)\n  --preview-chars <n>  Preview length (default: 900)\n  --keywords <csv>     Keyword filter CSV (default: ${DEFAULT_KEYWORDS.join(',')})\n  --format <jsonl|md>  Output format (default: jsonl)\n  --out <path>         Output path (default: reports/archived-raw-log-rescue-candidates-*.jsonl)\n  --engine-db <path>   Memory-engine DB path\n  --core-db <path>     OpenClaw core DB path\n\nSafety:\n  Read-only. Does not unarchive, update category, delete, quarantine, reinforce, or write DB.`);
    return;
  }

  const limit = toPositiveInteger(readFlag(argv, '--limit', '100'), 100);
  const offset = Math.max(0, Number.parseInt(String(readFlag(argv, '--offset', '0')), 10) || 0);
  const previewChars = toPositiveInteger(readFlag(argv, '--preview-chars', '900'), 900);
  const keywords = normalizeKeywords(readFlag(argv, '--keywords', null));
  const format = String(readFlag(argv, '--format', 'jsonl')).toLowerCase();
  if (!ALLOWED_FORMATS.has(format)) throw new Error('--format must be jsonl or md');
  const out = resolve(process.cwd(), readFlag(argv, '--out', defaultOutPath(format)));
  const engineDbPath = resolve(readFlag(argv, '--engine-db', process.env.MEMORY_ENGINE_DB_PATH || DEFAULT_ENGINE_DB));
  const coreDbPath = resolve(readFlag(argv, '--core-db', process.env.MEMORY_ENGINE_CORE_DB || DEFAULT_CORE_DB));

  const candidatePoolLimit = Math.max(limit * 10, limit);
  const rows = queryCandidates({ engineDbPath, coreDbPath, keywords, limit: candidatePoolLimit, offset });
  const candidatePool = rows.map(row => buildSample(row, { keywords, previewChars }));
  const samples = pickStratifiedSamples(candidatePool, limit);
  mkdirSync(dirname(out), { recursive: true });
  const report = {
    generated_at: new Date().toISOString(),
    keywords,
    sample_count: samples.length,
  };
  writeFileSync(out, format === 'md' ? renderMarkdown(samples, report) : renderJsonl(samples), 'utf8');
  console.log(JSON.stringify({
    mode: 'read_only_candidate_export',
    output_path: out,
    sample_count: samples.length,
    candidate_pool_count: candidatePool.length,
    limit,
    offset,
    preview_chars: previewChars,
    keywords,
    format,
    safety: {
      db_writes: false,
      unarchive: false,
      category_update: false,
      delete: false,
      quarantine: false,
      reinforce: false,
    },
  }, null, 2));
}

main();
