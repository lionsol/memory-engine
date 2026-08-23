# Memory Projection Product Interpretation v1

Status: `D.3-C PRODUCT INTERPRETATION ACCEPTED / D.3-D ENTRY APPROVED FOR DIRECT_CARD SOURCE MIGRATION ONLY`

Decision date: 2026-08-23

Scope: docs/OpenSpec-only architecture decision. This record accepts the
D.3-C evidence and opens a bounded product-entry decision for a future
`DIRECT_CARD` source migration. It is not source implementation, deployment,
runtime activation, or runtime/data execution authorization. No
`D.3-C.17` is created.

## 1. C.16 adjudication

`D.3-C.16 = PASS / FIRST-RUN EVIDENCE ACCEPTED`.

The accepted interpretation is:

> `INTERNAL_AGENT_CONTEXT` bounded extractive representation independently
> generalized across the frozen C.14 synthetic families when caller-supplied
> source ranges are already correct.

The one-shot first run measured:

| Evidence axis | Result |
| --- | ---: |
| Projection success | 12/12 |
| Projection valid | 12/12 |
| Boundedness | 12/12 |
| Source faithful | 12/12 |
| Answer-bearing semantic preservation | 6/6 |
| Instruction-like representation valid | 2/2 |
| Risk metadata preservation | 12/12 |
| Provenance preservation | 12/12 |
| No capability authority | 12/12 |
| Useful answer-bearing internal projection | 6/6 |

This is independent representation evidence. It does not prove automatic
`[start,end)` range selection, `INTERNAL_CONTEXT` capability, prompt
isolation, production eligibility, or runtime readiness.

The source report remains immutable:
`reports/internal-agent-context-holdout-v1-first-run-20260823.md`.

## 2. Product decision matrix

Representation feasibility and authorization remain separate. The disposition
below is the product interpretation of the available evidence, not a runtime
rollout plan.

### DIRECT_CARD

**Disposition:** `ENTER_D3D_SOURCE_MIGRATION`

Basis:

- C.3 `direct_safe`: projection valid `4/4`, surface safe `4/4`, answer-bearing
  semantics preserved `2/2`, and useful + CARD-authorized answer-bearing
  cases `2/2`.
- D.2 capability shadow: unsafe card disclosure `23 -> 0`, while
  answer-bearing disclosure recall remained `0.75`.

`DIRECT_CARD` is currently the only strategy with both representation evidence
and `CARD_DISCLOSABLE` authorization evidence. The entry is limited to
`CARD_DISCLOSABLE` plus a validated `DISCLOSURE_CARD` and the safe direct-card
path. Capability-blocked representation must not be converted into disclosure.

### REDACTED_CARD

**Disposition:** `HOLD / RESEARCH_ONLY`

C.8 independently measured transform `12/12`, safe `12/12`, and answer-bearing
semantic preservation `6/6`. C.9-C.11 nevertheless establish that there is
currently no production literal-level redaction authority source. The missing
boundaries are authenticated evidence origin, a production
`AuthorizedRedactionPlan` authority, conflict/resolution implementation,
completeness/coverage semantics, and a production integration decision.

Successful redaction is representation evidence; it is not
`CARD_DISCLOSABLE` authorization. `REDACTED_CARD` does not enter D.3-D source
migration.

### INTERNAL_AGENT_CONTEXT

**Disposition:** `HOLD / RESEARCH_ONLY`

C.16 is accepted as an independent representation PASS, but three authority
boundaries remain open:

1. **Segment Selection Authority.** A production owner must define who
   generates `[start,end)` and how answer-bearing selection is established
   without caller/test gold ranges.
2. **INTERNAL_CONTEXT Capability.** Useful representation does not grant a
   capability. The current raw-log/tool-output expected capability remains
   `RETRIEVAL_ONLY`; C.16 does not upgrade it.
3. **Runtime Consumer Isolation.** The `untrusted_evidence` marker is not
   prompt isolation. A dedicated consumer wrapper, system/developer/tool
   separation, recalled instruction-like data isolation, and a consumer-side
   trust boundary are still unimplemented and unverified.

`INTERNAL_AGENT_CONTEXT` must not be connected to the production AutoRecall
prompt by this decision.

### REFERENCE_ONLY

**Disposition:** `DEFER / RESEARCH_ONLY`

The strategy remains available in the taxonomy, but there is no independent
product evidence requiring production integration. `REFERENCE_ONLY` must not
be conflated with `RAW_REFERENCE`.

### SUMMARIZED_CARD

**Disposition:** `DEFER / RESEARCH_ONLY`

There is no independent evaluation for this strategy. It is not a default
production fallback for `raw_log` or `tool_output`.

### RAW_REFERENCE / RAW_DISCLOSABLE

**Disposition:** `RESERVED / DISABLED`

`RAW_REFERENCE` remains unimplemented and `RAW_DISCLOSABLE` does not enter the
current D.3-D decision.

## 3. Actual production-path inspection

The current production AutoRecall path is still the legacy card-first path:

