#!/usr/bin/env bash
set -Eeuo pipefail

# Q6-R1 Host Plugin Metadata Publication Remediation
# OWNER-AUTHORIZED ONE-SHOT PACKET.
# This authorization is non-reusable once the execution-consumed boundary is crossed.
EXECUTION_AUTHORIZED=true

REPO="$HOME/.openclaw/workspace/plugins/memory-engine"
STAGE_REL="docs/smoke-tests/q6-host-plugin-metadata-publication-remediation-stage-card-20260919.md"
STAGE="$REPO/$STAGE_REL"
PACKET_REL="docs/smoke-tests/q6-host-plugin-metadata-publication-remediation-execution-packet-20260919.sh"
PACKET="$REPO/$PACKET_REL"
EXPECTED_STAGE_SHA="c8b34dba9e3d2fae9f26c7533010135c08cb27315f386a4866ad0b40b5097fae"

NODE="$HOME/.local/node24/bin/node"
OPENCLAW_JS="$HOME/.local/lib/node_modules/openclaw/dist/index.js"
CONFIG_PATH="$HOME/.openclaw/openclaw.json"
STATE_DB="$HOME/.openclaw/state/openclaw.sqlite"
INSTALL_PATH="$HOME/.openclaw/extensions/memory-engine"
BACKUP_ROOT="$HOME/.openclaw/backups/memory-engine/q6-r1"
EVIDENCE_ROOT="$HOME/.openclaw/backups/memory-engine/qualification-evidence"

REGISTRY_HELPER="$REPO/bin/q6-r1-registry-evidence.js"
CONFIG_EQ="$REPO/bin/build-config-semantic-equivalence-report.js"

OLD_MANIFEST_SHA="346969a530ac8b6931bd4ec9d624016ca36ae394d47a79f9058bf037f602a735"
NEW_MANIFEST_SHA="0ea09bfea5bb5d1f3532ed22c9e0ae9c1cfe64abd785f00a1458b8481b0b0a27"
Q6_CONFIG_SHA="61ffb77fead2f4e83265af4d6c7eb28d247c8562ea6771f7fc03fa3df3b2bfb6"
Q6_LIFECYCLE_SHA="9baa225f9a94752c94aec6fae92d9e663219a0565ecd0dec2aa35807b6815aa0"
Q6_SHADOW_SHA="ee913beacc1b1ac103283846a82c0e19252240b9faa3e628e4acc21f3173ceef"
OLD_CONFIG_SHA="57bd24a41ba6e514549e72c1f5fe745d30cda89c571316c790f23da2d1e2006e"
OLD_LIFECYCLE_SHA="5f75439ea7acb0f0a03e3092f6f460b5ce46f6b70351b610e5beb551354b3a12"

MAX_FORWARD_INSTALLS=1
MAX_ROLLBACK_INSTALLS=1
MAX_RUNTIME_EXECUTIONS=1

TX_ID=""
TX_ROOT=""
ROLLBACK_SNAPSHOT=""
EVIDENCE_DIR=""
LOG=""
RESULT=""
PRE_CONFIG=""
POST_CONFIG=""
ROLLBACK_CONFIG=""
PRE_REGISTRY=""
POST_REGISTRY=""
ROLLBACK_REGISTRY=""
CONFIG_REPORT=""
ROLLBACK_CONFIG_REPORT=""

EXECUTION_CONSUMED=0
FORWARD_MUTATED=0
ROLLBACK_ATTEMPTED=0
CLOSED=0

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

gateway_ready() {
  oc gateway status 2>/dev/null | grep -q 'Connectivity probe: ok'
}

q6_source_hashes() {
  [ "$(sha "$REPO/openclaw.plugin.json")" = "$NEW_MANIFEST_SHA" ] &&
  [ "$(sha "$REPO/lib/config/effective-hybrid-runtime-config.js")" = "$Q6_CONFIG_SHA" ] &&
  [ "$(sha "$REPO/lib/recall/auto-recall-hook-lifecycle.js")" = "$Q6_LIFECYCLE_SHA" ] &&
  [ "$(sha "$REPO/lib/recall/auto-recall-shadow.js")" = "$Q6_SHADOW_SHA" ]
}

installed_q6_hashes() {
  [ "$(sha "$INSTALL_PATH/openclaw.plugin.json")" = "$NEW_MANIFEST_SHA" ] &&
  [ "$(sha "$INSTALL_PATH/lib/config/effective-hybrid-runtime-config.js")" = "$Q6_CONFIG_SHA" ] &&
  [ "$(sha "$INSTALL_PATH/lib/recall/auto-recall-hook-lifecycle.js")" = "$Q6_LIFECYCLE_SHA" ] &&
  [ "$(sha "$INSTALL_PATH/lib/recall/auto-recall-shadow.js")" = "$Q6_SHADOW_SHA" ]
}

