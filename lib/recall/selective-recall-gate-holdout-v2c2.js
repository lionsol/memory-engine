import {
  createSelectiveRecallGateC2Contract,
  parseSelectiveRecallGateC2Jsonl,
  validateSelectiveRecallGateC2Dataset,
} from "./selective-recall-gate-c2-evaluation.js";

export const SELECTIVE_RECALL_GATE_HOLDOUT_V2C2_FAMILIES = Object.freeze([
  "scope_split_boundary",
  "deictic_resume_boundary",
  "decision_outcome_boundary",
  "preference_lookup_boundary",
  "workflow_authority_boundary",
  "prior_entity_takeaway_boundary",
  "supplied_text_history_boundary",
  "current_evidence_boundary",
  "instruction_lookup_boundary",
  "meta_counterfactual_boundary",
  "fresh_design_state_boundary",
  "temporal_reference_boundary",
]);

export const SELECTIVE_RECALL_GATE_HOLDOUT_V2C2_CONTRACT = createSelectiveRecallGateC2Contract({
  allowed_families: SELECTIVE_RECALL_GATE_HOLDOUT_V2C2_FAMILIES,
});

/**
 * Static-only JSONL parsing and behavioral-shape validation for the frozen C2
 * fixture. This wrapper intentionally has no gate/classifier execution path.
 */
export function parseSelectiveRecallGateHoldoutV2C2Jsonl(content) {
  const parsed = parseSelectiveRecallGateC2Jsonl(content);
  return {
    ...parsed,
    validation: validateSelectiveRecallGateC2Dataset(
      parsed.rows,
      SELECTIVE_RECALL_GATE_HOLDOUT_V2C2_CONTRACT,
    ),
  };
}
