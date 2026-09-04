import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  createBenchmarkHybridRuntime,
  materializeLongMemEvalCaseDatabases,
} from "../lib/benchmark/longmemeval-retrieval-runner-v1.js";
import { normalizeLongMemEvalCase } from "../lib/benchmark/longmemeval-v1.js";
import { hybridSearch } from "../lib/recall/hybrid-search.js";
import {
  Q2_CHANNEL_ABLATION_ALIASES,
  Q2_CHANNEL_ABLATION_PROFILES,
  Q2_CHANNEL_ABLATION_SCHEMA,
  Q2_EVALUATION_TOP_K,
  Q2_NON_VECTOR_CHANNEL_NAMES,
  Q2_Q1_BASELINE_FIXTURE_SHA256,
  assertQ2ObservedChannelContract,
  createQ2BenchmarkHybridRuntime,
  resolveQ2ChannelAblationProfile,
} from "../lib/benchmark/q2-channel-ablation-v1.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productionHybridPath = resolve(repoRoot, "lib/recall/hybrid-search.js");
const q1FixturePath = resolve(repoRoot, "test/fixtures/q1-current-baseline-v1.json");

function syntheticLongMemEvalCase() {
  return normalizeLongMemEvalCase({
    question_id: "q2-channel-synthetic",
    question_type: "single_hop",
    question: "Where is the q2 channel needle?",
    answer: "Kyoto",
    question_date: "2025/01/10 (Fri) 12:00",
    haystack_session_ids: ["s-noise", "s-answer", "s-episode"],
    haystack_dates: [
      "2024/12/20 (Fri) 12:00",
      "2025/01/09 (Thu) 09:00",
      "2025/01/09 (Thu) 10:00",
    ],
    haystack_sessions: [
      [
        { role: "user", content: "Unrelated context." },
        { role: "assistant", content: "Noted." },
      ],
      [
        { role: "user", content: "The q2 channel needle is in Kyoto.", has_answer: true },
        { role: "assistant", content: "I will remember that." },
      ],
      [
        { role: "user", content: "An episodic q2 channel note." },
        { role: "assistant", content: "Okay." },
      ],
    ],
    answer_session_ids: ["s-answer"],
  });
}

function materializeSyntheticCase() {
  return materializeLongMemEvalCaseDatabases(syntheticLongMemEvalCase(), {
    benchmarkNowSec: 1_800_000_000,
  });
}

async function withSyntheticProfile(profile, callback) {
  const materialized = materializeSyntheticCase();
  const adapter = createQ2BenchmarkHybridRuntime(materialized, {
    profile,
    topK: Q2_EVALUATION_TOP_K,
    searchNowSec: 1_800_000_000,
  });
  try {
    return await callback(adapter);
  } finally {
    adapter.close();
    rmSync(materialized.root, { recursive: true, force: true });
  }
}

test("Q2 schema binds the Q1 baseline fixture without pooling sources", () => {
  assert.equal(Q2_CHANNEL_ABLATION_SCHEMA, "memory_engine_q2_channel_ablation_v1");
  const fixtureSha = createHash("sha256")
    .update(readFileSync(q1FixturePath))
    .digest("hex");
  assert.equal(fixtureSha, Q2_Q1_BASELINE_FIXTURE_SHA256);
  assert.equal(Q2_NON_VECTOR_CHANNEL_NAMES.includes("fts"), true);
  assert.equal(Q2_NON_VECTOR_CHANNEL_NAMES.includes("vector"), false);
});

test("default benchmark runtime preserves the existing capability contract", async () => {
  const materialized = materializeSyntheticCase();
  const adapter = createBenchmarkHybridRuntime(materialized, { topK: 3 });
  try {
    const capabilities = await adapter.runtime.withHybridDbAccessScope(
      access => access.capabilities,
    );
    assert.deepEqual(capabilities, {
      isolatedFts: true,
      isolatedKg: true,
      isolatedRecent: true,
      legacyFallbackAllowed: false,
    });
    assert.deepEqual(adapter.runtime.channelCapabilities, {
      isolatedKg: true,
      isolatedRecent: true,
    });
  } finally {
    adapter.close();
    rmSync(materialized.root, { recursive: true, force: true });
  }
});

