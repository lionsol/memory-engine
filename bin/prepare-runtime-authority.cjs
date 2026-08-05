#!/usr/bin/env node

const { isAbsolute, normalize } = require("node:path");
const { dryRun, prepareRuntimeAuthority, verifyAuthority } = require("../lib/runtime-authority/index.js");

class CliError extends Error { constructor(message) { super(message); this.name = "CliError"; } }

function parseArgs(argv = []) {
  if (!argv.length) throw new CliError("subcommand required");
  const command = argv[0];
  if (!["dry-run", "prepare", "verify"].includes(command)) throw new CliError(`unknown subcommand:${command}`);
  const result = { command, plan: null, authority: null, json: false, pretty: false };
  const seen = new Set();
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--json" || flag === "--pretty") {
      if (seen.has(flag)) throw new CliError(`duplicate flag:${flag}`);
      seen.add(flag);
      result[flag.slice(2)] = true;
      continue;
    }
    if (flag !== "--plan" && flag !== "--authority") throw new CliError(`unknown flag:${flag}`);
    if (seen.has(flag)) throw new CliError(`duplicate flag:${flag}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new CliError(`missing flag value:${flag}`);
    if (!isAbsolute(value) || normalize(value) !== value || (value.length > 1 && value.endsWith("/")) || value.startsWith("//")) throw new CliError(`absolute normalized path required:${flag}`);
    seen.add(flag);
    result[flag.slice(2)] = value;
  }
  if (command === "verify" && (!result.authority || result.plan)) throw new CliError("verify requires only --authority");
  if (command !== "verify" && (!result.plan || result.authority)) throw new CliError(`${command} requires only --plan`);
  return result;
}

function render(value, pretty) { return `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`; }

async function run(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  if (args.command === "dry-run") return dryRun({ planPath: args.plan, ...deps });
  if (args.command === "prepare") return prepareRuntimeAuthority({ planPath: args.plan, ...deps });
  return verifyAuthority({ authorityRoot: args.authority, ...deps });
}

async function main(argv = process.argv.slice(2), deps = {}) {
  try {
    const args = parseArgs(argv);
    const result = await run(argv, deps);
    process.stdout.write(render(result, args.pretty));
    return result && result.decision === "REJECT" ? 2 : 0;
  } catch (error) {
    const code = error instanceof CliError ? 1 : 2;
    process.stderr.write(`${error.message}\n`);
    return code;
  }
}

if (require.main === module) main().then(code => { process.exitCode = code; });

module.exports = { CliError, parseArgs, render, run, main };
