import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { collectIndexedFiles } from "../lib/sync/index-sync.js";
import { safeRelativePath } from "../lib/path-utils.js";

test("safeRelativePath returns same POSIX path with or without trailing root slash", () => {
  const target = "/workspace/memory/smart-add/2026-06-08.md";
  assert.equal(
    safeRelativePath("/workspace", target),
    "memory/smart-add/2026-06-08.md"
  );
  assert.equal(
    safeRelativePath("/workspace/", target),
    "memory/smart-add/2026-06-08.md"
  );
});

test("safeRelativePath normalizes Windows-style paths to stable POSIX output", () => {
  const rel = safeRelativePath(
    "C:\\Users\\Alice\\workspace\\",
    "c:\\users\\alice\\workspace\\memory\\smart-add\\2026-06-08.md",
    { pathApi: path.win32 }
  );
  assert.equal(rel, "memory/smart-add/2026-06-08.md");
});

test("safeRelativePath returns null when target is outside root", () => {
  assert.equal(
    safeRelativePath("/workspace", "/other/place/memory/smart-add/2026-06-08.md"),
    null
  );
});

test("safeRelativePath returns empty string when root and target are identical", () => {
  assert.equal(
    safeRelativePath("/workspace/memory", "/workspace/memory"),
    ""
  );
});

test("collectIndexedFiles returns stable POSIX relPath regardless of root trailing slash", () => {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-paths-"));
  const smartAddDir = resolve(root, "memory/smart-add");
  mkdirSync(smartAddDir, { recursive: true });
  writeFileSync(resolve(smartAddDir, "2026-06-08.md"), "# Smart Added Memory\n", "utf8");

  const withoutSlash = collectIndexedFiles(root, ["memory/smart-add"]);
  const withSlash = collectIndexedFiles(`${root}/`, ["memory/smart-add"]);

  assert.equal(withoutSlash.length, 1);
  assert.equal(withSlash.length, 1);
  assert.equal(withoutSlash[0].relPath, "memory/smart-add/2026-06-08.md");
  assert.equal(withSlash[0].relPath, "memory/smart-add/2026-06-08.md");
});
