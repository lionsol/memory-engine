#!/usr/bin/env bash

# Source-only caller for the already-reviewed install-step helper.  This file
# deliberately does not stop a service, run DDL, or install anything when it
# is sourced.  A caller supplies those two bounded callbacks explicitly.

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  printf '%s\n' 'direct execution refused: source this caller from an offline or authorized driver' >&2
  exit 64
fi

_autorecall_recent_deployment_callbacks_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=autorecall-recent-install-step-20261011.sh
source "$_autorecall_recent_deployment_callbacks_dir/autorecall-recent-install-step-20261011.sh"

_autorecall_recent_deployment_emit_blocked() {
  local outcome="$1"
  printf '%s\n' \
    'status=STOPPED' \
    "outcome=$outcome" \
    'candidate_invocations=0' \
    'candidate_exit_code=not_run' \
    'candidate_facts_status=not_run' \
    'recovery_invocations=0' \
    'recovery_exit_code=not_run' \
    'recovery_facts_status=not_run' \
    'recovery_acceptance=not_run' \
    'restart_decision=blocked'
}

_autorecall_recent_deployment_valid_callback() {
  local name="$1"
  local callback="$2"
  if [[ -n "$callback" ]] && declare -F "$callback" >/dev/null 2>&1; then
    return 0
  fi
  printf 'invalid %s callback\n' "$name" >&2
  return 64
}

_autorecall_recent_deployment_sha256() {
  local path="$1"
  local digest
  if [[ -f "$path" ]] && digest="$(sha256sum -- "$path" 2>/dev/null)"; then
    printf '%s\n' "${digest%% *}"
    return 0
  fi
  return 64
}

_autorecall_recent_deployment_validate_baseline_shape() {
  local baseline="$1"
  local core_db="$2"
  local node="$3"

  if "$node" -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const expectedCore = path.resolve(process.argv[2]);
    if (report.contract !== "core_deployment_logical_fingerprint_v1") throw new Error("invalid Core baseline contract");
    if (report.core_db_path !== expectedCore) throw new Error("Core baseline is bound to a different path");
    if (report.dialect !== "openclaw_memory_index") throw new Error("invalid Core baseline dialect");
    if (!/^[a-f0-9]{64}$/.test(report.deployment_invariant_sha256 || "")) throw new Error("Core baseline invariant is missing");
    for (const [name, value] of Object.entries({
      canonical_content: report.canonical_content?.sha256,
      schema_identity: report.schema_identity?.sha256,
      schema_surface: report.schema_surface?.sha256,
    })) {
      if (!/^[a-f0-9]{64}$/.test(value || "")) throw new Error(`Core baseline ${name} is missing`);
    }
  ' "$baseline" "$core_db"; then
    return 0
  else
    printf '%s\n' 'invalid Core INSTALL baseline' >&2
    return 64
  fi
}

_autorecall_recent_deployment_validate_core_report() {
  local report_path="$1"
  local core_db="$2"
  local node="$3"
  local compare_exit="$4"

  if [[ "$compare_exit" != 0 && "$compare_exit" != 2 ]]; then
    printf 'Core comparison command failed with exit %s\n' "$compare_exit" >&2
    return 64
  fi
  if [[ ! -s "$report_path" ]]; then
    printf '%s\n' 'Core comparison did not produce a report' >&2
    return 64
  fi
  if "$node" -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const expectedCore = path.resolve(process.argv[2]);
    const comparison = report.comparison;
    if (report.contract !== "core_deployment_logical_fingerprint_v1") throw new Error("Core report contract mismatch");
    if (report.core_db_path !== expectedCore) throw new Error("Core report path mismatch");
    if (!comparison || typeof comparison !== "object") throw new Error("Core comparison section missing");
    for (const key of ["contract_equal", "core_path_equal", "dialect_equal", "canonical_content_equal", "schema_identity_equal", "schema_surface_equal", "user_version_equal", "deployment_invariant_equal"]) {
      if (typeof comparison[key] !== "boolean") throw new Error(`Core comparison field missing: ${key}`);
    }
    if (Number(process.argv[3]) === 0 && comparison.deployment_invariant_equal !== true) throw new Error("Core exit 0 without equal invariant");
    if (Number(process.argv[3]) === 2 && comparison.deployment_invariant_equal === true) throw new Error("Core exit 2 with equal invariant");
  ' "$report_path" "$core_db" "$compare_exit"; then
    return 0
  else
    printf '%s\n' 'invalid Core comparison report' >&2
    return 64
  fi
}

