#!/usr/bin/env bash
set -euo pipefail

REPO="/home/lionsol/.openclaw/workspace/plugins/memory-engine"
STAGE="$REPO/docs/smoke-tests/session-flush-reconciliation-persistent-rollout-successor-stage-card-20260816.md"
EXPECTED_HEAD="f1ef05b1166f9f1a254cff260c757465ee44dec0"
EXPECTED_STAGE_SHA="81ab8fd4f45498a599057ff91cbb6985d4d5e7d3476764f5f1cb2d006b6a2e38"

CANDIDATE="/home/lionsol/.openclaw/backups/memory-engine/releases/session-flush-reconciliation-overlay-ac0e5f0-20260810-r1"
R2="/home/lionsol/.openclaw/backups/memory-engine/releases/provenance-overlay-1cd183ff-20260808-r2"
ACTIVE="/home/lionsol/.openclaw/extensions/memory-engine"

OPENCLAW="/home/lionsol/.local/bin/openclaw"
NODE="/home/lionsol/.local/node24/bin/node"
CRON_ID="7b40cc54-3c66-4183-a0f7-453e3e9cec00"
PRE_LAST_RUN_MS="1786822200101"
TARGET_RUN_MS="1786908600000"
TARGET_LOCAL="2026-08-17 03:30:00 +08:00"
EXPECTED_CONFIG_SEMANTIC_SHA="9de37e2695f738f77bd4f15cb82b7d0fc9312e47ff9086b7f2e8620d79782f15"
MAX_EXECUTIONS=1

EVIDENCE_ROOT="$HOME/.openclaw/backups/memory-engine/qualification-evidence"
EVIDENCE_DIR="$EVIDENCE_ROOT/session-flush-reconciliation-persistent-rollout-successor-20260816-target-${TARGET_RUN_MS}-corrective"
EVENT_LOG="$EVIDENCE_DIR/activation.log"
RESULT="$EVIDENCE_DIR/activation-result.json"
CRON_JSON="$EVIDENCE_DIR/cron-pre.json"

AUTHORIZED_WATCHER_SHA="${AUTHORIZED_WATCHER_SHA:-}"
WATCHER_PATH="$0"

export PATH="/home/lionsol/.local/bin:/home/lionsol/.local/node24/bin:/usr/local/bin:/usr/bin:/bin"

sha() { sha256sum "$1" | awk '{print $1}'; }
now_ms() { date +%s%3N; }
event() { printf '%s %s\n' "$(date -Is)" "$*" | tee -a "$EVENT_LOG"; }

hash_eq() {
  [[ "$(sha "$1" 2>/dev/null || true)" == "$2" ]]
}

runtime_worktree_clean() {
  [[ -z "$(git -C "$REPO" status --porcelain -- \
    bin/ lib/ \
    ':(top,glob)*.js' ':(top,glob)*.cjs' \
    package.json package-lock.json openclaw.plugin.json \
    2>/dev/null || true)" ]]
}

candidate_hashes() {
  hash_eq "$CANDIDATE/bin/session-checkpoint.js" "544dd01c33e1e4b435be4695df5b4dc28621223f5e76505a4d4298423a8a36dd" &&
  hash_eq "$CANDIDATE/lib/checkpoint/orphan-repair.js" "157e298a1a509f2aa19446223ab1334fee6114da10c3055d3a2542087476ff4f" &&
  hash_eq "$CANDIDATE/lib/checkpoint/runtime.js" "dbae65c9e0aa647d6cf94dab458cf5bec7115dbd6e6fbaa5307e1421ff0bb13a" &&
  hash_eq "$CANDIDATE/lib/checkpoint/session-flush-reconciliation.js" "d3d40da9e40f0fb3762d1953fda09b04c134e90096f29a94c8eb90ce6971c25a"
}

