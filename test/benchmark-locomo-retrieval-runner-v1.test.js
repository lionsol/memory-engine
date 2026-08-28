import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import {
  LOCOMO_BLIP_CAPTION_PROJECTION,
  LOCOMO_DIALOG_TEXT_PROJECTION,
  LOCOMO_EVIDENCE_CANONICALIZED_V1,
  LOCOMO_EVIDENCE_STRICT_V1,
  buildLocomoConversationDialogDocuments,
  buildLocomoDialogText,
  normalizeLocomoCase,
  projectLocomoDialogToSessions,
  validateLocomoDataset,
} from "../lib/benchmark/locomo-v1.js";
import {
  LOCOMO_HOST_MANAGER_MODE,
  LOCOMO_LEXICAL_RETRIEVAL_PROFILE,
  LOCOMO_RETRIEVAL_RUNNER_SCHEMA,
  LOCOMO_VECTOR_MODE,
  createLocomoProductionHybridRuntime,
  mapLocomoSearchResultsToDialogs,
  materializeLocomoConversationDataPlane,
  resolveLocomoRepositoryProvenance,
  runLocomoLexicalRetrievalDataset,
} from "../lib/benchmark/locomo-retrieval-runner-v1.js";

const TEST_REPOSITORY_PROVENANCE = {
  repository_commit: "0".repeat(40),
  repository_worktree_clean: true,
  repository_provenance_source: "git",
};

function rawCase({
  sampleId = "conv-test",
  questions = null,
  includeCaption = false,
} = {}) {
  const firstTurn = {
    speaker: "Alice",
    dia_id: "D1:1",
    text: "Alice visited Kyoto.",
  };
  if (includeCaption) {
    firstTurn.img_file = "image.png";
    firstTurn.blip_caption = "a Kyoto street at dusk";
  }
  return {
    sample_id: sampleId,
    conversation: {
      speaker_a: "Alice",
      speaker_b: "Bob",
      session_1_date_time: "1:00 pm on 1 May, 2023",
      session_1: [
        firstTurn,
        { speaker: "Bob", dia_id: "D1:2", text: "They discussed Osaka." },
      ],
      session_2_date_time: "2:00 pm on 2 May, 2023",
      session_2: [
        { speaker: "Alice", dia_id: "D2:1", text: "Alice returned later." },
      ],
    },
    qa: questions || [
      { question: "Where did Alice visit?", answer: "SECRET GOLD ANSWER", evidence: ["D1:1"], category: 4 },
      { question: "What did they discuss?", answer: "SECRET SECOND ANSWER", evidence: ["D1:2"], category: 4 },
    ],
  };
}

function importCli() {
  return import("../bin/run-locomo-retrieval-v1.js").then(module => (
    module.runLocomoRetrievalCli || module.default.runLocomoRetrievalCli
  ));
}

test("B5-I2 profile is independent and preserves the raw dialog/caption contracts", () => {
  assert.equal(LOCOMO_LEXICAL_RETRIEVAL_PROFILE, "production_hybrid_lexical_locomo_dialog_v1");
  const item = normalizeLocomoCase(rawCase({ includeCaption: true }));
  const turn = item.sessions[0].turns[0];
  assert.equal(LOCOMO_DIALOG_TEXT_PROJECTION, "speaker_colon_raw_text_v1");
  assert.equal(LOCOMO_BLIP_CAPTION_PROJECTION, "shares_caption_suffix_v1");
  assert.equal(buildLocomoDialogText(turn), "Alice: Alice visited Kyoto.");
  assert.equal(
    buildLocomoDialogText(turn, { includeBlipCaption: true }),
    "Alice: Alice visited Kyoto.\n[shares a Kyoto street at dusk]",
  );
  const docs = buildLocomoConversationDialogDocuments(item);
  assert.equal(docs[0].content, "Alice: Alice visited Kyoto.");
  assert.equal(docs[0].memory_id.length, 64);
  assert.equal("answer" in docs[0], false);
  assert.equal("evidence" in docs[0], false);
});

