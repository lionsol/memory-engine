import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const PACKET_PATH = new URL(
  "../docs/smoke-tests/q6-host-plugin-metadata-publication-remediation-execution-packet-20260919.sh",
  import.meta.url,
);
const PACKET = readFileSync(PACKET_PATH, "utf8");

test("Q6-R1 packet is hard-disabled until a separate source authorization revision", () => {
  assert.match(PACKET, /^EXECUTION_AUTHORIZED=false$/m);
  assert.match(PACKET, /STOP=Q6_R1_RUNTIME_NOT_AUTHORIZED/);

  const result = spawnSync("bash", [PACKET_PATH.pathname], {
    encoding: "utf8",
    env: process.env,
  });
  assert.equal(result.status, 64);
  assert.match(result.stdout, /STOP=Q6_R1_RUNTIME_NOT_AUTHORIZED/);
});

test("Q6-R1 packet binds Node24, stage identity, one forward install and one rollback install", () => {
  assert.match(PACKET, /EXPECTED_STAGE_SHA="[a-f0-9]{64}"/);
  assert.match(PACKET, /NODE="\$HOME\/\.local\/node24\/bin\/node"/);
  assert.match(PACKET, /OPENCLAW_JS="\$HOME\/\.local\/lib\/node_modules\/openclaw\/dist\/index\.js"/);
  assert.match(PACKET, /HEAD_NOT_PACKET_COMMIT/);
  assert.match(PACKET, /DIRTY_WORKTREE/);
  assert.match(PACKET, /MAX_FORWARD_INSTALLS=1/);
  assert.match(PACKET, /MAX_ROLLBACK_INSTALLS=1/);
  assert.match(PACKET, /MAX_RUNTIME_EXECUTIONS=1/);

  const installs = [...PACKET.matchAll(/oc plugins install /g)];
  assert.equal(installs.length, 2);
  assert.match(PACKET, /oc plugins install "\$REPO" --force/);
  assert.match(PACKET, /oc plugins install "\$ROLLBACK_SNAPSHOT" --force/);
  assert.doesNotMatch(PACKET, /plugins install .*--link/);
});

test("Q6-R1 packet validates proven split-brain, forward convergence and coherent rollback", () => {
  assert.match(PACKET, /q6-r1-registry-evidence\.js/);
  assert.match(PACKET, /registry_old_split_brain/);
  assert.match(PACKET, /registry_forward_ok/);
  assert.match(PACKET, /registry_rollback_ok/);
  assert.match(PACKET, /installed_q6_hashes/);
  assert.match(PACKET, /installed_old_hashes/);
  assert.match(PACKET, /346969a530ac8b6931bd4ec9d624016ca36ae394d47a79f9058bf037f602a735/);
  assert.match(PACKET, /0ea09bfea5bb5d1f3532ed22c9e0ae9c1cfe64abd785f00a1458b8481b0b0a27/);
  assert.match(PACKET, /ROLLBACK_SNAPSHOT_READY/);
  assert.doesNotMatch(PACKET, /chmod -R a-w/);
  assert.match(PACKET, /ROLLBACK_PASS/);
  assert.match(PACKET, /publication_converged/);
});

test("Q6-R1 packet preserves config semantics and never activates shadow", () => {
  assert.match(PACKET, /build-config-semantic-equivalence-report\.js/);
  assert.match(PACKET, /memory-engine-config-semantic-equivalence-v1/);
  assert.match(PACKET, /config_invariants/);
  assert.match(PACKET, /autoRecall\.shadow/);
  assert.doesNotMatch(PACKET, /sessionAllowlist:\[\$sid\]/);
  assert.doesNotMatch(PACKET, /\.autoRecall\.shadow\s*=/);
  assert.doesNotMatch(PACKET, /memory_engine_search|memory_engine_get|memory_engine\.add/);
});

test("Q6-R1 packet does not use broad or direct repair mechanisms", () => {
  assert.doesNotMatch(PACKET, /doctor --fix/);
  assert.doesNotMatch(PACKET, /plugins registry --refresh/);
  assert.doesNotMatch(PACKET, /sqlite3|UPDATE installed_plugin_index|INSERT INTO installed_plugin_index|DELETE FROM installed_plugin_index/);
  assert.doesNotMatch(PACKET, /cp .*INSTALL_PATH.*openclaw\.plugin\.json/);
  assert.doesNotMatch(PACKET, /rsync/);
});

test("Q6-R1 packet has fail-closed unexpected-exit rollback after forward mutation", () => {
  assert.match(PACKET, /FORWARD_MUTATED=1/);
  assert.match(PACKET, /trap unexpected_exit EXIT/);
  assert.match(PACKET, /rollback_safe_old_runtime "unexpected_exit_rc_\$rc"/);
  assert.match(PACKET, /write_result "ROLLED_BACK"/);
  assert.match(PACKET, /unexpected_preinstall_exit_rc_\$rc/);
  assert.match(PACKET, /rollback_attempted:\$rollback_attempted/);
  assert.match(PACKET, /write_result "PASS" "publication_converged" null/);
  assert.match(PACKET, /gateway_stop_failed_pre_install_gateway_restored/);
  assert.match(PACKET, /gateway_stop_failed_pre_install_gateway_not_ready/);
});
