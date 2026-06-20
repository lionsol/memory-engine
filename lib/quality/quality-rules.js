import { getPathFamily } from "./path-family.js";
import { p0PerMemoryFlags, p1PerMemoryFlags } from "./quality-types.js";
import { hasTimestampPollution } from "./timestamp-pollution.js";

const KNOWN_CATEGORIES = new Set([
  "temporary",
  "raw_log",
  "episodic",
  "preference",
  "kg_node",
  "user_identity",
  "dreaming",
  "project",
  "core_profile",
  "daily_journal",
  "stats",
  "external",
]);

const OBVIOUS_CATEGORY_MISMATCH = {
  "smart-add": new Set(["project", "preference", "kg_node", "user_identity"]),
  dreaming: new Set(["project", "preference", "user_identity"]),
  episodes: new Set(["raw_log", "project", "dreaming"]),
  projects: new Set(["raw_log", "dreaming"]),
  "daily-root": new Set(["project", "preference", "kg_node", "user_identity"]),
};

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function toUnixSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 100000000000 ? Math.floor(n / 1000) : Math.floor(n);
}

function getAgeDays(candidate, nowSec) {
  const ts = toUnixSeconds(candidate?.last_confidence_update) || toUnixSeconds(candidate?.updated_at);
  if (!ts || !nowSec || nowSec <= ts) return 0;
  return (nowSec - ts) / 86400;
}

function hasRawLogLeak(text) {
  return (
    /^(user|assistant|system|tool):/im.test(text) ||
    /^#{1,6}\s*(user|assistant|system|tool)\b/im.test(text) ||
    /\brole\s*:\s*(user|assistant|system|tool)\b/i.test(text)
  );
}

function hasDebugNoise(text) {
  return (
    /\b(error|typeerror|referenceerror|syntaxerror):/i.test(text) ||
    /^\s*at\s+.+\(.+:\d+:\d+\)\s*$/m.test(text) ||
    /traceback \(most recent call last\)/i.test(text) ||
    /\bnode:internal\b/i.test(text)
  );
}

function isTooGeneric(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  const hasDetailAnchor = (
    /\bv?\d+\.\d+(?:\.\d+)?\b/.test(normalized) ||
    /\btag\b|\bcommit\b|\bsha\b|\bpr\b|\bissue\b/.test(normalized) ||
    /[a-z0-9_-]+\/[a-z0-9_.-]+/.test(normalized) ||
    /\b[a-z0-9_.-]+\.(js|ts|md|json|sql|py|sh)\b/.test(normalized) ||
    /\b(完成|已完成|修复|迁移|决定|通过|blocked|done|fixed|migrated|completed)\b/i.test(text)
  );
  if (hasDetailAnchor) return false;

  const genericPattern = (
    /(用户|今天).{0,12}(讨论|关注)/.test(text) ||
    /讨论了?(项目|memory-engine|记忆系统)/.test(text) ||
    /关注(记忆系统|项目|优化)/.test(text) ||
    /^user (discussed|talked about)/i.test(text)
  );
  return genericPattern;
}

function evaluateUtilityFlags(candidate, flags, ageDays) {
  const retrievedCount = Number(candidate?.retrieved_count || 0);
  const injectedCount = Number(candidate?.injected_count || 0);
  if (ageDays < 7) return;
  if (ageDays > 30 && retrievedCount === 0 && injectedCount === 0) {
    flags.add(p1PerMemoryFlags.old_and_unused);
    return;
  }
  if (retrievedCount === 0) {
    flags.add(p1PerMemoryFlags.never_retrieved);
  }
}

function isCategoryPathMismatch(pathFamily, category) {
  if (!pathFamily || !category) return false;
  const blocked = OBVIOUS_CATEGORY_MISMATCH[pathFamily];
  return Boolean(blocked?.has(category));
}

