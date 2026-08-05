const { execFileSync } = require("node:child_process");
const { existsSync, lstatSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const { SANDBOX_OPERATIONS } = require("./constants.js");

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--") || !argv[index + 1] || Object.prototype.hasOwnProperty.call(result, key.slice(2))) throw new Error("invalid sandbox child arguments");
    result[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[++index];
  }
  return result;
}

function mount(mountExecutable, args) {
  execFileSync(mountExecutable, args, { shell: false, timeout: 10_000, maxBuffer: 64 * 1024, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" } });
}

function inside(root, path) { return path === root || path.startsWith(`${root}/`); }

function mapPath(value, { staging, runtimeRoot }) {
  if (!value || typeof value !== "string") return value;
  if (inside(staging, value)) return `/staging${value.slice(staging.length)}`;
  if (inside(runtimeRoot, value)) return `/runtime${value.slice(runtimeRoot.length)}`;
  return value;
}

const OPTIONAL_PYTHON_READONLY_BINDS = Object.freeze([
  ["/usr/lib/python312.zip", "usr/lib/python312.zip"],
  ["/usr/lib/python3.12", "usr/lib/python3.12"],
  ["/usr/lib/python3/dist-packages", "usr/lib/python3/dist-packages"],
  ["/usr/include/python3.12", "usr/include/python3.12"],
]);

function bindReadOnly(mountExecutable, sandboxRoot, source, target) {
  const sourceStats = lstatSync(source);
  const targetPath = `${sandboxRoot}/${target}`;
  mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 });
  if (sourceStats.isDirectory()) mkdirSync(targetPath, { recursive: true, mode: 0o700 });
  else writeFileSync(targetPath, "", { mode: 0o600 });
  mount(mountExecutable, ["--bind", source, targetPath]);
  mount(mountExecutable, ["-o", "remount,bind,ro", targetPath]);
}

function setupNamespace(args) {
  const sandboxRoot = resolve(args.staging, ".runtime-authority-sandbox-root");
  mkdirSync(sandboxRoot, { recursive: true, mode: 0o700 });
  mount(args.mountExecutable, ["--make-rprivate", "/"]);
  mount(args.mountExecutable, ["-t", "tmpfs", "-o", "mode=700", "tmpfs", sandboxRoot]);
  for (const name of ["staging", "runtime", "usr", "usr/bin", "usr/sbin", "usr/include", "usr/lib", "usr/lib/gcc", "usr/libexec", "usr/libexec/gcc", "usr/lib/x86_64-linux-gnu", "usr/lib64", "usr/share", "bin", "lib", "lib/x86_64-linux-gnu", "lib64", "etc", "proc", "tmp", "home", "root", "dev"]) {
    mkdirSync(`${sandboxRoot}/${name}`, { recursive: true, mode: 0o700 });
  }
  mount(args.mountExecutable, ["--bind", args.staging, `${sandboxRoot}/staging`]);
  mount(args.mountExecutable, ["--bind", resolve(args.runtimeRoot), `${sandboxRoot}/runtime`]);
  for (const [source, target] of [
    ["/usr/bin", "usr/bin"], ["/usr/sbin", "usr/sbin"], ["/usr/include", "usr/include"], ["/usr/lib/gcc", "usr/lib/gcc"], ["/usr/libexec/gcc", "usr/libexec/gcc"], ["/usr/lib/x86_64-linux-gnu", "usr/lib/x86_64-linux-gnu"],
    ["/usr/lib64", "usr/lib64"], ["/usr/share", "usr/share"], ["/bin", "bin"], ["/lib/x86_64-linux-gnu", "lib/x86_64-linux-gnu"], ["/lib64", "lib64"], ["/etc", "etc"],
  ]) {
    mount(args.mountExecutable, ["--bind", source, `${sandboxRoot}/${target}`]);
  }
  for (const [source, target] of OPTIONAL_PYTHON_READONLY_BINDS) {
    if (existsSync(source)) bindReadOnly(args.mountExecutable, sandboxRoot, source, target);
  }
  for (const name of ["runtime", "usr/bin", "usr/sbin", "usr/include", "usr/lib/gcc", "usr/libexec/gcc", "usr/lib/x86_64-linux-gnu", "usr/lib64", "usr/share", "bin", "lib/x86_64-linux-gnu", "lib64", "etc"]) {
    mount(args.mountExecutable, ["-o", "remount,bind,ro", `${sandboxRoot}/${name}`]);
  }
  mount(args.mountExecutable, ["-t", "tmpfs", "-o", "mode=700", "tmpfs", `${sandboxRoot}/home`]);
  mount(args.mountExecutable, ["-t", "tmpfs", "-o", "mode=700", "tmpfs", `${sandboxRoot}/tmp`]);
  for (const device of ["null", "zero", "random", "urandom"]) {
    const target = `${sandboxRoot}/dev/${device}`;
    rmSync(target, { recursive: true, force: true });
    writeFileSync(target, "", { mode: 0o666 });
    mount(args.mountExecutable, ["--bind", `/dev/${device}`, target]);
    mount(args.mountExecutable, ["-o", "remount,bind,ro", target]);
  }
  mount(args.mountExecutable, ["-t", "proc", "proc", `${sandboxRoot}/proc`]);
  return sandboxRoot;
}

