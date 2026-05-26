import { execFileSync } from "child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { WORKSPACE } from "./memory-manager-runtime.js";

const SMART_ADD_FINGERPRINT_RE = /<!--\s*smart-add-fingerprint:\s*([a-f0-9]{8,64})\s*-->/gi;
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const SYNC_CLI_PATH = resolve(MODULE_DIR, "scripts/sync-memory-index.js");

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function shouldAutoSyncPath(filePath) {
  const normalized = String(filePath || "");
  const workspacePrefix = WORKSPACE.endsWith("/") ? WORKSPACE : `${WORKSPACE}/`;
  return normalized.startsWith(workspacePrefix);
}

export function runMemoryIndexSyncCli({ force = true, quiet = true } = {}) {
  const args = [SYNC_CLI_PATH];
  if (force) args.push("--force");
  try {
    const stdout = execFileSync(process.execPath, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (!quiet && stdout?.trim()) console.log(stdout.trim());
    return { ok: true, stdout: stdout || "" };
  } catch (error) {
    const stderr = String(error?.stderr || "").trim();
    return {
      ok: false,
      error: stderr || String(error?.message || error),
    };
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

export function appendSmartAdd({
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
  const sync = runMemoryIndexSyncCli({ force: syncCliForce, quiet: syncCliQuiet });
  return { appended: true, sync };
}
