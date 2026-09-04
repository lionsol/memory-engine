import {
  createBenchmarkHybridRuntime,
} from "./longmemeval-retrieval-runner-v1.js";

export const Q2_CHANNEL_ABLATION_SCHEMA = "memory_engine_q2_channel_ablation_v1";
export const Q2_EVALUATION_TOP_K = 3;
export const Q2_Q1_BASELINE_FIXTURE_SHA256 =
  "1867ad5ebd4368ad967c2f491f21fc888e27df3eea122741c5a4b42430bff042";

export const Q2_NON_VECTOR_CHANNEL_NAMES = Object.freeze([
  "fts",
  "kg",
  "like",
  "recent",
  "episode",
  "recent_fallback",
]);

const RECENT_FAMILY_CHANNELS = Object.freeze([
  "like",
  "recent",
  "episode",
  "recent_fallback",
]);
const FIXED_RANKING_POLICY = Object.freeze("production_unchanged");
const SUPPORTED_STATUS = "SUPPORTED";

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function supportedProfile({
  profile,
  isolatedKg,
  isolatedRecent,
  compatibilityAliases = [],
  compatibilityProfile = null,
}) {
  return deepFreeze({
    schema: Q2_CHANNEL_ABLATION_SCHEMA,
    profile,
    canonical_profile: profile,
    status: SUPPORTED_STATUS,
    executable_in_q2_a1: true,
    execution_not_authorized_in_q2_a1: false,
    evaluation_top_k: Q2_EVALUATION_TOP_K,
    ranking_policy: FIXED_RANKING_POLICY,
    channel_capabilities: {
      isolatedKg,
      isolatedRecent,
    },
    retrieval_channels: {
      fts: true,
      kg: isolatedKg,
      recent_family: isolatedRecent,
      vector: false,
    },
    channels: {
      fts: true,
      kg: isolatedKg,
      recent_family: isolatedRecent,
      vector: false,
    },
    allowed_served_channels: [
      "fts",
      ...(isolatedKg ? ["kg"] : []),
      ...(isolatedRecent ? RECENT_FAMILY_CHANNELS : []),
    ],
    compatibility_profile: compatibilityProfile,
    compatibility_aliases: compatibilityAliases,
  });
}

function deferredProfile({
  profile,
  status,
  reason,
  providerRequired = false,
  executionNotAuthorized = true,
  retrievalChannels = {},
  ...extra
}) {
  return deepFreeze({
    schema: Q2_CHANNEL_ABLATION_SCHEMA,
    profile,
    canonical_profile: profile,
    status,
    executable_in_q2_a1: false,
    execution_not_authorized_in_q2_a1: executionNotAuthorized,
    provider_required: providerRequired,
    provider_required_for_full_execution: providerRequired,
    reason,
    evaluation_top_k: Q2_EVALUATION_TOP_K,
    ranking_policy: FIXED_RANKING_POLICY,
    retrieval_channels: retrievalChannels,
    ...extra,
  });
}

