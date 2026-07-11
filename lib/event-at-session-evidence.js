import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ALLOWED_ACTIONS = new Set(["needs_more_evidence", "keep_null", "recover_event_at"]);
const MESSAGE_ROLES = new Set(["user", "assistant"]);
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})$/;

export function sha256Hex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function sha256_16(value) {
  return sha256Hex(value).slice(0, 16);
}

export function parseEventTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value > 1e12 ? value / 1000 : value);
  }
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? Math.floor(numeric > 1e12 ? numeric / 1000 : numeric) : null;
  }
  if (!ISO_TIMESTAMP.test(raw)) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function dateStrFromTimestamp(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const pad = (number) => String(number).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

export function candidateText(candidate) {
  return String(candidate?.text ?? candidate?.raw_text ?? candidate?.preview ?? "").trim();
}

function extractMessageText(message) {
  if (typeof message?.content === "string") return message.content.trim();
  if (Array.isArray(message?.content)) {
    return message.content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n")
      .trim();
  }
  return "";
}

export function listSessionFiles(sessionsDir) {
  if (!sessionsDir || !existsSync(sessionsDir)) return [];
  return readdirSync(sessionsDir)
    .filter((name) => (name.endsWith(".jsonl") || name.includes(".jsonl.reset.") || name.includes(".jsonl.deleted."))
      && !name.includes(".trajectory."))
    .map((name) => ({ name, path: resolve(sessionsDir, name) }))
    .filter((file) => {
      try { return statSync(file.path).isFile(); } catch { return false; }
    });
}

export function normalizeText(value) {
  let text = String(value ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const steps = [];
  if (text !== String(value ?? "")) steps.push("normalize_line_endings");
  const trimmed = text.trim();
  if (trimmed !== text) steps.push("trim");
  text = trimmed;

  const rawWrapper = text.replace(/^\s*\[[^\]\n]{1,80}\]\s*/, "");
  if (rawWrapper !== text) {
    text = rawWrapper;
    steps.push("strip_raw_log_timestamp_wrapper");
  }
  const roleWrapper = text.replace(/^\s*\*\*(?:User|Assistant):\*\*\s*/, "");
  if (roleWrapper !== text) {
    text = roleWrapper;
    steps.push("strip_role_wrapper");
  }
  const collapsed = text.replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n");
  if (collapsed !== text) steps.push("collapse_whitespace");
  return { text: collapsed, steps };
}

function contextFor(text, start, end, contextChars) {
  if (!contextChars || start < 0 || end < 0) return undefined;
  const from = Math.max(0, start - contextChars);
  const to = Math.min(text.length, end + contextChars);
  return { text: text.slice(from, to), start: from, end: to };
}

function makeMessage(file, line, record) {
  const timestamp = record.timestamp ?? record.message?.timestamp ?? null;
  const eventAt = parseEventTimestamp(timestamp);
  const dateStr = dateStrFromTimestamp(timestamp);
  const text = extractMessageText(record.message);
  if (!MESSAGE_ROLES.has(record.message?.role) || !text) return null;
  return {
    file: file.name,
    line,
    role: record.message.role,
    text,
    timestamp: typeof timestamp === "string" ? timestamp : timestamp == null ? null : String(timestamp),
    eventAt,
    chunkId: eventAt === null || !dateStr ? null : sha256Hex(text + timestamp + dateStr),
    normalizedText: normalizeText(text).text,
  };
}

export function readSessionMessages(file) {
  const result = { messages: [], records_read: 0, malformed_line_count: 0, read_error: null };
  let content;
  try {
    content = readFileSync(file.path, "utf8");
  } catch (error) {
    result.read_error = String(error?.message || error);
    return result;
  }
  for (const [index, line] of content.split("\n").entries()) {
    if (!line.trim()) continue;
    result.records_read += 1;
    try {
      const record = JSON.parse(line);
      if (record?.type !== "message" || !record.message || !MESSAGE_ROLES.has(record.message.role)) continue;
      const message = makeMessage(file, index + 1, record);
      if (message) result.messages.push(message);
    } catch {
      result.malformed_line_count += 1;
    }
  }
  return result;
}

export function buildTranscriptIndex(sessionsDir) {
  const files = listSessionFiles(sessionsDir);
  const messages = [];
  const stats = { session_files_scanned: files.length, session_files_skipped_on_error: 0, session_records_read: 0, malformed_line_count: 0, messages_indexed: 0, file_read_errors: [] };
  for (const file of files) {
    const parsed = readSessionMessages(file);
    stats.session_records_read += parsed.records_read;
    stats.malformed_line_count += parsed.malformed_line_count;
    if (parsed.read_error) {
      stats.session_files_skipped_on_error += 1;
      stats.file_read_errors.push({ session_file: file.name, error: parsed.read_error });
      continue;
    }
    messages.push(...parsed.messages);
    stats.messages_indexed += parsed.messages.length;
  }
  return { messages, stats };
}

function scoreFuzzy(candidate, message) {
  const tokens = new Set(normalizeText(candidate).text.toLowerCase().split(/\s+/).filter((token) => token.length > 2));
  if (!tokens.size) return 0;
  const messageTokens = new Set(normalizeText(message).text.toLowerCase().split(/\s+/).filter((token) => token.length > 2));
  let overlap = 0;
  for (const token of tokens) if (messageTokens.has(token)) overlap += 1;
  return overlap / tokens.size;
}

function evidenceMatch(message, candidate, type, steps = [], candidateValue = "") {
  const target = normalizeText(candidateValue).text || candidateValue;
  const source = type === "exact_normalized_text" ? normalizeText(message.text).text : message.text;
  const position = target ? source.indexOf(target) : -1;
  const candidateLength = target.length;
  const messageLength = source.length;
  const matchedLength = Math.min(candidateLength, messageLength);
  return {
    match_type: type,
    confidence: type === "substring" ? "medium" : "high",
    eligible_for_event_at_apply: type === "exact_chunk_id" || type === "exact_normalized_text",
    requires_manual_confirm: type !== "exact_chunk_id",
    session_file: message.file,
    session_line: message.line,
    role: message.role,
    timestamp: message.timestamp,
    event_at: message.eventAt,
    normalization_steps: steps,
    candidate_coverage: candidateLength ? matchedLength / candidateLength : 0,
    message_coverage: messageLength ? matchedLength / messageLength : 0,
    matched_text_sha256_16: sha256_16(target),
    _message: message,
    _position: position,
  };
}

function publicMatch(match, includeContext, contextChars) {
  const output = { ...match };
  delete output._message;
  delete output._position;
  if (includeContext && match._position >= 0) output.context = contextFor(match._message.text, match._position, match._position + String(match._message.text).length, contextChars);
  return output;
}

export function resolveCandidate(candidate, label, messages, options = {}) {
  const text = candidateText(candidate);
  const normalizedCandidate = normalizeText(text);
  const byChunk = messages.filter((message) => message.chunkId && message.chunkId === candidate.id && message.eventAt !== null);
  const exact = byChunk.map((message) => evidenceMatch(message, candidate, "exact_chunk_id", [], text));
  const normalized = messages
    .filter((message) => message.normalizedText === normalizedCandidate.text && message.eventAt !== null)
    .map((message) => evidenceMatch(message, candidate, "exact_normalized_text", [...normalizedCandidate.steps, ...normalizeText(message.text).steps], text));
  const substring = [];
  if (text.length >= (options.substringMinLength ?? 120)) {
    for (const message of messages) {
      if (message.eventAt === null) continue;
      const candidateNorm = normalizedCandidate.text;
      const messageNorm = message.normalizedText;
      if (candidateNorm && (messageNorm.includes(candidateNorm) || candidateNorm.includes(messageNorm))) {
        const match = evidenceMatch(message, candidate, "substring", normalizeText(message.text).steps, text);
        if (Math.min(match.candidate_coverage, match.message_coverage) >= 0.8) substring.push(match);
      }
    }
  }
  const fuzzy = [];
  if (options.includeFuzzy === true && text.length >= 40) {
    for (const message of messages) {
      if (message.eventAt === null) continue;
      const score = scoreFuzzy(text, message.text);
      if (score >= (options.fuzzyThreshold ?? 0.75)) fuzzy.push({ ...evidenceMatch(message, candidate, "fuzzy", [], text), similarity: Number(score.toFixed(3)) });
    }
    fuzzy.sort((a, b) => b.similarity - a.similarity);
  }

  const matches = exact.length ? exact : normalized.length ? normalized : substring.length ? substring : fuzzy.slice(0, 5);
  const uniqueTimestamps = new Set(matches.map((match) => `${match.event_at}|${match.timestamp}`));
  const roles = new Set(matches.map((match) => match.role));
  const labelEventAt = parseEventTimestamp(label?.event_at);
  const roleConflict = candidate?.role_hint && roles.size && !roles.has(candidate.role_hint);
  let resolution_status = "no_match";
  if (matches.length) resolution_status = roleConflict || roles.size > 1 || (labelEventAt !== null && labelEventAt !== matches[0].event_at)
    ? "conflict"
    : matches.length > 1 || uniqueTimestamps.size > 1 ? "ambiguous" : "unique_match";
  const best = matches[0] ? publicMatch(matches[0], options.includeContext !== false, options.contextChars ?? 80) : null;
  return {
    id: candidate.id,
    text_sha256_16: candidate.text_sha256_16,
    review_action: label.review_action,
    resolution_status,
    match_count: matches.length,
    best_match: best,
    alternative_matches: matches.slice(1, 5).map((match) => publicMatch(match, options.includeContext !== false, options.contextChars ?? 80)),
    raw_text_exported: false,
    writes_db: false,
  };
}

export function resolveEvidence({ candidatesPath, labelsPath, sessionsDir, outPath, onlyAction, limit, includeContext = true }) {
  const candidates = readJsonl(candidatesPath);
  const labels = readJsonl(labelsPath);
  const candidateMap = new Map(candidates.rows.map((row) => [row.id, row]));
  const selected = labels.rows.filter((label) => ALLOWED_ACTIONS.has(label.review_action)
    && (!onlyAction || label.review_action === onlyAction)
    && (candidateMap.get(label.id)?.pilot_sample === true || label.manual_review_status === "reviewed"));
  const limited = Number.isFinite(limit) && limit > 0 ? selected.slice(0, limit) : selected;
  const transcript = buildTranscriptIndex(sessionsDir);
  const rows = limited.map((label) => {
    const candidate = candidateMap.get(label.id) || { id: label.id, text_sha256_16: label.text_sha256_16, preview: "" };
    return resolveCandidate(candidate, label, transcript.messages, { includeContext });
  });
  if (outPath) {
    mkdirSync(resolve(outPath, ".."), { recursive: true });
    writeFileSync(outPath, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8");
  }
  const breakdown = Object.fromEntries([...new Set(rows.map((row) => row.resolution_status))].sort().map((key) => [key, rows.filter((row) => row.resolution_status === key).length]));
  return {
    mode: "read_only",
    candidates_path: candidatesPath,
    labels_path: labelsPath,
    sessions_dir: sessionsDir,
    output_path: outPath || null,
    candidate_count: candidates.rows.length,
    selected_count: rows.length,
    only_action: onlyAction || null,
    pilot_sample_selection: "candidate.pilot_sample=true or label.manual_review_status=reviewed",
    resolution_breakdown: breakdown,
    unique_high_confidence_match_count: rows.filter((row) => row.resolution_status === "unique_match" && ["exact_chunk_id", "exact_normalized_text"].includes(row.best_match?.match_type) && row.best_match?.confidence === "high").length,
    malformed_line_count: candidates.malformed_line_count + labels.malformed_line_count + transcript.stats.malformed_line_count,
    file_read_errors: [...candidates.file_read_errors, ...labels.file_read_errors, ...transcript.stats.file_read_errors],
    session_stats: transcript.stats,
    raw_text_exported: false,
    writes_db: false,
    migration_applied: false,
    rows,
  };
}

function readJsonl(path) {
  let content;
  try { content = readFileSync(path, "utf8"); } catch (error) { return { rows: [], malformed_line_count: 0, file_read_errors: [{ path, error: String(error?.message || error) }] }; }
  const rows = [];
  let malformed_line_count = 0;
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { malformed_line_count += 1; }
  }
  return { rows, malformed_line_count, file_read_errors: [] };
}

export { readJsonl };
