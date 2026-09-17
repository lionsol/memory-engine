import test from "node:test";
import assert from "node:assert/strict";

import { buildQ4RecallHintC1FreshCorpusV1 } from "../lib/benchmark/q4-recall-hint-c1-corpus-v1.js";
import {
  Q4_RECALL_HINT_C1_FAMILIES,
  Q4_RECALL_HINT_C1_FROZEN_IDENTITY,
  assignQ4RecallHintC1SplitV1,
  assertQ4RecallHintC1FrozenIdentityV1,
  buildQ4RecallHintC1ManifestV1,
  buildQ4RecallHintC1ProducerInputV1,
  flattenQ4RecallHintC1MemoryRecordsV1,
  validateQ4RecallHintC1CorpusV1,
  validateQ4RecallHintC1ManifestV1,
} from "../lib/benchmark/q4-recall-hint-c1-manifest-v1.js";

function clone(value) {
  return structuredClone(value);
}

test("Q4-C1 fresh corpus freezes 48 cases, 72 memory records, and four equal families", () => {
  const corpus = buildQ4RecallHintC1FreshCorpusV1();
  const normalized = validateQ4RecallHintC1CorpusV1(corpus);
  assert.equal(normalized.cases.length, 48);
  assert.equal(flattenQ4RecallHintC1MemoryRecordsV1(corpus).length, 72);
  for (const family of Q4_RECALL_HINT_C1_FAMILIES) {
    assert.equal(normalized.cases.filter(row => row.family === family).length, 12, family);
  }
  assert.equal(new Set(normalized.cases.map(row => row.case_id)).size, 48);
  assert.equal(new Set(flattenQ4RecallHintC1MemoryRecordsV1(corpus).map(row => row.id)).size, 72);
});

test("Q4-C1 family-stratified salted split is deterministic at 16 development and 32 acceptance", () => {
  const corpus = buildQ4RecallHintC1FreshCorpusV1();
  const first = assignQ4RecallHintC1SplitV1(corpus);
  const second = assignQ4RecallHintC1SplitV1(corpus);
  assert.deepEqual(first, second);
  assert.equal(first.development.length, 16);
  assert.equal(first.acceptance.length, 32);
  assert.equal(new Set([...first.development, ...first.acceptance]).size, 48);
  for (const family of Q4_RECALL_HINT_C1_FAMILIES) {
    const prefix = family === "entity_reference"
      ? "q4c1-entity-"
      : family === "temporal_relation"
        ? "q4c1-temporal-"
        : family === "multi_facet"
          ? "q4c1-multi-"
          : "q4c1-protection-";
    assert.equal(first.development.filter(id => id.startsWith(prefix)).length, 4, family);
    assert.equal(first.acceptance.filter(id => id.startsWith(prefix)).length, 8, family);
  }
});

test("Q4-C1 manifest identity is frozen and reproducible", () => {
  const corpus = buildQ4RecallHintC1FreshCorpusV1();
  const manifest = assertQ4RecallHintC1FrozenIdentityV1(corpus);
  assert.deepEqual({
    corpus_sha256: manifest.corpus_identity.corpus_sha256,
    development_sha256: manifest.development_sha256,
    acceptance_sha256: manifest.acceptance_sha256,
    manifest_sha256: manifest.manifest_sha256,
  }, Q4_RECALL_HINT_C1_FROZEN_IDENTITY);
  assert.equal(manifest.population.case_count, 48);
  assert.equal(manifest.population.memory_record_count, 72);
  assert.equal(manifest.population.development_count, 16);
  assert.equal(manifest.population.acceptance_count, 32);
  assert.deepEqual(buildQ4RecallHintC1ManifestV1(corpus), manifest);
  assert.deepEqual(validateQ4RecallHintC1ManifestV1(manifest, corpus), manifest);
});

test("Q4-C1 producer input exposes only query and bounded caller context", () => {
  const corpus = buildQ4RecallHintC1FreshCorpusV1();
  for (const row of corpus.cases) {
    const packet = buildQ4RecallHintC1ProducerInputV1(row);
    assert.deepEqual(Object.keys(packet).sort(), ["bounded_context", "case_id", "query", "schema"]);
    assert.equal(Object.hasOwn(packet, "gold_evidence_ids"), false);
    assert.equal(Object.hasOwn(packet, "memory_records"), false);
    assert.equal(JSON.stringify(packet).includes("gold_evidence_ids"), false);
    assert.equal(JSON.stringify(packet).includes("memory_records"), false);
  }
});

test("Q4-C1 target families carry only bounded anchors and protection queries need no hidden context", () => {
  const corpus = validateQ4RecallHintC1CorpusV1(buildQ4RecallHintC1FreshCorpusV1());
  for (const row of corpus.cases) {
    if (row.family === "protection") {
      assert.deepEqual(row.bounded_context, {});
      continue;
    }
    assert.equal(typeof row.bounded_context.active_project, "string");
    assert.equal(row.bounded_context.recent_entities.length, 1);
    if (row.family === "temporal_relation") {
      assert.equal(typeof row.bounded_context.temporal_anchor, "string");
    } else {
      assert.equal(Object.hasOwn(row.bounded_context, "temporal_anchor"), false);
    }
  }
});

test("Q4-C1 validation fails closed on corpus, context, gold, and identity drift", () => {
  const source = buildQ4RecallHintC1FreshCorpusV1();

  const unknownContext = clone(source);
  unknownContext.cases[0].bounded_context.hidden_session = "forbidden";
  assert.throws(
    () => validateQ4RecallHintC1CorpusV1(unknownContext),
    /q4_c1_bounded_context_unknown_field/,
  );

  const invalidGold = clone(source);
  invalidGold.cases[0].gold_evidence_ids = ["missing-evidence"];
  assert.throws(
    () => validateQ4RecallHintC1CorpusV1(invalidGold),
    /q4_c1_gold_not_in_case_memory/,
  );

  const duplicateMemory = clone(source);
  duplicateMemory.cases[1].memory_records[0].id = duplicateMemory.cases[0].memory_records[0].id;
  duplicateMemory.cases[1].gold_evidence_ids = [duplicateMemory.cases[1].memory_records[0].id];
  assert.throws(
    () => validateQ4RecallHintC1CorpusV1(duplicateMemory),
    /q4_c1_global_memory_id_duplicate/,
  );

  const drifted = clone(source);
  drifted.cases[0].query += " changed";
  assert.throws(
    () => assertQ4RecallHintC1FrozenIdentityV1(drifted),
    /q4_c1_frozen_identity_mismatch/,
  );
});

test("Q4-C1 manifest validator rejects any mutated manifest", () => {
  const corpus = buildQ4RecallHintC1FreshCorpusV1();
  const manifest = buildQ4RecallHintC1ManifestV1(corpus);
  const mutated = clone(manifest);
  mutated.acceptance[0].gold_evidence_count += 1;
  assert.throws(
    () => validateQ4RecallHintC1ManifestV1(mutated, corpus),
    /q4_c1_manifest_mismatch/,
  );
});
