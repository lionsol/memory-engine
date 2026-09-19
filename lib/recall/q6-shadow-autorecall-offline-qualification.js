import { explainAutoRecallSkip } from "../../auto-recall.js";
import {
  createCandidateDisclosureEvaluationEnvelopeV2,
  validateCandidateDisclosureEnvelopeV2Fixture,
} from "./disclosure/candidate-disclosure-evaluation-envelope-v2.js";
import { evaluateShadowDisclosure } from "./disclosure/disclosure-capability-shadow-evaluator.js";
import { selectDisclosureCandidates } from "./disclosure/disclosure-selector.js";

export const Q6_OFFLINE_QUALIFICATION_SCHEMA_V1 =
  "memory_engine_q6_shadow_autorecall_offline_qualification_v1";

function ratio(numerator, denominator) {
  if (!denominator) return null;
  return Number((numerator / denominator).toFixed(4));
}

function emptyConfusion() {
  return {
    true_positive: 0,
    false_positive: 0,
    true_negative: 0,
    false_negative: 0,
  };
}

function finalizeConfusion(confusion) {
  const selected = confusion.true_positive + confusion.false_positive;
  const expected = confusion.true_positive + confusion.false_negative;
  const negatives = confusion.true_negative + confusion.false_positive;
  return {
    ...confusion,
    selected_count: selected,
    precision: ratio(confusion.true_positive, selected),
    recall: ratio(confusion.true_positive, expected),
    specificity: ratio(confusion.true_negative, negatives),
  };
}

function boundedFamily(value) {
  const family = String(value || "").trim();
  return family.slice(0, 96) || "unknown";
}

function evaluateStructuralRows(rows = []) {
  const result = {
    row_count: 0,
    expected_yes_count: 0,
    expected_no_count: 0,
    expected_yes_structural_skip_count: 0,
    expected_no_structural_skip_count: 0,
    expected_yes_search_eligible_count: 0,
    expected_no_search_eligible_count: 0,
    expected_yes_search_eligibility_recall: null,
    expected_no_structural_suppression_rate: null,
    by_family: {},
    invalid_rows: [],
  };

  if (!Array.isArray(rows)) {
    result.invalid_rows.push({ index: null, reason: "rows_not_array" });
    return result;
  }

  rows.forEach((row, index) => {
    const prompt = typeof row?.prompt === "string" ? row.prompt : "";
    const expected = row?.expected_should_recall;
    if (!prompt.trim() || typeof expected !== "boolean") {
      result.invalid_rows.push({ index, reason: "invalid_row" });
      return;
    }
    result.row_count += 1;
    const family = boundedFamily(row.family);
    const familyMetrics = result.by_family[family] ??= {
      expected_yes_count: 0,
      expected_no_count: 0,
      expected_yes_structural_skip_count: 0,
      expected_no_structural_skip_count: 0,
    };
    const skipReason = explainAutoRecallSkip(prompt);
    const skipped = Boolean(skipReason);
    if (expected) {
      result.expected_yes_count += 1;
      familyMetrics.expected_yes_count += 1;
      if (skipped) {
        result.expected_yes_structural_skip_count += 1;
        familyMetrics.expected_yes_structural_skip_count += 1;
      } else {
        result.expected_yes_search_eligible_count += 1;
      }
    } else {
      result.expected_no_count += 1;
      familyMetrics.expected_no_count += 1;
      if (skipped) {
        result.expected_no_structural_skip_count += 1;
        familyMetrics.expected_no_structural_skip_count += 1;
      } else {
        result.expected_no_search_eligible_count += 1;
      }
    }
  });

  result.expected_yes_search_eligibility_recall = ratio(
    result.expected_yes_search_eligible_count,
    result.expected_yes_count,
  );
  result.expected_no_structural_suppression_rate = ratio(
    result.expected_no_structural_skip_count,
    result.expected_no_count,
  );
  return result;
}

function expectedCard(candidate) {
  return candidate?.label?.expected_disclosure === "CARD";
}

function selectedBySelector(candidate) {
  const adapted = createCandidateDisclosureEvaluationEnvelopeV2(candidate);
  return selectDisclosureCandidates([adapted.envelope])[0]?.decision === "DISCLOSE_CARD";
}

function selectedByCapabilityShadow(candidate) {
  return evaluateShadowDisclosure(candidate).shadow_disclosure === "CARD";
}

function evaluateDisclosurePath(candidates, predicate) {
  const confusion = emptyConfusion();
  let unsafeSelected = 0;
  let irrelevantSelected = 0;
  for (const candidate of candidates) {
    const expected = expectedCard(candidate);
    const selected = predicate(candidate);
    if (expected && selected) confusion.true_positive += 1;
    else if (!expected && selected) confusion.false_positive += 1;
    else if (!expected && !selected) confusion.true_negative += 1;
    else confusion.false_negative += 1;

    if (selected && candidate?.label?.safe_to_disclose === false) unsafeSelected += 1;
    if (selected && candidate?.label?.answer_bearing !== true) irrelevantSelected += 1;
  }
  return {
    ...finalizeConfusion(confusion),
    unsafe_selected_count: unsafeSelected,
    irrelevant_selected_count: irrelevantSelected,
  };
}

