#!/usr/bin/env bash
#
# Prepared deployment entry for AUTORECALL_RECENT_DEPLOYMENT_CALLBACKS_20261011.
# The default values are the frozen candidate and the current host paths.
# Offline verification must override commands and paths with AUTORECALL_ENTRY_*.
#
# This file is intentionally not executed by source review.  It has one
# deployment-caller invocation and delegates its child facts/recovery contract
# to the reviewed callbacks and install-step helper.

set -u
set -o pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"
NODE="$(printenv AUTORECALL_ENTRY_NODE 2>/dev/null || true)"
OPENCLAW="$(printenv AUTORECALL_ENTRY_OPENCLAW 2>/dev/null || true)"
OPENCLAW_ENTRYPOINT="$(printenv AUTORECALL_ENTRY_OPENCLAW_ENTRYPOINT 2>/dev/null || true)"
ACTIVE_ROOT="$(printenv AUTORECALL_ENTRY_ACTIVE_ROOT 2>/dev/null || true)"
CORE_DB="$(printenv AUTORECALL_ENTRY_CORE_DB 2>/dev/null || true)"
ENGINE_DB="$(printenv AUTORECALL_ENTRY_ENGINE_DB 2>/dev/null || true)"
LANCEDB_ROOT="$(printenv AUTORECALL_ENTRY_LANCEDB_ROOT 2>/dev/null || true)"
CONFIG_PATH="$(printenv AUTORECALL_ENTRY_CONFIG 2>/dev/null || true)"
STATE_DB="$(printenv AUTORECALL_ENTRY_STATE_DB 2>/dev/null || true)"
SYSTEMCTL="$(printenv AUTORECALL_ENTRY_SYSTEMCTL 2>/dev/null || true)"
RUN_ROOT="$(printenv AUTORECALL_ENTRY_RUN_ROOT 2>/dev/null || true)"
INSTALL_CWD="$(printenv AUTORECALL_ENTRY_INSTALL_CWD 2>/dev/null || true)"
INSTALL_PATH="$(printenv AUTORECALL_ENTRY_INSTALL_PATH 2>/dev/null || true)"
SQLITE_REQUIRE_PATH="$(printenv AUTORECALL_ENTRY_SQLITE_REQUIRE 2>/dev/null || true)"
EXPECTED_HEAD="$(printenv AUTORECALL_ENTRY_EXPECTED_HEAD 2>/dev/null || true)"
PARITY_SOURCE_ROOT="$(printenv AUTORECALL_ENTRY_PARITY_SOURCE_ROOT 2>/dev/null || true)"
ENTRY_FINGERPRINT="$(printenv AUTORECALL_ENTRY_FINGERPRINT 2>/dev/null || true)"
CRON_STORE_KEY="/home/lionsol/.openclaw/cron/jobs.json"
OFFLINE_CRON_SOURCE="$(printenv AUTORECALL_ENTRY_CRON_SOURCE 2>/dev/null || true)"
ENTRY_CANDIDATE="$(printenv AUTORECALL_ENTRY_CANDIDATE 2>/dev/null || true)"
ENTRY_CANDIDATE_MANIFEST="$(printenv AUTORECALL_ENTRY_CANDIDATE_MANIFEST 2>/dev/null || true)"
ENTRY_CANDIDATE_IDENTITY="$(printenv AUTORECALL_ENTRY_CANDIDATE_IDENTITY 2>/dev/null || true)"
ENTRY_CANDIDATE_NATIVE_SHA="$(printenv AUTORECALL_ENTRY_CANDIDATE_NATIVE_SHA 2>/dev/null || true)"
ENTRY_CANDIDATE_NATIVE_PATH="$(printenv AUTORECALL_ENTRY_CANDIDATE_NATIVE_PATH 2>/dev/null || true)"

[[ -n "$NODE" ]] || NODE=/home/lionsol/.local/node24/bin/node
[[ -n "$OPENCLAW" ]] || OPENCLAW=/home/lionsol/.local/bin/openclaw
[[ -n "$OPENCLAW_ENTRYPOINT" ]] || OPENCLAW_ENTRYPOINT=/home/lionsol/.local/lib/node_modules/openclaw/openclaw.mjs
[[ -n "$ACTIVE_ROOT" ]] || ACTIVE_ROOT=/home/lionsol/.openclaw/extensions/memory-engine
[[ -n "$CORE_DB" ]] || CORE_DB=/home/lionsol/.openclaw/agents/main/agent/openclaw-agent.sqlite
[[ -n "$ENGINE_DB" ]] || ENGINE_DB=/home/lionsol/.openclaw/memory/memory-engine/memory-engine.sqlite
[[ -n "$LANCEDB_ROOT" ]] || LANCEDB_ROOT=/home/lionsol/.openclaw/memory/lancedb
[[ -n "$CONFIG_PATH" ]] || CONFIG_PATH=/home/lionsol/.openclaw/openclaw.json
[[ -n "$STATE_DB" ]] || STATE_DB=/home/lionsol/.openclaw/state/openclaw.sqlite
[[ -n "$SYSTEMCTL" ]] || SYSTEMCTL=systemctl
[[ -n "$RUN_ROOT" ]] || RUN_ROOT="$(mktemp -d /tmp/autorecall-recent-deployment-entry-XXXXXX)"
[[ -n "$INSTALL_CWD" ]] || INSTALL_CWD="$RUN_ROOT/cwd"
[[ -n "$INSTALL_PATH" ]] || INSTALL_PATH=/home/lionsol/.local/node24/bin:/home/lionsol/.local/bin:/usr/local/bin:/usr/bin:/bin
[[ -n "$SQLITE_REQUIRE_PATH" ]] || SQLITE_REQUIRE_PATH="$ACTIVE_ROOT/package.json"
[[ -n "$PARITY_SOURCE_ROOT" ]] || PARITY_SOURCE_ROOT="$REPO_ROOT"

