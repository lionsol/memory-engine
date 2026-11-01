"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");
const compose = require("../lib/checkpoint/summary-claim-compose.cjs");
const archive = require("../lib/checkpoint/summary-memory-archive.cjs");
const { readDerivedSummary } = require("../lib/checkpoint/derived-summary");
test("captured full composition replays once without certifying semantic completeness or altering original evidence", {
  skip: process.env.MEMORY_ENGINE_TEST_CLAIM_COMPOSE_RESPONSE ? false : "set MEMORY_ENGINE_TEST_CLAIM_COMPOSE_RESPONSE for the captured final summary"
}, async () => {
  const responsePath = process.env.MEMORY_ENGINE_TEST_CLAIM_COMPOSE_RESPONSE, directory = path.dirname(responsePath);
  const bytes = fs.readFileSync(responsePath), raw = bytes.toString("utf8");
  const input = JSON.parse(fs.readFileSync(path.join(directory, "fact-input.json")));
  const inventoryBytes = fs.readFileSync(path.join(directory, "inventory-model-output.json"));
  const inventory = JSON.parse(inventoryBytes), request = JSON.parse(fs.readFileSync(path.join(directory, "request.json")));
  const records = JSON.parse(fs.readFileSync(path.join(directory, "input-records.json")));
  const result = JSON.parse(fs.readFileSync(path.join(directory, "result.json")));
  const hash = x => createHash("sha256").update(x).digest("hex");
  assert.equal(hash(bytes), "728f756e835aba991f110f9b6eecc6722ed4df2c37148a8ed611f7f2f37abcea");
  assert.equal(hash(inventoryBytes), result.inventory_response_sha256);
  assert.deepEqual(compose.buildClaimSummaryPrompt(input, inventory), request);
  let calls = 0;
  const replay = await compose.runClaimSummary(input, inventory, async () => { calls++; return raw; });
  assert.equal(calls, 1); assert.equal(replay.status, "READY_FOR_REVIEW");
  assert.equal(replay.semantic_correctness, "NOT_CERTIFIED");
  assert.equal(replay.validation.coverage, "NOT_EVALUATED");
  assert.equal(replay.validation.publishable, false);
  assert.deepEqual(replay.response, JSON.parse(raw));
  assert.equal(replay.bodyChars, result.body_chars); assert.ok(replay.bodyChars <= 20000);
  const resolved = readDerivedSummary(result.archive_id, { directory: path.join(directory, "archives"), purpose: "acceptance" });
  assert.deepEqual(resolved.items.map(x => x.item), replay.response.items);
  assert.equal(archive.createArchive({ rawLogs: records, targetDate: input.target_date,
    summary: replay.response, generator: { model: "replay-only" }, summaryMaxChars: 20000 }).payload.policy.semantic_correctness, "NOT_CERTIFIED");
  const originals = new Map(records.map(r => [hash(r.text), r.text]));
  let references = 0;
  for (const item of resolved.items) for (const ref of item.sources) {
    assert.equal(originals.get(ref.source_hash).slice(ref.locator.start, ref.locator.end), ref.quote); references++;
  }
  assert.equal(references, result.verified_literal_references);
  // The final text omits A's success criteria even though its cited original preserves them.
  // Mechanical acceptance must keep that evidence available, not imply semantic success.
  const acceptance = resolved.items.find(x => x.item.topic.includes("自然首跑验收安排"));
  assert.ok(acceptance.sources.some(x => x.locator.unit_id === "s0.t13.p1" && x.quote.includes("不计成功")));
  assert.ok(!acceptance.item.text.includes("不计成功"));
  assert.equal(replay.record.raw_response, raw);
  assert.deepEqual(fs.readFileSync(responsePath), bytes);
  assert.deepEqual(fs.readFileSync(path.join(directory, "inventory-model-output.json")), inventoryBytes);
});
