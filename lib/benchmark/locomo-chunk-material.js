import { createHash } from "node:crypto";

import { buildLocomoDialogText } from "./locomo-v1.js";

export const LOCOMO_CHUNK_MATERIAL_SCHEMA = "q3_locomo_canonical_chunk_material_v1";
export const LOCOMO_CHUNK_RENDERER_ID = "locomo-markdown-turn-v1";
export const LOCOMO_CHUNK_SOURCE_TYPE = "markdown_memory";
export const LOCOMO_CHUNK_CORE_SOURCE = "memory";
export const LOCOMO_CHUNK_PATH_PREFIX = "memory/q3-locomo-v1.2/locomo";

const SESSION_KEY = /^session_(\d+)$/;
const DIA_ID = /^D([1-9]\d*):([1-9]\d*)$/;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}_must_be_object`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}_must_be_nonempty_string`);
  }
  return value;
}

function safePathSegment(value, label) {
  const text = requireString(value, label);
  const safe = text.replace(/[^A-Za-z0-9._-]+/g, "_");
  if (!safe) throw new Error(`${label}_path_segment_empty`);
  return safe;
}

function requireChunking({ tokens, overlap }) {
  if (!Number.isSafeInteger(tokens) || tokens < 1) {
    throw new Error("chunk_tokens_must_be_explicit_positive_integer");
  }
  if (!Number.isSafeInteger(overlap) || overlap < 0 || overlap >= tokens) {
    throw new Error("chunk_overlap_must_be_explicit_integer_in_range");
  }
  return { tokens, overlap };
}

function requireModelIdentity(modelIdentity) {
  const identity = assertObject(modelIdentity, "model_identity");
  const value = requireString(identity.value, "model_identity_value");
  const kind = requireString(identity.kind, "model_identity_kind");
  const source = requireString(identity.source, "model_identity_source");
  if (identity.productionEquivalent !== false) {
    throw new Error("model_identity_must_explicitly_not_claim_production_equivalence");
  }
  return {
    value,
    kind,
    source,
    productionEquivalent: false,
  };
}

function sessionIds(conversation) {
  assertObject(conversation, "conversation");
  return Object.keys(conversation)
    .map((key) => ({ key, match: key.match(SESSION_KEY) }))
    .filter((entry) => entry.match)
    .sort((left, right) => Number(left.match[1]) - Number(right.match[1]))
    .map((entry) => entry.key);
}

function codePointLength(value) {
  return Array.from(value).length;
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function lineMetadata(sourceText) {
  const lines = sourceText.split("\n");
  const metadata = [];
  let utf16Offset = 0;
  let codePointOffset = 0;
  let byteOffset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineUtf16Length = line.length;
    const lineCodePointLength = codePointLength(line);
    const lineByteLength = byteLength(line);
    metadata.push({
      line: index + 1,
      text: line,
      startUtf16: utf16Offset,
      endUtf16: utf16Offset + lineUtf16Length,
      startCodePoint: codePointOffset,
      endCodePoint: codePointOffset + lineCodePointLength,
      startByte: byteOffset,
      endByte: byteOffset + lineByteLength,
    });
    utf16Offset += lineUtf16Length + (index < lines.length - 1 ? 1 : 0);
    codePointOffset += lineCodePointLength + (index < lines.length - 1 ? 1 : 0);
    byteOffset += lineByteLength + (index < lines.length - 1 ? 1 : 0);
  }
  return metadata;
}

function lineForOffset(lines, offset) {
  const safeOffset = Math.max(0, Math.min(offset, lines.at(-1)?.endUtf16 ?? 0));
  for (const line of lines) {
    if (safeOffset >= line.startUtf16 && safeOffset <= line.endUtf16) return line.line;
  }
  return lines.at(-1)?.line ?? 1;
}

