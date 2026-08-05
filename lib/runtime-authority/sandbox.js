const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve, join } = require("node:path");
const { SANDBOX_OPERATIONS } = require("./constants.js");
const { defaultSpawn } = require("./command-registry.js");

const NAMESPACE_FLAGS = Object.freeze(["--user", "--map-root-user", "--mount", "--pid", "--fork", "--mount-proc"]);
const FIXED_SANDBOX_ENV_KEYS = Object.freeze([
  "HOME", "TMPDIR", "PATH", "NPM_CONFIG_CACHE", "NPM_CONFIG_USERCONFIG", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "LC_ALL", "TZ",
]);

class SandboxCapabilityError extends Error {
  constructor(message) { super(message); this.name = "SandboxCapabilityError"; }
}

function buildSandboxArgv({ plan, operation, executable, args, cwd, env, stagingRoot, childScript }) {
  if (!plan || !plan.unshare_executable || !plan.node_executable || !plan.mount_executable || !plan.chroot_executable) throw new Error("sandbox bindings required");
  const toolArgs = [
    ["--python-executable", plan.python_executable],
    ["--cc-executable", plan.cc_executable],
    ["--cxx-executable", plan.cxx_executable],
    ["--make-executable", plan.make_executable],
    ["--ar-executable", plan.ar_executable],
    ["--node-gyp-root", plan.node_gyp_root],
  ].flatMap(([flag, value]) => value ? [flag, value] : []);
  return {
    executable: plan.unshare_executable,
    args: [
      ...NAMESPACE_FLAGS,
      plan.node_executable,
      childScript || resolve(__dirname, "sandbox-child.js"),
      "--operation", operation,
      "--executable", executable,
      "--argv-json", JSON.stringify(args),
      "--cwd", cwd || "",
      "--staging", stagingRoot,
      "--env-json", JSON.stringify(env || {}),
      "--mount-executable", plan.mount_executable,
      "--chroot-executable", plan.chroot_executable,
      "--runtime-root", resolve(plan.node_executable, "..", ".."),
      ...toolArgs,
    ],
  };
}

class SandboxRunner {
  constructor({ plan, stagingRoot = null, spawn = defaultSpawn, childScript = resolve(__dirname, "sandbox-child.js") } = {}) {
    this.plan = plan;
    this.stagingRoot = stagingRoot;
    this.spawn = spawn;
    this.childScript = childScript;
  }

  probe() {
    const temporary = !this.stagingRoot;
    const root = this.stagingRoot || mkdtempSync(join(tmpdir(), "runtime-authority-probe-"));
    const marker = "/staging/.sandbox-probe-marker";
    const hidden = [
      this.plan.operator_home && `${this.plan.operator_home}/sessions/canary`,
      this.plan.operator_home && `${this.plan.operator_home}/memory/canary`,
      this.plan.operator_home && `${this.plan.operator_home}/python-site-packages/canary`,
      this.plan.source_repo && `${this.plan.source_repo}/node_modules/canary`,
      this.plan.active_root && `${this.plan.active_root}/canary`,
      this.plan.active_release && `${this.plan.active_release}/canary`,
      this.plan.config_path,
    ].filter(Boolean);
    const code = [
      "const fs=require('node:fs');",
      `const marker=${JSON.stringify(marker)};`,
      `const hidden=${JSON.stringify(hidden)};`,
      "fs.writeFileSync(marker,'sandbox-write\\n');",
      "fs.writeFileSync('/dev/null','probe');",
      "const fd=fs.openSync('/dev/urandom','r');const random=Buffer.alloc(4);fs.readSync(fd,random,0,4,null);fs.closeSync(fd);",
      "fs.writeFileSync('/staging/.sandbox-probe.c','#include <stddef.h>\\nint main(void){return (int)sizeof(size_t)==0;}\\n');",
      "const cp=require('node:child_process');const compiler=process.env.CC;if(!compiler)process.exit(45);const compiled=cp.spawnSync(compiler,['-std=c11','/staging/.sandbox-probe.c','-o','/staging/.sandbox-probe.out'],{stdio:'pipe'});",
      "if(compiled.status!==0)process.exit(43);fs.unlinkSync('/staging/.sandbox-probe.c');fs.unlinkSync('/staging/.sandbox-probe.out');",
      "const python=cp.spawnSync(process.env.PYTHON,['-c',\"import encodings,os,sysconfig; include=sysconfig.get_path('include'); stdlib=sysconfig.get_path('stdlib'); assert include and os.path.isdir(include); assert stdlib and os.path.isdir(stdlib)\"],{stdio:'pipe'});",
      "if(python.status!==0)process.exit(44);",
      "let runtime_read_only=false;try{fs.writeFileSync('/runtime/.runtime-write','x')}catch{runtime_read_only=true}",
      "if(!runtime_read_only)process.exit(42);",
      "const denied=hidden.map(path=>{try{fs.statSync(path);return false}catch{return true}});",
      "if(denied.some(value=>!value))process.exit(41);",
      "process.stdout.write(JSON.stringify({staging_write:true,device_access:true,compiler:true,python:true,runtime_read_only,denied}));",
    ].join("");
    const command = buildSandboxArgv({
      plan: this.plan,
      operation: "capability-probe",
      executable: this.plan.node_executable,
      args: ["-e", code],
      cwd: root,
      env: {},
      stagingRoot: root,
      childScript: this.childScript,
    });
    try {
      const result = this.spawn({ ...command, cwd: root, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" }, timeout: 30_000, maxOutput: 64 * 1024 });
      if (result.code !== 0 || !String(result.stdout).includes('"staging_write":true') || !String(result.stdout).includes('"device_access":true') || !String(result.stdout).includes('"compiler":true') || !String(result.stdout).includes('"python":true')) throw new SandboxCapabilityError(`sandbox capability rejected:${result.code}:${result.stderr || ""}`);
      return { available: true, command: command.args, canaries: JSON.parse(String(result.stdout)) };
    } finally {
      if (temporary) rmSync(root, { recursive: true, force: true });
    }
  }

  run(operation, { executable, args, cwd, env }) {
    if (!SANDBOX_OPERATIONS.includes(operation)) throw new Error(`unregistered sandbox operation:${operation}`);
    const command = buildSandboxArgv({ plan: this.plan, operation, executable, args, cwd, env, stagingRoot: this.stagingRoot, childScript: this.childScript });
    const result = this.spawn({ ...command, cwd: this.stagingRoot, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" }, timeout: 120_000, maxOutput: 256 * 1024 });
    if (result.code !== 0) throw new Error(`sandbox operation failed:${operation}:${result.code}:${result.stderr}`);
    return result;
  }
}

module.exports = { NAMESPACE_FLAGS, FIXED_SANDBOX_ENV_KEYS, SandboxRunner, SandboxCapabilityError, buildSandboxArgv };