test("Q2 default profile remains the Q1 non-vector baseline identity", () => {
  const profile = resolveQ2ChannelAblationProfile("q2_non_vector_full_v1");
  assert.equal(profile.compatibility_profile, "production_hybrid_lexical_session_v1");
  assert.equal(profile.canonical_profile, "q2_non_vector_full_v1");
  assert.equal(resolveQ2ChannelAblationProfile("q2_nv0"), profile);
  assert.equal(resolveQ2ChannelAblationProfile("q2_nv4"), profile);
  assert.equal(resolveQ2ChannelAblationProfile(Q2_CHANNEL_ABLATION_ALIASES.q2_nv4), profile);
});

test("Q2 default profile is behaviorally compatible with the current benchmark baseline", async () => {
  const baselineMaterialized = materializeSyntheticCase();
  const q2Materialized = materializeSyntheticCase();
  const baselineAdapter = createBenchmarkHybridRuntime(baselineMaterialized, {
    topK: Q2_EVALUATION_TOP_K,
    searchNowSec: 1_800_000_000,
  });
  const q2Adapter = createQ2BenchmarkHybridRuntime(q2Materialized, {
    profile: "q2_non_vector_full_v1",
    topK: Q2_EVALUATION_TOP_K,
    searchNowSec: 1_800_000_000,
  });
  try {
    const [baselineSearch, q2Search] = await Promise.all([
      hybridSearch("q2 channel needle", { topK: 3 }, baselineAdapter.runtime),
      hybridSearch("q2 channel needle", { topK: 3 }, q2Adapter.runtime),
    ]);
    assert.deepEqual(q2Search.channels, baselineSearch.channels);
    assert.deepEqual(q2Search.channel_sizes, baselineSearch.channel_sizes);
    assert.deepEqual(
      q2Search.results.map(result => result.memory_id),
      baselineSearch.results.map(result => result.memory_id),
    );
  } finally {
    baselineAdapter.close();
    q2Adapter.close();
    rmSync(baselineMaterialized.root, { recursive: true, force: true });
    rmSync(q2Materialized.root, { recursive: true, force: true });
  }
});

test("all supported non-vector profiles keep the same ranking policy and topK", () => {
  const supported = Object.values(Q2_CHANNEL_ABLATION_PROFILES)
    .filter(profile => profile.executable_in_q2_a1 === true);
  assert.deepEqual(
    [...new Set(supported.map(profile => profile.ranking_policy))],
    ["production_unchanged"],
  );
  assert.deepEqual(
    [...new Set(supported.map(profile => profile.evaluation_top_k))],
    [Q2_EVALUATION_TOP_K],
  );
  assert.deepEqual(supported.map(profile => profile.profile), [
    "q2_non_vector_full_v1",
    "q2_fts_only_v1",
    "q2_fts_kg_v1",
    "q2_fts_recent_v1",
  ]);
});

test("FTS-only serves FTS and no KG, Recent family, or vector", async () => {
  await withSyntheticProfile("q2_fts_only_v1", async adapter => {
    const search = await hybridSearch("q2 channel needle", { topK: 3 }, adapter.runtime);
    assert.deepEqual(search.channels, ["fts"]);
    assertQ2ObservedChannelContract("q2_fts_only_v1", search);
    for (const forbidden of ["kg", "like", "recent", "episode", "recent_fallback", "vector"]) {
      assert.equal(search.channels.includes(forbidden), false, forbidden);
    }
  });
});

