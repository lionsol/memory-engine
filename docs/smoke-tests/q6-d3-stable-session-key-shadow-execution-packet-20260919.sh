#!/usr/bin/env bash
set -Eeuo pipefail

# Q6-D3 stable-session-key deployment + real-host shadow observation.
# OWNER-AUTHORIZED ONE-SHOT PACKET.
# Authorization is non-reusable after the explicit execution-consumed boundary.
EXECUTION_AUTHORIZED=true

REPO="$HOME/.openclaw/workspace/plugins/memory-engine"
STAGE_REL="docs/smoke-tests/q6-d3-stable-session-key-shadow-stage-card-20260919.md"
STAGE="$REPO/$STAGE_REL"
PACKET_REL="docs/smoke-tests/q6-d3-stable-session-key-shadow-execution-packet-20260919.sh"
PACKET="$REPO/$PACKET_REL"
EXPECTED_STAGE_SHA="75b86fbb4e7830e1d02ffea1fd27edc7675f882521c38fecaea913996e7e302f"
D3_SOURCE_COMMIT="24e7daa958c6b589fe273937e0edf53912716228"

NODE="$HOME/.local/node24/bin/node"
OPENCLAW_JS="$HOME/.local/lib/node_modules/openclaw/dist/index.js"
CONFIG_PATH="$HOME/.openclaw/openclaw.json"
ENGINE_DB="$HOME/.openclaw/memory/memory-engine/memory-engine.sqlite"
STATE_DB="$HOME/.openclaw/state/openclaw.sqlite"
INSTALL_PATH="$HOME/.openclaw/extensions/memory-engine"
BACKUP_ROOT="$HOME/.openclaw/backups/memory-engine/q6-d3"
EVIDENCE_ROOT="$HOME/.openclaw/backups/memory-engine/qualification-evidence"
REGISTRY_HELPER="$REPO/bin/q6-r1-registry-evidence.js"
EVIDENCE_HELPER="$REPO/bin/q6-shadow-runtime-evidence.js"
CONFIG_EQ="$REPO/bin/build-config-semantic-equivalence-report.js"

OLD_MANIFEST_SHA="0ea09bfea5bb5d1f3532ed22c9e0ae9c1cfe64abd785f00a1458b8481b0b0a27"
OLD_LIFECYCLE_SHA="9baa225f9a94752c94aec6fae92d9e663219a0565ecd0dec2aa35807b6815aa0"
OLD_SHADOW_SHA="ee913beacc1b1ac103283846a82c0e19252240b9faa3e628e4acc21f3173ceef"
D3_MANIFEST_SHA="4cee6de6ff2d44a3b043a1797580c6ffe2a44cf7f59d8d7835c1a774b0f635e5"
CONFIG_SHA="61ffb77fead2f4e83265af4d6c7eb28d247c8562ea6771f7fc03fa3df3b2bfb6"
D3_LIFECYCLE_SHA="3adf5a4e1d12ee1b52a805431f6213097d8d9d4ca624fba335652984865ff070"
D3_SHADOW_SHA="5566d2f1f231c09e964eb3f9217e5260122568f6ac18fd8adec6d5389f21c01f"
D3_EVIDENCE_HELPER_SHA="4455657e0ffcf500e2a91e7952c5efac84ffd125199a518b6bcf3e509a311814"

MAX_EXECUTIONS=1
MAX_TURNS=6
MAX_FORWARD_INSTALLS=1
MAX_ROLLBACK_INSTALLS=1
AUTHORIZED_SESSION_KEY="agent:main:explicit:d31f1b79-d9cb-476a-8d4e-f70f892b1500"

if [ "$EXECUTION_AUTHORIZED" != "true" ]; then
  echo "STOP=Q6_D3_RUNTIME_NOT_AUTHORIZED"
  exit 64
fi

SESSION_KEY="$Q6_D3_SESSION_KEY"

TX_ID=""
TX_ROOT=""
ROLLBACK_SNAPSHOT=""
EVIDENCE_DIR=""
LOG=""
RESULT=""
PRE_CONFIG=""
POST_INSTALL_CONFIG=""
SHADOW_CONFIG=""
PRE_REGISTRY=""
POST_INSTALL_REGISTRY=""
ACTIVE_REGISTRY=""
FINAL_REGISTRY=""
FINAL_EVIDENCE=""
CONFIG_REPORT=""
RUNTIME_IDS=""
BASE_EVENT_ID=""
BASE_SOURCE=""

