import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeFixture } from "./runtime-authority-fixtures.test.js";
import { CommandRegistry } from "../lib/runtime-authority/command-registry.js";
import { PathBroker } from "../lib/runtime-authority/path-policy.js";

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
