export function classifyKgSqliteId(value) {
  if (value === null) return { storage_class: "null", text: false };
  if (Buffer.isBuffer(value)) return { storage_class: "blob", text: false };
  if (typeof value === "string") return { storage_class: "text", text: true };
  return { storage_class: typeof value, text: false };
}

function summarizeIds(rows, key) {
  if (!Array.isArray(rows)) return null;
  const summary = {
    total_count: rows.length,
    text_count: 0,
    non_text_count: 0,
    storage_classes: {
      text: 0,
      blob: 0,
      null: 0,
      other: 0,
    },
  };

  for (const row of rows) {
    const classification = classifyKgSqliteId(row?.[key]);
    if (classification.text) {
      summary.text_count += 1;
      summary.storage_classes.text += 1;
      continue;
    }

    summary.non_text_count += 1;
    if (classification.storage_class === "blob") summary.storage_classes.blob += 1;
    else if (classification.storage_class === "null") summary.storage_classes.null += 1;
    else summary.storage_classes.other += 1;
  }

  return summary;
}

export function evaluateKgTextIdInvariant({ engineRows, coreRows } = {}) {
  const engine = summarizeIds(engineRows, "chunk_id");
  const core = summarizeIds(coreRows, "id");

  if (!engine || !core) {
    return {
      passed: false,
      engine: engine || {
        total_count: 0,
        text_count: 0,
        non_text_count: 0,
        storage_classes: { text: 0, blob: 0, null: 0, other: 0 },
      },
      core: core || {
        total_count: 0,
        text_count: 0,
        non_text_count: 0,
        storage_classes: { text: 0, blob: 0, null: 0, other: 0 },
      },
      reason: "invalid_id_snapshot",
    };
  }

  const engineFailed = engine.non_text_count > 0;
  const coreFailed = core.non_text_count > 0;
  let reason = "text_id_invariant_passed";
  if (engineFailed && coreFailed) reason = "engine_and_core_non_text_id";
  else if (engineFailed) reason = "engine_non_text_id";
  else if (coreFailed) reason = "core_non_text_id";

  return {
    passed: !engineFailed && !coreFailed,
    engine,
    core,
    reason,
  };
}

export function resolveKgAccessDecision({ isolatedKgCapability, invariant } = {}) {
  const requested = isolatedKgCapability === true;
  if (!requested) {
    return {
      requested: false,
      mode: "legacy",
      fallback_reason: "capability_disabled",
    };
  }
  if (!invariant?.passed) {
    return {
      requested: true,
      mode: "legacy",
      fallback_reason: "text_id_invariant_failed",
    };
  }
  return {
    requested: true,
    mode: "isolated",
    fallback_reason: null,
  };
}
