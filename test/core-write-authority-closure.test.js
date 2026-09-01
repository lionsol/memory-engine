import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { CORE_WRITE_PROHIBITED } from "../lib/db/core-write-guard.js";

const require = createRequire(import.meta.url);
const staleCli = require("../bin/cleanup-stale-quarantined-chunks.js");
const legacyCli = require("../bin/cleanup-confirmed-legacy-singleton-stale.js");
const smartCli = require("../bin/cleanup-confirmed-smart-add-propagation-stale-chunks.js");
const legacyKgBridge = require("../bin/kg-bridge.js");
const legacyConflictDetector = require("../bin/detect-conflicts.js");
const legacyNightlyMaintenance = require("../bin/nightly-maintenance.js");

async function captureCliError(main, args) {
  const messages = [];
  const previous = console.error;
  console.error = (...parts) => messages.push(parts.join(" "));
  try {
    return {
      code: await main(args),
      output: messages.join("\n"),
    };
  } finally {
    console.error = previous;
  }
}

test("historical cleanup CLI apply requests are uniformly refused", async () => {
  const cases = [
    [staleCli.main, ["--apply", "--confirm", "cleanup-stale-quarantined-chunks"]],
    [legacyCli.main, ["--apply", "--confirm", "cleanup-confirmed-legacy-singleton-stale"]],
    [smartCli.main, ["--apply", "--confirm", "cleanup-confirmed-smart-add-propagation-stale-chunks"]],
  ];

  for (const [main, args] of cases) {
    const result = await captureCliError(main, args);
    assert.equal(result.code, 1);
    assert.match(result.output, new RegExp(CORE_WRITE_PROHIBITED));
  }
});

test("retired Python migration exposes help but refuses every migration invocation", () => {
  const script = resolve(process.cwd(), "bin/memory-migration-v1.py");
  const help = spawnSync("python3", [script, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /retired/i);
  assert.match(help.stdout, /Core storage is read-only/i);

  const invocation = spawnSync("python3", [script, "--dry-run"], { encoding: "utf8" });
  assert.equal(invocation.status, 1);
  assert.match(invocation.stderr, /CORE_WRITE_PROHIBITED/);

  const v2Script = resolve(process.cwd(), "bin/memory-schema-v2.py");
  const v2Invocation = spawnSync("python3", [v2Script], { encoding: "utf8" });
  assert.equal(v2Invocation.status, 1);
  assert.match(v2Invocation.stderr, /CORE_WRITE_PROHIBITED/);
});

test("legacy Core-writing lifecycle scripts are retired", async () => {
  for (const main of [legacyKgBridge.main, legacyConflictDetector.main, legacyNightlyMaintenance.main]) {
    const result = await captureCliError(main, []);
    assert.equal(result.code, 1);
    assert.equal(result.output, CORE_WRITE_PROHIBITED);
  }
});
