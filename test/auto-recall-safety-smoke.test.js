import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("autoRecall safety smoke script writes report with required telemetry fields", () => {
  const outDir = mkdtempSync(resolve(tmpdir(), "auto-recall-safety-smoke-"));
  const outPath = resolve(outDir, "smoke.md");

  const result = spawnSync(process.execPath, [
    resolve(repoRoot, "bin/run-auto-recall-safety-smoke.js"),
    "--format", "md",
    "--out", outPath,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.equal(existsSync(outPath), true);
  const content = readFileSync(outPath, "utf8");
  assert.equal(content.includes("AutoRecall Safety Smoke"), true);
  assert.equal(content.includes("recall_intent_should_recall"), true);
  assert.equal(content.includes("recall_intent_reason"), true);
  assert.equal(content.includes("long_input_detected"), true);
  assert.equal(content.includes("focused_query"), true);
  assert.equal(content.includes("skipped_by_recall_intent"), true);
  assert.equal(content.includes("rejected_candidates_deny_reasons"), true);
  assert.equal(content.includes("reinforcement_allowed_ids"), true);
  assert.equal(content.includes("reinforced_ids"), true);
  assert.equal(content.includes("ignored_cited_ids"), true);
});
