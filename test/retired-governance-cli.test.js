import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const RETIRED_CLIS = [
  "audit-production-evidence-continuity.js",
  "audit-production-evidence-health.js",
  "audit-production-evidence-identity.js",
  "build-sustained-runtime-authorization-plan.js",
  "build-sustained-runtime-boundary-report.js",
  "build-sustained-runtime-config-backup-manifest.js",
  "finalize-sustained-runtime-activation-baseline.js",
  "project-production-evidence-epoch.js",
  "run-production-evidence-monitor-cycle.js",
  "verify-sustained-runtime-rollback.js",
];

test("retired governance CLIs fail explicitly instead of producing stale evidence", () => {
  for (const name of RETIRED_CLIS) {
    const result = spawnSync(process.execPath, [resolve("bin", name)], {
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(result.status, 2, name);
    assert.match(result.stderr, /retired under stabilization Work Package E/, name);
    assert.equal(result.stdout, "", name);
  }
});