_autorecall_recent_deployment_core_compare() {
  local report_path="$1"
  local core_db="$2"
  local baseline_path="$3"
  local node="$4"
  local fingerprint_tool="$5"
  local stdout_path="${report_path}.stdout"
  local stderr_path="${report_path}.stderr"
  local compare_exit

  if "$node" "$fingerprint_tool" \
    --compare "$baseline_path" \
    --core-db "$core_db" \
    --out "$report_path" \
    >"$stdout_path" 2>"$stderr_path"; then
    compare_exit=0
  else
    compare_exit=$?
  fi

  if _autorecall_recent_deployment_validate_core_report "$report_path" "$core_db" "$node" "$compare_exit"; then
    AUTORECALL_RECENT_DEPLOYMENT_CORE_EQUAL=0
    if [[ "$compare_exit" == 0 ]]; then
      AUTORECALL_RECENT_DEPLOYMENT_CORE_EQUAL=1
    fi
    return 0
  else
    return 64
  fi
}

_autorecall_recent_deployment_validate_artifact_manifest() {
  local report_path="$1"
  local root_path="$2"
  local node="$3"

  if [[ ! -s "$report_path" ]]; then
    printf '%s\n' 'artifact manifest was not produced' >&2
    return 64
  fi
  if "$node" -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (report.schema_version !== 2) throw new Error("artifact manifest schema mismatch");
    if (report.root_path !== path.resolve(process.argv[2])) throw new Error("artifact manifest root mismatch");
    if (report.valid !== true) throw new Error("artifact manifest validity gate failed");
    for (const key of ["semantic_identity", "topology_identity", "exact_identity"]) {
      if (!/^[a-f0-9]{64}$/.test(report[key] || "")) throw new Error(`artifact manifest identity missing: ${key}`);
    }
  ' "$report_path" "$root_path"; then
    return 0
  else
    printf '%s\n' 'invalid artifact manifest' >&2
    return 64
  fi
}

_autorecall_recent_deployment_build_artifact_manifest() {
  local report_path="$1"
  local root_path="$2"
  local node="$3"
  local build_tool="$4"
  local stdout_path="${report_path}.stdout"
  local stderr_path="${report_path}.stderr"
  local build_exit

  if "$node" "$build_tool" --root "$root_path" --out "$report_path" >"$stdout_path" 2>"$stderr_path"; then
    build_exit=0
  else
    build_exit=$?
  fi
  if [[ "$build_exit" != 0 ]]; then
    printf 'artifact manifest command failed with exit %s\n' "$build_exit" >&2
    return 64
  fi
  _autorecall_recent_deployment_validate_artifact_manifest "$report_path" "$root_path" "$node"
}

_autorecall_recent_deployment_artifact_compare() {
  local report_path="$1"
  local expected_manifest="$2"
  local installed_manifest="$3"
  local node="$4"
  local compare_tool="$5"
  local stdout_path="${report_path}.stdout"
  local stderr_path="${report_path}.stderr"
  local compare_exit

  if "$node" "$compare_tool" \
    --candidate "$expected_manifest" \
    --installed "$installed_manifest" \
    --policy exact \
    --out "$report_path" \
    >"$stdout_path" 2>"$stderr_path"; then
    compare_exit=0
  else
    compare_exit=$?
  fi
  if [[ "$compare_exit" != 0 && "$compare_exit" != 2 ]]; then
    printf 'artifact comparison command failed with exit %s\n' "$compare_exit" >&2
    return 64
  fi
  if [[ ! -s "$report_path" ]]; then
    printf '%s\n' 'artifact comparison did not produce a report' >&2
    return 64
  fi
  if "$node" -e '
    const fs = require("node:fs");
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (report.schema_version !== 2) throw new Error("artifact comparison schema mismatch");
    for (const key of ["candidate_semantic_identity", "installed_semantic_identity", "candidate_exact_identity", "installed_exact_identity"]) {
      if (!/^[a-f0-9]{64}$/.test(report[key] || "")) throw new Error(`artifact comparison identity missing: ${key}`);
    }
    if (typeof report.accepted !== "boolean" || typeof report.decision !== "string" || typeof report.classification !== "string") throw new Error("artifact comparison decision fields missing");
    if (Number(process.argv[2]) === 0 && (report.accepted !== true || report.decision !== "PASS")) throw new Error("artifact exit 0 without accepted report");
    if (Number(process.argv[2]) === 2 && report.accepted === true) throw new Error("artifact exit 2 with accepted report");
  ' "$report_path" "$compare_exit"; then
    AUTORECALL_RECENT_DEPLOYMENT_ARTIFACT_EQUAL=0
    if [[ "$compare_exit" == 0 ]]; then
      AUTORECALL_RECENT_DEPLOYMENT_ARTIFACT_EQUAL=1
    fi
    return 0
  else
    printf '%s\n' 'invalid artifact comparison report' >&2
    return 64
  fi
}

