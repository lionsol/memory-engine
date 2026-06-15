import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  ENGINE_DB_PATH,
  HOME_DIR,
} from "../memory-manager-runtime.js";
import { DB_PATH as CONSOLE_DB_PATH } from "../console/services/db.js";

test("ENGINE_DB_PATH defaults to ~/.openclaw memory-engine storage instead of project root", () => {
  const expected = resolve(homedir(), ".openclaw/memory/memory-engine/memory-engine.sqlite");
  const projectRootPath = resolve(process.cwd(), "memory-engine.sqlite");

  assert.equal(HOME_DIR, homedir());
  assert.equal(ENGINE_DB_PATH, expected);
  assert.notEqual(ENGINE_DB_PATH, projectRootPath);
});

test("console DB path follows ENGINE_DB_PATH and does not fall back to project root", () => {
  const projectRootPath = resolve(process.cwd(), "memory-engine.sqlite");

  assert.equal(CONSOLE_DB_PATH, ENGINE_DB_PATH);
  assert.notEqual(CONSOLE_DB_PATH, projectRootPath);
});