CANDIDATE=/tmp/autorecall-recent-offline-candidate-20261010-UnVd6w/candidate
CANDIDATE_MANIFEST=/tmp/autorecall-recent-offline-candidate-20261010-UnVd6w/evidence/candidate-manifest.json
CANDIDATE_IDENTITY=a24caeb5e984c64e27c1af35a2846295af50e0367e248300b4c8b04687af0863
CANDIDATE_NATIVE_SHA=be4109c5b07514ade1a2e1452cbed9fca25cbb8d025b76fa2a81e21a91286a05
[[ -n "$ENTRY_CANDIDATE_NATIVE_PATH" ]] || ENTRY_CANDIDATE_NATIVE_PATH="$CANDIDATE/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
[[ -n "$ENTRY_CANDIDATE" ]] && CANDIDATE="$ENTRY_CANDIDATE"
[[ -n "$ENTRY_CANDIDATE_MANIFEST" ]] && CANDIDATE_MANIFEST="$ENTRY_CANDIDATE_MANIFEST"
[[ -n "$ENTRY_CANDIDATE_IDENTITY" ]] && CANDIDATE_IDENTITY="$ENTRY_CANDIDATE_IDENTITY"
[[ -n "$ENTRY_CANDIDATE_NATIVE_SHA" ]] && CANDIDATE_NATIVE_SHA="$ENTRY_CANDIDATE_NATIVE_SHA"
CALLBACKS="$REPO_ROOT/docs/smoke-tests/autorecall-recent-deployment-callbacks-20261011.sh"
INSTALL_HELPER="$REPO_ROOT/docs/smoke-tests/autorecall-recent-install-step-20261011.sh"
FINGERPRINT="$REPO_ROOT/bin/core-deployment-logical-fingerprint.js"
[[ -n "$ENTRY_FINGERPRINT" ]] && FINGERPRINT="$ENTRY_FINGERPRINT"
ARTIFACT_BUILD_V1="$REPO_ROOT/bin/build-runtime-artifact-manifest.js"
PARITY_BUILD="$REPO_ROOT/bin/build-runtime-source-parity-report.js"
ARTIFACT_BUILD="$REPO_ROOT/bin/build-runtime-artifact-manifest-v2.cjs"
ARTIFACT_COMPARE="$REPO_ROOT/bin/compare-runtime-artifact-manifests-v2.cjs"
CONFIG_COMPARE="$REPO_ROOT/bin/build-config-semantic-equivalence-report.js"
INDEX_NAME=idx_memory_index_chunks_recent_cover
INDEX_SQL="CREATE INDEX idx_memory_index_chunks_recent_cover ON memory_index_chunks(updated_at DESC, id ASC, path)"

EVIDENCE="$RUN_ROOT/evidence"
ROLLBACK="$RUN_ROOT/rollback"
CRON_STORE="$RUN_ROOT/cron-store.json"
CRON_KEY="$CRON_STORE_KEY"
CALLER_STDERR="$EVIDENCE/caller.stderr"
INDEX_CREATED=0
CALLER_RC=64
GATEWAY_RESTORED=0
CRON_PRODUCER_PID=
HELPER_RESULT_VALID=0
CLEANUP_STATUS=not_run
CLEANUP_RC=not_run
OUTCOME=STOPPED
DEPLOYMENT_PATH=none

fail() {
  printf 'STOPPED: %s\n' "$1" >&2
  exit 64
}

require_file() { [[ -f "$1" ]] || fail "$2"; }
require_dir() { [[ -d "$1" ]] || fail "$2"; }

sha256() {
  sha256sum -- "$1" | cut -d' ' -f1
}