_autorecall_recent_deployment_capture_core_baseline() {
  local baseline_path="$1"
  local core_db="$2"
  local node="$3"
  local fingerprint_tool="$4"
  local stdout_path="${baseline_path}.stdout"
  local stderr_path="${baseline_path}.stderr"
  local capture_exit

  if "$node" "$fingerprint_tool" --core-db "$core_db" --out "$baseline_path" >"$stdout_path" 2>"$stderr_path"; then
    capture_exit=0
  else
    capture_exit=$?
  fi
  if [[ "$capture_exit" != 0 ]]; then
    printf 'Core baseline capture failed with exit %s\n' "$capture_exit" >&2
    return 64
  fi
  _autorecall_recent_deployment_validate_baseline_shape "$baseline_path" "$core_db" "$node"
}

_autorecall_recent_deployment_cron_projection() {
  local input_path="$1"
  local output_path="$2"
  local node="$3"

  if "$node" -e '
    const fs = require("node:fs");
    const input = process.argv[1];
    const output = process.argv[2];
    const raw = fs.readFileSync(input, "utf8");
    if (!raw.trim()) throw new Error("cron output is empty");
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.jobs)) throw new Error("cron output has no jobs array");
    for (const key of ["total", "offset", "hasMore", "nextOffset"]) if (!Object.hasOwn(value, key)) throw new Error(`cron pagination field missing: ${key}`);
    if (!Number.isSafeInteger(value.total) || value.total < 0) throw new Error("cron total is invalid");
    if (!Number.isSafeInteger(value.offset) || value.offset !== 0) throw new Error("cron offset is not zero");
    if (value.hasMore !== false) throw new Error("cron output is paginated or incomplete");
    if (value.nextOffset !== null) throw new Error("cron nextOffset is not terminal");
    if (value.jobs.length !== value.total) throw new Error("cron total does not match the complete jobs list");
    if (value.nextCursor != null || value.next_cursor != null || value.hasMore === true || value.has_more === true) throw new Error("cron output is paginated or incomplete");
    if (value.pagination && (value.pagination.hasMore === true || value.pagination.has_more === true || value.pagination.nextCursor != null || value.pagination.next_cursor != null)) throw new Error("cron output is paginated or incomplete");
    const required = ["id", "enabled", "schedule", "sessionTarget", "wakeMode", "payload"];
    const jobs = value.jobs.map((job, index) => {
      if (!job || typeof job !== "object" || Array.isArray(job)) throw new Error(`cron job ${index} is invalid`);
      for (const key of required) if (!Object.hasOwn(job, key)) throw new Error(`cron job ${index} is missing ${key}`);
      if (typeof job.id !== "string" || !job.id) throw new Error(`cron job ${index} has an invalid id`);
      if (!job.schedule || typeof job.schedule !== "object" || !job.schedule.kind) throw new Error(`cron job ${index} has an invalid schedule`);
      if (!job.payload || typeof job.payload !== "object" || Array.isArray(job.payload)) throw new Error(`cron job ${index} has an invalid payload`);
      return {
        id: job.id,
        agentId: job.agentId ?? null,
        name: job.name ?? null,
        description: job.description ?? null,
        enabled: job.enabled,
        deleteAfterRun: job.deleteAfterRun ?? null,
        schedule: job.schedule,
        sessionTarget: job.sessionTarget,
        wakeMode: job.wakeMode,
        payload: job.payload,
        delivery: job.delivery ?? null,
      };
    });
    const ids = new Set();
    for (const job of jobs) if (ids.has(job.id)) throw new Error(`cron job id is duplicated: ${job.id}`); else ids.add(job.id);
    const sortValue = value => {
      if (Array.isArray(value)) return value.map(sortValue);
      if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortValue(value[key])]));
      return value;
    };
    jobs.sort((left, right) => left.id.localeCompare(right.id));
    fs.writeFileSync(output, `${JSON.stringify(sortValue(jobs))}\n`, { mode: 0o600 });
  ' "$input_path" "$output_path"; then
    return 0
  else
    printf 'invalid or incomplete cron JSON: %s\n' "$input_path" >&2
    return 64
  fi
}

