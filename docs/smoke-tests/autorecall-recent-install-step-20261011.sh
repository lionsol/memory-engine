#!/usr/bin/env bash

# This helper is intentionally source-only. A separately reviewed caller must
# provide the package paths and callback functions for one operation.

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  printf '%s\n' 'direct execution refused: source this helper from an authorized caller' >&2
  exit 64
fi

_autorecall_install_step_usage() {
  printf '%s\n' \
    'usage: autorecall_install_step <candidate-dir> <rollback-dir> <facts-callback> <recovery-acceptance-callback>' >&2
}

_autorecall_install_step_emit() {
  printf '%s=%s\n' "$1" "$2"
}

_autorecall_install_step_emit_preflight_failure() {
  local outcome="$1"
  _autorecall_install_step_emit 'status' 'STOPPED'
  _autorecall_install_step_emit 'outcome' "$outcome"
  _autorecall_install_step_emit 'candidate_invocations' '0'
  _autorecall_install_step_emit 'candidate_exit_code' 'not_run'
  _autorecall_install_step_emit 'candidate_facts_status' 'not_run'
  _autorecall_install_step_emit 'recovery_invocations' '0'
  _autorecall_install_step_emit 'recovery_exit_code' 'not_run'
  _autorecall_install_step_emit 'recovery_facts_status' 'not_run'
  _autorecall_install_step_emit 'recovery_acceptance' 'not_run'
  _autorecall_install_step_emit 'restart_decision' 'blocked'
}

_autorecall_install_step_validate_fact() {
  local name="$1"
  local value="$2"
  local allowed="$3"

  case "$allowed" in
    'yes|no|unknown')
      case "$value" in
        yes|no|unknown) return 0 ;;
        *) ;;
      esac
      ;;
    'unchanged|changed|unknown')
      case "$value" in
        unchanged|changed|unknown) return 0 ;;
        *) ;;
      esac
      ;;
    'none|explained|unexplained|unknown')
      case "$value" in
        none|explained|unexplained|unknown) return 0 ;;
        *) ;;
      esac
      ;;
  esac

  printf 'invalid %s: %s\n' "$name" "$value" >&2
  return 64
}

_autorecall_install_step_validate_callback() {
  local name="$1"
  local callback="$2"

  if [[ -n "$callback" ]] && declare -F "$callback" >/dev/null 2>&1; then
    return 0
  fi
  printf 'invalid %s callback\n' "$name" >&2
  return 64
}

_autorecall_install_step_invoke() {
  local package_dir="$1"
  local launcher=(
    "$INSTALL_STEP_NODE"
    "$INSTALL_STEP_OPENCLAW_ENTRYPOINT"
  )
  local install_args=(plugins install "$package_dir" --force)

  AUTORECALL_INSTALL_STEP_INVOKED=0
  AUTORECALL_INSTALL_STEP_INVOKE_ERROR=''

  # Keep cd separate from the launcher so a directory failure is explicit and
  # cannot be mistaken for a child exit. The caller runs in a helper subshell.
  if cd -- "$INSTALL_STEP_CWD"; then
    :
  else
    AUTORECALL_INSTALL_STEP_INVOKE_ERROR='cd_failed'
    return 64
  fi

  AUTORECALL_INSTALL_STEP_INVOKED=1
  if /usr/bin/env "PATH=$INSTALL_STEP_PATH" "${launcher[@]}" "${install_args[@]}"; then
    AUTORECALL_INSTALL_STEP_LAST_EXIT=0
  else
    AUTORECALL_INSTALL_STEP_LAST_EXIT=$?
  fi
  return 0
}

_autorecall_install_step_set_unknown_facts() {
  AUTORECALL_INSTALL_STEP_LAUNCH_OBSERVED='unknown'
  AUTORECALL_INSTALL_STEP_RUNTIME_STATE='unknown'
  AUTORECALL_INSTALL_STEP_DATA_DRIFT='unknown'
}