validate_candidate() {
  require_dir "$CANDIDATE" 'frozen candidate directory'
  require_file "$CANDIDATE_MANIFEST" 'frozen candidate manifest'
  require_file "$ENTRY_CANDIDATE_NATIVE_PATH" 'frozen candidate native'
  [[ "$(sha256 "$ENTRY_CANDIDATE_NATIVE_PATH")" == "$CANDIDATE_NATIVE_SHA" ]] || fail 'candidate native SHA256 binding'
  if "$NODE" - "$CANDIDATE_MANIFEST" "$CANDIDATE" "$CANDIDATE_IDENTITY" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [manifestPath, root, identity] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (value.schema_version !== 1 || value.valid !== true || value.root_path !== path.resolve(root) || value.identity !== identity) process.exit(64);
NODE
  then
    :
  else
    fail 'frozen candidate manifest binding'
  fi
  local manifest_rc
  if "$NODE" "$ARTIFACT_BUILD_V1" --root "$CANDIDATE" --out "$EVIDENCE/candidate-manifest-recomputed.json" >"$EVIDENCE/candidate-manifest-recomputed.stdout" 2>"$EVIDENCE/candidate-manifest-recomputed.stderr"; then
    manifest_rc=0
  else
    manifest_rc=$?
  fi
  printf '%s\n' "$manifest_rc" >"$EVIDENCE/candidate-manifest-recomputed.exit-code"
  [[ "$manifest_rc" == 0 ]] || fail 'candidate manifest recomputation'
  if "$NODE" - "$EVIDENCE/candidate-manifest-recomputed.json" "$CANDIDATE" "$CANDIDATE_IDENTITY" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [reportPath, root, identity] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (value.schema_version !== 1 || value.valid !== true || value.root_path !== path.resolve(root) || value.identity !== identity) process.exit(64);
NODE
  then
    :
  else
    fail 'recomputed candidate manifest binding'
  fi
  local parity_rc
  if "$NODE" "$PARITY_BUILD" --source-root "$PARITY_SOURCE_ROOT" --runtime-root "$CANDIDATE" --out "$EVIDENCE/candidate-parity-recomputed.json" >"$EVIDENCE/candidate-parity-recomputed.stdout" 2>"$EVIDENCE/candidate-parity-recomputed.stderr"; then
    parity_rc=0
  else
    parity_rc=$?
  fi
  printf '%s\n' "$parity_rc" >"$EVIDENCE/candidate-parity-recomputed.exit-code"
  [[ "$parity_rc" == 0 ]] || fail 'candidate source/runtime parity'
  if "$NODE" - "$EVIDENCE/candidate-parity-recomputed.json" "$CANDIDATE" "$PARITY_SOURCE_ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [reportPath, candidateRoot, sourceRoot] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (value.schema_version !== 1 || value.source_runtime_equal !== true || value.difference_count !== 0 || value.source_identity_valid !== true || value.runtime_identity_valid !== true) process.exit(64);
if (value.runtime_root !== path.resolve(candidateRoot) || value.source_root !== path.resolve(sourceRoot)) process.exit(64);
if (value.runtime_build_identity !== value.source_build_identity || !/^[a-f0-9]{64}$/.test(value.runtime_build_identity || '')) process.exit(64);
NODE
  then
    :
  else
    fail 'recomputed candidate source/runtime parity binding'
  fi
}

validate_bindings() {
  local head callbacks_sha helper_sha
  head="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null)" || fail 'repository HEAD unavailable'
  callbacks_sha="$(sha256 "$CALLBACKS")" || fail 'callbacks hash unavailable'
  helper_sha="$(sha256 "$INSTALL_HELPER")" || fail 'install helper hash unavailable'
  [[ "$EXPECTED_HEAD" =~ ^[0-9a-f]{40}$ ]] || fail 'explicit reviewed repository HEAD binding'
  [[ "$head" == "$EXPECTED_HEAD" ]] || fail 'source HEAD is not the explicitly reviewed deployment source'
  if ! printf 'repository_head=%s\ncallbacks_sha256=%s\ninstall_helper_sha256=%s\n' "$head" "$callbacks_sha" "$helper_sha" >"$EVIDENCE/bindings.txt"; then
    fail 'binding evidence'
  fi
  [[ "$callbacks_sha" == dba24f65472c8c4cfc290a49ec5bb8b761859239f9c09a7166c1eab1d7c32ed9 ]] || fail 'deployment callbacks binding'
  [[ "$helper_sha" == dbd2a87b29bd81a1d2fa6c0f43eb1f6e23b8533d09c3615fa8e6345ee4256dd7 ]] || fail 'install helper binding'
}

prepare_paths() {
  mkdir -p "$EVIDENCE" "$INSTALL_CWD" || fail 'run directories'
  require_file "$CORE_DB" 'Core DB'
  require_file "$ENGINE_DB" 'Engine DB'
  require_dir "$LANCEDB_ROOT" 'LanceDB root'
  require_file "$CONFIG_PATH" 'config'
  require_dir "$ACTIVE_ROOT" 'active extension'
  require_file "$OPENCLAW_ENTRYPOINT" 'OpenClaw entrypoint'
  [[ -x "$OPENCLAW" ]] || fail 'OpenClaw executable'
  [[ -x "$SYSTEMCTL" || "$SYSTEMCTL" == systemctl ]] || fail 'systemctl stub'
  rm -rf -- "$ROLLBACK"
  mkdir -p "$ROLLBACK" || fail 'rollback directory'
  cp -a -- "$ACTIVE_ROOT/." "$ROLLBACK/" || fail 'fresh rollback snapshot'
  require_dir "$ROLLBACK" 'fresh rollback artifact'
  "$NODE" "$ARTIFACT_BUILD" --root "$ROLLBACK" --out "$EVIDENCE/rollback-runtime-manifest.json" >"$EVIDENCE/rollback-manifest.stdout" 2>"$EVIDENCE/rollback-manifest.stderr" || fail 'rollback manifest'
}

