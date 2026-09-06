import test from "node:test";
import assert from "node:assert/strict";

import {
  buildResponseHeaders,
  DEFAULT_CONSOLE_HOST,
} from "../console/server.js";
import {
  CONSOLE_ALLOWED_HOSTS_REQUIRED,
  CONSOLE_AUTH_REQUIRED,
  CONSOLE_HOST_NOT_ALLOWED,
  CONSOLE_ORIGIN_NOT_ALLOWED,
  CONSOLE_TOKEN_REQUIRED,
  createConsoleSecurityPolicy,
  evaluateConsoleRequestSecurity,
} from "../console/security.js";

const TOKEN = "0123456789abcdef0123456789abcdef";

function request(headers = {}) {
  return { headers: { host: "127.0.0.1:8787", ...headers } };
}

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

test("Console refuses to create a security policy without a strong configured token", () => {
  assert.throws(
    () => createConsoleSecurityPolicy({ token: "", bindHost: "127.0.0.1", port: 8787 }),
    error => error.message === CONSOLE_TOKEN_REQUIRED,
  );
  assert.throws(
    () => createConsoleSecurityPolicy({ token: "short", bindHost: "127.0.0.1", port: 8787 }),
    error => error.message === CONSOLE_TOKEN_REQUIRED,
  );
});

test("wildcard bind requires an explicit finite allowed-host list", () => {
  assert.throws(
    () => createConsoleSecurityPolicy({ token: TOKEN, bindHost: "0.0.0.0", port: 8787 }),
    error => error.message === CONSOLE_ALLOWED_HOSTS_REQUIRED,
  );
  const policy = createConsoleSecurityPolicy({
    token: TOKEN,
    bindHost: "0.0.0.0",
    port: 8787,
    allowedHosts: "console.internal,100.64.0.10",
  });
  assert.deepEqual(policy.allowedHosts, ["console.internal", "100.64.0.10"]);
});

test("loopback policy accepts local Host aliases and rejects DNS-rebinding hosts", () => {
  const policy = createConsoleSecurityPolicy({ token: TOKEN, bindHost: "127.0.0.1", port: 8787 });

  assert.equal(
    evaluateConsoleRequestSecurity(
      request({ authorization: `Bearer ${TOKEN}` }),
      policy,
    ).allowed,
    true,
  );
  assert.equal(
    evaluateConsoleRequestSecurity(
      request({ host: "localhost:8787", authorization: `Bearer ${TOKEN}` }),
      policy,
    ).allowed,
    true,
  );

  const denied = evaluateConsoleRequestSecurity(
    request({ host: "attacker.example:8787", authorization: `Bearer ${TOKEN}` }),
    policy,
  );
  assert.deepEqual(denied, { allowed: false, status: 421, code: CONSOLE_HOST_NOT_ALLOWED });
});

test("dynamic Console requests require Bearer or browser-compatible Basic token auth", () => {
  const policy = createConsoleSecurityPolicy({ token: TOKEN, bindHost: "127.0.0.1", port: 8787 });

  const missing = evaluateConsoleRequestSecurity(request(), policy);
  assert.equal(missing.allowed, false);
  assert.equal(missing.status, 401);
  assert.equal(missing.code, CONSOLE_AUTH_REQUIRED);
  assert.match(missing.headers["www-authenticate"], /^Basic /u);

  const bearer = evaluateConsoleRequestSecurity(
    request({ authorization: `Bearer ${TOKEN}` }),
    policy,
  );
  assert.equal(bearer.allowed, true);

  const basicValue = Buffer.from(`memory:${TOKEN}`, "utf8").toString("base64");
  const basic = evaluateConsoleRequestSecurity(
    request({ authorization: `Basic ${basicValue}` }),
    policy,
  );
  assert.equal(basic.allowed, true);

  const wrongUser = Buffer.from(`other:${TOKEN}`, "utf8").toString("base64");
  assert.equal(
    evaluateConsoleRequestSecurity(
      request({ authorization: `Basic ${wrongUser}` }),
      policy,
    ).allowed,
    false,
  );
});

test("cross-site fetch and mismatched Origin fail closed before auth", () => {
  const policy = createConsoleSecurityPolicy({ token: TOKEN, bindHost: "127.0.0.1", port: 8787 });

  const crossSite = evaluateConsoleRequestSecurity(
    request({
      authorization: `Bearer ${TOKEN}`,
      "sec-fetch-site": "cross-site",
      origin: "http://attacker.example:8787",
    }),
    policy,
  );
  assert.deepEqual(crossSite, { allowed: false, status: 403, code: CONSOLE_ORIGIN_NOT_ALLOWED });

  const wrongOrigin = evaluateConsoleRequestSecurity(
    request({
      authorization: `Bearer ${TOKEN}`,
      origin: "http://localhost:9999",
    }),
    policy,
  );
  assert.deepEqual(wrongOrigin, { allowed: false, status: 403, code: CONSOLE_ORIGIN_NOT_ALLOWED });

  const sameOrigin = evaluateConsoleRequestSecurity(
    request({
      authorization: `Bearer ${TOKEN}`,
      origin: "http://127.0.0.1:8787",
      "sec-fetch-site": "same-origin",
    }),
    policy,
  );
  assert.equal(sameOrigin.allowed, true);
});

test("static assets may load without credentials but still require Host and origin safety", () => {
  const policy = createConsoleSecurityPolicy({ token: TOKEN, bindHost: "127.0.0.1", port: 8787 });

  assert.equal(
    evaluateConsoleRequestSecurity(request(), policy, { requireAuth: false }).allowed,
    true,
  );
  assert.equal(
    evaluateConsoleRequestSecurity(
      request({ host: "attacker.example:8787" }),
      policy,
      { requireAuth: false },
    ).allowed,
    false,
  );
});
