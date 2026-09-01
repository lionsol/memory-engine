#!/usr/bin/env node
/**
 * Retired compatibility entry point for the former combined maintenance job.
 * The canonical command uses isolated readonly Core and Engine handles.
 */

const { CORE_WRITE_PROHIBITED } = require("../lib/db/core-write-guard.cjs");

function printHelp() {
  console.log(`Nightly maintenance (retired)

The historical command wrote lifecycle state to OpenClaw Core. Core storage
is read-only from memory-engine. Use bin/nightly-maintenance-command.cjs for
the canonical Engine-owned maintenance path; this compatibility command
performs no writes.
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