test("FTS+KG maps only KG isolation and prohibits Recent family", async () => {
  const profile = resolveQ2ChannelAblationProfile("q2_fts_kg_v1");
  assert.deepEqual(profile.channel_capabilities, {
    isolatedKg: true,
    isolatedRecent: false,
  });
  assert.doesNotThrow(() => assertQ2ObservedChannelContract(profile, {
    channels: ["fts", "kg"],
    channel_sizes: { fts: 1, kg: 1 },
  }));
  assert.throws(
    () => assertQ2ObservedChannelContract(profile, {
      channels: ["fts", "kg", "recent"],
      channel_sizes: { fts: 1, kg: 1, recent: 1 },
    }),
    /q2_observed_channel_contract_violation/,
  );
  await withSyntheticProfile("q2_fts_kg_v1", async adapter => {
    const search = await hybridSearch("q2 channel needle", { topK: 3 }, adapter.runtime);
    assert.equal(search.channels.includes("recent"), false);
    assert.equal(search.channels.includes("kg"), false);
    assertQ2ObservedChannelContract("q2_fts_kg_v1", search);
  });
});

test("FTS+Recent permits every Recent-family served channel but prohibits KG", async () => {
  const observedRecent = {
    channels: ["fts", "like", "recent", "episode", "recent_fallback"],
    channel_sizes: { fts: 1, like: 1, recent: 1, episode: 1, recent_fallback: 1 },
  };
  assert.doesNotThrow(() => assertQ2ObservedChannelContract("q2_fts_recent_v1", observedRecent));
  assert.throws(
    () => assertQ2ObservedChannelContract("q2_fts_recent_v1", {
      channels: ["fts", "recent", "kg"],
      channel_sizes: { fts: 1, recent: 1, kg: 1 },
    }),
    /q2_observed_channel_contract_violation/,
  );
  await withSyntheticProfile("q2_fts_recent_v1", async adapter => {
    const search = await hybridSearch("q2 channel needle", { topK: 3 }, adapter.runtime);
    assert.equal(search.channels.includes("kg"), false);
    assert.equal(search.channels.includes("vector"), false);
    assertQ2ObservedChannelContract("q2_fts_recent_v1", search);
  });
});

test("disabling KG and Recent suppresses legacy fallback through the existing access path", async () => {
  await withSyntheticProfile("q2_fts_only_v1", async adapter => {
    const search = await hybridSearch("q2 channel needle", { topK: 3 }, adapter.runtime);
    assert.equal(search.debug.kg_legacy_fallback_disabled, true);
    assert.equal(search.debug.kg_fail_closed_fallback_suppressed, true);
    assert.equal(search.debug.recent_legacy_fallback_disabled, true);
    assert.equal(search.debug.recent_fail_closed_fallback_suppressed, true);
    assert.equal(search.channels.includes("kg"), false);
    assert.equal(search.channels.some(name => ["like", "recent", "episode", "recent_fallback"].includes(name)), false);
  });
});

test("Q2 runtime applies profile capabilities and fixes production topK at 3", async () => {
  for (const profileName of [
    "q2_non_vector_full_v1",
    "q2_fts_only_v1",
    "q2_fts_kg_v1",
    "q2_fts_recent_v1",
  ]) {
    await withSyntheticProfile(profileName, async adapter => {
      const profile = resolveQ2ChannelAblationProfile(profileName);
      assert.deepEqual(adapter.runtime.channelCapabilities, profile.channel_capabilities);
      assert.equal(adapter.runtime.cfg.recall.topK, 3);
      assert.equal(adapter.evaluation_top_k, 3);
      const capabilities = await adapter.runtime.withHybridDbAccessScope(
        access => access.capabilities,
      );
      assert.equal(capabilities.isolatedFts, true);
      assert.equal(capabilities.legacyFallbackAllowed, false);
    });
  }
  const materialized = materializeSyntheticCase();
  try {
    assert.throws(
      () => createQ2BenchmarkHybridRuntime(materialized, { profile: "q2_fts_only_v1", topK: 2 }),
      /q2_channel_top_k_must_be_3/,
    );
  } finally {
    rmSync(materialized.root, { recursive: true, force: true });
  }
});