test("conversation materializer owns one isolated corpus and maps memory ids round-trip", () => {
  const plane = materializeLocomoConversationDataPlane(rawCase({
    sampleId: "conv-owned",
    questions: [{ question: "Where?", answer: "PRIVATE GOLD", evidence: ["D1:1"], category: 4 }],
  }), { benchmarkNowSec: 1_800_000_000 });
  try {
    assert.equal(plane.owner, "runner");
    assert.equal(plane.session_count, 2);
    assert.equal(plane.document_count, 3);
    assert.equal(plane.memoryToDialog.size, 3);
    assert.equal(existsSync(plane.root), true);
    const core = new Database(plane.corePath, { readonly: true });
    const engine = new Database(plane.enginePath, { readonly: true });
    try {
      const coreRows = core.prepare("SELECT id, text, path FROM chunks ORDER BY id").all();
      const ftsRows = core.prepare("SELECT text, id FROM chunks_fts ORDER BY id").all();
      const engineRows = engine.prepare("SELECT chunk_id, category, kg_data FROM memory_confidence").all();
      const serialized = JSON.stringify({ coreRows, ftsRows, engineRows });
      assert.equal(serialized.includes("PRIVATE GOLD"), false);
      assert.equal(serialized.includes("answer"), false);
      assert.equal(coreRows.length, 3);
      assert.equal(ftsRows.length, 3);
      assert.equal(engineRows.length, 3);
      for (const row of coreRows) {
        const identity = plane.memoryToDialog.get(row.id);
        assert.equal(identity.sample_id, "conv-owned");
        assert.equal(["D1:1", "D1:2", "D2:1"].includes(identity.dia_id), true);
        assert.equal(["session_1", "session_2"].includes(identity.session_id), true);
        assert.equal(identity.sample_id, "conv-owned");
      }
    } finally {
      core.close();
      engine.close();
    }
  } finally {
    plane.close();
    plane.close();
  }
  assert.equal(existsSync(plane.root), false);
  assert.equal(plane.closed, true);
});

test("materializer rejects live memory roots without touching them", () => {
  assert.throws(
    () => materializeLocomoConversationDataPlane(rawCase(), {
      temporaryParent: join(homedir(), ".openclaw", "memory"),
    }),
    /locomo_live_memory_path_rejected/,
  );
});

test("runner builds one corpus per conversation and reuses it for every question", async () => {
  const records = Array.from({ length: 10 }, (_, index) => rawCase({
    sampleId: `conv-${index + 1}`,
    questions: [
      { question: `question ${index + 1} first`, answer: "GOLD", evidence: ["D1:1"], category: 4 },
      { question: `question ${index + 1} second`, answer: "GOLD", evidence: ["D1:2"], category: 4 },
    ],
  }));
  const planes = [];
  const runtimes = [];
  const searches = [];
  const output = await runLocomoLexicalRetrievalDataset(records, {
    topK: 2,
    repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
    materialize(record, options) {
      const plane = materializeLocomoConversationDataPlane(record, options);
      planes.push(plane);
      return plane;
    },
    createRuntime(plane) {
      const runtime = { plane };
      runtimes.push(runtime);
      return { runtime, close() {} };
    },
    async search(query, options, runtime) {
      searches.push({ query, options, runtime });
      const memoryId = [...runtime.plane.memoryToDialog.keys()][0];
      return { results: [{ memory_id: memoryId }], debug: {}, channels: ["fts"], channel_sizes: { fts: 1 } };
    },
  });
  try {
    assert.equal(output.schema, LOCOMO_RETRIEVAL_RUNNER_SCHEMA);
    assert.equal(output.summary.conversations, 10);
    assert.equal(output.summary.corpora_built, 10);
    assert.equal(output.summary.corpus_reuse_searches, 20);
    assert.equal(output.summary.retrieval_cases, 20);
    assert.equal(new Set(planes.map(plane => plane.sample_id)).size, 10);
    assert.equal(runtimes.length, 10);
    assert.equal(searches.length, 20);
    assert.equal(searches.every(entry => !entry.query.includes("GOLD")), true);
    for (let index = 0; index < 10; index += 1) {
      assert.equal(searches[index * 2].runtime, searches[index * 2 + 1].runtime);
      assert.equal(searches[index * 2].runtime.plane.sample_id, `conv-${index + 1}`);
    }
    assert.equal(output.summary.strict.scored_cases, 20);
    assert.equal(output.summary.sensitivity.scored_cases, 20);
    assert.equal(output.provenance.vector_mode, LOCOMO_VECTOR_MODE);
    assert.equal(output.provenance.host_manager_mode, LOCOMO_HOST_MANAGER_MODE);
  } finally {
    for (const plane of planes) plane.close();
  }
  assert.equal(planes.every(plane => plane.closed && !existsSync(plane.root)), true);
});

