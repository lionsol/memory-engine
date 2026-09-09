import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  buildLocomoChunkMaterial,
  flattenChunkMaterial,
  flattenTurnMaterial,
  mapLocomoEvidenceToChunks,
  renderLocomoSession,
  summarizeLocomoChunkEvidence,
} from "../lib/benchmark/locomo-chunk-material.js";

const OPENCLAW_CHUNKER = "/home/lionsol/.local/lib/node_modules/openclaw/dist/internal-ss-Qpla0.js";

async function loadRealChunker() {
  const module = await import(pathToFileURL(OPENCLAW_CHUNKER).href);
  return module.r;
}

function sampleWithoutGold() {
  return {
    sample_id: "conv-offline-test",
    conversation: {
      session_1: [
        { speaker: "Alice", dia_id: "D1:1", text: "你好😀 alpha beta" },
        { speaker: "Bob", dia_id: "D1:2", text: "the shared overlap turn" },
        { speaker: "Alice", dia_id: "D1:3", text: "a later turn crosses the chunk boundary" },
        { speaker: "Bob", dia_id: "D1:4", text: "the final turn" },
      ],
    },
  };
}

function modelIdentity() {
  return {
    value: "q3-test-experimental-id-v1",
    kind: "experimental_offline_id_only",
    source: "focused_test",
    productionEquivalent: false,
  };
}

test("renderer preserves non-ASCII turn text and exact source offsets", () => {
  const source = renderLocomoSession({
    sampleId: "conv-offline-test",
    sessionId: "session_1",
    turns: sampleWithoutGold().conversation.session_1,
  });
  for (const turn of source.turnRanges) {
    assert.equal(source.sourceText.slice(turn.startUtf16, turn.endUtf16), turn.text);
    assert.equal(source.sourceText.slice(turn.range.startUtf16, turn.range.endUtf16), turn.text);
    assert.equal(turn.range.endCodePoint - turn.range.startCodePoint, Array.from(turn.text).length);
    assert.equal(turn.range.endByte - turn.range.startByte, Buffer.byteLength(turn.text, "utf8"));
  }
});

test("material builder uses the injected real OpenClaw chunker, preserves turn identity, overlap, and multi-to-many links", async () => {
  const chunkMarkdown = await loadRealChunker();
  const sample = sampleWithoutGold();
  let goldAccessed = false;
  Object.defineProperty(sample, "qa", {
    get() {
      goldAccessed = true;
      throw new Error("material_builder_must_not_read_gold");
    },
  });
  const material = buildLocomoChunkMaterial({
    samples: [sample],
    chunkMarkdown,
    tokens: 10,
    overlap: 2,
    modelIdentity: modelIdentity(),
  });
  assert.equal(goldAccessed, false);
  const chunks = flattenChunkMaterial(material);
  const turns = flattenTurnMaterial(material);
  assert.ok(chunks.length >= 2);
  assert.ok(turns.some((turn) => turn.chunkCoverage.status === "full"));
  const turnAppearances = new Map();
  for (const chunk of chunks) {
    for (const turnId of chunk.turnIds) turnAppearances.set(turnId, (turnAppearances.get(turnId) ?? 0) + 1);
  }
  assert.ok([...turnAppearances.values()].some((count) => count >= 2));
  assert.ok(chunks.every((chunk) => chunk.position.status === "exact"));
  assert.ok(chunks.some((chunk) => chunk.position.syntheticNewlineCount > 0));
  assert.ok(chunks.some((chunk) => chunk.position.textMatchesSource === false));
  assert.ok(chunks.every((chunk) => chunk.source.recordId === chunk.memoryId));
  assert.ok(chunks.every((chunk) => chunk.source.text === chunk.text));
  assert.ok(chunks.every((chunk) => chunk.source.lineStart === chunk.startLine));
  assert.ok(chunks.some((chunk) => chunk.turnIds.length >= 2));
});

test("evidence mapping is a separate phase and keeps evidence turns uncollapsed", async () => {
  const material = buildLocomoChunkMaterial({
    samples: [sampleWithoutGold()],
    chunkMarkdown: await loadRealChunker(),
    tokens: 10,
    overlap: 2,
    modelIdentity: modelIdentity(),
  });
  const evidenceCases = mapLocomoEvidenceToChunks({
    samples: [{
      ...sampleWithoutGold(),
      qa: [{ evidence: ["D1:1", "D1:2"], category: 1 }],
    }],
    material,
  });
  assert.deepEqual(evidenceCases[0].evidence.map((entry) => entry.evidenceId), ["D1:1", "D1:2"]);
  assert.ok(evidenceCases[0].evidence.every((entry) => entry.status === "full" || entry.status === "partial"));
  assert.ok(evidenceCases[0].evidence.every((entry) => entry.chunkIds.length > 0));
  assert.deepEqual(summarizeLocomoChunkEvidence(evidenceCases), {
    caseCount: 1,
    caseFull: 1,
    casePartial: 0,
    caseUnknown: 0,
    evidenceFull: 2,
    evidencePartial: 0,
    evidenceUnknown: 0,
    unknownReasons: {},
  });
});

test("position validation refuses non-contiguous chunk text instead of guessing from line range", () => {
  const text = "Alice: exact";
  const fakeChunker = () => [{
    startLine: 1,
    endLine: 1,
    text: "not present",
    hash: createHash("sha256").update("not present").digest("hex"),
  }];
  const material = buildLocomoChunkMaterial({
    samples: [{
      sample_id: "conv-invalid-position",
      conversation: { session_1: [{ speaker: "Alice", dia_id: "D1:1", text: text.slice(7) }] },
    }],
    chunkMarkdown: fakeChunker,
    tokens: 10,
    overlap: 2,
    modelIdentity: modelIdentity(),
  });
  const chunk = flattenChunkMaterial(material)[0];
  assert.equal(chunk.position.status, "unknown");
  assert.equal(chunk.position.reason, "chunk_text_not_contiguous_in_source");
  assert.equal(flattenTurnMaterial(material)[0].chunkCoverage.status, "unknown");
});

test("explicit experimental model identity and chunking parameters are required", async () => {
  const chunkMarkdown = await loadRealChunker();
  assert.throws(
    () => buildLocomoChunkMaterial({
      samples: [sampleWithoutGold()],
      chunkMarkdown,
      tokens: 10,
      overlap: 2,
      modelIdentity: { value: "not-marked", kind: "test", source: "test", productionEquivalent: true },
    }),
    /production_equivalence/,
  );
  assert.throws(
    () => buildLocomoChunkMaterial({
      samples: [sampleWithoutGold()],
      chunkMarkdown,
      tokens: 10,
      overlap: 10,
      modelIdentity: modelIdentity(),
    }),
    /overlap_must_be_explicit/,
  );
});