_autorecall_recent_deployment_capture_cron_baseline() {
  local output_path="$1"
  local projection_path="$2"
  local openclaw="$3"
  local node="$4"
  local raw_tmp="${output_path}.tmp.$$"
  local command_stderr="${output_path}.stderr"
  local cron_output
  local cron_exit

  if [[ ! -x "$openclaw" ]]; then
    printf '%s\n' 'fresh cron baseline command is unavailable' >&2
    return 64
  fi
  if cron_output="$("$openclaw" cron list --all --json 2>"$command_stderr")"; then
    cron_exit=0
  else
    cron_exit=$?
  fi
  if [[ "$cron_exit" != 0 || -z "${cron_output//[[:space:]]/}" ]]; then
    printf 'fresh cron baseline command failed with exit %s\n' "$cron_exit" >&2
    return 64
  fi
  if printf '%s\n' "$cron_output" >"$raw_tmp" &&
     _autorecall_recent_deployment_cron_projection "$raw_tmp" "$projection_path.tmp" "$node" &&
     mv -- "$raw_tmp" "$output_path" &&
     mv -- "$projection_path.tmp" "$projection_path"; then
    return 0
  else
    rm -f -- "$raw_tmp" "$projection_path.tmp"
    return 64
  fi
}

_autorecall_recent_deployment_compare_cron() {
  local baseline_path="$1"
  local after_path="$2"
  local baseline_projection="$3"
  local after_projection="$4"
  local node="$5"

  if ! _autorecall_recent_deployment_cron_projection "$baseline_path" "$baseline_projection" "$node"; then
    return 64
  fi
  if ! _autorecall_recent_deployment_cron_projection "$after_path" "$after_projection" "$node"; then
    return 64
  fi
  if cmp -s -- "$baseline_projection" "$after_projection"; then
    return 0
  fi
  return 2
}

