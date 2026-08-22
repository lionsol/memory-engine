# Projection Strategy Taxonomy v1

Status: **Accepted Design Direction**

This document records the D.3-C.4 architecture decision after the D.3-C.3
first-run evidence. It is not a current runtime state, an implementation
status, or production-readiness evidence. No projection strategy is implemented
by this decision.

## A. Decision Summary

The responsibility boundary is frozen as:

```text
Projection Strategy = representation transform choice
Capability          = authorization
Selector            = selection
```

Projection decides what representation can be constructed for a target
surface. Capability decides whether that representation is authorized for the
surface. Selector decides which already-authorized candidates are selected.

The prohibited implication is:

```text
projection success
    |
    v
capability upgrade
```

In particular, a safe or useful projection MUST NOT automatically become
`CARD_DISCLOSABLE`. Representation feasibility and permission authority remain
separate evidence and decision axes.

## B. Evidence Basis

D.3-C.3 ran the frozen synthetic 24-row holdout exactly once. The evidence
supports the following bounded claims:

- ProjectionArtifact structural validity was `24/24`.
- Current v1.1 capability expectation consistency was `24/24`.
- The tested current `DISCLOSURE_CARD` representation had a surface-safety
  failure for every `redactable_secret` case (`4/4`).
- The tested current representation had answer-bearing semantic-preservation
  failures in `raw_log` and `tool_output` (`0/2` preserved in each family).
- Four answer-bearing cases had safe/useful representation evidence but no
  `CARD` authority: two `sensitive_source` cases and two
  `capability_blocked` cases.

The run also measured six useful projections among twelve answer-bearing cases,
two CARD-authorized useful projections, and four useful projections blocked by
capability. The complete bounded case evidence remains in
`reports/memory-projection-holdout-v1-first-run-20260822.md`; this decision
does not copy its payloads.

The evidence does **not** support any of the following conclusions:

- capability is universally correct;
- capability must be relaxed;
- all raw logs should be summarized;
- all tool output should become durable memory;
- redaction is already proven safe; or
- production/runtime readiness exists.

## C. Projection Strategy Taxonomy

These names are representation strategies. They are not capability states and
must not be added to the capability state machine.

### `DIRECT_CARD`

Purpose: use a canonical/card representation that is already safe and useful
for the `DISCLOSURE_CARD` surface.

The `direct_safe` evidence supports this strategy for the tested
answer-bearing cases. It does not establish that every direct-safe memory is
universally safe or useful.

### `REDACTED_CARD`

Purpose: remove explicitly forbidden bounded material from a target
representation while attempting to preserve answer-bearing semantic anchors.

D.3-C.3 demonstrates a transformation gap for `redactable_secret`: the
current representation preserved the tested answer semantics but retained
forbidden material. It does not prove that a `REDACTED_CARD` implementation is
already safe.

Any future implementation must independently pass:

- projection validation;
- target-surface safety;
- semantic preservation; and
- capability authorization.

### `SUMMARIZED_CARD`

Purpose: convert detail-heavy or raw representation into a bounded
user-facing summary.

Current status: **RESEARCH CANDIDATE ONLY**. The raw-log and tool-output
semantic-loss evidence does not by itself prove that summarization is the
correct solution.

### `INTERNAL_CONTEXT_PROJECTION`

Purpose: construct a bounded representation for agent reasoning or internal
context, without making it user disclosure.

This strategy does not imply `CARD_DISCLOSABLE`. The current ProjectionArtifact
surface `INTERNAL_AGENT_CONTEXT` remains unimplemented and fail-closed.

### `REFERENCE_ONLY`

Purpose: retain identity, provenance, or referenceability without creating a
user-facing content projection.

This is a candidate for content classes that should remain retrievable or
auditable without being transformed into disclosure cards.

The following names remain prohibited as capability states:

- `SANITIZED_CARD`;
- `PROJECTABLE`; and
- `PROJECTABLE_CARD`.

## D. Family Mapping

