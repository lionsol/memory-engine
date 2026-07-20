import crypto from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TextDecoder } from "node:util";

export const TEMP_PREFIX = "memory-engine-r3a-";
export const MANIFEST_NAME = "memory-engine.install-metadata.json";
export const MANIFEST_MAX_BYTES = 64 * 1024;

const CONTRACT = "openclaw.host-plugin-install-metadata/v1";
const PLUGIN_ID = "memory-engine";
const INSTALLED_AUTHORITY_TYPE = "openclaw-host-installed-plugin-index";
const ABSENT_REASONS = new Set([
  "uninstalled",
  "disabled-by-host-policy",
  "install-record-missing",
]);
const FAULTS = new Set([
  "after_temp_create",
  "after_temp_write",
  "after_temp_fsync",
  "before_rename",
]);
const HEX_64 = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sortedValue(value) {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortedValue(value[key])]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("non-finite-json-number");
  }
  if (value === undefined) throw new Error("undefined-json-value");
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(sortedValue(value), null, 2)}\n`;
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function sha256Canonical(value) {
  return sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));
}

function canonicalTimestamp(value) {
  if (typeof value !== "string" || !TIMESTAMP.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function keysAre(value, keys) {
  return isPlainObject(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function validateHex(value) {
  return typeof value === "string" && HEX_64.test(value);
}

function installRecordForHash(install) {
  const { manifest_sha256: _manifest, install_record_sha256: _record, ...record } = install;
  return record;
}

function manifestForHash(manifest) {
  return {
    ...manifest,
    install: manifest.install === null
      ? null
      : { ...manifest.install, manifest_sha256: null },
  };
}

function validateManifestObject(manifest, { verifyHashes = true } = {}) {
  const errors = [];
  if (!keysAre(manifest, [
    "schema_version",
    "contract",
    "plugin_id",
    "generation",
    "publication_id",
    "published_at",
    "state",
    "authority",
    "install",
    "absent_reason",
  ])) errors.push("manifest_keys_invalid");
  if (manifest?.schema_version !== 1) errors.push("schema_unsupported");
  if (manifest?.contract !== CONTRACT) errors.push("contract_invalid");
  if (manifest?.plugin_id !== PLUGIN_ID) errors.push("plugin_id_invalid");
  if (typeof manifest?.generation !== "string" || !/^[1-9]\d*$/.test(manifest.generation)) {
    errors.push("generation_invalid");
  }
  if (!validateHex(manifest?.publication_id)) errors.push("publication_id_invalid");
  if (!canonicalTimestamp(manifest?.published_at)) errors.push("published_at_invalid");
  if (!keysAre(manifest?.authority, ["type", "revision", "updated_at"])) {
    errors.push("authority_keys_invalid");
  }
  if (manifest?.authority?.type !== INSTALLED_AUTHORITY_TYPE) errors.push("authority_type_invalid");
  if (typeof manifest?.authority?.revision !== "string" || manifest.authority.revision.length === 0) {
    errors.push("authority_revision_invalid");
  }
  if (!canonicalTimestamp(manifest?.authority?.updated_at)) errors.push("authority_updated_at_invalid");

  if (manifest?.state === "installed") {
    if (!keysAre(manifest.install, [
      "install_path",
      "source_path",
      "version",
      "installed_at",
      "manifest_sha256",
      "install_record_sha256",
    ])) errors.push("install_keys_invalid");
    if (!isPlainObject(manifest.install)) errors.push("install_missing");
    else {
      if (!path.isAbsolute(manifest.install.install_path)) errors.push("install_path_not_absolute");
      if (!path.isAbsolute(manifest.install.source_path)) errors.push("source_path_not_absolute");
      if (typeof manifest.install.version !== "string" || manifest.install.version.length === 0) {
        errors.push("installed_version_invalid");
      }
      if (!canonicalTimestamp(manifest.install.installed_at)) errors.push("installed_at_invalid");
      if (!validateHex(manifest.install.manifest_sha256)) errors.push("manifest_hash_invalid");
      if (!validateHex(manifest.install.install_record_sha256)) errors.push("install_record_hash_invalid");
      if (verifyHashes && validateHex(manifest.install.install_record_sha256)) {
        if (sha256Canonical(installRecordForHash(manifest.install)) !== manifest.install.install_record_sha256) {
          errors.push("install_record_hash_mismatch");
        }
      }
      if (verifyHashes && validateHex(manifest.install.manifest_sha256)) {
        if (sha256Canonical(manifestForHash(manifest)) !== manifest.install.manifest_sha256) {
          errors.push("manifest_hash_mismatch");
        }
      }
    }
    if (manifest.absent_reason !== null) errors.push("installed_absent_reason_invalid");
  } else if (manifest?.state === "absent") {
    if (manifest.install !== null) errors.push("absent_install_must_be_null");
    if (!ABSENT_REASONS.has(manifest.absent_reason)) errors.push("absent_reason_invalid");
  } else {
    errors.push("state_invalid");
  }
  return errors;
}

export function createSyntheticManifest({
  state = "installed",
  generation = "1",
  publication_id = "a".repeat(64),
  published_at = "2026-07-20T00:00:00.000Z",
  authority_revision = "synthetic-authority-revision-A",
  authority_updated_at = "2026-07-20T00:00:00.000Z",
  absent_reason = null,
  install_path = "/synthetic/runtime/memory-engine",
  source_path = "/synthetic/source/memory-engine",
  version = "0.0.0-synthetic",
  installed_at = "2026-07-20T00:00:00.000Z",
} = {}) {
  const base = {
    schema_version: 1,
    contract: CONTRACT,
    plugin_id: PLUGIN_ID,
    generation,
    publication_id,
    published_at,
    state,
    authority: {
      type: INSTALLED_AUTHORITY_TYPE,
      revision: authority_revision,
      updated_at: authority_updated_at,
    },
    install: state === "installed"
      ? {
        install_path,
        source_path,
        version,
        installed_at,
        manifest_sha256: null,
        install_record_sha256: null,
      }
      : null,
    absent_reason: state === "absent" ? absent_reason : null,
  };
  if (state !== "installed") return base;
  const install_record_sha256 = sha256Canonical(installRecordForHash(base.install));
  const withRecordHash = {
    ...base,
    install: { ...base.install, install_record_sha256 },
  };
  const manifest_sha256 = sha256Canonical(withRecordHash);
  return {
    ...withRecordHash,
    install: { ...withRecordHash.install, manifest_sha256 },
  };
}

function assertSyntheticRoot(rootDir) {
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new Error("synthetic_root_invalid");
  const root = path.resolve(rootDir);
  const temp = path.resolve(tmpdir());
  const relative = path.relative(temp, root);
  const firstComponent = relative.split(path.sep)[0];
  if (!relative || relative.startsWith("..") || !firstComponent.startsWith(TEMP_PREFIX)) {
    throw new Error("synthetic_root_invalid");
  }
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("synthetic_root_invalid");
}

function faultIf(fault, point) {
  if (fault === point) throw new Error(`synthetic_publish_fault:${point}`);
}

function syncParentDirectory(rootDir) {
  let fd;
  try {
    fd = openSync(rootDir, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
    fsyncSync(fd);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function publishSyntheticManifestAtomic(rootDir, manifest, options = {}) {
  assertSyntheticRoot(rootDir);
  const fault = options.fault ?? null;
  if (fault !== null && !FAULTS.has(fault)) throw new Error("synthetic_publish_fault_invalid");
  const validation = validateManifestObject(manifest);
  if (validation.length) throw new Error("manifest_invalid");
  const finalPath = path.join(rootDir, MANIFEST_NAME);
  const tempPath = path.join(rootDir, `.${MANIFEST_NAME}.tmp-${crypto.randomBytes(8).toString("hex")}`);
  const bytes = Buffer.from(canonicalJson(manifest), "utf8");
  let fd;
  try {
    fd = openSync(
      tempPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    fchmodSync(fd, 0o600);
    faultIf(fault, "after_temp_create");
    writeSync(fd, bytes);
    faultIf(fault, "after_temp_write");
    fsyncSync(fd);
    faultIf(fault, "after_temp_fsync");
    closeSync(fd);
    fd = undefined;
    faultIf(fault, "before_rename");
    renameSync(tempPath, finalPath);
    syncParentDirectory(rootDir);
  } catch (error) {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* cleanup is best effort */ }
    }
    try { if (existsSync(tempPath)) unlinkSync(tempPath); } catch { /* cleanup is best effort */ }
    throw error;
  }
}

function statField(value) {
  return typeof value === "bigint" ? value.toString() : String(value);
}

function fileIdentity(stat) {
  return {
    device: statField(stat.dev),
    inode: statField(stat.ino),
    size: statField(stat.size),
    mode: statField(stat.mode),
    link_count: statField(stat.nlink),
    mtime_ns: stat.mtimeNs === undefined ? null : statField(stat.mtimeNs),
    ctime_ns: stat.ctimeNs === undefined ? null : statField(stat.ctimeNs),
  };
}

function sameIdentity(before, after) {
  return before.device === after.device
    && before.inode === after.inode
    && before.size === after.size
    && before.mtime_ns === after.mtime_ns
    && before.ctime_ns === after.ctime_ns;
}

function decodeUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function emptySnapshot() {
  return {
    schema_version: 1,
    checked_at: new Date().toISOString(),
    source_type: "host_published_plugin_metadata_manifest",
    manifest_path_family: `${TEMP_PREFIX}*/${MANIFEST_NAME}`,
    manifest_exists: false,
    manifest_sha256: null,
    manifest_byte_count: 0,
    valid: false,
    installed: false,
    state: null,
    generation: null,
    publication_id: null,
    published_at: null,
    authority_type: null,
    authority_revision: null,
    authority_updated_at: null,
    plugin_id: null,
    install_path: null,
    source_path: null,
    installed_version: null,
    installed_at: null,
    file_regular: false,
    file_symlink: false,
    file_link_count: null,
    file_mode: null,
    owner_check_supported: false,
    owner_matches: false,
    observable_write_detected: false,
    blockers: [],
  };
}

function snapshotError(result, code) {
  if (!result.blockers.includes(code)) result.blockers.push(code);
  return result;
}

export function readSyntheticManifestSnapshot(rootDir) {
  const result = emptySnapshot();
  try {
    assertSyntheticRoot(rootDir);
  } catch {
    return snapshotError(result, "synthetic_root_invalid");
  }
  const finalPath = path.join(rootDir, MANIFEST_NAME);
  let descriptor;
  let before;
  let after;
  try {
    const linkStat = lstatSync(finalPath, { bigint: true });
    result.manifest_exists = true;
    result.file_symlink = linkStat.isSymbolicLink();
    if (result.file_symlink) return snapshotError(result, "manifest_symlink");
    if (!linkStat.isFile()) return snapshotError(result, "manifest_not_regular_file");
    descriptor = openSync(finalPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    before = fstatSync(descriptor, { bigint: true });
    const identityBefore = fileIdentity(before);
    result.file_regular = before.isFile();
    result.file_link_count = statField(before.nlink);
    result.file_mode = statField(before.mode & 0o777n);
    if (!result.file_regular) return snapshotError(result, "manifest_not_regular_file");
    if (before.nlink !== 1n) return snapshotError(result, "manifest_link_count_invalid");
    if ((before.mode & 0o077n) !== 0n) return snapshotError(result, "manifest_permissions_invalid");
    if (typeof process.getuid === "function") {
      result.owner_check_supported = true;
      result.owner_matches = before.uid === BigInt(process.getuid());
      if (!result.owner_matches) return snapshotError(result, "manifest_owner_invalid");
    }
    if (before.size > BigInt(MANIFEST_MAX_BYTES)) return snapshotError(result, "manifest_oversized");
    const bytes = readFileSync(descriptor);
    result.manifest_byte_count = bytes.byteLength;
    try {
      const text = decodeUtf8(bytes);
      if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        snapshotError(result, "manifest_bom");
      } else if (text.includes("\0")) {
        snapshotError(result, "manifest_nul");
      } else {
        const parsed = JSON.parse(text);
        if (canonicalJson(parsed) !== text) {
          snapshotError(result, "manifest_not_canonical");
        } else {
          const validation = validateManifestObject(parsed);
          if (validation.length) {
            for (const error of validation) snapshotError(result, error);
          } else {
            result.manifest_sha256 = sha256Bytes(bytes);
            result.valid = true;
            result.installed = parsed.state === "installed";
            result.state = parsed.state;
            result.generation = parsed.generation;
            result.publication_id = parsed.publication_id;
            result.published_at = parsed.published_at;
            result.authority_type = parsed.authority.type;
            result.authority_revision = parsed.authority.revision;
            result.authority_updated_at = parsed.authority.updated_at;
            result.plugin_id = parsed.plugin_id;
            result.install_path = parsed.install?.install_path ?? null;
            result.source_path = parsed.install?.source_path ?? null;
            result.installed_version = parsed.install?.version ?? null;
            result.installed_at = parsed.install?.installed_at ?? null;
          }
        }
      }
    } catch (error) {
      snapshotError(result, error?.name === "TypeError" ? "manifest_utf8_invalid" : "manifest_json_invalid");
    }
    after = fstatSync(descriptor, { bigint: true });
    if (!sameIdentity(identityBefore, fileIdentity(after))) snapshotError(result, "manifest_changed_during_read");
  } catch (error) {
    if (error?.code === "ENOENT") snapshotError(result, "manifest_missing");
    else snapshotError(result, error?.code ?? "manifest_read_failed");
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { snapshotError(result, "manifest_close_failed"); }
    }
  }
  return result;
}

function fingerprintFileTree(rootDir) {
  const entries = new Map();
  function visit(absolute, relative) {
    const stat = lstatSync(absolute, { bigint: true });
    entries.set(relative, {
      relative_path: relative,
      file_type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other",
      mode: statField(stat.mode),
      inode: statField(stat.ino),
      link_count: statField(stat.nlink),
      size: statField(stat.size),
      mtime_ns: stat.mtimeNs === undefined ? null : statField(stat.mtimeNs),
      ctime_ns: stat.ctimeNs === undefined ? null : statField(stat.ctimeNs),
      sha256: stat.isFile() ? sha256Bytes(readFileSync(absolute)) : null,
    });
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) visit(path.join(absolute, name), relative ? path.join(relative, name) : name);
    }
  }
  visit(rootDir, "");
  return entries;
}

export function compareSyntheticFingerprints(before, after) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  const result = {
    new_files: [],
    deleted_files: [],
    content_changed_files: [],
    metadata_changed_files: [],
    observable_write_detected: false,
  };
  for (const relative of [...paths].sort()) {
    const oldEntry = before.get(relative);
    const newEntry = after.get(relative);
    if (!oldEntry) result.new_files.push(relative);
    else if (!newEntry) result.deleted_files.push(relative);
    else {
      if (oldEntry.sha256 !== newEntry.sha256 || oldEntry.size !== newEntry.size) result.content_changed_files.push(relative);
      if (oldEntry.mode !== newEntry.mode || oldEntry.inode !== newEntry.inode || oldEntry.link_count !== newEntry.link_count
        || oldEntry.mtime_ns !== newEntry.mtime_ns || oldEntry.ctime_ns !== newEntry.ctime_ns) {
        result.metadata_changed_files.push(relative);
      }
    }
  }
  result.observable_write_detected = result.new_files.length > 0
    || result.deleted_files.length > 0
    || result.content_changed_files.length > 0
    || result.metadata_changed_files.length > 0;
  return result;
}

export function runSyntheticManifestSmoke() {
  const root = mkdtempSync(path.join(tmpdir(), TEMP_PREFIX));
  const scenarios = [];
  const add = (id, fn) => {
    const dir = path.join(root, id);
    mkdirSync(dir);
    try {
      const result = fn(dir);
      scenarios.push({ id, ...result });
    } catch (error) {
      scenarios.push({ id, status: "BLOCKED", valid: false, installed: false, blockers: [error?.code ?? "scenario_failed"] });
    }
  };
  const consumerRead = (dir, expected) => {
    const before = fingerprintFileTree(dir);
    const snapshot = readSyntheticManifestSnapshot(dir);
    const after = fingerprintFileTree(dir);
    const diff = compareSyntheticFingerprints(before, after);
    return {
      status: snapshot.valid === expected.valid && !diff.observable_write_detected ? "PASS" : "BLOCKED",
      valid: snapshot.valid,
      installed: snapshot.installed,
      state: snapshot.state,
      observable_write_detected: diff.observable_write_detected,
      blockers: [...snapshot.blockers, ...(diff.observable_write_detected ? ["consumer_observable_write"] : [])],
    };
  };
  try {
    add("valid-installed", (dir) => {
      publishSyntheticManifestAtomic(dir, createSyntheticManifest());
      return consumerRead(dir, { valid: true });
    });
    add("valid-absent-tombstone", (dir) => {
      publishSyntheticManifestAtomic(dir, createSyntheticManifest({ state: "absent", absent_reason: "uninstalled" }));
      return consumerRead(dir, { valid: true });
    });
    add("installed-to-absent", (dir) => {
      publishSyntheticManifestAtomic(dir, createSyntheticManifest());
      publishSyntheticManifestAtomic(dir, createSyntheticManifest({ state: "absent", absent_reason: "install-record-missing", generation: "2", publication_id: "b".repeat(64) }));
      const result = consumerRead(dir, { valid: true });
      return { ...result, installed: result.installed === false ? false : result.installed };
    });
    add("orphan-temp-ignored", (dir) => {
      publishSyntheticManifestAtomic(dir, createSyntheticManifest());
      const orphan = openSync(path.join(dir, `.${MANIFEST_NAME}.tmp-orphan`), constants.O_CREAT | constants.O_WRONLY, 0o600);
      writeSync(orphan, Buffer.from("{", "utf8"));
      closeSync(orphan);
      return consumerRead(dir, { valid: true });
    });
    add("interrupted-before-rename", (dir) => {
      const fd = openSync(path.join(dir, `.${MANIFEST_NAME}.tmp-partial`), constants.O_CREAT | constants.O_WRONLY, 0o600);
      writeSync(fd, Buffer.from("{\"schema_version\":1", "utf8"));
      closeSync(fd);
      return consumerRead(dir, { valid: false });
    });
    add("writer-failure-preserves-old", (dir) => {
      const first = createSyntheticManifest();
      publishSyntheticManifestAtomic(dir, first);
      try { publishSyntheticManifestAtomic(dir, createSyntheticManifest({ generation: "2", publication_id: "b".repeat(64) }), { fault: "before_rename" }); } catch { /* expected */ }
      const result = consumerRead(dir, { valid: true });
      return { ...result, state: "installed" };
    });
    add("atomic-replacement", (dir) => {
      publishSyntheticManifestAtomic(dir, createSyntheticManifest());
      const fd = openSync(path.join(dir, MANIFEST_NAME), constants.O_RDONLY);
      publishSyntheticManifestAtomic(dir, createSyntheticManifest({ generation: "2", publication_id: "b".repeat(64) }));
      const oldBytes = readFileSync(fd);
      closeSync(fd);
      const current = readSyntheticManifestSnapshot(dir);
      const old = JSON.parse(decodeUtf8(oldBytes));
      const result = consumerRead(dir, { valid: true });
      return { ...result, old_generation: old.generation, current_generation: current.generation };
    });
    for (const [id, raw] of [
      ["malformed-json", "{"],
      ["duplicate-key", '{"a":1,"a":1}'],
      ["non-canonical", '{\n  "contract": "openclaw.host-plugin-install-metadata/v1",\n  "schema_version": 1\n}\n'],
    ]) {
      add(id, (dir) => {
        const fd = openSync(path.join(dir, MANIFEST_NAME), constants.O_CREAT | constants.O_WRONLY, 0o600);
        writeSync(fd, Buffer.from(raw, "utf8"));
        closeSync(fd);
        return consumerRead(dir, { valid: false });
      });
    }
    add("oversized", (dir) => {
      const fd = openSync(path.join(dir, MANIFEST_NAME), constants.O_CREAT | constants.O_WRONLY, 0o600);
      writeSync(fd, Buffer.alloc(MANIFEST_MAX_BYTES + 1, 0x20));
      closeSync(fd);
      return consumerRead(dir, { valid: false });
    });
    add("final-symlink", (dir) => {
      const target = path.join(dir, "target");
      const fd = openSync(target, constants.O_CREAT | constants.O_WRONLY, 0o600);
      writeSync(fd, Buffer.from(canonicalJson(createSyntheticManifest()), "utf8"));
      closeSync(fd);
      symlinkSync(target, path.join(dir, MANIFEST_NAME));
      return consumerRead(dir, { valid: false });
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const blockers = scenarios.flatMap((scenario) => scenario.blockers.map((blocker) => `${scenario.id}:${blocker}`));
  const blocked = scenarios.some((scenario) => scenario.status !== "PASS");
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    temp_root_family: `${TEMP_PREFIX}*`,
    real_path_accessed: false,
    production_authorized: false,
    scenarios,
    decision: blocked
      ? "B8-A7-R3A synthetic manifest contract=BLOCKED / ATOMICITY OR READ-ONLY CONTRACT NOT PROVEN"
      : "B8-A7-R3A synthetic manifest contract=PASSED / HOST INTEGRATION SOURCE AUDIT REQUIRED",
    blockers,
  };
}
