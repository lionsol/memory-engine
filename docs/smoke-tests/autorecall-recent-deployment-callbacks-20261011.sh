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

_autorecall_recent_deployment_candidate_root_mode_exception() {
  local report_path="$1"
  local expected_manifest="$2"
  local installed_manifest="$3"
  local node="$4"

  # The exact v2 report remains unchanged.  This caller classifies only the
  # one candidate install-root permission normalization allowed here.
  if "$node" -e '
    const fs = require("node:fs");
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const expected = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const installed = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
    const validIdentity = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
    if (expected.schema_version !== 2 || installed.schema_version !== 2 || expected.valid !== true || installed.valid !== true) throw new Error("artifact manifest is not valid");
    if (!validIdentity(expected.semantic_identity) || !validIdentity(expected.topology_identity) || !validIdentity(expected.exact_identity)) throw new Error("candidate artifact identity is missing");
    if (!validIdentity(installed.semantic_identity) || !validIdentity(installed.topology_identity) || !validIdentity(installed.exact_identity)) throw new Error("installed artifact identity is missing");
    if (report.schema_version !== 2 || report.policy !== "exact" || report.accepted !== false || report.decision !== "REJECT" || report.classification !== "SEMANTIC_MISMATCH") throw new Error("unexpected exact comparison decision");
    if (report.semantic_equal !== false || report.topology_equal !== true) throw new Error("root mode exception changed more than semantic root mode");
    if (report.candidate_semantic_identity !== expected.semantic_identity || report.installed_semantic_identity !== installed.semantic_identity) throw new Error("comparison manifest identity mismatch");
    if (report.candidate_topology_identity !== expected.topology_identity || report.installed_topology_identity !== installed.topology_identity) throw new Error("comparison topology identity mismatch");
    const difference = report.semantic_difference;
    if (!difference || difference.difference_count !== 1 || difference.changed_field_count !== 1 || difference.changed_path_count !== 1 || difference.changed_paths_truncated !== false || !Array.isArray(difference.changed_paths) || difference.changed_paths.length !== 1) throw new Error("root mode difference is not complete and singular");
    const change = difference.changed_paths[0];
    if (change.path !== "." || change.change_type !== "changed" || change.changed_fields.length !== 1 || change.changed_fields[0] !== "mode") throw new Error("unexpected candidate artifact difference");
    if (change.candidate?.type !== "directory" || change.installed?.type !== "directory" || change.candidate?.mode !== "0755" || change.installed?.mode !== "0700") throw new Error("unexpected root directory modes");
    if (expected.root_entry_type !== "directory" || installed.root_entry_type !== "directory" || expected.root_mode !== "0755" || installed.root_mode !== "0700") throw new Error("root manifest modes are not bound");
    if (report.topology_difference?.new_sharing_pair_count !== 0 || report.topology_difference?.removed_sharing_pair_count !== 0) throw new Error("topology changed");
  ' "$report_path" "$expected_manifest" "$installed_manifest"; then
    return 0
  else
    return 1
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

_autorecall_recent_deployment_validate_engine_fingerprint() {
  local report_path="$1"
  local engine_db="$2"
  local node="$3"

  if [[ ! -s "$report_path" ]]; then
    printf '%s\n' 'Engine fingerprint was not produced' >&2
    return 64
  fi
  if "$node" -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (report.contract !== "engine_deployment_fingerprint_v1") throw new Error("Engine fingerprint contract mismatch");
    if (report.engine_db_path !== path.resolve(process.argv[2])) throw new Error("Engine fingerprint path mismatch");
    for (const key of ["engine_invariant_sha256", "content_sha256", "schema_sha256"]) {
      if (!/^[a-f0-9]{64}$/.test(report[key] || "")) throw new Error(`Engine fingerprint field missing: ${key}`);
    }
    if (!Number.isSafeInteger(report.pragma_user_version) || report.pragma_user_version < 0) throw new Error("Engine user_version is invalid");
    if (!Number.isSafeInteger(report.pragma_schema_version) || report.pragma_schema_version < 0) throw new Error("Engine schema_version is invalid");
    if (!report.physical || !Number.isSafeInteger(report.physical.size_bytes) || !/^[a-f0-9]{64}$/.test(report.physical.sha256 || "")) throw new Error("Engine physical fingerprint is missing");
  ' "$report_path" "$engine_db"; then
    return 0
  else
    printf '%s\n' 'invalid Engine fingerprint' >&2
    return 64
  fi
}

_autorecall_recent_deployment_capture_engine_fingerprint() {
  local report_path="$1"
  local engine_db="$2"
  local node="$3"
  local require_path="$4"
  local stdout_path="${report_path}.stdout"
  local stderr_path="${report_path}.stderr"
  local capture_exit

  if "$node" -e '
    const { createHash } = require("node:crypto");
    const { readFileSync, statSync, writeFileSync } = require("node:fs");
    const { resolve } = require("node:path");
    const { createRequire } = require("node:module");
    const dbPath = resolve(process.argv[1]);
    const outputPath = resolve(process.argv[2]);
    const requirePath = resolve(process.argv[3]);
    const Database = createRequire(requirePath)("better-sqlite3");
    const bytes = readFileSync(dbPath);
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      db.pragma("query_only = ON");
      const schema = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all();
      const userVersion = db.prepare("PRAGMA user_version").get().user_version;
      const schemaVersion = db.prepare("PRAGMA schema_version").get().schema_version;
      const schemaSha = createHash("sha256").update(JSON.stringify(schema)).digest("hex");
      const contentHasher = createHash("sha256");
      const typeAndLengthUpdate = (value) => {
        let type;
        let raw;
        if (value === null || value === undefined) {
          type = "null";
          raw = Buffer.alloc(0);
        } else if (Buffer.isBuffer(value)) {
          type = "blob";
          raw = value;
        } else if (typeof value === "bigint") {
          type = "bigint";
          raw = Buffer.from(value.toString(), "utf8");
        } else {
          type = typeof value;
          raw = Buffer.from(String(value), "utf8");
        }
        const typeBytes = Buffer.from(type, "utf8");
        const length = Buffer.alloc(8);
        length.writeBigUInt64BE(BigInt(raw.byteLength));
        contentHasher.update(typeBytes);
        contentHasher.update(Buffer.from([0]));
        contentHasher.update(length);
        contentHasher.update(raw);
      };
      const quote = value => "\"" + String(value).replaceAll("\"", "\"\"") + "\"";
      for (const table of schema.filter(row => row.type === "table" && !String(row.name).startsWith("sqlite_"))) {
        const columns = db.prepare("PRAGMA table_info(" + quote(table.name) + ")").all().sort((a, b) => a.cid - b.cid);
        const order = columns.map(column => quote(column.name)).join(", ");
        const query = "SELECT * FROM " + quote(table.name) + (order ? " ORDER BY " + order : "");
        contentHasher.update(Buffer.from("table:" + table.name + "\u0000", "utf8"));
        for (const row of db.prepare(query).iterate()) {
          contentHasher.update(Buffer.from("row\u0000", "utf8"));
          for (const column of columns) typeAndLengthUpdate(row[column.name]);
        }
      }
      const contentSha = contentHasher.digest("hex");
      const physicalSha = createHash("sha256").update(bytes).digest("hex");
      const invariantSha = createHash("sha256").update(JSON.stringify({ contentSha, schemaSha, userVersion, schemaVersion })).digest("hex");
      const stats = statSync(dbPath);
      writeFileSync(outputPath, `${JSON.stringify({
        contract: "engine_deployment_fingerprint_v1",
        engine_db_path: dbPath,
        engine_invariant_sha256: invariantSha,
        content_sha256: contentSha,
        schema_sha256: schemaSha,
        pragma_user_version: userVersion,
        pragma_schema_version: schemaVersion,
        physical: { size_bytes: stats.size, mtime_ms: stats.mtimeMs, sha256: physicalSha },
      })}\n`, { mode: 0o600 });
    } finally {
      db.close();
    }
  ' "$engine_db" "$report_path" "$require_path" >"$stdout_path" 2>"$stderr_path"; then
    capture_exit=0
  else
    capture_exit=$?
  fi
  if [[ "$capture_exit" != 0 ]]; then
    printf 'Engine fingerprint capture failed with exit %s\n' "$capture_exit" >&2
    return 64
  fi
  _autorecall_recent_deployment_validate_engine_fingerprint "$report_path" "$engine_db" "$node"
}

