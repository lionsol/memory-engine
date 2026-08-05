const { spawnSync } = require("node:child_process");
const tests = JSON.parse(process.argv[process.argv.indexOf("--tests-json") + 1] || "[]");
const root = process.argv[process.argv.indexOf("--root") + 1];
for (const file of tests) {
  if (typeof file !== "string" || file.startsWith("/") || file.split("/").includes("..")) throw new Error("invalid targeted test path");
  const result = spawnSync(process.execPath, [file], { cwd: root, env: { HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, PATH: process.env.PATH, LC_ALL: "C", TZ: "UTC" }, shell: false, encoding: "utf8" });
  if (result.status !== 0) { process.stderr.write(result.stderr || "targeted test failed"); process.exit(result.status || 1); }
}
process.stdout.write(JSON.stringify({ ok: true, count: tests.length }));