test("runner performs both evidence aggregates without retrieving skipped sensitivity cases", async () => {
  const record = rawCase({
    questions: [
      { question: "strict", answer: "GOLD", evidence: ["D1:1"], category: 4 },
      { question: "composite", answer: "GOLD", evidence: ["D1:1; D1:2"], category: 1 },
      { question: "empty", answer: "GOLD", evidence: [], category: 3 },
    ],
  });
  let searchCount = 0;
  const output = await runLocomoLexicalRetrievalDataset([record], {
    topK: 3,
    repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
    async search() {
      searchCount += 1;
      return { results: [], debug: {}, channels: [], channel_sizes: {} };
    },
  });
  assert.equal(output.summary.strict.scored_cases, 1);
  assert.equal(output.summary.strict.skipped_cases, 2);
  assert.equal(output.summary.sensitivity.scored_cases, 2);
  assert.equal(output.summary.sensitivity.skipped_cases, 1);
  assert.equal(output.summary.sensitivity.skipped_by_reason.empty_evidence, 1);
  assert.equal(searchCount, 2);
});

test("production hybridSearch adapter stays isolated and does not invoke a live host manager", async () => {
  const plane = materializeLocomoConversationDataPlane(rawCase({
    questions: [{ question: "Where did Alice visit?", answer: "GOLD", evidence: ["D1:1"], category: 4 }],
  }));
  const adapter = createLocomoProductionHybridRuntime(plane, { topK: 3 });
  try {
    assert.equal(adapter.vector_mode, LOCOMO_VECTOR_MODE);
    assert.equal(adapter.host_manager_mode, LOCOMO_HOST_MANAGER_MODE);
    const manager = await adapter.runtime.getMemorySearchManager({ cfg: {} });
    assert.equal(manager.manager, null);
    assert.equal(manager.error, "locomo_host_memory_manager_disabled");
    const search = await (await import("../lib/recall/hybrid-search.js")).hybridSearch(
      "Where did Alice visit?",
      { topK: 3 },
      adapter.runtime,
    );
    assert.equal(Array.isArray(search.results), true);
    assert.equal(search.debug.vector_skipped, true);
    assert.equal(search.debug.vector_skip_reason, "lexical_confidence_threshold_met");
    const mapped = mapLocomoSearchResultsToDialogs(search.results, plane.memoryToDialog);
    assert.equal(mapped[0].sample_id, "conv-test");
    assert.equal(mapped[0].dia_id, "D1:1");
  } finally {
    adapter.close();
    plane.close();
  }
});

test("unknown memory ids cannot cross a conversation boundary", () => {
  const plane = materializeLocomoConversationDataPlane(rawCase());
  try {
    assert.throws(
      () => mapLocomoSearchResultsToDialogs([{ memory_id: "not-this-corpus" }], plane.memoryToDialog),
      /locomo_cross_conversation_memory_id/,
    );
  } finally {
    plane.close();
  }
});