installed_old_hashes() {
  [ "$(sha "$INSTALL_PATH/openclaw.plugin.json")" = "$OLD_MANIFEST_SHA" ] &&
  [ "$(sha "$INSTALL_PATH/lib/config/effective-hybrid-runtime-config.js")" = "$OLD_CONFIG_SHA" ] &&
  [ "$(sha "$INSTALL_PATH/lib/recall/auto-recall-hook-lifecycle.js")" = "$OLD_LIFECYCLE_SHA" ] &&
  [ ! -e "$INSTALL_PATH/lib/recall/auto-recall-shadow.js" ]
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

registry_evidence() {
  local out="$1"
  "$NODE" "$REGISTRY_HELPER" --db "$STATE_DB" --plugin-id memory-engine --json >"$out"
  chmod 600 "$out"
}

registry_old_split_brain() {
  local file="$1"
  jq -e --arg repo "$REPO" --arg install "$INSTALL_PATH" --arg hash "$OLD_MANIFEST_SHA" '
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

registry_forward_ok() {
  local file="$1"
  jq -e --arg repo "$REPO" --arg install "$INSTALL_PATH" --arg hash "$NEW_MANIFEST_SHA" '
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

registry_rollback_ok() {
  local file="$1"
  jq -e --arg rollback "$ROLLBACK_SNAPSHOT" --arg install "$INSTALL_PATH" --arg hash "$OLD_MANIFEST_SHA" '
    .index_found == true and
    .plugin_metadata_match_count == 1 and
    .install_record.source == "path" and
    .install_record.sourcePath == $rollback and
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

write_result() {
  local outcome="$1"
  local reason="$2"
  local rollback_ok="$3"
  local tmp="$RESULT.tmp.$$"
  jq -n     --arg outcome "$outcome"     --arg reason "$reason"     --arg tx "$TX_ID"     --arg repo "$REPO"     --arg install "$INSTALL_PATH"     --arg rollback_source "$ROLLBACK_SNAPSHOT"     --argjson consumed "$EXECUTION_CONSUMED"     --argjson rollback_attempted "$ROLLBACK_ATTEMPTED"     --argjson rollback_ok "$rollback_ok"     '{
      schema:"memory_engine_q6_r1_publication_remediation_result_v1",
      outcome:$outcome,
      reason:$reason,
      transaction_id:$tx,
      execution_count_consumed:$consumed,
      max_executions:1,
      max_forward_installs:1,
      max_rollback_installs:1,
      repo:$repo,
      install_path:$install,
      rollback_source:$rollback_source,
      shadow_activations:0,
      natural_turns:0,
      rollback_attempted:$rollback_attempted,
      rollback_ok:$rollback_ok
    }' >"$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$RESULT"
}

rollback_safe_old_runtime() {
  local reason="$1"
  [ "$ROLLBACK_ATTEMPTED" -eq 0 ] || return 1
  ROLLBACK_ATTEMPTED=1
  log "ROLLBACK_BEGIN reason=$reason"
  oc gateway stop >>"$LOG" 2>&1 || true

  if ! oc plugins install "$ROLLBACK_SNAPSHOT" --force >>"$LOG" 2>&1; then
    log "ROLLBACK_FAIL install"
    write_result "STOPPED" "$reason:rollback_install_failed" false
    return 1
  fi

  cp "$CONFIG_PATH" "$ROLLBACK_CONFIG"
  chmod 600 "$ROLLBACK_CONFIG"

  if ! installed_old_hashes; then
    log "ROLLBACK_FAIL installed_old_hashes"
    write_result "STOPPED" "$reason:rollback_installed_hashes" false
    return 1
  fi

  registry_evidence "$ROLLBACK_REGISTRY"
  if ! registry_rollback_ok "$ROLLBACK_REGISTRY"; then
    log "ROLLBACK_FAIL registry"
    write_result "STOPPED" "$reason:rollback_registry" false
    return 1
  fi

  if ! config_semantic_pass "$PRE_CONFIG" "$ROLLBACK_CONFIG" "$ROLLBACK_CONFIG_REPORT"; then
    log "ROLLBACK_FAIL config_semantics"
    write_result "STOPPED" "$reason:rollback_config_semantics" false
    return 1
  fi

  if ! config_invariants "$ROLLBACK_CONFIG"; then
    log "ROLLBACK_FAIL config_invariants"
    write_result "STOPPED" "$reason:rollback_config_invariants" false
    return 1
  fi

  if ! oc config validate --json >>"$LOG" 2>&1; then
    log "ROLLBACK_FAIL config_validate"
    write_result "STOPPED" "$reason:rollback_config_validate" false
    return 1
  fi

  if ! oc gateway start >>"$LOG" 2>&1; then
    log "ROLLBACK_FAIL gateway_start"
    write_result "STOPPED" "$reason:rollback_gateway_start" false
    return 1
  fi

  for _ in $(seq 1 20); do
    gateway_ready && break
    sleep 1
  done
  if ! gateway_ready; then
    log "ROLLBACK_FAIL gateway_not_ready"
    write_result "STOPPED" "$reason:rollback_gateway_not_ready" false
    return 1
  fi

  log "ROLLBACK_PASS"
  write_result "ROLLED_BACK" "$reason" true
  CLOSED=1
  return 0
}

unexpected_exit() {
  local rc=$?
  trap - EXIT
  if [ "$rc" -ne 0 ] && [ "$CLOSED" -eq 0 ]; then
    if [ "$FORWARD_MUTATED" -eq 1 ]; then
      rollback_safe_old_runtime "unexpected_exit_rc_$rc" || true
    elif [ "$EXECUTION_CONSUMED" -eq 1 ] && [ -n "$RESULT" ]; then
      write_result "STOPPED" "unexpected_preinstall_exit_rc_$rc" null
      CLOSED=1
    fi
  fi
  exit "$rc"
}
trap unexpected_exit EXIT

if [ "$EXECUTION_AUTHORIZED" != "true" ]; then
  echo "STOP=Q6_R1_RUNTIME_NOT_AUTHORIZED"
  exit 64
fi

for cmd in jq git sha256sum awk cp chmod mkdir date grep tee; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "STOP=MISSING_$cmd"; exit 1; }
done
[ -x "$NODE" ] || { echo "STOP=NODE24_MISSING"; exit 1; }
[ -f "$OPENCLAW_JS" ] || { echo "STOP=OPENCLAW_JS_MISSING"; exit 1; }
[ -f "$STATE_DB" ] || { echo "STOP=STATE_DB_MISSING"; exit 1; }
[ -f "$CONFIG_PATH" ] || { echo "STOP=CONFIG_MISSING"; exit 1; }
[ -d "$INSTALL_PATH" ] || { echo "STOP=INSTALL_PATH_MISSING"; exit 1; }

PACKET_COMMIT="$(git -C "$REPO" log -1 --format=%H -- "$PACKET_REL")"
HEAD="$(git -C "$REPO" rev-parse HEAD)"
[ "$HEAD" = "$PACKET_COMMIT" ] || { echo "STOP=HEAD_NOT_PACKET_COMMIT"; exit 1; }
[ -z "$(git -C "$REPO" status --porcelain)" ] || { echo "STOP=DIRTY_WORKTREE"; exit 1; }
[ "$(sha "$STAGE")" = "$EXPECTED_STAGE_SHA" ] || { echo "STOP=STAGE_SHA"; exit 1; }

TX_ID="$(date +%Y%m%dT%H%M%S%z)"
TX_ROOT="$BACKUP_ROOT/$TX_ID"
ROLLBACK_SNAPSHOT="$TX_ROOT/rollback-extension"
EVIDENCE_DIR="$EVIDENCE_ROOT/q6-r1-plugin-metadata-remediation-$TX_ID"
LOG="$EVIDENCE_DIR/transaction.log"
RESULT="$EVIDENCE_DIR/result.json"
PRE_CONFIG="$EVIDENCE_DIR/openclaw-pre.json"
POST_CONFIG="$EVIDENCE_DIR/openclaw-post.json"
ROLLBACK_CONFIG="$EVIDENCE_DIR/openclaw-rollback.json"
PRE_REGISTRY="$EVIDENCE_DIR/registry-pre.json"
POST_REGISTRY="$EVIDENCE_DIR/registry-post.json"
ROLLBACK_REGISTRY="$EVIDENCE_DIR/registry-rollback.json"
CONFIG_REPORT="$EVIDENCE_DIR/config-semantic.json"
ROLLBACK_CONFIG_REPORT="$EVIDENCE_DIR/config-semantic-rollback.json"

[ ! -e "$TX_ROOT" ] || { echo "STOP=TX_ROOT_EXISTS"; exit 1; }
[ ! -e "$EVIDENCE_DIR" ] || { echo "STOP=EVIDENCE_EXISTS"; exit 1; }
mkdir -p "$TX_ROOT" "$EVIDENCE_DIR"
chmod 700 "$TX_ROOT" "$EVIDENCE_DIR"
: >"$LOG"
chmod 600 "$LOG"

log "PREFLIGHT_BEGIN"
[ "$MAX_FORWARD_INSTALLS" -eq 1 ] || { log "STOP max_forward_installs"; exit 1; }
[ "$MAX_ROLLBACK_INSTALLS" -eq 1 ] || { log "STOP max_rollback_installs"; exit 1; }
[ "$MAX_RUNTIME_EXECUTIONS" -eq 1 ] || { log "STOP max_runtime_executions"; exit 1; }

q6_source_hashes || { log "STOP q6_source_hashes"; exit 1; }
gateway_ready || { log "STOP gateway_not_ready"; exit 1; }
config_invariants "$CONFIG_PATH" || { log "STOP config_invariants"; exit 1; }
oc config validate --json >>"$LOG" 2>&1 || { log "STOP config_validate"; exit 1; }

installed_old_hashes || { log "STOP baseline_install_hashes"; exit 1; }
jq -e '.configSchema.properties.autoRecall.properties | has("shadow") | not' "$INSTALL_PATH/openclaw.plugin.json" >/dev/null ||
  { log "STOP baseline_install_shadow_shape"; exit 1; }

registry_evidence "$PRE_REGISTRY"
registry_old_split_brain "$PRE_REGISTRY" || { log "STOP baseline_registry"; exit 1; }

cp "$CONFIG_PATH" "$PRE_CONFIG"
chmod 600 "$PRE_CONFIG"
log "PREFLIGHT_PASS"

EXECUTION_CONSUMED=1

cp -a "$INSTALL_PATH" "$ROLLBACK_SNAPSHOT"
[ "$(sha "$ROLLBACK_SNAPSHOT/openclaw.plugin.json")" = "$OLD_MANIFEST_SHA" ] ||
  { log "STOP rollback_snapshot_manifest"; exit 1; }
[ "$ROLLBACK_SNAPSHOT" != "$INSTALL_PATH" ] ||
  { log "STOP rollback_snapshot_alias"; exit 1; }
log "ROLLBACK_SNAPSHOT_READY path=$ROLLBACK_SNAPSHOT"

if ! oc gateway stop >>"$LOG" 2>&1; then
  log "STOP gateway_stop_failed"
  if ! gateway_ready; then
    oc gateway start >>"$LOG" 2>&1 || true
    for _ in $(seq 1 20); do
      gateway_ready && break
      sleep 1
    done
  fi
  if gateway_ready; then
    write_result "STOPPED" "gateway_stop_failed_pre_install_gateway_restored" null
  else
    write_result "STOPPED" "gateway_stop_failed_pre_install_gateway_not_ready" null
  fi
  CLOSED=1
  exit 1
fi

FORWARD_MUTATED=1

if ! oc plugins install "$REPO" --force >>"$LOG" 2>&1; then
  rollback_safe_old_runtime "forward_install_failed" || true
  exit 1
fi

cp "$CONFIG_PATH" "$POST_CONFIG"
chmod 600 "$POST_CONFIG"

if ! installed_q6_hashes; then
  rollback_safe_old_runtime "forward_installed_hash_mismatch" || true
  exit 1
fi

jq -e '.configSchema.properties.autoRecall.properties | has("shadow")'   "$INSTALL_PATH/openclaw.plugin.json" >/dev/null ||
  { rollback_safe_old_runtime "forward_shadow_schema_missing" || true; exit 1; }

registry_evidence "$POST_REGISTRY"
if ! registry_forward_ok "$POST_REGISTRY"; then
  rollback_safe_old_runtime "forward_registry_mismatch" || true
  exit 1
fi

if ! config_semantic_pass "$PRE_CONFIG" "$POST_CONFIG" "$CONFIG_REPORT"; then
  rollback_safe_old_runtime "forward_config_semantic_mismatch" || true
  exit 1
fi

if ! config_invariants "$POST_CONFIG"; then
  rollback_safe_old_runtime "forward_config_invariant_mismatch" || true
  exit 1
fi

if ! oc config validate --json >>"$LOG" 2>&1; then
  rollback_safe_old_runtime "forward_config_validate_failed" || true
  exit 1
fi

if ! oc gateway start >>"$LOG" 2>&1; then
  rollback_safe_old_runtime "forward_gateway_start_failed" || true
  exit 1
fi

READY=0
for _ in $(seq 1 20); do
  if gateway_ready; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  rollback_safe_old_runtime "forward_gateway_not_ready" || true
  exit 1
fi

q6_source_hashes || {
  rollback_safe_old_runtime "repo_q6_hash_drift_after_install" || true
  exit 1
}

write_result "PASS" "publication_converged" null
log "PASS publication_converged"
CLOSED=1
trap - EXIT
exit 0