test("unknown and unsupported profiles fail closed with their frozen status", () => {
  assert.throws(
    () => resolveQ2ChannelAblationProfile("q2_unknown_v1"),
    /q2_channel_profile_unknown/,
  );
  const vectorOnly = resolveQ2ChannelAblationProfile("q2_vector_only_v1");
  assert.equal(vectorOnly.status, "DEFER_UNSUPPORTED_WITH_CURRENT_PRODUCTION_ORCHESTRATION");
  assert.throws(
    () => createQ2BenchmarkHybridRuntime({}, { profile: "q2_vector_only_v1" }),
    /q2_channel_profile_not_executable:q2_vector_only_v1:DEFER_UNSUPPORTED_WITH_CURRENT_PRODUCTION_ORCHESTRATION/,
  );
  assert.equal(
    resolveQ2ChannelAblationProfile("q2_metadata_only_v1").status,
    "NOT_A_DISTINCT_RETRIEVAL_CHANNEL",
  );
  assert.equal(
    resolveQ2ChannelAblationProfile("q2_episode_only_v1").status,
    "NOT_INDEPENDENTLY_SWITCHABLE",
  );
  const semantic = resolveQ2ChannelAblationProfile("q2_full_semantic_v1");
  assert.equal(semantic.status, "SUPPORTED_BY_EXISTING_SEMANTIC_RUNNER");
  assert.equal(semantic.provider_required, true);
  assert.equal(semantic.execution_not_authorized_in_q2_a1, true);
  const selective = resolveQ2ChannelAblationProfile("q2_selective_vector_v1");
  assert.equal(selective.status, "SOURCE_DESIGN_REQUIRED");
  assert.equal(selective.provider_required, true);
  assert.equal(selective.runner_mapping, "not_mapped_to_current_semantic_runner");
});

test("metadata is a ranking feature and Episode is not an independent Q2 channel", () => {
  assert.equal(Q2_CHANNEL_ABLATION_PROFILES.q2_metadata_only_v1.retrieval_channels.vector, false);
  assert.equal(Q2_CHANNEL_ABLATION_PROFILES.q2_episode_only_v1.retrieval_channels.recent_family, true);
  assert.equal(Q2_CHANNEL_ABLATION_PROFILES.q2_episode_only_v1.status, "NOT_INDEPENDENTLY_SWITCHABLE");
});

test("observed-channel assertion uses result/debug evidence and catches unexpected channels", () => {
  assert.deepEqual(
    assertQ2ObservedChannelContract("q2_fts_only_v1", {
      results: [],
      channels: [],
      channel_sizes: {},
      debug: { channel_sizes: {} },
    }).observed_channels,
    [],
  );
  assert.deepEqual(
    assertQ2ObservedChannelContract("q2_fts_only_v1", {
      results: [{}],
      debug: { channel_sizes: { fts: 1 } },
    }).observed_channels,
    ["fts"],
  );
  assert.throws(
    () => assertQ2ObservedChannelContract("q2_fts_only_v1", {
      channels: ["fts", "metadata"],
      channel_sizes: { fts: 1, metadata: 1 },
    }),
    /q2_observed_channel_contract_violation:q2_fts_only_v1:metadata/,
  );
  assert.throws(
    () => assertQ2ObservedChannelContract("q2_fts_only_v1", { results: [] }),
    /q2_observed_channel_contract_unavailable/,
  );
});

test("production hybridSearch source remains free of the Q2 benchmark layer", () => {
  const source = readFileSync(productionHybridPath, "utf8");
  assert.equal(source.includes(Q2_CHANNEL_ABLATION_SCHEMA), false);
  assert.equal(source.includes("createQ2BenchmarkHybridRuntime"), false);
});

test("Q2 profile options are bounded and do not accept arbitrary production flags", () => {
  const materialized = materializeSyntheticCase();
  try {
    assert.throws(
      () => createQ2BenchmarkHybridRuntime(materialized, {
        profile: "q2_fts_only_v1",
        isolatedKg: false,
      }),
      /q2_channel_runtime_option_unknown:isolatedKg/,
    );
  } finally {
    rmSync(materialized.root, { recursive: true, force: true });
  }
});
