import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FIXTURE_PATH = resolve(process.cwd(), "test/fixtures/date-specific-recap-policy.json");

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
