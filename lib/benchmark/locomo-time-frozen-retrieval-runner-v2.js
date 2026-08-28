import {
  createLocomoProductionHybridRuntime,
  materializeLocomoConversationDataPlane,
  runLocomoLexicalRetrievalDataset,
  validateBenchmarkNowSec,
} from "./locomo-retrieval-runner-v1.js";

export const LOCOMO_TIME_FROZEN_RETRIEVAL_RUNNER_SCHEMA =
  "memory_engine_locomo_lexical_retrieval_time_frozen_v2";
export const LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE =
  "production_hybrid_lexical_dialog_locomo_time_frozen_v2";
export const LOCOMO_TIME_FROZEN_SEMANTIC_RETRIEVAL_PROFILE =
  "production_hybrid_semantic_dialog_locomo_time_frozen_v2";
export const LOCOMO_BENCHMARK_CLOCK_CONTRACT =
  "locomo_materialization_and_search_fixed_v2";

export const LOCOMO_TIME_FROZEN_RESERVED_PROVENANCE_KEYS = Object.freeze([
  "profile",
  "benchmark_now_sec",
  "materialization_now_sec",
  "search_now_sec",
  "benchmark_clock_contract",
  "repository_commit",
  "repository_worktree_clean",
  "repository_provenance_source",
  "dataset_sha256",
]);

const RESERVED_CLOCK_OPTION_KEYS = new Set([
  "benchmark_now_sec",
  "materialization_now_sec",
  "search_now_sec",
  "benchmark_clock_contract",
  "materializationNowSec",
  "searchNowSec",
  "benchmarkClockContract",
]);

function rejectClockOverrides(options) {
  for (const key of RESERVED_CLOCK_OPTION_KEYS) {
    if (Object.hasOwn(options, key)) {
      throw new Error(`locomo_v2_clock_override:${key}`);
    }
  }
}

function rejectReservedProfileProvenance(value) {
  if (value === undefined || value === null) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const reserved = new Set([
    ...LOCOMO_TIME_FROZEN_RESERVED_PROVENANCE_KEYS,
    "benchmarkNowSec",
    "materializationNowSec",
    "searchNowSec",
    "benchmarkClockContract",
    "repositoryCommit",
    "repositoryWorktreeClean",
    "repositoryProvenanceSource",
    "datasetSha256",
  ]);
  for (const key of Object.keys(value)) {
    if (reserved.has(key)) throw new Error(`locomo_provenance_reserved:${key}`);
  }
}

function clockBoundMaterializer(materialize, benchmarkNowSec) {
  return (record, options = {}) => {
    if (options.benchmarkNowSec !== benchmarkNowSec) {
      throw new Error("locomo_v2_materialization_clock_mismatch");
    }
    const plane = materialize(record, {
      ...options,
      benchmarkNowSec,
    });
    if (plane && Object.hasOwn(plane, "benchmarkNowSec")
        && plane.benchmarkNowSec !== benchmarkNowSec) {
      throw new Error("locomo_v2_materialization_clock_mismatch");
    }
    return plane;
  };
}

function clockBoundRuntimeFactory(createRuntime, searchNowSec) {
  return (dataPlane, options = {}) => {
    const adapter = createRuntime(dataPlane, {
      ...options,
      searchNowSec,
    });
    const runtime = adapter?.runtime || adapter;
    if (!runtime || typeof runtime !== "object") {
      throw new Error("locomo_v2_runtime_required");
    }
    if (Object.hasOwn(runtime, "searchNowSec") && runtime.searchNowSec !== searchNowSec) {
      throw new Error("locomo_v2_search_clock_override");
    }
    try {
      runtime.searchNowSec = searchNowSec;
    } catch {
      throw new Error("locomo_v2_search_clock_unwritable");
    }
    if (runtime.searchNowSec !== searchNowSec) {
      throw new Error("locomo_v2_search_clock_mismatch");
    }
    return adapter;
  };
}

function assertClockedOutput(output, benchmarkNowSec) {
  if (!output || typeof output !== "object") {
    throw new Error("locomo_v2_output_invalid");
  }
  if (output.provenance?.benchmark_now_sec !== benchmarkNowSec
      || output.run?.benchmark_now_sec !== benchmarkNowSec) {
    throw new Error("locomo_v2_benchmark_clock_mismatch");
  }
  if (!Array.isArray(output.results)) throw new Error("locomo_v2_results_invalid");
  for (const result of output.results) {
    if (result?.sensitivity?.scoreable !== true) continue;
    if (result.diagnostics?.search_now_sec !== benchmarkNowSec) {
      throw new Error("locomo_v2_search_clock_mismatch");
    }
  }
}

export async function runLocomoTimeFrozenLexicalRetrievalDataset(records, options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("locomo_v2_options_must_be_object");
  }
  if (!Object.hasOwn(options, "benchmarkNowSec") || options.benchmarkNowSec === undefined) {
    throw new Error("locomo_v2_benchmark_now_sec_required");
  }
  rejectClockOverrides(options);
  rejectReservedProfileProvenance(options.profileProvenance);
  const benchmarkNowSec = validateBenchmarkNowSec(options.benchmarkNowSec);
  const materialize = Object.hasOwn(options, "materialize")
    ? options.materialize
    : materializeLocomoConversationDataPlane;
  const createRuntime = Object.hasOwn(options, "createRuntime")
    ? options.createRuntime
    : createLocomoProductionHybridRuntime;
  if (typeof materialize !== "function") throw new Error("locomo_materializer_required");
  if (typeof createRuntime !== "function") throw new Error("locomo_runtime_factory_required");
  if (Object.hasOwn(options, "search") && typeof options.search !== "function") {
    throw new Error("locomo_search_function_required");
  }
  const runnerOptions = {
    limit: options.limit,
    topK: options.topK,
    datasetSha256: options.datasetSha256,
    repositoryProvenance: options.repositoryProvenance,
    profileProvenance: options.profileProvenance,
    temporaryParent: options.temporaryParent,
    materialize: clockBoundMaterializer(materialize, benchmarkNowSec),
    createRuntime: clockBoundRuntimeFactory(createRuntime, benchmarkNowSec),
    search: Object.hasOwn(options, "search") ? options.search : undefined,
    benchmarkNowSec,
  };
  for (const key of ["includeBlipCaption", "dialogProjectionVersion", "includeSessionDatetime", "blipCaptionPolicy"]) {
    if (Object.hasOwn(options, key)) runnerOptions[key] = options[key];
  }
  const output = await runLocomoLexicalRetrievalDataset(records, runnerOptions);
  assertClockedOutput(output, benchmarkNowSec);

  const clockFields = {
    profile: LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE,
    top_k: output.run.top_k,
    benchmark_now_sec: benchmarkNowSec,
    materialization_now_sec: benchmarkNowSec,
    search_now_sec: benchmarkNowSec,
    benchmark_clock_contract: LOCOMO_BENCHMARK_CLOCK_CONTRACT,
  };
  const provenance = {
    ...output.provenance,
    ...clockFields,
  };
  const run = {
    ...output.provenance,
    ...output.run,
    ...clockFields,
  };
  const summary = {
    ...output.summary,
    schema: LOCOMO_TIME_FROZEN_RETRIEVAL_RUNNER_SCHEMA,
    profile: LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE,
  };
  return {
    ...output,
    schema: LOCOMO_TIME_FROZEN_RETRIEVAL_RUNNER_SCHEMA,
    profile: LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE,
    provenance,
    run,
    summary,
  };
}
