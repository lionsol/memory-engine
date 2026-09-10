import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  CHUNK_RERANK_MODEL,
  prepareLocomoChunkRerankRecovery,
  providerUsage,
  requestWithDeadline,
  runLocomoChunkRerank,
  runLocomoChunkRerankCli,
} from "../bin/run-locomo-chunk-rerank-v1.mjs";

const INPUT_SOURCE = "/home/lionsol/.openclaw/workspace/q3-locomo-v1.2/runs/q3-locomo-chunk-fts-rerank-v1/input";
const HISTORICAL_RUN_COMMIT = "287bfafcab98b1655d551a41d2d304a15948247d";

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

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
        meta: {
          tokens: body.documents.length,
          billed_units: body.documents.length + 1,
        },
      }),
    };
  };
}

async function seedHistoricalStoppedFixture(root, calls) {
  await runLocomoChunkRerank({
    root,
    repositoryRoot: "/home/lionsol/.openclaw/workspace/plugins/memory-engine",
    apiKey: "test-only",
    transport: fakeTransport(calls),
    sleep: async () => {},
    now: (() => { let value = 1_000_000; return () => value += 10; })(),
    requestLimit: 20,
  });
  const statePath = join(root, "state", "runner-state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const candidateManifest = JSON.parse(readFileSync(join(root, "input/candidate-generation/candidate-manifest.json"), "utf8"));
  for (const result of state.phases.main.results) {
    const evidence = JSON.parse(readFileSync(result.evidence_path, "utf8"));
    evidence.request_identity.params.deadline_ms = 2_000;
    evidence.request_identity_sha256 = sha256Json(evidence.request_identity);
    writeFileSync(result.evidence_path, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  const unknownCase = candidateManifest.cases[20];
  const unknownEvidencePath = join(root, "evidence", "main", "0021-conv-26:qa:20.json");
  const unknownRequestIdentity = {
    request_id: "q3-locomo-chunk-rerank-v1:main:20:conv-26:qa:20",
    phase: "main",
    ordinal: 20,
    question_id: unknownCase.question_id,
    candidate_ids: unknownCase.candidate_ids,
    params: {
      endpoint: "https://api.siliconflow.cn/v1/rerank",
      model: CHUNK_RERANK_MODEL,
      top_n: unknownCase.candidate_ids.length,
      deadline_ms: 2_000,
      return_documents: false,
      max_chunks_per_doc: 1,
      overlap_tokens: 0,
    },
  };
  writeFileSync(unknownEvidencePath, `${JSON.stringify({
    schema: "q3_locomo_chunk_rerank_request_evidence_v1",
    attempt: 21,
    phase: "main",
    ordinal: 20,
    question_id: unknownCase.question_id,
    candidate_ids: unknownCase.candidate_ids,
    control_ordered_ids: unknownCase.candidate_ids,
    fallback_ordered_ids: unknownCase.candidate_ids,
    status: "fallback",
    request_identity: unknownRequestIdentity,
    request_identity_sha256: sha256Json(unknownRequestIdentity),
    validation: { ok: false, reason: "transport_error_unconfirmed" },
    raw_response_body: null,
  }, null, 2)}\n`);
  state.execution_source = {
    repository_commit: HISTORICAL_RUN_COMMIT,
    repository_worktree_clean: true,
    repository_provenance_source: "git",
  };
  state.execution_config = {
    ...state.execution_config,
    deadline_ms: 2_000,
    new_request_cap: 1_970,
    cumulative_cap: 4_493,
  };
  state.execution_config_sha256 = sha256Json(state.execution_config);
  state.budget = {
    ...state.budget,
    new_request_cap: 1_970,
    cumulative_cap: 4_493,
    attempts: 21,
    valid_responses: 20,
    failed_responses: 0,
    unknown_requests: 1,
    cumulative_consumed: 2_544,
  };
  state.attempts.push({
    attempt: 21,
    phase: "main",
    ordinal: 20,
    question_id: unknownCase.question_id,
    request_id: unknownRequestIdentity.request_id,
    budget_before: 2_543,
    budget_after: 2_544,
    throttle_wait_ms: 60_000,
    started_at_ms: 1_000_210,
    outcome: "unknown",
    evidence_path: unknownEvidencePath,
    error: "deadline_exceeded",
  });
  state.status = "stopped";
  state.inflight = null;
  state.stop = {
    reason: "transport_error_unconfirmed",
    question_id: unknownCase.question_id,
    attempt: 21,
    evidence_path: unknownEvidencePath,
  };
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  return { statePath, unknownCase };
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

test("CLI reads credentials for ordinary execution but not check-only", async () => {
  const root = fixtureRoot();
  const checkRoot = fixtureRoot();
  const calls = [];
  let credentialReads = 0;
  const readProviderKeyImpl = () => {
    credentialReads += 1;
    return "fake-cli-key";
  };
  try {
    const ordinary = await runLocomoChunkRerankCli([
      "--root", root,
      "--request-limit", "1",
    ], {
      readProviderKeyImpl,
      transport: fakeTransport(calls),
    });
    assert.equal(ordinary.status, "paused");
    assert.equal(credentialReads, 1);
    assert.equal(calls.length, 1);

    const checkOnly = await runLocomoChunkRerankCli([
      "--root", checkRoot,
      "--check-only",
    ], {
      readProviderKeyImpl,
      transport: fakeTransport(calls),
    });
    assert.equal(checkOnly.check_only, true);
    assert.equal(credentialReads, 1);
    assert.equal(calls.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(checkRoot, { recursive: true, force: true });
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
    assert.equal(evidence.usage.source, "response.meta");
    assert.equal(evidence.usage.response_meta.tokens > 0, true);
    assert.equal(evidence.usage.meta_billed_units > 0, true);
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

test("deadline aborts the transport signal and isolates late success or failure", async () => {
  let signalSeen;
  await assert.rejects(
    () => requestWithDeadline(
      ({ signal }) => {
        signalSeen = signal;
        return new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error("late_transport_failure")), 40);
        });
      },
      { body: { query: "q", documents: ["d"] } },
      "test-only",
      10,
    ),
    /deadline_exceeded/,
  );
  assert.equal(signalSeen.aborted, true);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.deepEqual(providerUsage({ meta: { tokens: 12, billed_units: 3 } }), {
    source: "response.meta",
    response_usage: null,
    response_meta: { tokens: 12, billed_units: 3 },
    meta_tokens: 12,
    meta_billed_units: 3,
  });
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

test("recovery plan validates the historical stopped state without mutating it", async () => {
  const root = fixtureRoot();
  const calls = [];
  try {
    const { statePath } = await seedHistoricalStoppedFixture(root, calls);
    const before = readFileSync(statePath, "utf8");
    const plan = prepareLocomoChunkRerankRecovery({
      root,
      repositoryRoot: "/home/lionsol/.openclaw/workspace/plugins/memory-engine",
    });
    assert.equal(plan.status, "prepared");
    assert.equal(plan.historical_execution_config.deadline_ms, 2_000);
    assert.equal(plan.recovery_execution_config.deadline_ms, 10_000);
    assert.equal(plan.completed_case_count, 20);
    assert.equal(plan.pending_case_count, 1_950);
    assert.equal(plan.unsent_case_count, 1_949);
    assert.equal(plan.explicit_unknown_retry.previous_attempt, 21);
    assert.equal(plan.explicit_unknown_retry.next_attempt, 22);
    assert.equal(plan.budget.projected_attempts, 1_971);
    assert.equal(plan.budget.projected_cumulative_consumed, 4_494);
    assert.equal(plan.budget.proposed_new_request_cap, 1_971);
    assert.equal(plan.budget.proposed_cumulative_cap, 4_494);
    assert.equal(readFileSync(statePath, "utf8"), before);
    assert.equal(calls.length, 20);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("confirmed recovery does not resend completed cases and creates a new unknown retry attempt", async () => {
  const root = fixtureRoot();
  const calls = [];
  try {
    const { statePath, unknownCase } = await seedHistoricalStoppedFixture(root, calls);
    await runLocomoChunkRerank({
      root,
      repositoryRoot: "/home/lionsol/.openclaw/workspace/plugins/memory-engine",
      apiKey: "test-only",
      transport: fakeTransport(calls),
      sleep: async () => {},
      now: (() => { let value = 2_000_000; return () => value += 10; })(),
      recovery: true,
      confirmRecovery: true,
      requestLimit: 1,
    });
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(calls.length, 21);
    assert.equal(state.status, "paused");
    assert.equal(state.budget.attempts, 22);
    assert.equal(state.budget.cumulative_consumed, 2_545);
    assert.equal(state.budget.cumulative_cap, 4_494);
    assert.equal(state.attempts[20].outcome, "unknown");
    assert.equal(state.attempts[21].attempt, 22);
    assert.equal(state.attempts[21].outcome, "confirmed_valid");
    assert.match(state.attempts[21].request_id, /:recovery:22:20:/);
    assert.equal(state.phases.main.results.length, 21);
    assert.equal(state.phases.main.results.at(-1).question_id, unknownCase.question_id);
    assert.equal(state.phases.main.results.at(-1).attempt, 22);
    assert.equal(state.recovery.historical_stop.attempt, 21);
    const retryEvidence = JSON.parse(readFileSync(state.phases.main.results.at(-1).evidence_path, "utf8"));
    assert.equal(retryEvidence.request_identity.params.deadline_ms, 10_000);
    assert.equal(retryEvidence.request_identity.execution_mode, "recovery");
    assert.notEqual(retryEvidence.request_identity.request_id, state.attempts[20].request_id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recovery invalid response stops and preserves cumulative budget and historical unknown", async () => {
  const root = fixtureRoot();
  const calls = [];
  try {
    const { statePath } = await seedHistoricalStoppedFixture(root, calls);
    const failingTransport = async ({ body }) => {
      calls.push(body);
      return { status: 200, headers: {}, body: JSON.stringify({ results: [] }) };
    };
    await assert.rejects(
      () => runLocomoChunkRerank({
        root,
        repositoryRoot: "/home/lionsol/.openclaw/workspace/plugins/memory-engine",
        apiKey: "test-only",
        transport: failingTransport,
        sleep: async () => {},
        now: (() => { let value = 3_000_000; return () => value += 10; })(),
        recovery: true,
        confirmRecovery: true,
      }),
      /rerank_runner_stopped:response_index_set_incomplete/,
    );
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(calls.length, 21);
    assert.equal(state.status, "stopped");
    assert.equal(state.budget.attempts, 22);
    assert.equal(state.budget.cumulative_consumed, 2_545);
    assert.equal(state.budget.failed_responses, 1);
    assert.equal(state.budget.unknown_requests, 1);
    assert.equal(state.attempts[20].outcome, "unknown");
    assert.equal(state.attempts[21].outcome, "confirmed_failure");
    assert.equal(state.stop_history[0].attempt, 21);
    assert.equal(state.phases.main.results.length, 20);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
