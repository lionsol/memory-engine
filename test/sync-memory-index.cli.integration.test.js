import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { dirname, resolve } from "path";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { getMemorySearchManager } from "openclaw/plugin-sdk/memory-core-engine-runtime";
import { localDateKey } from "../date-utils.js";

const ENABLE_INTEGRATION = process.env.OPENCLAW_RUN_MEMORY_SYNC_TEST === "1";
const HOME = homedir();
const CONFIG_PATH = resolve(HOME, ".openclaw/openclaw.json");
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SYNC_CLI_PATH = resolve(TEST_DIR, "../scripts/sync-memory-index.js");

function shouldSkipUnavailableSync(error) {
  const msg = String(error?.message || error || "");
  return /fetch failed|embeddings unavailable|node-llama-cpp|ECONN|EPERM|ENET|rate limit|memory manager unavailable/i.test(msg);
}

function buildEntryBlock(entryId) {
  return [
    `## ${entryId}`,
    "",
    "Category: raw_log",
    "<!-- smart-add-fingerprint: feedfacecafebeef -->",
    "",
    `cli sync probe ${entryId}`,
    "",
  ].join("\n");
}

test("integration: sync-memory-index CLI ingests today's smart-add file", { skip: !ENABLE_INTEGRATION }, async (t) => {
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  const { manager, error } = await getMemorySearchManager({ cfg, agentId: "main" });
  assert.equal(error ?? null, null);
  assert.ok(manager);

  const status = manager.status();
  const workspaceDir = status.workspaceDir;
  const dbPath = status.dbPath;
  const dateKey = localDateKey();
  const relPath = `memory/smart-add/${dateKey}.md`;
  const fileDir = resolve(workspaceDir, "memory/smart-add");
  const filePath = resolve(fileDir, `${dateKey}.md`);

  mkdirSync(fileDir, { recursive: true });
  const existed = existsSync(filePath);
  const original = existed ? readFileSync(filePath, "utf8") : "";
  const entryId = `${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}_raw_log_cli`;

  if (existed) {
    appendFileSync(filePath, `\n${buildEntryBlock(entryId)}`);
  } else {
    writeFileSync(filePath, `# Smart Added Memory\n\n${buildEntryBlock(entryId)}`, "utf8");
  }

  t.after(async () => {
    try {
      if (existed) {
        writeFileSync(filePath, original, "utf8");
      } else {
        unlinkSync(filePath);
      }
    } catch {}
    try {
      await manager.sync({ reason: "integration-cleanup", force: true });
    } catch {}
    await manager.close?.();
  });

  let output;
  try {
    output = execFileSync(process.execPath, [SYNC_CLI_PATH, "--force"], { encoding: "utf8" });
  } catch (error) {
    if (shouldSkipUnavailableSync(error)) {
      t.skip(`sync unavailable in this environment: ${String(error.message || error).slice(0, 200)}`);
      return;
    }
    throw error;
  }

  const parsed = JSON.parse(output);
  assert.equal(parsed.today_smart_add_path, relPath);

  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare("SELECT COUNT(*) AS c FROM chunks WHERE path = ?").get(relPath);
  db.close();
  assert.ok((row?.c || 0) > 0, `expected indexed chunks for ${relPath}`);
});