r2_hashes() {
  hash_eq "$R2/bin/session-checkpoint.js" "1e39d12bcebe37728613b3b420ee7402ba0aa8833ae21fd8f58fa842075837e9" &&
  hash_eq "$R2/lib/checkpoint/orphan-repair.js" "837587ef75174d8aefbd36d97839c3487b10d9b92a872ad6292e7f078b7a3035" &&
  hash_eq "$R2/lib/checkpoint/runtime.js" "1ca5deba67cacc688fca844ca7c02dbdefdb510f9909ec75bd57f64d63965b62"
}

active_r2_hashes() {
  hash_eq "$ACTIVE/bin/session-checkpoint.js" "1e39d12bcebe37728613b3b420ee7402ba0aa8833ae21fd8f58fa842075837e9" &&
  hash_eq "$ACTIVE/lib/checkpoint/orphan-repair.js" "837587ef75174d8aefbd36d97839c3487b10d9b92a872ad6292e7f078b7a3035" &&
  hash_eq "$ACTIVE/lib/checkpoint/runtime.js" "1ca5deba67cacc688fca844ca7c02dbdefdb510f9909ec75bd57f64d63965b62"
}

active_candidate_hashes() {
  hash_eq "$ACTIVE/bin/session-checkpoint.js" "544dd01c33e1e4b435be4695df5b4dc28621223f5e76505a4d4298423a8a36dd" &&
  hash_eq "$ACTIVE/lib/checkpoint/orphan-repair.js" "157e298a1a509f2aa19446223ab1334fee6114da10c3055d3a2542087476ff4f" &&
  hash_eq "$ACTIVE/lib/checkpoint/runtime.js" "dbae65c9e0aa647d6cf94dab458cf5bec7115dbd6e6fbaa5307e1421ff0bb13a" &&
  hash_eq "$ACTIVE/lib/checkpoint/session-flush-reconciliation.js" "d3d40da9e40f0fb3762d1953fda09b04c134e90096f29a94c8eb90ce6971c25a"
}

repo_scheduler_hashes() {
  hash_eq "$REPO/bin/run-session-checkpoint-direct.sh" "c46391e7d603668abe588e857e92b25aa09ac9119706364a406418f25ff0f768" &&
  hash_eq "$REPO/bin/session-checkpoint.js" "544dd01c33e1e4b435be4695df5b4dc28621223f5e76505a4d4298423a8a36dd" &&
  hash_eq "$REPO/lib/checkpoint/orphan-repair.js" "157e298a1a509f2aa19446223ab1334fee6114da10c3055d3a2542087476ff4f" &&
  hash_eq "$REPO/lib/checkpoint/runtime.js" "dbae65c9e0aa647d6cf94dab458cf5bec7115dbd6e6fbaa5307e1421ff0bb13a" &&
  hash_eq "$REPO/lib/checkpoint/session-flush-reconciliation.js" "d3d40da9e40f0fb3762d1953fda09b04c134e90096f29a94c8eb90ce6971c25a"
}

plugin_source() {
  "$OPENCLAW" plugins inspect memory-engine --json 2>/dev/null |
    jq -r '.install.sourcePath // empty'
}

gateway_ready() {
  local out
  out="$("$OPENCLAW" gateway status 2>&1 || true)"
  grep -q '^Runtime: running' <<<"$out" &&
  grep -q '^Connectivity probe: ok' <<<"$out" &&
  grep -q '^Listening: .*18789' <<<"$out"
}

poll_ready() {
  local i
  for i in $(seq 1 12); do
    gateway_ready && return 0
    sleep 5
  done
  return 1
}

autorecall_disabled() {
  [[ "$(jq -r '.plugins.entries["memory-engine"].config.autoRecall.enabled | select(. != null)' \
    "$HOME/.openclaw/openclaw.json" 2>/dev/null || true)" == "false" ]]
}

config_semantic_sha() {
  jq -S 'del(.meta.lastTouchedVersion, .meta.lastTouchedAt)' "$HOME/.openclaw/openclaw.json" 2>/dev/null | sha256sum | awk '{print $1}'
}