TURN_COUNT=0
EXECUTION_CONSUMED=0
INSTALL_MUTATED=0
SHADOW_ACTIVE_REACHED=0
CLOSEOUT_ATTEMPTED=0
CLOSEOUT_OK=false
ROLLBACK_ATTEMPTED=0
FINAL_WRITTEN=0

sha() {
  sha256sum "$1" | awk '{print $1}'
}

oc() {
  "$NODE" "$OPENCLAW_JS" "$@"
}

log() {
  local line
  line="$(date -Is) $*"
  printf '%s\n' "$line" | tee -a "$LOG"
}

inspect() {
  oc plugins inspect memory-engine --json 2>/dev/null
}

source_path() {
  inspect | jq -r '.install.sourcePath // empty'
}

install_path_from_host() {
  inspect | jq -r '.install.installPath // empty'
}

gateway_ready() {
  local out
  out="$(oc gateway status 2>&1 || true)"
  grep -q '^Runtime: running' <<<"$out" &&
  grep -q '^Connectivity probe: ok' <<<"$out"
}

poll_ready() {
  for _ in $(seq 1 20); do
    gateway_ready && return 0
    sleep 2
  done
  return 1
}

repo_d3_hashes() {
  [ "$(sha "$REPO/openclaw.plugin.json")" = "$D3_MANIFEST_SHA" ] &&
  [ "$(sha "$REPO/lib/config/effective-hybrid-runtime-config.js")" = "$CONFIG_SHA" ] &&
  [ "$(sha "$REPO/lib/recall/auto-recall-hook-lifecycle.js")" = "$D3_LIFECYCLE_SHA" ] &&
  [ "$(sha "$REPO/lib/recall/auto-recall-shadow.js")" = "$D3_SHADOW_SHA" ] &&
  [ "$(sha "$EVIDENCE_HELPER")" = "$D3_EVIDENCE_HELPER_SHA" ]
}

installed_old_hashes() {
  [ "$(sha "$INSTALL_PATH/openclaw.plugin.json")" = "$OLD_MANIFEST_SHA" ] &&
  [ "$(sha "$INSTALL_PATH/lib/config/effective-hybrid-runtime-config.js")" = "$CONFIG_SHA" ] &&
  [ "$(sha "$INSTALL_PATH/lib/recall/auto-recall-hook-lifecycle.js")" = "$OLD_LIFECYCLE_SHA" ] &&
  [ "$(sha "$INSTALL_PATH/lib/recall/auto-recall-shadow.js")" = "$OLD_SHADOW_SHA" ]
}

installed_d3_hashes() {
  [ "$(sha "$INSTALL_PATH/openclaw.plugin.json")" = "$D3_MANIFEST_SHA" ] &&
  [ "$(sha "$INSTALL_PATH/lib/config/effective-hybrid-runtime-config.js")" = "$CONFIG_SHA" ] &&
  [ "$(sha "$INSTALL_PATH/lib/recall/auto-recall-hook-lifecycle.js")" = "$D3_LIFECYCLE_SHA" ] &&
  [ "$(sha "$INSTALL_PATH/lib/recall/auto-recall-shadow.js")" = "$D3_SHADOW_SHA" ]
}

