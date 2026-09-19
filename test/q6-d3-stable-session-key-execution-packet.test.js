import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const PACKET_PATH = new URL(
  "../docs/smoke-tests/q6-d3-stable-session-key-shadow-execution-packet-20260919.sh",
  import.meta.url,
);
const PACKET = readFileSync(PACKET_PATH, "utf8");

test("Q6-D3 packet records one-shot Owner authorization but tests never execute it", () => {
  assert.match(PACKET, /^EXECUTION_AUTHORIZED=true$/m);
  assert.match(PACKET, /OWNER-AUTHORIZED ONE-SHOT PACKET/);
  assert.match(PACKET, /STOP=Q6_D3_RUNTIME_NOT_AUTHORIZED/);

  const syntax = spawnSync("bash", ["-n", PACKET_PATH.pathname], {
    encoding: "utf8",
    env: process.env,
  });
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);
});

test("Q6-D3 packet executes its exact max_event_id snippet against SQLite", () => {
  const match = PACKET.match(/max_event_id\(\) \{\n\s+"\$NODE" -e '([^']+)' "\$ENGINE_DB"\n\}/);
  assert.ok(match, "embedded max_event_id snippet not found");

  const dir = mkdtempSync(join(tmpdir(), "q6-d3-max-event-"));
  const dbPath = join(dir, "engine.sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("CREATE TABLE memory_events (id INTEGER PRIMARY KEY)");
    db.exec("INSERT INTO memory_events(id) VALUES (4), (11)");
  } finally {
    db.close();
  }

  try {
    const result = spawnSync(process.execPath, ["-e", match[1], dbPath], {
      encoding: "utf8",
      env: process.env,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout, "11");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Q6-D3 packet is bound to source commit, stage, clean HEAD and Node24", () => {
  assert.match(PACKET, /D3_SOURCE_COMMIT="24e7daa958c6b589fe273937e0edf53912716228"/);
  assert.match(PACKET, /EXPECTED_STAGE_SHA="[a-f0-9]{64}"/);
  assert.match(PACKET, /HEAD_NOT_PACKET_COMMIT/);
  assert.match(PACKET, /DIRTY_WORKTREE/);
  assert.match(PACKET, /merge-base --is-ancestor "\$D3_SOURCE_COMMIT" "\$HEAD"/);
  assert.match(PACKET, /NODE="\$HOME\/\.local\/node24\/bin\/node"/);
  assert.match(PACKET, /2026\.7\.1-2/);
});

test("Q6-D3 authority is exact stable-key only", () => {
  assert.match(
    PACKET,
    /AUTHORIZED_SESSION_KEY="agent:main:explicit:d31f1b79-d9cb-476a-8d4e-f70f892b1500"/,
  );
  assert.match(PACKET, /SESSION_KEY="\$Q6_D3_SESSION_KEY"/);
  assert.match(PACKET, /SESSION_KEY_NOT_AUTHORIZED/);
  assert.match(PACKET, /resolve_current_runtime_session_id/);
  assert.match(PACKET, /\.key == \$key/);
  assert.doesNotMatch(PACKET, /AUTHORIZED_SESSION_ID=/);
});

test("Q6-D3 packet permits exactly one forward install and one rollback install", () => {
  assert.match(PACKET, /MAX_FORWARD_INSTALLS=1/);
  assert.match(PACKET, /MAX_ROLLBACK_INSTALLS=1/);

  const installs = [...PACKET.matchAll(/oc plugins install /g)];
  assert.equal(installs.length, 2);
  assert.match(PACKET, /oc plugins install "\$REPO" --force/);
  assert.match(PACKET, /oc plugins install "\$ROLLBACK_SNAPSHOT" --force/);
  assert.doesNotMatch(PACKET, /plugins registry --refresh|doctor --fix|plugins install .*--link/);
});

test("Q6-D3 preflight proves old installed runtime and D3 repo source before consumption", () => {
  assert.match(PACKET, /repo_d3_hashes/);
  assert.match(PACKET, /installed_old_hashes/);
  assert.match(PACKET, /registry_repo_hash_ok "\$PRE_REGISTRY" "\$OLD_MANIFEST_SHA"/);
  assert.match(PACKET, /rollback_snapshot_manifest/);
  assert.match(PACKET, /rollback_snapshot_lifecycle/);
  assert.match(PACKET, /rollback_snapshot_shadow/);

  const pass = PACKET.indexOf('log "PREFLIGHT_PASS');
  const consumed = PACKET.indexOf('log "EXECUTION_COUNT_CONSUMED=1"');
  assert.ok(pass > 0);
  assert.ok(consumed > pass);
});

test("Q6-D3 publishes source before enabling exact stable-key shadow", () => {
  const install = PACKET.indexOf('oc plugins install "$REPO" --force');
  const installedCheck = PACKET.indexOf("installed_d3_hashes", install);
  const patch = PACKET.indexOf(".config.autoRecall.shadow =", installedCheck);
  const validate = PACKET.indexOf('oc config validate --json >>"$LOG" 2>&1', patch);
  const start = PACKET.indexOf('oc gateway start >>"$LOG" 2>&1', validate);

  assert.ok(install > 0);
  assert.ok(installedCheck > install);
  assert.ok(patch > installedCheck);
  assert.ok(validate > patch);
  assert.ok(start > validate);
  assert.match(PACKET, /sessionAllowlist:\[\$key\]/);
  assert.match(PACKET, /SHADOW_ACTIVE key=\$SESSION_KEY runtime_session_id=\$CURRENT_SESSION_ID/);
});

test("Q6-D3 evidence follows runtime session-id rotation under one stable key", () => {
  assert.match(PACKET, /runtime-session-ids\.txt/);
  assert.match(PACKET, /append_runtime_session_id/);
  assert.match(PACKET, /args\+=\(--session-id "\$sid"\)/);
  assert.match(PACKET, /CURRENT_SESSION_ID="\$\(resolve_current_runtime_session_id\)"/);
  assert.match(PACKET, /runtime_ids=\$RID_COUNT/);
  assert.match(PACKET, /MAX_TURNS=6/);
  assert.match(PACKET, /STOP no_new_shadow_decision/);
  assert.match(PACKET, /STOP ambiguous_shadow_decisions/);
});

test("Q6-D3 closeout keeps qualified D3 default-off; pre-active failures can rollback old runtime", () => {
  assert.match(PACKET, /closeout_d3_default_off/);
  assert.match(PACKET, /cp "\$POST_INSTALL_CONFIG" "\$CONFIG_PATH"/);
  assert.match(PACKET, /installed_d3_hashes/);
  assert.match(PACKET, /ROLLBACK_BEGIN/);
  assert.match(PACKET, /installed_old_hashes/);
  assert.match(PACKET, /ROLLBACK_PASS/);
  assert.match(PACKET, /trap on_exit EXIT INT TERM/);
});

test("Q6-D3 never directly mutates memory databases or registry state", () => {
  assert.doesNotMatch(
    PACKET,
    /sqlite3|UPDATE installed_plugin_index|INSERT INTO installed_plugin_index|DELETE FROM installed_plugin_index/,
  );
  assert.doesNotMatch(PACKET, /memory_engine_search|memory_engine_get|memory_engine\.add/);
});

test("Q6-D3 result vocabulary preserves evidence limits", () => {
  assert.match(PACKET, /OUTCOME="PASS"/);
  assert.match(PACKET, /OUTCOME="INSUFFICIENT_EVIDENCE"/);
  assert.match(PACKET, /OUTCOME="PASS_WITH_FINDINGS"/);
  assert.match(PACKET, /memory_engine_q6_d3_stable_session_key_transaction_result_v1/);
  assert.match(PACKET, /observed_runtime_session_ids/);
});