produce_cron_store() {
  if [[ -n "$OFFLINE_CRON_SOURCE" ]]; then
    cp -- "$OFFLINE_CRON_SOURCE" "$CRON_STORE" || return 64
  else
    local capture_rc
    if "$NODE" - "$STATE_DB" "$CRON_STORE" "$CRON_KEY" <<'NODE'
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const [stateDb, output, storeKey] = process.argv.slice(2);
const db = new DatabaseSync(stateDb, { readOnly: true });
try {
  const rows = db.prepare('SELECT job_json FROM cron_jobs WHERE store_key = ? ORDER BY sort_order, job_id').all(storeKey);
  const jobs = rows.map(row => JSON.parse(row.job_json));
  const value = { total: jobs.length, offset: 0, hasMore: false, nextOffset: null, jobs };
  const temp = output + '.tmp.' + process.pid;
  fs.writeFileSync(temp, JSON.stringify(value) + '\n', { mode: 0o600 });
  fs.renameSync(temp, output);
} finally {
  db.close();
}
NODE
    then
      capture_rc=0
    else
      capture_rc=$?
    fi
    printf '%s\n' "$capture_rc" >"$EVIDENCE/cron-capture.exit-code"
    [[ "$capture_rc" == 0 ]] || return 64
  fi
  "$NODE" - "$CRON_STORE" <<'NODE'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!value || !Array.isArray(value.jobs) || value.offset !== 0 || value.hasMore !== false || value.nextOffset !== null || value.total !== value.jobs.length) process.exit(64);
NODE
}

stop_gateway() {
  "$SYSTEMCTL" --user stop openclaw-gateway >"$EVIDENCE/gateway-stop.stdout" 2>"$EVIDENCE/gateway-stop.stderr" || return 64
  if "$SYSTEMCTL" --user is-active --quiet openclaw-gateway; then return 64; fi
  if ! printf '%s\n' stopped >"$EVIDENCE/gateway-stopped-by-this-run"; then return 64; fi
  produce_cron_store || return 64
}

snapshot_schema() {
  "$NODE" - "$CORE_DB" "$1" <<'NODE'
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const [dbPath, output] = process.argv.slice(2);
const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  const rows = db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all();
  fs.writeFileSync(output, JSON.stringify(rows) + '\n', { mode: 0o600 });
} finally { db.close(); }
NODE
}

ddl_core() {
  local pre="$EVIDENCE/core-pre-index.json"
  local post="$EVIDENCE/core-post-ddl.json"
  local pre_schema="$EVIDENCE/core-schema-pre-index.json"
  local post_schema="$EVIDENCE/core-schema-post-ddl.json"
  _autorecall_recent_deployment_capture_core_baseline "$pre" "$CORE_DB" "$NODE" "$FINGERPRINT" || return 64
  snapshot_schema "$pre_schema" || return 64
  local ddl_rc
  if "$NODE" - "$CORE_DB" "$SQLITE_REQUIRE_PATH" "$EVIDENCE/index-create.json" "$EVIDENCE/index-created-by-this-run" <<'NODE'
const fs = require('node:fs');
const { createRequire } = require('node:module');
const [dbPath, packagePath, output, marker] = process.argv.slice(2);
const Database = createRequire(packagePath)('better-sqlite3');
const name = 'idx_memory_index_chunks_recent_cover';
const sql = 'CREATE INDEX idx_memory_index_chunks_recent_cover ON memory_index_chunks(updated_at DESC, id ASC, path)';
const norm = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
const db = new Database(dbPath, { readonly: false, fileMustExist: true, timeout: 30000 });
let committed = false;
try {
  const table = db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', 'memory_index_chunks');
  const existing = db.prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?').get('index', name);
  if (!table || existing) process.exit(64);
  db.exec('BEGIN IMMEDIATE');
  try { db.exec(sql); db.exec('COMMIT'); committed = true; } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  try {
    fs.writeFileSync(marker, JSON.stringify({ created_by_this_run: true, name, definition: { type: 'index', name, tbl_name: 'memory_index_chunks', sql } }) + '\n', { mode: 0o600, flag: 'wx' });
  } catch (error) {
    try { db.exec('DROP INDEX idx_memory_index_chunks_recent_cover'); } catch {}
    throw error;
  }
  const created = db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type = ? AND name = ?').get('index', name);
  if (!created || norm(created.sql) !== norm(sql)) process.exit(64);
  fs.writeFileSync(output, JSON.stringify({ created_by_this_run: true, definition: created }) + '\n', { mode: 0o600 });
} finally { db.close(); }
if (!committed) process.exit(64);
NODE
  then
    ddl_rc=0
  else
    ddl_rc=$?
  fi
  printf '%s\n' "$ddl_rc" >"$EVIDENCE/index-create.exit-code"
  [[ "$ddl_rc" == 0 ]] || return 64
  INDEX_CREATED=1
  snapshot_schema "$post_schema" || return 64
  _autorecall_recent_deployment_capture_core_baseline "$post" "$CORE_DB" "$NODE" "$FINGERPRINT" || return 64
  local schema_delta_rc
  if "$NODE" - "$pre_schema" "$post_schema" "$EVIDENCE/schema-delta.json" <<'NODE'
const fs = require('node:fs');
const [beforePath, afterPath, output] = process.argv.slice(2);
const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
const after = JSON.parse(fs.readFileSync(afterPath, 'utf8'));
const key = row => JSON.stringify([row.type, row.name, row.tbl_name, row.sql]);
const b = new Map(before.map(row => [key(row), row]));
const a = new Map(after.map(row => [key(row), row]));
const added = [...a].filter(entry => !b.has(entry[0])).map(entry => entry[1]);
const removed = [...b].filter(entry => !a.has(entry[0])).map(entry => entry[1]);
if (added.length !== 1 || removed.length !== 0 || added[0].name !== 'idx_memory_index_chunks_recent_cover') process.exit(64);
fs.writeFileSync(output, JSON.stringify({ added, removed, exact_single_index_delta: true }) + '\n', { mode: 0o600 });
NODE
  then
    schema_delta_rc=0
  else
    schema_delta_rc=$?
  fi
  printf '%s\n' "$schema_delta_rc" >"$EVIDENCE/schema-delta.exit-code"
  [[ "$schema_delta_rc" == 0 ]] || return 64
  local query_plan_rc
  if "$NODE" --input-type=module - "$CORE_DB" "$SQLITE_REQUIRE_PATH" "$REPO_ROOT/lib/db/core-store.cjs" "$REPO_ROOT/lib/recall/hybrid/recent-access.js" "$EVIDENCE/query-plan-post-index.json" <<'NODE'
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const [dbPath, requirePath, coreStorePath, recentAccessPath, output] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const Database = createRequire(requirePath)('better-sqlite3');
const { ensureCoreStoreCompatibility } = require(coreStorePath);
const { ISOLATED_RECENT_SHARED_SQL } = await import(pathToFileURL(recentAccessPath).href);
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  const descriptor = ensureCoreStoreCompatibility(db);
  const rows = db.prepare('EXPLAIN QUERY PLAN ' + ISOLATED_RECENT_SHARED_SQL).all('[]', 20);
  const details = rows.map(row => row.detail);
  const covering = details.some(detail => detail.includes('COVERING INDEX idx_memory_index_chunks_recent_cover'));
  const bodySearch = details.some(detail => detail.includes('SEARCH memory_index_chunks USING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)'));
  fs.writeFileSync(output, JSON.stringify({ sql: ISOLATED_RECENT_SHARED_SQL, rows, details, descriptor, checks: { covering_index_selected: covering, primary_key_search_selected: bodySearch } }, null, 2) + '\n', { mode: 0o600 });
  if (!covering || !bodySearch) process.exit(64);
} finally { db.close(); }
NODE
  then
    query_plan_rc=0
  else
    query_plan_rc=$?
  fi
  printf '%s\n' "$query_plan_rc" >"$EVIDENCE/query-plan-post-index.exit-code"
  [[ "$query_plan_rc" == 0 ]] || return 64
  local compare_rc
  if "$NODE" "$FINGERPRINT" --compare "$pre" --core-db "$CORE_DB" --out "$EVIDENCE/core-pre-ddl-compare.json" >"$EVIDENCE/core-pre-ddl-compare.stdout" 2>"$EVIDENCE/core-pre-ddl-compare.stderr"; then
    compare_rc=0
  else
    compare_rc=$?
  fi
  printf '%s\n' "$compare_rc" >"$EVIDENCE/core-pre-ddl-compare.exit-code"
  [[ "$compare_rc" == 2 ]] || return 64
  local pre_compare_check_rc
  if "$NODE" - "$EVIDENCE/core-pre-ddl-compare.json" <<'NODE'
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const comparison = report.comparison;
if (!comparison || comparison.canonical_content_equal !== true || comparison.schema_identity_equal !== true || comparison.user_version_equal !== true || comparison.schema_surface_equal !== false || comparison.deployment_invariant_equal !== false) process.exit(64);
NODE
  then
    pre_compare_check_rc=0
  else
    pre_compare_check_rc=$?
  fi
  printf '%s\n' "$pre_compare_check_rc" >"$EVIDENCE/core-pre-ddl-compare.check-exit-code"
  [[ "$pre_compare_check_rc" == 0 ]] || return 64
  return 0
}

