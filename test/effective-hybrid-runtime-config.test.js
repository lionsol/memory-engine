import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fingerprintConfig } from "../lib/config/config-fingerprint.js";
import {
  DEFAULT_AUTO_RECALL,
  resolveEffectiveHybridRuntimeConfig,
} from "../lib/config/effective-hybrid-runtime-config.js";

function normalized(input) {
  const { valid, errors, ...config } = resolveEffectiveHybridRuntimeConfig(input);
  assert.equal(valid, true, errors.join(", "));
  return config;
}

function fingerprint(input) {
  return fingerprintConfig(normalized(input)).fingerprint;
}

test("official plugin config is the highest-priority runtime source", () => {
  const config = normalized({
    pluginConfig: {
      kgFailClosedMode: "full_fail_closed",
      recentFailClosedMode: "full_fail_closed",
    },
    pluginEntryConfig: {
      kgFailClosedMode: "legacy_fallback",
      recentFailClosedMode: "legacy_fallback",
    },
    apiConfig: {
      kgFailClosedMode: "shadow_fail_closed",
      recentFailClosedMode: "shadow_fail_closed",
    },
  });
  assert.equal(config.kgFailClosedMode, "full_fail_closed");
  assert.equal(config.recentFailClosedMode, "full_fail_closed");
});

test("legacy nested and global compatibility sources resolve to the runtime mode", () => {
  const nested = normalized({
    pluginConfig: {},
    pluginEntryConfig: { autoRecall: { kgFailClosedMode: "full_fail_closed" } },
  });
  assert.equal(nested.kgFailClosedMode, "full_fail_closed");

  const global = normalized({ apiConfig: { kgFailClosedMode: "full_fail_closed" } });
  assert.equal(global.kgFailClosedMode, "full_fail_closed");
});

test("lower-priority changes do not change the effective fingerprint", () => {
  const base = {
    pluginConfig: { kgFailClosedMode: "full_fail_closed" },
    apiConfig: { kgFailClosedMode: "legacy_fallback" },
  };
  const changedLowerPriority = {
    pluginConfig: { kgFailClosedMode: "full_fail_closed" },
    apiConfig: { kgFailClosedMode: "shadow_fail_closed" },
  };
  assert.equal(fingerprint(base), fingerprint(changedLowerPriority));
});

test("omitted values and explicit schema defaults have the same effective fingerprint", () => {
  const omitted = fingerprint({});
  const explicit = fingerprint({
    pluginConfig: {
      autoRecall: { ...DEFAULT_AUTO_RECALL, topK: 5 },
      kgFailClosedMode: "legacy_fallback",
      kgFailClosedCanary: { enabled: false, agentIds: [], sessionIds: [], tokens: [] },
      recentFailClosedMode: "legacy_fallback",
      recentFailClosedCanary: { enabled: false, agentIds: [], sessionIds: [], tokens: [] },
    },
  });
  assert.equal(omitted, explicit);
});