config_exact() {
  [[ "$(config_semantic_sha)" == "$EXPECTED_CONFIG_SEMANTIC_SHA" ]]
}

maintenance_clear() {
  ! ps -eo comm=,args= |
    awk '($1 ~ /^(node|bash|sh)$/) &&
         ($0 ~ /bin\/session-checkpoint\.js|run-session-checkpoint-direct\.sh|orphan-repair\.js|nightly-maintenance-command\.cjs/) {
           found=1
         }
         END { exit(found ? 0 : 1) }'
}

cron_pre_exact() {
  "$OPENCLAW" cron list --json >"$CRON_JSON"
  chmod 600 "$CRON_JSON"
  jq -e \
    --arg id "$CRON_ID" \
    --argjson last "$PRE_LAST_RUN_MS" \
    --argjson next "$TARGET_RUN_MS" \
    '.jobs[] | select(.id==$id) |
      .enabled == true and
      .schedule.kind == "cron" and
      .schedule.expr == "30 3 * * *" and
      .schedule.tz == "Asia/Shanghai" and
      .state.lastRunAtMs == $last and
      .state.lastRunStatus == "ok" and
      .state.nextRunAtMs == $next and
      ((.state.runningAtMs // 0) == 0) and
      .payload.kind == "command" and
      .payload.argv[0] == "sh" and
      .payload.argv[1] == "-lc" and
      .payload.argv[2] == "/bin/bash /home/lionsol/.openclaw/workspace/plugins/memory-engine/bin/run-session-checkpoint-direct.sh" and
      .payload.cwd == "/home/lionsol/.openclaw/workspace"' \
    "$CRON_JSON" >/dev/null
}

write_result() {
  local status="$1"
  local reason="$2"
  local rollback_ok="$3"
  local tmp="${RESULT}.tmp.$$"
  jq -n \
    --arg status "$status" \
    --arg reason "$reason" \
    --arg at "$(date -Is)" \
    --arg target "$TARGET_RUN_MS" \
    --arg target_local "$TARGET_LOCAL" \
    --arg head "$EXPECTED_HEAD" \
    --arg stage "$EXPECTED_STAGE_SHA" \
    --arg watcher "$AUTHORIZED_WATCHER_SHA" \
    --argjson rollback_ok "$rollback_ok" \
    '{
      activation_status:$status,
      reason:$reason,
      rollback_ok:$rollback_ok,
      at:$at,
      execution_count_consumed:1,
      max_executions:1,
      target_run_ms:($target|tonumber),
      target_local:$target_local,
      expected_head:$head,
      expected_stage_sha:$stage,
      watcher_sha:$watcher
    }' >"$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$RESULT"
}

rollback_r2() {
  local reason="$1"
  local ok=false
  event "ROLLBACK_BEGIN reason=$reason"
  "$OPENCLAW" gateway stop >>"$EVENT_LOG" 2>&1 || true
  if "$OPENCLAW" plugins install "$R2" --force >>"$EVENT_LOG" 2>&1 &&
     "$OPENCLAW" gateway start >>"$EVENT_LOG" 2>&1 &&
     poll_ready &&
     active_r2_hashes &&
     [[ "$(plugin_source)" == "$R2" ]] &&
     autorecall_disabled &&
     config_exact; then
    ok=true
    event "ROLLBACK_PASS"
  else
    event "ROLLBACK_FAIL"
  fi
  write_result "STOPPED" "$reason" "$ok"
  [[ "$ok" == "true" ]]
}

preflight() {
  event "PREFLIGHT_BEGIN"
  [[ "$(git -C "$REPO" rev-parse HEAD 2>/dev/null || true)" == "$EXPECTED_HEAD" ]] || return 11
  [[ "$(sha "$STAGE" 2>/dev/null || true)" == "$EXPECTED_STAGE_SHA" ]] || return 12
  runtime_worktree_clean || return 13
  candidate_hashes || return 14
  r2_hashes || return 15
  repo_scheduler_hashes || return 16
  active_r2_hashes || return 17
  [[ "$(plugin_source)" == "$R2" ]] || return 18
  gateway_ready || return 19
  [[ "$("$NODE" -p 'process.version' 2>/dev/null || true)" == "v24.8.0" ]] || return 20
  [[ "$("$NODE" -p 'process.versions.modules' 2>/dev/null || true)" == "137" ]] || return 21
  autorecall_disabled || return 22
  cron_pre_exact || return 23
  maintenance_clear || return 24
  config_exact || return 25
  (( $(now_ms) < TARGET_RUN_MS )) || return 26
  event "PREFLIGHT_PASS"
}

main() {
  [[ -x "$OPENCLAW" && -x "$NODE" ]] || { echo "STOP=CLI_OR_NODE"; exit 1; }
  for cmd in jq git sha256sum date awk ps grep tee; do
    command -v "$cmd" >/dev/null 2>&1 || { echo "STOP=MISSING_$cmd"; exit 1; }
  done

  [[ -n "$AUTHORIZED_WATCHER_SHA" ]] || { echo "STOP=AUTH_SHA_MISSING"; exit 1; }
  [[ "$(sha "$WATCHER_PATH" 2>/dev/null || true)" == "$AUTHORIZED_WATCHER_SHA" ]] ||
    { echo "STOP=AUTH_SHA_MISMATCH"; exit 1; }

  mkdir -p "$EVIDENCE_ROOT"
  chmod 700 "$EVIDENCE_ROOT"
  [[ ! -e "$EVIDENCE_DIR" ]] || { echo "STOP=EVIDENCE_EXISTS"; exit 1; }
  mkdir "$EVIDENCE_DIR"
  chmod 700 "$EVIDENCE_DIR"
  : >"$EVENT_LOG"
  chmod 600 "$EVENT_LOG"

  event "SUCCESSOR_ACTIVATION_START target=$TARGET_LOCAL"

  set +e
  preflight
  rc=$?
  set -e
  if (( rc != 0 )); then
    event "PREFLIGHT_FAIL rc=$rc"
    jq -n --arg rc "$rc" --arg at "$(date -Is)" \
      '{activation_status:"STOPPED_PREACTIVATION",reason:("preflight_rc_"+$rc),at:$at,execution_count_consumed:0}' \
      >"$RESULT"
    chmod 600 "$RESULT"
    exit 1
  fi

  event "EXECUTION_COUNT_CONSUMED=1"

  if ! "$OPENCLAW" gateway stop >>"$EVENT_LOG" 2>&1; then
    rollback_r2 "candidate_gateway_stop_failed" || true
    exit 1
  fi

  if ! "$OPENCLAW" plugins install "$CANDIDATE" --force >>"$EVENT_LOG" 2>&1; then
    rollback_r2 "candidate_install_failed" || true
    exit 1
  fi

  if ! "$OPENCLAW" gateway start >>"$EVENT_LOG" 2>&1; then
    rollback_r2 "candidate_gateway_start_failed" || true
    exit 1
  fi

  if ! poll_ready; then
    rollback_r2 "candidate_gateway_not_ready" || true
    exit 1
  fi

  if ! active_candidate_hashes || [[ "$(plugin_source)" != "$CANDIDATE" ]]; then
    rollback_r2 "candidate_identity_or_hash_mismatch" || true
    exit 1
  fi

  if ! autorecall_disabled || ! config_exact; then
    rollback_r2 "config_or_autorecall_changed" || true
    exit 1
  fi

  if ! cron_pre_exact; then
    rollback_r2 "cron_authority_changed_during_activation" || true
    exit 1
  fi

  write_result "PROVISIONAL_PASS" "candidate_ready_waiting_for_bound_natural_cron" true
  event "ACTIVATION_PROVISIONAL_PASS candidate=$CANDIDATE target=$TARGET_LOCAL"
}

main "$@"
