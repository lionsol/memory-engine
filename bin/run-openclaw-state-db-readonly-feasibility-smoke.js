#!/usr/bin/env node

import { runStateDbReadonlyFeasibilitySmoke } from "../lib/ops/sqlite-readonly-feasibility.js";

const args = process.argv.slice(2);
const unknown = args.filter((arg) => arg !== "--json");

if (unknown.length > 0) {
  process.stderr.write(`unknown argument: ${unknown[0]}\n`);
  process.exitCode = 64;
} else {
  try {
    process.stdout.write(`${JSON.stringify(runStateDbReadonlyFeasibilitySmoke(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`synthetic feasibility smoke failed: ${error?.message ?? "unknown error"}\n`);
    process.exitCode = 1;
  }
}
