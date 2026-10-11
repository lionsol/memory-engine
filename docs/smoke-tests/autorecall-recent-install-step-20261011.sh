#!/usr/bin/env bash

# This helper is intentionally source-only.  A separately reviewed caller must
# provide the package paths and the runtime/recovery facts for one operation.

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  printf '%s\n' 'direct execution refused: source this helper from an authorized caller' >&2
  exit 64
fi

_autorecall_install_step_usage() {
  printf '%s\n' \
    'usage: autorecall_install_step <candidate-dir> <rollback-dir> <launch-observed> <runtime-state> <recovery-acceptance>' >&2
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
    'accepted|rejected|unknown|not-needed')
      case "$value" in
        accepted|rejected|unknown|not-needed) return 0 ;;
        *) ;;
      esac
      ;;
  esac

  printf 'invalid %s: %s\n' "$name" "$value" >&2
  return 64
}

_autorecall_install_step_invoke() {
  local package_dir="$1"
  local launcher=(
    "$INSTALL_STEP_NODE"
    "$INSTALL_STEP_OPENCLAW_ENTRYPOINT"
  )
  local install_args=(plugins install "$package_dir" --force)

  if (
    cd -- "$INSTALL_STEP_CWD"
    /usr/bin/env "PATH=$INSTALL_STEP_PATH" "${launcher[@]}" "${install_args[@]}"
  ); then
    AUTORECALL_INSTALL_STEP_LAST_EXIT=0
  else
    AUTORECALL_INSTALL_STEP_LAST_EXIT=$?
  fi
}

_autorecall_install_step_emit() {
  printf '%s=%s\n' "$1" "$2"
}

_autorecall_install_step_run() {
  set -Eeuo pipefail

  if (($# != 5)); then
    _autorecall_install_step_usage
    return 64
  fi

  local candidate_dir="$1"
  local rollback_dir="$2"
  local launch_observed="$3"
  local runtime_state="$4"
  local recovery_acceptance="$5"

  _autorecall_install_step_validate_fact \
    'launch-observed' "$launch_observed" 'yes|no|unknown'
  _autorecall_install_step_validate_fact \
    'runtime-state' "$runtime_state" 'unchanged|changed|unknown'
  _autorecall_install_step_validate_fact \
    'recovery-acceptance' "$recovery_acceptance" 'accepted|rejected|unknown|not-needed'

  local node_path="${INSTALL_STEP_NODE:-/home/lionsol/.local/node24/bin/node}"
  local openclaw_entrypoint="${INSTALL_STEP_OPENCLAW_ENTRYPOINT:-/home/lionsol/.local/lib/node_modules/openclaw/openclaw.mjs}"
  local stable_cwd="${INSTALL_STEP_CWD:-/tmp/memory-engine-install-step-cwd}"
  local path_value="${INSTALL_STEP_PATH:-${PATH:-}}"

  if [[ -z "$node_path" || ! -f "$openclaw_entrypoint" || ! -d "$stable_cwd" ]]; then
    printf '%s\n' 'install-step launcher paths are invalid' >&2
    return 64
  fi
  if [[ ! -d "$candidate_dir" || ! -d "$rollback_dir" ]]; then
    printf '%s\n' 'install-step package directories are invalid' >&2
    return 64
  fi
  if [[ -z "$path_value" ]]; then
    printf '%s\n' 'install-step PATH is empty' >&2
    return 64
  fi

  INSTALL_STEP_NODE="$node_path"
  INSTALL_STEP_OPENCLAW_ENTRYPOINT="$openclaw_entrypoint"
  INSTALL_STEP_CWD="$stable_cwd"
  INSTALL_STEP_PATH="$path_value"

  local candidate_rc
  local recovery_rc='not_run'
  local recovery_invocations=0
  local outcome
  local status
  local restart_decision

  _autorecall_install_step_invoke "$candidate_dir"
  candidate_rc="$AUTORECALL_INSTALL_STEP_LAST_EXIT"

  if [[ "$candidate_rc" == 0 ]]; then
    outcome='candidate_success'
    status='CONTINUE'
    restart_decision='permitted'
    _autorecall_install_step_emit 'status' "$status"
    _autorecall_install_step_emit 'outcome' "$outcome"
    _autorecall_install_step_emit 'candidate_invocations' '1'
    _autorecall_install_step_emit 'candidate_exit_code' "$candidate_rc"
    _autorecall_install_step_emit 'candidate_launch_observed' "$launch_observed"
    _autorecall_install_step_emit 'recovery_invocations' "$recovery_invocations"
    _autorecall_install_step_emit 'recovery_exit_code' "$recovery_rc"
    _autorecall_install_step_emit 'recovery_acceptance' 'not-needed'
    _autorecall_install_step_emit 'restart_decision' "$restart_decision"
    return 0
  fi

  # A failed launcher is safe to skip only when the caller has independently
  # established both pre-launch failure and unchanged runtime state.  Exit 127
  # alone is never treated as proof that the child did not start.
  if [[ "$launch_observed" == 'no' && "$runtime_state" == 'unchanged' ]]; then
    outcome='candidate_failed_prelaunch_unchanged'
    status='CONTINUE'
    restart_decision='permitted'
  else
    recovery_invocations=1
    _autorecall_install_step_invoke "$rollback_dir"
    recovery_rc="$AUTORECALL_INSTALL_STEP_LAST_EXIT"

    if [[ "$recovery_rc" == 0 && "$recovery_acceptance" == 'accepted' ]]; then
      outcome='candidate_failed_recovery_succeeded'
      status='CONTINUE'
      restart_decision='permitted'
    else
      outcome='candidate_failed_recovery_blocked'
      status='STOPPED'
      restart_decision='blocked'
    fi
  fi

  _autorecall_install_step_emit 'status' "$status"
  _autorecall_install_step_emit 'outcome' "$outcome"
  _autorecall_install_step_emit 'candidate_invocations' '1'
  _autorecall_install_step_emit 'candidate_exit_code' "$candidate_rc"
  _autorecall_install_step_emit 'candidate_launch_observed' "$launch_observed"
  _autorecall_install_step_emit 'recovery_invocations' "$recovery_invocations"
  _autorecall_install_step_emit 'recovery_exit_code' "$recovery_rc"
  _autorecall_install_step_emit 'recovery_acceptance' "$recovery_acceptance"
  _autorecall_install_step_emit 'restart_decision' "$restart_decision"

  # Preserve the original candidate failure for the caller.  Recovery is
  # reported independently and never causes a candidate retry.
  return "$candidate_rc"
}

autorecall_install_step() (
  _autorecall_install_step_run "$@"
)
