import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { writeFinalizedJsonReportWithDigest } from "../bin/score-locomo-rerank-v1.mjs";

test("LoCoMo rerank scorer hashes finalized report bytes externally instead of embedding a recursive self-hash", () => {
  const root = mkdtempSync(join(tmpdir(), "locomo-rerank-report-digest-"));
  try {
    const reportPath = join(root, "report.json");
    const report = {
      schema: "test-report-v1",
      artifact_hashes: {
        state: "state-sha",
        material_manifest: "material-sha",
      },
    };

    const result = writeFinalizedJsonReportWithDigest(reportPath, report);
    const bytes = readFileSync(reportPath);
    const parsed = JSON.parse(bytes.toString("utf8"));
    const expected = createHash("sha256").update(bytes).digest("hex");

    assert.equal(result.reportSha256, expected);
    assert.equal(readFileSync(result.reportSha256Path, "utf8"), `${expected}\n`);
    assert.equal(parsed.artifact_hashes.report, undefined);
    assert.deepEqual(parsed, report);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
