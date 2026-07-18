import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("KG fail-closed policy is pure and cannot access the database", () => {
  const source = readFileSync(new URL("../lib/recall/hybrid/kg-fail-closed-policy.js", import.meta.url), "utf8");
  for (const forbidden of ["better-sqlite3", "SELECT", "INSERT", "UPDATE", "DELETE", "withLegacyDb", "legacy SQL"]) {
    assert.equal(source.includes(forbidden), false, `unexpected ${forbidden}`);
  }
});

test("canary requires trusted runtime context and an explicit allowlist", async () => {
  const { resolveKgFailClosedDecision } = await import("../lib/recall/hybrid/kg-fail-closed-policy.js");
  const base = { mode: "fail_closed_canary", canary: { enabled: true, agentIds: ["edi"] } };
  assert.equal(resolveKgFailClosedDecision(base).mode, "legacy_fallback");
  assert.equal(resolveKgFailClosedDecision({
    ...base,
    context: { source: "user", agentIdentity: "edi" },
  }).mode, "legacy_fallback");
  assert.equal(resolveKgFailClosedDecision({
    ...base,
    context: { source: "openclaw_runtime", agentIdentity: "edi" },
  }).mode, "fail_closed_canary");
});

test("full mode is explicit and does not require canary context", async () => {
  const { resolveKgFailClosedDecision } = await import("../lib/recall/hybrid/kg-fail-closed-policy.js");
  const decision = resolveKgFailClosedDecision({ mode: "full_fail_closed" });
  assert.equal(decision.mode, "full_fail_closed");
  assert.equal(decision.eligible, true);
  assert.equal(decision.scope_required, false);
  assert.equal(decision.rollout_scope, "full");
});
