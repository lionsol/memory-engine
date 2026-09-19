#!/usr/bin/env bash
set -euo pipefail

REPO="/home/lionsol/.openclaw/workspace/plugins/memory-engine"
STAGE="$REPO/docs/smoke-tests/q6-shadow-autorecall-exact-session-real-host-stage-card-20260919.md"
PACKET_REL="docs/smoke-tests/q6-shadow-autorecall-exact-session-real-host-execution-packet-20260919.sh"
PACKET="$REPO/$PACKET_REL"
Q6_SOURCE="4f79a8c78fb68bb92294ea78a755293c8b62cbc4"
STAGE_SHA="232215a09768a7d643b2f6bab261ad0129127bbb2cdb78bc318a9ada9f762f8c"
OPENCLAW="/home/lionsol/.local/bin/openclaw"
NODE="/home/lionsol/.local/node24/bin/node"
ENGINE_DB="$HOME/.openclaw/memory/memory-engine/memory-engine.sqlite"
CANDIDATE="$HOME/.openclaw/backups/memory-engine/releases/q6-shadow-autorecall-4f79a8c-20260919-r1"
EVIDENCE_DIR="$HOME/.openclaw/backups/memory-engine/qualification-evidence/q6-shadow-autorecall-exact-session-20260919-r2"
MAX_TURNS=6

: "$Q6_SESSION_ID"
: "$Q6_SESSION_KEY"
SESSION_ID="$Q6_SESSION_ID"
SESSION_KEY="$Q6_SESSION_KEY"

CONFIG_PATH="$HOME/.openclaw/openclaw.json"
BASE_SOURCE=""
BASE_EVENT_ID=""
PRE_CONFIG="$EVIDENCE_DIR/openclaw-pre.json"
SHADOW_CONFIG="$EVIDENCE_DIR/openclaw-shadow.json"
FINAL_EVIDENCE="$EVIDENCE_DIR/final-evidence.json"
CANDIDATE_DIFF="$EVIDENCE_DIR/candidate-diff.txt"
LOG="$EVIDENCE_DIR/transaction.log"
TURN_COUNT=0
MUTATED=0
CLOSED=0
CLOSEOUT_OK=false

export PATH="/home/lionsol/.local/node24/bin:/home/lionsol/.local/bin:/usr/local/bin:/usr/bin:/bin"

sha() { sha256sum "$1" | awk '{print $1}'; }
log() { printf '%s %s\n' "$(date -Is)" "$*" | tee -a "$LOG"; }

inspect() { "$OPENCLAW" plugins inspect memory-engine --json 2>/dev/null; }
source_path() { inspect | jq -r '.install.sourcePath // empty'; }
plugin_loaded() {
  inspect | jq -e '(.status // .runtime.status // "") == "loaded"' >/dev/null
}

gateway_ready() {
  local out
  out="$("$OPENCLAW" gateway status 2>&1 || true)"
  grep -q '^Runtime: running' <<<"$out" &&
  grep -q '^Connectivity probe: ok' <<<"$out"
}

poll_ready() {
  for _ in $(seq 1 12); do
    gateway_ready && return 0
    sleep 5
  done
  return 1
}

baseline_hashes() {
  local root="$1"
  [ "$(sha "$root/lib/config/effective-hybrid-runtime-config.js")" = "57bd24a41ba6e514549e72c1f5fe745d30cda89c571316c790f23da2d1e2006e" ] &&
  [ "$(sha "$root/lib/recall/auto-recall-hook-lifecycle.js")" = "5f75439ea7acb0f0a03e3092f6f460b5ce46f6b70351b610e5beb551354b3a12" ] &&
  [ ! -e "$root/lib/recall/auto-recall-shadow.js" ] &&
  [ "$(sha "$root/openclaw.plugin.json")" = "346969a530ac8b6931bd4ec9d624016ca36ae394d47a79f9058bf037f602a735" ]
}

candidate_hashes() {
  local root="$1"
  [ "$(sha "$root/lib/config/effective-hybrid-runtime-config.js")" = "61ffb77fead2f4e83265af4d6c7eb28d247c8562ea6771f7fc03fa3df3b2bfb6" ] &&
  [ "$(sha "$root/lib/recall/auto-recall-hook-lifecycle.js")" = "9baa225f9a94752c94aec6fae92d9e663219a0565ecd0dec2aa35807b6815aa0" ] &&
  [ "$(sha "$root/lib/recall/auto-recall-shadow.js")" = "ee913beacc1b1ac103283846a82c0e19252240b9faa3e628e4acc21f3173ceef" ] &&
  [ "$(sha "$root/openclaw.plugin.json")" = "0ea09bfea5bb5d1f3532ed22c9e0ae9c1cfe64abd785f00a1458b8481b0b0a27" ]
}