function rangeForOffsets(sourceText, lines, startUtf16, endUtf16) {
  const startLine = lineForOffset(lines, startUtf16);
  const endProbe = Math.max(startUtf16, endUtf16 - (endUtf16 > startUtf16 ? 1 : 0));
  const endLine = lineForOffset(lines, endProbe);
  return {
    startUtf16,
    endUtf16,
    startCodePoint: codePointLength(sourceText.slice(0, startUtf16)),
    endCodePoint: codePointLength(sourceText.slice(0, endUtf16)),
    startByte: byteLength(sourceText.slice(0, startUtf16)),
    endByte: byteLength(sourceText.slice(0, endUtf16)),
    startLine,
    endLine,
  };
}

function renderSession({ sampleId, sessionId, turns }) {
  if (!Array.isArray(turns)) throw new Error(`session_turns_must_be_array:${sessionId}`);
  const rows = [];
  const turnRanges = [];
  let sourceText = "";

  for (const [turnIndex, rawTurn] of turns.entries()) {
    const turn = assertObject(rawTurn, `turn:${sampleId}:${sessionId}:${turnIndex}`);
    const diaId = requireString(turn.dia_id, "turn_dia_id");
    if (!DIA_ID.test(diaId)) throw new Error(`turn_dia_id_invalid:${sampleId}:${diaId}`);
    const text = requireString(turn.text, `turn_text:${sampleId}:${diaId}`);
    const rendered = buildLocomoDialogText(turn);
    const rowStart = sourceText.length + (rows.length > 0 ? 1 : 0);
    const prefixLength = rendered.length - text.length;
    const textStart = rowStart + prefixLength;
    const textEnd = textStart + text.length;
    rows.push(rendered);
    sourceText += `${rows.length > 1 ? "\n" : ""}${rendered}`;
    turnRanges.push({
      sampleId,
      sessionId,
      diaId,
      turnIndex,
      speaker: turn.speaker,
      text,
      startUtf16: textStart,
      endUtf16: textEnd,
    });
  }

  const lines = lineMetadata(sourceText);
  return {
    sampleId,
    sessionId,
    logicalPath: `${LOCOMO_CHUNK_PATH_PREFIX}/${safePathSegment(sampleId, "sample_id")}/${safePathSegment(sessionId, "session_id")}.md`,
    sourceType: LOCOMO_CHUNK_SOURCE_TYPE,
    coreSource: LOCOMO_CHUNK_CORE_SOURCE,
    sourceText,
    sourceSha256: sha256(sourceText),
    turnRanges: turnRanges.map((turn) => ({
      ...turn,
      range: rangeForOffsets(sourceText, lines, turn.startUtf16, turn.endUtf16),
    })),
    lines,
  };
}

function validateChunk(rawChunk, index) {
  const chunk = assertObject(rawChunk, `chunk:${index}`);
  if (!Number.isSafeInteger(chunk.startLine) || !Number.isSafeInteger(chunk.endLine)) {
    throw new Error(`chunk_line_range_invalid:${index}`);
  }
  if (chunk.startLine < 1 || chunk.endLine < chunk.startLine) {
    throw new Error(`chunk_line_range_out_of_order:${index}`);
  }
  const text = requireString(chunk.text, `chunk_text:${index}`);
  const hash = requireString(chunk.hash, `chunk_hash:${index}`);
  if (sha256(text) !== hash) throw new Error(`chunk_hash_mismatch:${index}`);
  return {
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    text,
    hash,
  };
}

function lineForSpan(lines, startUtf16, endUtf16) {
  return lines.find((line) => (
    startUtf16 >= line.startUtf16
      && endUtf16 <= line.endUtf16
  )) ?? null;
}

