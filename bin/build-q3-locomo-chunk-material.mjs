#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildLocomoChunkMaterial,
  flattenChunkMaterial,
  flattenTurnMaterial,
  mapLocomoEvidenceToChunks,
  summarizeLocomoChunkEvidence,
} from "../lib/benchmark/locomo-chunk-material.js";
import { LOCOMO_DATASET_SHA256 } from "../lib/benchmark/locomo-v1.js";

const DEFAULT_DATASET = "/home/lionsol/.openclaw/workspace/q3-locomo-v1.2/material/locomo10.json";
const DEFAULT_OUTPUT = "/home/lionsol/.openclaw/workspace/q3-locomo-v1.2/material/canonical-chunk-v1";
const DEFAULT_CHUNKER = "/home/lionsol/.local/lib/node_modules/openclaw/dist/internal-ss-Qpla0.js";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(filePath) {
  return sha256(await readFile(filePath));
}

function parseOptions(argv) {
  const options = {
    dataset: DEFAULT_DATASET,
    output: DEFAULT_OUTPUT,
    chunker: DEFAULT_CHUNKER,
    sampleLimit: null,
    tokens: null,
    overlap: null,
    modelIdentity: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--dataset") options.dataset = next;
    else if (arg === "--output") options.output = next;
    else if (arg === "--chunker") options.chunker = next;
    else if (arg === "--sample-limit") options.sampleLimit = Number(next);
    else if (arg === "--chunk-tokens") options.tokens = Number(next);
    else if (arg === "--chunk-overlap") options.overlap = Number(next);
    else if (arg === "--model-identity") options.modelIdentity = next;
    else throw new Error(`unknown_argument:${arg}`);
    index += 1;
  }
  if (!Number.isSafeInteger(options.tokens) || !Number.isSafeInteger(options.overlap)) {
    throw new Error("chunk-tokens-and-overlap-must-be-explicit");
  }
  if (!options.modelIdentity) throw new Error("model-identity-must-be-explicit");
  if (options.sampleLimit !== null && (!Number.isSafeInteger(options.sampleLimit) || options.sampleLimit < 1)) {
    throw new Error("sample-limit-must-be-positive");
  }
  return options;
}

async function loadChunker(chunkerPath) {
  const module = await import(pathToFileURL(chunkerPath).href);
  if (typeof module.r !== "function") throw new Error("openclaw_chunkMarkdown_export_r_missing");
  return module.r;
}

async function loadOpenClawIdentity(chunkerPath) {
  const root = path.dirname(path.dirname(chunkerPath));
  const packagePath = path.join(root, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  return {
    package: packageJson.name,
    version: packageJson.version,
    packagePath,
    packageSha256: await sha256File(packagePath),
    chunkerPath,
    chunkerSha256: await sha256File(chunkerPath),
    function: "chunkMarkdown (bundled export r)",
    sourceVersion: `${packageJson.name}@${packageJson.version}`,
  };
}

function sourceFilePath(output, logicalPath) {
  return path.join(output, "sources", logicalPath);
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeJsonl(filePath, rows) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

async function listFiles(root) {
  const result = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const filePath = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(filePath);
      else result.push(filePath);
    }
  }
  await visit(root);
  return result.toSorted();
}

async function writeChecksums(output, exclude = new Set()) {
  const files = (await listFiles(output)).filter((filePath) => !exclude.has(filePath));
  const rows = [];
  for (const filePath of files) {
    rows.push(`${await sha256File(filePath)}  ${path.relative(output, filePath).replaceAll(path.sep, "/")}`);
  }
  await writeFile(path.join(output, "SHA256SUMS"), `${rows.join("\n")}\n`, "utf8");
  return rows.length;
}