config_without_shadow_sha() {
  jq -S 'del(.meta.lastTouchedVersion,.meta.lastTouchedAt) |
    del(.plugins.entries["memory-engine"].config.autoRecall.shadow)' "$1" |
    sha256sum | awk '{print $1}'
}

config_invariants() {
  jq -e '.plugins.entries["memory-engine"].config as $c |
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
      (($c.recallHintRuntimeCanary.enabled // false) != true))' "$1" >/dev/null
}

max_event_id() {
  "$NODE" -e 'const {DatabaseSync}=require("node:sqlite");
    const db=new DatabaseSync(process.argv[1],{readOnly:true});
    try{process.stdout.write(String(Number(db.prepare("SELECT COALESCE(MAX(id),0) id FROM memory_events").get().id||0))}finally{db.close()}' "$ENGINE_DB"
}

evidence() {
  "$NODE" "$REPO/bin/q6-shadow-runtime-evidence.js"     --db "$ENGINE_DB" --since-id "$BASE_EVENT_ID"     --session-id "$SESSION_ID" --turns-sent "$TURN_COUNT" --json >"$FINAL_EVIDENCE"
  chmod 600 "$FINAL_EVIDENCE"
}

overlay() {
  local rel="$1" target="$CANDIDATE/$1" base="$BASE_SOURCE/$1"
  mkdir -p "$(dirname "$target")"
  if [ -e "$base" ]; then
    chmod u+w "$target"
    git -C "$REPO" show "$Q6_SOURCE:$rel" >"$target"
    chmod --reference="$base" "$target"
  else
    local parent
    parent="$(dirname "$target")"
    chmod u+w "$parent"
    git -C "$REPO" show "$Q6_SOURCE:$rel" >"$target"
    chmod 0644 "$target"
    chmod --reference="$(dirname "$base")" "$parent"
  fi
}

closeout() {
  [ "$CLOSED" -eq 0 ] || return 0
  CLOSED=1
  [ "$MUTATED" -eq 1 ] || return 0
  log "CLOSEOUT_BEGIN"
  "$OPENCLAW" gateway stop >>"$LOG" 2>&1 || true
  "$OPENCLAW" plugins install "$BASE_SOURCE" --force >>"$LOG" 2>&1 || return 1
  cp "$PRE_CONFIG" "$CONFIG_PATH"
  "$OPENCLAW" gateway start >>"$LOG" 2>&1 || return 1
  poll_ready || return 1
  [ "$(source_path)" = "$BASE_SOURCE" ] || return 1
  plugin_loaded || return 1
  baseline_hashes "$BASE_SOURCE" || return 1
  [ "$(sha "$CONFIG_PATH")" = "$(sha "$PRE_CONFIG")" ] || return 1
  config_invariants "$CONFIG_PATH" || return 1
  CLOSEOUT_OK=true
  log "CLOSEOUT_PASS"
}

write_stopped_result() {
  [ -d "$EVIDENCE_DIR" ] || return 0
  [ -f "$EVIDENCE_DIR/result.json" ] && return 0
  jq -n --arg sid "$SESSION_ID" --arg base "$BASE_SOURCE"     --arg candidate "$CANDIDATE" --argjson turns "$TURN_COUNT"     --argjson closeout "$CLOSEOUT_OK"     '{schema:"memory_engine_q6_shadow_autorecall_transaction_result_v1",
      outcome:"STOPPED",reason:"see_transaction_log",session_id:$sid,
      base_source:$base,candidate:$candidate,max_executions:1,max_turns:6,
      turns_sent:$turns,closeout_ok:$closeout}' >"$EVIDENCE_DIR/result.json"
  chmod 600 "$EVIDENCE_DIR/result.json"
}

trap 'rc=$?; if [ "$CLOSED" -eq 0 ]; then closeout || rc=1; fi; write_stopped_result; exit "$rc"' EXIT INT TERM

mkdir -p "$(dirname "$EVIDENCE_DIR")"
[ ! -e "$EVIDENCE_DIR" ] || { echo "STOP: evidence dir exists" >&2; exit 1; }
mkdir "$EVIDENCE_DIR"; chmod 700 "$EVIDENCE_DIR"
: >"$LOG"; chmod 600 "$LOG"
log "PREFLIGHT_BEGIN"

HEAD="$(git -C "$REPO" rev-parse HEAD)"
PACKET_COMMIT="$(git -C "$REPO" log -1 --format=%H -- "$PACKET_REL")"
[ "$HEAD" = "$PACKET_COMMIT" ] || { log "STOP repo_head_not_packet_commit"; exit 1; }
[ -z "$(git -C "$REPO" status --porcelain)" ] || { log "STOP dirty_worktree"; exit 1; }
[ "$(sha "$STAGE")" = "$STAGE_SHA" ] || { log "STOP stage_sha"; exit 1; }
[ "$("$NODE" -p 'process.versions.modules')" = "137" ] || { log "STOP node_abi"; exit 1; }
[ "$SESSION_KEY" != "agent:main:main" ] || { log "STOP default_session"; exit 1; }

[ -f "$CONFIG_PATH" ] || { log "STOP config_path"; exit 1; }
[ -f "$ENGINE_DB" ] || { log "STOP engine_db"; exit 1; }
BASE_SOURCE="$(source_path)"
[ -d "$BASE_SOURCE" ] || { log "STOP source_path"; exit 1; }
baseline_hashes "$BASE_SOURCE" || { log "STOP baseline_hash_drift"; exit 1; }
gateway_ready || { log "STOP gateway_not_ready"; exit 1; }
plugin_loaded || { log "STOP plugin_not_loaded"; exit 1; }
config_invariants "$CONFIG_PATH" || { log "STOP config_drift"; exit 1; }

"$OPENCLAW" sessions --agent main --json >"$EVIDENCE_DIR/sessions-pre.json"
chmod 600 "$EVIDENCE_DIR/sessions-pre.json"
jq -e --arg sid "$SESSION_ID" --arg key "$SESSION_KEY"   'any(.[]?; .sessionId==$sid and .key==$key)' "$EVIDENCE_DIR/sessions-pre.json" >/dev/null ||
  { log "STOP session_binding"; exit 1; }

cp "$CONFIG_PATH" "$PRE_CONFIG"; chmod 600 "$PRE_CONFIG"
PRE_NO_SHADOW="$(config_without_shadow_sha "$PRE_CONFIG")"
BASE_EVENT_ID="$(max_event_id)"
[ "$BASE_EVENT_ID" -ge 0 ] || { log "STOP event_baseline"; exit 1; }
[ ! -e "$CANDIDATE" ] || { log "STOP candidate_exists"; exit 1; }
log "PREFLIGHT_PASS base_event_id=$BASE_EVENT_ID"

cp -a "$BASE_SOURCE" "$CANDIDATE"
overlay "lib/config/effective-hybrid-runtime-config.js"
overlay "lib/recall/auto-recall-hook-lifecycle.js"
overlay "lib/recall/auto-recall-shadow.js"
overlay "openclaw.plugin.json"
candidate_hashes "$CANDIDATE" || { log "STOP candidate_hash"; exit 1; }
diff -qr "$BASE_SOURCE" "$CANDIDATE" >"$CANDIDATE_DIFF" || true
chmod 600 "$CANDIDATE_DIFF"
DIFF_COUNT="$(awk 'NF{n++} END{print n+0}' "$CANDIDATE_DIFF")"
[ "$DIFF_COUNT" -eq 4 ] || { log "STOP candidate_diff_count=$DIFF_COUNT"; exit 1; }
while IFS= read -r LINE; do
  case "$LINE" in
    *"/lib/config/effective-hybrid-runtime-config.js"*|\
    *"/lib/recall/auto-recall-hook-lifecycle.js"*|\
    *"lib/recall: auto-recall-shadow.js"*|\
    *"/openclaw.plugin.json"*) ;;
    *) log "STOP candidate_diff_escape"; exit 1 ;;
  esac
