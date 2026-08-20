export const RECALL_CANDIDATE_ENVELOPE_SCHEMA_VERSION = 1;

export const ADMISSIBILITY_DECISIONS = Object.freeze({
  ALLOW: "ALLOW",
  DENY: "DENY",
});

export const DISCLOSURE_DECISIONS = Object.freeze({
  WITHHOLD: "WITHHOLD",
  DISCLOSE_CARD: "DISCLOSE_CARD",
});

export const DISCLOSURE_CARD_LEVELS = Object.freeze([
  "memory_card",
  "short_summary",
]);

export const RETRIEVAL_EVIDENCE_KEYS = Object.freeze([
  "rank",
  "sources",
  "channel_count",
  "vector_score",
  "fts_score",
  "rrf_score",
  "final_score",
  "token_coverage",
  "exact_match",
  "channel_agreement",
]);

export const DISCLOSURE_BLOCKING_LIFECYCLE_STATES = Object.freeze([
  "candidate",
  "needs_review",
  "archived",
  "quarantined",
  "deleted_shadow",
  "stale_index_candidate",
]);

export const DISCLOSURE_BLOCKING_RISK_FLAGS = Object.freeze([
  "raw_log_like",
  "tool_output_like",
  "dreaming_artifact",
  "low_confidence",
  "archived",
  "quarantined",
  "stale_index_candidate",
  "conflict_flag",
  "cross_agent_scope",
  "sensitive_source",
]);

export const DISCLOSURE_CARD_FIELDS = Object.freeze([
  "schema_version",
  "card_id",
  "memory_id",
  "title",
  "summary",
  "salience_reason",
  "source_hint",
  "category",
  "kind",
  "confidence_score",
  "risk_flags",
  "disclosure_level",
  "get_token",
]);

export const DISCLOSURE_POLICY_FIELDS = Object.freeze([
  "disclosure_level",
  "can_inject_card",
  "can_get_full_content",
  "can_reinforce_on_citation",
]);

export function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