_autorecall_install_step_collect_facts() {
  local callback="$1"
  local output
  local callback_rc

  if output="$("$callback")"; then
    callback_rc=0
  else
    callback_rc=$?
  fi
  AUTORECALL_INSTALL_STEP_FACTS_CALLBACK_EXIT="$callback_rc"

  if ((callback_rc != 0)); then
    _autorecall_install_step_set_unknown_facts
    return 64
  fi

  local launch_observed=''
  local runtime_state=''
  local data_drift=''
  local seen_launch=0
  local seen_runtime=0
  local seen_drift=0
  local key
  local value

  while IFS='=' read -r key value; do
    if [[ -z "$key" ]]; then
      continue
    fi
    case "$key" in
      launch_observed)
        if ((seen_launch != 0)); then
          printf '%s\n' 'facts callback duplicated launch_observed' >&2
          _autorecall_install_step_set_unknown_facts
          return 64
        fi
        launch_observed="$value"
        seen_launch=1
        ;;
      runtime_state)
        if ((seen_runtime != 0)); then
          printf '%s\n' 'facts callback duplicated runtime_state' >&2
          _autorecall_install_step_set_unknown_facts
          return 64
        fi
        runtime_state="$value"
        seen_runtime=1
        ;;
      data_drift)
        if ((seen_drift != 0)); then
          printf '%s\n' 'facts callback duplicated data_drift' >&2
          _autorecall_install_step_set_unknown_facts
          return 64
        fi
        data_drift="$value"
        seen_drift=1
        ;;
      *)
        printf '%s\n' 'facts callback emitted an unknown field' >&2
        _autorecall_install_step_set_unknown_facts
        return 64
        ;;
    esac
  done <<< "$output"

  if ((seen_launch == 0 || seen_runtime == 0 || seen_drift == 0)); then
    printf '%s\n' 'facts callback omitted a required field' >&2
    _autorecall_install_step_set_unknown_facts
    return 64
  fi

  if _autorecall_install_step_validate_fact 'launch_observed' "$launch_observed" 'yes|no|unknown'; then
    :
  else
    _autorecall_install_step_set_unknown_facts
    return 64
  fi
  if _autorecall_install_step_validate_fact 'runtime_state' "$runtime_state" 'unchanged|changed|unknown'; then
    :
  else
    _autorecall_install_step_set_unknown_facts
    return 64
  fi
  if _autorecall_install_step_validate_fact 'data_drift' "$data_drift" 'none|explained|unexplained|unknown'; then
    :
  else
    _autorecall_install_step_set_unknown_facts
    return 64
  fi

  AUTORECALL_INSTALL_STEP_LAUNCH_OBSERVED="$launch_observed"
  AUTORECALL_INSTALL_STEP_RUNTIME_STATE="$runtime_state"
  AUTORECALL_INSTALL_STEP_DATA_DRIFT="$data_drift"
  return 0
}

_autorecall_install_step_emit_result() {
  _autorecall_install_step_emit 'status' "$1"
  _autorecall_install_step_emit 'outcome' "$2"
  _autorecall_install_step_emit 'candidate_invocations' "$3"
  _autorecall_install_step_emit 'candidate_exit_code' "$4"
  _autorecall_install_step_emit 'candidate_launch_observed' "$5"
  _autorecall_install_step_emit 'candidate_runtime_state' "$6"
  _autorecall_install_step_emit 'candidate_data_drift' "$7"
  _autorecall_install_step_emit 'candidate_facts_status' "$8"
  _autorecall_install_step_emit 'recovery_invocations' "$9"
  _autorecall_install_step_emit 'recovery_exit_code' "${10}"
  _autorecall_install_step_emit 'recovery_launch_observed' "${11}"
  _autorecall_install_step_emit 'recovery_runtime_state' "${12}"
  _autorecall_install_step_emit 'recovery_data_drift' "${13}"
  _autorecall_install_step_emit 'recovery_facts_status' "${14}"
  _autorecall_install_step_emit 'recovery_acceptance' "${15}"
  _autorecall_install_step_emit 'restart_decision' "${16}"
}

