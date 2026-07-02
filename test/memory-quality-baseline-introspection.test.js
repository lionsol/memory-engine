import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectMemoryQualityBaselineContracts,
} from "../lib/quality/memory-quality-baseline-introspection.js";
import introspectionCli from "../bin/inspect-memory-quality-baseline.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const libraryPath = resolve(repoRoot, "lib/quality/memory-quality-baseline-introspection.js");
const scriptPath = resolve(repoRoot, "bin/inspect-memory-quality-baseline.js");
const { main } = introspectionCli;

async function captureConsole(fn) {
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => errors.push(args.join(" "));
  try {
    const result = await fn();
    return { result, output: logs.join("\n"), error: errors.join("\n") };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

test("baseline introspection library and CLI exist", () => {
  assert.equal(existsSync(libraryPath), true);
  assert.equal(existsSync(scriptPath), true);
});

test("inspectMemoryQualityBaselineContracts returns 7 contracts", () => {
  const contracts = inspectMemoryQualityBaselineContracts();
  assert.equal(contracts.length, 7);
});

test("inspectMemoryQualityBaselineContracts returns expected level distribution", () => {
  const contracts = inspectMemoryQualityBaselineContracts();
  const levels = contracts.reduce((acc, contract) => {
    acc[contract.level] = Number(acc[contract.level] || 0) + 1;
    return acc;
  }, {});

  assert.deepEqual(levels, {
    structural: 1,
    quality: 2,
    process_boundary: 1,
    cleanup: 1,
    recall_safety: 2,
  });
});

test("introspection layer is read-only by construction", () => {
  const librarySource = readFileSync(libraryPath, "utf8");
  const scriptSource = readFileSync(scriptPath, "utf8");

  assert.equal(librarySource.includes("evaluateMemoryQualityBaselineContracts"), false);
  assert.equal(librarySource.includes("runBaselineSmoke"), false);
  assert.equal(librarySource.includes("writeFileSync"), false);
  assert.equal(scriptSource.includes("writeFileSync"), false);
  assert.equal(scriptSource.includes("runBaselineSmoke"), false);
});

test("introspection CLI prints deterministic JSON with contracts and levels", async () => {
  const first = await captureConsole(() => main());
  const second = await captureConsole(() => main());
  assert.equal(first.result, 0);
  assert.equal(second.result, 0);
  assert.equal(first.error, "");
  assert.equal(second.error, "");
  assert.equal(first.output, second.output);

  const parsed = JSON.parse(first.output);
  assert.deepEqual(Object.keys(parsed), ["contract_count", "contracts", "levels"]);
  assert.equal(parsed.contract_count, 7);
  assert.equal(Array.isArray(parsed.contracts), true);
  assert.deepEqual(parsed.levels, {
    structural: 1,
    quality: 2,
    process_boundary: 1,
    cleanup: 1,
    recall_safety: 2,
  });
});