function runInsideChroot(args, sandboxRoot, childArgs, env) {
  const mappedExecutable = mapPath(args.executable, { staging: args.staging, runtimeRoot: args.runtimeRoot });
  const mappedArgs = childArgs.map(value => mapPath(value, { staging: args.staging, runtimeRoot: args.runtimeRoot }));
  const mappedCwd = mapPath(args.cwd, { staging: args.staging, runtimeRoot: args.runtimeRoot }) || "/";
  const code = [
    "const cp=require('node:child_process');",
    `process.chdir(${JSON.stringify(mappedCwd)});`,
    `const r=cp.spawnSync(${JSON.stringify(mappedExecutable)},${JSON.stringify(mappedArgs)},{cwd:${JSON.stringify(mappedCwd)},env:${JSON.stringify(env)},shell:false,encoding:'utf8'});`,
    "if(r.stdout)process.stdout.write(String(r.stdout));",
    "if(r.stderr)process.stderr.write(String(r.stderr));",
    "process.exit(r.status===null?1:r.status);",
  ].join("");
  return execFileSync(args.chrootExecutable, [sandboxRoot, "/runtime/bin/node", "-e", code], {
    shell: false, timeout: 120_000, maxBuffer: 256 * 1024,
    env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" }, encoding: "utf8",
  });
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const operation = args.operation;
  if (!args.executable || !args.argvJson || !args.mountExecutable || !args.chrootExecutable || !args.runtimeRoot || !args.staging) throw new Error("sandbox operation binding missing");
  if (operation !== "capability-probe" && !SANDBOX_OPERATIONS.includes(operation)) throw new Error("unregistered sandbox operation");
  const sandboxRoot = setupNamespace(args);
  const childArgs = JSON.parse(args.argvJson);
  const rawEnv = args.envJson ? JSON.parse(args.envJson) : {};
  const env = {
    ...rawEnv,
    HOME: "/home",
    TMPDIR: "/tmp",
    NPM_CONFIG_CACHE: "/staging/npm-cache",
    NPM_CONFIG_USERCONFIG: "/staging/empty-npmrc",
    XDG_CONFIG_HOME: "/tmp/xdg-config",
    XDG_CACHE_HOME: "/tmp/xdg-cache",
    PATH: "/runtime/bin:/usr/bin:/bin",
    LC_ALL: "C",
    TZ: "UTC",
  };
  for (const [key, value] of [
    ["PYTHON", args.pythonExecutable],
    ["CC", args.ccExecutable],
    ["CXX", args.cxxExecutable],
    ["MAKE", args.makeExecutable],
    ["AR", args.arExecutable],
    ["NODE_GYP_ROOT", args.nodeGypRoot],
  ]) if (value) env[key] = mapPath(value, { staging: args.staging, runtimeRoot: args.runtimeRoot });
  mkdirSync(`${args.staging}/npm-cache`, { recursive: true, mode: 0o700 });
  writeFileSync(`${args.staging}/empty-npmrc`, "", { mode: 0o600 });
  const output = runInsideChroot(args, sandboxRoot, childArgs, env);
  process.stdout.write(String(output));
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
}

module.exports = { main, parseArgs, setupNamespace, mapPath };