_autorecall_recent_deployment_compare_engine_fingerprint() {
  local baseline_path="$1"
  local after_path="$2"
  local report_path="$3"
  local engine_db="$4"
  local node="$5"
  local compare_exit

  if "$node" -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const baseline = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const after = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const expected = path.resolve(process.argv[3]);
    if (baseline.contract !== "engine_deployment_fingerprint_v1" || after.contract !== baseline.contract) throw new Error("Engine fingerprint contract mismatch");
    if (baseline.engine_db_path !== expected || after.engine_db_path !== expected) throw new Error("Engine fingerprint path mismatch");
    const comparison = {
      contract: "engine_deployment_fingerprint_v1",
      engine_db_path: expected,
      valid: true,
      engine_invariant_equal: baseline.engine_invariant_sha256 === after.engine_invariant_sha256,
      content_equal: baseline.content_sha256 === after.content_sha256,
      schema_equal: baseline.schema_sha256 === after.schema_sha256,
      user_version_equal: baseline.pragma_user_version === after.pragma_user_version,
      physical_sha_equal: baseline.physical?.sha256 === after.physical?.sha256,
    };
    fs.writeFileSync(path.resolve(process.argv[4]), `${JSON.stringify(comparison)}\n`, { mode: 0o600 });
    process.exitCode = comparison.engine_invariant_equal ? 0 : 2;
  ' "$baseline_path" "$after_path" "$engine_db" "$report_path"; then
    compare_exit=0
  else
    compare_exit=$?
  fi
  if [[ "$compare_exit" != 0 && "$compare_exit" != 2 ]]; then
    printf 'Engine fingerprint comparison failed with exit %s\n' "$compare_exit" >&2
    return 64
  fi
  if ! "$node" -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (report.contract !== "engine_deployment_fingerprint_v1" || report.engine_db_path !== path.resolve(process.argv[2]) || report.valid !== true) throw new Error("invalid Engine comparison report");
    for (const key of ["engine_invariant_equal", "content_equal", "schema_equal", "user_version_equal", "physical_sha_equal"]) if (typeof report[key] !== "boolean") throw new Error(`Engine comparison field missing: ${key}`);
    if (Number(process.argv[3]) === 0 && report.engine_invariant_equal !== true) throw new Error("Engine exit 0 without equal invariant");
    if (Number(process.argv[3]) === 2 && report.engine_invariant_equal === true) throw new Error("Engine exit 2 with equal invariant");
  ' "$report_path" "$engine_db" "$compare_exit"; then
    printf '%s\n' 'invalid Engine comparison report' >&2
    return 64
  fi
  AUTORECALL_RECENT_DEPLOYMENT_ENGINE_EQUAL=0
  if [[ "$compare_exit" == 0 ]]; then AUTORECALL_RECENT_DEPLOYMENT_ENGINE_EQUAL=1; fi
  return 0
}

