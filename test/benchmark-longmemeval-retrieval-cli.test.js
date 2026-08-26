import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function fixture() {
  return [{
    question_id: "cli_q1",
    question_type: "single_hop",
    question: "Where is clineedle?",
    answer: "Kyoto",
    question_date: "2025/01/10 (Fri) 12:00",
    haystack_session_ids: ["s1", "s2"],
    haystack_dates: [
      "2025/01/08 (Wed) 12:00",
      "2025/01/09 (Thu) 12:00",
    ],
    haystack_sessions: [
      [
        { role: "user", content: "Unrelated text." },
        { role: "assistant", content: "Okay." },
      ],
      [
        { role: "user", content: "clineedle is Kyoto.", has_answer: true },
        { role: "assistant", content: "Noted." },
      ],
    ],
    answer_session_ids: ["s2"],
  }];
}

test("retrieval CLI records file SHA-256 and emits summary provenance", () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-longmemeval-cli-"));
  try {
    const inputPath = join(root, "longmemeval-smoke.json");
    const content = `${JSON.stringify(fixture(), null, 2)}\n`;
    writeFileSync(inputPath, content, "utf8");
    const expectedSha = createHash("sha256").update(Buffer.from(content)).digest("hex");

    const run = spawnSync(process.execPath, [
      "bin/run-longmemeval-retrieval-v1.js",
      "--input",
      inputPath,
      "--limit",
      "1",
      "--top-k",
      "3",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    assert.equal(run.status, 0, run.stderr);
    const output = JSON.parse(run.stdout);
    assert.equal(output.provenance.input_file, "longmemeval-smoke.json");
    assert.equal(output.provenance.input_sha256, expectedSha);
    assert.equal(output.run.top_k, 3);
    assert.equal(output.run.requested_limit, 1);
    assert.equal(output.summary.cases, 1);
    assert.equal(output.summary.scored_cases, 1);
    assert.equal(output.summary.metrics["recall_any@1"], 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