cleanup_index() {
  if [[ ! -f "$EVIDENCE/index-created-by-this-run" ]]; then
    CLEANUP_STATUS=not_needed
    CLEANUP_RC=0
    return 0
  fi
  local cleanup_rc
  if "$NODE" - "$CORE_DB" "$SQLITE_REQUIRE_PATH" "$EVIDENCE/index-cleanup.json" <<'NODE'
const fs = require('node:fs');
const { createRequire } = require('node:module');
const [dbPath, packagePath, output] = process.argv.slice(2);
const Database = createRequire(packagePath)('better-sqlite3');
const name = 'idx_memory_index_chunks_recent_cover';
const expected = 'CREATE INDEX idx_memory_index_chunks_recent_cover ON memory_index_chunks(updated_at DESC, id ASC, path)';
const norm = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
const db = new Database(dbPath, { timeout: 30000, fileMustExist: true });
let dropped = false;
try {
  const row = db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type = ? AND name = ?').get('index', name);
  if (!row || norm(row.sql) !== norm(expected)) process.exit(64);
  db.exec('BEGIN IMMEDIATE');
  try { db.exec('DROP INDEX idx_memory_index_chunks_recent_cover'); db.exec('COMMIT'); dropped = true; } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  fs.writeFileSync(output, JSON.stringify({ dropped, definition: row }) + '\n', { mode: 0o600 });
} finally { db.close(); }
if (!dropped) process.exit(64);
NODE
  then
    cleanup_rc=0
  else
    cleanup_rc=$?
  fi
  printf '%s\n' "$cleanup_rc" >"$EVIDENCE/index-cleanup.exit-code"
  if [[ "$cleanup_rc" != 0 ]]; then
    CLEANUP_STATUS=failed
    CLEANUP_RC=$cleanup_rc
    printf 'STOPPED: index cleanup failed (rc=%s)\n' "$cleanup_rc" >&2
    return 64
  fi
  if ! rm -f -- "$EVIDENCE/index-created-by-this-run"; then
    CLEANUP_STATUS=failed
    CLEANUP_RC=64
    printf 'STOPPED: index ownership evidence cleanup failed\n' >&2
    return 64
  fi
  INDEX_CREATED=0
  CLEANUP_STATUS=ok
  CLEANUP_RC=0
}

