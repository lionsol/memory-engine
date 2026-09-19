import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const PACKET_PATH = new URL(
  "../docs/smoke-tests/q6-d2-shadow-autorecall-exact-session-real-host-execution-packet-20260919.sh",
  import.meta.url,
);
const PACKET = readFileSync(PACKET_PATH, "utf8");

test("Q6-D2 packet records explicit one-shot Owner authorization without executing it", () => {
  assert.match(PACKET, /^EXECUTION_AUTHORIZED=true$/m);
  assert.match(PACKET, /OWNER-AUTHORIZED ONE-SHOT PACKET/);
  assert.match(PACKET, /STOP=Q6_D2_RUNTIME_NOT_AUTHORIZED/);

  const syntax = spawnSync("bash", ["-n", PACKET_PATH.pathname], {
    encoding: "utf8",
    env: process.env,
  });
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);
});

test("Q6-D2 packet binds stage, packet commit, clean worktree and explicit Node24", () => {
  assert.match(PACKET, /EXPECTED_STAGE_SHA="[a-f0-9]{64}"/);
  assert.match(PACKET, /NODE="\$HOME\/\.local\/node24\/bin\/node"/);
  assert.match(PACKET, /OPENCLAW_JS="\$HOME\/\.local\/lib\/node_modules\/openclaw\/dist\/index\.js"/);
  assert.match(PACKET, /HEAD_NOT_PACKET_COMMIT/);
  assert.match(PACKET, /DIRTY_WORKTREE/);
  assert.match(PACKET, /process\.versions\.modules/);
  assert.match(PACKET, /2026\.7\.1-2/);
});

test("Q6-D2 packet requires exact main session binding supplied at execution time", () => {
  assert.match(PACKET, /SESSION_ID="\$Q6_D2_SESSION_ID"/);
  assert.match(PACKET, /SESSION_KEY="\$Q6_D2_SESSION_KEY"/);
  assert.match(PACKET, /AUTHORIZED_SESSION_ID="d31f1b79-d9cb-476a-8d4e-f70f892b1500"/);
  assert.match(PACKET, /AUTHORIZED_SESSION_KEY="agent:main:explicit:d31f1b79-d9cb-476a-8d4e-f70f892b1500"/);
  assert.match(PACKET, /SESSION_ID_NOT_AUTHORIZED/);
  assert.match(PACKET, /SESSION_KEY_NOT_AUTHORIZED/);
  assert.match(PACKET, /DEFAULT_SESSION_FORBIDDEN/);
  assert.match(PACKET, /SESSION_KEY_NOT_MAIN/);
  assert.match(PACKET, /sessions --agent main --json/);
  assert.match(PACKET, /session_binding/);
  assert.doesNotMatch(PACKET, /01bff721-879f-49bb-85cc-7b7a5c8f67f0/);
});

test("Q6-D2 packet requires repaired publication parity before and during shadow", () => {
  assert.match(PACKET, /q6-r1-registry-evidence\.js/);
  assert.match(PACKET, /registry_q6_ok/);
  assert.match(PACKET, /q6_hashes "\$REPO"/);
  assert.match(PACKET, /q6_hashes "\$INSTALL_PATH"/);
  assert.match(PACKET, /0ea09bfea5bb5d1f3532ed22c9e0ae9c1cfe64abd785f00a1458b8481b0b0a27/);
  assert.match(PACKET, /61ffb77fead2f4e83265af4d6c7eb28d247c8562ea6771f7fc03fa3df3b2bfb6/);
  assert.match(PACKET, /9baa225f9a94752c94aec6fae92d9e663219a0565ecd0dec2aa35807b6815aa0/);
  assert.match(PACKET, /ee913beacc1b1ac103283846a82c0e19252240b9faa3e628e4acc21f3173ceef/);
});

test("Q6-D2 activation changes only exact-session shadow and validates before gateway start", () => {
  assert.match(PACKET, /normalized_without_shadow_sha/);
  assert.match(PACKET, /shadow_scope_exact/);

  const copyPos = PACKET.indexOf('cp "$SHADOW_CONFIG" "$CONFIG_PATH"');
  const validatePos = PACKET.indexOf('oc config validate --json >>"$LOG" 2>&1', copyPos);
  const startPos = PACKET.indexOf('oc gateway start >>"$LOG" 2>&1', validatePos);

  assert.ok(copyPos > 0);
  assert.ok(validatePos > copyPos);
  assert.ok(startPos > validatePos);
  assert.match(PACKET, /SHADOW_ACTIVE session=\$SESSION_ID/);
});

test("Q6-D2 packet bounds natural observation to six turns and content-free evidence", () => {
  assert.match(PACKET, /MAX_TURNS=6/);
  assert.match(PACKET, /q6-shadow-runtime-evidence\.js/);
  assert.match(PACKET, /foreign_q6_shadow_decision_count/);
  assert.match(PACKET, /memory_injected_on_shadow_trace_count/);
  assert.match(PACKET, /memory_reinforced_on_shadow_trace_count/);
  assert.match(PACKET, /direct_card_boundary_error_counts/);
  assert.match(PACKET, /STOP no_new_shadow_decision/);
  assert.match(PACKET, /STOP ambiguous_shadow_decisions/);
  assert.match(PACKET, /:finish/);
});

test("Q6-D2 packet has mandatory exact-byte closeout and no deployment/data repair", () => {
  assert.match(PACKET, /CLOSEOUT_BEGIN/);
  assert.match(PACKET, /cp "\$PRE_CONFIG" "\$CONFIG_PATH"/);
  assert.match(PACKET, /CLOSEOUT_PASS/);
  assert.match(PACKET, /trap on_exit EXIT INT TERM/);
  assert.doesNotMatch(PACKET, /plugins install/);
  assert.doesNotMatch(PACKET, /plugins registry --refresh/);
  assert.doesNotMatch(PACKET, /doctor --fix/);
  assert.doesNotMatch(PACKET, /sqlite3|UPDATE installed_plugin_index|INSERT INTO installed_plugin_index|DELETE FROM installed_plugin_index/);
});

test("Q6-D2 result vocabulary preserves evidence limitations", () => {
  assert.match(PACKET, /OUTCOME="PASS"/);
  assert.match(PACKET, /OUTCOME="INSUFFICIENT_EVIDENCE"/);
  assert.match(PACKET, /OUTCOME="PASS_WITH_FINDINGS"/);
  assert.match(PACKET, /memory_engine_q6_d2_shadow_autorecall_transaction_result_v1/);
});
