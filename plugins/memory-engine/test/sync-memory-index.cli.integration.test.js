import test from "node:test";
import assert from "node:assert/strict";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { resolve } from "path";
import Database from "better-sqlite3";
import { DEFAULT_BUSINESS_TIME_ZONE, dateStrInTimeZone } from "../date-utils.js";
import { detectOpenClawRuntime } from "./helpers/openclaw-runtime.js";

const ENABLE_INTEGRATION = process.env.OPENCLAW_RUN_MEMORY_SYNC_TEST === "1";
const OPENCLAW_RUNTIME = await detectOpenClawRuntime();
const getMemorySearchManager = OPENCLAW_RUNTIME.module?.getMemorySearchManager;
const INTEGRATION_SKIP_REASON = !ENABLE_INTEGRATION
  ? "skip: set OPENCLAW_RUN_MEMORY_SYNC_TEST=1 to run integration tests"
  : (OPENCLAW_RUNTIME.available ? false : OPENCLAW_RUNTIME.reason);
const HOME = homedir();
const CONFIG_PATH = resolve(HOME, ".openclaw/openclaw.json");
const SMART_ADD_TIME_ZONE = process.env.MEMORY_ENGINE_TIME_ZONE || DEFAULT_BUSINESS_TIME_ZONE;

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

test("integration: sync-memory-index CLI ingests today's smart-add file", { skip: INTEGRATION_SKIP_REASON }, async (t) => {
  const { runMemoryIndexSyncCli } = await import("../session-checkpoint.js");
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  const { manager, error } = await getMemorySearchManager({ cfg, agentId: "main" });
  assert.equal(error ?? null, null);
  assert.ok(manager);

  const status = manager.status();
  const workspaceDir = status.workspaceDir;
  const dbPath = status.dbPath;
  const dateKey = dateStrInTimeZone(0, SMART_ADD_TIME_ZONE);
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
    const syncResult = runMemoryIndexSyncCli({ force: true, quiet: true });
    output = syncResult.stdout;
  } catch (error) {
    if (shouldSkipUnavailableSync(error)) {
      t.skip(`sync unavailable in this environment: ${String(error.message || error).slice(0, 200)}`);
      return;
    }
    throw error;
  }

  let parsed = null;
  try {
    parsed = output ? JSON.parse(output) : null;
  } catch {}
  if (parsed?.today_smart_add_path) {
    assert.equal(parsed.today_smart_add_path, relPath);
  }

  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare("SELECT COUNT(*) AS c FROM chunks WHERE path = ?").get(relPath);
  db.close();
  assert.ok((row?.c || 0) > 0, `expected indexed chunks for ${relPath}`);
});