write_final_report() {
  local index_created=0
  [[ -f "$EVIDENCE/index-created-by-this-run" ]] && index_created=1
  local report_rc
  if "$NODE" - "$EVIDENCE/helper-result.json" "$EVIDENCE/final-report.json" "$CALLER_RC" "$GATEWAY_RESTORED" "$index_created" "$OUTCOME" "$DEPLOYMENT_PATH" "$CLEANUP_STATUS" "$CLEANUP_RC" <<'NODE'
const fs = require('node:fs');
const [helperPath, output, callerRc, restored, index, outcome, deploymentPath, cleanupStatus, cleanupRc] = process.argv.slice(2);
const helper = fs.existsSync(helperPath) ? JSON.parse(fs.readFileSync(helperPath, 'utf8')) : null;
const report = {
  contract: 'autorecall_recent_deployment_entry_v1',
  caller_invocations: 1,
  caller_exit_code: Number(callerRc),
  gateway_restored: restored === '1',
  index_created_by_this_run: index === '1',
  outcome,
  deployment_path: deploymentPath,
  cleanup_status: cleanupStatus,
  cleanup_exit_code: cleanupRc === 'not_run' ? null : Number(cleanupRc),
  status: restored === '1' ? 'RESTORED' : 'STOPPED',
  restart_decision: restored === '1' ? 'permitted' : 'blocked',
  helper_result: helper,
};
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
NODE
  then
    report_rc=0
  else
    report_rc=$?
  fi
  printf '%s\n' "$report_rc" >"$EVIDENCE/final-report.exit-code"
  [[ "$report_rc" == 0 ]]
}

start_gateway_and_health() {
  "$SYSTEMCTL" --user start openclaw-gateway >"$EVIDENCE/gateway-start.stdout" 2>"$EVIDENCE/gateway-start.stderr" || return 64
  "$SYSTEMCTL" --user is-active --quiet openclaw-gateway || return 64
  "$OPENCLAW" gateway health >"$EVIDENCE/gateway-health.stdout" 2>"$EVIDENCE/gateway-health.stderr" || return 64
  grep -q '^OK' "$EVIDENCE/gateway-health.stdout" || return 64
  "$OPENCLAW" gateway status >"$EVIDENCE/gateway-status.stdout" 2>"$EVIDENCE/gateway-status.stderr" || return 64
  grep -q 'Connectivity probe: ok' "$EVIDENCE/gateway-status.stdout" || return 64
  GATEWAY_RESTORED=1
}

outer_acceptance() {
  [[ "$CALLER_RC" == 0 ]] || return 64
  [[ "$HELPER_RESULT_VALID" == 1 ]] || return 64
  if "$NODE" - "$EVIDENCE/helper-result.json" <<'NODE'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (value.status !== 'CONTINUE' || value.restart_decision !== 'permitted' || value.candidate_facts_status !== 'ok' || value.candidate_data_drift === 'unexplained' || value.candidate_data_drift === 'unknown' || value.recovery_invocations !== '0') process.exit(64);
NODE
  then
    :
  else
    return 64
  fi
  if "$NODE" - "$EVIDENCE/core-facts-1.json" "$EVIDENCE/engine-facts-1-compare.json" "$EVIDENCE/lancedb-facts-1-compare.json" "$EVIDENCE/config-facts-1-compare.json" "$EVIDENCE/cron-facts-1-compare.json" "$EVIDENCE/runtime-facts-1-compare.json" <<'NODE'
const fs = require('node:fs');
const values = process.argv.slice(2).map(path => JSON.parse(fs.readFileSync(path, 'utf8')));
const [core, engine, lance, config, cron, runtime] = values;
if (core.comparison?.deployment_invariant_equal !== true) process.exit(64);
if (engine.engine_invariant_equal !== true || engine.content_equal !== true || engine.schema_equal !== true || engine.user_version_equal !== true) process.exit(64);
if (lance.accepted !== true || lance.decision !== 'PASS') process.exit(64);
if (config.valid !== true || (config.unexpected_changed_paths || []).length !== 0) process.exit(64);
if (cron.definition_equal !== true) process.exit(64);
NODE
  then
    :
  else
    return 64
  fi
  if "$NODE" - "$EVIDENCE/runtime-facts-1-compare.json" <<'NODE'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!(value.accepted === true && value.decision === 'PASS')) process.exit(64);
NODE
  then
    :
  elif ! _autorecall_recent_deployment_candidate_root_mode_exception \
    "$EVIDENCE/runtime-facts-1-compare.json" \
    "$EVIDENCE/candidate-runtime-manifest.json" \
    "$EVIDENCE/runtime-facts-1-installed.json" \
    "$NODE"; then
    return 64
  fi
  if "$NODE" - "$CORE_DB" "$SQLITE_REQUIRE_PATH" <<'NODE'
const [dbPath, packagePath] = process.argv.slice(2);
const { createRequire } = require('node:module');
const Database = createRequire(packagePath)('better-sqlite3');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  const row = db.prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?').get('index', 'idx_memory_index_chunks_recent_cover');
  if (!row || String(row.sql).replace(/\s+/g, ' ').trim().toLowerCase() !== 'create index idx_memory_index_chunks_recent_cover on memory_index_chunks(updated_at desc, id asc, path)') process.exit(64);
} finally { db.close(); }
NODE
  then
    return 0
  else
    return 64
  fi
}