export const Q2_CHANNEL_ABLATION_PROFILES = deepFreeze({
  q2_non_vector_full_v1: supportedProfile({
    profile: "q2_non_vector_full_v1",
    isolatedKg: true,
    isolatedRecent: true,
    compatibilityAliases: ["q2_nv0", "q2_nv4", "q2_full_non_vector_v1"],
    compatibilityProfile: "production_hybrid_lexical_session_v1",
  }),
  q2_fts_only_v1: supportedProfile({
    profile: "q2_fts_only_v1",
    isolatedKg: false,
    isolatedRecent: false,
  }),
  q2_fts_kg_v1: supportedProfile({
    profile: "q2_fts_kg_v1",
    isolatedKg: true,
    isolatedRecent: false,
  }),
  q2_fts_recent_v1: supportedProfile({
    profile: "q2_fts_recent_v1",
    isolatedKg: false,
    isolatedRecent: true,
  }),
  q2_vector_only_v1: deferredProfile({
    profile: "q2_vector_only_v1",
    status: "DEFER_UNSUPPORTED_WITH_CURRENT_PRODUCTION_ORCHESTRATION",
    reason: "production hybridSearch unconditionally collects FTS",
    retrievalChannels: { fts: true, kg: false, recent_family: false, vector: true },
  }),
  q2_metadata_only_v1: deferredProfile({
    profile: "q2_metadata_only_v1",
    status: "NOT_A_DISTINCT_RETRIEVAL_CHANNEL",
    reason: "confidence, category and recency are ranking/reranking features",
    retrievalChannels: { fts: true, kg: false, recent_family: false, vector: false },
  }),
  q2_episode_only_v1: deferredProfile({
    profile: "q2_episode_only_v1",
    status: "NOT_INDEPENDENTLY_SWITCHABLE",
    reason: "episode candidates are emitted by the Recent family collector",
    retrievalChannels: { fts: true, kg: false, recent_family: true, vector: false },
  }),
  q2_full_semantic_v1: deferredProfile({
    profile: "q2_full_semantic_v1",
    status: "SUPPORTED_BY_EXISTING_SEMANTIC_RUNNER",
    reason: "the existing semantic runner requires a provider-backed vector attempt",
    providerRequired: true,
    retrievalChannels: { fts: true, kg: true, recent_family: true, vector: true },
  }),
  q2_selective_vector_v1: deferredProfile({
    profile: "q2_selective_vector_v1",
    status: "SOURCE_DESIGN_REQUIRED",
    reason: "selective vector behavior is not the existing semantic runner contract",
    providerRequired: true,
    retrievalChannels: { fts: true, kg: true, recent_family: true, vector: true },
    runner_mapping: "not_mapped_to_current_semantic_runner",
  }),
});

export const Q2_CHANNEL_ABLATION_ALIASES = deepFreeze({
  q2_nv0: "q2_non_vector_full_v1",
  q2_nv4: "q2_non_vector_full_v1",
  q2_full_non_vector_v1: "q2_non_vector_full_v1",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function profileName(profileOrName) {
  if (typeof profileOrName === "string") return profileOrName;
  if (isRecord(profileOrName) && typeof profileOrName.profile === "string") {
    return profileOrName.profile;
  }
  throw new Error("q2_channel_profile_name_required");
}

export function resolveQ2ChannelAblationProfile(profileOrName) {
  const requested = profileName(profileOrName);
  const canonical = Q2_CHANNEL_ABLATION_ALIASES[requested] || requested;
  const profile = Q2_CHANNEL_ABLATION_PROFILES[canonical];
  if (!profile) throw new Error(`q2_channel_profile_unknown:${requested}`);
  return profile;
}

function assertExecutableProfile(profile) {
  if (profile.status !== SUPPORTED_STATUS || profile.executable_in_q2_a1 !== true) {
    throw new Error(`q2_channel_profile_not_executable:${profile.profile}:${profile.status}`);
  }
}

function assertQ2RuntimeOptions(options) {
  if (!isRecord(options)) throw new Error("q2_channel_runtime_options_must_be_object");
  const allowed = new Set(["profile", "topK", "searchNowSec"]);
  const unknown = Object.keys(options).filter(key => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`q2_channel_runtime_option_unknown:${unknown.join(",")}`);
}

/**
 * Construct a benchmark-only non-vector runtime for one frozen Q2 profile.
 * The production hybridSearch implementation remains the search authority;
 * this helper only supplies its existing isolated capability payload.
 */
export function createQ2BenchmarkHybridRuntime(materialized, options = {}) {
  assertQ2RuntimeOptions(options);
  const selected = resolveQ2ChannelAblationProfile(
    options.profile === undefined ? "q2_non_vector_full_v1" : options.profile,
  );
  assertExecutableProfile(selected);

  const topK = options.topK === undefined ? Q2_EVALUATION_TOP_K : options.topK;
  if (topK !== Q2_EVALUATION_TOP_K) {
    throw new Error(`q2_channel_top_k_must_be_${Q2_EVALUATION_TOP_K}`);
  }

  const runtimeOptions = {
    topK: Q2_EVALUATION_TOP_K,
    channelCapabilities: selected.channel_capabilities,
  };
  if (options.searchNowSec !== undefined) runtimeOptions.searchNowSec = options.searchNowSec;

  const adapter = createBenchmarkHybridRuntime(materialized, runtimeOptions);
  return {
    ...adapter,
    q2_schema: Q2_CHANNEL_ABLATION_SCHEMA,
    q2_profile: selected.profile,
    q2_profile_definition: selected,
    evaluation_top_k: Q2_EVALUATION_TOP_K,
    channel_capabilities: selected.channel_capabilities,
    ranking_policy: selected.ranking_policy,
  };
}

function addObservedChannels(target, value, source, evidence) {
  if (value === undefined) return;
  if (Array.isArray(value)) {
    evidence.observed = true;
    for (const name of value) {
      if (typeof name !== "string" || name.trim() === "") {
        throw new Error(`q2_observed_channel_name_invalid:${source}`);
      }
      target.add(name.trim());
    }
    return;
  }
  if (!isRecord(value)) throw new Error(`q2_observed_channel_list_invalid:${source}`);
  evidence.observed = true;
  for (const [name, count] of Object.entries(value)) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`q2_observed_channel_size_invalid:${source}:${name}`);
    }
    if (count > 0) target.add(name.trim());
  }
}