test("retired productionEvidenceWindow is absent from the manifest and effective config", () => {
  const manifest = JSON.parse(readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"));
  assert.equal(Object.hasOwn(manifest.configSchema.properties, "productionEvidenceWindow"), false);

  const legacyInput = {
    pluginConfig: {
      productionEvidenceWindow: { enabled: true, epochId: "legacy-epoch" },
    },
  };
  const config = normalized(legacyInput);
  assert.equal(Object.hasOwn(config, "productionEvidenceWindow"), false);
  assert.equal(fingerprint(legacyInput), fingerprint({}));
});

test("AutoRecall topK uses memory-engine recall when not explicitly configured", () => {
  const inherited = normalized({
    apiConfig: { memoryEngine: { recall: { topK: 11 } } },
  });
  assert.equal(inherited.autoRecall.topK, 11);

  const overridden = normalized({
    pluginConfig: { autoRecall: { topK: 2 } },
    apiConfig: { memoryEngine: { recall: { topK: 11 } } },
  });
  assert.equal(overridden.autoRecall.topK, 2);
});

test("effective retrieval configuration changes the fingerprint", () => {
  const base = { apiConfig: { memoryEngine: { recall: { topK: 5 } } } };
  for (const section of [
    { recall: { ftsTopK: 41 } },
    { recall: { vectorTopK: 41 } },
    { recall: { recentTopK: 41 } },
    { recall: { lexicalConfidenceThreshold: 0.81 } },
    { ranking: { rrfK: 91 } },
    { confidence: { min: 0.21 } },
  ]) {
    assert.notEqual(
      fingerprint(base),
      fingerprint({ apiConfig: { memoryEngine: section } }),
      JSON.stringify(section),
    );
  }
});

test("effective retrieval sections exclude unrelated host configuration", () => {
  const config = normalized({
    apiConfig: {
      memoryEngine: {
        recall: { ftsTopK: 41 },
        ranking: { rrfK: 91 },
        confidence: { min: 0.21 },
      },
      unrelatedPlugin: { secret: "not hashed as config" },
    },
  });
  assert.equal(config.hybridRetrieval.recall.ftsTopK, 41);
  assert.equal(config.hybridRetrieval.ranking.rrfK, 91);
  assert.equal(config.hybridRetrieval.confidence.min, 0.21);
  assert.equal(Object.hasOwn(config, "unrelatedPlugin"), false);
});

test("invalid hybrid retrieval limits fail closed and use canonical defaults", () => {
  const result = resolveEffectiveHybridRuntimeConfig({
    memoryEngineConfig: {
      recall: {
        vectorTopK: "30",
        ftsTopK: 0,
        likePatternTopN: 3,
        likeTopK: Number.NaN,
        recentTopK: 1.5,
        recentRerankTopK: null,
        recentFallbackTopK: {},
      },
      ranking: {
        rrfK: Number.POSITIVE_INFINITY,
      },
    },
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, [
    "invalid_integer:memoryEngineConfig.recall.ftsTopK",
    "invalid_integer:memoryEngineConfig.recall.likePatternTopN",
    "invalid_integer:memoryEngineConfig.recall.likeTopK",
    "invalid_integer:memoryEngineConfig.recall.recentFallbackTopK",
    "invalid_integer:memoryEngineConfig.recall.recentRerankTopK",
    "invalid_integer:memoryEngineConfig.recall.recentTopK",
    "invalid_integer:memoryEngineConfig.recall.vectorTopK",
    "invalid_number:memoryEngineConfig.ranking.rrfK",
  ]);
  assert.deepEqual({
    vectorTopK: result.hybridRetrieval.recall.vectorTopK,
    ftsTopK: result.hybridRetrieval.recall.ftsTopK,
    likePatternTopN: result.hybridRetrieval.recall.likePatternTopN,
    likeTopK: result.hybridRetrieval.recall.likeTopK,
    recentTopK: result.hybridRetrieval.recall.recentTopK,
    recentRerankTopK: result.hybridRetrieval.recall.recentRerankTopK,
    recentFallbackTopK: result.hybridRetrieval.recall.recentFallbackTopK,
    rrfK: result.hybridRetrieval.ranking.rrfK,
  }, {
    vectorTopK: 30,
    ftsTopK: 20,
    likePatternTopN: 8,
    likeTopK: 30,
    recentTopK: 120,
    recentRerankTopK: 20,
    recentFallbackTopK: 20,
    rrfK: 60,
  });
});

test("valid hybrid retrieval limits preserve explicit numeric values", () => {
  const result = resolveEffectiveHybridRuntimeConfig({
    memoryEngineConfig: {
      recall: {
        vectorTopK: 1,
        ftsTopK: 50,
        likePatternTopN: 4,
        likeTopK: 2,
        recentTopK: 3,
        recentRerankTopK: 4,
        recentFallbackTopK: 5,
      },
      ranking: { rrfK: 0.5 },
    },
  });

  assert.equal(result.valid, true, result.errors.join(", "));
  assert.deepEqual({
    vectorTopK: result.hybridRetrieval.recall.vectorTopK,
    ftsTopK: result.hybridRetrieval.recall.ftsTopK,
    likePatternTopN: result.hybridRetrieval.recall.likePatternTopN,
    likeTopK: result.hybridRetrieval.recall.likeTopK,
    recentTopK: result.hybridRetrieval.recall.recentTopK,
    recentRerankTopK: result.hybridRetrieval.recall.recentRerankTopK,
    recentFallbackTopK: result.hybridRetrieval.recall.recentFallbackTopK,
    rrfK: result.hybridRetrieval.ranking.rrfK,
  }, {
    vectorTopK: 1,
    ftsTopK: 50,
    likePatternTopN: 4,
    likeTopK: 2,
    recentTopK: 3,
    recentRerankTopK: 4,
    recentFallbackTopK: 5,
    rrfK: 0.5,
  });
});

test("malformed hybrid sections fail closed without coercing their fields", () => {
  const result = resolveEffectiveHybridRuntimeConfig({
    memoryEngineConfig: {
      recall: [],
      ranking: null,
    },
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, [
    "invalid_object:memoryEngineConfig.ranking",
    "invalid_object:memoryEngineConfig.recall",
  ]);
  assert.equal(result.hybridRetrieval.recall.vectorTopK, 30);
  assert.equal(result.hybridRetrieval.ranking.rrfK, 60);
});

test("every hybrid breadth field rejects explicit non-contract values", () => {
  const fields = [
    ["vectorTopK", 30],
    ["ftsTopK", 20],
    ["likePatternTopN", 8],
    ["likeTopK", 30],
    ["recentTopK", 120],
    ["recentRerankTopK", 20],
    ["recentFallbackTopK", 20],
  ];
  const invalidValues = [null, "5", 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, {}, []];

  for (const [field, fallback] of fields) {
    for (const value of invalidValues) {
      const result = resolveEffectiveHybridRuntimeConfig({
        memoryEngineConfig: { recall: { [field]: value } },
      });
      assert.equal(result.valid, false, `${field}=${String(value)}`);
      assert.equal(
        result.errors.includes(`invalid_integer:memoryEngineConfig.recall.${field}`),
        true,
        `${field}=${String(value)}`,
      );
      assert.equal(result.hybridRetrieval.recall[field], fallback, `${field}=${String(value)}`);
    }
  }

  for (const value of [null, "5", 0, -1, Number.NaN, Number.POSITIVE_INFINITY, {}, []]) {
    const result = resolveEffectiveHybridRuntimeConfig({
      memoryEngineConfig: { ranking: { rrfK: value } },
    });
    assert.equal(result.valid, false, `rrfK=${String(value)}`);
    assert.equal(result.errors.includes("invalid_number:memoryEngineConfig.ranking.rrfK"), true);
    assert.equal(result.hybridRetrieval.ranking.rrfK, 60);
  }
});

test("R2 rejects timeout coercion and optional threshold coercion", () => {
  for (const value of [500, 999, 0, -1, "8000", Number.NaN, Number.POSITIVE_INFINITY, null, {}, []]) {
    const result = resolveEffectiveHybridRuntimeConfig({
      pluginConfig: { autoRecall: { timeoutMs: value } },
    });
    assert.equal(result.valid, false, `timeoutMs=${String(value)}`);
    assert.ok(result.errors.includes("invalid_number:autoRecall.timeoutMs"), `timeoutMs=${String(value)}`);
    assert.equal(result.autoRecall.timeoutMs, 8000, `timeoutMs=${String(value)}`);
  }

  const validTimeout = resolveEffectiveHybridRuntimeConfig({
    pluginConfig: { autoRecall: { timeoutMs: 1000.5 } },
  });
  assert.equal(validTimeout.autoRecall.timeoutMs, 1000.5);
  assert.equal(validTimeout.errors.includes("invalid_number:autoRecall.timeoutMs"), false);

  for (const field of ["minConfidence", "lexicalConfidenceThreshold"]) {
    for (const value of ["0.4", -0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY, {}, []]) {
      const result = resolveEffectiveHybridRuntimeConfig({
        pluginConfig: { autoRecall: { [field]: value } },
      });
      assert.equal(result.valid, false, `${field}=${String(value)}`);
      assert.ok(result.errors.includes(`invalid_number:autoRecall.${field}`), `${field}=${String(value)}`);
      assert.equal(result.autoRecall[field], null, `${field}=${String(value)}`);
    }
  }

  const optionalNull = resolveEffectiveHybridRuntimeConfig({
    pluginConfig: { autoRecall: { minConfidence: null, lexicalConfidenceThreshold: null } },
  });
  assert.equal(optionalNull.autoRecall.minConfidence, null);
  assert.equal(optionalNull.autoRecall.lexicalConfidenceThreshold, null);
  assert.equal(optionalNull.errors.some(error => error.includes("autoRecall.minConfidence")), false);
  assert.equal(optionalNull.errors.some(error => error.includes("autoRecall.lexicalConfidenceThreshold")), false);
});

test("R2 threshold validation attributes config sources and never clamps", () => {
  const invalidValues = [null, "0.4", -0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY, {}, []];
  const configSources = [
    ["memory", "minConfidence", "invalid_number:memory.minConfidence", 0.15],
    ["autoRecall", "minConfidence", "invalid_number:autoRecall.minConfidence", 0.15],
    ["memory", "autoRecallLexicalConfidenceThreshold", "invalid_number:memory.autoRecallLexicalConfidenceThreshold", 0.7],
    ["autoRecall", "lexicalConfidenceThreshold", "invalid_number:autoRecall.lexicalConfidenceThreshold", 0.7],
  ];

  for (const [section, field, errorCode, fallback] of configSources) {
    for (const value of invalidValues) {
      const result = resolveEffectiveHybridRuntimeConfig({
        apiConfig: { [section]: { [field]: value } },
      });
      const effective = field === "minConfidence"
        ? result.hybridRetrieval.effectiveMinConfidence
        : result.hybridRetrieval.effectiveLexicalConfidenceThreshold;
      assert.equal(result.valid, false, `${section}.${field}=${String(value)}`);
      assert.ok(result.errors.includes(errorCode), `${section}.${field}=${String(value)}`);
      assert.equal(effective, fallback, `${section}.${field}=${String(value)}`);
    }
  }

  for (const [path, field, errorCode, fallback] of [
    ["confidence", "min", "invalid_number:memoryEngineConfig.confidence.min", 0.15],
    ["recall", "lexicalConfidenceThreshold", "invalid_number:memoryEngineConfig.recall.lexicalConfidenceThreshold", 0.7],
  ]) {
    for (const value of invalidValues) {
      const result = resolveEffectiveHybridRuntimeConfig({
        memoryEngineConfig: { [path]: { [field]: value } },
      });
      const effective = path === "confidence"
        ? result.hybridRetrieval.effectiveMinConfidence
        : result.hybridRetrieval.effectiveLexicalConfidenceThreshold;
      assert.equal(result.valid, false, `memoryEngineConfig.${path}.${field}=${String(value)}`);
      assert.ok(result.errors.includes(errorCode), `memoryEngineConfig.${path}.${field}=${String(value)}`);
      assert.equal(effective, fallback, `memoryEngineConfig.${path}.${field}=${String(value)}`);
    }
  }
});

test("R2 thresholds accept only bounded explicit numbers and strict environment decimals", () => {
  const previousMin = process.env.MEMORY_ENGINE_MIN_CONFIDENCE;
  const previousLexical = process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD;
  try {
    delete process.env.MEMORY_ENGINE_MIN_CONFIDENCE;
    delete process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD;

    for (const value of [0, 0.5, 1]) {
      const result = resolveEffectiveHybridRuntimeConfig({
        apiConfig: {
          memory: { minConfidence: value },
          autoRecall: { lexicalConfidenceThreshold: value },
        },
      });
      assert.equal(result.valid, true, result.errors.join(", "));
      assert.equal(result.hybridRetrieval.effectiveMinConfidence, value);
      assert.equal(result.hybridRetrieval.effectiveLexicalConfidenceThreshold, value);
    }

    process.env.MEMORY_ENGINE_MIN_CONFIDENCE = "0.25";
    process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD = "0.75";
    const fromEnvironment = resolveEffectiveHybridRuntimeConfig({});
    assert.equal(fromEnvironment.valid, true, fromEnvironment.errors.join(", "));
    assert.equal(fromEnvironment.hybridRetrieval.effectiveMinConfidence, 0.25);
    assert.equal(fromEnvironment.hybridRetrieval.effectiveLexicalConfidenceThreshold, 0.75);

    process.env.MEMORY_ENGINE_MIN_CONFIDENCE = "1.1";
    process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD = "not-a-number";
    const invalidEnvironment = resolveEffectiveHybridRuntimeConfig({});
    assert.equal(invalidEnvironment.valid, false);
    assert.ok(invalidEnvironment.errors.includes("invalid_number:MEMORY_ENGINE_MIN_CONFIDENCE"));
    assert.ok(invalidEnvironment.errors.includes("invalid_number:AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD"));
    assert.equal(invalidEnvironment.hybridRetrieval.effectiveMinConfidence, 0.15);
    assert.equal(invalidEnvironment.hybridRetrieval.effectiveLexicalConfidenceThreshold, 0.7);

    process.env.MEMORY_ENGINE_MIN_CONFIDENCE = "0.8";
    process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD = "0.9";
    const invalidConfig = resolveEffectiveHybridRuntimeConfig({
      apiConfig: {
        memory: { minConfidence: "0.6" },
        autoRecall: { lexicalConfidenceThreshold: 1.2 },
      },
    });
    assert.equal(invalidConfig.valid, false);
    assert.ok(invalidConfig.errors.includes("invalid_number:memory.minConfidence"));
    assert.ok(invalidConfig.errors.includes("invalid_number:autoRecall.lexicalConfidenceThreshold"));
    assert.equal(invalidConfig.errors.includes("invalid_number:MEMORY_ENGINE_MIN_CONFIDENCE"), false);
    assert.equal(invalidConfig.errors.includes("invalid_number:AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD"), false);
    assert.equal(invalidConfig.hybridRetrieval.effectiveMinConfidence, 0.15);
    assert.equal(invalidConfig.hybridRetrieval.effectiveLexicalConfidenceThreshold, 0.7);
  } finally {
    if (previousMin === undefined) delete process.env.MEMORY_ENGINE_MIN_CONFIDENCE;
    else process.env.MEMORY_ENGINE_MIN_CONFIDENCE = previousMin;
    if (previousLexical === undefined) delete process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD;
    else process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD = previousLexical;
  }
});

test("environment retrieval overrides are normalized into the effective config", () => {
  const previousMin = process.env.MEMORY_ENGINE_MIN_CONFIDENCE;
  const previousLexical = process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD;
  try {
    process.env.MEMORY_ENGINE_MIN_CONFIDENCE = "0.31";
    process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD = "0.82";
    const config = normalized({});
    assert.equal(config.hybridRetrieval.effectiveMinConfidence, 0.31);
    assert.equal(config.hybridRetrieval.effectiveLexicalConfidenceThreshold, 0.82);
  } finally {
    if (previousMin === undefined) delete process.env.MEMORY_ENGINE_MIN_CONFIDENCE;
    else process.env.MEMORY_ENGINE_MIN_CONFIDENCE = previousMin;
    if (previousLexical === undefined) delete process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD;
    else process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD = previousLexical;
  }
});

test("effective AutoRecall, mode, and canary changes change the fingerprint", () => {
  const base = {};
  for (const change of [
    { autoRecall: { enabled: true } },
    { autoRecall: { topK: 9 } },
    { autoRecall: { timeoutMs: 1000 } },
    { autoRecall: { agentAllowlist: ["main"] } },
    { autoRecall: { sessionAllowlist: ["h5-session"] } },
    { autoRecall: { triggerAllowlist: ["manual"] } },
    { autoRecall: { chatTypeAllowlist: ["other"] } },
    { autoRecall: { messageRoleAllowlist: ["assistant"] } },
    { kgFailClosedMode: "full_fail_closed" },
    { kgFailClosedCanary: { enabled: true, agentIds: ["edi"], sessionIds: [] } },
    { recentFailClosedMode: "full_fail_closed" },
    { recentFailClosedCanary: { enabled: true, agentIds: ["edi"], sessionIds: [] } },
    { recallHintRuntimeCanary: { enabled: true, sessionIds: ["session-rh"], vectorExecutionMode: "parallel" } },
  ]) {
    assert.notEqual(
      fingerprint(base),
      fingerprint({ pluginConfig: change }),
      JSON.stringify(change),
    );
  }
});

test("Recall Hint runtime canary defaults off and accepts only exact session plus execution-mode fields", () => {
  const defaults = normalized({});
  assert.deepEqual(defaults.recallHintRuntimeCanary, {
    enabled: false,
    sessionIds: [],
    vectorExecutionMode: "sequential",
  });

  const configured = normalized({
    pluginConfig: {
      recallHintRuntimeCanary: {
        enabled: true,
        sessionIds: ["session-rh"],
        vectorExecutionMode: "parallel",
      },
    },
  });
  assert.deepEqual(configured.recallHintRuntimeCanary, {
    enabled: true,
    sessionIds: ["session-rh"],
    vectorExecutionMode: "parallel",
  });

  for (const recallHintRuntimeCanary of [
    { enabled: "yes" },
    { sessionIds: "session-rh" },
    { vectorExecutionMode: "auto" },
    { enabled: true, unknown: true },
  ]) {
    const result = resolveEffectiveHybridRuntimeConfig({
      pluginConfig: { recallHintRuntimeCanary },
    });
    assert.equal(result.valid, false, JSON.stringify(recallHintRuntimeCanary));
    assert.deepEqual(result.recallHintRuntimeCanary, {
      enabled: false,
      sessionIds: [],
      vectorExecutionMode: "sequential",
    });
  }
});

test("invalid legacy values are marked invalid instead of silently fingerprinted", () => {
  const result = resolveEffectiveHybridRuntimeConfig({
    pluginConfig: { autoRecall: { agentAllowlist: "edi", sessionAllowlist: "session-1" } },
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("invalid_array:autoRecall.agentAllowlist"));
  assert.ok(result.errors.includes("invalid_array:autoRecall.sessionAllowlist"));
});

test("canary compatibility aliases are preserved in normalized config", () => {
  const config = normalized({
    pluginConfig: {
      recentFailClosedCanary: {
        enabled: true,
        agents: ["edi"],
        sessions: ["session-1"],
        tokenAllowlist: ["canary-token"],
      },
    },
  });
  assert.deepEqual(config.recentFailClosedCanary, {
    enabled: true,
    agentIds: ["edi"],
    sessionIds: ["session-1"],
    tokens: ["canary-token"],
  });
});

test("Recent canary accepts the legacy single token alias", () => {
  const config = normalized({
    pluginConfig: {
      recentFailClosedCanary: {
        enabled: true,
        token: "canary-token",
      },
    },
  });
  assert.deepEqual(config.recentFailClosedCanary.tokens, ["canary-token"]);
});

test("Recent canary rejects malformed single token aliases", () => {
  for (const token of ["", {}, ["canary-token"]]) {
    const result = resolveEffectiveHybridRuntimeConfig({
      pluginConfig: { recentFailClosedCanary: { enabled: true, token } },
    });
    assert.equal(result.valid, false, JSON.stringify(token));
  }
});

test("Recent canary token arrays take precedence over the single token alias", () => {
  const config = normalized({
    pluginConfig: {
      recentFailClosedCanary: {
        enabled: true,
        token: "ignored-token",
        tokens: ["preferred-token"],
      },
    },
  });
  assert.deepEqual(config.recentFailClosedCanary.tokens, ["preferred-token"]);
});

test("malformed high-priority AutoRecall does not fall through to a lower source", () => {
  for (const autoRecall of ["bad", null, [], 4, false]) {
    const result = resolveEffectiveHybridRuntimeConfig({
      pluginConfig: { autoRecall },
      pluginEntryConfig: { autoRecall: { enabled: true, topK: 9 } },
    });
    assert.equal(result.valid, false, JSON.stringify(autoRecall));
    assert.ok(result.errors.includes("invalid_object:autoRecall"), JSON.stringify(autoRecall));
    assert.equal(result.autoRecall.enabled, false, JSON.stringify(autoRecall));
    assert.notEqual(result.autoRecall.topK, 9, JSON.stringify(autoRecall));
  }
});

test("malformed config roots are observable and use safe source barriers", () => {
  const malformedValues = ["bad", 4, false, [], Number.NaN, Number.POSITIVE_INFINITY];
  for (const value of malformedValues) {
    const plugin = resolveEffectiveHybridRuntimeConfig({
      pluginConfig: value,
      pluginEntryConfig: { autoRecall: { enabled: true } },
    });
    assert.equal(plugin.valid, false, `pluginConfig=${String(value)}`);
    assert.ok(plugin.errors.includes("invalid_object:pluginConfig"), `pluginConfig=${String(value)}`);
    assert.equal(plugin.autoRecall.enabled, false, `pluginConfig=${String(value)}`);

    const entry = resolveEffectiveHybridRuntimeConfig({
      pluginConfig: {},
      pluginEntryConfig: value,
      apiConfig: { autoRecall: { enabled: true } },
    });
    assert.equal(entry.valid, false, `pluginEntryConfig=${String(value)}`);
    assert.ok(entry.errors.includes("invalid_object:pluginEntryConfig"), `pluginEntryConfig=${String(value)}`);
    assert.equal(entry.autoRecall.enabled, false, `pluginEntryConfig=${String(value)}`);
  }

  for (const value of malformedValues) {
    const api = resolveEffectiveHybridRuntimeConfig({ apiConfig: value });
    assert.equal(api.valid, false, `apiConfig=${String(value)}`);
    assert.ok(api.errors.includes("invalid_object:apiConfig"), `apiConfig=${String(value)}`);
  }

  const absentAndEmpty = resolveEffectiveHybridRuntimeConfig({
    pluginConfig: {},
    pluginEntryConfig: null,
    apiConfig: { memoryEngine: null, memory: null },
    memoryEngineConfig: null,
  });
  assert.equal(absentAndEmpty.valid, true, absentAndEmpty.errors.join(", "));

  const malformedMemoryEngine = resolveEffectiveHybridRuntimeConfig({
    apiConfig: { memoryEngine: "bad" },
  });
  assert.equal(malformedMemoryEngine.valid, false);
  assert.ok(malformedMemoryEngine.errors.includes("invalid_object:apiConfig.memoryEngine"));
  assert.equal(malformedMemoryEngine.hybridRetrieval.recall.vectorTopK, 30);

  const malformedDirectMemoryEngine = resolveEffectiveHybridRuntimeConfig({
    memoryEngineConfig: "bad",
  });
  assert.equal(malformedDirectMemoryEngine.valid, false);
  assert.ok(malformedDirectMemoryEngine.errors.includes("invalid_object:memoryEngineConfig"));
  assert.equal(malformedDirectMemoryEngine.hybridRetrieval.recall.vectorTopK, 30);

  const malformedApiMemoryEngine = resolveEffectiveHybridRuntimeConfig({
    apiConfig: { memoryEngine: { confidence: "bad" } },
  });
  assert.equal(malformedApiMemoryEngine.valid, false);
  assert.ok(malformedApiMemoryEngine.errors.includes("invalid_object:memoryEngineConfig.confidence"));
  assert.equal(malformedApiMemoryEngine.hybridRetrieval.effectiveMinConfidence, 0.15);
  assert.equal(Object.hasOwn(malformedApiMemoryEngine.hybridRetrieval.confidence, "0"), false);

  for (const value of malformedValues) {
    const apiMemoryEngine = resolveEffectiveHybridRuntimeConfig({
      apiConfig: { memoryEngine: value },
    });
    assert.equal(apiMemoryEngine.valid, false, `apiConfig.memoryEngine=${String(value)}`);
    assert.ok(
      apiMemoryEngine.errors.includes("invalid_object:apiConfig.memoryEngine"),
      `apiConfig.memoryEngine=${String(value)}`,
    );

    const directMemoryEngine = resolveEffectiveHybridRuntimeConfig({
      memoryEngineConfig: value,
    });
    assert.equal(directMemoryEngine.valid, false, `memoryEngineConfig=${String(value)}`);
    assert.ok(
      directMemoryEngine.errors.includes("invalid_object:memoryEngineConfig"),
      `memoryEngineConfig=${String(value)}`,
    );
  }

  for (const value of malformedValues) {
    const confidence = resolveEffectiveHybridRuntimeConfig({
      apiConfig: { memoryEngine: { confidence: value } },
    });
    assert.equal(confidence.valid, false, `api confidence=${String(value)}`);
    assert.ok(
      confidence.errors.includes("invalid_object:memoryEngineConfig.confidence"),
      `api confidence=${String(value)}`,
    );
    assert.equal(Object.hasOwn(confidence.hybridRetrieval.confidence, "0"), false);
  }
});

test("malformed threshold containers block lower aliases and preserve confidence shape", () => {
  const previousMin = process.env.MEMORY_ENGINE_MIN_CONFIDENCE;
  const previousLexical = process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD;
  try {
    process.env.MEMORY_ENGINE_MIN_CONFIDENCE = "0.82";
    process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD = "0.83";

    const malformedMemory = resolveEffectiveHybridRuntimeConfig({
      apiConfig: {
        memory: "bad",
        autoRecall: {
          minConfidence: 0.91,
          lexicalConfidenceThreshold: 0.92,
        },
      },
      memoryEngineConfig: {
        confidence: { min: 0.73 },
        recall: { lexicalConfidenceThreshold: 0.74 },
      },
    });
    assert.equal(malformedMemory.valid, false);
    assert.ok(malformedMemory.errors.includes("invalid_object:apiConfig.memory"));
    assert.equal(malformedMemory.hybridRetrieval.effectiveMinConfidence, 0.15);
    assert.equal(malformedMemory.hybridRetrieval.effectiveLexicalConfidenceThreshold, 0.7);

    const malformedAutoRecall = resolveEffectiveHybridRuntimeConfig({
      apiConfig: { autoRecall: "bad" },
      memoryEngineConfig: {
        confidence: { min: 0.73 },
        recall: { lexicalConfidenceThreshold: 0.74 },
      },
    });
    assert.equal(malformedAutoRecall.valid, false);
    assert.ok(malformedAutoRecall.errors.includes("invalid_object:autoRecall"));
    assert.equal(malformedAutoRecall.errors.includes("invalid_object:apiConfig.autoRecall"), false);
    assert.equal(malformedAutoRecall.hybridRetrieval.effectiveMinConfidence, 0.15);
    assert.equal(malformedAutoRecall.hybridRetrieval.effectiveLexicalConfidenceThreshold, 0.7);

    const malformedConfidence = resolveEffectiveHybridRuntimeConfig({
      memoryEngineConfig: { confidence: "bad" },
    });
    assert.equal(malformedConfidence.valid, false);
    assert.ok(malformedConfidence.errors.includes("invalid_object:memoryEngineConfig.confidence"));
    assert.equal(malformedConfidence.hybridRetrieval.effectiveMinConfidence, 0.15);
    assert.equal(malformedConfidence.hybridRetrieval.confidence.min, 0.15);
    assert.equal(Object.hasOwn(malformedConfidence.hybridRetrieval.confidence, "0"), false);
    assert.equal(Object.hasOwn(malformedConfidence.hybridRetrieval.confidence, "1"), false);
    assert.equal(Object.hasOwn(malformedConfidence.hybridRetrieval.confidence, "2"), false);
  } finally {
    if (previousMin === undefined) delete process.env.MEMORY_ENGINE_MIN_CONFIDENCE;
    else process.env.MEMORY_ENGINE_MIN_CONFIDENCE = previousMin;
    if (previousLexical === undefined) delete process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD;
    else process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD = previousLexical;
  }
});

test("malformed lower-priority AutoRecall remains observable without taking precedence", () => {
  const lowerMalformed = resolveEffectiveHybridRuntimeConfig({
    pluginConfig: { autoRecall: { enabled: false } },
    pluginEntryConfig: { autoRecall: "bad" },
  });
  assert.equal(lowerMalformed.valid, false);
  assert.deepEqual(lowerMalformed.autoRecall.enabled, false);
  assert.ok(lowerMalformed.errors.includes("invalid_object:autoRecall"));
  assert.equal(lowerMalformed.errors.includes("invalid_object:apiConfig.autoRecall"), false);

  const higherEnabled = resolveEffectiveHybridRuntimeConfig({
    pluginConfig: { autoRecall: { enabled: true } },
    pluginEntryConfig: { autoRecall: "bad" },
    apiConfig: { autoRecall: { enabled: false } },
  });
  assert.equal(higherEnabled.valid, false);
  assert.equal(higherEnabled.autoRecall.enabled, true);
  assert.ok(higherEnabled.errors.includes("invalid_object:autoRecall"));
  assert.equal(higherEnabled.errors.includes("invalid_object:apiConfig.autoRecall"), false);
});

test("valid higher-priority plugin values survive malformed lower roots", () => {
  const result = resolveEffectiveHybridRuntimeConfig({
    pluginConfig: { kgFailClosedMode: "full_fail_closed" },
    pluginEntryConfig: "bad",
    apiConfig: { kgFailClosedMode: "shadow_fail_closed" },
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("invalid_object:pluginEntryConfig"));
  assert.equal(result.kgFailClosedMode, "full_fail_closed");
});

test("invalid fail-closed modes fail safe and invalidate runtime config", () => {
  const result = resolveEffectiveHybridRuntimeConfig({
    pluginConfig: { kgFailClosedMode: "unexpected_mode" },
  });
  assert.equal(result.valid, false);
  assert.equal(result.kgFailClosedMode, "legacy_fallback");
  assert.ok(result.errors.includes("invalid_mode:kgFailClosedMode"));
});

test("malformed compatibility values use safe runtime values and invalidate the normalized config", () => {
  const result = resolveEffectiveHybridRuntimeConfig({
    pluginConfig: {
      autoRecall: { enabled: "false", topK: "bad", timeoutMs: {} },
      kgFailClosedCanary: { enabled: "true" },
    },
  });
  assert.equal(result.valid, false);
  assert.equal(result.autoRecall.enabled, false);
  assert.equal(result.autoRecall.topK, 5);
  assert.equal(result.autoRecall.timeoutMs, 8000);
  assert.equal(result.kgFailClosedCanary.enabled, false);
});
