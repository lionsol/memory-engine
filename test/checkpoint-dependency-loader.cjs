// Optional test-only resolution of existing dependencies in an isolated worktree.
// No installation, copying, runtime calls or modification of the dependency tree.
const { registerHooks, createRequire } = require("node:module");
const { resolve } = require("node:path");
const root = process.env.MEMORY_ENGINE_TEST_DEPENDENCIES;
if (root) {
  const dependencyRequire = createRequire(resolve(root, "package.json"));
  const resolved = Object.fromEntries(["better-sqlite3", "@lancedb/lancedb"]
    .map(name => [name, dependencyRequire.resolve(name)]));
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (["better-sqlite3", "@lancedb/lancedb"].includes(specifier)) {
        return nextResolve(resolved[specifier], context);
      }
      return nextResolve(specifier, context);
    },
  });
}