function observedChannels(searchResult) {
  if (!isRecord(searchResult)) throw new Error("q2_observed_search_result_required");
  const names = new Set();
  const evidence = { observed: false };
  addObservedChannels(names, searchResult.channels, "result.channels", evidence);
  addObservedChannels(names, searchResult.channel_sizes, "result.channel_sizes", evidence);
  addObservedChannels(names, searchResult.debug?.channels, "debug.channels", evidence);
  addObservedChannels(names, searchResult.debug?.channel_sizes, "debug.channel_sizes", evidence);
  if (!evidence.observed) throw new Error("q2_observed_channel_contract_unavailable");
  return [...names].sort();
}

/**
 * Validate channels actually reported by hybridSearch. An allowed channel may
 * be empty; an unexpected served channel is always a contract failure.
 */
export function assertQ2ObservedChannelContract(profileOrName, searchResult) {
  let selectedInput = profileOrName;
  let result = searchResult;
  if (isRecord(profileOrName)
      && (Array.isArray(profileOrName.channels)
        || Object.hasOwn(profileOrName, "channel_sizes")
        || Object.hasOwn(profileOrName, "debug"))
      && (typeof searchResult === "string" || isRecord(searchResult))) {
    result = profileOrName;
    selectedInput = searchResult;
  }
  if (isRecord(selectedInput) && Object.hasOwn(selectedInput, "profile")
      && (Object.hasOwn(selectedInput, "search") || Object.hasOwn(selectedInput, "result"))) {
    result = selectedInput.search || selectedInput.result;
    selectedInput = selectedInput.profile;
  }
  const selected = resolveQ2ChannelAblationProfile(selectedInput);
  assertExecutableProfile(selected);
  const observed = observedChannels(result);
  const allowed = new Set(selected.allowed_served_channels);
  const unexpected = observed.filter(name => !allowed.has(name));
  if (unexpected.length > 0) {
    throw new Error(`q2_observed_channel_contract_violation:${selected.profile}:${unexpected.join(",")}`);
  }
  return {
    schema: Q2_CHANNEL_ABLATION_SCHEMA,
    profile: selected.profile,
    valid: true,
    observed_channels: observed,
    allowed_served_channels: [...selected.allowed_served_channels],
    unexpected_channels: [],
  };
}
