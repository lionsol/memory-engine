import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DOC_PATH = resolve(process.cwd(), "docs/retrieval-answering-policy.md");
const FIXTURE_PATH = resolve(process.cwd(), "test/fixtures/date-specific-recap-policy.json");

test("retrieval answering policy doc defines authoritative source order for date-specific recap", () => {
  const doc = readFileSync(DOC_PATH, "utf8");

  for (const required of [
    "昨天做了什么",
    "某天做了什么",
    "上周做了什么",
    "raw session / raw_log",
    "primary source",
    "manual / agent_smart_add",
    "secondary source",
    "episode",
    "tertiary summary",
    "如果 `episode` 与 `raw_log` 冲突，以 `raw_log` 为准",
    "`legacy-risk episode` 只能作为线索",
    "memory/generated-smart-add/",
    "memory/legacy-daily-mirrors/",
  ]) {
    assert.equal(doc.includes(required), true, `missing doc requirement: ${required}`);
  }
});

test("date-specific recap policy fixture forbids episode-only answering", () => {
  const policy = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

  assert.equal(policy.policy_name, "date_specific_recap");
  assert.deepEqual(policy.source_precedence.primary, ["raw_session", "raw_log"]);
  assert.deepEqual(policy.source_precedence.secondary, ["manual_smart_add", "agent_smart_add"]);
  assert.deepEqual(policy.source_precedence.tertiary, ["episode"]);
  assert.equal(policy.conflict_resolution.episode_vs_raw_log, "raw_log_wins");
  assert.equal(policy.legacy_risk_policy.legacy_risk_episode, "hint_only_not_authoritative");
  assert.equal(policy.excluded_sources.includes("memory/generated-smart-add/"), true);
  assert.equal(policy.excluded_sources.includes("memory/legacy-daily-mirrors/"), true);
  assert.equal(policy.disallowed_answering_modes.includes("episode_only_answer"), true);
  assert.equal(policy.disallowed_answering_modes.includes("legacy_risk_episode_only_answer"), true);
});
