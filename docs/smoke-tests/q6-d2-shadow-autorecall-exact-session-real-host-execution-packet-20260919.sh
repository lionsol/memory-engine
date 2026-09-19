#!/usr/bin/env bash
set -Eeuo pipefail

# Q6-D2 exact-session real-host shadow observation.
# Source-qualified only. Runtime execution remains disabled until a separate Owner
# authorization flips this literal gate in a new committed revision.
EXECUTION_AUTHORIZED=false

REPO="$HOME/.openclaw/workspace/plugins/memory-engine"
STAGE_REL="docs/smoke-tests/q6-d2-shadow-autorecall-exact-session-real-host-stage-card-20260919.md"
STAGE="$REPO/$STAGE_REL"
PACKET_REL="docs/smoke-tests/q6-d2-shadow-autorecall-exact-session-real-host-execution-packet-20260919.sh"
PACKET="$REPO/$PACKET_REL"
EXPECTED_STAGE_SHA="dab944078af2d17f9003d4b4c9c27da187aedd9a9590ad9db7f87c3f5d460a55"

NODE="$HOME/.local/node24/bin/node"
OPENCLAW_JS="$HOME/.local/lib/node_modules/openclaw/dist/index.js"
CONFIG_PATH="$HOME/.openclaw/openclaw.json"
ENGINE_DB="$HOME/.openclaw/memory/memory-engine/memory-engine.sqlite"
STATE_DB="$HOME/.openclaw/state/openclaw.sqlite"
INSTALL_PATH="$HOME/.openclaw/extensions/memory-engine"
EVIDENCE_ROOT="$HOME/.openclaw/backups/memory-engine/qualification-evidence"
REGISTRY_HELPER="$REPO/bin/q6-r1-registry-evidence.js"
EVIDENCE_HELPER="$REPO/bin/q6-shadow-runtime-evidence.js"

MANIFEST_SHA="0ea09bfea5bb5d1f3532ed22c9e0ae9c1cfe64abd785f00a1458b8481b0b0a27"
CONFIG_SHA="61ffb77fead2f4e83265af4d6c7eb28d247c8562ea6771f7fc03fa3df3b2bfb6"
LIFECYCLE_SHA="9baa225f9a94752c94aec6fae92d9e663219a0565ecd0dec2aa35807b6815aa0"
SHADOW_SHA="ee913beacc1b1ac103283846a82c0e19252240b9faa3e628e4acc21f3173ceef"

MAX_EXECUTIONS=1
MAX_TURNS=6

if [ "$EXECUTION_AUTHORIZED" != "true" ]; then
  echo "STOP=Q6_D2_RUNTIME_NOT_AUTHORIZED"
  exit 64
fi

SESSION_ID="$Q6_D2_SESSION_ID"
SESSION_KEY="$Q6_D2_SESSION_KEY"

TX_ID=""
EVIDENCE_DIR=""
LOG=""
RESULT=""
PRE_CONFIG=""
SHADOW_CONFIG=""
PRE_REGISTRY=""
ACTIVE_REGISTRY=""
FINAL_REGISTRY=""
FINAL_EVIDENCE=""
SESSIONS_PRE=""
BASE_EVENT_ID=""
BASE_SOURCE=""

TURN_COUNT=0
EXECUTION_CONSUMED=0
CLOSEOUT_ATTEMPTED=0
CLOSEOUT_OK=false
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