outer_recovery_acceptance() {
  [[ "$HELPER_RESULT_VALID" == 1 ]] || return 64
  if "$NODE" - "$EVIDENCE/helper-result.json" <<'NODE'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (value.status !== 'CONTINUE' || value.restart_decision !== 'permitted' || value.candidate_invocations !== '1' || value.recovery_invocations !== '1' || value.candidate_facts_status !== 'ok' || value.recovery_exit_code !== '0' || value.recovery_facts_status !== 'ok' || value.recovery_acceptance !== 'accepted' || !['none', 'explained'].includes(value.candidate_data_drift) || !['none', 'explained'].includes(value.recovery_data_drift)) process.exit(64);
NODE
  then
    :
  else
    return 64
  fi
  if "$NODE" - "$EVIDENCE/core-facts-2.json" "$EVIDENCE/engine-facts-2-compare.json" "$EVIDENCE/lancedb-facts-2-compare.json" "$EVIDENCE/config-facts-2-compare.json" "$EVIDENCE/cron-facts-2-compare.json" "$EVIDENCE/runtime-facts-2-compare.json" <<'NODE'
const fs = require('node:fs');
const values = process.argv.slice(2).map(path => JSON.parse(fs.readFileSync(path, 'utf8')));
const [core, engine, lance, config, cron, runtime] = values;
if (core.comparison?.deployment_invariant_equal !== true) process.exit(64);
if (engine.engine_invariant_equal !== true || engine.content_equal !== true || engine.schema_equal !== true || engine.user_version_equal !== true) process.exit(64);
if (lance.schema_version !== 2 || lance.accepted !== true || lance.decision !== 'PASS' || lance.classification !== 'EXACT') process.exit(64);
if (config.valid !== true || !['exact_equal', 'approved_host_metadata_change'].includes(config.status) || (config.unexpected_changed_paths || []).length !== 0) process.exit(64);
if (cron.contract !== 'autorecall_cron_equivalence_v1' || cron.valid !== true || cron.definition_equal !== true) process.exit(64);
if (runtime.accepted !== true || runtime.decision !== 'PASS' || runtime.classification !== 'EXACT') process.exit(64);
NODE
  then
    return 0
  else
    return 64
  fi
}

recover_index_and_validate_core() {
  if cleanup_index; then
    :
  else
    return 64
  fi
  local compare_rc
  if "$NODE" "$FINGERPRINT" --compare "$EVIDENCE/core-pre-index.json" --core-db "$CORE_DB" --out "$EVIDENCE/core-after-recovery-compare.json" >"$EVIDENCE/core-after-recovery-compare.stdout" 2>"$EVIDENCE/core-after-recovery-compare.stderr"; then
    compare_rc=0
  else
    compare_rc=$?
  fi
  printf '%s\n' "$compare_rc" >"$EVIDENCE/core-after-recovery-compare.exit-code"
  [[ "$compare_rc" == 0 ]] || return 64
  if "$NODE" - "$EVIDENCE/core-after-recovery-compare.json" "$CORE_DB" "$SQLITE_REQUIRE_PATH" <<'NODE'
const fs = require('node:fs');
const { createRequire } = require('node:module');
const [reportPath, dbPath, packagePath] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (report.comparison?.deployment_invariant_equal !== true) process.exit(64);
const Database = createRequire(packagePath)('better-sqlite3');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  const row = db.prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?').get('index', 'idx_memory_index_chunks_recent_cover');
  if (row) process.exit(64);
} finally { db.close(); }
NODE
  then
    return 0
  else
    return 64
  fi
}