done <"$CANDIDATE_DIFF"

MUTATED=1
"$OPENCLAW" gateway stop >>"$LOG" 2>&1
"$OPENCLAW" plugins install "$CANDIDATE" --force >>"$LOG" 2>&1
"$OPENCLAW" gateway start >>"$LOG" 2>&1
poll_ready || { log "STOP candidate_gateway"; exit 1; }
[ "$(source_path)" = "$CANDIDATE" ] || { log "STOP candidate_source"; exit 1; }
plugin_loaded || { log "STOP candidate_plugin_not_loaded"; exit 1; }
candidate_hashes "$CANDIDATE" || { log "STOP active_candidate_hash"; exit 1; }
[ "$(config_without_shadow_sha "$CONFIG_PATH")" = "$PRE_NO_SHADOW" ] ||
  { log "STOP install_config_drift"; exit 1; }

jq --arg sid "$SESSION_ID"   '.plugins.entries["memory-engine"].config.autoRecall.shadow =
    {enabled:true,sessionAllowlist:[$sid]}' "$CONFIG_PATH" >"$SHADOW_CONFIG"
chmod 600 "$SHADOW_CONFIG"
[ "$(config_without_shadow_sha "$SHADOW_CONFIG")" = "$PRE_NO_SHADOW" ] ||
  { log "STOP patch_unrelated_config"; exit 1; }
