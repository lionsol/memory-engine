import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  parseArgs,
  exitCodeForDecision,
  auditRecentCanaryScopeSource,
  usage,
} = require("../bin/audit-recent-canary-scope-source.js");

function createFixtureRoot() {
  return mkdtempSync(join(tmpdir(), "memory-engine-scope-audit-cli-"));
}

test("scope audit CLI parser, help, and mutation flag rejection", async () => {
  assert.equal(usage().includes("read-only"), true);
  const parsed = parseArgs(["--json", "--out", "/tmp/report.json"]);
  assert.equal(parsed.json, true);
  assert.equal(parsed.out, "/tmp/report.json");

  const help = await auditRecentCanaryScopeSource(["--help"]);
  assert.equal(help.exitCode, 0);
  assert.equal(help.output.includes("Usage:"), true);

  await assert.rejects(
    auditRecentCanaryScopeSource(["--apply"]),
    error => String(error.message || error).includes("read-only"),
  );
});

test("scope audit CLI writes report to caller-selected path and preserves privacy", async () => {
  const root = createFixtureRoot();
  try {
    const outPath = join(root, "recent-canary-scope.json");
    const result = await auditRecentCanaryScopeSource(["--json", "--out", outPath], {
      installInfo: {
        which_openclaw: "/opt/openclaw/bin/openclaw",
        resolved_entry: "/opt/openclaw/openclaw.mjs",
        npm_global_root: "/opt/openclaw/node_modules",
        package_name: "openclaw",
        package_version: "2026.6.9",
      },
    });
    assert.equal(result.exitCode, 2);
    assert.equal(existsSync(outPath), true);
    const report = JSON.parse(readFileSync(outPath, "utf8"));
    assert.equal(report.openclaw_install.package_version, "2026.6.9");
    assert.equal(report.decision.class, "no_trusted_scope_available");
    assert.equal(JSON.stringify(report).includes("scope-secret"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scope audit CLI exit codes cover pass, partial, inconclusive, and no-trusted-scope", async () => {
  assert.equal(exitCodeForDecision("pass_trusted_scope_feasibility"), 0);
  assert.equal(exitCodeForDecision("partial_scope_feasibility"), 3);
  assert.equal(exitCodeForDecision("inconclusive"), 3);
  assert.equal(exitCodeForDecision("no_trusted_scope_available"), 2);
});