q6_hashes() {
  local root="$1"
  [ "$(sha "$root/openclaw.plugin.json")" = "$MANIFEST_SHA" ] &&
  [ "$(sha "$root/lib/config/effective-hybrid-runtime-config.js")" = "$CONFIG_SHA" ] &&
  [ "$(sha "$root/lib/recall/auto-recall-hook-lifecycle.js")" = "$LIFECYCLE_SHA" ] &&
  [ "$(sha "$root/lib/recall/auto-recall-shadow.js")" = "$SHADOW_SHA" ]
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

shadow_scope_exact() {
  jq -e --arg sid "$SESSION_ID" '
    .plugins.entries["memory-engine"].config.autoRecall.shadow ==
      {enabled:true,sessionAllowlist:[$sid]}
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

registry_q6_ok() {
  local file="$1"
  jq -e --arg repo "$REPO" --arg install "$INSTALL_PATH" --arg hash "$MANIFEST_SHA" '
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

max_event_id() {
  "$NODE" -e 'const {DatabaseSync}=require("node:sqlite"); const db=new DatabaseSync(process.argv[1],{readOnly:true}); try{process.stdout.write(String(Number(db.prepare("SELECT COALESCE(MAX(id),0) id FROM memory_events").get().id||0))}finally{db.close()}' "$ENGINE_DB"
}

collect_evidence() {
  local turns="$1"
  "$NODE" "$EVIDENCE_HELPER"     --db "$ENGINE_DB"     --since-id "$BASE_EVENT_ID"     --session-id "$SESSION_ID"     --turns-sent "$turns"     --json >"$FINAL_EVIDENCE"
  chmod 600 "$FINAL_EVIDENCE"
}

write_failure_result() {
  local reason="$1"
  [ "$FINAL_WRITTEN" -eq 0 ] || return 0
  [ -n "$RESULT" ] || return 0
  [ -d "$EVIDENCE_DIR" ] || return 0
  local outcome="STOPPED_PREACTIVATION"
  if [ "$EXECUTION_CONSUMED" -eq 1 ]; then
    outcome="STOPPED"
  fi
  jq -n     --arg outcome "$outcome"     --arg reason "$reason"     --arg sid "$SESSION_ID"     --arg base "$BASE_SOURCE"     --argjson consumed "$EXECUTION_CONSUMED"     --argjson turns "$TURN_COUNT"     --argjson closeout "$CLOSEOUT_OK"     '{
      schema:"memory_engine_q6_d2_shadow_autorecall_transaction_result_v1",
      outcome:$outcome,
      reason:$reason,
      session_id:$sid,
      base_source:$base,
      execution_count_consumed:$consumed,
      max_executions:1,
      max_turns:6,
      turns_sent:$turns,
      closeout_ok:$closeout
    }' >"$RESULT"
  chmod 600 "$RESULT"
  FINAL_WRITTEN=1
}

closeout() {
  [ "$EXECUTION_CONSUMED" -eq 1 ] || return 0
  [ "$CLOSEOUT_ATTEMPTED" -eq 0 ] || return 1
  CLOSEOUT_ATTEMPTED=1
  log "CLOSEOUT_BEGIN"

  oc gateway stop >>"$LOG" 2>&1 || true
  cp "$PRE_CONFIG" "$CONFIG_PATH"

  if ! oc config validate --json >>"$LOG" 2>&1; then
    log "CLOSEOUT_FAIL config_validate"
    return 1
  fi

  if ! oc gateway start >>"$LOG" 2>&1; then
    log "CLOSEOUT_FAIL gateway_start"
    return 1
  fi

  if ! poll_ready; then
    log "CLOSEOUT_FAIL gateway_not_ready"
    return 1
  fi

  if [ "$(sha "$CONFIG_PATH")" != "$(sha "$PRE_CONFIG")" ]; then
    log "CLOSEOUT_FAIL config_sha"
    return 1
  fi

  if ! config_invariants "$CONFIG_PATH"; then
    log "CLOSEOUT_FAIL config_invariants"
    return 1
  fi

  if [ "$(source_path)" != "$REPO" ] || [ "$(install_path_from_host)" != "$INSTALL_PATH" ]; then
    log "CLOSEOUT_FAIL host_paths"
    return 1
  fi

  if ! q6_hashes "$REPO" || ! q6_hashes "$INSTALL_PATH"; then
    log "CLOSEOUT_FAIL q6_hashes"
    return 1
  fi

  registry_evidence "$FINAL_REGISTRY"
  if ! registry_q6_ok "$FINAL_REGISTRY"; then
    log "CLOSEOUT_FAIL registry"
    return 1
  fi

  CLOSEOUT_OK=true
  log "CLOSEOUT_PASS"
  return 0
}

on_exit() {
  local rc=$?
  trap - EXIT INT TERM
  if [ "$EXECUTION_CONSUMED" -eq 1 ] && [ "$CLOSEOUT_ATTEMPTED" -eq 0 ]; then
    closeout || rc=1
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
[ -n "$SESSION_ID" ] || { echo "STOP=SESSION_ID_MISSING"; exit 1; }
[ -n "$SESSION_KEY" ] || { echo "STOP=SESSION_KEY_MISSING"; exit 1; }
[ "$SESSION_KEY" != "agent:main:main" ] || { echo "STOP=DEFAULT_SESSION_FORBIDDEN"; exit 1; }
case "$SESSION_KEY" in
  agent:main:*) ;;
  *) echo "STOP=SESSION_KEY_NOT_MAIN"; exit 1 ;;
esac

HEAD="$(git -C "$REPO" rev-parse HEAD)"
PACKET_COMMIT="$(git -C "$REPO" log -1 --format=%H -- "$PACKET_REL")"
[ "$HEAD" = "$PACKET_COMMIT" ] || { echo "STOP=HEAD_NOT_PACKET_COMMIT"; exit 1; }
[ -z "$(git -C "$REPO" status --porcelain)" ] || { echo "STOP=DIRTY_WORKTREE"; exit 1; }
[ "$(sha "$STAGE")" = "$EXPECTED_STAGE_SHA" ] || { echo "STOP=STAGE_SHA"; exit 1; }
[ "$("$NODE" -p 'process.versions.modules')" = "137" ] || { echo "STOP=NODE_ABI"; exit 1; }
oc --version 2>&1 | grep -q '2026.7.1-2' || { echo "STOP=OPENCLAW_VERSION"; exit 1; }

TX_ID="$(date +%Y%m%dT%H%M%S%z)"
EVIDENCE_DIR="$EVIDENCE_ROOT/q6-d2-shadow-autorecall-$TX_ID"
LOG="$EVIDENCE_DIR/transaction.log"
RESULT="$EVIDENCE_DIR/result.json"
PRE_CONFIG="$EVIDENCE_DIR/openclaw-pre.json"
SHADOW_CONFIG="$EVIDENCE_DIR/openclaw-shadow.json"
PRE_REGISTRY="$EVIDENCE_DIR/registry-pre.json"
ACTIVE_REGISTRY="$EVIDENCE_DIR/registry-active.json"
FINAL_REGISTRY="$EVIDENCE_DIR/registry-final.json"
FINAL_EVIDENCE="$EVIDENCE_DIR/final-evidence.json"
SESSIONS_PRE="$EVIDENCE_DIR/sessions-pre.json"

[ ! -e "$EVIDENCE_DIR" ] || { echo "STOP=EVIDENCE_EXISTS"; exit 1; }
mkdir -p "$EVIDENCE_DIR"
chmod 700 "$EVIDENCE_DIR"
: >"$LOG"
chmod 600 "$LOG"

log "PREFLIGHT_BEGIN"

[ "$MAX_EXECUTIONS" -eq 1 ] || { log "STOP max_executions"; exit 1; }
[ "$MAX_TURNS" -eq 6 ] || { log "STOP max_turns"; exit 1; }

gateway_ready || { log "STOP gateway_not_ready"; exit 1; }
oc config validate --json >>"$LOG" 2>&1 || { log "STOP config_validate"; exit 1; }

BASE_SOURCE="$(source_path)"
[ "$BASE_SOURCE" = "$REPO" ] || { log "STOP source_path"; exit 1; }
[ "$(install_path_from_host)" = "$INSTALL_PATH" ] || { log "STOP install_path"; exit 1; }
q6_hashes "$REPO" || { log "STOP repo_q6_hashes"; exit 1; }
q6_hashes "$INSTALL_PATH" || { log "STOP install_q6_hashes"; exit 1; }

registry_evidence "$PRE_REGISTRY"
registry_q6_ok "$PRE_REGISTRY" || { log "STOP registry_q6_parity"; exit 1; }

config_invariants "$CONFIG_PATH" || { log "STOP config_invariants"; exit 1; }

oc sessions --agent main --json >"$SESSIONS_PRE"
chmod 600 "$SESSIONS_PRE"
jq -e --arg sid "$SESSION_ID" --arg key "$SESSION_KEY" '
  (
    if type == "array" then .
    elif ((.sessions? | type) == "array") then .sessions
    else []
    end
  )
  | any(.[]?; (type == "object") and .sessionId == $sid and .key == $key)
' "$SESSIONS_PRE" >/dev/null || { log "STOP session_binding"; exit 1; }

cp "$CONFIG_PATH" "$PRE_CONFIG"
chmod 600 "$PRE_CONFIG"
BASE_EVENT_ID="$(max_event_id)"
[ "$BASE_EVENT_ID" -ge 0 ] || { log "STOP event_baseline"; exit 1; }

log "PREFLIGHT_PASS base_event_id=$BASE_EVENT_ID"

EXECUTION_CONSUMED=1
log "EXECUTION_COUNT_CONSUMED=1"

jq --arg sid "$SESSION_ID" '
  .plugins.entries["memory-engine"].config.autoRecall.shadow =
    {enabled:true,sessionAllowlist:[$sid]}
' "$PRE_CONFIG" >"$SHADOW_CONFIG"
chmod 600 "$SHADOW_CONFIG"

[ "$(normalized_without_shadow_sha "$SHADOW_CONFIG")" = "$(normalized_without_shadow_sha "$PRE_CONFIG")" ] ||
  { log "STOP patch_unrelated_config"; exit 1; }
shadow_scope_exact "$SHADOW_CONFIG" || { log "STOP shadow_candidate_scope"; exit 1; }

if ! oc gateway stop >>"$LOG" 2>&1; then
  log "STOP gateway_stop"
  exit 1
fi

cp "$SHADOW_CONFIG" "$CONFIG_PATH"

if ! oc config validate --json >>"$LOG" 2>&1; then
  log "STOP shadow_config_validate"
  exit 1
fi

if ! oc gateway start >>"$LOG" 2>&1; then
  log "STOP shadow_gateway_start"
  exit 1
fi

poll_ready || { log "STOP shadow_gateway_not_ready"; exit 1; }

[ "$(source_path)" = "$REPO" ] || { log "STOP source_path_changed"; exit 1; }
[ "$(install_path_from_host)" = "$INSTALL_PATH" ] || { log "STOP install_path_changed"; exit 1; }
q6_hashes "$REPO" || { log "STOP repo_q6_hash_changed"; exit 1; }
q6_hashes "$INSTALL_PATH" || { log "STOP install_q6_hash_changed"; exit 1; }

registry_evidence "$ACTIVE_REGISTRY"
registry_q6_ok "$ACTIVE_REGISTRY" || { log "STOP registry_changed"; exit 1; }

shadow_scope_exact "$CONFIG_PATH" || { log "STOP shadow_scope"; exit 1; }
log "SHADOW_ACTIVE session=$SESSION_ID"

[ -r /dev/tty ] || { log "STOP tty_unavailable"; exit 1; }

PREV=0
for SLOT in $(seq 1 "$MAX_TURNS"); do
  printf '\nQ6-D2 %s/%s: send ONE genuine natural turn in the bound session, then press ENTER here; type :finish to stop.\n> ' "$SLOT" "$MAX_TURNS" >/dev/tty
  IFS= read -r OP </dev/tty

  if [ "$OP" = ":finish" ]; then
    break
  fi
  [ -z "$OP" ] || { log "STOP unexpected_operator_input"; exit 1; }

  EXPECTED_TURNS=$((TURN_COUNT + 1))
  FOUND=0
  CUR="$PREV"

  for _ in $(seq 1 15); do
    sleep 1
    collect_evidence "$EXPECTED_TURNS"
    CUR="$(jq -r '.shadow_decisions // 0' "$FINAL_EVIDENCE")"
    if [ "$CUR" -gt "$PREV" ]; then
      FOUND=1
      break
    fi
  done

  [ "$FOUND" -eq 1 ] || { log "STOP no_new_shadow_decision"; exit 1; }
  [ "$CUR" -eq $((PREV + 1)) ] || { log "STOP ambiguous_shadow_decisions"; exit 1; }

  TURN_COUNT="$EXPECTED_TURNS"
  PREV="$CUR"
  collect_evidence "$TURN_COUNT"

  V="$(jq -r '.violations | length' "$FINAL_EVIDENCE")"
  F="$(jq -r '.foreign_q6_shadow_decision_count' "$FINAL_EVIDENCE")"
  I="$(jq -r '.memory_injected_on_shadow_trace_count' "$FINAL_EVIDENCE")"
  R="$(jq -r '.memory_reinforced_on_shadow_trace_count' "$FINAL_EVIDENCE")"

  log "TURN slot=$SLOT decisions=$CUR violations=$V foreign=$F injected=$I reinforced=$R"

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

closeout || { log "STOP closeout_failed"; exit 1; }

jq -n   --arg outcome "$OUTCOME"   --arg sid "$SESSION_ID"   --arg base "$BASE_SOURCE"   --argjson turns "$TURN_COUNT"   --argjson closeout "$CLOSEOUT_OK"   --slurpfile evidence "$FINAL_EVIDENCE"   '{
    schema:"memory_engine_q6_d2_shadow_autorecall_transaction_result_v1",
    outcome:$outcome,
    reason:"observation_complete",
    session_id:$sid,
    base_source:$base,
    execution_count_consumed:1,
    max_executions:1,
    max_turns:6,
    turns_sent:$turns,
    closeout_ok:$closeout,
    evidence:$evidence[0]
  }' >"$RESULT"
chmod 600 "$RESULT"
FINAL_WRITTEN=1

log "TRANSACTION_RESULT outcome=$OUTCOME turns=$TURN_COUNT"
trap - EXIT INT TERM
exit 0