_autorecall_recent_deployment_facts_callback() {
  local evidence_dir="$AUTORECALL_RECENT_DEPLOYMENT_EVIDENCE_DIR"
  local facts_count_path="$evidence_dir/facts-count"
  local facts_number=0
  if [[ -f "$facts_count_path" ]]; then
    facts_number="$(<"$facts_count_path")"
  fi
  if [[ ! "$facts_number" =~ ^[0-9]+$ ]]; then
    return 64
  fi
  facts_number=$((facts_number + 1))
  printf '%s\n' "$facts_number" >"$facts_count_path"

  local baseline_path="$AUTORECALL_RECENT_DEPLOYMENT_CORE_INSTALL_BASELINE_PATH"
  local core_db="$AUTORECALL_RECENT_DEPLOYMENT_CORE_DB"
  local node="$AUTORECALL_RECENT_DEPLOYMENT_NODE"
  local fingerprint_tool="$AUTORECALL_RECENT_DEPLOYMENT_CORE_FINGERPRINT_TOOL"
  local core_report="$evidence_dir/core-facts-${facts_number}.json"
  local active_artifact_root="$AUTORECALL_RECENT_DEPLOYMENT_ACTIVE_ARTIFACT_ROOT"
  local artifact_build_tool="$AUTORECALL_RECENT_DEPLOYMENT_ARTIFACT_BUILD_TOOL"
  local artifact_compare_tool="$AUTORECALL_RECENT_DEPLOYMENT_ARTIFACT_COMPARE_TOOL"
  local expected_artifact_manifest
  local installed_artifact_manifest="$evidence_dir/runtime-facts-${facts_number}-installed.json"
  local artifact_report="$evidence_dir/runtime-facts-${facts_number}-compare.json"
  local after_cron="${AUTORECALL_RECENT_DEPLOYMENT_CRON_AFTER_JSON:-}"
  local baseline_projection="$evidence_dir/cron-before-projection.json"
  local after_projection="$evidence_dir/cron-after-${facts_number}-projection.json"
  local baseline_hash
  local launch_observed='unknown'
  local runtime_state='unknown'
  local data_drift='none'
  local cron_rc

  if [[ "$facts_number" == 1 ]]; then
    expected_artifact_manifest="$AUTORECALL_RECENT_DEPLOYMENT_CANDIDATE_ARTIFACT_MANIFEST"
  elif [[ "$facts_number" == 2 ]]; then
    expected_artifact_manifest="$AUTORECALL_RECENT_DEPLOYMENT_ROLLBACK_ARTIFACT_MANIFEST"
  else
    printf '%s\n' 'facts callback invoked outside the bounded candidate/recovery pair' >&2
    return 64
  fi
  if [[ ! -f "$baseline_path" || ! -f "$after_cron" || ! -f "$expected_artifact_manifest" ]]; then
    printf '%s\n' 'facts callback is missing a non-Gateway evidence file' >&2
    return 64
  fi
  baseline_hash="$(_autorecall_recent_deployment_sha256 "$baseline_path")" || return 64
  if [[ "$baseline_hash" != "$AUTORECALL_RECENT_DEPLOYMENT_CORE_INSTALL_BASELINE_SHA256" ]]; then
    printf '%s\n' 'Core INSTALL baseline changed before facts comparison' >&2
    return 64
  fi

  if _autorecall_recent_deployment_core_compare "$core_report" "$core_db" "$baseline_path" "$node" "$fingerprint_tool"; then
    if [[ "$AUTORECALL_RECENT_DEPLOYMENT_CORE_EQUAL" != 1 ]]; then
      data_drift='unexplained'
    fi
  else
    return 64
  fi

  if _autorecall_recent_deployment_build_artifact_manifest \
    "$installed_artifact_manifest" "$active_artifact_root" "$node" "$artifact_build_tool"; then
    :
  else
    printf '%s\n' 'facts callback could not observe the active artifact' >&2
    return 64
  fi
  if _autorecall_recent_deployment_artifact_compare \
    "$artifact_report" \
    "$expected_artifact_manifest" \
    "$installed_artifact_manifest" \
    "$node" \
    "$artifact_compare_tool"; then
    runtime_state='changed'
    if [[ "$AUTORECALL_RECENT_DEPLOYMENT_ARTIFACT_EQUAL" != 1 ]]; then
      data_drift='unexplained'
    fi
  else
    return 64
  fi

  if _autorecall_recent_deployment_compare_cron \
    "$AUTORECALL_RECENT_DEPLOYMENT_CRON_BASELINE_PATH" \
    "$after_cron" \
    "$baseline_projection" \
    "$after_projection" \
    "$node"; then
    cron_rc=0
  else
    cron_rc=$?
    if [[ "$cron_rc" == 2 ]]; then
      data_drift='unexplained'
    else
      printf '%s\n' 'facts callback received invalid cron evidence' >&2
      return 64
    fi
  fi

  if [[ "${AUTORECALL_INSTALL_STEP_INVOKED:-0}" == 1 && "${AUTORECALL_INSTALL_STEP_LAST_EXIT:-not_run}" == 0 ]]; then
    launch_observed='yes'
  fi
  if [[ "$data_drift" == none && "$cron_rc" != 0 ]]; then
    data_drift='unexplained'
  fi

  # The existing helper accepts only these three bounded fields from facts.
  printf 'launch_observed=%s\n' "$launch_observed"
  printf 'runtime_state=%s\n' "$runtime_state"
  printf 'data_drift=%s\n' "$data_drift"
}

