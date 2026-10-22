import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { llmComplete } = require("../lib/checkpoint/llm");
const { createSummaryProvider } = require("../lib/checkpoint/bounded-summary-provider");
const { withFakeHttps, emitJson, completion } = require("./checkpoint-summary-http-fixture.cjs");
const providers = { primaryProvider: "deepseek", fallbackProvider: "siliconflow" };

for (const scenario of ["content", "response_envelope", "provider_tokens", "content_type", "zero_content"]) {
  test("real HTTP decoder -> ledger distinguishes " + scenario + " without response disclosure or fallback", async () => {
    const secret = "SOURCE-OR-REASONING-SECRET";
    const object = scenario === "response_envelope"
      ? completion("short", "stop", { reasoning_content: secret.repeat(500) })
      : scenario === "provider_tokens" ? completion("short", "length")
      : scenario === "content_type" ? completion({ unexpected: secret })
      : scenario === "zero_content" ? completion(0)
      : completion("界".repeat(601));
    const raw = JSON.stringify(object);
    await withFakeHttps(async requests => {
      const adapter = createSummaryProvider({ providers });
      await assert.rejects(adapter.complete("synthetic input", { kind: "map", outputLimit: 600 }),
        error => error.code === "output_budget");
      assert.equal(requests.length, 1);
      assert.equal(requests[0].body.max_tokens, 600);
      assert.equal(adapter.ledger.attempts, 1);
      assert.equal(adapter.ledger.output_reserved, 600);
      assert.equal(adapter.ledger.output_chars, 0);
      const call = adapter.ledger.calls[0];
      assert.equal(call.status, "failed");
      assert.equal(call.output_budget_kind, scenario === "zero_content" ? "content_type" : scenario);
      assert.equal(call.observed_response_chars, raw.length);
      assert.equal(call.output_limit_chars, 600);
      assert.equal(call.response_limit_chars, 8896);
      assert.equal(call.provider_max_tokens, 600);
      assert.equal(call.output_limit_exceeded, true);
      if (scenario === "content") {
        assert.equal(call.observed_output_chars, 601);
        assert.equal(call.provider_finish_reason, "stop");
      } else if (scenario === "provider_tokens") {
        assert.equal(call.observed_output_chars, 5);
        assert.equal(call.provider_finish_reason, "length");
      } else assert.equal(Object.hasOwn(call, "observed_output_chars"), false);
      assert.equal(JSON.stringify(adapter.ledger).includes(secret), false);
      assert.equal(JSON.stringify(adapter.ledger).includes("界".repeat(20)), false);
    }, (_, callback) => emitJson(callback, object));
  });
}

test("content limit counts UTF-16 after bytewise UTF-8 decoding: 600 accepted, 601 rejected", async () => {
  for (const size of [600, 601]) {
    const content = "😀".repeat(299) + "界".repeat(size - 598);
    await withFakeHttps(async requests => {
      const request = llmComplete("fixture", null, { provider: "deepseek", maxResponseChars: 600 });
      if (size === 600) assert.equal(await request, content);
      else await assert.rejects(request, error => error.budgetKind === "content" && error.observedOutputChars === 601);
      assert.equal(requests.length, 1);
    }, (_, callback) => emitJson(callback, completion(content), { bytewise: true }));
  }
});

test("unrecognized provider finish reason and forged diagnostics never escape the ledger", async () => {
  const secret = "private-error-body";
  await withFakeHttps(async () => {
    const adapter = createSummaryProvider({ providers });
    await assert.rejects(adapter.complete("fixture", { kind: "map", outputLimit: 600 }));
    assert.equal(Object.hasOwn(adapter.ledger.calls[0], "provider_finish_reason"), false);
    assert.equal(JSON.stringify(adapter.ledger).includes(secret), false);
  }, (_, callback) => emitJson(callback, completion("x".repeat(601), secret)));
  const adapter = createSummaryProvider({ providers, transport: async () => {
    throw Object.assign(new Error(secret), { code: "output_budget", budgetKind: secret,
      observedResponseChars: secret, outputLimitChars: 1, observedOutputChars: Infinity });
  } });
  await assert.rejects(adapter.complete("fixture", { kind: "map", outputLimit: 600 }));
  assert.equal(adapter.ledger.calls[0].output_budget_kind, "unspecified");
  assert.equal(Object.hasOwn(adapter.ledger.calls[0], "observed_response_chars"), false);
  assert.equal(adapter.ledger.calls[0].output_limit_chars, 600);
  assert.equal(JSON.stringify(adapter.ledger).includes(secret), false);
});

test("ordinary unbounded llmComplete preserves its prior finish_reason behavior", async () => {
  await withFakeHttps(async () => {
    assert.equal(await llmComplete("fixture", null, { provider: "deepseek" }), "short");
  }, (_, callback) => emitJson(callback, completion("short", "length")));
});