function buildManifest({ options, openclaw, datasetSha256, material, evidenceCases, artifacts }) {
  const chunkRows = flattenChunkMaterial(material);
  const turnRows = flattenTurnMaterial(material);
  const positionCounts = { exact: 0, unknown: 0 };
  for (const chunk of chunkRows) positionCounts[chunk.position.status] = (positionCounts[chunk.position.status] ?? 0) + 1;
  const turnCoverage = { full: 0, partial: 0, unknown: 0 };
  for (const turn of turnRows) turnCoverage[turn.chunkCoverage.status] = (turnCoverage[turn.chunkCoverage.status] ?? 0) + 1;
  return {
    schema: material.schema,
    providerCalls: 0,
    retrievalRuns: 0,
    liveSourcesRead: false,
    dataset: {
      name: "LoCoMo",
      path: options.dataset,
      sha256: datasetSha256,
      expectedSha256: LOCOMO_DATASET_SHA256,
      hashVerified: datasetSha256 === LOCOMO_DATASET_SHA256,
      sourceCases: options.sampleLimit ?? "all",
    },
    openclaw,
    sourceRenderer: material.renderer,
    sourceIdentity: {
      sourceType: material.renderer.sourceType,
      coreSource: material.renderer.coreSource,
      logicalPathPrefix: material.renderer.pathPrefix,
      stable: true,
    },
    chunking: material.chunking,
    modelIdentity: material.modelIdentity,
    counts: {
      sampleCount: new Set(material.sources.map((source) => source.sampleId)).size,
      sessionCount: material.sources.length,
      turnCount: turnRows.length,
      chunkCount: chunkRows.length,
      chunkPositionCounts: positionCounts,
      turnCoverageCounts: turnCoverage,
      emptyChunksFiltered: material.emptyChunksFiltered,
    },
    evidenceMapping: {
      phase: "separate_after_materialization",
      usesOfficialEvidence: true,
      doesNotChangeGold: true,
      summary: summarizeLocomoChunkEvidence(evidenceCases),
      contract: {
        full: "evidence body interval is fully covered by the union of exact chunk source intervals",
        partial: "some evidence body interval is covered but a gap remains",
        unknown: "invalid/missing evidence or source position is not inferred",
        overlapDeduplication: "overlap does not duplicate coverage",
        chunkBudget: "chunk slots, not session slots",
      },
    },
    lmeAnswerLevelChunkGold: "unknown",
    artifacts,
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (!existsSync(options.dataset)) throw new Error(`dataset_not_found:${options.dataset}`);
  if (!existsSync(options.chunker)) throw new Error(`chunker_not_found:${options.chunker}`);
  const datasetText = await readFile(options.dataset, "utf8");
  const datasetSha256 = sha256(datasetText);
  if (datasetSha256 !== LOCOMO_DATASET_SHA256) {
    throw new Error(`dataset_sha256_mismatch:${datasetSha256}:${LOCOMO_DATASET_SHA256}`);
  }
  const allSamples = JSON.parse(datasetText);
  if (!Array.isArray(allSamples)) throw new Error("locomo_dataset_must_be_array");
  const samples = options.sampleLimit === null ? allSamples : allSamples.slice(0, options.sampleLimit);
  const chunkMarkdown = await loadChunker(options.chunker);
  const openclaw = await loadOpenClawIdentity(options.chunker);
  const material = buildLocomoChunkMaterial({
    samples: samples.map((sample) => ({ sample_id: sample.sample_id, conversation: sample.conversation })),
    chunkMarkdown,
    tokens: options.tokens,
    overlap: options.overlap,
    modelIdentity: {
      value: options.modelIdentity,
      kind: "experimental_offline_id_only",
      source: "explicit_builder_argument",
      productionEquivalent: false,
    },
  });
  const evidenceCases = mapLocomoEvidenceToChunks({ samples, material });

  await mkdir(options.output, { recursive: true });
  const sourceArtifactRows = [];
  for (const source of material.sources) {
    const filePath = sourceFilePath(options.output, source.logicalPath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, source.sourceText, "utf8");
    sourceArtifactRows.push(path.relative(options.output, filePath).replaceAll(path.sep, "/"));
  }
  const chunksPath = path.join(options.output, "chunks.jsonl");
  const turnsPath = path.join(options.output, "turn-chunk-map.jsonl");
  const evidencePath = path.join(options.output, "evidence-map.json");
  await writeJsonl(chunksPath, flattenChunkMaterial(material));
  await writeJsonl(turnsPath, flattenTurnMaterial(material));
  await writeJson(evidencePath, {
    schema: "q3_locomo_chunk_evidence_mapping_v1",
    datasetSha256,
    profile: "locomo_canonical_chunk_evidence_v1",
    cases: evidenceCases,
    summary: summarizeLocomoChunkEvidence(evidenceCases),
  });
  const manifestPath = path.join(options.output, "manifest.json");
  const manifest = buildManifest({
    options,
    openclaw,
    datasetSha256,
    material,
    evidenceCases,
    artifacts: {
      sourceFiles: sourceArtifactRows,
      chunks: "chunks.jsonl",
      turnChunkMap: "turn-chunk-map.jsonl",
      evidenceMap: "evidence-map.json",
      manifest: "manifest.json",
      checksums: "SHA256SUMS",
    },
  });
  await writeJson(manifestPath, manifest);
  await writeChecksums(options.output, new Set([path.join(options.output, "SHA256SUMS")]));
  process.stdout.write(`${JSON.stringify({
    output: options.output,
    datasetSha256,
    counts: manifest.counts,
    evidence: manifest.evidenceMapping.summary,
    providerCalls: 0,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