main() {
  mkdir -p "$EVIDENCE" || fail 'evidence directory'
  validate_bindings
  validate_candidate
  prepare_paths
  if source "$CALLBACKS"; then
    :
  else
    fail 'deployment callbacks source'
  fi
  export AUTORECALL_DEPLOYMENT_NODE="$NODE"
  export AUTORECALL_DEPLOYMENT_CORE_FINGERPRINT_TOOL="$FINGERPRINT"
  export AUTORECALL_DEPLOYMENT_ARTIFACT_BUILD_TOOL="$ARTIFACT_BUILD"
  export AUTORECALL_DEPLOYMENT_ARTIFACT_COMPARE_TOOL="$ARTIFACT_COMPARE"
  export AUTORECALL_DEPLOYMENT_CONFIG_EQUIVALENCE_TOOL="$CONFIG_COMPARE"
  export AUTORECALL_DEPLOYMENT_ENGINE_DB="$ENGINE_DB"
  export AUTORECALL_DEPLOYMENT_ENGINE_REQUIRE_PATH="$SQLITE_REQUIRE_PATH"
  export AUTORECALL_DEPLOYMENT_LANCEDB_ROOT="$LANCEDB_ROOT"
  export AUTORECALL_DEPLOYMENT_CONFIG_PATH="$CONFIG_PATH"
  export AUTORECALL_DEPLOYMENT_ACTIVE_ARTIFACT_ROOT="$ACTIVE_ROOT"
  export AUTORECALL_DEPLOYMENT_OPENCLAW="$OPENCLAW"
  export AUTORECALL_DEPLOYMENT_INSTALL_ENTRYPOINT="$OPENCLAW_ENTRYPOINT"
  export AUTORECALL_DEPLOYMENT_INSTALL_CWD="$INSTALL_CWD"
  export AUTORECALL_DEPLOYMENT_INSTALL_PATH="$INSTALL_PATH"
  export AUTORECALL_DEPLOYMENT_CRON_STORE_PATH="$CRON_STORE"
  produce_cron_store || fail 'confirmed host cron store'

  local original_facts_definition
  if original_facts_definition="$(declare -f _autorecall_recent_deployment_facts_callback | sed '1s/_autorecall_recent_deployment_facts_callback/_autorecall_entry_original_facts_callback/')"; then
    :
  else
    fail 'facts callback wrapper preparation'
  fi
  [[ -n "$original_facts_definition" ]] || fail 'facts callback definition'
  if eval "$original_facts_definition"; then
    :
  else
    fail 'facts callback wrapper installation'
  fi
  _autorecall_recent_deployment_facts_callback() {
    produce_cron_store || return 64
    _autorecall_entry_original_facts_callback "$@"
  }

  local helper_output
  if helper_output="$(autorecall_recent_deployment_run "$CANDIDATE" "$ROLLBACK" "$EVIDENCE" "$CORE_DB" stop_gateway ddl_core 2>"$CALLER_STDERR")"; then
    CALLER_RC=0
  else
    CALLER_RC=$?
  fi
  local helper_parse_rc=64
  if printf '%s\n' "$helper_output" >"$EVIDENCE/helper-result.txt" &&
     printf '%s\n' "$CALLER_RC" >"$EVIDENCE/helper.exit-code" &&
     "$NODE" - "$EVIDENCE/helper-result.txt" "$EVIDENCE/helper-result.json" "$CALLER_RC" <<'NODE'
const fs = require('node:fs');
const [input, output, exitCode] = process.argv.slice(2);
const fields = {};
for (const line of fs.readFileSync(input, 'utf8').split(/\r?\n/)) {
  const index = line.indexOf('=');
  if (index > 0) fields[line.slice(0, index)] = line.slice(index + 1);
}
fs.writeFileSync(output, JSON.stringify({ helper_exit_code: Number(exitCode), ...fields }, null, 2) + '\n', { mode: 0o600 });
const required = ['status', 'outcome', 'candidate_invocations', 'candidate_facts_status', 'recovery_invocations', 'recovery_acceptance', 'restart_decision'];
if (!required.every(key => Object.hasOwn(fields, key))) process.exit(64);
NODE
  then
    helper_parse_rc=0
    HELPER_RESULT_VALID=1
  else
    helper_parse_rc=$?
    HELPER_RESULT_VALID=0
  fi
  printf '%s\n' "$helper_parse_rc" >"$EVIDENCE/helper-result.parse-exit-code"

  if [[ -n "$CRON_PRODUCER_PID" ]]; then
    kill -TERM "$CRON_PRODUCER_PID" 2>/dev/null || true
    wait "$CRON_PRODUCER_PID" 2>/dev/null || true
  fi

  if outer_acceptance && start_gateway_and_health; then
    OUTCOME=PASS
    DEPLOYMENT_PATH=candidate
    if write_final_report; then
      printf 'outcome=PASS\nevidence_dir=%s\ncaller_invocations=1\ngateway_restored=1\n' "$EVIDENCE"
      return 0
    fi
    return 64
  fi

  if outer_recovery_acceptance && recover_index_and_validate_core && start_gateway_and_health; then
    OUTCOME=STOPPED_ROLLED_BACK
    DEPLOYMENT_PATH=recovery
    if write_final_report; then
      printf 'outcome=STOPPED_ROLLED_BACK\nevidence_dir=%s\ncaller_invocations=1\ngateway_restored=1\n' "$EVIDENCE"
      [[ "$CALLER_RC" != 0 ]] || return 64
      return "$CALLER_RC"
    fi
    return 64
  fi

  local stop_rc=0
  if [[ -f "$EVIDENCE/gateway-stopped-by-this-run" ]]; then
    if "$SYSTEMCTL" --user stop openclaw-gateway >"$EVIDENCE/gateway-final-stop.stdout" 2>"$EVIDENCE/gateway-final-stop.stderr"; then
      stop_rc=0
    else
      stop_rc=$?
    fi
  fi
  printf '%s\n' "$stop_rc" >"$EVIDENCE/gateway-final-stop.exit-code"
  local cleanup_rc
  if cleanup_index; then
    cleanup_rc=0
  else
    cleanup_rc=$?
  fi
  printf '%s\n' "$cleanup_rc" >"$EVIDENCE/cleanup.exit-code"
  OUTCOME=STOPPED
  DEPLOYMENT_PATH=blocked
  if ! write_final_report; then
    printf 'STOPPED: final report write failed\n' >&2
    return 64
  fi
  printf 'outcome=STOPPED\nevidence_dir=%s\ncaller_invocations=1\ngateway_restored=%s\ncleanup_status=%s\n' "$EVIDENCE" "$GATEWAY_RESTORED" "$CLEANUP_STATUS"
  [[ "$stop_rc" == 0 ]] || return 64
  [[ "$cleanup_rc" == 0 ]] || return 64
  [[ "$CALLER_RC" != 0 ]] || return 64
  return "$CALLER_RC"
}

main "$@"