_autorecall_install_step_run() {
  set -Eeuo pipefail

  if (($# != 4)); then
    _autorecall_install_step_usage
    _autorecall_install_step_emit_preflight_failure 'validation_failed'
    return 64
  fi

  local candidate_dir="$1"
  local rollback_dir="$2"
  local facts_callback="$3"
  local recovery_acceptance_callback="$4"

  if _autorecall_install_step_validate_callback 'facts' "$facts_callback"; then
    :
  else
    _autorecall_install_step_emit_preflight_failure 'validation_failed'
    return 64
  fi
  if _autorecall_install_step_validate_callback 'recovery-acceptance' "$recovery_acceptance_callback"; then
    :
  else
    _autorecall_install_step_emit_preflight_failure 'validation_failed'
    return 64
  fi

  local node_path="${INSTALL_STEP_NODE:-/home/lionsol/.local/node24/bin/node}"
  local openclaw_entrypoint="${INSTALL_STEP_OPENCLAW_ENTRYPOINT:-/home/lionsol/.local/lib/node_modules/openclaw/openclaw.mjs}"
  local stable_cwd="${INSTALL_STEP_CWD:-/tmp/memory-engine-install-step-cwd}"
  local path_value="${INSTALL_STEP_PATH:-${PATH:-}}"

  if [[ -z "$node_path" || ! -f "$openclaw_entrypoint" || -z "$stable_cwd" || -z "$path_value" ]]; then
    printf '%s\n' 'install-step launcher paths are invalid' >&2
    _autorecall_install_step_emit_preflight_failure 'validation_failed'
    return 64
  fi
  if [[ ! -d "$candidate_dir" || ! -d "$rollback_dir" ]]; then
    printf '%s\n' 'install-step package directories are invalid' >&2
    _autorecall_install_step_emit_preflight_failure 'validation_failed'
    return 64
  fi

  INSTALL_STEP_NODE="$node_path"
  INSTALL_STEP_OPENCLAW_ENTRYPOINT="$openclaw_entrypoint"
  INSTALL_STEP_CWD="$stable_cwd"
  INSTALL_STEP_PATH="$path_value"

  local candidate_rc='not_run'
  local candidate_invocations=0
  local candidate_facts_status='not_run'
  local candidate_launch='unknown'
  local candidate_runtime='unknown'
  local candidate_drift='unknown'
  local recovery_rc='not_run'
  local recovery_invocations=0
  local recovery_facts_status='not_run'
  local recovery_launch='unknown'
  local recovery_runtime='unknown'
  local recovery_drift='unknown'
  local recovery_acceptance='not_run'
  local acceptance_rc='not_run'
  local invoke_rc
  local facts_rc
  local outcome
  local status
  local restart_decision

  if _autorecall_install_step_invoke "$candidate_dir"; then
    :
  else
    invoke_rc=$?
    if [[ "$AUTORECALL_INSTALL_STEP_INVOKE_ERROR" == 'cd_failed' ]]; then
      _autorecall_install_step_emit_result \
        'STOPPED' 'candidate_cd_failed' 0 'not_run' 'unknown' 'unknown' 'unknown' 'not_run' \
        0 'not_run' 'unknown' 'unknown' 'unknown' 'not_run' 'not_run' 'blocked'
      return 64
    fi
    printf 'candidate launcher failed before execution: %s\n' "$invoke_rc" >&2
    _autorecall_install_step_emit_preflight_failure 'candidate_launch_failed'
    return 64
  fi
  candidate_rc="$AUTORECALL_INSTALL_STEP_LAST_EXIT"
  candidate_invocations="$AUTORECALL_INSTALL_STEP_INVOKED"

  if _autorecall_install_step_collect_facts "$facts_callback"; then
    candidate_facts_status='ok'
  else
    facts_rc=$?
    candidate_facts_status="failed:$facts_rc"
  fi
  candidate_launch="${AUTORECALL_INSTALL_STEP_LAUNCH_OBSERVED:-unknown}"
  candidate_runtime="${AUTORECALL_INSTALL_STEP_RUNTIME_STATE:-unknown}"
  candidate_drift="${AUTORECALL_INSTALL_STEP_DATA_DRIFT:-unknown}"

  if [[ "$candidate_rc" == 0 ]]; then
    if [[ "$candidate_facts_status" == 'ok' && "$candidate_drift" != 'unexplained' && "$candidate_drift" != 'unknown' ]]; then
      _autorecall_install_step_emit_result \
        'CONTINUE' 'candidate_success' "$candidate_invocations" "$candidate_rc" \
        "$candidate_launch" "$candidate_runtime" "$candidate_drift" "$candidate_facts_status" \
        0 'not_run' 'unknown' 'unknown' 'unknown' 'not_run' 'not_run' 'permitted'
      return 0
    fi
    _autorecall_install_step_emit_result \
      'STOPPED' 'candidate_facts_blocked' "$candidate_invocations" "$candidate_rc" \
      "$candidate_launch" "$candidate_runtime" "$candidate_drift" "$candidate_facts_status" \
      0 'not_run' 'unknown' 'unknown' 'unknown' 'not_run' 'not_run' 'blocked'
    return 64
  fi

  if [[ "$candidate_facts_status" == 'ok' && "$candidate_launch" == 'no' && "$candidate_runtime" == 'unchanged' && "$candidate_drift" == 'none' ]]; then
    _autorecall_install_step_emit_result \
      'CONTINUE' 'candidate_failed_prelaunch_unchanged' "$candidate_invocations" "$candidate_rc" \
      "$candidate_launch" "$candidate_runtime" "$candidate_drift" "$candidate_facts_status" \
      0 'not_run' 'unknown' 'unknown' 'unknown' 'not_run' 'not_run' 'permitted'
    return "$candidate_rc"
  fi

  if _autorecall_install_step_invoke "$rollback_dir"; then
    :
  else
    invoke_rc=$?
    if [[ "$AUTORECALL_INSTALL_STEP_INVOKE_ERROR" == 'cd_failed' ]]; then
      _autorecall_install_step_emit_result \
        'STOPPED' 'recovery_cd_failed' "$candidate_invocations" "$candidate_rc" \
        "$candidate_launch" "$candidate_runtime" "$candidate_drift" "$candidate_facts_status" \
        0 'not_run' 'unknown' 'unknown' 'unknown' 'not_run' 'not_run' 'blocked'
      return "$candidate_rc"
    fi
    printf 'recovery launcher failed before execution: %s\n' "$invoke_rc" >&2
    _autorecall_install_step_emit_result \
      'STOPPED' 'recovery_launch_failed' "$candidate_invocations" "$candidate_rc" \
      "$candidate_launch" "$candidate_runtime" "$candidate_drift" "$candidate_facts_status" \
      0 'not_run' 'unknown' 'unknown' 'unknown' 'not_run' 'not_run' 'blocked'
    return "$candidate_rc"
  fi
  recovery_invocations="$AUTORECALL_INSTALL_STEP_INVOKED"
  recovery_rc="$AUTORECALL_INSTALL_STEP_LAST_EXIT"

  if _autorecall_install_step_collect_facts "$facts_callback"; then
    recovery_facts_status='ok'
  else
    facts_rc=$?
    recovery_facts_status="failed:$facts_rc"
  fi
  recovery_launch="${AUTORECALL_INSTALL_STEP_LAUNCH_OBSERVED:-unknown}"
  recovery_runtime="${AUTORECALL_INSTALL_STEP_RUNTIME_STATE:-unknown}"
  recovery_drift="${AUTORECALL_INSTALL_STEP_DATA_DRIFT:-unknown}"

  export AUTORECALL_INSTALL_STEP_RECOVERY_EXIT_CODE="$recovery_rc"
  export AUTORECALL_INSTALL_STEP_RECOVERY_FACTS_STATUS="$recovery_facts_status"
  export AUTORECALL_INSTALL_STEP_RECOVERY_DATA_DRIFT="$recovery_drift"
  local acceptance_output
  if acceptance_output="$("$recovery_acceptance_callback")"; then
    acceptance_rc=0
    recovery_acceptance='accepted'
  else
    acceptance_rc=$?
    recovery_acceptance='rejected'
  fi

  if [[ "$recovery_rc" == 0 && "$recovery_facts_status" == 'ok' && "$recovery_drift" != 'unexplained' && "$recovery_drift" != 'unknown' && "$acceptance_rc" == 0 ]]; then
    status='CONTINUE'
    outcome='candidate_failed_recovery_succeeded'
    restart_decision='permitted'
  else
    status='STOPPED'
    outcome='candidate_failed_recovery_blocked'
    restart_decision='blocked'
  fi

  _autorecall_install_step_emit_result \
    "$status" "$outcome" "$candidate_invocations" "$candidate_rc" \
    "$candidate_launch" "$candidate_runtime" "$candidate_drift" "$candidate_facts_status" \
    "$recovery_invocations" "$recovery_rc" "$recovery_launch" "$recovery_runtime" \
    "$recovery_drift" "$recovery_facts_status" "$recovery_acceptance" "$restart_decision"

  # Preserve the original candidate failure. Recovery and acceptance are
  # reported independently and never cause a candidate retry.
  return "$candidate_rc"
}

autorecall_install_step() (
  _autorecall_install_step_run "$@"
)