```text
lib/recall/auto-recall-hook-lifecycle.js
  -> formatAutoRecallCardContext()

auto-recall.js
  -> buildAutoRecallCardContext()
  -> projectCandidateToMemoryCard()
  -> isInjectableMemoryCard()
```

This path uses legacy Memory Card policy/get semantics. It does not use the
D.3 `ProjectionArtifact`, the new disclosure capability boundary, or
`selectDisclosureCandidates()`.

The D.3 production symbols are currently offline/test-side only:

- `selectDisclosureCandidates()` has no production caller;
- `createRecallCandidateEnvelope()` has no production caller; and
- `projectCanonicalMemoryToDisclosureCardArtifact()` has no production caller.

Therefore D.3-D is a migration of the existing legacy card-first source path
to the new authority boundary. It is not replacement of an already-production-
wired D.3 selector.

## 4. D.3-D entry decision

The Owner accepted the entry decision on 2026-08-23:

**D.3-D entry is approved for `DIRECT_CARD` source migration only.**

This approval is a product-entry decision. It is not runtime/deployment
authorization and does not authorize source edits, AutoRecall enablement,
configuration changes, Gateway operations, EDi, database/data mutation, or
runtime qualification.

The OpenSpec entry statuses are:

| OpenSpec task | Status | Decision |
| --- | --- | --- |
| 4.1 separate Planner/Owner product decision | `[x]` | Accepted; direct-card source migration only |
| 4.2 source migration | `[ ]` | Not started; separately authorized source work required |
| 4.3 runtime/deployment/config/DB/data | `[ ]` | Separate authorization required |
| 4.4 RAW enablement | `[ ]` | Remains out of scope and disabled |

## 5. Frozen first production target

The first source migration target is `DIRECT_CARD` only:

```text
Hybrid / gated recall candidates
        ↓
Canonical Memory authority
        ↓
DISCLOSURE_CARD ProjectionArtifact
        ↓
Projection validation
        ↓
Disclosure Capability
        ↓
CARD_DISCLOSABLE only
        ↓
Disclosure Selector
        ↓
DISCLOSE_CARD
        ↓
AutoRecall card formatter
        ↓
prompt supplement
```

`RETRIEVAL_ONLY` and `INTERNAL_CONTEXT` cannot traverse this direct-card
disclosure path.

## 6. Source-migration contract

Future D.3-D source migration must satisfy all of the following:

- canonical semantics come from Canonical Memory;
- the path uses a `DISCLOSURE_CARD` `ProjectionArtifact`;
- the projection contains no permission authority;
- capability decides `CARD_DISCLOSABLE`;
- the selector emits `DISCLOSE_CARD` or `WITHHOLD`; and
- the formatter consumes only the selected card.

Legacy `disclosure_level`, `can_inject_card`, and `get_token` must not remain
the new D.3 authorization authority. The `DISCLOSURE_CARD` ProjectionArtifact
payload does not contain `get_token`; it must not be added for formatter
compatibility.

The migration is fail-closed. Any canonical read failure, invalid projection,
missing capability evidence, capability other than `CARD_DISCLOSABLE`, or
selector `WITHHOLD` must produce `WITHHOLD`. It must not fall back to legacy
memory-card injection, raw-text injection, raw content, or `get_token`
authority.

These are source-migration requirements, not implementation performed in this
decision.

## 7. Next bounded candidate

`D.3-D.1 DIRECT_CARD Production Boundary Migration Design` is
`CANDIDATE / NOT AUTHORIZED BY THIS DECISION`.

If separately opened, D.3-D.1 should remain bounded to:

- inspecting the actual legacy card runtime and freezing its exact source call
  graph;
- defining the Canonical Memory acquisition, production capability module,
  and adapter/envelope boundaries;
- defining fail-closed fallback removal and source-migration slices/tests.

The next candidate should prioritize docs/design and an exact source packet.
It must not begin automatically and is not a deployment or runtime stage.

## 8. Immutable evidence and mutation boundary

The following evidence remains immutable and was not changed:

| Evidence | SHA-256 |
| --- | --- |
| `reports/internal-agent-context-holdout-v1-first-run-20260823.md` | `7c77274ac202050b5ac4055ffd46ac457778f8c470b8cd5e0e91737999facac2` |
| `reports/redacted-card-holdout-v1-first-run-20260822.md` | `11146d067c27f3b7780fc040e4fada1dbe3f4e7096e284ea919ca1e8c1f3343a` |
| `reports/memory-projection-holdout-v1-first-run-20260822.md` | `905a493faa025cd3830aab234542f12760491ebe5b3ed9bb6a90ddfc232071ed` |
| C.13 `ProjectionArtifact` source | `293d6862293c51ebacf8430b6cb1560b3105a312a66c57820909c5296ceee98a` |
| C.10 redaction contract | `aa5167e739252b714ba2a8b66b8adecb335eec23148a07c1c0862913f2451142` |
| C.14 fixture | `bc0aaa7e5bca0cb7c77f057c56327250c90b48e652032782e1bdd279f8d11085` |

No holdout was rerun. This decision made no source, fixture, report, runtime,
configuration, Gateway, EDi, database, data, or persistent-state mutation.
Runtime verification is `NOT APPLICABLE`.