function findChunkSourceRange(source, chunk) {
  const startLine = source.lines[chunk.startLine - 1];
  const endLine = source.lines[chunk.endLine - 1];
  if (!startLine || !endLine) {
    return { status: "unknown", reason: "chunk_line_range_out_of_source" };
  }
  const regionStart = startLine.startUtf16;
  const regionEnd = endLine.endUtf16;
  const parts = chunk.text.split("\n");
  const candidates = parts.map((part) => {
    const matches = [];
    if (part.length === 0) {
      for (const line of source.lines) {
        if (line.text === "" && line.startUtf16 >= regionStart && line.startUtf16 <= regionEnd) {
          matches.push({ startUtf16: line.startUtf16, endUtf16: line.endUtf16 });
        }
      }
      return matches;
    }
    let cursor = regionStart;
    while (cursor <= regionEnd) {
      const found = source.sourceText.indexOf(part, cursor);
      if (found < 0 || found + part.length > regionEnd) break;
      const line = lineForSpan(source.lines, found, found + part.length);
      if (line) matches.push({ startUtf16: found, endUtf16: found + part.length, line: line.line });
      cursor = found + 1;
    }
    return matches;
  });
  if (candidates.some((matches) => matches.length === 0)) {
    return {
      status: "unknown",
      reason: "chunk_text_not_contiguous_in_source",
      candidateCount: 0,
    };
  }

  const matches = [];
  function walk(partIndex, previous, chosen) {
    if (matches.length > 1) return;
    if (partIndex === candidates.length) {
      matches.push(chosen);
      return;
    }
    for (const candidate of candidates[partIndex]) {
      if (previous) {
        const gap = candidate.startUtf16 - previous.endUtf16;
        const sourceSeparator = source.sourceText.slice(previous.endUtf16, candidate.startUtf16);
        if (gap !== 0 && !(gap === 1 && sourceSeparator === "\n")) continue;
      }
      walk(partIndex + 1, candidate, [...chosen, candidate]);
    }
  }
  walk(0, null, []);
  if (matches.length !== 1) {
    return {
      status: "unknown",
      reason: matches.length === 0 ? "chunk_text_not_contiguous_in_source" : "chunk_text_position_ambiguous",
      candidateCount: matches.length,
    };
  }
  const match = matches[0];
  const first = match[0];
  const last = match.at(-1);
  const range = rangeForOffsets(source.sourceText, source.lines, first.startUtf16, last.endUtf16);
  const sourceText = source.sourceText.slice(range.startUtf16, range.endUtf16);
  return {
    status: "exact",
    range,
    sourceText,
    textMatchesSource: sourceText === chunk.text,
    syntheticNewlineCount: match.reduce((count, item, index) => {
      if (index === 0) return count;
      const previous = match[index - 1];
      return count + (item.startUtf16 === previous.endUtf16 ? 1 : 0);
    }, 0),
  };
}

function rangesOverlap(left, right) {
  return left.startUtf16 < right.endUtf16 && right.startUtf16 < left.endUtf16;
}

function classifyCoverage(targetRange, chunks) {
  if (targetRange.startUtf16 === targetRange.endUtf16) {
    return { status: "unknown", reason: "empty_target_text", chunkIds: [] };
  }
  const exact = chunks.filter((chunk) => chunk.position.status === "exact");
  const unknownLineOverlap = chunks.some((chunk) => (
    chunk.position.status !== "exact"
      && chunk.startLine <= targetRange.endLine
      && chunk.endLine >= targetRange.startLine
  ));
  const overlapping = exact.filter((chunk) => rangesOverlap(chunk.position.range, targetRange));
  const chunkIds = overlapping.map((chunk) => chunk.memoryId);
  if (unknownLineOverlap) return { status: "unknown", reason: "overlapping_chunk_position_unknown", chunkIds };
  if (overlapping.length === 0) return { status: "unknown", reason: "no_chunk_overlap", chunkIds };

  let cursor = targetRange.startUtf16;
  const ordered = overlapping.toSorted((left, right) => (
    left.position.range.startUtf16 - right.position.range.startUtf16
    || left.position.range.endUtf16 - right.position.range.endUtf16
  ));
  for (const chunk of ordered) {
    const range = chunk.position.range;
    if (range.startUtf16 > cursor) break;
    if (range.endUtf16 > cursor) cursor = range.endUtf16;
    if (cursor >= targetRange.endUtf16) break;
  }
  return {
    status: cursor >= targetRange.endUtf16 ? "full" : "partial",
    reason: cursor >= targetRange.endUtf16 ? null : "coverage_gap",
    chunkIds,
  };
}

function buildChunkId({ source, path, chunk, model }) {
  return sha256(`${source}:${path}:${chunk.startLine}:${chunk.endLine}:${chunk.hash}:${model}`);
}

