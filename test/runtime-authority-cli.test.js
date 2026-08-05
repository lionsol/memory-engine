import test from "node:test";
import assert from "node:assert/strict";
import { CliError, parseArgs } from "../bin/prepare-runtime-authority.cjs";

test("CLI accepts only the three fixed entry points and absolute bindings", () => {
  assert.deepEqual(parseArgs(["dry-run", "--plan", "/tmp/plan.json", "--json"]), { command: "dry-run", plan: "/tmp/plan.json", authority: null, json: true, pretty: false });
  assert.deepEqual(parseArgs(["verify", "--authority", "/tmp/authority", "--pretty"]), { command: "verify", plan: null, authority: "/tmp/authority", json: false, pretty: true });
  assert.throws(() => parseArgs(["resume", "--plan", "/tmp/plan.json"]), CliError);
  assert.throws(() => parseArgs(["prepare", "--plan", "relative.json"]), CliError);
  assert.throws(() => parseArgs(["dry-run", "--plan", "/tmp/plan.json", "--plan", "/tmp/other.json"]), CliError);
  assert.throws(() => parseArgs(["verify", "--authority", "/tmp/authority", "--plan", "/tmp/plan.json"]), CliError);
});
