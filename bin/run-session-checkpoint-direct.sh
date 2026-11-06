#!/usr/bin/env bash
# run-session-checkpoint-direct.sh — deterministic session-checkpoint runner for OpenClaw cron
#
# This wrapper intentionally avoids an agentTurn cron job. The scheduler should
# run this script directly so the checkpoint is not blocked by a model call just
# to decide which shell commands to execute.

set -uo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECKPOINT_ENV_FILE="${MEMORY_ENGINE_CHECKPOINT_ENV_FILE:-$PLUGIN_DIR/checkpoint-summary.env}"
if [ -f "$CHECKPOINT_ENV_FILE" ]; then
  set -a
  if ! source "$CHECKPOINT_ENV_FILE"; then
    printf '[checkpoint-direct] Failed to load checkpoint environment file\\n' >&2
    exit 1
  fi
  set +a
fi

TIME_ZONE=""
WORKSPACE="${MEMORY_ENGINE_WORKSPACE_DIR:-$HOME/.openclaw/workspace}"
NODE_BIN="${MEMORY_ENGINE_NODE_BIN:-$HOME/.local/node24/bin/node}"
MEMORY_DIR="${MEMORY_ENGINE_MEMORY_DIR:-$WORKSPACE/memory}"
CORE_DB_PATH="${MEMORY_ENGINE_CORE_DB_PATH:-$HOME/.openclaw/agents/main/agent/openclaw-agent.sqlite}"
EPISODES_DIR="$MEMORY_DIR/episodes"
CHECKPOINT_SCRIPT="$PLUGIN_DIR/bin/session-checkpoint.js"
BUSINESS_TIME_SCRIPT="$PLUGIN_DIR/bin/resolve-business-time.js"

log() {
  printf '[checkpoint-direct] %s\n' "$*"
}

warn() {
  printf '[checkpoint-direct] WARN %s\n' "$*" >&2
}

write_fallback_episode() {
  local target_date="$1"
  local reason="$2"
  local episode_file="$EPISODES_DIR/$target_date.md"
  local now_iso now_local chunk_count raw_count smart_add_file

  mkdir -p "$EPISODES_DIR"

  if [ -s "$episode_file" ]; then
    warn "preserving existing non-empty episode: $episode_file"
    return 0
  fi

  now_iso="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  now_local="$(TZ="$TIME_ZONE" date '+%Y-%m-%d %H:%M:%S %Z' 2>/dev/null || date -u '+%Y-%m-%d %H:%M:%S UTC')"
  smart_add_file="memory/smart-add/$target_date.md"

  chunk_count="unknown"
  if command -v sqlite3 >/dev/null 2>&1 && [ -f "$CORE_DB_PATH" ]; then
    chunk_count="$(sqlite3 "$CORE_DB_PATH" 'SELECT COUNT(*) FROM chunks;' 2>/dev/null || printf 'unknown')"
  fi

  raw_count="unknown"
  if command -v sqlite3 >/dev/null 2>&1 && [ -f "$CORE_DB_PATH" ]; then
    raw_count="$(sqlite3 "$CORE_DB_PATH" "SELECT COUNT(*) FROM chunks WHERE path = '$smart_add_file';" 2>/dev/null || printf 'unknown')"
  fi

  cat > "$episode_file" <<EOF
# Episode: $target_date

targetDate: $target_date
generatedAt: $now_iso
timeZone: $TIME_ZONE
category: episodic
source_type: checkpoint_fallback
smartAddPath: $smart_add_file
smartAddInputPolicy: trusted_only:manual,agent_smart_add,session_flush
smartAddIncluded: 0
rawLogTimeBasis: event_at/legacy_event_time
rawLogTimeBasisNote: prefer event_at as original event time; legacy fallback is only allowed before event_at exists
rawLogIncluded: unknown
rawLogSkippedOutOfTargetDate: unknown
resetDirectParseEnabled: false
evidenceDateFilter: targetDate=$target_date; timeZone=$TIME_ZONE; smartAdd=$smart_add_file; raw_log=event_at/legacy_event_time bounded to targetDate

⚠️ checkpoint 未完成 — 已写入 direct cron fallback marker

生成时间：$now_local ($now_iso)
失败原因：$reason

这是 direct cron wrapper 写入的兜底 episode。它表示目标日期的 LLM-based 记忆提取没有成功完成；原始 raw_log/session transcript 仍保留，可后续手动或补跑提取。

当前 memory chunks 总数：$chunk_count
raw_log 粗略计数：$raw_count

---
_Generated at ${now_iso}_
EOF

  log "Fallback episode written: $episode_file"
}

