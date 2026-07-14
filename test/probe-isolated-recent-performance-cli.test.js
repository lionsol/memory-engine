import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  parseArgs,
  probeIsolatedRecentPerformance,
  usage,
} = require("../bin/probe-isolated-recent-performance.js");

function createFixtureRoot() {
  return mkdtempSync(join(tmpdir(), "memory-engine-recent-performance-cli-"));
}

test("recent performance CLI help, parser, and mutation flag rejection", async () => {
  assert.equal(usage().includes("read-only"), true);
  const parsed = parseArgs(["--json", "--out", "report.json"]);
  assert.equal(parsed.json, true);
  assert.equal(parsed.out.endsWith("report.json"), true);

  const help = await probeIsolatedRecentPerformance(["--help"]);
  assert.equal(help.exitCode, 0);
  assert.equal(help.output.includes("Usage:"), true);

  for (const flag of ["--apply", "--force", "--write-db", "--delete", "--update", "--insert", "--repair", "--migrate", "--no-backup"]) {
    await assert.rejects(
      probeIsolatedRecentPerformance([flag]),
      error => String(error.message || error).includes("Isolated Recent performance probe is read-only"),
      flag,
    );
  }
});

test("recent performance CLI writes report only to caller path and returns valid JSON", async () => {
  const root = createFixtureRoot();
  try {
    const outPath = join(root, "recent-performance.json");
    const result = await probeIsolatedRecentPerformance(["--json", "--out", outPath], {
      probe: {
        runRecentPerformanceProbe: async () => ({
          probe: "isolated_recent_archived_exclusion_performance",
          decision: { class: "recommended_sql_rewrite" },
          privacy_ok: true,
        }),
        writeRecentPerformanceReport(output, path) {
          require("node:fs").mkdirSync(require("node:path").dirname(path), { recursive: true });
          require("node:fs").writeFileSync(path, output);
        },
      },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(existsSync(outPath), true);
    const report = JSON.parse(readFileSync(outPath, "utf8"));
    assert.equal(report.probe, "isolated_recent_archived_exclusion_performance");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recent performance CLI exit codes cover pass, fail, and inconclusive", async () => {
  const pass = await probeIsolatedRecentPerformance(["--json"], {
    probe: {
      runRecentPerformanceProbe: async () => ({ decision: { class: "recommended_sql_rewrite" } }),
      writeRecentPerformanceReport() {},
    },
  });
  assert.equal(pass.exitCode, 0);

  const fail = await probeIsolatedRecentPerformance(["--json"], {
    probe: {
      runRecentPerformanceProbe: async () => ({ decision: { class: "fail" } }),
      writeRecentPerformanceReport() {},
    },
  });
  assert.equal(fail.exitCode, 2);

  const inconclusive = await probeIsolatedRecentPerformance(["--json"], {
    probe: {
      runRecentPerformanceProbe: async () => ({ decision: { class: "inconclusive" } }),
      writeRecentPerformanceReport() {},
    },
  });
  assert.equal(inconclusive.exitCode, 3);
});