| Family | C.3 evidence | Strategy interpretation |
| --- | --- | --- |
| `direct_safe` | Two answer-bearing cases were useful and both were CARD-authorized. | `DIRECT_CARD` is sufficient for the tested answer-bearing cases; this is not a universal safety claim. |
| `redactable_secret` | Projection valid `4/4`; surface safe `0/4`; answer-bearing semantic preservation `2/2`. | A demonstrated `DISCLOSURE_CARD` surface-safety transformation gap. A `REDACTED_CARD` prototype is justified for future offline research; capability is not identified as the root problem. |
| `raw_log` | Surface safe `4/4`; answer-bearing semantic preservation `0/2`. | The current card representation loses answer-bearing semantics. `INTERNAL_CONTEXT_PROJECTION` and/or `SUMMARIZED_CARD` remain research directions; neither is preselected. |
| `tool_output` | Surface safe `4/4`; answer-bearing semantic preservation `0/2`. | A semantic-preservation gap exists, while durable-memory and disclosure eligibility remain unresolved. Candidate directions are `REFERENCE_ONLY` and `INTERNAL_CONTEXT_PROJECTION`; `SUMMARIZED_CARD` requires separate lifecycle/product justification. |
| `sensitive_source` | Two answer-bearing cases were useful, but both remained `INTERNAL_CONTEXT` with no CARD authority. | Representation feasibility and authorization are separable. This is not labeled a capability defect; a future policy review is separate from projection work. |
| `capability_blocked` | Two answer-bearing cases were useful, but CARD authority was denied by lifecycle/cross-scope blockers. | This is the expected architecture case: successful representation does not override authorization. No capability relaxation is implied. |

## E. Authority Boundary

The decision flow is:

```text
Canonical Memory
      |
      v
Projection Strategy
      |
      v
ProjectionArtifact
      |
      v
Validation
      |
      v
Capability Authorization
      |
      v
Selector
```

Canonical Memory remains semantic authority. ProjectionArtifact validation
checks structural, provenance, identity/hash, and target-surface bounds.
Capability remains the authorization boundary. Selector remains selection-only.

A projection strategy may:

- remove content;
- summarize content;
- restructure representation; or
- change the target-surface representation.

A projection strategy may not:

- grant disclosure permission;
- bypass capability;
- change lifecycle authority; or
- change scope authority.

## F. Independent Questions

Projection strategy work and capability work answer different questions:

1. Can a useful and safe representation be produced?
2. Is that representation authorized for this surface?

| Representation outcome | Authorized | Not authorized |
| --- | --- | --- |
| Safe + useful | A: usable representation with permission | B: feasible representation, capability-blocked |
| Safe + semantic-loss | C: authorized but not useful for the answer | D: not useful and not authorized |
| Unsafe | E: permission cannot make unsafe output suitable | F: unsafe and unauthorized |

The taxonomy primarily organizes representation strategies and the first
question. It does not collapse the second question into a strategy name.

## G. Raw Log and Tool Output Boundary

`raw_log` and `tool_output` are not merely “bad card summarization” cases. The
current evidence shows semantic loss in the tested card representation, but it
does not decide the underlying lifecycle or product semantics.

The unresolved product question is whether this material should be:

1. durable canonical memory;
2. internal-only contextual material;
3. reference-only evidence; or
4. eligible for selected user-facing summaries.

This is partly a lifecycle and product-semantics question, not merely a
projection algorithm problem. C.4 therefore does not prescribe a universal
summarizer.

## H. Redaction Authority

Redaction is a projection transform. A future redaction strategy may:

- remove bounded unsafe literals or fields;
- replace unsafe detail with a non-sensitive bounded representation; and
- preserve semantic anchors.

It must not:

- rewrite Canonical Memory source authority;
- mutate Canonical Memory;
- silently change lifecycle, scope, or risk authority; or
- grant CARD capability.

Any future redaction output remains a derived ProjectionArtifact and must pass
the independent validation, safety, semantic, and capability boundaries.

## I. Agent Context Question

`INTERNAL_AGENT_CONTEXT` is already an explicit D.3 surface, but it currently
remains fail-closed and unimplemented. C.3 provides reason to investigate it,
especially for `raw_log` and `tool_output` material.

C.4 does not authorize implementing `INTERNAL_AGENT_CONTEXT`.

## J. Open Questions and Priority

### Open questions

1. **Does redaction belong to projection?** Yes. Redaction is a representation
   transform, not a capability state or canonical-memory mutation.
2. **Does a summary automatically permit disclosure?** No. A summary remains a
   projection until capability separately authorizes its surface.
3. **Does agent context need a separate artifact?** Further research is needed.
4. **Should raw/tool output enter durable memory?** Unresolved; this requires a
   lifecycle and product decision in addition to projection research.

### Recommended research priority

1. **First: `REDACTED_CARD` offline prototype decision.** `redactable_secret`
   gives the cleanest demonstrated representation gap: answer semantics
   survived, while forbidden material also survived.
2. **Second, separately: `INTERNAL_AGENT_CONTEXT` design for `raw_log` and
   `tool_output`.**

These are bounded future decisions, not implementation authorization in C.4.
