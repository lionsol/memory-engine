import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PACKET = readFileSync(
  new URL("../docs/smoke-tests/q6-shadow-autorecall-exact-session-real-host-execution-packet-20260919.sh", import.meta.url),
  "utf8",
);

test("Q6-D execution packet stays one-shot and exact-session bounded", () => {
  assert.match(PACKET, /Q6_SOURCE="4f79a8c78fb68bb92294ea78a755293c8b62cbc4"/);
  assert.match(PACKET, /STAGE_SHA="232215a09768a7d643b2f6bab261ad0129127bbb2cdb78bc318a9ada9f762f8c"/);
  assert.match(PACKET, /MAX_TURNS=6/);
  assert.match(PACKET, /Q6_SESSION_ID/);
  assert.match(PACKET, /Q6_SESSION_KEY/);
  assert.match(PACKET, /SESSION_KEY.*agent:main:main/);
  assert.match(PACKET, /sessionAllowlist:\[\$sid\]/);
  assert.match(PACKET, /autoRecall\.topK == 3/);
  assert.match(PACKET, /cardFirstRuntime\.enabled == true/);
});

test("Q6-D packet deploys only the four frozen Q6 runtime files", () => {
  const overlays = [...PACKET.matchAll(/overlay "([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(overlays, [
    "lib/config/effective-hybrid-runtime-config.js",
    "lib/recall/auto-recall-hook-lifecycle.js",
    "lib/recall/auto-recall-shadow.js",
    "openclaw.plugin.json",
  ]);
  assert.match(PACKET, /DIFF_COUNT.*-eq 4/);
  assert.match(PACKET, /candidate_diff_escape/);
  assert.doesNotMatch(PACKET, /npm (install|ci|rebuild)/);
});

test("Q6-D packet never manufactures traffic or invokes memory tools", () => {
  assert.doesNotMatch(PACKET, /openclaw agent/);
  assert.doesNotMatch(PACKET, /tools\.invoke/);
  assert.doesNotMatch(PACKET, /memory_engine_search/);
  assert.doesNotMatch(PACKET, /memory_engine_get/);
  assert.doesNotMatch(PACKET, /memory_engine\.add/);
  assert.match(PACKET, /send ONE genuine natural turn in the bound session/i);
  assert.match(PACKET, /IFS= read -r OP <\/dev\/tty/);
});

test("Q6-D packet has mandatory fail-closed evidence and rollback checks", () => {
  assert.match(PACKET, /q6-shadow-runtime-evidence\.js/);
  assert.match(PACKET, /foreign_q6_shadow_decision_count/);
  assert.match(PACKET, /memory_injected_on_shadow_trace_count/);
  assert.match(PACKET, /memory_reinforced_on_shadow_trace_count/);
  assert.match(PACKET, /closeout\(\)/);
  assert.match(PACKET, /plugins install "\$BASE_SOURCE" --force/);
  assert.match(PACKET, /cp "\$PRE_CONFIG" "\$CONFIG_PATH"/);
  assert.match(PACKET, /baseline_hashes "\$BASE_SOURCE"/);
  assert.match(PACKET, /plugin_loaded \|\| return 1/);
  assert.match(PACKET, /write_stopped_result\(\)/);
  assert.match(PACKET, /outcome:"STOPPED"/);
  assert.match(PACKET, /trap .*closeout.*write_stopped_result/);
});

test("Q6-D packet is self-bound to the commit that contains it", () => {
  assert.match(PACKET, /PACKET_COMMIT=.*git -C "\$REPO" log -1 --format=%H -- "\$PACKET_REL"/);
  assert.match(PACKET, /HEAD.*PACKET_COMMIT/);
  assert.match(PACKET, /dirty_worktree/);
});
