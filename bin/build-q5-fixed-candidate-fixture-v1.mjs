#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { buildQ5FixedCandidateDerivedFixtureV1 } from "../lib/benchmark/q5-fixed-candidate-attribution-v1.js";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readJson(path) {
  const raw = readFileSync(path);
  return {
    raw,
    value: JSON.parse(raw.toString("utf8")),
  };
}

export function main() {
  const c1bPath = arg("--c1b-result");
  const c2Path = arg("--c2-result");
  const output = arg("--output");
  if (!c1bPath || !c2Path || !output) {
    throw new Error("usage: --c1b-result <path> --c2-result <path> --output <path>");
  }

  const c1b = readJson(c1bPath);
  const c2 = readJson(c2Path);
  const fixture = buildQ5FixedCandidateDerivedFixtureV1({
    c1bResult: c1b.value,
    c2Result: c2.value,
    c1bResultFileSha256: sha256(c1b.raw),
    c2ResultFileSha256: sha256(c2.raw),
  });
  writeFileSync(output, `${JSON.stringify(fixture, null, 2)}\n`);
  return fixture;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const fixture = main();
    process.stdout.write(`${JSON.stringify({
      status: "PASS",
      fixture_sha256: fixture.fixture_sha256,
      source_count: fixture.sources.length,
      case_count: fixture.sources.reduce((n, source) => n + source.cases.length, 0),
      memory_count: fixture.sources.reduce((n, source) => n + source.memories.length, 0),
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: "FAIL",
      code: error?.code || "Q5_FIXTURE_BUILD_FAILED",
      message: String(error?.message || error),
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
