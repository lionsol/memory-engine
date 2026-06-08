import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readJsonBody } from "../console/http/read-json-body.js";

test("readJsonBody parses normal small JSON", async () => {
  const req = {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from('{"ok":true,"count":1}');
    },
  };

  const body = await readJsonBody(req);
  assert.deepEqual(body, { ok: true, count: 1 });
});

test("readJsonBody rejects invalid JSON with 400", async () => {
  const req = {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from("{not-json");
    },
  };

  await assert.rejects(
    () => readJsonBody(req),
    error => error?.statusCode === 400 && /invalid json/i.test(String(error?.message || ""))
  );
});

test("readJsonBody rejects oversized body with 413 and stops reading further chunks", async () => {
  let nextCalls = 0;
  let returnCalls = 0;
  const chunks = [
    Buffer.alloc(65536, 97),
    Buffer.from("!"),
    Buffer.from('{"shouldNotBeRead":true}'),
  ];
  const req = {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          nextCalls += 1;
          if (index >= chunks.length) return { done: true, value: undefined };
          return { done: false, value: chunks[index++] };
        },
        async return() {
          returnCalls += 1;
          return { done: true, value: undefined };
        },
      };
    },
  };

  await assert.rejects(
    () => readJsonBody(req, { maxBytes: 65536 }),
    error => error?.statusCode === 413 && /payload too large/i.test(String(error?.message || ""))
  );
  assert.equal(nextCalls, 2);
  assert.equal(returnCalls, 1);
});