_autorecall_recent_deployment_capture_cron_after() {
  local store_path="$1"
  local output_path="$2"
  local projection_path="$3"
  local node="$4"
  local raw_tmp="${output_path}.tmp.$$"
  if [[ ! -f "$store_path" || ! -s "$store_path" ]]; then
    printf '%s\n' 'confirmed host cron store is unavailable after child' >&2
    return 64
  fi
  if cp -- "$store_path" "$raw_tmp" &&
     _autorecall_recent_deployment_cron_projection "$raw_tmp" "${projection_path}.tmp" "$node" &&
     mv -- "$raw_tmp" "$output_path" &&
     mv -- "${projection_path}.tmp" "$projection_path"; then
    return 0
  fi
  rm -f -- "$raw_tmp" "${projection_path}.tmp"
  printf '%s\n' 'invalid confirmed host cron store after child' >&2
  return 64
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
  local report_path="${6:-}"
  local equal=0

  if ! _autorecall_recent_deployment_cron_projection "$baseline_path" "$baseline_projection" "$node"; then
    return 64
  fi
  if ! _autorecall_recent_deployment_cron_projection "$after_path" "$after_projection" "$node"; then
    return 64
  fi
  if cmp -s -- "$baseline_projection" "$after_projection"; then
    equal=1
  fi
  if [[ -n "$report_path" ]]; then
    if ! "$node" -e '
      const fs = require("node:fs");
      const path = require("node:path");
      const report = {
        contract: "autorecall_cron_equivalence_v1",
        valid: true,
        baseline_path: path.resolve(process.argv[1]),
        after_path: path.resolve(process.argv[2]),
        definition_equal: Number(process.argv[3]) === 1,
        baseline_projection_sha256: require("node:crypto").createHash("sha256").update(fs.readFileSync(process.argv[4])).digest("hex"),
        after_projection_sha256: require("node:crypto").createHash("sha256").update(fs.readFileSync(process.argv[5])).digest("hex"),
      };
      fs.writeFileSync(path.resolve(process.argv[6]), `${JSON.stringify(report)}\n`, { mode: 0o600 });
    ' "$baseline_path" "$after_path" "$equal" "$baseline_projection" "$after_projection" "$report_path"; then
      return 64
    fi
  fi
  if [[ "$equal" == 1 ]]; then
    return 0
  fi
  return 2
}