function materializeSession({ source, chunkMarkdown, chunking, modelIdentity }) {
  const rawChunks = chunkMarkdown(source.sourceText, chunking);
  if (!Array.isArray(rawChunks)) throw new Error(`chunker_must_return_array:${source.logicalPath}`);
  const chunks = rawChunks
    .filter((chunk) => typeof chunk?.text === "string" && chunk.text.trim().length > 0)
    .map(validateChunk);
  const materialized = chunks.map((chunk, index) => {
    const position = findChunkSourceRange(source, chunk);
    const memoryId = buildChunkId({
      source: source.coreSource,
      path: source.logicalPath,
      chunk,
      model: modelIdentity.value,
    });
    return {
      sampleId: source.sampleId,
      sessionId: source.sessionId,
      chunkIndex: index,
      memoryId,
      text: chunk.text,
      hash: chunk.hash,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      source: {
        system: "openclaw_core",
        recordType: "chunk",
        recordId: memoryId,
        path: source.logicalPath,
        coreSource: source.coreSource,
        lineStart: chunk.startLine,
        lineEnd: chunk.endLine,
        text: chunk.text,
        coreHash: chunk.hash,
      },
      position,
      turnIds: [],
    };
  });

  for (const turn of source.turnRanges) {
    const coverage = classifyCoverage(turn.range, chunks.map((chunk, index) => materialized[index]));
    turn.chunkCoverage = coverage;
    for (const chunk of materialized) {
      if (chunk.position.status === "exact" && rangesOverlap(chunk.position.range, turn.range)) {
        chunk.turnIds.push(turn.diaId);
      }
    }
  }

  return {
    ...source,
    chunks: materialized,
    emptyChunksFiltered: rawChunks.length - chunks.length,
    turnRanges: source.turnRanges,
  };
}

export function renderLocomoSession({ sampleId, sessionId, turns }) {
  return renderSession({ sampleId, sessionId, turns });
}

export function buildLocomoChunkMaterial({
  samples,
  chunkMarkdown,
  tokens,
  overlap,
  modelIdentity,
}) {
  if (!Array.isArray(samples)) throw new Error("locomo_samples_must_be_array");
  if (typeof chunkMarkdown !== "function") throw new Error("openclaw_chunker_must_be_injected");
  const chunking = requireChunking({ tokens, overlap });
  const identity = requireModelIdentity(modelIdentity);
  const seenSampleIds = new Set();
  const sources = [];
  for (const rawSample of samples) {
    const sample = assertObject(rawSample, "locomo_sample");
    const sampleId = requireString(sample.sample_id, "sample_id");
    if (seenSampleIds.has(sampleId)) throw new Error(`duplicate_sample_id:${sampleId}`);
    seenSampleIds.add(sampleId);
    for (const sessionId of sessionIds(sample.conversation)) {
      const session = sample.conversation[sessionId];
      const source = renderSession({
        sampleId,
        sessionId,
        turns: session,
      });
      sources.push(materializeSession({
        source,
        chunkMarkdown,
        chunking,
        modelIdentity: identity,
      }));
    }
  }
  return {
    schema: LOCOMO_CHUNK_MATERIAL_SCHEMA,
    renderer: {
      id: LOCOMO_CHUNK_RENDERER_ID,
      sourceType: LOCOMO_CHUNK_SOURCE_TYPE,
      coreSource: LOCOMO_CHUNK_CORE_SOURCE,
      pathPrefix: LOCOMO_CHUNK_PATH_PREFIX,
      implementation: "lib/benchmark/locomo-v1.js#buildLocomoDialogText",
      options: {
        includeBlipCaption: false,
        includeSessionDatetime: false,
        turnSeparator: "newline",
        turnText: "raw_official_turn_text",
      },
      productionEquivalent: false,
    },
    chunking: {
      ...chunking,
      explicitExperimentParameters: true,
      productionParametersConfirmed: false,
    },
    modelIdentity: identity,
    emptyChunksFiltered: sources.reduce((count, source) => count + source.emptyChunksFiltered, 0),
    sources,
  };
}

