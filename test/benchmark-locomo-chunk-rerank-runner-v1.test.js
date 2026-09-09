import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  CHUNK_RERANK_MODEL,
  runLocomoChunkRerank,
} from "../bin/run-locomo-chunk-rerank-v1.mjs";

const INPUT_SOURCE = "/home/lionsol/.openclaw/workspace/q3-locomo-v1.2/runs/q3-locomo-chunk-fts-rerank-v1/input";

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-q3-chunk-rerank-runner-"));
  cpSync(INPUT_SOURCE, join(root, "input"), { recursive: true });
  return root;
}

function fakeTransport(calls) {
  return async ({ body }) => {
    calls.push(body);
    return {
      status: 200,
      headers: { "x-test": "zero-provider" },
      body: JSON.stringify({
        id: "fake-chunk-rerank-1",
        results: body.documents.map((_, index) => ({
          index,
          relevance_score: body.documents.length - index,
          document: null,
        })),
        usage: { input_tokens: body.documents.length, output_tokens: body.documents.length },
      }),
    };
  };
}

test("check-only validates the frozen chunk inputs without transport", async () => {
  const root = fixtureRoot();
  try {
    const result = await runLocomoChunkRerank({
      root,
      repositoryRoot: "/home/lionsol/.openclaw/workspace/plugins/memory-engine",
      checkOnly: true,
    });
    assert.equal(result.check_only, true);
    assert.equal(result.material_identity.case_count, 1970);
    assert.equal(result.material_identity.profile_id, "q3_locomo_chunk_fts_only_v1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("zero-provider persistence records scores, identity, usage, budget, and resumes", async () => {
  const root = fixtureRoot();
  const calls = [];
  try {
    const first = await runLocomoChunkRerank({
      root,
      repositoryRoot: "/home/lionsol/.openclaw/workspace/plugins/memory-engine",
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
    assert.equal(stateAfterFirst.budget.cumulative_consumed, 2524);
    assert.equal(stateAfterFirst.phases.main.results.length, 1);
    const evidencePath = stateAfterFirst.phases.main.results[0].evidence_path;
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    assert.equal(evidence.validation.ok, true);
    assert.equal(evidence.request_identity.params.model, CHUNK_RERANK_MODEL);
    assert.equal(Array.isArray(evidence.raw_scores_by_submitted_index), true);
    assert.equal(typeof evidence.raw_response_body, "string");
    assert.equal(evidence.usage.input_tokens > 0, true);
    assert.equal(evidence.request_serialization, "node_json_stringify_utf8_sha256_v1");

    const second = await runLocomoChunkRerank({
      root,
      repositoryRoot: "/home/lionsol/.openclaw/workspace/plugins/memory-engine",
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
    assert.equal(stateAfterSecond.phases.main.results.length, 2);
    assert.notEqual(stateAfterSecond.attempts[0].request_id, stateAfterSecond.attempts[1].request_id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unconfirmed inflight request becomes unknown and is never resent", async () => {
  const root = fixtureRoot();
  const calls = [];
  try {
    await runLocomoChunkRerank({
      root,
      repositoryRoot: "/home/lionsol/.openclaw/workspace/plugins/memory-engine",
      apiKey: "test-only",
      transport: fakeTransport(calls),
      sleep: async () => {},
      requestLimit: 1,
    });
    const statePath = join(root, "state", "runner-state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.status = "running";
    state.attempts.push({ attempt: 2, phase: "main", ordinal: 1, question_id: "unknown-case", outcome: "inflight" });
    state.inflight = { attempt: 2, phase: "main", ordinal: 1, question_id: "unknown-case", request_id: "unknown-request" };
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    await assert.rejects(
      () => runLocomoChunkRerank({
        root,
        repositoryRoot: "/home/lionsol/.openclaw/workspace/plugins/memory-engine",
        apiKey: "test-only",
        transport: fakeTransport(calls),
        sleep: async () => {},
      }),
      /prior_inflight_request_marked_unknown/,
    );
    const stopped = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.budget.unknown_requests, 1);
    assert.equal(calls.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
