import assert from "node:assert/strict";
import test from "node:test";

import {
  createC1AExecutionBudget,
  runC1AQualificationCase,
} from "../lib/benchmark/c1a-qualification-runner.js";

const tokenCounter = text => [...text].length;
const candidates = [
  { id: "a", text: "alpha" },
  { id: "b", text: "beta" },
  { id: "c", text: "" },
];
const controlOrder = ["a", "b", "c"];
const allowAll = { a: "ALLOW", b: "ALLOW", c: "UNKNOWN" };

test("C1-A runner bypasses query or candidate egress before adapter execution", async () => {
  let calls = 0;
  const adapter = async () => { calls += 1; return { scores: [] }; };
  const budget = createC1AExecutionBudget();

  const queryBlocked = await runC1AQualificationCase({
    caseId: "q", query: "query", candidates, controlOrder,
    queryEgress: "UNKNOWN", candidateEgress: allowAll,
    adapter, tokenCounter, budget,
  });
  assert.equal(queryBlocked.status, "bypassed");
  assert.equal(queryBlocked.reason, "query_egress_not_allowed");

  const candidateBlocked = await runC1AQualificationCase({
    caseId: "c", query: "query", candidates, controlOrder,
    queryEgress: "ALLOW", candidateEgress: { a: "ALLOW", b: "DENY" },
    adapter, tokenCounter, budget,
  });
  assert.equal(candidateBlocked.reason, "candidate_egress_not_allowed");
  assert.equal(calls, 0);
  assert.equal(budget.snapshot().requests, 0);
});

test("C1-A runner preserves same-profile control on adapter failure", async () => {
  const adapter = async () => { throw new Error("synthetic provider failure"); };
  Object.defineProperty(adapter, "adapterIdentity", {
    value: { provider: "siliconflow", model: "Qwen/Qwen3-Reranker-8B", revision: null },
  });
  const budget = createC1AExecutionBudget();
  const result = await runC1AQualificationCase({
    caseId: "fallback", query: "query", candidates, controlOrder,
    queryEgress: "ALLOW", candidateEgress: allowAll,
    adapter, tokenCounter, budget,
  });

  assert.equal(result.status, "fallback");
  assert.deepEqual(result.ordered_ids, controlOrder);
  assert.deepEqual(result.top3_ids, controlOrder.slice(0, 3));
  assert.equal(budget.snapshot().requests, 1);
});

test("C1-A runner applies a complete rerank and never sends empty text", async () => {
  let submittedTexts;
  const adapter = async (_query, texts) => {
    submittedTexts = texts;
    return {
      scores: [
        { index: 0, score: 0.1 },
        { index: 1, score: 0.9 },
      ],
      adapterIdentity: { provider: "siliconflow", model: "Qwen/Qwen3-Reranker-8B", revision: null },
      usage: { input_tokens: 10 },
    };
  };
  const budget = createC1AExecutionBudget();
  const result = await runC1AQualificationCase({
    caseId: "applied", query: "query", candidates, controlOrder,
    queryEgress: "ALLOW", candidateEgress: allowAll,
    adapter, tokenCounter, budget,
  });

  assert.deepEqual(submittedTexts, ["alpha", "beta"]);
  assert.equal(result.status, "applied");
  assert.deepEqual(result.ordered_ids, ["b", "a", "c"]);
  assert.equal(result.usage.input_tokens, 10);
  assert.equal(budget.snapshot().reported_input_tokens, 10);
  assert.equal(budget.snapshot().accounted_input_tokens, 10);
  assert.equal(budget.snapshot().unsettled_reservation_count, 0);
});

test("C1-A runner marks structurally invalid provider responses distinctly", async () => {
  const adapter = async () => ({ scores: null, usage: null });
  const result = await runC1AQualificationCase({
    caseId: "invalid", query: "query", candidates, controlOrder,
    queryEgress: "ALLOW", candidateEgress: allowAll,
    adapter, tokenCounter, budget: createC1AExecutionBudget(),
  });
  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "invalid_response");
  assert.equal(result.structurally_invalid_response, true);
  assert.deepEqual(result.ordered_ids, controlOrder);
});

test("C1-A runner rejects token budget before adapter transport", async () => {
  let calls = 0;
  const adapter = async () => { calls += 1; return { scores: [] }; };
  const budget = createC1AExecutionBudget({ maxRequests: 10, maxInputTokens: 1 });

  await assert.rejects(
    () => runC1AQualificationCase({
      caseId: "budget", query: "query", candidates, controlOrder,
      queryEgress: "ALLOW", candidateEgress: allowAll,
      adapter, tokenCounter, budget,
    }),
    /C1A_INPUT_TOKEN_BUDGET_EXCEEDED/,
  );
  assert.equal(calls, 0);
});

test("C1-A budget reconciles conservative reservations with provider-reported usage", () => {
  const budget = createC1AExecutionBudget({ maxRequests: 3, maxInputTokens: 100 });
  const first = budget.reserve(80);
  budget.settle(first, { input_tokens: 10 });
  const second = budget.reserve(80);
  budget.settle(second, null);

  const snapshot = budget.snapshot();
  assert.equal(snapshot.requests, 2);
  assert.equal(snapshot.estimated_input_tokens, 160);
  assert.equal(snapshot.reported_input_tokens, 10);
  assert.equal(snapshot.accounted_input_tokens, 90);
  assert.equal(snapshot.conservative_retained_input_tokens, 80);
  assert.equal(snapshot.unsettled_reservation_count, 0);
  assert.throws(() => budget.reserve(11), /C1A_INPUT_TOKEN_BUDGET_EXCEEDED/);
});