_autorecall_recent_deployment_recovery_acceptance_callback() {
  local baseline_hash
  local artifact_report="$AUTORECALL_RECENT_DEPLOYMENT_EVIDENCE_DIR/runtime-facts-2-compare.json"
  local node="$AUTORECALL_RECENT_DEPLOYMENT_NODE"
  if [[ "${AUTORECALL_INSTALL_STEP_RECOVERY_EXIT_CODE:-not_run}" != 0 ]]; then
    printf '%s\n' 'recovery acceptance: recovery command did not exit zero' >&2
    return 64
  fi
  if [[ "${AUTORECALL_INSTALL_STEP_RECOVERY_FACTS_STATUS:-not_run}" != ok ]]; then
    printf '%s\n' 'recovery acceptance: recovery facts are not valid' >&2
    return 64
  fi
  case "${AUTORECALL_INSTALL_STEP_RECOVERY_DATA_DRIFT:-unknown}" in
    none|explained) ;;
    *)
      printf '%s\n' 'recovery acceptance: recovery data drift is not accepted' >&2
      return 64
      ;;
  esac
  if [[ ! -s "$artifact_report" ]] || ! "$node" -e '
    const fs = require("node:fs");
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (report.schema_version !== 2 || report.accepted !== true || report.decision !== "PASS" || report.classification !== "EXACT") throw new Error("recovery artifact is not an exact accepted match");
    if (report.semantic_equal !== true || report.topology_equal !== true) throw new Error("recovery artifact identity is not equal");
    if (report.candidate_exact_identity !== report.installed_exact_identity) throw new Error("recovery artifact exact identity mismatch");
  ' "$artifact_report"; then
    printf '%s\n' 'recovery acceptance: active artifact does not match fresh rollback' >&2
    return 64
  fi
  baseline_hash="$(_autorecall_recent_deployment_sha256 "$AUTORECALL_RECENT_DEPLOYMENT_CORE_INSTALL_BASELINE_PATH")" || return 64
  if [[ "$baseline_hash" != "$AUTORECALL_RECENT_DEPLOYMENT_CORE_INSTALL_BASELINE_SHA256" ]]; then
    printf '%s\n' 'recovery acceptance: Core INSTALL baseline changed' >&2
    return 64
  fi
  local facts_count=0
  if [[ -f "$AUTORECALL_RECENT_DEPLOYMENT_EVIDENCE_DIR/facts-count" ]]; then
    facts_count="$(<"$AUTORECALL_RECENT_DEPLOYMENT_EVIDENCE_DIR/facts-count")"
  fi
  if [[ ! "$facts_count" =~ ^[0-9]+$ || "$facts_count" -lt 2 ]]; then
    printf '%s\n' 'recovery acceptance: recovery facts callback was not observed' >&2
    return 64
  fi
  return 0
}

_autorecall_recent_deployment_run_callback() {
  local phase="$1"
  local callback="$2"
  local evidence_dir="$3"
  local stdout_path="$evidence_dir/${phase}.stdout"
  local stderr_path="$evidence_dir/${phase}.stderr"
  local callback_exit

  if "$callback" >"$stdout_path" 2>"$stderr_path"; then
    callback_exit=0
  else
    callback_exit=$?
  fi
  if [[ "$callback_exit" == 0 ]]; then
    return 0
  fi
  printf '%s callback failed with exit %s\n' "$phase" "$callback_exit" >&2
  return 64
}

