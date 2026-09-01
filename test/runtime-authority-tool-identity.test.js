import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { makeFixture } from "./runtime-authority-fixtures.js";
import { PathBroker } from "../lib/runtime-authority/path-policy.js";
import { inspectNodeGyp, inspectTool } from "../lib/runtime-authority/tool-identity.js";
import { buildRuntimeArtifactManifestV2 } from "../bin/runtime-artifact-manifest-v2-lib.cjs";

test("tool identity records realpath, hash, version, and Node ABI", () => {
  const fixture = makeFixture();
  try {
    const broker = new PathBroker({ allowedRoots: { tools: fixture.root } });
    const expectedHash = createHash("sha256").update(readFileSync(fixture.tools.node)).digest("hex");
    const identity = inspectTool({
      kind: "node", executable: fixture.tools.node, broker,
      expected: { sha256: expectedHash, version: "synthetic-node", abi: 1 },
      runner: ({ args }) => ({ stdout: args[0] === "--version" ? "synthetic-node\n" : "1\n" }),
    });
    assert.equal(identity.sha256, expectedHash);
    assert.equal(identity.abi, 1);
  } finally { fixture.cleanup(); }
});

test("tool identity mismatch fails closed", () => {
  const fixture = makeFixture();
  try {
    const broker = new PathBroker({ allowedRoots: { tools: fixture.root } });
    assert.throws(() => inspectTool({
      kind: "tar", executable: fixture.tools.tar, broker,
      expected: { version: "wrong" }, runner: () => ({ stdout: "synthetic-tar\n" }),
    }), /identity mismatch/);
  } finally { fixture.cleanup(); }
});

test("npm CLI identity invokes the bound Node even when the CLI has an env shebang", () => {
  const fixture = makeFixture();
  try {
    const npmCli = fixture.tools.npm;
    writeFileSync(npmCli, "#!/usr/bin/env node\nprocess.stdout.write('synthetic-npm\\n');\n", { mode: 0o755 }); chmodSync(npmCli, 0o755);
    const nodeExecutable = "/home/lionsol/.local/node24/bin/node";
    const broker = new PathBroker({ allowedRoots: { npm: fixture.root, node: nodeExecutable } });
    const identity = inspectTool({ kind: "npm", executable: npmCli, nodeExecutable, broker, expected: { version: "synthetic-npm" }, runner: ({ executable, args }) => {
      assert.equal(executable, nodeExecutable); assert.equal(args[0], npmCli); return { stdout: "synthetic-npm\n" };
    } });
    assert.equal(identity.version, "synthetic-npm");
  } finally { fixture.cleanup(); }
});

test("Python and compiler replacement is rejected by bound tool identity", () => {
  const fixture = makeFixture();
  try {
    for (const [kind, path, version] of [["python", fixture.tools.python, "synthetic-python"], ["cc", fixture.tools.cc, "synthetic-cc"]]) {
      const broker = new PathBroker({ allowedRoots: { tools: fixture.root } });
      assert.throws(() => inspectTool({ kind, executable: path, broker, expected: { sha256: "0".repeat(64), version }, runner: () => ({ stdout: `${version}\n` }) }), /identity mismatch/);
    }
  } finally { fixture.cleanup(); }
});

test("node-gyp closure identity covers the bound tree and detects drift", () => {
  const fixture = makeFixture();
  try {
    const broker = new PathBroker({ allowedRoots: { node_gyp_root: fixture.root } });
    const expected = buildRuntimeArtifactManifestV2({ rootDir: fixture.root }).exact_identity;
    const identity = inspectNodeGyp({ root: fixture.root, expected: { tree_identity: expected }, broker });
    assert.equal(identity.tree_identity, expected);
    writeFileSync(`${fixture.root}/closure-drift.js`, "drift\n", { mode: 0o500 });
    assert.throws(() => inspectNodeGyp({ root: fixture.root, expected: { tree_identity: expected }, broker }), /closure identity mismatch/);
  } finally { fixture.cleanup(); }
});
