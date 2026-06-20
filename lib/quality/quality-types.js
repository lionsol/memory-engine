export const grades = Object.freeze({
  A: "A",
  B: "B",
  C: "C",
  D: "D",
});

export const actions = Object.freeze({
  keep: "keep",
  review: "review",
  dedupe_candidate: "dedupe_candidate",
  repair_candidate: "repair_candidate",
  archive_candidate: "archive_candidate",
});

export const p0PerMemoryFlags = Object.freeze({
  missing_content: "missing_content",
  content_empty: "content_empty",
  content_too_short: "content_too_short",
  timestamp_pollution: "timestamp_pollution",
  raw_log_leak: "raw_log_leak",
  debug_noise: "debug_noise",
  missing_category: "missing_category",
  unknown_category: "unknown_category",
  category_path_mismatch: "category_path_mismatch",
  duplicate_exact: "duplicate_exact",
  conflict_flagged: "conflict_flagged",
  too_generic: "too_generic",
  chunks_without_confidence: "chunks_without_confidence",
});

export const p1PerMemoryFlags = Object.freeze({
  content_too_long: "content_too_long",
  duplicate_near: "duplicate_near",
  never_retrieved: "never_retrieved",
  old_and_unused: "old_and_unused",
});

export const diagnosticsOnlyNames = Object.freeze({
  orphan_confidence: "orphan_confidence",
  confidence_id_format_mismatch: "confidence_id_format_mismatch",
  event_prefix_unmatched: "event_prefix_unmatched",
  event_prefix_ambiguous: "event_prefix_ambiguous",
  cite_signal_sparse: "cite_signal_sparse",
  path_family_unknown: "path_family_unknown",
});
