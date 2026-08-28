#!/usr/bin/env node

const { createHash } = require("node:crypto");
const { execFileSync: defaultExecFileSync } = require("node:child_process");
const { readFileSync, writeFileSync } = require("node:fs");
const { basename, resolve } = require("node:path");

const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const LOCOMO_PROFILE = "production_hybrid_lexical_dialog_locomo_v1";
const LOCOMO_DIALOG_PROJECTION_VERSION = "locomo_dialog_projection_v1";
const LOCOMO_INCLUDE_SESSION_DATETIME = true;
const LOCOMO_BLIP_CAPTION_POLICY = "include_when_present";

function requireValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing_argument_value:${option}`);
  return value;
}

function parseArgs(argv) {
  const args = {
    input: null,
    output: null,
    limit: null,
    topK: 50,
    requireOfficial: false,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input") {
      args.input = requireValue(argv, index, token);
      index += 1;
    } else if (token === "--output") {
      args.output = requireValue(argv, index, token);
      index += 1;
    } else if (token === "--limit") {
      args.limit = Number(requireValue(argv, index, token));
      index += 1;
    } else if (token === "--top-k") {
      args.topK = Number(requireValue(argv, index, token));
      index += 1;
    } else if (token === "--include-blip-caption") {
      throw new Error(`unknown_argument:${token}`);
    } else if (token === "--require-official") {
      args.requireOfficial = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    } else {
      throw new Error(`unknown_argument:${token}`);
    }
  }
  return args;
}

function usage() {
  return [
    "Usage: node bin/run-locomo-retrieval-v1.js --input <locomo10.json> [options]",
    "",
    "Options:",
    "  --limit <n>              Run only the first n conversations",
    "  --top-k <n>              Retrieval depth (default: 50)",
    "  --require-official       Require the pinned official dataset SHA and shape",
    "  --output <path>          Write full per-question JSON result to a file",
    "  --json                   Print full per-question JSON to stdout",
    "  --help                   Show this help",
    "",
    `B5-I2 profile: ${LOCOMO_PROFILE}`,
    `Dialog projection: ${LOCOMO_DIALOG_PROJECTION_VERSION}; session date is required; BLIP policy is ${LOCOMO_BLIP_CAPTION_POLICY}`,
    "Uses one benchmark-owned temporary Core/Engine/FTS corpus per conversation.",
    "Vector and host memory-manager fallbacks are disabled; no provider is used.",
  ].join("\n");
}

function validateRepositoryProvenance(value) {
  const commit = String(value?.repository_commit ?? value?.repositoryCommit ?? "").trim();
  if (!GIT_COMMIT_PATTERN.test(commit)) throw new Error("locomo_repository_provenance_invalid_commit");
  const clean = value?.repository_worktree_clean ?? value?.repositoryWorktreeClean;
  if (typeof clean !== "boolean") throw new Error("locomo_repository_provenance_invalid_worktree_state");
  const source = value?.repository_provenance_source ?? value?.repositoryProvenanceSource;
  if (source !== "git") throw new Error("locomo_repository_provenance_invalid_source");
  return {
    repository_commit: commit,
    repository_worktree_clean: clean,
    repository_provenance_source: "git",
  };
}

function resolveRepositoryProvenance({ repositoryRoot, execFileSync = defaultExecFileSync } = {}) {
  let commit;
  let status;
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
  } catch {
    throw new Error("locomo_repository_provenance_unavailable");
  }
  return validateRepositoryProvenance({
    repository_commit: String(commit).trim(),
    repository_worktree_clean: String(status).trim().length === 0,
    repository_provenance_source: "git",
  });
}

async function runLocomoRetrievalCli(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  if (args.help) return { help: true, usage: usage() };
  if (!args.input) throw new Error("--input is required");
  if (!Number.isSafeInteger(args.topK) || args.topK < 1) {
    throw new Error("--top-k must be a positive integer");
  }
  if (args.limit !== null && (!Number.isSafeInteger(args.limit) || args.limit < 0)) {
    throw new Error("--limit must be a non-negative integer");
  }

  const repositoryRoot = deps.repositoryRoot || resolve(__dirname, "..");
  const repositoryCandidate = Object.hasOwn(deps, "repositoryProvenance")
    ? (typeof deps.repositoryProvenance === "function"
      ? deps.repositoryProvenance({ repositoryRoot })
      : deps.repositoryProvenance)
    : (deps.resolveRepositoryProvenance || resolveRepositoryProvenance)({
      repositoryRoot,
      execFileSync: deps.execFileSync || defaultExecFileSync,
    });
  const repositoryProvenance = validateRepositoryProvenance(repositoryCandidate);
  if (!repositoryProvenance.repository_worktree_clean) {
    throw new Error("locomo_repository_provenance_dirty_worktree");
  }

  const inputPath = resolve(args.input);
  const readFile = deps.readFile || readFileSync;
  const inputBytes = Buffer.from(readFile(inputPath));
  const inputSha256 = createHash("sha256").update(inputBytes).digest("hex");
  const records = JSON.parse(inputBytes.toString("utf8"));
  if (!Array.isArray(records)) throw new Error("LoCoMo input must be a JSON array");

  const contract = await import("../lib/benchmark/locomo-v1.js");
  const validation = contract.validateLocomoDataset(records);
  if (args.requireOfficial) {
    contract.assertOfficialLocomoDataset(records, inputBytes);
  }

  const runner = deps.runDataset
    || (await import("../lib/benchmark/locomo-retrieval-runner-v1.js")).runLocomoLexicalRetrievalDataset;
  const callerRunnerOptions = deps.runnerOptions || {};
  if (Object.hasOwn(callerRunnerOptions, "includeBlipCaption")) {
    throw new Error("locomo_projection_option_reserved:includeBlipCaption");
  }
  for (const [key, expected] of [
    ["dialogProjectionVersion", LOCOMO_DIALOG_PROJECTION_VERSION],
    ["includeSessionDatetime", LOCOMO_INCLUDE_SESSION_DATETIME],
    ["blipCaptionPolicy", LOCOMO_BLIP_CAPTION_POLICY],
  ]) {
    if (Object.hasOwn(callerRunnerOptions, key) && callerRunnerOptions[key] !== expected) {
      throw new Error(`locomo_projection_option_reserved:${key}`);
    }
  }
  const runnerOptions = {
    ...callerRunnerOptions,
    limit: args.limit,
    topK: args.topK,
    dialogProjectionVersion: LOCOMO_DIALOG_PROJECTION_VERSION,
    includeSessionDatetime: LOCOMO_INCLUDE_SESSION_DATETIME,
    blipCaptionPolicy: LOCOMO_BLIP_CAPTION_POLICY,
    datasetSha256: inputSha256,
    repositoryProvenance,
  };
  const output = await runner(records, runnerOptions);
  output.provenance = {
    ...(output.provenance || {}),
    dialog_projection_version: LOCOMO_DIALOG_PROJECTION_VERSION,
    include_session_datetime: LOCOMO_INCLUDE_SESSION_DATETIME,
    blip_caption_policy: LOCOMO_BLIP_CAPTION_POLICY,
    input_file: basename(inputPath),
    input_sha256: inputSha256,
    official_shape_matches: validation.official_shape_matches,
  };
  output.profile = LOCOMO_PROFILE;
  output.run = {
    ...(output.run || {}),
    profile: LOCOMO_PROFILE,
    dialog_projection_version: LOCOMO_DIALOG_PROJECTION_VERSION,
    include_session_datetime: LOCOMO_INCLUDE_SESSION_DATETIME,
    blip_caption_policy: LOCOMO_BLIP_CAPTION_POLICY,
  };

  if (args.output) {
    const writeFile = deps.writeFile || writeFileSync;
    writeFile(resolve(args.output), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }
  return {
    help: false,
    output,
    printable: args.json ? output : {
      provenance: output.provenance,
      run: output.run,
      summary: output.summary,
    },
  };
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const result = await runLocomoRetrievalCli(argv, deps);
  if (result.help) {
    process.stdout.write(`${result.usage}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(result.printable, null, 2)}\n`);
}

module.exports = {
  main,
  parseArgs,
  resolveRepositoryProvenance,
  runLocomoRetrievalCli,
  usage,
  validateRepositoryProvenance,
};

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
