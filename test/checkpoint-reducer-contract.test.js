import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { inspectReducerManifest, validateReducer } = require("../lib/checkpoint/long-session-summary");
const DATE = "2026-10-20";
const SECRET = "PRIVATE_SUMMARY_SOURCE_OR_CREDENTIAL";
function fixture() {
  const segments = [{ id: 0 }, { id: 1 }];
  const entries = [{ id: "e0" }, { id: "e1" }];
  const maps = [0, 1].map(id => ({ segment_id: id, evidence: [{ start: id * 10, end: (id + 1) * 10, text: SECRET }] }));
  const object = { target_date: DATE, covered_segment_ids: [0, 1], covered_entry_ids: ["e0", "e1"],
    episode_summary: SECRET, references: [{ segment_id: 0, start: 0, end: 10 },
      { segment_id: 1, start: 10, end: 20 }, { entry_id: "e1" }] };
  return { segments, entries, maps, object, other: ["e1"] };
}
const cases = [
  ["wrong_date", f => { f.object.target_date = "2026-10-21"; }, "reducer_target_date", "target_date"],
  ["private_date", f => { f.object.target_date = SECRET; }, "reducer_target_date", "target_date"],
  ["missing_segment", f => { f.object.covered_segment_ids.pop(); }, "reducer_segment_coverage", "covered_segment_ids"],
  ["extra_segment", f => { f.object.covered_segment_ids.push(99); }, "reducer_segment_coverage", "covered_segment_ids"],
  ["duplicate_segment", f => { f.object.covered_segment_ids.push(0); }, "reducer_segment_coverage", "covered_segment_ids"],
  ["segment_type", f => { f.object.covered_segment_ids[1] = "1"; }, "reducer_segment_coverage", "covered_segment_ids"],
  ["missing_long_entry", f => { f.object.covered_entry_ids.shift(); }, "reducer_entry_coverage", "covered_entry_ids"],
  ["missing_other_entry", f => { f.object.covered_entry_ids.pop(); }, "reducer_entry_coverage", "covered_entry_ids"],
  ["extra_entry", f => { f.object.covered_entry_ids.push(SECRET); }, "reducer_entry_coverage", "covered_entry_ids"],
  ["duplicate_entry", f => { f.object.covered_entry_ids.push("e0"); }, "reducer_entry_coverage", "covered_entry_ids"],
  ["entry_type", f => { f.object.covered_entry_ids[1] = 1; }, "reducer_entry_coverage", "covered_entry_ids"],
  ["null_set", f => { f.object.covered_segment_ids = null; }, "reducer_structure", "covered_segment_ids"],
  ["private_set_string", f => { f.object.covered_entry_ids = SECRET; }, "reducer_structure", "covered_entry_ids"],
  ["null_references", f => { f.object.references = null; }, "reducer_structure", "references"],
  ["bad_summary", f => { f.object.episode_summary = ""; }, "reducer_structure", "episode_summary"],
  ["missing_reference", f => { f.object.references.pop(); }, "reducer_reference", "references"],
  ["bad_range", f => { f.object.references[0].end++; }, "reducer_reference", "references"],
  ["unknown_reference", f => { f.object.references[2].entry_id = SECRET; }, "reducer_reference", "references"],
];
for (const [name, mutate, reason, field] of cases) {
  test("reducer diagnostic: " + name + " rejects without disclosing output text", () => {
    const f = fixture(); mutate(f);
    const diagnostic = inspectReducerManifest(f.object, DATE, f.segments, f.entries);
    assert.throws(() => validateReducer(f.object, DATE, f.segments, f.entries, f.maps, f.other, diagnostic),
      error => error.code === reason);
    assert.equal(diagnostic.status, "failed");
    assert.ok(diagnostic.failure_fields.includes(field));
    assert.equal(JSON.stringify(diagnostic).includes(SECRET), false);
    if (name === "missing_segment") assert.deepEqual(diagnostic.covered_segment_ids.missing_ids, [1]);
    if (name === "duplicate_segment") assert.deepEqual(diagnostic.covered_segment_ids.duplicate_ids, [0]);
    if (name === "segment_type") {
      assert.equal(diagnostic.covered_segment_ids.wrong_type_count, 1);
      assert.deepEqual(diagnostic.covered_segment_ids.missing_ids, [1]);
    }
    if (name === "missing_long_entry") assert.deepEqual(diagnostic.covered_entry_ids.missing_ids, ["e0"]);
    if (name === "null_set") {
      assert.equal(diagnostic.covered_segment_ids.actual_count, null);
      assert.equal(diagnostic.covered_segment_ids.unexpected_count, null);
    }
    if (name === "private_date") assert.equal(diagnostic.target_date.actual, null);
    if (name === "missing_reference") assert.deepEqual(diagnostic.references.missing_other_entry_ids, ["e1"]);
    if (name === "bad_range") assert.equal(diagnostic.references.errors.range_mismatch, 1);
  });
}
test("all manifest differences are recorded before the first mismatch is thrown", () => {
  const f = fixture();
  f.object.target_date = "2026-10-21"; f.object.covered_segment_ids = []; f.object.covered_entry_ids = [];
  const diagnostic = inspectReducerManifest(f.object, DATE, f.segments, f.entries);
  assert.deepEqual(diagnostic.failure_fields, ["target_date", "covered_segment_ids", "covered_entry_ids"]);
  assert.equal(diagnostic.references.status, "not_checked");
  assert.throws(() => validateReducer(f.object, DATE, f.segments, f.entries, f.maps, f.other, diagnostic),
    error => error.code === "reducer_target_date");
});
test("strict set membership ignores order and keeps existing duplicate-reference behavior", () => {
  const f = fixture(); f.object.covered_segment_ids.reverse(); f.object.covered_entry_ids.reverse();
  f.object.references.push({ ...f.object.references[0] });
  const diagnostic = validateReducer(f.object, DATE, f.segments, f.entries, f.maps, f.other);
  assert.equal(diagnostic.status, "passed");
  assert.equal(diagnostic.references.status, "passed");
  assert.deepEqual(diagnostic.failure_fields, []);
});
test("diagnostic display truncation never truncates the actual coverage check", () => {
  const f = fixture(); f.entries = Array.from({ length: 40 }, (_, index) => ({ id: "e" + index }));
  f.object.covered_entry_ids = f.entries.map(item => item.id);
  let diagnostic = inspectReducerManifest(f.object, DATE, f.segments, f.entries);
  assert.equal(diagnostic.covered_entry_ids.passed, true);
  assert.equal(diagnostic.expected.covered_entry_ids.length, 16);
  assert.equal(diagnostic.expected.entry_count, 40);
  assert.equal(diagnostic.expected.details_truncated, true);
  f.object.covered_entry_ids.pop();
  diagnostic = inspectReducerManifest(f.object, DATE, f.segments, f.entries);
  assert.equal(diagnostic.covered_entry_ids.passed, false);
  assert.deepEqual(diagnostic.covered_entry_ids.missing_ids, ["e39"]);
});
test("a prefilled diagnostic cannot bypass validation of the actual response", () => {
  const f = fixture();
  const diagnostic = inspectReducerManifest(f.object, DATE, f.segments, f.entries);
  f.object.covered_entry_ids.shift();
  assert.throws(() => validateReducer(f.object, DATE, f.segments, f.entries, f.maps, f.other, diagnostic),
    error => error.code === "reducer_entry_coverage");
  assert.deepEqual(diagnostic.covered_entry_ids.missing_ids, ["e0"]);
  assert.equal(diagnostic.status, "failed");
});
test("oversized unknown ID arrays produce bounded counts without copying values", () => {
  const f = fixture(); f.object.covered_entry_ids = Array(1000).fill(SECRET);
  const diagnostic = inspectReducerManifest(f.object, DATE, f.segments, f.entries);
  assert.equal(diagnostic.covered_entry_ids.actual_count, 1000);
  assert.equal(diagnostic.covered_entry_ids.unexpected_count, 1000);
  assert.equal(diagnostic.covered_entry_ids.duplicate_count, 999);
  assert.equal(JSON.stringify(diagnostic).includes(SECRET), false);
  assert.ok(JSON.stringify(diagnostic).length < 2500);
});