autorecall_recent_deployment_run() (
  set -Eeuo pipefail

  if (($# != 6)); then
    printf '%s\n' 'usage: autorecall_recent_deployment_run <candidate-dir> <rollback-dir> <evidence-dir> <core-db> <stop-callback> <ddl-callback>' >&2
    _autorecall_recent_deployment_emit_blocked 'validation_failed'
    return 64
  fi

  local candidate_dir="$1"
  local rollback_dir="$2"
  local evidence_dir="$3"
  local core_db="$4"
  local stop_callback="$5"
  local ddl_callback="$6"
  local node="${AUTORECALL_DEPLOYMENT_NODE:-${INSTALL_STEP_NODE:-/home/lionsol/.local/node24/bin/node}}"
  local fingerprint_tool="${AUTORECALL_DEPLOYMENT_CORE_FINGERPRINT_TOOL:-$_autorecall_recent_deployment_callbacks_dir/../../bin/core-deployment-logical-fingerprint.js}"
  local artifact_build_tool="${AUTORECALL_DEPLOYMENT_ARTIFACT_BUILD_TOOL:-$_autorecall_recent_deployment_callbacks_dir/../../bin/build-runtime-artifact-manifest-v2.cjs}"
  local artifact_compare_tool="${AUTORECALL_DEPLOYMENT_ARTIFACT_COMPARE_TOOL:-$_autorecall_recent_deployment_callbacks_dir/../../bin/compare-runtime-artifact-manifests-v2.cjs}"
  local active_artifact_root="${AUTORECALL_DEPLOYMENT_ACTIVE_ARTIFACT_ROOT:-}"
  local openclaw="${AUTORECALL_DEPLOYMENT_OPENCLAW:-}"
  local install_entrypoint="${AUTORECALL_DEPLOYMENT_INSTALL_ENTRYPOINT:-${INSTALL_STEP_OPENCLAW_ENTRYPOINT:-}}"
  local install_cwd="${AUTORECALL_DEPLOYMENT_INSTALL_CWD:-${INSTALL_STEP_CWD:-}}"
  local install_path="${AUTORECALL_DEPLOYMENT_INSTALL_PATH:-${INSTALL_STEP_PATH:-${PATH:-}}}"
  local baseline_path="$evidence_dir/core-post-index.json"
  local baseline_self_compare="$evidence_dir/core-post-index-self-compare.json"
  local candidate_artifact_manifest="$evidence_dir/candidate-runtime-manifest.json"
  local rollback_artifact_manifest="$evidence_dir/rollback-runtime-manifest.json"
  local baseline_sha
  local helper_result
  local helper_rc
  local validation_error=''

  if ! _autorecall_recent_deployment_valid_callback 'stop' "$stop_callback"; then
    validation_error='stop callback'
  elif ! _autorecall_recent_deployment_valid_callback 'ddl' "$ddl_callback"; then
    validation_error='ddl callback'
  elif [[ ! -d "$candidate_dir" ]]; then
    validation_error='candidate directory'
  elif [[ ! -d "$rollback_dir" ]]; then
    validation_error='rollback directory'
  elif [[ -z "$core_db" || ! -f "$core_db" ]]; then
    validation_error='Core DB path'
  elif [[ ! -f "$node" ]]; then
    validation_error='Node path'
  elif [[ ! -f "$fingerprint_tool" ]]; then
    validation_error='Core fingerprint tool'
  elif [[ ! -f "$artifact_build_tool" ]]; then
    validation_error='artifact manifest builder'
  elif [[ ! -f "$artifact_compare_tool" ]]; then
    validation_error='artifact manifest comparator'
  elif [[ -z "$active_artifact_root" || ! -d "$active_artifact_root" ]]; then
    validation_error='active artifact root'
  elif [[ -z "$openclaw" || ! -x "$openclaw" ]]; then
    validation_error='fresh cron command'
  elif [[ -z "$install_entrypoint" || ! -f "$install_entrypoint" ]]; then
    validation_error='install entrypoint'
  elif [[ -z "$install_cwd" || ! -d "$install_cwd" ]]; then
    validation_error='install cwd'
  elif [[ -z "$install_path" ]]; then
    validation_error='install PATH'
  fi
  if [[ -n "$validation_error" ]]; then
    printf 'deployment callback preflight argument is invalid: %s\n' "$validation_error" >&2
    _autorecall_recent_deployment_emit_blocked 'validation_failed'
    return 64
  fi
  if mkdir -p -- "$evidence_dir"; then :; else
    _autorecall_recent_deployment_emit_blocked 'evidence_setup_failed'
    return 64
  fi

  # The Core INSTALL baseline is created only after the fresh cron snapshot,
  # Gateway stop, and DDL callback.  Facts reuse this fixed path and never
  # recapture it after installation.
  export AUTORECALL_RECENT_DEPLOYMENT_EVIDENCE_DIR="$evidence_dir"
  export AUTORECALL_RECENT_DEPLOYMENT_CORE_INSTALL_BASELINE_PATH="$baseline_path"
  export AUTORECALL_RECENT_DEPLOYMENT_CORE_DB="$core_db"
  export AUTORECALL_RECENT_DEPLOYMENT_NODE="$node"
  export AUTORECALL_RECENT_DEPLOYMENT_CORE_FINGERPRINT_TOOL="$fingerprint_tool"
  export AUTORECALL_RECENT_DEPLOYMENT_ACTIVE_ARTIFACT_ROOT="$active_artifact_root"
  export AUTORECALL_RECENT_DEPLOYMENT_ARTIFACT_BUILD_TOOL="$artifact_build_tool"
  export AUTORECALL_RECENT_DEPLOYMENT_ARTIFACT_COMPARE_TOOL="$artifact_compare_tool"
  export AUTORECALL_RECENT_DEPLOYMENT_CANDIDATE_ARTIFACT_MANIFEST="$candidate_artifact_manifest"
  export AUTORECALL_RECENT_DEPLOYMENT_ROLLBACK_ARTIFACT_MANIFEST="$rollback_artifact_manifest"
  export AUTORECALL_RECENT_DEPLOYMENT_CRON_BASELINE_PATH="$evidence_dir/cron-before.json"
  export AUTORECALL_RECENT_DEPLOYMENT_CRON_AFTER_JSON="${AUTORECALL_DEPLOYMENT_CRON_AFTER_JSON:-}"

  # Fresh complete cron baseline must be captured and validated before any
  # stop or DDL callback.  The facts callback later reads a direct file only.
  if _autorecall_recent_deployment_capture_cron_baseline \
    "$AUTORECALL_RECENT_DEPLOYMENT_CRON_BASELINE_PATH" \
    "$evidence_dir/cron-before-projection.json" \
    "$openclaw" "$node"; then
    :
  else
    _autorecall_recent_deployment_emit_blocked 'cron_baseline_invalid'
    return 64
  fi

  if _autorecall_recent_deployment_run_callback 'stop' "$stop_callback" "$evidence_dir" &&
     _autorecall_recent_deployment_run_callback 'ddl' "$ddl_callback" "$evidence_dir"; then
    :
  else
    _autorecall_recent_deployment_emit_blocked 'pre_install_callback_failed'
    return 64
  fi

  # DDL is complete at this point.  Only now create, self-compare, and freeze
  # the immutable Core INSTALL baseline that candidate and recovery facts use.
  if _autorecall_recent_deployment_capture_core_baseline \
    "$baseline_path" "$core_db" "$node" "$fingerprint_tool"; then
    :
  else
    _autorecall_recent_deployment_emit_blocked 'core_install_baseline_invalid'
    return 64
  fi
  if _autorecall_recent_deployment_core_compare "$baseline_self_compare" "$core_db" "$baseline_path" "$node" "$fingerprint_tool"; then
    if [[ "$AUTORECALL_RECENT_DEPLOYMENT_CORE_EQUAL" != 1 ]]; then
      printf '%s\n' 'Core INSTALL baseline self-compare is not equal' >&2
      _autorecall_recent_deployment_emit_blocked 'core_install_baseline_not_equal'
      return 64
    fi
  else
    _autorecall_recent_deployment_emit_blocked 'core_install_baseline_compare_failed'
    return 64
  fi
  baseline_sha="$(_autorecall_recent_deployment_sha256 "$baseline_path")" || {
    _autorecall_recent_deployment_emit_blocked 'core_install_baseline_invalid'
    return 64
  }
  export AUTORECALL_RECENT_DEPLOYMENT_CORE_INSTALL_BASELINE_SHA256="$baseline_sha"

  if _autorecall_recent_deployment_build_artifact_manifest \
    "$candidate_artifact_manifest" "$candidate_dir" "$node" "$artifact_build_tool" &&
     _autorecall_recent_deployment_build_artifact_manifest \
    "$rollback_artifact_manifest" "$rollback_dir" "$node" "$artifact_build_tool"; then
    :
  else
    _autorecall_recent_deployment_emit_blocked 'runtime_baseline_invalid'
    return 64
  fi

  export INSTALL_STEP_NODE="$node"
  export INSTALL_STEP_OPENCLAW_ENTRYPOINT="$install_entrypoint"
  export INSTALL_STEP_CWD="$install_cwd"
  export INSTALL_STEP_PATH="$install_path"

  if helper_result="$(autorecall_install_step \
    "$candidate_dir" \
    "$rollback_dir" \
    _autorecall_recent_deployment_facts_callback \
    _autorecall_recent_deployment_recovery_acceptance_callback)"; then
    helper_rc=0
  else
    helper_rc=$?
  fi
  printf '%s\n' "$helper_result"
  return "$helper_rc"
)
