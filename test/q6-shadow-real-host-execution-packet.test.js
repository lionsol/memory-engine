import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const PACKET = readFileSync(
  new URL("../docs/smoke-tests/q6-shadow-autorecall-exact-session-real-host-execution-packet-20260919.sh", import.meta.url),
  "utf8",
);

test("Q6-D execution packet stays one-shot and exact-session bounded", () => {
  assert.match(PACKET, /Q6_SOURCE="4f79a8c78fb68bb92294ea78a755293c8b62cbc4"/);
  assert.match(PACKET, /STAGE_SHA="[a-f0-9]{64}"/);
  assert.match(PACKET, /MAX_TURNS=6/);
  assert.match(PACKET, /CONFIG_PATH="\$HOME\/\.openclaw\/openclaw\.json"/);
  assert.match(PACKET, /q6-shadow-autorecall-exact-session-20260919-r5/);
  assert.doesNotMatch(PACKET, /config file/);
  assert.match(PACKET, /Q6_SESSION_ID/);
  assert.match(PACKET, /Q6_SESSION_KEY/);
  assert.match(PACKET, /SESSION_KEY.*agent:main:main/);
  assert.match(PACKET, /sessionAllowlist:\[\$sid\]/);
  assert.match(PACKET, /elif \(\(\.sessions\? \| type\) == "array"\) then \.sessions/);
  assert.match(PACKET, /\.sessionId == \$sid and \.key == \$key/);
  assert.match(PACKET, /autoRecall\.topK == 3/);
  assert.match(PACKET, /cardFirstRuntime\.enabled == true/);
});

test("Q6-D packet max_event_id node snippet executes against readonly SQLite", () => {
  const match = PACKET.match(
    /max_event_id\(\) \{\n  "\$NODE" -e '([\s\S]*?)' "\$ENGINE_DB"\n\}/,
  );
  assert.ok(match, "max_event_id node snippet must be extractable");

  const dir = mkdtempSync(join(tmpdir(), "q6-max-event-id-"));
  const dbPath = join(dir, "engine.sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("CREATE TABLE memory_events (id INTEGER PRIMARY KEY)");
    db.exec("INSERT INTO memory_events (id) VALUES (2), (7), (5)");
  } finally {
    db.close();
  }

  try {
    const result = spawnSync(process.execPath, ["-e", match[1], dbPath], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "7");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Q6-D packet binds the already-active repo Q6 runtime and performs no install", () => {
  assert.match(PACKET, /\[ "\$BASE_SOURCE" = "\$REPO" \]/);
  assert.match(PACKET, /q6_hashes "\$BASE_SOURCE"/);
  assert.doesNotMatch(PACKET, /overlay\(/);
  assert.doesNotMatch(PACKET, /plugins install/);
  assert.doesNotMatch(PACKET, /CANDIDATE=/);
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
  assert.match(PACKET, /cp "\$PRE_CONFIG" "\$CONFIG_PATH"/);
  assert.match(PACKET, /\[ "\$BASE_SOURCE" = "\$REPO" \] \|\| return 1/);
  assert.match(PACKET, /q6_hashes "\$BASE_SOURCE" \|\| return 1/);
  assert.match(PACKET, /write_stopped_result\(\)/);
  assert.match(PACKET, /outcome:"STOPPED"/);
  assert.match(PACKET, /trap .*closeout.*write_stopped_result/);
});

test("Q6-D packet is self-bound to the commit that contains it", () => {
  assert.match(PACKET, /PACKET_COMMIT=.*git -C "\$REPO" log -1 --format=%H -- "\$PACKET_REL"/);
  assert.match(PACKET, /HEAD.*PACKET_COMMIT/);
  assert.match(PACKET, /dirty_worktree/);
});
