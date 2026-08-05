const fs = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");
function assertSmokeResult(result, label = "native smoke") {
  if (!result || result.ok !== true || result.available !== true) {
    throw new Error(`${label} did not prove an available healthy module`);
  }
  return result;
}

async function runSmoke({ mode, root, smokeRoot = null, requireModule = require, importModule = specifier => import(specifier) } = {}) {
  if (mode !== "sqlite" && mode !== "lancedb") throw new Error(`unsupported native smoke mode:${mode}`);
  if (typeof root !== "string" || !root) throw new Error("native smoke module root required");
  const disposableRoot = smokeRoot || path.join(root, ".runtime-authority-native-smoke");
  const rootRequire = requireModule === require ? createRequire(path.join(root, "package.json")) : requireModule;
  fs.rmSync(disposableRoot, { recursive: true, force: true });
  fs.mkdirSync(disposableRoot, { recursive: true, mode: 0o700 });
  try {
    if (mode === "sqlite") {
      const Database = rootRequire("better-sqlite3");
      const db = new Database(":memory:");
      const row = db.prepare("select sqlite_version() as version").get();
      db.close();
      return assertSmokeResult({ ok: true, available: true, sqlite_version: row.version }, "better-sqlite3 smoke");
    }
    let loaded;
    try { loaded = rootRequire("@lancedb/lancedb"); }
    catch (error) {
      if (error?.code !== "ERR_REQUIRE_ESM") throw error;
      loaded = await importModule(pathToFileUrl(rootRequire.resolve("@lancedb/lancedb")));
    }
    const lancedb = loaded.default || loaded;
    const db = await lancedb.connect(disposableRoot);
    const table = await db.createTable("smoke", [{ id: 1 }], { mode: "overwrite" });
    const rows = await table.query().limit(1).toArray();
    return assertSmokeResult({ ok: rows.length === 1, available: true }, "LanceDB smoke");
  } finally {
    fs.rmSync(disposableRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const mode = process.argv[process.argv.indexOf("--mode") + 1];
  const moduleRoot = process.argv[process.argv.indexOf("--root") + 1];
  const smokeRoot = path.join(process.env.TMPDIR || "/tmp", `runtime-authority-${mode}-smoke`);
  runSmoke({ mode, root: moduleRoot, smokeRoot })
    .then(result => process.stdout.write(JSON.stringify(result)))
    .catch(error => { process.stderr.write(String(error.stack || error)); process.exitCode = 2; });
}

module.exports = { assertSmokeResult, runSmoke };

function pathToFileUrl(value) {
  return require("node:url").pathToFileURL(value).href;
}
