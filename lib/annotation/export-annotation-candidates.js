import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { collectQualityCandidates } from "../quality/collect-quality-candidates.js";
import { evaluateDuplicateFlags, evaluateQualityFlags } from "../quality/quality-rules.js";
import { withEngineDb } from "../db/engine-db.js";

const MEMORY_LEVEL_FIELDS = {
  quality: null,
  currency: null,
  auto_recall_eligible: null,
  preferred_action: null,
  notes: null,
};

const BUCKET_PRIORITY = [
  "raw_log_leak",
  "suspected_tool_output",
  "metadata_header_leak",
  "dreaming_duplicate",
  "duplicate_exact",
  "memory_root",
  "memory_other",
  "dreaming_non_duplicate",
  "never_retrieved",
  "missing_category",
  "missing_confidence",
];

function toPositiveInteger(value, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function normalizeFormat(value) {
  const format = String(value || "jsonl").trim().toLowerCase();
  if (format !== "jsonl" && format !== "md") {
    throw new Error(`--format must be one of: jsonl, md`);
  }
  return format;
}

function timestampForFile(now = new Date()) {
  const iso = new Date(now).toISOString();
  return iso.slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
}

function defaultOutPath({ cwd = process.cwd(), format = "jsonl", now = new Date() } = {}) {
  return resolve(cwd, "reports", `annotation-candidates-${timestampForFile(now)}.${format}`);
}

function readablePreview(text, maxLength = 700) {
  const normalized = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function hasToolOutputPattern(text) {
  return (
    /\b(stdout|stderr|exit code|exitCode|command output|sqlerror|sqliteerror)\b/i.test(String(text || ""))
    || /^>\s/m.test(String(text || ""))
    || /```(?:bash|sh|json|text)?/i.test(String(text || ""))
    || /\bProcess exited with code\b/i.test(String(text || ""))
  );
}

function hasMetadataHeaderPattern(text) {
  return (
    /^\s*(Category|Provenance|kg_data|targetDate|generatedAt|source_type)\s*:/im.test(String(text || ""))
    || /"targetDate"\s*:|"generatedAt"\s*:|"source_type"\s*:/i.test(String(text || ""))
  );
}

function inferSourceFamilySignals(candidate) {
  const family = String(candidate?.path_family || "");
  const signals = [];
  if (family === "smart-add") signals.push({ type: "smart_add_source", weight: 35 });
  if (family === "dreaming") signals.push({ type: "dreaming_source", weight: 35 });
  if (family === "episodes") signals.push({ type: "episode_source", weight: 30 });
  return signals;
}

function buildRiskSignals(candidate, duplicateFlags) {
  const flags = evaluateQualityFlags(candidate, { duplicateFlags });
  const signalMap = new Map();
  const add = (type, weight) => {
    const existing = signalMap.get(type);
    if (!existing || existing.weight < weight) signalMap.set(type, { type, weight });
  };

  if (flags.flags.includes("missing_category")) add("missing_category", 100);
  if (flags.flags.includes("chunks_without_confidence")) add("missing_confidence", 95);
  if (flags.flags.includes("duplicate_exact")) add("duplicate_exact", 90);
  if (flags.flags.includes("raw_log_leak") || String(candidate?.category || "").trim().toLowerCase() === "raw_log") {
    add("suspected_raw_log", 75);
  }
  if (hasToolOutputPattern(candidate?.text)) add("suspected_tool_output", 70);
  if (hasMetadataHeaderPattern(candidate?.text)) add("suspected_metadata_header", 65);

  for (const signal of inferSourceFamilySignals(candidate)) add(signal.type, signal.weight);

  const riskSignals = Array.from(signalMap.values()).sort((a, b) => b.weight - a.weight || a.type.localeCompare(b.type));
  const riskScore = riskSignals.reduce((sum, item) => sum + Number(item.weight || 0), 0)
    + Math.min(10, Number(candidate?.injected_count || 0))
    + Math.min(5, Number(candidate?.retrieved_count || 0));

  return {
    evaluatedFlags: flags,
    riskSignals,
    riskScore,
  };
}

function classifyBuckets(candidate, analysis) {
  const buckets = new Set();
  const flagSet = new Set(analysis.evaluatedFlags.flags);
  const pathFamily = String(candidate?.path_family || "");

  if (flagSet.has("missing_category")) buckets.add("missing_category");
  if (flagSet.has("chunks_without_confidence")) buckets.add("missing_confidence");
  if (flagSet.has("raw_log_leak") || String(candidate?.category || "").trim().toLowerCase() === "raw_log") {
    buckets.add("raw_log_leak");
  }
  if (analysis.riskSignals.some(item => item.type === "suspected_tool_output")) buckets.add("suspected_tool_output");
  if (analysis.riskSignals.some(item => item.type === "suspected_metadata_header")) buckets.add("metadata_header_leak");
  if (flagSet.has("duplicate_exact")) buckets.add("duplicate_exact");
  if (pathFamily === "dreaming" && flagSet.has("duplicate_exact")) buckets.add("dreaming_duplicate");
  if (pathFamily === "dreaming" && !flagSet.has("duplicate_exact")) buckets.add("dreaming_non_duplicate");
  if (pathFamily === "memory-other") buckets.add("memory_other");
  if (pathFamily === "memory-root") buckets.add("memory_root");
  if (Number(candidate?.retrieved_count || 0) === 0) buckets.add("never_retrieved");

  const sampleBuckets = Array.from(buckets).sort((a, b) => {
    const ai = BUCKET_PRIORITY.indexOf(a);
    const bi = BUCKET_PRIORITY.indexOf(b);
    const ar = ai >= 0 ? ai : Number.MAX_SAFE_INTEGER;
    const br = bi >= 0 ? bi : Number.MAX_SAFE_INTEGER;
    return ar - br || a.localeCompare(b);
  });
  const primaryBucket = sampleBuckets[0] || "risk_fill";
  return {
    primaryBucket,
    sampleBuckets,
  };
}

function writeOutput(content, outPath) {
  const targetPath = resolve(process.cwd(), outPath);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content, "utf8");
  return targetPath;
}

function createFixtureBundle(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  const chunkTextById = parsed?.chunk_text_by_id && typeof parsed.chunk_text_by_id === "object"
    ? parsed.chunk_text_by_id
    : {};
  return {
    collector: () => parsed,
    chunkTextResolver: (ids) => {
      const map = new Map();
      for (const id of ids) {
        if (Object.hasOwn(chunkTextById, id)) {
          map.set(id, {
            found: true,
            text: chunkTextById[id],
            missing_reason: String(chunkTextById[id] || "").trim() ? null : "text_column_empty",
          });
        } else {
          map.set(id, {
            found: false,
            text: null,
            missing_reason: "chunk_not_found",
          });
        }
      }
      return map;
    },
  };
}

function readChunkTextsFromDb(ids) {
  if (!ids.length) return new Map();
  try {
    return withEngineDb((db) => {
      const placeholders = ids.map(() => "?").join(", ");
      const rows = db.prepare(`
        SELECT c.id AS id, c.text AS text
        FROM core.chunks c
        WHERE c.id IN (${placeholders})
      `).all(...ids);
      const byId = new Map();
      for (const row of rows) {
        const text = row?.text ?? null;
        byId.set(String(row?.id || ""), {
          found: true,
          text,
          missing_reason: String(text ?? "").trim() ? null : "text_column_empty",
        });
      }
      for (const id of ids) {
        if (!byId.has(id)) {
          byId.set(id, {
            found: false,
            text: null,
            missing_reason: "chunk_not_found",
          });
        }
      }
      return byId;
    }, { readonly: true });
  } catch {
    return new Map(ids.map(id => [id, {
      found: false,
      text: null,
      missing_reason: "join_failed",
    }]));
  }
}

function resolveChunkTexts(ids, resolver) {
  if (typeof resolver === "function") return resolver(ids);
  return readChunkTextsFromDb(ids);
}

function enrichCandidatesWithJoinedText(candidates, joinedTextState) {
  return (candidates || []).map(candidate => {
    const joined = joinedTextState.get(String(candidate?.id || ""));
    if (!joined) return candidate;
    if (joined.missing_reason) return candidate;
    const joinedText = String(joined.text ?? "");
    if (!joinedText.trim()) return candidate;
    return {
      ...candidate,
      text: joinedText,
    };
  });
}

function buildSample(candidate, analysis, previewChars, joinedTextState) {
  const joined = joinedTextState.get(candidate.id) || {
    found: false,
    text: null,
    missing_reason: "join_failed",
  };
  const text = joined.missing_reason ? "" : String(joined.text ?? "");
  const preview = readablePreview(text, previewChars);
  return {
    sample_type: "memory",
    memory_id: candidate.id,
    chunk_id: candidate.id,
    path: candidate.path,
    path_family: candidate.path_family,
    quality_scope_family: candidate.quality_scope_family,
    quality_scope_owner: candidate.quality_scope_owner,
    category: candidate.category ?? null,
    has_confidence_record: Boolean(candidate.has_confidence_record),
    confidence: candidate.confidence ?? null,
    retrieved_count: Number(candidate.retrieved_count || 0),
    injected_count: Number(candidate.injected_count || 0),
    updated_at: candidate.updated_at ?? null,
    primary_bucket: analysis.primaryBucket,
    sample_buckets: analysis.sampleBuckets,
    risk_signals: analysis.riskSignals.map(item => item.type),
    quality_flags: analysis.evaluatedFlags.flags,
    risk_score: analysis.riskScore,
    content_preview: preview,
    content_missing_reason: preview ? null : (joined.missing_reason || "text_column_empty"),
    annotation: {
      ...MEMORY_LEVEL_FIELDS,
    },
  };
}

function sortAnalyzed(a, b) {
  return (
    Number(b.analysis.riskScore || 0) - Number(a.analysis.riskScore || 0)
    || Number(b.candidate.injected_count || 0) - Number(a.candidate.injected_count || 0)
    || Number(b.candidate.retrieved_count || 0) - Number(a.candidate.retrieved_count || 0)
    || String(a.candidate.path || "").localeCompare(String(b.candidate.path || ""))
    || String(a.candidate.id || "").localeCompare(String(b.candidate.id || ""))
  );
}

function pickSamples(analyzed, limit, perBucketLimit) {
  const selectedIds = new Set();
  const selected = [];

  for (const bucket of BUCKET_PRIORITY) {
    let count = 0;
    for (const item of analyzed) {
      if (count >= perBucketLimit) break;
      if (!item.analysis.sampleBuckets.includes(bucket)) continue;
      if (selectedIds.has(item.candidate.id)) continue;
      selected.push(item);
      selectedIds.add(item.candidate.id);
      count += 1;
      if (selected.length >= limit) return selected;
    }
  }

  for (const item of analyzed) {
    if (selected.length >= limit) break;
    if (selectedIds.has(item.candidate.id)) continue;
    selected.push(item);
    selectedIds.add(item.candidate.id);
  }
  return selected;
}

function renderJsonl(samples) {
  return `${samples.map(sample => JSON.stringify(sample)).join("\n")}\n`;
}

function renderMarkdown(samples, report) {
  const lines = [
    "# Human Annotation Candidates",
    "",
    `- generated_at: ${report.generated_at}`,
    `- sample_count: ${samples.length}`,
    `- sample_type: memory`,
    `- limit: ${report.limit}`,
    `- per_bucket_limit: ${report.per_bucket_limit}`,
    "",
  ];
  for (const sample of samples) {
    lines.push(`## ${sample.memory_id}`);
    lines.push("");
    lines.push(`- path: ${sample.path}`);
    lines.push(`- path_family: ${sample.path_family}`);
    lines.push(`- category: ${sample.category || "missing"}`);
    lines.push(`- primary_bucket: ${sample.primary_bucket}`);
    lines.push(`- sample_buckets: ${sample.sample_buckets.join(", ") || "none"}`);
    lines.push(`- risk_score: ${sample.risk_score}`);
    lines.push(`- risk_signals: ${sample.risk_signals.join(", ") || "none"}`);
    lines.push(`- quality_flags: ${sample.quality_flags.join(", ") || "none"}`);
    lines.push(`- content_missing_reason: ${sample.content_missing_reason}`);
    lines.push(`- annotation.quality: ${sample.annotation.quality}`);
    lines.push(`- annotation.currency: ${sample.annotation.currency}`);
    lines.push(`- annotation.auto_recall_eligible: ${sample.annotation.auto_recall_eligible}`);
    lines.push(`- annotation.preferred_action: ${sample.annotation.preferred_action}`);
    lines.push("");
    lines.push("```text");
    lines.push(sample.content_preview || "(empty)");
    lines.push("```");
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function exportAnnotationCandidates(options = {}) {
  const limit = toPositiveInteger(options.limit, 200);
  const perBucketLimit = toPositiveInteger(options.perBucketLimit, 30);
  const previewChars = toPositiveInteger(options.previewChars, 700);
  const format = normalizeFormat(options.format || "jsonl");
  const now = options.now || new Date();
  const outPath = options.out || defaultOutPath({ format, now });

  const fixtureBundle = options.fixturePath ? createFixtureBundle(options.fixturePath) : null;
  const collector = fixtureBundle?.collector || options.collector || collectQualityCandidates;
  const chunkTextResolver = fixtureBundle?.chunkTextResolver || options.chunkTextResolver || null;

  const candidateSource = collector({
    scope: "all",
    includeArchived: false,
    includeStatsHistory: false,
  });
  const baseCandidates = Array.isArray(candidateSource?.candidates) ? candidateSource.candidates : [];
  const joinedTextState = resolveChunkTexts(baseCandidates.map(item => String(item?.id || "")).filter(Boolean), chunkTextResolver);
  const candidates = enrichCandidatesWithJoinedText(baseCandidates, joinedTextState);
  const duplicateFlags = evaluateDuplicateFlags(candidates);

  const analyzed = candidates.map(candidate => {
    const risk = buildRiskSignals(candidate, duplicateFlags);
    const buckets = classifyBuckets(candidate, risk);
    return {
      candidate,
      analysis: {
        ...risk,
        primaryBucket: buckets.primaryBucket,
        sampleBuckets: buckets.sampleBuckets,
      },
    };
  }).filter(item => item.analysis.riskSignals.length > 0 || item.analysis.sampleBuckets.length > 0)
    .sort(sortAnalyzed);

  const selected = pickSamples(analyzed, limit, perBucketLimit);
  const samples = selected.map(item => buildSample(item.candidate, item.analysis, previewChars, joinedTextState));
  const content = format === "md"
    ? renderMarkdown(samples, {
      generated_at: new Date(now).toISOString(),
      limit,
      per_bucket_limit: perBucketLimit,
    })
    : renderJsonl(samples);
  const writtenPath = writeOutput(content, outPath);

  return {
    mode: "dry_run",
    generated_at: new Date(now).toISOString(),
    limit,
    per_bucket_limit: perBucketLimit,
    preview_chars: previewChars,
    format,
    output_path: writtenPath,
    sample_count: samples.length,
    sample_types: {
      memory: samples.length,
    },
    write_db: false,
    annotation_side_effects: false,
    reinforcement_side_effects: false,
    top_risk_signals: Array.from(new Set(samples.flatMap(sample => sample.risk_signals))).sort(),
    bucket_counts: Object.fromEntries(BUCKET_PRIORITY.map(bucket => [
      bucket,
      samples.filter(sample => sample.sample_buckets.includes(bucket)).length,
    ])),
  };
}