_autorecall_recent_deployment_validate_config_snapshot() {
  local source_path="$1"
  local node="$2"
  if [[ ! -f "$source_path" || ! -s "$source_path" ]]; then
    printf '%s\n' 'config snapshot source is unavailable' >&2
    return 64
  fi
  if "$node" -e '
    const fs = require("node:fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("config snapshot must be an object");
    if (!value.meta || typeof value.meta !== "object" || Array.isArray(value.meta)) throw new Error("config snapshot meta is missing");
  ' "$source_path"; then
    return 0
  else
    printf '%s\n' 'invalid config snapshot' >&2
    return 64
  fi
}

_autorecall_recent_deployment_capture_config_baseline() {
  local source_path="$1"
  local output_path="$2"
  local node="$3"
  if _autorecall_recent_deployment_validate_config_snapshot "$source_path" "$node" &&
     cp -- "$source_path" "$output_path" &&
     _autorecall_recent_deployment_validate_config_snapshot "$output_path" "$node"; then
    return 0
  fi
  printf '%s\n' 'config baseline capture failed' >&2
  return 64
}

_autorecall_recent_deployment_config_compare() {
  local baseline_path="$1"
  local after_path="$2"
  local report_path="$3"
  local node="$4"
  local equivalence_tool="$5"
  local stdout_path="${report_path}.stdout"
  local stderr_path="${report_path}.stderr"
  local compare_exit

  if "$node" "$equivalence_tool" --before "$baseline_path" --after "$after_path" --out "$report_path" >"$stdout_path" 2>"$stderr_path"; then
    compare_exit=0
  else
    compare_exit=$?
  fi
  if [[ "$compare_exit" != 0 && "$compare_exit" != 2 ]]; then
    printf 'config comparison failed with exit %s\n' "$compare_exit" >&2
    return 64
  fi
  if ! "$node" -e '
    const fs = require("node:fs");
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (report.schema_version !== 1 || report.policy !== "memory-engine-config-semantic-equivalence-v1" || typeof report.valid !== "boolean") throw new Error("invalid config comparison report");
    if (!Array.isArray(report.changed_paths) || !Array.isArray(report.unexpected_changed_paths)) throw new Error("config comparison paths are missing");
    if (Number(process.argv[2]) === 0 && report.valid !== true) throw new Error("config exit 0 without valid report");
    if (Number(process.argv[2]) === 2 && report.valid === true) throw new Error("config exit 2 with valid report");
  ' "$report_path" "$compare_exit"; then
    printf '%s\n' 'invalid config comparison report' >&2
    return 64
  fi
  AUTORECALL_RECENT_DEPLOYMENT_CONFIG_EQUAL=0
  if [[ "$compare_exit" == 0 ]]; then AUTORECALL_RECENT_DEPLOYMENT_CONFIG_EQUAL=1; fi
  return 0
}

_autorecall_recent_deployment_record_candidate_unexplained_drift() {
  local kind="$1"
  local report_path="$2"
  local baseline_path="$3"
  local binding_path="$4"
  local node="$5"
  local marker_path="$AUTORECALL_RECENT_DEPLOYMENT_EVIDENCE_DIR/candidate-unexplained-drift-${kind}.json"

  if "$node" -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const crypto = require("node:crypto");
    const [markerPath, kind, reportPath, baselinePath, bindingPath] = process.argv.slice(1);
    const fail = message => { throw new Error(message); };
    const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
    const sha256 = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    const resolved = file => path.resolve(file);
    const reportFile = resolved(reportPath);
    const baselineFile = resolved(baselinePath);
    const bindingFile = resolved(bindingPath);
    if (!fs.statSync(reportFile).isFile() || !fs.statSync(baselineFile).isFile() || !fs.statSync(bindingFile).isFile()) fail("candidate drift evidence source is not a file");
    const report = readJson(reportFile);
    const baseline = readJson(baselineFile);
    const validSha = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
    const validManifest = value => value && value.schema_version === 2 && value.valid === true
      && validSha(value.semantic_identity) && validSha(value.topology_identity) && validSha(value.exact_identity);
    if (kind === "core") {
      if (report.contract !== "core_deployment_logical_fingerprint_v1" || report.comparison?.deployment_invariant_equal !== false) fail("candidate Core comparison is not confirmed unexplained");
      if (report.comparison.baseline_path !== baselineFile || report.comparison.core_path_equal !== true) fail("candidate Core comparison is not bound to the INSTALL baseline");
      if (baseline.contract !== "core_deployment_logical_fingerprint_v1" || !validSha(baseline.deployment_invariant_sha256)) fail("candidate Core baseline is invalid");
    } else if (kind === "engine") {
      if (report.contract !== "engine_deployment_fingerprint_v1" || report.valid !== true || report.engine_invariant_equal !== false) fail("candidate Engine comparison is not confirmed unexplained");
      if (baseline.contract !== "engine_deployment_fingerprint_v1" || !validSha(baseline.engine_invariant_sha256)) fail("candidate Engine baseline is invalid");
    } else if (kind === "lance" || kind === "runtime") {
      if (!validManifest(baseline) || report.schema_version !== 2 || report.accepted !== false || report.decision !== "REJECT" || report.semantic_equal !== false) fail(`candidate ${kind} artifact comparison is not confirmed unexplained`);
      if (report.candidate_semantic_identity !== baseline.semantic_identity || report.candidate_topology_identity !== baseline.topology_identity || report.candidate_exact_identity !== baseline.exact_identity) fail(`candidate ${kind} artifact comparison is not bound to its manifest`);
      const difference = report.semantic_difference;
      const rootModeOnly = kind === "runtime"
        && report.topology_equal === true
        && difference?.difference_count === 1
        && difference?.changed_field_count === 1
        && difference?.changed_path_count === 1
        && difference?.changed_paths_truncated === false
        && difference?.changed_paths?.length === 1
        && difference.changed_paths[0]?.path === "."
        && difference.changed_paths[0]?.change_type === "changed"
        && difference.changed_paths[0]?.changed_fields?.length === 1
        && difference.changed_paths[0]?.changed_fields[0] === "mode"
        && difference.changed_paths[0]?.candidate?.type === "directory"
        && difference.changed_paths[0]?.installed?.type === "directory"
        && difference.changed_paths[0]?.candidate?.mode === "0755"
        && difference.changed_paths[0]?.installed?.mode === "0700";
      if (rootModeOnly) fail("candidate runtime root mode exception is not unexplained drift");
    } else if (kind === "config") {
      if (report.schema_version !== 1 || report.valid !== false || !Array.isArray(report.changed_paths) || !Array.isArray(report.unexpected_changed_paths)) fail("candidate config comparison is not confirmed unexplained");
    } else if (kind === "cron") {
      if (report.contract !== "autorecall_cron_equivalence_v1" || report.valid !== true || report.definition_equal !== false) fail("candidate cron comparison is not confirmed unexplained");
      if (report.baseline_path !== baselineFile) fail("candidate cron comparison is not bound to its baseline");
    } else fail(`unsupported candidate drift kind: ${kind}`);

    const record = {
      contract: "autorecall_candidate_unexplained_drift_v1",
      kind,
      report_path: reportFile,
      report_sha256: sha256(reportFile),
      baseline_path: baselineFile,
      baseline_sha256: sha256(baselineFile),
      binding_path: bindingFile,
      binding_sha256: sha256(bindingFile),
    };
    if (fs.existsSync(markerPath)) {
      const existing = readJson(markerPath);
      for (const key of Object.keys(record)) if (existing[key] !== record[key]) fail("candidate drift latch does not match current evidence");
    } else {
      fs.writeFileSync(markerPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    }
  ' "$marker_path" "$kind" "$report_path" "$baseline_path" "$binding_path"; then
    return 0
  else
    printf 'could not persist confirmed candidate %s drift evidence\n' "$kind" >&2
    return 64
  fi
}

_autorecall_recent_deployment_validate_candidate_unexplained_drift_marker() {
  local marker_path="$1"
  local node="$2"

  if "$node" -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const crypto = require("node:crypto");
    const [markerPath] = process.argv.slice(1);
    const fail = message => { throw new Error(message); };
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    if (marker.contract !== "autorecall_candidate_unexplained_drift_v1") fail("candidate drift latch contract mismatch");
    for (const key of ["kind", "report_path", "baseline_path", "binding_path", "report_sha256", "baseline_sha256", "binding_sha256"]) if (typeof marker[key] !== "string" || !marker[key]) fail(`candidate drift latch field missing: ${key}`);
    const sha256 = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    for (const [key, digestKey] of [["report_path", "report_sha256"], ["baseline_path", "baseline_sha256"], ["binding_path", "binding_sha256"]]) {
      if (!fs.statSync(marker[key]).isFile() || sha256(marker[key]) !== marker[digestKey]) fail(`candidate drift latch ${key} changed`);
    }
    const report = JSON.parse(fs.readFileSync(marker.report_path, "utf8"));
    const baseline = JSON.parse(fs.readFileSync(marker.baseline_path, "utf8"));
    const validSha = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
    const validManifest = value => value && value.schema_version === 2 && value.valid === true
      && validSha(value.semantic_identity) && validSha(value.topology_identity) && validSha(value.exact_identity);
    switch (marker.kind) {
      case "core":
        if (report.contract !== "core_deployment_logical_fingerprint_v1" || report.comparison?.deployment_invariant_equal !== false || report.comparison?.baseline_path !== path.resolve(marker.baseline_path)) fail("candidate Core drift latch is not confirmed");
        if (baseline.contract !== "core_deployment_logical_fingerprint_v1" || !validSha(baseline.deployment_invariant_sha256)) fail("candidate Core drift baseline is invalid");
        break;
      case "engine":
        if (report.contract !== "engine_deployment_fingerprint_v1" || report.valid !== true || report.engine_invariant_equal !== false) fail("candidate Engine drift latch is not confirmed");
        if (baseline.contract !== "engine_deployment_fingerprint_v1" || !validSha(baseline.engine_invariant_sha256)) fail("candidate Engine drift baseline is invalid");
        break;
      case "lance":
      case "runtime": {
        if (!validManifest(baseline) || report.schema_version !== 2 || report.accepted !== false || report.decision !== "REJECT" || report.semantic_equal !== false) fail(`candidate ${marker.kind} drift latch is not confirmed`);
        if (report.candidate_semantic_identity !== baseline.semantic_identity || report.candidate_topology_identity !== baseline.topology_identity || report.candidate_exact_identity !== baseline.exact_identity) fail(`candidate ${marker.kind} drift latch is not bound to its manifest`);
        const difference = report.semantic_difference;
        const rootModeOnly = marker.kind === "runtime"
          && report.topology_equal === true
          && difference?.difference_count === 1
          && difference?.changed_field_count === 1
          && difference?.changed_path_count === 1
          && difference?.changed_paths_truncated === false
          && difference?.changed_paths?.length === 1
          && difference.changed_paths[0]?.path === "."
          && difference.changed_paths[0]?.changed_fields?.length === 1
          && difference.changed_paths[0]?.changed_fields[0] === "mode"
          && difference.changed_paths[0]?.candidate?.mode === "0755"
          && difference.changed_paths[0]?.installed?.mode === "0700";
        if (rootModeOnly) fail("candidate runtime root mode exception was latched as unexplained");
        break;
      }
      case "config":
        if (report.schema_version !== 1 || report.valid !== false || !Array.isArray(report.changed_paths) || !Array.isArray(report.unexpected_changed_paths)) fail("candidate config drift latch is not confirmed");
        break;
      case "cron":
        if (report.contract !== "autorecall_cron_equivalence_v1" || report.valid !== true || report.definition_equal !== false || report.baseline_path !== path.resolve(marker.baseline_path)) fail("candidate cron drift latch is not confirmed");
        break;
      default:
        fail(`unsupported candidate drift kind: ${marker.kind}`);
    }
  ' "$marker_path"; then
    return 0
  else
    printf 'invalid or changed candidate drift latch: %s\n' "$marker_path" >&2
    return 64
  fi
}

_autorecall_recent_deployment_validate_candidate_unexplained_drift_latch() {
  local evidence_dir="$AUTORECALL_RECENT_DEPLOYMENT_EVIDENCE_DIR"
  local node="$AUTORECALL_RECENT_DEPLOYMENT_NODE"
  local kind
  local found=0
  local marker_path
  for kind in core engine lance config cron runtime; do
    marker_path="$evidence_dir/candidate-unexplained-drift-${kind}.json"
    if [[ -e "$marker_path" ]]; then
      found=1
      if ! _autorecall_recent_deployment_validate_candidate_unexplained_drift_marker "$marker_path" "$node"; then
        return 64
      fi
    fi
  done
  if ((found)); then
    printf '%s\n' 'candidate comparison confirmed unexplained drift; recovery acceptance is blocked' >&2
    return 0
  fi
  return 1
}

_autorecall_recent_deployment_capture_config_after() {
  local source_path="$1"
  local output_path="$2"
  local node="$3"
  if _autorecall_recent_deployment_validate_config_snapshot "$source_path" "$node" && cp -- "$source_path" "$output_path"; then
    return 0
  fi
  printf '%s\n' 'config after snapshot capture failed' >&2
  return 64
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
  local engine_db="$AUTORECALL_RECENT_DEPLOYMENT_ENGINE_DB"
  local engine_baseline="$AUTORECALL_RECENT_DEPLOYMENT_ENGINE_BASELINE_PATH"
  local engine_after="$evidence_dir/engine-facts-${facts_number}.json"
  local engine_report="$evidence_dir/engine-facts-${facts_number}-compare.json"
  local engine_require_path="$AUTORECALL_RECENT_DEPLOYMENT_ENGINE_REQUIRE_PATH"
  local lance_root="$AUTORECALL_RECENT_DEPLOYMENT_LANCEDB_ROOT"
  local lance_baseline="$AUTORECALL_RECENT_DEPLOYMENT_LANCEDB_BASELINE_PATH"
  local lance_after="$evidence_dir/lancedb-facts-${facts_number}.json"
  local lance_report="$evidence_dir/lancedb-facts-${facts_number}-compare.json"
  local config_path="$AUTORECALL_RECENT_DEPLOYMENT_CONFIG_PATH"
  local config_baseline="$AUTORECALL_RECENT_DEPLOYMENT_CONFIG_BASELINE_PATH"
  local config_after="$evidence_dir/config-facts-${facts_number}.json"
  local config_report="$evidence_dir/config-facts-${facts_number}-compare.json"
  local config_tool="$AUTORECALL_RECENT_DEPLOYMENT_CONFIG_EQUIVALENCE_TOOL"
  local cron_store="$AUTORECALL_RECENT_DEPLOYMENT_CRON_STORE_PATH"
  local after_cron="$evidence_dir/cron-after-${facts_number}.json"
  local cron_report="$evidence_dir/cron-facts-${facts_number}-compare.json"
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
  if [[ ! -f "$baseline_path" || ! -f "$engine_baseline" || ! -d "$lance_root" || ! -f "$config_path" || ! -f "$cron_store" || ! -f "$expected_artifact_manifest" ]]; then
    printf '%s\n' 'facts callback is missing a fresh non-Gateway evidence source' >&2
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
      if [[ "$facts_number" == 1 ]] && ! _autorecall_recent_deployment_record_candidate_unexplained_drift \
        core "$core_report" "$baseline_path" "$baseline_path" "$node"; then
        return 64
      fi
    fi
  else
    return 64
  fi

  if ! _autorecall_recent_deployment_capture_engine_fingerprint \
    "$engine_after" "$engine_db" "$node" "$engine_require_path"; then
    printf '%s\n' 'facts callback could not capture Engine evidence' >&2
    return 64
  fi
  if ! _autorecall_recent_deployment_compare_engine_fingerprint \
    "$engine_baseline" "$engine_after" "$engine_report" "$engine_db" "$node"; then
    printf '%s\n' 'facts callback could not compare Engine evidence' >&2
    return 64
  fi
  if [[ "$AUTORECALL_RECENT_DEPLOYMENT_ENGINE_EQUAL" != 1 ]]; then
    data_drift='unexplained'
    if [[ "$facts_number" == 1 ]] && ! _autorecall_recent_deployment_record_candidate_unexplained_drift \
      engine "$engine_report" "$engine_baseline" "$engine_baseline" "$node"; then
      return 64
    fi
  fi

  if ! _autorecall_recent_deployment_build_artifact_manifest \
    "$lance_after" "$lance_root" "$node" "$artifact_build_tool"; then
    printf '%s\n' 'facts callback could not capture LanceDB evidence' >&2
    return 64
  fi
  if ! _autorecall_recent_deployment_artifact_compare \
    "$lance_report" "$lance_baseline" "$lance_after" "$node" "$artifact_compare_tool"; then
    printf '%s\n' 'facts callback could not compare LanceDB evidence' >&2
    return 64
  fi
  if [[ "$AUTORECALL_RECENT_DEPLOYMENT_ARTIFACT_EQUAL" != 1 ]]; then
    data_drift='unexplained'
    if [[ "$facts_number" == 1 ]] && ! _autorecall_recent_deployment_record_candidate_unexplained_drift \
      lance "$lance_report" "$lance_baseline" "$lance_baseline" "$node"; then
      return 64
    fi
  fi

  if ! _autorecall_recent_deployment_capture_config_after "$config_path" "$config_after" "$node"; then
    printf '%s\n' 'facts callback could not capture config evidence' >&2
    return 64
  fi
  if ! _autorecall_recent_deployment_config_compare \
    "$config_baseline" "$config_after" "$config_report" "$node" "$config_tool"; then
    printf '%s\n' 'facts callback could not compare config evidence' >&2
    return 64
  fi
  if [[ "$AUTORECALL_RECENT_DEPLOYMENT_CONFIG_EQUAL" != 1 ]]; then
    data_drift='unexplained'
    if [[ "$facts_number" == 1 ]] && ! _autorecall_recent_deployment_record_candidate_unexplained_drift \
      config "$config_report" "$config_baseline" "$config_baseline" "$node"; then
      return 64
    fi
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
      if [[ "$facts_number" == 1 ]] &&
         _autorecall_recent_deployment_candidate_root_mode_exception \
           "$artifact_report" \
           "$expected_artifact_manifest" \
           "$installed_artifact_manifest" \
           "$node"; then
        # Do not replace a pre-existing Core/cron unexplained finding.
        if [[ "$data_drift" == none ]]; then
          data_drift='explained'
        fi
      else
        data_drift='unexplained'
        if [[ "$facts_number" == 1 ]] && ! _autorecall_recent_deployment_record_candidate_unexplained_drift \
          runtime "$artifact_report" "$expected_artifact_manifest" "$expected_artifact_manifest" "$node"; then
          return 64
        fi
      fi
    fi
  else
    return 64
  fi

  if _autorecall_recent_deployment_capture_cron_after \
    "$cron_store" "$after_cron" "$after_projection" "$node" &&
     _autorecall_recent_deployment_compare_cron \
    "$AUTORECALL_RECENT_DEPLOYMENT_CRON_BASELINE_PATH" \
    "$after_cron" \
    "$baseline_projection" \
    "$after_projection" \
    "$node" \
    "$cron_report"; then
    cron_rc=0
  else
    cron_rc=$?
    if [[ "$cron_rc" == 2 ]]; then
      data_drift='unexplained'
      if [[ "$facts_number" == 1 ]] && ! _autorecall_recent_deployment_record_candidate_unexplained_drift \
        cron "$cron_report" "$AUTORECALL_RECENT_DEPLOYMENT_CRON_BASELINE_PATH" "$AUTORECALL_RECENT_DEPLOYMENT_CRON_BASELINE_PATH" "$node"; then
        return 64
      fi
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

  if [[ "$AUTORECALL_INSTALL_STEP_INVOKED" != 1 || ! "$AUTORECALL_INSTALL_STEP_LAST_EXIT" =~ ^[0-9]+$ ]]; then
    printf '%s\n' 'facts callback did not receive a valid child exit result' >&2
    return 64
  fi

  # The existing helper accepts only these three bounded fields from facts.
  printf 'launch_observed=%s\n' "$launch_observed"
  printf 'runtime_state=%s\n' "$runtime_state"
  printf 'data_drift=%s\n' "$data_drift"
}

_autorecall_recent_deployment_recovery_acceptance_callback() {
  local baseline_hash
  local artifact_report="$AUTORECALL_RECENT_DEPLOYMENT_EVIDENCE_DIR/runtime-facts-2-compare.json"
  local core_report="$AUTORECALL_RECENT_DEPLOYMENT_EVIDENCE_DIR/core-facts-2.json"
  local engine_report="$AUTORECALL_RECENT_DEPLOYMENT_EVIDENCE_DIR/engine-facts-2-compare.json"
  local lance_report="$AUTORECALL_RECENT_DEPLOYMENT_EVIDENCE_DIR/lancedb-facts-2-compare.json"
  local config_report="$AUTORECALL_RECENT_DEPLOYMENT_EVIDENCE_DIR/config-facts-2-compare.json"
  local cron_report="$AUTORECALL_RECENT_DEPLOYMENT_EVIDENCE_DIR/cron-facts-2-compare.json"
  local node="$AUTORECALL_RECENT_DEPLOYMENT_NODE"
  if _autorecall_recent_deployment_validate_candidate_unexplained_drift_latch; then
    printf '%s\n' 'recovery acceptance: candidate unexplained drift latch blocks restart' >&2
    return 64
  else
    local latch_rc=$?
    if [[ "$latch_rc" != 1 ]]; then
      printf '%s\n' 'recovery acceptance: candidate drift latch is invalid' >&2
      return 64
    fi
  fi
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
  if [[ ! -s "$core_report" || ! -s "$engine_report" || ! -s "$lance_report" || ! -s "$config_report" || ! -s "$cron_report" ]] ||
     ! "$node" -e '
       const fs = require("node:fs");
       const core = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
       const engine = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
       const lance = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
       const config = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));
       const cron = JSON.parse(fs.readFileSync(process.argv[5], "utf8"));
       if (core.comparison?.deployment_invariant_equal !== true) throw new Error("recovery Core evidence is not equal");
       if (engine.valid !== true || engine.engine_invariant_equal !== true || engine.content_equal !== true || engine.schema_equal !== true || engine.user_version_equal !== true) throw new Error("recovery Engine evidence is not equal");
       if (lance.schema_version !== 2 || lance.accepted !== true || lance.decision !== "PASS" || lance.classification !== "EXACT") throw new Error("recovery LanceDB evidence is not exact");
       if (config.valid !== true || !["exact_equal", "approved_host_metadata_change"].includes(config.status) || config.unexpected_changed_paths.length !== 0) throw new Error("recovery config evidence is not accepted");
       if (cron.contract !== "autorecall_cron_equivalence_v1" || cron.valid !== true || cron.definition_equal !== true) throw new Error("recovery cron evidence is not equal");
     ' "$core_report" "$engine_report" "$lance_report" "$config_report" "$cron_report"; then
    printf '%s\n' 'recovery acceptance: one or more data evidence reports are missing or invalid' >&2
    return 64
  fi
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
  local config_equivalence_tool="${AUTORECALL_DEPLOYMENT_CONFIG_EQUIVALENCE_TOOL:-$_autorecall_recent_deployment_callbacks_dir/../../bin/build-config-semantic-equivalence-report.js}"
  local engine_db="${AUTORECALL_DEPLOYMENT_ENGINE_DB:-}"
  local engine_require_path="${AUTORECALL_DEPLOYMENT_ENGINE_REQUIRE_PATH:-$_autorecall_recent_deployment_callbacks_dir/../../package.json}"
  local lancedb_root="${AUTORECALL_DEPLOYMENT_LANCEDB_ROOT:-}"
  local config_path="${AUTORECALL_DEPLOYMENT_CONFIG_PATH:-}"
  local cron_store_path="${AUTORECALL_DEPLOYMENT_CRON_STORE_PATH:-}"
  local active_artifact_root="${AUTORECALL_DEPLOYMENT_ACTIVE_ARTIFACT_ROOT:-}"
  local openclaw="${AUTORECALL_DEPLOYMENT_OPENCLAW:-}"
  local install_entrypoint="${AUTORECALL_DEPLOYMENT_INSTALL_ENTRYPOINT:-${INSTALL_STEP_OPENCLAW_ENTRYPOINT:-}}"
  local install_cwd="${AUTORECALL_DEPLOYMENT_INSTALL_CWD:-${INSTALL_STEP_CWD:-}}"
  local install_path="${AUTORECALL_DEPLOYMENT_INSTALL_PATH:-${INSTALL_STEP_PATH:-${PATH:-}}}"
  local baseline_path="$evidence_dir/core-post-index.json"
  local baseline_self_compare="$evidence_dir/core-post-index-self-compare.json"
  local engine_baseline="$evidence_dir/engine-before.json"
  local engine_baseline_self_compare="$evidence_dir/engine-before-self-compare.json"
  local lancedb_baseline="$evidence_dir/lancedb-before.json"
  local lancedb_baseline_self_compare="$evidence_dir/lancedb-before-self-compare.json"
  local config_baseline="$evidence_dir/config-before.json"
  local config_baseline_self_compare="$evidence_dir/config-before-self-compare.json"
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
  elif [[ ! -f "$config_equivalence_tool" ]]; then
    validation_error='config equivalence tool'
  elif [[ -z "$engine_db" || ! -f "$engine_db" ]]; then
    validation_error='Engine DB path'
  elif [[ ! -f "$engine_require_path" ]]; then
    validation_error='Engine fingerprint dependency path'
  elif [[ -z "$lancedb_root" || ! -d "$lancedb_root" ]]; then
    validation_error='LanceDB root'
  elif [[ -z "$config_path" || ! -f "$config_path" ]]; then
    validation_error='config path'
  elif [[ -z "$cron_store_path" || ! -f "$cron_store_path" ]]; then
    validation_error='confirmed host cron store'
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
  export AUTORECALL_RECENT_DEPLOYMENT_CONFIG_EQUIVALENCE_TOOL="$config_equivalence_tool"
  export AUTORECALL_RECENT_DEPLOYMENT_ENGINE_DB="$engine_db"
  export AUTORECALL_RECENT_DEPLOYMENT_ENGINE_REQUIRE_PATH="$engine_require_path"
  export AUTORECALL_RECENT_DEPLOYMENT_ENGINE_BASELINE_PATH="$engine_baseline"
  export AUTORECALL_RECENT_DEPLOYMENT_LANCEDB_ROOT="$lancedb_root"
  export AUTORECALL_RECENT_DEPLOYMENT_LANCEDB_BASELINE_PATH="$lancedb_baseline"
  export AUTORECALL_RECENT_DEPLOYMENT_CONFIG_PATH="$config_path"
  export AUTORECALL_RECENT_DEPLOYMENT_CONFIG_BASELINE_PATH="$config_baseline"
  export AUTORECALL_RECENT_DEPLOYMENT_CANDIDATE_ARTIFACT_MANIFEST="$candidate_artifact_manifest"
  export AUTORECALL_RECENT_DEPLOYMENT_ROLLBACK_ARTIFACT_MANIFEST="$rollback_artifact_manifest"
  export AUTORECALL_RECENT_DEPLOYMENT_CRON_BASELINE_PATH="$evidence_dir/cron-before.json"
  export AUTORECALL_RECENT_DEPLOYMENT_CRON_STORE_PATH="$cron_store_path"

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

  if _autorecall_recent_deployment_run_callback 'stop' "$stop_callback" "$evidence_dir"; then
    :
  else
    _autorecall_recent_deployment_emit_blocked 'pre_install_callback_failed'
    return 64
  fi

  # These fresh non-Gateway baselines are deliberately taken while the
  # Gateway is stopped and before Core DDL.  Each is self-compared and then
  # frozen; facts callbacks only recapture the live sources after each child.
  if _autorecall_recent_deployment_capture_engine_fingerprint \
    "$engine_baseline" "$engine_db" "$node" "$engine_require_path" &&
     _autorecall_recent_deployment_compare_engine_fingerprint \
    "$engine_baseline" "$engine_baseline" "$engine_baseline_self_compare" "$engine_db" "$node" &&
     [[ "$AUTORECALL_RECENT_DEPLOYMENT_ENGINE_EQUAL" == 1 ]] &&
     _autorecall_recent_deployment_build_artifact_manifest \
    "$lancedb_baseline" "$lancedb_root" "$node" "$artifact_build_tool" &&
     _autorecall_recent_deployment_artifact_compare \
    "$lancedb_baseline_self_compare" "$lancedb_baseline" "$lancedb_baseline" "$node" "$artifact_compare_tool" &&
     [[ "$AUTORECALL_RECENT_DEPLOYMENT_ARTIFACT_EQUAL" == 1 ]] &&
     _autorecall_recent_deployment_capture_config_baseline \
    "$config_path" "$config_baseline" "$node" &&
     _autorecall_recent_deployment_config_compare \
    "$config_baseline" "$config_baseline" "$config_baseline_self_compare" "$node" "$config_equivalence_tool" &&
     [[ "$AUTORECALL_RECENT_DEPLOYMENT_CONFIG_EQUAL" == 1 ]]; then
    :
  else
    _autorecall_recent_deployment_emit_blocked 'pre_install_data_baseline_invalid'
    return 64
  fi

  if _autorecall_recent_deployment_run_callback 'ddl' "$ddl_callback" "$evidence_dir"; then
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
