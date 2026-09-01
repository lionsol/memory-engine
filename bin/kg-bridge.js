#!/usr/bin/env node
/**
 * Retired compatibility entry point for the former Core-owned KG bridge.
 * Use the Engine-owned lifecycle operation through the canonical tool/runtime.
 */

const { CORE_WRITE_PROHIBITED } = require("../lib/db/core-write-guard.cjs");

function printHelp() {
  console.log(`KG bridge (retired)

The historical command wrote memory-engine lifecycle metadata into OpenClaw
Core. Core storage is read-only from memory-engine. Use the Engine-owned
lifecycle operation instead; this compatibility command performs no writes.
`);
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }
  console.error(CORE_WRITE_PROHIBITED);
  return 1;
}

module.exports = { main };

if (require.main === module) {
  process.exitCode = main();
}