test("C1-A budget fails closed if reported usage exceeds the reserved remaining envelope", () => {
  const budget = createC1AExecutionBudget({ maxRequests: 2, maxInputTokens: 100 });
  const reservation = budget.reserve(80);
  assert.throws(
    () => budget.settle(reservation, { input_tokens: 120 }),
    /C1A_REPORTED_INPUT_TOKEN_BUDGET_EXCEEDED/,
  );
  assert.equal(budget.snapshot().accounted_input_tokens, 80);
  assert.equal(budget.snapshot().unsettled_reservation_count, 1);
});

test("C1-A budget enforces the preauthorized monetary cap before transport", async () => {
  const adapter = async () => ({
    scores: [
      { index: 0, score: 0.8 },
      { index: 1, score: 0.7 },
    ],
    usage: { input_tokens: 1 },
  });
  const budget = createC1AExecutionBudget({
    maxRequests: 10,
    maxInputTokens: 1_000_000,
    maxCostUsd: 0.000001,
    inputPriceUsdPerMillion: 0.04,
  });
  await assert.rejects(
    () => runC1AQualificationCase({
      caseId: "cost", query: "query", candidates, controlOrder,
      queryEgress: "ALLOW", candidateEgress: allowAll,
      adapter, tokenCounter, budget,
    }),
    /C1A_COST_BUDGET_EXCEEDED/,
  );
});

test("C1-A runner enforces finite request budget", async () => {
  const adapter = async () => ({
    scores: [
      { index: 0, score: 0.8 },
      { index: 1, score: 0.7 },
    ],
    usage: { input_tokens: 1 },
  });
  const budget = createC1AExecutionBudget({ maxRequests: 1, maxInputTokens: 1000 });
  const input = {
    query: "q", candidates, controlOrder, queryEgress: "ALLOW", candidateEgress: allowAll,
    adapter, tokenCounter, budget,
  };
  await runC1AQualificationCase({ caseId: "one", ...input });
  await assert.rejects(
    () => runC1AQualificationCase({ caseId: "two", ...input }),
    /C1A_REQUEST_BUDGET_EXCEEDED/,
  );
});

test("C1-A deadline aborts the adapter and falls back atomically", async () => {
  let observedAbort = false;
  const adapter = async (_query, _texts, signal) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => {
      observedAbort = true;
      reject(new Error("aborted by deadline"));
    }, { once: true });
  });
  const result = await runC1AQualificationCase({
    caseId: "timeout", query: "q", candidates, controlOrder,
    queryEgress: "ALLOW", candidateEgress: allowAll,
    adapter, tokenCounter, budget: createC1AExecutionBudget(), deadlineMs: 5,
  });
  assert.equal(observedAbort, true);
  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "timeout");
  assert.deepEqual(result.ordered_ids, controlOrder);
});

test("late adapter rejection after deadline is isolated from returned serving evidence", async () => {
  const adapter = async () => new Promise((resolve, reject) => {
    setTimeout(() => reject(new Error("late rejection")), 20);
  });
  const result = await runC1AQualificationCase({
    caseId: "late-reject", query: "q", candidates, controlOrder,
    queryEgress: "ALLOW", candidateEgress: allowAll,
    adapter, tokenCounter, budget: createC1AExecutionBudget(), deadlineMs: 5,
  });
  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "timeout");
  assert.deepEqual(result.ordered_ids, controlOrder);
  await new Promise(resolve => setTimeout(resolve, 30));
});

test("late adapter resolution after deadline cannot mutate returned serving evidence", async () => {
  const adapter = async () => new Promise(resolve => {
    setTimeout(() => resolve({
      scores: [
        { index: 0, score: 0.1 },
        { index: 1, score: 0.9 },
      ],
    }), 20);
  });
  const result = await runC1AQualificationCase({
    caseId: "late-resolve", query: "q", candidates, controlOrder,
    queryEgress: "ALLOW", candidateEgress: allowAll,
    adapter, tokenCounter, budget: createC1AExecutionBudget(), deadlineMs: 5,
  });
  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "timeout");
  assert.deepEqual(result.ordered_ids, controlOrder);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(result.ordered_ids, controlOrder);
});

test("bounded case evidence contains no raw query, candidate text, or credential fields", async () => {
  const adapter = async () => ({
    scores: [
      { index: 0, score: 0.2 },
      { index: 1, score: 0.9 },
    ],
    usage: { input_tokens: 4 },
  });
  const result = await runC1AQualificationCase({
    caseId: "bounded", query: "secret-query", candidates, controlOrder,
    queryEgress: "ALLOW", candidateEgress: allowAll,
    adapter, tokenCounter, budget: createC1AExecutionBudget(),
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /secret-query|alpha|beta|apiKey|Authorization|Bearer/);
});
