#!/usr/bin/env node

function parseCliArgs(rawArgs) {
  const commandArgs = [];
  let dbPath = null;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--db" && index + 1 < rawArgs.length) {
      dbPath = rawArgs[++index];
      continue;
    }
    if (arg.startsWith("--db=")) {
      dbPath = arg.slice("--db=".length);
      continue;
    }
    commandArgs.push(arg);
  }

  const command = commandArgs[0] || "help";
  const rest = commandArgs.slice(1);
  const options = { dbPath };

  if (command === "add") {
    const categoryIndex = rest.indexOf("--category");
    const protectedFlag = rest.includes("--protected");
    options.category = categoryIndex >= 0 ? rest[categoryIndex + 1] : null;
    options.protected = protectedFlag;
    options.text = rest
      .filter((arg, index) => {
        if (arg === "--protected" || arg === "--category") return false;
        if (categoryIndex >= 0 && index === categoryIndex + 1) return false;
        return !arg.startsWith("--");
      })
      .join(" ");
  }

  if (command === "search") {
    const topKIndex = rest.indexOf("--top-k");
    const topKFlag = rest.find(arg => arg.startsWith("--top-k="));
    options.topK = topKFlag
      ? Number(topKFlag.slice("--top-k=".length))
      : topKIndex >= 0
        ? Number(rest[topKIndex + 1])
        : 5;
    options.query = rest
      .filter((arg, index) => {
        if (arg.startsWith("--top-k=")) return false;
        if (arg === "--top-k") return false;
        if (topKIndex >= 0 && index === topKIndex + 1) return false;
        return !arg.startsWith("--");
      })
      .join(" ");
  }

  return { command, options };
}

function showHelp() {
  console.error("Usage:");
  console.error("  node bin/memory-engine-cli.js [--db <path>] add <text> [--category <cat>]");
  console.error("  node bin/memory-engine-cli.js [--db <path>] search <query> [--top-k <n>]");
  console.error("  node bin/memory-engine-cli.js [--db <path>] status");
  console.error("");
  console.error("Options:");
  console.error("  --db <path>  Override the service data path");
  console.error("  --top-k <n>  Number of search results (default: 5)");
  console.error("  --category   Explicit category for add command");
  console.error("");
  console.error("Environment:");
  console.error("  MEMORY_ENGINE_DB_PATH  Override the service data path");
  console.error("  MEMORY_ENGINE_DB       Override the service data path (fallback)");
  console.error("  MEMORY_ENGINE_CORE_DB  Override the OpenClaw source path");
}

function printResult(command, options, result) {
  if (command === "search") {
    const rows = Array.isArray(result.results) ? result.results : [];
    const pool = Number(result.pool || rows.length);
    console.log(`🔍 Search: "${options.query}" — ${rows.length}/${pool} results`);
    for (const row of rows) {
      const source = Array.isArray(row.sources) ? row.sources.join(",") : row.source || "memory";
      console.log(`   [${row.category || "unknown"}] (${source}) ${(row.text || "").slice(0, 80)}`);
    }
    return;
  }

  if (command === "add") {
    console.log(`✅ Added: ${(options.text || "").slice(0, 60)} → ${result.category || "raw_log"}`);
    return;
  }

  if (command === "status") {
    console.log("📊 Memory Engine Status");
    if (result.engineDbPath) console.log(`   Engine DB: ${result.engineDbPath}`);
    console.log(`   Total confidence: ${result.confidence_tracked || 0}`);
    console.log(`   Archived: ${result.archived || 0} | Protected: ${result.protected || 0} | Conflicted: ${result.conflicted || 0}`);
    console.log("   By category:");
    for (const row of result.by_category || []) console.log(`     ${row.category}: ${row.count}`);
    return;
  }

  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  const { command, options } = parseCliArgs(process.argv.slice(2));
  if (command === "help" || command === "-h" || command === "--help") {
    showHelp();
    return;
  }

  if (!["add", "search", "status"].includes(command)) {
    showHelp();
    throw new Error(`Unknown command: ${command}`);
  }
  if (command === "add" && !options.text) {
    throw new Error("Usage: node memory-engine-cli.js add <text> [--category <cat>]");
  }
  if (command === "search" && !options.query) {
    throw new Error("Usage: node memory-engine-cli.js search <query> [--top-k <n>]");
  }

  const { executeMemoryEngineCommand } = await import("../lib/services/memory-engine-cli-service.js");
  const result = await executeMemoryEngineCommand(command, options);
  if (result?.error) throw new Error(result.error);
  printResult(command, options, result || {});
}

if (require.main === module) {
  main().catch(error => {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseCliArgs,
  printResult,
};
