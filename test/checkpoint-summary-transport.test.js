import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const config = require("../lib/checkpoint/config");
const { llmComplete } = require("../lib/checkpoint/llm");
const { createSummaryProvider } = require("../lib/checkpoint/bounded-summary-provider");

async function fakeHttps(run, handler) {
  const original = { request: https.request, key: config.getDSKey, base: config.getDSBaseUrl };
  const requests = [];
  config.getDSKey = () => "fake-test-only-key";
  config.getDSBaseUrl = () => "https://fixture.invalid";
  https.request = (url, options, callback) => {
    const request = new EventEmitter();
    request.destroy = () => { request.destroyed = true; };
    request.setTimeout = () => {};
    request.write = text => { request.body = JSON.parse(text); };
    request.end = () => handler?.(request, callback);
    requests.push(request);
    return request;
  };
  try { await run(requests); }
  finally {
    https.request = original.request;
    config.getDSKey = original.key;
    config.getDSBaseUrl = original.base;
  }
}
function emit(callback, content) {
  const response = new EventEmitter();
  response.headers = {};
  callback(response);
  response.emit("data", JSON.stringify({ choices: [{ message: { content } }] }));
  response.emit("end");
}
test("bounded transport abort reaches the actual HTTPS request and late content cannot complete", async () => {
  let callback;
  await fakeHttps(async requests => {
    const controller = new AbortController();
    const promise = llmComplete("fixture", null, { provider: "deepseek", signal: controller.signal,
      timeoutMs: 30000, maxResponseChars: 600 });
    controller.abort();
    emit(callback, "late");
    await assert.rejects(promise, /cancelled/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].destroyed, true);
  }, (_, value) => { callback = value; });
});
test("actual HTTPS output overflow stops the shared adapter without fallback", async () => {
  await fakeHttps(async requests => {
    const adapter = createSummaryProvider({ providers: { primaryProvider: "deepseek", fallbackProvider: "siliconflow" } });
    await assert.rejects(adapter.complete("fixture", { kind: "map", outputLimit: 600 }), /output limit/);
    assert.equal(requests.length, 1);
    assert.equal(adapter.ledger.attempts, 1);
    assert.equal(adapter.ledger.output_reserved, 600);
    assert.equal(adapter.ledger.calls[0].output_limit_exceeded, true);
  }, (_, callback) => emit(callback, "x".repeat(601)));
});
test("UTF-8 bytes split inside Chinese and emoji characters decode without replacement", async () => {
  const content = "中文😀分段";
  await fakeHttps(async () => {
    assert.equal(await llmComplete("fixture", null, { provider: "deepseek", maxResponseChars: 600 }), content);
  }, (_, callback) => {
    const response = new EventEmitter();
    response.headers = {};
    callback(response);
    const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content } }] }));
    for (let index = 0; index < bytes.length; index++) response.emit("data", bytes.subarray(index, index + 1));
    response.emit("end");
  });
});

test("actual HTTPS transport has a wall deadline even without socket timeout events", async () => {
  await fakeHttps(async requests => {
    await assert.rejects(llmComplete("fixture", null, { provider: "deepseek", timeoutMs: 10,
      maxResponseChars: 600 }), /wall deadline/);
    assert.equal(requests[0].destroyed, true);
  });
});