main() {
  local target_date episode_file checkpoint_status reason preview_only=false replay_mode=false
  local -a checkpoint_args=()

  if [ ! -x "$NODE_BIN" ]; then
    reason="configured Node binary is unavailable or not executable: $NODE_BIN"
    warn "$reason"
    exit 1
  fi

  if [ "${1:-}" = "--check-config" ]; then
    "$NODE_BIN" "$PLUGIN_DIR/bin/checkpoint-runtime-config.cjs"
    return $?
  fi

  if ! TIME_ZONE="$("$NODE_BIN" "$BUSINESS_TIME_SCRIPT" --timezone)"; then
    reason="canonical business timezone resolution failed"
    warn "$reason"
    exit 1
  fi
  export MEMORY_ENGINE_TIME_ZONE="$TIME_ZONE"

  target_date=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --dry-run)
        preview_only=true
        checkpoint_args+=("$1")
        shift ;;
      --legacy-reset-direct-parse)
        checkpoint_args+=("$1")
        shift ;;
      --replay-transcripts|--target-date)
        if [ "$#" -lt 2 ] || [[ "$2" == --* ]]; then
          warn "$1 requires a value"
          return 2
        fi
        if [ "$1" = "--target-date" ]; then
          target_date="$2"
        else
          replay_mode=true
          checkpoint_args+=("$1" "$2")
        fi
        shift 2 ;;
      --target-date=*)
        target_date="${1#*=}"
        shift ;;
      --*)
        warn "unknown checkpoint option: $1"
        return 2 ;;
      *)
        if [ -n "$target_date" ]; then
          warn "unexpected checkpoint argument: $1"
          return 2
        fi
        target_date="$1"
        shift ;;
    esac
  done
  if [ "$replay_mode" = true ] && [ -z "$target_date" ]; then
    warn "transcript replay requires an explicit target date"
    return 2
  fi
  if [ -z "$target_date" ]; then
    if ! target_date="$("$NODE_BIN" "$BUSINESS_TIME_SCRIPT" --yesterday)"; then
      reason="canonical business target-date resolution failed"
      warn "$reason"
      exit 1
    fi
  fi
  episode_file="$EPISODES_DIR/$target_date.md"
  checkpoint_status=0

  log "Start targetDate=$target_date timeZone=$TIME_ZONE workspace=$WORKSPACE"

  log "Running canonical session-checkpoint (flush -> Core index ingress -> Engine reconciliation -> extraction)"
  "$NODE_BIN" "$CHECKPOINT_SCRIPT" --target-date "$target_date" "${checkpoint_args[@]}"
  checkpoint_status=$?

  # A preview must not create a fallback episode, including on failure.
  if [ "$preview_only" = true ]; then
    return "$checkpoint_status"
  fi

  if [ "$checkpoint_status" -eq 0 ] && [ -s "$episode_file" ]; then
    log "Run ended targetDate=$target_date episode=$episode_file process_status=0; see structured Business status for completeness"
    exit 0
  fi

  if [ "$checkpoint_status" -ne 0 ]; then
    reason="session-checkpoint exited with status $checkpoint_status"
  else
    reason="session-checkpoint completed but expected episode file is missing or empty: $episode_file"
    checkpoint_status=1
  fi

  warn "$reason"
  write_fallback_episode "$target_date" "$reason"
  exit "$checkpoint_status"
}

main "$@"