function evaluateDisclosureRows(rows = []) {
  const validation = validateCandidateDisclosureEnvelopeV2Fixture(rows);
  if (!validation.valid) {
    return {
      valid: false,
      validation,
      row_count: Array.isArray(rows) ? rows.length : 0,
      candidate_count: 0,
      expected_card_count: 0,
      expected_none_count: 0,
      selector_only: finalizeConfusion(emptyConfusion()),
      capability_constrained_component: finalizeConfusion(emptyConfusion()),
    };
  }

  const candidates = rows.flatMap(row => row.candidates);
  const expectedCardCount = candidates.filter(expectedCard).length;
  const families = [...new Set(rows.map(row => boundedFamily(row.family)))];
  const byFamily = Object.fromEntries(families.map(family => {
    const familyCandidates = rows
      .filter(row => boundedFamily(row.family) === family)
      .flatMap(row => row.candidates);
    const familyExpectedCardCount = familyCandidates.filter(expectedCard).length;
    return [family, {
      candidate_count: familyCandidates.length,
      expected_card_count: familyExpectedCardCount,
      expected_none_count: familyCandidates.length - familyExpectedCardCount,
      selector_only: evaluateDisclosurePath(familyCandidates, selectedBySelector),
      capability_constrained_component: evaluateDisclosurePath(
        familyCandidates,
        selectedByCapabilityShadow,
      ),
    }];
  }));
  return {
    valid: true,
    validation,
    row_count: rows.length,
    candidate_count: candidates.length,
    expected_card_count: expectedCardCount,
    expected_none_count: candidates.length - expectedCardCount,
    selector_only: evaluateDisclosurePath(candidates, selectedBySelector),
    capability_constrained_component: evaluateDisclosurePath(
      candidates,
      selectedByCapabilityShadow,
    ),
    by_family: byFamily,
  };
}

export function evaluateQ6ShadowAutoRecallOfflineQualificationV1({
  autoRecallPolicyRows = [],
  selectiveRecallRows = [],
  disclosureRows = [],
} = {}) {
  const autoRecallPolicy = evaluateStructuralRows(autoRecallPolicyRows);
  const selectiveRecall = evaluateStructuralRows(selectiveRecallRows);
  const disclosure = evaluateDisclosureRows(disclosureRows);

  const structuralValid = (
    autoRecallPolicy.invalid_rows.length === 0 &&
    selectiveRecall.invalid_rows.length === 0
  );
  const mechanismEvidenceRequired = true;

  return {
    schema: Q6_OFFLINE_QUALIFICATION_SCHEMA_V1,
    mode: "offline_only",
    runtime_authorized: false,
    evidence_roles: {
      auto_recall_policy: "historical_turn_label_component_diagnostic",
      selective_recall: "historical_turn_label_component_diagnostic",
      disclosure: "synthetic_candidate_component_diagnostic",
    },
    structural: {
      auto_recall_policy: autoRecallPolicy,
      selective_recall: selectiveRecall,
    },
    disclosure,
    conclusions: {
      structural_fixture_valid: structuralValid,
      disclosure_fixture_valid: disclosure.valid,
      structural_expected_yes_false_negative_zero:
        autoRecallPolicy.expected_yes_structural_skip_count === 0 &&
        selectiveRecall.expected_yes_structural_skip_count === 0,
      structural_no_recall_suppression_observed:
        autoRecallPolicy.expected_no_structural_skip_count > 0 ||
        selectiveRecall.expected_no_structural_skip_count > 0,
      selector_only_safe_enough: disclosure.valid
        ? disclosure.selector_only.unsafe_selected_count === 0 &&
          disclosure.selector_only.false_positive === 0
        : false,
      capability_component_matches_expected_disclosure: disclosure.valid
        ? disclosure.capability_constrained_component.false_positive === 0 &&
          disclosure.capability_constrained_component.false_negative === 0
        : false,
      live_end_to_end_quality_established: false,
      production_prevalence_established: false,
      mechanism_equivalence_requires_q6_source_tests: mechanismEvidenceRequired,
      fresh_fixture_required: false,
    },
    authority: "OFFLINE ONLY / NOT RUNTIME AUTHORIZED",
    limitations: [
      "turn-level historical labels do not contain retrieved candidates and therefore cannot measure would_inject precision",
      "selector-only disclosure diagnostics omit production DIRECT_CARD canonical, attestation, scope, and owner-audience authority",
      "capability-constrained disclosure diagnostics reuse a historical synthetic capability component and are not a replay of the current production boundary",
      "offline fixture rates are not production prevalence estimates",
    ],
    side_effects: {
      provider_calls: 0,
      network: false,
      db_reads: false,
      db_writes: false,
      lancedb_reads: false,
      lancedb_writes: false,
      runtime_mutation: false,
      config_mutation: false,
      injection: false,
      reinforcement: false,
    },
  };
}
