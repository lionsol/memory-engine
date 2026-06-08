import path from "node:path";

export function toPosixPath(value, { pathApi = path } = {}) {
  return String(value ?? "").split(pathApi.sep).join("/");
}

export function safeRelativePath(rootPath, targetPath, { pathApi = path } = {}) {
  const root = pathApi.resolve(String(rootPath || ""));
  const target = pathApi.resolve(String(targetPath || ""));
  const relativePath = pathApi.relative(root, target);
  if (!relativePath) return "";
  if (pathApi.isAbsolute(relativePath)) return null;
  const normalized = toPosixPath(relativePath, { pathApi });
  if (normalized === ".." || normalized.startsWith("../")) return null;
  return normalized;
}
