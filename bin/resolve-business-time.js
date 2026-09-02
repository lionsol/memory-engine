#!/usr/bin/env node

const { readFileSync } = require("node:fs");

const businessTime = require("../lib/business-time.cjs");
const { resolveMemoryEnginePaths } = require("../lib/runtime/paths.cjs");

function readConfig(configJsonPath) {
  try {
    return JSON.parse(readFileSync(configJsonPath, "utf8"));
  } catch (_) {
    return {};
  }
}

function parseArgs(argv) {
  const options = { mode: "json", now: new Date() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--timezone") {
      options.mode = "timezone";
    } else if (arg === "--yesterday") {
      options.mode = "yesterday";
    } else if (arg === "--now") {
      options.now = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--now=")) {
      options.now = arg.slice("--now=".length);
    }
  }
  return options;
}

function resolveBusinessTimeContext() {
  const paths = resolveMemoryEnginePaths({}, process.env);
  const timeZone = businessTime.resolveBusinessTimeZone({
    env: process.env,
    config: readConfig(paths.configJsonPath),
  });
  return { paths, timeZone };
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const { paths, timeZone } = resolveBusinessTimeContext();
  if (options.mode === "timezone") {
    process.stdout.write(`${timeZone}\n`);
    return;
  }
  if (options.mode === "yesterday") {
    const today = businessTime.businessDateFromInstant(options.now, timeZone);
    process.stdout.write(`${businessTime.shiftBusinessDate(today, -1)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({
    timeZone,
    today: businessTime.businessDateFromInstant(options.now, timeZone),
    configJsonPath: paths.configJsonPath,
  })}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.code || "BUSINESS_TIME_RESOLUTION_FAILED"}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  main,
  parseArgs,
  readConfig,
  resolveBusinessTimeContext,
};
