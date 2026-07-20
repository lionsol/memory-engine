#!/usr/bin/env node

async function main(args = process.argv.slice(2)) {
  const unknown = args.filter((arg) => arg !== "--json");

  if (unknown.length > 0) {
    process.stderr.write(`unknown argument: ${unknown[0]}\n`);
    return 64;
  }

  try {
    const {
      runStateDbReadonlyFeasibilitySmoke,
    } = await import("../lib/ops/sqlite-readonly-feasibility.js");

    process.stdout.write(
      `${JSON.stringify(runStateDbReadonlyFeasibilitySmoke(), null, 2)}\n`,
    );

    return 0;
  } catch (error) {
    process.stderr.write(
      `synthetic feasibility smoke failed: ${
        error?.message ?? "unknown error"
      }\n`,
    );

    return 1;
  }
}

module.exports = {
  main,
};

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}
