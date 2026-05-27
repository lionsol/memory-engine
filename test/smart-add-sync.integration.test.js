import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import Database from "better-sqlite3";
import { addDaysLocal, localDateKey } from "../date-utils.js";
import { detectOpenClawRuntime } from "./helpers/openclaw-runtime.js";

const ENABLE_INTEGRATION = process.env.OPENCLAW_RUN_MEMORY_SYNC_TEST === "1";
const OPENCLAW_RUNTIME = await detectOpenClawRuntime();
const getMemorySearchManager = OPENCLAW_RUNTIME.module?.getMemorySearchManager;
const INTEGRATION_SKIP_REASON = !ENABLE_INTEGRATION
  ? "skip: set OPENCLAW_RUN_MEMORY_SYNC_TEST=1 to run integration tests"
  : (OPENCLAW_RUNTIME.available ? false : OPENCLAW_RUNTIME.reason);
const HOME = homedir();
const CONFIG_PATH = resolve(HOME, ".openclaw/openclaw.json");

function findTempDailyFilePath(workspaceDir) {
  const dir = resolve(workspaceDir, "memory/smart-add");
  mkdirSync(dir, { recursive: true });
  const now = new Date();
  for (let i = 0; i < 365; i += 1) {
    const date = addDaysLocal(now, i + 1);
    const key = localDateKey(date);
    const filePath = resolve(dir, `${key}.md`);
    if (!existsSync(filePath)) return { filePath, relPath: `memory/smart-add/${key}.md` };
  }
  throw new Error("unable to find unused smart-add daily filename within next 365 days");
}

function shouldSkipUnavailableSync(error) {
  const msg = String(error?.message || error || "");
  return /fetch failed|embeddings unavailable|node-llama-cpp|ECONN|EPERM|ENET|rate limit/i.test(msg);
}

test("integration: sync ingests a new smart-add daily file", { skip: INTEGRATION_SKIP_REASON }, async (t) => {
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  const agentId = "main";
  const { manager, error } = await getMemorySearchManager({ cfg, agentId });
  assert.equal(error ?? null, null);
  assert.ok(manager);

  const status = manager.status();
  const workspaceDir = status.workspaceDir;
  const dbPath = status.dbPath;
  const { filePath, relPath } = findTempDailyFilePath(workspaceDir);
  const entryId = `${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}_raw_log`;
  const content = [
    "# Smart Added Memory",
    "",
    `## ${entryId}`,
    "",
    "Category: raw_log",
    "<!-- smart-add-fingerprint: 0123456789abcde0 -->",
    "",
    "integration sync probe",
    "",
  ].join("\n");
  writeFileSync(filePath, content, "utf8");

  const cleanup = async () => {
    try {
      unlinkSync(filePath);
    } catch {}
    try {
      await manager.sync({ reason: "integration-cleanup", force: true });
    } catch {}
    await manager.close?.();
  };
  t.after(cleanup);

  try {
    await manager.sync({ reason: "integration-probe", force: true });
  } catch (e) {
    if (shouldSkipUnavailableSync(e)) {
      t.skip(`sync unavailable in this environment: ${String(e.message || e).slice(0, 200)}`);
      return;
    }
    throw e;
  }

  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare("SELECT id, path FROM chunks WHERE path = ? LIMIT 5").all(relPath);
  db.close();
  assert.ok(rows.length > 0, `expected indexed chunks for ${relPath}`);
});
