import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { validateToolBinding } from "../lib/runtime-authority/verify.js";

function tarBinding() {
  const path = "/usr/bin/tar";
  return { kind: "tar", path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex"), version: execFileSync(path, ["--version"], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" } }).trim().split(/\r?\n/, 1)[0] };
}

function nodeBinding() {
  const path = "/home/lionsol/.local/node24/bin/node";
  return {
    kind: "node",
    path,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    version: execFileSync(path, ["--version"], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" } }).trim().split(/\r?\n/, 1)[0],
    abi: 137,
  };
}

function executableBinding(kind, path) {
  return { kind, path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex"), version: execFileSync(path, ["--version"], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" } }).trim().split(/\r?\n/, 1)[0] };
}

test("verify revalidates the bound tar realpath, hash, and version", () => {
  const binding = tarBinding();
  assert.equal(validateToolBinding({ tool_identities: { tar: binding } }, "tar"), "/usr/bin/tar");
  assert.throws(() => validateToolBinding({ tool_identities: { tar: { ...binding, sha256: "0".repeat(64) } } }, "tar"), /SHA/);
  assert.throws(() => validateToolBinding({ tool_identities: { tar: { ...binding, version: "wrong" } } }, "tar"), /version/);
});

test("verify revalidates the bound Node hash, version, and ABI", () => {
  const binding = nodeBinding();
  assert.equal(validateToolBinding({ tool_identities: { node: binding } }, "node"), binding.path);
  assert.throws(() => validateToolBinding({ tool_identities: { node: { ...binding, sha256: "0".repeat(64) } } }, "node"), /SHA/);
  assert.throws(() => validateToolBinding({ tool_identities: { node: { ...binding, version: "wrong" } } }, "node"), /version/);
  assert.throws(() => validateToolBinding({ tool_identities: { node: { ...binding, abi: 127 } } }, "node"), /ABI/);
});

test("verify revalidates bound npm through Node, Git, and systemctl identities", () => {
  const node = nodeBinding();
  const npm = { kind: "npm", path: "/home/lionsol/.local/node24/lib/node_modules/npm/bin/npm-cli.js", sha256: createHash("sha256").update(readFileSync("/home/lionsol/.local/node24/lib/node_modules/npm/bin/npm-cli.js")).digest("hex"), version: execFileSync(node.path, ["/home/lionsol/.local/node24/lib/node_modules/npm/bin/npm-cli.js", "--version"], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" } }).trim().split(/\r?\n/, 1)[0] };
  const git = executableBinding("git", "/usr/bin/git");
  const systemctl = executableBinding("systemctl", "/usr/bin/systemctl");
  const authority = { tool_identities: { node, npm, git, systemctl } };
  assert.equal(validateToolBinding(authority, "npm"), npm.path);
  assert.equal(validateToolBinding(authority, "git"), git.path);
  assert.equal(validateToolBinding(authority, "systemctl"), systemctl.path);
  assert.throws(() => validateToolBinding({ tool_identities: { node, npm: { ...npm, version: "wrong" } } }, "npm"), /version/);
  assert.throws(() => validateToolBinding({ tool_identities: { node, git: { ...git, sha256: "0".repeat(64) } } }, "git"), /SHA/);
  assert.throws(() => validateToolBinding({ tool_identities: { node, systemctl: { ...systemctl, sha256: "0".repeat(64) } } }, "systemctl"), /SHA/);
});
