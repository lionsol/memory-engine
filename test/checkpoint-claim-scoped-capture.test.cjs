"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");
const compose = require("../lib/checkpoint/summary-claim-compose.cjs");
const archive = require("../lib/checkpoint/summary-memory-archive.cjs");
const { readDerivedSummary } = require("../lib/checkpoint/derived-summary");
for (const [label, variable] of [
  ["first scoped capture", "MEMORY_ENGINE_TEST_SCOPED_CLAIM_V1_RESPONSE"],
  ["logic-review scoped capture", "MEMORY_ENGINE_TEST_SCOPED_CLAIM_RESPONSE"]
]) test(label + " preserves every returned qualifier and its original-record backtrace without semantic certification", {
  skip: process.env[variable] ? false : "set " + variable + " for the private response"
}, async () => {
  const responsePath = process.env[variable], directory = path.dirname(responsePath);
  const bytes = fs.readFileSync(responsePath), raw = bytes.toString("utf8"), wire = JSON.parse(raw);
  const load = name => JSON.parse(fs.readFileSync(path.join(directory, name)));
  const input = load("fact-input.json"), inventory = load("inventory-model-output.json");
  const request = load("request.json"), result = load("result.json"), plan = load("plan.json");
  const records = load("input-records.json"), projected = load("projected-summary.json");
  const hash = x => createHash("sha256").update(x).digest("hex");
  assert.equal(hash(fs.readFileSync(path.join(directory, "source.md"))), plan.source_sha256);
  assert.equal(hash(fs.readFileSync(path.join(directory, "inventory-model-output.json"))), plan.inventory_response_sha256);
  const codePath = "lib/checkpoint/summary-claim-compose.cjs";
  assert.equal(hash(fs.readFileSync(path.join(directory, "composition-code.cjs"))), plan.code_hashes[codePath]);
  // The first capture's prompt is historical. Do not relabel a replay with the current rules.
  if (hash(fs.readFileSync(path.join(__dirname, "..", codePath))) === plan.code_hashes[codePath])
    assert.deepEqual(compose.buildClaimSummaryPrompt(input, inventory, { outputMode: "scoped_fields" }), request);
  let calls = 0;
  const replay = await compose.runClaimSummary(input, inventory, async () => { calls++; return raw; }, { outputMode: "scoped_fields" });
  assert.equal(calls, 1); assert.equal(replay.status, "READY_FOR_REVIEW");
  assert.equal(replay.semantic_correctness, "NOT_CERTIFIED"); assert.equal(replay.validation.coverage, "NOT_EVALUATED");
  assert.equal(replay.validation.scope_association, "MODEL_DECLARED_NOT_CERTIFIED");
  assert.equal(replay.validation.scoped_fields_preserved, true); assert.equal(replay.validation.publishable, false);
  assert.deepEqual(replay.scopedResponse, wire); assert.deepEqual(replay.response, projected);
  assert.equal(replay.bodyChars, result.body_chars); assert.ok(replay.bodyChars <= 20000);
  for (let index = 0; index < wire.items.length; index++) {
    const row = wire.items[index], final = replay.response.items[index];
    assert.equal(final.topic, row.scope); assert.ok(final.text.startsWith(row.conclusion));
    for (const field of ["conditions", "unresolved"]) for (const part of row[field]) {
      assert.ok(final.text.includes("（" + part.scope + "）：" + part.text));
      for (const id of part.evidence) assert.ok(final.evidence.includes(id));
    }
  }
  const directoryPath = path.join(directory, "archives");
  const stored = archive.loadArchive(directoryPath, result.archive_id);
  assert.deepEqual(stored.payload.raw_records, records); assert.deepEqual(stored.payload.summary, projected);
  const resolved = readDerivedSummary(result.archive_id, { directory: directoryPath, purpose: "acceptance" });
  const originals = new Map(records.map(r => [hash(r.text), r.text]));
  let count = 0;
  for (const item of resolved.items) for (const ref of item.sources) {
    assert.equal(originals.get(ref.source_hash).slice(ref.locator.start, ref.locator.end), ref.quote); count++;
  }
  assert.equal(count, result.verified_literal_references);
  assert.equal(replay.record.raw_response, raw); assert.deepEqual(fs.readFileSync(responsePath), bytes);
});
