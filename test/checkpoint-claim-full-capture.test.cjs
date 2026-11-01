"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");
const lab = require("../lib/checkpoint/summary-claim-ledger.cjs");
const { buildFactInput } = require("../lib/checkpoint/ordinary-summary-facts");
test("full native v2 inventory preserves model bytes and every evidence range while separating intermediate and final budgets", {
  skip: process.env.MEMORY_ENGINE_TEST_FULL_CLAIM_RESPONSE ? false : "set MEMORY_ENGINE_TEST_FULL_CLAIM_RESPONSE for the captured complete input"
}, () => {
  const responsePath = process.env.MEMORY_ENGINE_TEST_FULL_CLAIM_RESPONSE, directory = path.dirname(responsePath);
  const bytes = fs.readFileSync(responsePath), wire = JSON.parse(bytes);
  const input = JSON.parse(fs.readFileSync(path.join(directory, "fact-input.json"), "utf8"));
  const records = JSON.parse(fs.readFileSync(path.join(directory, "input-records.json"), "utf8"));
  const sourceBytes = fs.readFileSync(path.join(directory, "source.md"));
  const plan = JSON.parse(fs.readFileSync(path.join(directory, "plan.json"), "utf8"));
  const request = JSON.parse(fs.readFileSync(path.join(directory, "request.json"), "utf8"));
  const hash = value => createHash("sha256").update(value).digest("hex");
  assert.equal(hash(sourceBytes), plan.source_sha256);
  assert.deepEqual(buildFactInput(records, "2026-10-20"), input);
  const mode = { referenceMode: "fragment_ids", bodyMaxChars: 200000 };
  assert.deepEqual(lab.buildClaimPrompt(input, mode), request);
  const result = lab.projectClaimLedger(input, wire, mode);
  assert.deepEqual(result.ledger, wire); assert.equal(result.claims.length, wire.claims.length);
  const originals = new Map(records.map(record => [hash(record.text), record.text]));
  let refs = 0;
  for (const claim of result.claims) for (const ref of claim.sources) {
    assert.equal(originals.get(ref.source_hash).slice(ref.start, ref.end), ref.quote); refs++;
  }
  for (const context of result.source_context)
    assert.equal(originals.get(context.source_hash).slice(context.start, context.end), context.quote);
  assert.ok(refs > result.claims.length); assert.ok(result.bodyChars > 20000);
  assert.ok(result.bodyChars < 200000);
  assert.throws(() => lab.projectClaimLedger(input, wire, { referenceMode: "fragment_ids", bodyMaxChars: 20000 }),
    { code: "claim_body_budget" });
  assert.equal(result.coverage.status, "GAPS_REMAIN");
  assert.ok(result.coverage.unaccounted_fragment_ids.length > 0);
  assert.equal(result.semantic_correctness, "NOT_CERTIFIED");
  assert.equal(result.correction_validity, "MODEL_DECLARED_NOT_CERTIFIED");
  // A scope qualification was incorrectly attached by the model to old counts.
  // It must not erase those source-backed claims or become semantic authority.
  const qualification = result.claims.find(claim => claim.id === "c103");
  assert.ok(qualification.corrects.includes("c071"));
  assert.ok(result.claims.some(claim => claim.id === "c071"));
  assert.match(result.body, /173 条、缺 1830 条/);
  assert.equal(result.publishable, false);
  assert.deepEqual(fs.readFileSync(responsePath), bytes);
  assert.deepEqual(fs.readFileSync(path.join(directory, "source.md")), sourceBytes);
});
