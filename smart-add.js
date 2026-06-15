import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { safeRelativePath } from "./lib/path-utils.js";
import { WORKSPACE } from "./memory-manager-runtime.js";

const SMART_ADD_FINGERPRINT_RE = /<!--\s*smart-add-fingerprint:\s*([a-f0-9]{8,64})\s*-->/gi;
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const SYNC_MEMORY_INDEX_SCRIPT = resolve(MODULE_DIR, "scripts/sync-memory-index.js");

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

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
  loadRunner = () => import("./scripts/sync-memory-index.js"),
  syncCliRunner = runMemoryIndexSyncCli,
} = {}) {
  try {
    const mod = await loadRunner();
    if (typeof mod?.runSyncMemoryIndex !== "function") {
      throw new Error("runSyncMemoryIndex is not available");
    }
    const result = await mod.runSyncMemoryIndex({ force });
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
  const fingerprints = new Set();
  let match;
  while ((match = SMART_ADD_FINGERPRINT_RE.exec(content)) !== null) {
    if (match[1]) fingerprints.add(match[1].toLowerCase());
  }
  return fingerprints;
}

function hasLegacyTextDuplicate(content, text) {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return false;
  const hasFingerprintComment = SMART_ADD_FINGERPRINT_RE.test(content);
  SMART_ADD_FINGERPRINT_RE.lastIndex = 0;
  if (hasFingerprintComment) return false;
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
  syncCli,
  syncCliForce = true,
  syncCliQuiet = true,
  syncRunner = null,
  syncCliRunner = runMemoryIndexSyncCli,
}) {
  const cleanText = normalizeText(text);
  const cat = String(category || "raw_log");
  mkdirSync(fileDir, { recursive: true });
  const existed = existsSync(filePath);
  const existingContent = existed ? readFileSync(filePath, "utf8") : "";

  if (fingerprint) {
    const fingerprints = readSmartAddFingerprints(filePath);
    if (fingerprints.has(String(fingerprint).toLowerCase())) {
      return { appended: false, reason: "fingerprint" };
    }
  }

  if (hasLegacyTextDuplicate(existingContent, cleanText)) {
    return { appended: false, reason: "legacy-text" };
  }

  const header = existed ? "" : "# Smart Added Memory\n\n";
  const entry = `${header}## ${entryId}\n\nCategory: ${cat}${isProtected ? " | Protected" : ""}\n<!-- smart-add-fingerprint: ${fingerprint} -->\n\n${cleanText}\n\n`;
  appendFileSync(filePath, header ? entry : `\n${entry}`);
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
        isProtected: Boolean(isProtected),
        text: cleanText,
        fingerprint,
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
