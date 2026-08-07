import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SandboxRunner, buildSandboxArgv, NAMESPACE_FLAGS } from "../lib/runtime-authority/sandbox.js";
import { assertBoundedTimeout, getSandboxTimeoutPolicy } from "../lib/runtime-authority/timeout-policy.js";

test("sandbox command uses fixed namespace flags without host /sandbox mutation", () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-authority-sandbox-"));
  try {
    const plan = { unshare_executable: "/usr/bin/unshare", node_executable: "/home/lionsol/.local/node24/bin/node", mount_executable: "/usr/bin/mount", chroot_executable: "/usr/sbin/chroot", operator_home: join(root, "home") };
    const command = buildSandboxArgv({ plan, operation: "node.candidate_targeted_tests", executable: plan.node_executable, args: ["-e", ""], cwd: root, env: {}, stagingRoot: root });
    assert.deepEqual(command.args.slice(0, NAMESPACE_FLAGS.length), NAMESPACE_FLAGS);
    assert.equal(command.args.includes("-c"), false);
    assert.equal(command.args.includes("bash"), false);
    assert.equal(existsSync("/sandbox"), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("sandbox command retains structured failure identity and output", () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-authority-sandbox-failure-"));
  try {
    const plan = { unshare_executable: "/usr/bin/unshare", node_executable: "/home/lionsol/.local/node24/bin/node", mount_executable: "/usr/bin/mount", chroot_executable: "/usr/sbin/chroot" };
    const sandbox = new SandboxRunner({ plan, stagingRoot: root, spawn: () => ({ code: 23, stdout: "sandbox stdout", stderr: "sandbox stderr" }) });
    assert.throws(() => sandbox.run("npm.ci_candidate", { executable: plan.node_executable, args: ["npm-cli.js"], cwd: root, env: {} }), error => {
      assert.equal(error.name, "CommandExecutionError");
      assert.deepEqual(error.commandFailure, { operation_id: "npm.ci_candidate", exit_code: 23, stdout: "sandbox stdout", stderr: "sandbox stderr" });
      return true;
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("sandbox timeout policy is operation-specific, inner-before-outer, and caller-closed", () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-authority-sandbox-timeout-policy-"));
  const stage = join(root, "stage");
  mkdirSync(stage);
  const plan = { unshare_executable: "/usr/bin/unshare", node_executable: "/home/lionsol/.local/node24/bin/node", mount_executable: "/usr/bin/mount", chroot_executable: "/usr/sbin/chroot" };
  const calls = [];
  const operationOf = input => input.args[input.args.indexOf("--operation") + 1];
  const childSource = readFileSync(new URL("../lib/runtime-authority/sandbox-child.js", import.meta.url), "utf8");
  try {
    const sandbox = new SandboxRunner({
      plan,
      stagingRoot: stage,
      spawn: input => {
        calls.push(input);
        if (operationOf(input) === "capability-probe") return { code: 0, stdout: JSON.stringify({ staging_write: true, device_access: true, compiler: true, python: true }), stderr: "" };
        return { code: 0, stdout: "ok", stderr: "" };
      },
    });
    sandbox.run("npm.ci_candidate", { executable: plan.node_executable, args: ["-e", ""], cwd: stage, env: { inner_timeout_ms: "1", npm_config_timeout: "1" }, timeout: 1 });
    sandbox.run("node.candidate_targeted_tests", { executable: plan.node_executable, args: ["-e", ""], cwd: stage, env: {} });
    sandbox.probe();
    assert.equal(operationOf(calls[0]), "npm.ci_candidate");
    assert.equal(calls[0].timeout, 330_000);
    assert.equal(calls[0].args.includes("--inner-timeout-ms"), false);
    assert.equal(getSandboxTimeoutPolicy("npm.ci_candidate").inner_timeout_ms, 300_000);
    assert.equal(calls[0].timeout, getSandboxTimeoutPolicy("npm.ci_candidate").inner_timeout_ms + 30_000);
    assert.equal(operationOf(calls[1]), "node.candidate_targeted_tests");
    assert.equal(calls[1].timeout, 120_000);
    assert.equal(getSandboxTimeoutPolicy("node.candidate_targeted_tests").inner_timeout_ms, 120_000);
    assert.equal(operationOf(calls[2]), "capability-probe");
    assert.equal(calls[2].timeout, 30_000);
    assert.equal(getSandboxTimeoutPolicy("capability-probe").inner_timeout_ms, 120_000);
    assert.equal(childSource.includes("args.innerTimeoutMs"), false);
    assert.equal(childSource.includes("--inner-timeout-ms"), false);
    assert.equal(assertBoundedTimeout("300000"), 300_000);
    assert.throws(() => assertBoundedTimeout(undefined), /bounded positive integer/);
    assert.throws(() => assertBoundedTimeout(900_001), /bounded positive integer/);
    assert.throws(() => sandbox.run("unknown.operation", { executable: plan.node_executable, args: [], cwd: stage, env: {} }), /unregistered sandbox operation/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("real namespace keeps resolver target readable for registry access", t => {
  if (!lstatSync("/etc/resolv.conf").isSymbolicLink()) {
    t.skip("host resolver configuration is a regular file");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "runtime-authority-sandbox-resolver-"));
  const stage = join(root, "stage");
  try {
    mkdirSync(stage);
    const plan = { unshare_executable: "/usr/bin/unshare", node_executable: "/home/lionsol/.local/node24/bin/node", mount_executable: "/usr/bin/mount", chroot_executable: "/usr/sbin/chroot" };
    const sandbox = new SandboxRunner({ plan, stagingRoot: stage });
    const result = sandbox.run("node.candidate_targeted_tests", {
      executable: plan.node_executable,
      args: ["-e", "const fs=require('node:fs');const text=fs.readFileSync('/etc/resolv.conf','utf8');if(!/^nameserver\\s+/m.test(text))process.exit(61);process.stdout.write('resolver-readable');"],
      cwd: stage,
      env: {},
    });
    assert.equal(String(result.stdout), "resolver-readable");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("real namespace canary masks operator, source, active, release and config roots", () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-authority-sandbox-real-"));
  const stage = join(root, "stage");
  const hidden = Object.fromEntries(["home", "source", "active", "release"].map(name => [name, join(root, name)]));
  const config = join(root, "config");
  try {
    mkdirSync(stage); mkdirSync(join(hidden.home, "sessions"), { recursive: true }); mkdirSync(join(hidden.home, "memory"), { recursive: true }); mkdirSync(join(hidden.source, "node_modules"), { recursive: true });
    writeFileSync(join(hidden.home, "sessions", "canary"), "secret\n"); writeFileSync(join(hidden.home, "memory", "canary"), "secret\n"); writeFileSync(join(hidden.source, "node_modules", "canary"), "secret\n");
    for (const name of ["active", "release"]) { mkdirSync(hidden[name]); writeFileSync(join(hidden[name], "canary"), "secret\n"); }
    writeFileSync(config, "secret\n");
    const plan = { unshare_executable: "/usr/bin/unshare", node_executable: "/home/lionsol/.local/node24/bin/node", mount_executable: "/usr/bin/mount", chroot_executable: "/usr/sbin/chroot", python_executable: "/usr/bin/python3.12", cc_executable: "/usr/bin/x86_64-linux-gnu-gcc-13", cxx_executable: "/usr/bin/x86_64-linux-gnu-g++-13", make_executable: "/usr/bin/make", ar_executable: "/usr/bin/x86_64-linux-gnu-ar", operator_home: hidden.home, source_repo: hidden.source, active_root: hidden.active, active_release: hidden.release, config_path: config };
    const sandbox = new SandboxRunner({ plan, stagingRoot: stage });
    const result = sandbox.probe();
    assert.equal(result.available, true);
    assert.equal(result.canaries.device_access, true);
    assert.equal(result.canaries.compiler, true);
    assert.equal(result.canaries.python, true);
    assert.equal(result.canaries.runtime_read_only, true);
    assert.deepEqual(result.canaries.denied, [true, true, true, true, true, true, true]);
    assert.equal(readFileSync(join(stage, ".sandbox-probe-marker"), "utf8"), "sandbox-write\n");
    for (const operation of ["npm.pack_staged_source", "npm.ci_candidate", "node.candidate_sqlite_disposable_smoke", "node.candidate_targeted_tests", "node.r0_sqlite_disposable_smoke"]) {
      const run = sandbox.run(operation, { executable: plan.node_executable, args: ["-e", "process.stdout.write('ok')"], cwd: stage, env: { HOME: "/host-overridden", PATH: "/host-overridden" } });
      assert.equal(String(run.stdout), "ok");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("real namespace exposes only controlled devices and compiler toolchain", () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-authority-sandbox-toolchain-"));
  const stage = join(root, "stage");
  try {
    mkdirSync(stage);
    const plan = { unshare_executable: "/usr/bin/unshare", node_executable: "/home/lionsol/.local/node24/bin/node", mount_executable: "/usr/bin/mount", chroot_executable: "/usr/sbin/chroot", python_executable: "/usr/bin/python3.12", cc_executable: "/usr/bin/x86_64-linux-gnu-gcc-13", cxx_executable: "/usr/bin/x86_64-linux-gnu-g++-13", make_executable: "/usr/bin/make", ar_executable: "/usr/bin/x86_64-linux-gnu-ar" };
    const sandbox = new SandboxRunner({ plan, stagingRoot: stage });
    sandbox.probe();
    const script = [
      "const fs=require('node:fs'),cp=require('node:child_process');",
      "fs.writeFileSync('/dev/null','x');",
      "const fd=fs.openSync('/dev/urandom','r'),b=Buffer.alloc(4);fs.readSync(fd,b,0,4,null);fs.closeSync(fd);",
      "fs.writeFileSync('/staging/tiny.c','#include <stddef.h>\\nint main(void){return (int)sizeof(size_t)==0;}\\n');",
      "const r=cp.spawnSync('cc',['-std=c11','/staging/tiny.c','-o','/staging/tiny.out'],{stdio:'pipe'});",
      "if(r.status!==0)throw new Error(String(r.stderr));",
      "process.stdout.write(b.toString('hex'));",
    ].join("");
    const result = sandbox.run("node.candidate_targeted_tests", { executable: plan.node_executable, args: ["-e", script], cwd: stage, env: {} });
    assert.match(String(result.stdout), /^[0-9a-f]{8}$/);
    assert.equal(existsSync(join(stage, "tiny.out")), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
