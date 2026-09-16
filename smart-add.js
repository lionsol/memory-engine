import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { safeRelativePath } from "./lib/path-utils.js";
import { WORKSPACE } from "./memory-manager-runtime.js";
import smartAddEntryContract from "./lib/smart-add-entry-contract.cjs";
import smartAddFileLock from "./lib/smart-add-file-lock.cjs";

const {
  SMART_ADD_FINGERPRINT_MISMATCH,
  buildSmartAddFingerprint,
  extractSmartAddFingerprints,
  hasSmartAddFingerprintComment,
  normalizeSmartAddCategory,
  normalizeSmartAddText,
  renderSmartAddEntry,
} = smartAddEntryContract;
const { withSmartAddFileLock } = smartAddFileLock;
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const SYNC_MEMORY_INDEX_SCRIPT = resolve(MODULE_DIR, "bin/sync-memory-index.js");

function shouldAutoSyncPath(filePath) {
  return safeRelativePath(WORKSPACE, filePath) !== null;
}

export function runMemoryIndexSyncCli({
  force = true,
  quiet = true,
  spawnSyncImpl = spawnSync,
  nodeExecPath = process.execPath,
  scriptPath = SYNC_MEMORY_INDEX_SCRIPT,
  cwd = MODULE_DIR,
  env = process.env,
} = {}) {
  const args = [scriptPath];
  if (force) args.push("--force");
  try {
    const result = spawnSyncImpl(nodeExecPath, args, {
      cwd,
      env,
      encoding: "utf8",
    });
    const stdout = String(result?.stdout || "");
    const stderr = String(result?.stderr || "");
    const status = Number.isInteger(result?.status) ? result.status : null;
    const signal = result?.signal || null;
    const errorMessage = result?.error
      ? String(result.error?.message || result.error)
      : (status === 0 ? "" : (stderr.trim() || `sync-memory-index exited with status ${status ?? "unknown"}`));
    if (!quiet && stdout.trim()) console.log(stdout.trim());
    if (!quiet && stderr.trim()) console.error(stderr.trim());
    return {
      ok: !errorMessage,
      status,
      signal,
      stdout,
      stderr,
      ...(errorMessage ? { error: errorMessage } : {}),
    };
  } catch (error) {
    const stdout = String(error?.stdout || "");
    const stderr = String(error?.stderr || "");
    return {
      ok: false,
      status: Number.isInteger(error?.status) ? error.status : null,
      signal: error?.signal || null,
      stdout,
      stderr,
      error: stderr.trim() || String(error?.message || error),
    };
  }
}

function normalizeSyncError(error) {
  return String(error?.message || error || "sync failed");
}

function normalizeSyncResult(result, defaults = {}) {
  if (result && typeof result === "object") return { ...defaults, ...result };
  return { ...defaults, ok: true, result };
}

export async function runMemoryIndexSync({
  force = true,
  quiet = true,
  loadRunner = () => import("./bin/sync-memory-index.js"),
  syncCliRunner = runMemoryIndexSyncCli,
} = {}) {
  try {
    const mod = await loadRunner();
    const runSyncMemoryIndex = mod?.runSyncMemoryIndex || mod?.default?.runSyncMemoryIndex;
    if (typeof runSyncMemoryIndex !== "function") {
      throw new Error("runSyncMemoryIndex is not available");
    }
    const result = await runSyncMemoryIndex({ force });
    return normalizeSyncResult(result, { ok: true, mode: "in-process" });
  } catch (error) {
    const cliResult = syncCliRunner({
      force,
      quiet,
    });
    return normalizeSyncResult(cliResult, {
      ok: false,
      mode: "cli-fallback",
      fallback_from: "in-process",
      in_process_error: normalizeSyncError(error),
    });
  }
}

export function readSmartAddFingerprints(filePath) {
  if (!existsSync(filePath)) return new Set();
  const content = readFileSync(filePath, "utf8");
  return extractSmartAddFingerprints(content);
}

function hasLegacyTextDuplicate(content, text) {
  const normalizedText = normalizeSmartAddText(text);
  if (!normalizedText) return false;
  if (hasSmartAddFingerprintComment(content)) return false;
  return content.includes(normalizedText);
}

export async function appendSmartAdd({
  fileDir,
  filePath,
  entryId,
  category,
  isProtected,
  text,
  fingerprint,
  provenance = "agent_smart_add",
  syncCli,
  syncCliForce = true,
  syncCliQuiet = true,
  syncRunner = null,
  syncCliRunner = runMemoryIndexSyncCli,
}) {
  const cleanText = normalizeSmartAddText(text);
  const cat = normalizeSmartAddCategory(category) || "raw_log";
  const protectedValue = Boolean(isProtected);
  const canonicalFingerprint = buildSmartAddFingerprint(cleanText, cat, protectedValue);
  if (fingerprint !== undefined && fingerprint !== null
    && String(fingerprint).trim().toLowerCase() !== canonicalFingerprint) {
    const error = new Error("smart-add fingerprint does not match canonical identity");
    error.code = SMART_ADD_FINGERPRINT_MISMATCH;
    throw error;
  }

  mkdirSync(fileDir, { recursive: true });
  const appendResult = withSmartAddFileLock(filePath, () => {
    const existed = existsSync(filePath);
    const existingContent = existed ? readFileSync(filePath, "utf8") : "";
    const fingerprints = extractSmartAddFingerprints(existingContent);
    if (fingerprints.has(canonicalFingerprint)) {
      return { appended: false, reason: "fingerprint" };
    }

    if (hasLegacyTextDuplicate(existingContent, cleanText)) {
      return { appended: false, reason: "legacy-text" };
    }

    const header = existed ? "" : "# Smart Added Memory\n\n";
    const entry = renderSmartAddEntry({
      entryId,
      category: cat,
      isProtected: protectedValue,
      provenance: String(provenance || "agent_smart_add").trim() || "agent_smart_add",
      text: cleanText,
      fingerprint: canonicalFingerprint,
    });
    appendFileSync(filePath, header ? `${header}${entry}` : `\n${entry}`);
    return { appended: true };
  });
  if (!appendResult.appended) return appendResult;

  const shouldSync = typeof syncCli === "boolean" ? syncCli : shouldAutoSyncPath(filePath);
  if (!shouldSync) return { appended: true };
  let sync;
  try {
    sync = typeof syncRunner === "function"
      ? await syncRunner({
        force: syncCliForce,
        quiet: syncCliQuiet,
        fileDir,
        filePath,
        entryId,
        category: cat,
        isProtected: protectedValue,
        text: cleanText,
        fingerprint: canonicalFingerprint,
      })
      : await runMemoryIndexSync({
        force: syncCliForce,
        quiet: syncCliQuiet,
        syncCliRunner,
      });
  } catch (error) {
    sync = { ok: false, error: normalizeSyncError(error) };
  }
  return { appended: true, sync };
}
