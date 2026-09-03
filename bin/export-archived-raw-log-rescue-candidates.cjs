#!/usr/bin/env node
/**
 * Export annotation candidates for archived smart-add raw_log rescue.
 *
 * Read-only by design:
 * - reads memory-engine DB and OpenClaw core DB through separate readonly handles
 * - writes only reports/ candidate files
 * - performs no unarchive, category update, delete, quarantine, or reinforce
 */

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

async function queryCandidates({ engineDbPath, coreDbPath, keywords, limit, offset }) {
  if (!existsSync(engineDbPath)) throw new Error(`engine DB not found: ${engineDbPath}`);
  if (!existsSync(coreDbPath)) throw new Error(`core DB not found: ${coreDbPath}`);

  const isolatedDbs = await import('../lib/db/isolated-dbs.js');
  return isolatedDbs.withIsolatedDbSession((session) => {
    const engineRows = isolatedDbs.withEngineDbIsolated((db) => db.prepare(`
      SELECT
        chunk_id, category, confidence, last_confidence_update, hit_count,
        base_tau, conflict_flag, is_archived
      FROM memory_confidence
      WHERE is_archived = 1
        AND category = 'raw_log'
    `).all(), { session, coreDbPath, engineDbPath, readonly: true });
    const where = buildWhereClause(keywords);
    const coreRows = isolatedDbs.withCoreDbReadonly((db) => db.prepare(`
      SELECT
        c.id, c.path, c.updated_at, LENGTH(c.text) AS text_length, c.text
      FROM chunks c
      WHERE c.path LIKE 'memory/smart-add/%'
        AND (${keywords.map(() => 'c.text LIKE ?').join(' OR ') || '1 = 0'})
    `).all(...where.params), { session, coreDbPath, engineDbPath });
    const coreById = new Map(coreRows.map(row => [String(row.id), row]));
    return engineRows
      .map(engineRow => {
        const coreRow = coreById.get(String(engineRow.chunk_id));
        if (!coreRow) return null;
        return { ...engineRow, ...coreRow };
      })
      .filter(Boolean)
      .sort((a, b) => (
        Number(Boolean(!(String(a.text || '').includes('决定') || String(a.text || '').includes('结论'))))
          - Number(Boolean(!(String(b.text || '').includes('决定') || String(b.text || '').includes('结论'))))
        || Number(Boolean(!String(a.text || '').includes('偏好')))
          - Number(Boolean(!String(b.text || '').includes('偏好')))
        || Number(Boolean(!String(a.text || '').includes('待办')))
          - Number(Boolean(!String(b.text || '').includes('待办')))
        || String(b.path || '').localeCompare(String(a.path || ''))
        || Number(b.text_length || 0) - Number(a.text_length || 0)
        || String(a.chunk_id || '').localeCompare(String(b.chunk_id || ''))
      ))
      .slice(offset, offset + limit);
  }, { coreDbPath, engineDbPath });
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

async function main() {
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
  const rows = await queryCandidates({ engineDbPath, coreDbPath, keywords, limit: candidatePoolLimit, offset });
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

if (require.main === module) {
  main().catch(error => {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  });
}

module.exports = {
  buildWhereClause,
  main,
  queryCandidates,
};