function evidenceResult({ materialSource, evidenceId }) {
  if (typeof evidenceId !== "string" || !DIA_ID.test(evidenceId)) {
    return { evidenceId, status: "unknown", reason: "evidence_id_invalid", chunkIds: [] };
  }
  const turn = materialSource.turnRanges.find((entry) => entry.diaId === evidenceId);
  if (!turn) return { evidenceId, status: "unknown", reason: "evidence_turn_not_found", chunkIds: [] };
  const coverage = classifyCoverage(turn.range, materialSource.chunks);
  return {
    evidenceId,
    status: coverage.status,
    reason: coverage.reason,
    chunkIds: coverage.chunkIds,
  };
}

export function mapLocomoEvidenceToChunks({ samples, material }) {
  if (!Array.isArray(samples)) throw new Error("locomo_samples_must_be_array");
  assertObject(material, "chunk_material");
  const sourceBySample = new Map(material.sources.map((source) => [`${source.sampleId}\u0000${source.sessionId}`, source]));
  const results = [];
  for (const sample of samples) {
    const sampleId = requireString(sample.sample_id, "sample_id");
    const sources = [...sourceBySample.entries()]
      .filter(([key]) => key.startsWith(`${sampleId}\u0000`))
      .map(([, source]) => source);
    const turnSourceById = new Map();
    for (const source of sources) for (const turn of source.turnRanges) turnSourceById.set(turn.diaId, source);
    const questions = Array.isArray(sample.qa) ? sample.qa : [];
    for (const [qaIndex, qa] of questions.entries()) {
      const evidence = Array.isArray(qa?.evidence) ? qa.evidence : [];
      const evidenceResults = evidence.map((evidenceId) => {
        const source = turnSourceById.get(evidenceId);
        return source
          ? evidenceResult({ materialSource: source, evidenceId })
          : {
            evidenceId,
            status: "unknown",
            reason: typeof evidenceId === "string" && DIA_ID.test(evidenceId) ? "evidence_turn_not_found" : "evidence_id_invalid",
            chunkIds: [],
          };
      });
      const statuses = new Set(evidenceResults.map((entry) => entry.status));
      const caseStatus = statuses.has("unknown") || evidenceResults.length === 0
        ? "unknown"
        : statuses.has("partial")
          ? "partial"
          : "full";
      results.push({
        sampleId,
        qaIndex,
        category: qa?.category ?? null,
        evidence: evidenceResults,
        caseStatus,
      });
    }
  }
  return results;
}

export function summarizeLocomoChunkEvidence(evidenceCases) {
  const summary = {
    caseCount: Array.isArray(evidenceCases) ? evidenceCases.length : 0,
    caseFull: 0,
    casePartial: 0,
    caseUnknown: 0,
    evidenceFull: 0,
    evidencePartial: 0,
    evidenceUnknown: 0,
    unknownReasons: {},
  };
  for (const item of evidenceCases ?? []) {
    if (item.caseStatus === "full") summary.caseFull += 1;
    else if (item.caseStatus === "partial") summary.casePartial += 1;
    else summary.caseUnknown += 1;
    for (const evidence of item.evidence ?? []) {
      if (evidence.status === "full") summary.evidenceFull += 1;
      else if (evidence.status === "partial") summary.evidencePartial += 1;
      else {
        summary.evidenceUnknown += 1;
        summary.unknownReasons[evidence.reason] = (summary.unknownReasons[evidence.reason] ?? 0) + 1;
      }
    }
  }
  return summary;
}

export function flattenChunkMaterial(material) {
  return material.sources.flatMap((source) => source.chunks.map((chunk) => ({
    ...chunk,
    sourceTextSha256: source.sourceSha256,
    sourceType: source.sourceType,
  })));
}

export function flattenTurnMaterial(material) {
  return material.sources.flatMap((source) => source.turnRanges.map((turn) => ({
    sampleId: source.sampleId,
    sessionId: source.sessionId,
    logicalPath: source.logicalPath,
    sourceSha256: source.sourceSha256,
    ...turn,
  })));
}