config_invariants() {
  jq -e '
    .plugins.entries["memory-engine"].config as $c |
    $c.autoRecall.enabled == true and
    $c.autoRecall.topK == 3 and
    $c.autoRecall.cardFirstRuntime.enabled == true and
    $c.autoRecall.agentAllowlist == ["main"] and
    (($c.autoRecall.sessionAllowlist // []) == []) and
    $c.autoRecall.triggerAllowlist == ["user"] and
    $c.autoRecall.chatTypeAllowlist == ["interactive_user_chat"] and
    $c.autoRecall.messageRoleAllowlist == ["user"] and
    (($c.autoRecall.shadow // {enabled:false}).enabled != true) and
    $c.explicitSearchRerankProvider.enabled == true and
    $c.explicitSearchRerankControl.enabled == false and
    (($c.recallHintRuntimeCanary // null) == null or
      (($c.recallHintRuntimeCanary.enabled // false) != true))
  ' "$1" >/dev/null
}

shadow_scope_exact_key() {
  jq -e --arg key "$SESSION_KEY" '
    .plugins.entries["memory-engine"].config.autoRecall.shadow ==
      {enabled:true,sessionAllowlist:[$key]}
  ' "$1" >/dev/null
}

normalized_without_shadow_sha() {
  jq -S 'del(.plugins.entries["memory-engine"].config.autoRecall.shadow)' "$1" |
    sha256sum | awk '{print $1}'
}

registry_evidence() {
  local out="$1"
  "$NODE" "$REGISTRY_HELPER" --db "$STATE_DB" --plugin-id memory-engine --json >"$out"
  chmod 600 "$out"
}

registry_repo_hash_ok() {
  local file="$1"
  local manifest_hash="$2"
  jq -e --arg repo "$REPO" --arg install "$INSTALL_PATH" --arg hash "$manifest_hash" '
    .index_found == true and
    .plugin_metadata_match_count == 1 and
    .install_record.source == "path" and
    .install_record.sourcePath == $repo and
    .install_record.installPath == $install and
    .install_record.version == "1.0.0" and
    .plugin_metadata.pluginId == "memory-engine" and
    .plugin_metadata.manifestPath == ($install + "/openclaw.plugin.json") and
    .plugin_metadata.manifestHash == $hash and
    .plugin_metadata.rootDir == $install and
    .plugin_metadata.enabled == true and
    .plugin_metadata.packageVersion == "1.0.0"
  ' "$file" >/dev/null
}

registry_manifest_ok() {
  local file="$1"
  local manifest_hash="$2"
  jq -e --arg install "$INSTALL_PATH" --arg hash "$manifest_hash" '
    .index_found == true and
    .plugin_metadata_match_count == 1 and
    .install_record.source == "path" and
    .install_record.installPath == $install and
    .install_record.version == "1.0.0" and
    .plugin_metadata.pluginId == "memory-engine" and
    .plugin_metadata.manifestPath == ($install + "/openclaw.plugin.json") and
    .plugin_metadata.manifestHash == $hash and
    .plugin_metadata.rootDir == $install and
    .plugin_metadata.enabled == true and
    .plugin_metadata.packageVersion == "1.0.0"
  ' "$file" >/dev/null
}

config_semantic_pass() {
  local before="$1"
  local after="$2"
  local out="$3"
  "$NODE" "$CONFIG_EQ" --before "$before" --after "$after" --pretty --out "$out"
  jq -e '
    .policy == "memory-engine-config-semantic-equivalence-v1" and
    .valid == true and
    (.status == "exact_equal" or .status == "approved_host_metadata_change")
  ' "$out" >/dev/null
}

max_event_id() {
  "$NODE" -e 'const {DatabaseSync}=require("node:sqlite"); const db=new DatabaseSync(process.argv[1],{readOnly:true}); try{process.stdout.write(String(Number(db.prepare("SELECT COALESCE(MAX(id),0) id FROM memory_events").get().id||0)))}finally{db.close()}' "$ENGINE_DB"
}

resolve_current_runtime_session_id() {
  local raw
  raw="$(oc sessions --agent main --json 2>/dev/null)"
  jq -r --arg key "$SESSION_KEY" '
    (
      if type == "array" then .
      elif ((.sessions? | type) == "array") then .sessions
      else []
      end
    )
    | map(select(
        (type == "object") and
        .key == $key and
        (.sessionId | type) == "string" and
        (.sessionId | length) > 0
      ))
    | if length == 1 then .[0].sessionId else empty end
  ' <<<"$raw"
}

append_runtime_session_id() {
  local value="$1"
  [ -n "$value" ] || return 1
  grep -Fxq "$value" "$RUNTIME_IDS" 2>/dev/null && return 0
  printf '%s\n' "$value" >>"$RUNTIME_IDS"
}

runtime_id_count() {
  grep -cve '^$' "$RUNTIME_IDS" || true
}

collect_evidence() {
  local turns="$1"
  local args=("$EVIDENCE_HELPER" --db "$ENGINE_DB" --since-id "$BASE_EVENT_ID")
  local sid
  while IFS= read -r sid; do
    [ -n "$sid" ] && args+=(--session-id "$sid")
  done <"$RUNTIME_IDS"
  args+=(--turns-sent "$turns" --json)
  "$NODE" "${args[@]}" >"$FINAL_EVIDENCE"
  chmod 600 "$FINAL_EVIDENCE"
}

write_result() {
  local outcome="$1"
  local reason="$2"
  [ "$FINAL_WRITTEN" -eq 0 ] || return 0
  [ -n "$RESULT" ] || return 0
  [ -d "$EVIDENCE_DIR" ] || return 0
  local ids_json="[]"
  if [ -f "$RUNTIME_IDS" ]; then
    ids_json="$(jq -R -s 'split("\n") | map(select(length > 0))' "$RUNTIME_IDS")"
  fi
  jq -n     --arg outcome "$outcome"     --arg reason "$reason"     --arg key "$SESSION_KEY"     --arg base "$BASE_SOURCE"     --argjson ids "$ids_json"     --argjson consumed "$EXECUTION_CONSUMED"     --argjson turns "$TURN_COUNT"     --argjson closeout "$CLOSEOUT_OK"     --argjson rollback "$ROLLBACK_ATTEMPTED"     '{
      schema:"memory_engine_q6_d3_stable_session_key_transaction_result_v1",
      outcome:$outcome,
      reason:$reason,
      session_key:$key,
      observed_runtime_session_ids:$ids,
      base_source:$base,
      execution_count_consumed:$consumed,
      max_executions:1,
      max_forward_installs:1,
      max_rollback_installs:1,
      max_turns:6,
      turns_sent:$turns,
      rollback_attempted:$rollback,
      closeout_ok:$closeout
    }' >"$RESULT"
  chmod 600 "$RESULT"
  FINAL_WRITTEN=1
}

write_failure_result() {
  local reason="$1"
  local outcome="STOPPED_PREACTIVATION"
  if [ "$EXECUTION_CONSUMED" -eq 1 ]; then
    outcome="STOPPED"
  fi
  write_result "$outcome" "$reason"
}

closeout_d3_default_off() {
  [ "$EXECUTION_CONSUMED" -eq 1 ] || return 0
  [ "$CLOSEOUT_ATTEMPTED" -eq 0 ] || return 1
  CLOSEOUT_ATTEMPTED=1
  log "CLOSEOUT_BEGIN"

  oc gateway stop >>"$LOG" 2>&1 || true
  cp "$POST_INSTALL_CONFIG" "$CONFIG_PATH"

  oc config validate --json >>"$LOG" 2>&1 ||
    { log "CLOSEOUT_FAIL config_validate"; return 1; }
  oc gateway start >>"$LOG" 2>&1 ||
    { log "CLOSEOUT_FAIL gateway_start"; return 1; }
  poll_ready || { log "CLOSEOUT_FAIL gateway_not_ready"; return 1; }

  [ "$(sha "$CONFIG_PATH")" = "$(sha "$POST_INSTALL_CONFIG")" ] ||
    { log "CLOSEOUT_FAIL config_sha"; return 1; }
  config_invariants "$CONFIG_PATH" ||
    { log "CLOSEOUT_FAIL config_invariants"; return 1; }
  [ "$(source_path)" = "$REPO" ] ||
    { log "CLOSEOUT_FAIL source_path"; return 1; }
  [ "$(install_path_from_host)" = "$INSTALL_PATH" ] ||
    { log "CLOSEOUT_FAIL install_path"; return 1; }
  repo_d3_hashes && installed_d3_hashes ||
    { log "CLOSEOUT_FAIL d3_hashes"; return 1; }

  registry_evidence "$FINAL_REGISTRY"
  registry_repo_hash_ok "$FINAL_REGISTRY" "$D3_MANIFEST_SHA" ||
    { log "CLOSEOUT_FAIL registry"; return 1; }

  CLOSEOUT_OK=true
  log "CLOSEOUT_PASS"
  return 0
}

rollback_old_runtime() {
  [ "$ROLLBACK_ATTEMPTED" -eq 0 ] || return 1
  ROLLBACK_ATTEMPTED=1
  CLOSEOUT_ATTEMPTED=1
  log "ROLLBACK_BEGIN"

  oc gateway stop >>"$LOG" 2>&1 || true
  oc plugins install "$ROLLBACK_SNAPSHOT" --force >>"$LOG" 2>&1 ||
    { log "ROLLBACK_FAIL install"; return 1; }
  cp "$PRE_CONFIG" "$CONFIG_PATH"
  oc config validate --json >>"$LOG" 2>&1 ||
    { log "ROLLBACK_FAIL config_validate"; return 1; }
  oc gateway start >>"$LOG" 2>&1 ||
    { log "ROLLBACK_FAIL gateway_start"; return 1; }
  poll_ready || { log "ROLLBACK_FAIL gateway_not_ready"; return 1; }

  installed_old_hashes ||
    { log "ROLLBACK_FAIL installed_old_hashes"; return 1; }
  config_invariants "$CONFIG_PATH" ||
    { log "ROLLBACK_FAIL config_invariants"; return 1; }

  registry_evidence "$FINAL_REGISTRY"
  registry_manifest_ok "$FINAL_REGISTRY" "$OLD_MANIFEST_SHA" ||
    { log "ROLLBACK_FAIL registry"; return 1; }

  CLOSEOUT_OK=true
  log "ROLLBACK_PASS"
  return 0
}

restore_preinstall_state() {
  CLOSEOUT_ATTEMPTED=1
  if ! gateway_ready; then
    oc gateway start >>"$LOG" 2>&1 || return 1
    poll_ready || return 1
  fi
  [ "$(sha "$CONFIG_PATH")" = "$(sha "$PRE_CONFIG")" ] || return 1
  config_invariants "$CONFIG_PATH" || return 1
  CLOSEOUT_OK=true
  return 0
}

on_exit() {
  local rc=$?
  trap - EXIT INT TERM

  if [ "$EXECUTION_CONSUMED" -eq 1 ] && [ "$CLOSEOUT_ATTEMPTED" -eq 0 ]; then
    if [ "$SHADOW_ACTIVE_REACHED" -eq 1 ]; then
      closeout_d3_default_off || rc=1
    elif [ "$INSTALL_MUTATED" -eq 1 ]; then
      rollback_old_runtime || rc=1
    else
      restore_preinstall_state || rc=1
    fi
  fi

  if [ "$rc" -ne 0 ]; then
    write_failure_result "see_transaction_log"
  fi
  exit "$rc"
}
trap on_exit EXIT INT TERM

for cmd in jq git sha256sum awk cp chmod mkdir date grep tee seq sleep; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "STOP=MISSING_$cmd"; exit 1; }
done
[ -x "$NODE" ] || { echo "STOP=NODE24_MISSING"; exit 1; }
[ -f "$OPENCLAW_JS" ] || { echo "STOP=OPENCLAW_JS_MISSING"; exit 1; }
[ -f "$CONFIG_PATH" ] || { echo "STOP=CONFIG_MISSING"; exit 1; }
[ -f "$ENGINE_DB" ] || { echo "STOP=ENGINE_DB_MISSING"; exit 1; }
[ -f "$STATE_DB" ] || { echo "STOP=STATE_DB_MISSING"; exit 1; }
[ -d "$INSTALL_PATH" ] || { echo "STOP=INSTALL_PATH_MISSING"; exit 1; }
[ -n "$SESSION_KEY" ] || { echo "STOP=SESSION_KEY_MISSING"; exit 1; }
[ "$SESSION_KEY" = "$AUTHORIZED_SESSION_KEY" ] || { echo "STOP=SESSION_KEY_NOT_AUTHORIZED"; exit 1; }
[ "$SESSION_KEY" != "agent:main:main" ] || { echo "STOP=DEFAULT_SESSION_FORBIDDEN"; exit 1; }
case "$SESSION_KEY" in
  agent:main:*) ;;
  *) echo "STOP=SESSION_KEY_NOT_MAIN"; exit 1 ;;
esac

HEAD="$(git -C "$REPO" rev-parse HEAD)"
PACKET_COMMIT="$(git -C "$REPO" log -1 --format=%H -- "$PACKET_REL")"
[ "$HEAD" = "$PACKET_COMMIT" ] || { echo "STOP=HEAD_NOT_PACKET_COMMIT"; exit 1; }
[ -z "$(git -C "$REPO" status --porcelain)" ] || { echo "STOP=DIRTY_WORKTREE"; exit 1; }
git -C "$REPO" merge-base --is-ancestor "$D3_SOURCE_COMMIT" "$HEAD" ||
  { echo "STOP=D3_SOURCE_NOT_ANCESTOR"; exit 1; }
[ "$(sha "$STAGE")" = "$EXPECTED_STAGE_SHA" ] || { echo "STOP=STAGE_SHA"; exit 1; }
[ "$("$NODE" -p 'process.versions.modules')" = "137" ] || { echo "STOP=NODE_ABI"; exit 1; }
oc --version 2>&1 | grep -q '2026.7.1-2' || { echo "STOP=OPENCLAW_VERSION"; exit 1; }

TX_ID="$(date +%Y%m%dT%H%M%S%z)"
TX_ROOT="$BACKUP_ROOT/$TX_ID"
ROLLBACK_SNAPSHOT="$TX_ROOT/rollback-extension"
EVIDENCE_DIR="$EVIDENCE_ROOT/q6-d3-stable-session-key-$TX_ID"
LOG="$EVIDENCE_DIR/transaction.log"
RESULT="$EVIDENCE_DIR/result.json"
PRE_CONFIG="$EVIDENCE_DIR/openclaw-pre.json"
POST_INSTALL_CONFIG="$EVIDENCE_DIR/openclaw-post-install.json"
SHADOW_CONFIG="$EVIDENCE_DIR/openclaw-shadow.json"
PRE_REGISTRY="$EVIDENCE_DIR/registry-pre.json"
POST_INSTALL_REGISTRY="$EVIDENCE_DIR/registry-post-install.json"
ACTIVE_REGISTRY="$EVIDENCE_DIR/registry-active.json"
FINAL_REGISTRY="$EVIDENCE_DIR/registry-final.json"
FINAL_EVIDENCE="$EVIDENCE_DIR/final-evidence.json"
CONFIG_REPORT="$EVIDENCE_DIR/config-semantic-install.json"
RUNTIME_IDS="$EVIDENCE_DIR/runtime-session-ids.txt"

[ ! -e "$TX_ROOT" ] || { echo "STOP=TX_ROOT_EXISTS"; exit 1; }
[ ! -e "$EVIDENCE_DIR" ] || { echo "STOP=EVIDENCE_EXISTS"; exit 1; }
mkdir -p "$TX_ROOT" "$EVIDENCE_DIR"
chmod 700 "$TX_ROOT" "$EVIDENCE_DIR"
: >"$LOG"
: >"$RUNTIME_IDS"
chmod 600 "$LOG" "$RUNTIME_IDS"

log "PREFLIGHT_BEGIN"

[ "$MAX_EXECUTIONS" -eq 1 ] || { log "STOP max_executions"; exit 1; }
[ "$MAX_TURNS" -eq 6 ] || { log "STOP max_turns"; exit 1; }
[ "$MAX_FORWARD_INSTALLS" -eq 1 ] || { log "STOP max_forward_installs"; exit 1; }
[ "$MAX_ROLLBACK_INSTALLS" -eq 1 ] || { log "STOP max_rollback_installs"; exit 1; }

gateway_ready || { log "STOP gateway_not_ready"; exit 1; }
oc config validate --json >>"$LOG" 2>&1 || { log "STOP config_validate"; exit 1; }

BASE_SOURCE="$(source_path)"
[ "$BASE_SOURCE" = "$REPO" ] || { log "STOP source_path"; exit 1; }
[ "$(install_path_from_host)" = "$INSTALL_PATH" ] || { log "STOP install_path"; exit 1; }
repo_d3_hashes || { log "STOP repo_d3_hashes"; exit 1; }
installed_old_hashes || { log "STOP installed_baseline_hashes"; exit 1; }

registry_evidence "$PRE_REGISTRY"
registry_repo_hash_ok "$PRE_REGISTRY" "$OLD_MANIFEST_SHA" ||
  { log "STOP registry_baseline"; exit 1; }

config_invariants "$CONFIG_PATH" || { log "STOP config_invariants"; exit 1; }

INITIAL_SESSION_ID="$(resolve_current_runtime_session_id)"
[ -n "$INITIAL_SESSION_ID" ] || { log "STOP stable_key_binding"; exit 1; }
append_runtime_session_id "$INITIAL_SESSION_ID"

cp "$CONFIG_PATH" "$PRE_CONFIG"
chmod 600 "$PRE_CONFIG"
BASE_EVENT_ID="$(max_event_id)"
[ "$BASE_EVENT_ID" -ge 0 ] || { log "STOP event_baseline"; exit 1; }

cp -a "$INSTALL_PATH" "$ROLLBACK_SNAPSHOT"
[ "$(sha "$ROLLBACK_SNAPSHOT/openclaw.plugin.json")" = "$OLD_MANIFEST_SHA" ] ||
  { log "STOP rollback_snapshot_manifest"; exit 1; }
[ "$(sha "$ROLLBACK_SNAPSHOT/lib/recall/auto-recall-hook-lifecycle.js")" = "$OLD_LIFECYCLE_SHA" ] ||
  { log "STOP rollback_snapshot_lifecycle"; exit 1; }
[ "$(sha "$ROLLBACK_SNAPSHOT/lib/recall/auto-recall-shadow.js")" = "$OLD_SHADOW_SHA" ] ||
  { log "STOP rollback_snapshot_shadow"; exit 1; }

log "PREFLIGHT_PASS base_event_id=$BASE_EVENT_ID runtime_session_id=$INITIAL_SESSION_ID"

EXECUTION_CONSUMED=1
log "EXECUTION_COUNT_CONSUMED=1"

if ! oc gateway stop >>"$LOG" 2>&1; then
  log "STOP gateway_stop"
  exit 1
fi

INSTALL_MUTATED=1
if ! oc plugins install "$REPO" --force >>"$LOG" 2>&1; then
  log "STOP d3_install"
  exit 1
fi

cp "$CONFIG_PATH" "$POST_INSTALL_CONFIG"
chmod 600 "$POST_INSTALL_CONFIG"

installed_d3_hashes || { log "STOP installed_d3_hashes"; exit 1; }
registry_evidence "$POST_INSTALL_REGISTRY"
registry_repo_hash_ok "$POST_INSTALL_REGISTRY" "$D3_MANIFEST_SHA" ||
  { log "STOP registry_d3"; exit 1; }
config_semantic_pass "$PRE_CONFIG" "$POST_INSTALL_CONFIG" "$CONFIG_REPORT" ||
  { log "STOP install_config_semantics"; exit 1; }
config_invariants "$POST_INSTALL_CONFIG" ||
  { log "STOP post_install_config_invariants"; exit 1; }

jq --arg key "$SESSION_KEY" '
  .plugins.entries["memory-engine"].config.autoRecall.shadow =
    {enabled:true,sessionAllowlist:[$key]}
' "$POST_INSTALL_CONFIG" >"$SHADOW_CONFIG"
chmod 600 "$SHADOW_CONFIG"

[ "$(normalized_without_shadow_sha "$SHADOW_CONFIG")" = "$(normalized_without_shadow_sha "$POST_INSTALL_CONFIG")" ] ||
  { log "STOP patch_unrelated_config"; exit 1; }
shadow_scope_exact_key "$SHADOW_CONFIG" ||
  { log "STOP shadow_candidate_scope"; exit 1; }

cp "$SHADOW_CONFIG" "$CONFIG_PATH"
oc config validate --json >>"$LOG" 2>&1 ||
  { log "STOP shadow_config_validate"; exit 1; }

oc gateway start >>"$LOG" 2>&1 ||
  { log "STOP shadow_gateway_start"; exit 1; }
poll_ready || { log "STOP shadow_gateway_not_ready"; exit 1; }

[ "$(source_path)" = "$REPO" ] || { log "STOP source_path_changed"; exit 1; }
[ "$(install_path_from_host)" = "$INSTALL_PATH" ] || { log "STOP install_path_changed"; exit 1; }
repo_d3_hashes || { log "STOP repo_d3_hash_changed"; exit 1; }
installed_d3_hashes || { log "STOP install_d3_hash_changed"; exit 1; }

registry_evidence "$ACTIVE_REGISTRY"
registry_repo_hash_ok "$ACTIVE_REGISTRY" "$D3_MANIFEST_SHA" ||
  { log "STOP registry_changed"; exit 1; }

shadow_scope_exact_key "$CONFIG_PATH" || { log "STOP shadow_scope"; exit 1; }

SHADOW_ACTIVE_REACHED=1
CURRENT_SESSION_ID="$(resolve_current_runtime_session_id)"
[ -n "$CURRENT_SESSION_ID" ] || { log "STOP active_key_binding"; exit 1; }
append_runtime_session_id "$CURRENT_SESSION_ID"
log "SHADOW_ACTIVE key=$SESSION_KEY runtime_session_id=$CURRENT_SESSION_ID"

[ -r /dev/tty ] || { log "STOP tty_unavailable"; exit 1; }

PREV=0
for SLOT in $(seq 1 "$MAX_TURNS"); do
  printf '\nQ6-D3 %s/%s: send ONE genuine natural turn in the bound OpenClaw chat, then press ENTER here; type :finish to stop.\n> ' "$SLOT" "$MAX_TURNS" >/dev/tty
  IFS= read -r OP </dev/tty

  if [ "$OP" = ":finish" ]; then
    break
  fi
  [ -z "$OP" ] || { log "STOP unexpected_operator_input"; exit 1; }

  TURN_COUNT=$((TURN_COUNT + 1))
  FOUND=0
  CUR="$PREV"

  for _ in $(seq 1 15); do
    CURRENT_SESSION_ID="$(resolve_current_runtime_session_id)"
    [ -n "$CURRENT_SESSION_ID" ] && append_runtime_session_id "$CURRENT_SESSION_ID"
    collect_evidence "$TURN_COUNT"
    CUR="$(jq -r '.shadow_decisions // 0' "$FINAL_EVIDENCE")"
    if [ "$CUR" -gt "$PREV" ]; then
      FOUND=1
      break
    fi
    sleep 1
  done

  [ "$FOUND" -eq 1 ] || { log "STOP no_new_shadow_decision"; exit 1; }
  [ "$CUR" -eq $((PREV + 1)) ] || { log "STOP ambiguous_shadow_decisions"; exit 1; }

  PREV="$CUR"
  collect_evidence "$TURN_COUNT"

  V="$(jq -r '.violations | length' "$FINAL_EVIDENCE")"
  F="$(jq -r '.foreign_q6_shadow_decision_count' "$FINAL_EVIDENCE")"
  I="$(jq -r '.memory_injected_on_shadow_trace_count' "$FINAL_EVIDENCE")"
  R="$(jq -r '.memory_reinforced_on_shadow_trace_count' "$FINAL_EVIDENCE")"
  RID_COUNT="$(runtime_id_count)"

  log "TURN slot=$SLOT decisions=$CUR violations=$V foreign=$F injected=$I reinforced=$R runtime_ids=$RID_COUNT"

  [ "$V" -eq 0 ] && [ "$F" -eq 0 ] && [ "$I" -eq 0 ] && [ "$R" -eq 0 ] ||
    { log "STOP mechanism_or_scope_violation"; exit 1; }
done

collect_evidence "$TURN_COUNT"

DECISIONS="$(jq -r '.shadow_decisions // 0' "$FINAL_EVIDENCE")"
SEARCHED="$(jq -r '.search_executed // 0' "$FINAL_EVIDENCE")"
VIOLATIONS="$(jq -r '.violations | length' "$FINAL_EVIDENCE")"
FOREIGN="$(jq -r '.foreign_q6_shadow_decision_count' "$FINAL_EVIDENCE")"
INJECTED="$(jq -r '.memory_injected_on_shadow_trace_count' "$FINAL_EVIDENCE")"
REINFORCED="$(jq -r '.memory_reinforced_on_shadow_trace_count' "$FINAL_EVIDENCE")"
BOUNDARY_ERRORS="$(jq -r '[.direct_card_boundary_error_counts[]?] | add // 0' "$FINAL_EVIDENCE")"

[ "$DECISIONS" -eq "$TURN_COUNT" ] || { log "STOP final_decision_count"; exit 1; }
[ "$VIOLATIONS" -eq 0 ] || { log "STOP final_violations"; exit 1; }
[ "$FOREIGN" -eq 0 ] || { log "STOP final_foreign"; exit 1; }
[ "$INJECTED" -eq 0 ] || { log "STOP final_injected"; exit 1; }
[ "$REINFORCED" -eq 0 ] || { log "STOP final_reinforced"; exit 1; }

OUTCOME="PASS"
if [ "$TURN_COUNT" -eq 0 ] || [ "$SEARCHED" -eq 0 ]; then
  OUTCOME="INSUFFICIENT_EVIDENCE"
elif [ "$BOUNDARY_ERRORS" -gt 0 ]; then
  OUTCOME="PASS_WITH_FINDINGS"
fi

closeout_d3_default_off || { log "STOP closeout_failed"; exit 1; }
write_result "$OUTCOME" "observation_complete"

RID_COUNT="$(runtime_id_count)"
log "TRANSACTION_RESULT outcome=$OUTCOME turns=$TURN_COUNT runtime_ids=$RID_COUNT"
trap - EXIT INT TERM
exit 0
