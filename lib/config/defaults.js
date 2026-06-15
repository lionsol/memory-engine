const MEMORY_ENGINE_DEFAULTS = {
  timezone: {
    business: "Asia/Shanghai",
  },
  archive: {
    threshold: 0.15,
  },
  confidence: {
    min: 0.15,
    gateThresholdByCategory: {
      raw_log: {
        final_score_min: 0.05,
      },
      episodic: {
        final_score_min: 0.02,
      },
    },
  },
  recall: {
    topK: 5,
    vectorTopK: 30,
    ftsTopK: 20,
    lexicalConfidenceThreshold: 0.7,
    likePatternTopN: 8,
    likeTopK: 30,
    recentTopK: 120,
    recentRerankTopK: 20,
    recentFallbackTopK: 20,
  },
  ranking: {
    rrfK: 60,
    recencyBoost: {
      base: 0.06,
      decayDays: 2.5,
    },
    categoryBoost: {
      managed: {
        episodic: 0.12,
        sessionCheckpoint: 0.1,
      },
      external: {
        core_profile: 0.06,
        project: 0.05,
        daily_journal: 0.02,
        dreaming: 0,
        stats: -0.05,
        external: 0.03,
      },
    },
    externalBoost: {
      value: 0.05,
      excludedCategories: ["dreaming", "stats"],
    },
    confidenceWeight: 0.1,
    fallbackBaseScore: {
      like: 0.3,
      recent: 0.35,
      recentFallback: 0.25,
      episodeBonus: 0.08,
    },
  },
  metrics: {
    windowDays: 7,
    topN: 10,
  },
};

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function deepClone(value) {
  if (Array.isArray(value)) return value.map(deepClone);
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) out[key] = deepClone(item);
  return out;
}

export function getDefaultMemoryEngineConfig() {
  return deepClone(MEMORY_ENGINE_DEFAULTS);
}

export { MEMORY_ENGINE_DEFAULTS };
