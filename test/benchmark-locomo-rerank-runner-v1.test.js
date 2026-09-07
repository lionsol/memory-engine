import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  LOCOMO_RERANK_MODEL,
  loadLocomoMaterial,
  runLocomoRerank,
} from "../bin/run-locomo-rerank-v1.mjs";

function materialRoot() {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-q3-locomo-runner-"));
  cpSync("/tmp/q3-locomo-v1.2/material", join(root, "material"), { recursive: true });
  cpSync("/tmp/q3-locomo-v1.2/material.sha256.before-run", join(root, "material.sha256.before-run"));
  return root;
}

function fakeTransport(calls) {
  return async ({ body }) => {
    calls.push(body);
    const results = body.documents.map((_, index) => ({
      index,
      relevance_score: body.documents.length - index,
      document: null,
    }));
    return {
      status: 200,
      headers: { "x-test": "zero-provider" },
      body: JSON.stringify({ id: "fake-rerank-1", results, usage: { input_tokens: body.documents.length } }),
    };
  };
}

test("LoCoMo material identity and mapping are frozen before provider use", () => {
  const root = materialRoot();
  const material = loadLocomoMaterial(root);
  assert.equal(material.material_identity.candidate_count, 1972);
  assert.equal(material.material_identity.candidate_pairs, 44564);
  assert.equal(material.material_identity.empty_document_count, 0);
  assert.equal(material.cases[0].documents.length, 17);
  assert.equal(material.cases[0].query.length > 0, true);
});

test("zero-provider persistence saves raw scores, identity, budget, and resumes without duplicate", async () => {
  const root = materialRoot();
  const calls = [];
  const first = await runLocomoRerank({
    root,
    apiKey: "test-only",
    transport: fakeTransport(calls),
    sleep: async () => {},
    now: (() => { let value = 1_000_000; return () => value += 10; })(),
    requestLimit: 1,
  });
  assert.equal(first.status, "paused");
  assert.equal(calls.length, 1);

  const statePath = join(root, "state", "runner-state.json");
  const stateAfterFirst = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(stateAfterFirst.budget.attempts, 1);
  assert.equal(stateAfterFirst.budget.valid_responses, 1);
  assert.equal(stateAfterFirst.budget.cumulative_consumed, 520);
  assert.equal(stateAfterFirst.phases.pre_sentinel.results.length, 1);
  const evidencePath = stateAfterFirst.phases.pre_sentinel.results[0].evidence_path;
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  assert.equal(evidence.validation.ok, true);
  assert.equal(evidence.request_identity.params.model, LOCOMO_RERANK_MODEL);
  assert.equal(Array.isArray(evidence.raw_scores_by_original_index), true);
  assert.equal(typeof evidence.raw_response_body, "string");
  assert.equal(evidence.request_serialization, "node_json_stringify_utf8_sha256_v1");

  const second = await runLocomoRerank({
    root,
    apiKey: "test-only",
    transport: fakeTransport(calls),
    sleep: async () => {},
    now: (() => { let value = 2_000_000; return () => value += 10; })(),
    requestLimit: 2,
  });
  assert.equal(second.status, "paused");
  assert.equal(calls.length, 2);
  const stateAfterSecond = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(stateAfterSecond.budget.attempts, 2);
  assert.equal(stateAfterSecond.phases.pre_sentinel.results.length, 2);
  assert.notEqual(stateAfterSecond.attempts[0].request_id, stateAfterSecond.attempts[1].request_id);
});

test("unconfirmed inflight request is marked unknown and never resent", async () => {
  const root = materialRoot();
  const calls = [];
  await runLocomoRerank({
    root,
    apiKey: "test-only",
    transport: fakeTransport(calls),
    sleep: async () => {},
    requestLimit: 1,
  });
  const statePath = join(root, "state", "runner-state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  state.status = "running";
  state.attempts.push({ attempt: 2, phase: "pre_sentinel", key: "unknown-case", outcome: "inflight" });
  state.inflight = { attempt: 2, phase: "pre_sentinel", key: "unknown-case", request_id: "unknown-request" };
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  await assert.rejects(
    () => runLocomoRerank({ root, apiKey: "test-only", transport: fakeTransport(calls), sleep: async () => {} }),
    /prior_inflight_request_marked_unknown/,
  );
  const stopped = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.budget.unknown_requests, 1);
  assert.equal(calls.length, 1);
});