export function evaluateDuplicateFlags(candidates) {
  const byId = new Map();
  const exactGroups = new Map();
  const nearGroups = [];

  for (const candidate of candidates || []) {
    byId.set(String(candidate?.id || ""), {
      duplicate_exact: false,
      duplicate_near: false,
    });
    const normalized = normalizeText(candidate?.text);
    if (!normalized) continue;
    const group = exactGroups.get(normalized) ?? [];
    group.push(String(candidate?.id || ""));
    exactGroups.set(normalized, group);
  }

  for (const ids of exactGroups.values()) {
    if (ids.length < 2) continue;
    nearGroups.push(ids);
    for (const id of ids) {
      const record = byId.get(id);
      if (record) record.duplicate_exact = true;
    }
  }

  return {
    byId,
    exactGroups: Array.from(exactGroups.values()).filter(ids => ids.length > 1),
    nearGroups,
  };
}

export function evaluateQualityFlags(candidate, context = {}) {
  const nowSec = toUnixSeconds(context.nowSec) || Math.floor(Date.now() / 1000);
  const duplicateFlags = context.duplicateFlags?.byId ?? context.duplicateFlags ?? new Map();
  const flags = new Set();
  const p0Flags = new Set();
  const p1Flags = new Set();

  const textExists = candidate && Object.hasOwn(candidate, "text");
  const rawText = textExists ? candidate.text : undefined;
  const text = String(rawText ?? "");
  const trimmed = text.trim();
  const normalized = normalizeText(text);
  const pathFamily = candidate?.path_family || getPathFamily(candidate?.path);
  const category = String(candidate?.category || "").trim().toLowerCase();
  const ageDays = getAgeDays(candidate, nowSec);

  const addP0 = flag => {
    flags.add(flag);
    p0Flags.add(flag);
  };
  const addP1 = flag => {
    flags.add(flag);
    p1Flags.add(flag);
  };

  if (!textExists || rawText === null) addP0(p0PerMemoryFlags.missing_content);
  if (textExists && trimmed.length === 0) addP0(p0PerMemoryFlags.content_empty);
  if (trimmed.length > 0 && normalized.length < 20) addP0(p0PerMemoryFlags.content_too_short);
  if (trimmed.length > 4000) addP1(p1PerMemoryFlags.content_too_long);
  if (trimmed.length > 0 && hasTimestampPollution(text)) addP0(p0PerMemoryFlags.timestamp_pollution);
  if (trimmed.length > 0 && hasRawLogLeak(text)) addP0(p0PerMemoryFlags.raw_log_leak);
  if (trimmed.length > 0 && hasDebugNoise(text)) addP0(p0PerMemoryFlags.debug_noise);

  if (!category) addP0(p0PerMemoryFlags.missing_category);
  else if (!KNOWN_CATEGORIES.has(category)) addP0(p0PerMemoryFlags.unknown_category);
  if (category && isCategoryPathMismatch(pathFamily, category)) {
    addP0(p0PerMemoryFlags.category_path_mismatch);
  }

  if (duplicateFlags.get?.(candidate?.id)?.duplicate_exact) addP0(p0PerMemoryFlags.duplicate_exact);
  if (duplicateFlags.get?.(candidate?.id)?.duplicate_near) addP1(p1PerMemoryFlags.duplicate_near);
  if (Number(candidate?.conflict_flag || 0) === 1) addP0(p0PerMemoryFlags.conflict_flagged);
  if (!candidate?.has_confidence_record) addP0(p0PerMemoryFlags.chunks_without_confidence);
  if (trimmed.length > 0 && isTooGeneric(text)) addP0(p0PerMemoryFlags.too_generic);

  evaluateUtilityFlags(candidate, p1Flags, ageDays);
  for (const flag of p1Flags) flags.add(flag);

  return {
    path_family: pathFamily,
    age_days: ageDays,
    flags: Array.from(flags),
    p0_flags: Array.from(p0Flags),
    p1_flags: Array.from(p1Flags),
  };
}
