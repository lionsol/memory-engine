#!/usr/bin/env node

import { accessSync, constants } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Explicit test/diagnostic override; normal execution stays script-relative.
const canonicalPath = process.env.MEMORY_ENGINE_CANONICAL_CLI
  ? path.resolve(process.env.MEMORY_ENGINE_CANONICAL_CLI)
  : path.join(__dirname, "../../bin/memory-engine-cli.js");

function failClosed(message) {
  console.error(`memory-engine canonical CLI is unavailable: ${message}`);
  process.exitCode = 1;
}

function main() {
  try {
    accessSync(canonicalPath, constants.R_OK);
  } catch (error) {
    failClosed(`${canonicalPath} (${error.code || error.message})`);
    return;
  }

  const result = spawnSync(process.execPath, [canonicalPath, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    failClosed(`${canonicalPath} (${result.error.code || result.error.message})`);
  } else if (result.signal) {
    console.error(`memory-engine canonical CLI terminated by ${result.signal}`);
    process.exitCode = 128 + ({ SIGINT: 2, SIGTERM: 15, SIGHUP: 1 }[result.signal] || 1);
  } else {
    process.exitCode = result.status ?? 1;
  }
}

main();