cp "$SHADOW_CONFIG" "$CONFIG_PATH"

"$OPENCLAW" gateway stop >>"$LOG" 2>&1
"$OPENCLAW" gateway start >>"$LOG" 2>&1
poll_ready || { log "STOP shadow_gateway"; exit 1; }
plugin_loaded || { log "STOP shadow_plugin_not_loaded"; exit 1; }
jq -e --arg sid "$SESSION_ID"   '.plugins.entries["memory-engine"].config.autoRecall.shadow ==
    {enabled:true,sessionAllowlist:[$sid]}' "$CONFIG_PATH" >/dev/null ||
  { log "STOP shadow_scope"; exit 1; }
log "SHADOW_ACTIVE session=$SESSION_ID"

[ -r /dev/tty ] || { log "STOP tty_unavailable"; exit 1; }
PREV=0
for SLOT in $(seq 1 "$MAX_TURNS"); do
  printf '\nQ6-D %s/%s: send ONE genuine natural turn in the bound session, then ENTER here; :finish to stop.\n> ' "$SLOT" "$MAX_TURNS" >/dev/tty
  IFS= read -r OP </dev/tty
  [ "$OP" = ":finish" ] && break
  [ -z "$OP" ] || { log "STOP unexpected_operator_input"; exit 1; }

  FOUND=0
  for _ in $(seq 1 10); do
    sleep 1
    TURN_COUNT=$((TURN_COUNT + 1))
    evidence
    TURN_COUNT=$((TURN_COUNT - 1))
    CUR="$(jq -r '.shadow_decisions // 0' "$FINAL_EVIDENCE")"
    if [ "$CUR" -gt "$PREV" ]; then FOUND=1; break; fi
  done
  [ "$FOUND" -eq 1 ] || { log "STOP no_new_shadow_decision"; exit 1; }
  [ "$CUR" -eq $((PREV + 1)) ] || { log "STOP ambiguous_shadow_decisions"; exit 1; }

  TURN_COUNT=$((TURN_COUNT + 1))
  PREV="$CUR"
  evidence
  V="$(jq -r '.violations|length' "$FINAL_EVIDENCE")"
  F="$(jq -r '.foreign_q6_shadow_decision_count' "$FINAL_EVIDENCE")"
  I="$(jq -r '.memory_injected_on_shadow_trace_count' "$FINAL_EVIDENCE")"
  R="$(jq -r '.memory_reinforced_on_shadow_trace_count' "$FINAL_EVIDENCE")"
  log "TURN slot=$SLOT decisions=$CUR violations=$V foreign=$F injected=$I reinforced=$R"
  [ "$V" -eq 0 ] && [ "$F" -eq 0 ] && [ "$I" -eq 0 ] && [ "$R" -eq 0 ] ||
    { log "STOP mechanism_or_scope_violation"; exit 1; }
done

evidence
SEARCHED="$(jq -r '.search_executed // 0' "$FINAL_EVIDENCE")"
BOUNDARY_ERRORS="$(jq -r '[.direct_card_boundary_error_counts[]?]|add//0' "$FINAL_EVIDENCE")"
if [ "$TURN_COUNT" -eq 0 ] || [ "$SEARCHED" -eq 0 ]; then
  OUTCOME="INSUFFICIENT_EVIDENCE"
elif [ "$BOUNDARY_ERRORS" -gt 0 ]; then
  OUTCOME="PASS_WITH_FINDINGS"
else
  OUTCOME="PASS"
fi

closeout
jq -n --arg outcome "$OUTCOME" --arg sid "$SESSION_ID"   --arg base "$BASE_SOURCE" --arg candidate "$CANDIDATE"   --argjson turns "$TURN_COUNT" --argjson closeout "$CLOSEOUT_OK"   --slurpfile evidence "$FINAL_EVIDENCE"   '{schema:"memory_engine_q6_shadow_autorecall_transaction_result_v1",
    outcome:$outcome,session_id:$sid,base_source:$base,candidate:$candidate,
    max_executions:1,max_turns:6,turns_sent:$turns,closeout_ok:$closeout,
    evidence:$evidence[0]}' >"$EVIDENCE_DIR/result.json"
chmod 600 "$EVIDENCE_DIR/result.json"
log "TRANSACTION_RESULT outcome=$OUTCOME turns=$TURN_COUNT"
trap - EXIT INT TERM
exit 0
