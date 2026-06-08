import { existsSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { tableExists } from "../db/schema.js";
import { safeRelativePath } from "../path-utils.js";

export function collectIndexedFiles(memoryRoot, watchDirs) {
  const files = [];
  for (const dirRel of watchDirs) {
    const absDir = resolve(memoryRoot, dirRel);
    if (!existsSync(absDir)) continue;

    let entries = [];
    try {
      entries = readdirSync(absDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const absPath = resolve(absDir, entry);
      let stat;
      try {
        stat = statSync(absPath);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      const relPath = safeRelativePath(memoryRoot, absPath);
      if (!relPath) continue;
      files.push({ relPath, mtimeMs: stat.mtimeMs, absPath });
    }
  }
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return files;
}

export function readIndexedPathState(db, pathList) {
  if (!Array.isArray(pathList) || pathList.length === 0) {
    return { paths: [], updatedAt: {} };
  }
  if (!tableExists(db, "chunks")) {
    return { paths: [], updatedAt: {} };
  }
  const placeholders = pathList.map(() => "?").join(", ");
  const rows = db.prepare([
    "SELECT path, MAX(updated_at) AS updated_at",
    "FROM chunks",
    `WHERE path IN (${placeholders})`,
    "GROUP BY path",
  ].join(" ")).all(...pathList);
  const paths = rows.map(row => row.path).sort((a, b) => a.localeCompare(b));
  const updatedAt = {};
  for (const row of rows) {
    updatedAt[row.path] = row.updated_at ?? null;
  }
  return { paths, updatedAt };
}
