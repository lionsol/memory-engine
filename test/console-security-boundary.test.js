import test from "node:test";
import assert from "node:assert/strict";

import {
  buildResponseHeaders,
  DEFAULT_CONSOLE_HOST,
} from "../console/server.js";

test("Console defaults to loopback-only binding", () => {
  assert.equal(DEFAULT_CONSOLE_HOST, "127.0.0.1");
});

test("Console responses include the minimum local security headers", () => {
  const headers = buildResponseHeaders({
    "content-type": "application/json; charset=utf-8",
  });

  assert.equal(headers["content-type"], "application/json; charset=utf-8");
  assert.equal(headers["cache-control"], "no-store");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["referrer-policy"], "no-referrer");
  assert.match(headers["content-security-policy"], /default-src 'self'/);
  assert.match(headers["content-security-policy"], /frame-ancestors 'none'/);
});
