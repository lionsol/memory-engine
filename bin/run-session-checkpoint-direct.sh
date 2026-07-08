#!/usr/bin/env bash
# run-session-checkpoint-direct.sh — deterministic session-checkpoint runner for OpenClaw cron
#
# This wrapper intentionally avoids an agentTurn cron job. The scheduler should
# run this script directly so the checkpoint is not blocked by a model call just
# to decide which shell commands to execute.

set -uo pipefail

TIME_ZONE="${MEMORY_ENGINE_TIME_ZONE:-Asia/Shanghai}"
WORKSPACE="${MEMORY_ENGINE_WORKSPACE_DIR:-$HOME/.openclaw/workspace}"
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MEMORY_DIR="${MEMORY_ENGINE_MEMORY_DIR:-$WORKSPACE/memory}"
CORE_DB_PATH="${MEMORY_ENGINE_CORE_DB_PATH:-$HOME/.openclaw/memory/main.sqlite}"
EPISODES_DIR="$MEMORY_DIR/episodes"
FLUSH_SCRIPT="$PLUGIN_DIR/bin/flush-session-rawlog.js"
CHECKPOINT_SCRIPT="$PLUGIN_DIR/bin/session-checkpoint.js"

log() {
  printf '[checkpoint-direct] %s\n' "$*"
}

warn() {
  printf '[checkpoint-direct] WARN %s\n' "$*" >&2
}

compute_target_date() {
  TZ="$TIME_ZONE" date -d 'yesterday' +%Y-%m-%d
}

write_fallback_episode() {
  local target_date="$1"
  local reason="$2"
  local episode_file="$EPISODES_DIR/$target_date.md"
  local now_iso now_local chunk_count raw_count smart_add_file

  mkdir -p "$EPISODES_DIR"

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
smartAddInputPolicy: trusted_only:manual,agent_smart_add
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
  local target_date episode_file checkpoint_status reason

  target_date="${1:-$(compute_target_date)}"
  episode_file="$EPISODES_DIR/$target_date.md"
  checkpoint_status=0

  log "Start targetDate=$target_date timeZone=$TIME_ZONE workspace=$WORKSPACE"

  if [ -f "$FLUSH_SCRIPT" ]; then
    log "Running flush-session-rawlog checkpoint mode"
    if ! node "$FLUSH_SCRIPT" --checkpoint; then
      warn "flush-session-rawlog failed; continuing to session-checkpoint"
    fi
  else
    warn "flush script not found: $FLUSH_SCRIPT"
  fi

  log "Running canonical session-checkpoint"
  node "$CHECKPOINT_SCRIPT" --target-date "$target_date"
  checkpoint_status=$?

  if [ "$checkpoint_status" -eq 0 ] && [ -s "$episode_file" ]; then
    log "Completed targetDate=$target_date episode=$episode_file"
    exit 0
  fi

  if [ "$checkpoint_status" -ne 0 ]; then
    reason="session-checkpoint exited with status $checkpoint_status"
  else
    reason="session-checkpoint completed but expected episode file is missing or empty: $episode_file"
  fi

  warn "$reason"
  write_fallback_episode "$target_date" "$reason"
  exit 0
}

main "$@"