test("session projection preserves first occurrence while runner keeps dialog ranks", () => {
  const item = normalizeLocomoCase(rawCase({
    questions: [{ question: "multi", answer: "GOLD", evidence: ["D1:1", "D2:1"], category: 1 }],
  }));
  assert.deepEqual(projectLocomoDialogToSessions(item, ["D1:2", "D1:1", "D2:1", "D2:1"]), [
    "session_1",
    "session_2",
  ]);
});

test("official contract keeps the 1978 sensitivity retrieval denominator", { skip: !existsSync(process.env.LOCOMO_DATASET_PATH || "") }, () => {
  const bytes = readFileSync(process.env.LOCOMO_DATASET_PATH);
  const validation = validateLocomoDataset(JSON.parse(bytes));
  assert.equal(validation.policies[LOCOMO_EVIDENCE_STRICT_V1].scored_cases, 1972);
  assert.equal(validation.policies[LOCOMO_EVIDENCE_CANONICALIZED_V1].scored_cases, 1978);
});

test("repository provenance resolver is injectable and validates exact git shape", () => {
  const calls = [];
  const provenance = resolveLocomoRepositoryProvenance({
    repositoryRoot: "/deterministic/repo",
    execFileSync(command, args, options) {
      calls.push({ command, args, options });
      return args[0] === "rev-parse" ? `${"a".repeat(40)}\n` : "";
    },
  });
  assert.deepEqual(provenance, {
    repository_commit: "a".repeat(40),
    repository_worktree_clean: true,
    repository_provenance_source: "git",
  });
  assert.equal(calls.length, 2);
  assert.throws(
    () => resolveLocomoRepositoryProvenance({
      execFileSync: () => "not-a-commit\n",
    }),
    /locomo_repository_provenance_invalid_commit/,
  );
});

test("CLI smoke uses deterministic provenance and passes authoritative runner options", async () => {
  const runCli = await importCli();
  const root = mkdtempSync(join(tmpdir(), "memory-engine-locomo-retrieval-cli-"));
  const input = join(root, "fixture.json");
  const outputPath = join(root, "output.json");
  writeFileSync(input, JSON.stringify([rawCase({
    questions: [{ question: "Where?", answer: "GOLD", evidence: ["D1:1"], category: 4 }],
  })]));
  let runnerOptions;
  try {
    const result = await runCli(["--input", input, "--output", outputPath, "--limit", "1", "--top-k", "7"], {
      repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
      runDataset: async (_records, options) => {
        runnerOptions = options;
        return {
          provenance: { ...options.repositoryProvenance },
          run: { profile: LOCOMO_LEXICAL_RETRIEVAL_PROFILE },
          summary: { cases: 1 },
          results: [],
        };
      },
    });
    assert.equal(result.output.provenance.repository_commit, TEST_REPOSITORY_PROVENANCE.repository_commit);
    assert.equal(result.output.provenance.repository_worktree_clean, true);
    assert.equal(result.output.provenance.repository_provenance_source, "git");
    assert.equal(runnerOptions.topK, 7);
    assert.equal(runnerOptions.limit, 1);
    assert.equal(runnerOptions.datasetSha256.length, 64);
    assert.equal(runnerOptions.repositoryProvenance.repository_commit, TEST_REPOSITORY_PROVENANCE.repository_commit);
    assert.equal(existsSync(outputPath), true);
    assert.equal(JSON.parse(readFileSync(outputPath)).provenance.input_file, "fixture.json");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI rejects dirty repository provenance before running the dataset", async () => {
  const runCli = await importCli();
  const root = mkdtempSync(join(tmpdir(), "memory-engine-locomo-retrieval-dirty-"));
  const input = join(root, "fixture.json");
  writeFileSync(input, JSON.stringify([rawCase()]));
  try {
    await assert.rejects(
      () => runCli(["--input", input], {
        repositoryProvenance: { ...TEST_REPOSITORY_PROVENANCE, repository_worktree_clean: false },
        runDataset: async () => { throw new Error("runner_must_not_run"); },
      }),
      /locomo_repository_provenance_dirty_worktree/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
