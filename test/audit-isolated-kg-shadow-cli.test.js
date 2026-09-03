import test from "node:test";
import assert from "node:assert/strict";

import {
  auditIsolatedKgShadow,
  parseArgs,
  usage,
} from "../bin/audit-isolated-kg-shadow.js";
import { LEGACY_ATTACHED_CORE_RETIRED } from "../lib/db/legacy-attached-core.js";

test("retired KG shadow CLI keeps help and argument parsing available", async () => {
  assert.match(usage(), /read-only audit/);
  assert.deepEqual(
    parseArgs([
      "--query", "alpha",
      "--derive-from-kg", "3",
      "--top-k", "4",
      "--like-pattern-top-n", "5",
      "--min-confidence", "0.25",
      "--json",
    ]),
    {
      queries: ["alpha"],
      queriesFile: null,
      deriveFromKg: 3,
      includeNoHitControl: false,
      topK: 4,
      likePatternTopN: 5,
      minConfidence: 0.25,
      json: true,
      out: null,
      help: false,
      coreDbPath: null,
      engineDbPath: null,
      argv: [
        "--query", "alpha",
        "--derive-from-kg", "3",
        "--top-k", "4",
        "--like-pattern-top-n", "5",
        "--min-confidence", "0.25",
        "--json",
      ],
    },
  );
  const help = await auditIsolatedKgShadow(["--help"]);
  assert.equal(help.exitCode, 0);
  assert.match(help.output, /Usage:/);
});

test("retired KG shadow CLI fails closed before opening any requested database", async () => {
  await assert.rejects(
    auditIsolatedKgShadow([
      "--query", "alpha",
      "--core-db-path", "/does/not/exist/core.sqlite",
      "--engine-db-path", "/does/not/exist/engine.sqlite",
    ]),
    error => error?.code === LEGACY_ATTACHED_CORE_RETIRED,
  );
});

test("retired KG shadow CLI still rejects mutation flags during parsing", async () => {
  await assert.rejects(
    auditIsolatedKgShadow(["--apply"]),
    error => String(error?.message || error).includes("read-only audit"),
  );
});
