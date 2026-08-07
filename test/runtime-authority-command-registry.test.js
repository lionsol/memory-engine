import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeFixture } from "./runtime-authority-fixtures.test.js";
import { CommandRegistry, createRegistry, systemdUserEnv, systemdUserStatusArgs } from "../lib/runtime-authority/command-registry.js";
import { PathBroker } from "../lib/runtime-authority/path-policy.js";
import { parseServiceOutput } from "../lib/runtime-authority/preflight.js";

test("command registry uses closed operation descriptors and structured argv", () => {
  const fixture = makeFixture();
  try {
    let call;
    const registry = new CommandRegistry({
      plan: fixture.plan,
      broker: new PathBroker({ allowedRoots: { source: fixture.plan.source_repo, tools: fixture.root } }),
      spawn: input => { call = input; return { code: 0, stdout: "ok", stderr: "" }; },
      descriptors: {
        "git.status": { class: "host", executable: () => fixture.tools.git, args: () => ["status", "--porcelain"], cwd: () => fixture.plan.source_repo },
      },
    });
    assert.equal(registry.run("git.status").stdout, "ok");
    assert.deepEqual(call.args, ["status", "--porcelain"]);
    assert.equal(call.env.LC_ALL, "C");
    assert.throws(() => registry.run("free.shell", { argv: ["bash"] }), /unregistered|unknown/);
  } finally { fixture.cleanup(); }
});

test("command registry retains structured failure identity and output", () => {
  const fixture = makeFixture();
  try {
    const registry = new CommandRegistry({
      plan: fixture.plan,
      broker: new PathBroker({ allowedRoots: { source: fixture.plan.source_repo, tools: fixture.root } }),
      spawn: () => ({ code: 17, stdout: "command stdout", stderr: "command stderr" }),
      descriptors: {
        "git.status": { class: "host", executable: () => fixture.tools.git, args: () => ["status"], cwd: () => fixture.plan.source_repo },
      },
    });
    assert.throws(() => registry.run("git.status"), error => {
      assert.equal(error.name, "CommandExecutionError");
      assert.deepEqual(error.commandFailure, { operation_id: "git.status", exit_code: 17, stdout: "command stdout", stderr: "command stderr" });
      return true;
    });
  } finally { fixture.cleanup(); }
});

test("systemd user status binding is explicit, minimal, and order-independent", () => {
  assert.deepEqual(systemdUserStatusArgs("memory-console.service"), [
    "--user",
    "show",
    "memory-console.service",
    "--property=ActiveState,SubState,MainPID,NRestarts",
    "--no-pager",
  ]);
  assert.deepEqual(systemdUserEnv({ uid: 1000 }), {
    XDG_RUNTIME_DIR: "/run/user/1000",
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
  });
  assert.deepEqual(parseServiceOutput("MainPID=204419\nNRestarts=0\nActiveState=active\nSubState=running\n"), {
    active: true,
    running: true,
    pid: 204419,
    restart_count: 0,
  });
});

test("systemd status parsing rejects positional, incomplete, duplicate, and invalid counter output", () => {
  assert.throws(() => parseServiceOutput("204419\n0\nactive\nrunning\n"), /named systemd status/);
  assert.throws(() => parseServiceOutput("ActiveState=active\nSubState=running\nMainPID=1\n"), /exact systemd status fields/);
  assert.throws(() => parseServiceOutput("ActiveState=active\nActiveState=active\nSubState=running\nMainPID=1\nNRestarts=0\n"), /duplicate systemd status field/);
  assert.throws(() => parseServiceOutput("ActiveState=active\nSubState=running\nMainPID=NaN\nNRestarts=0\n"), /invalid systemd status counters/);
});

test("sandbox-class operation cannot run without sandbox", () => {
  const fixture = makeFixture();
  try {
    const registry = new CommandRegistry({
      plan: fixture.plan,
      broker: new PathBroker({ allowedRoots: { source: fixture.plan.source_repo, tools: fixture.root } }),
      descriptors: {
        "npm.ci_candidate": { class: "sandbox", executable: () => fixture.tools.node, args: () => [], cwd: () => fixture.plan.source_repo },
      },
    });
    assert.throws(() => registry.run("npm.ci_candidate"), /sandbox required/);
  } finally { fixture.cleanup(); }
});

test("npm.ci_candidate receives only the fixed bound runtime headers", () => {
  const fixture = makeFixture();
  try {
    const candidate = join(fixture.plan.persistent_parent, "candidate");
    const cache = join(fixture.plan.persistent_parent, "npm-cache");
    mkdirSync(candidate);
    const calls = [];
    const registry = createRegistry({
      plan: fixture.plan,
      broker: new PathBroker({ allowedRoots: { persistent_parent: fixture.plan.persistent_parent, tools: fixture.root } }),
      sandbox: { run: (operation, input) => { calls.push({ operation, input }); return { code: 0, stdout: "", stderr: "" }; } },
    });
    registry.run("npm.ci_candidate", { candidate, cache, timeout: 1 });
    registry.run("npm.ls_candidate", { candidate });
    assert.equal(calls[0].operation, "npm.ci_candidate");
    assert.equal(calls[0].input.env.npm_config_nodedir, "/runtime");
    assert.equal(calls[0].input.env.NPM_CONFIG_NODEDIR, undefined);
    assert.equal(calls[0].input.timeout, undefined);
    assert.equal(calls[1].operation, "npm.ls_candidate");
    assert.equal(calls[1].input.env.npm_config_nodedir, undefined);
  } finally { fixture.cleanup(); }
});

test("implementation source has no unrestricted shell or recursive-home primitive", () => {
  const source = [
    "../bin/prepare-runtime-authority.cjs",
    "../lib/runtime-authority/command-registry.js",
    "../lib/runtime-authority/path-policy.js",
    "../lib/runtime-authority/sandbox.js",
    "../lib/runtime-authority/sandbox-child.js",
  ].map(path => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
  assert.equal(/shell\s*:\s*true/.test(source), false);
  assert.equal(/\bexec\s*\(/.test(source), false);
  assert.equal(/\bprocess\.cwd\s*\(/.test(source), false);
  assert.equal(/readdirSync\s*\(\s*[^)]*operator_home/.test(source), false);
});
