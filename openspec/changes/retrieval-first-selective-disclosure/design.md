## Context

Retrieval identifies possible memories, while disclosure decides what bounded
material may cross into a user/agent-facing surface. Phase A makes that
separation explicit without adding a runtime caller.

## Architecture

```text
query
  -> existing retrieval (out of scope)
  -> Canonical Memory Object
  -> Recall Candidate Envelope
       - canonical identity and safe metadata
       - runtime-only retrieval/evidence fields
       - existing Memory Card projection
  -> admissibility policy
  -> disclosure selector
       - WITHHOLD
       - DISCLOSE_CARD
```

The controller modules are pure and deterministic. They do not open files,
databases, network connections, embeddings, retrieval channels, or runtime
hooks.

## Candidate Envelope

`createRecallCandidateEnvelope({ canonicalMemory, retrievalEvidence,
cardProjection })` requires the exact canonical `memory_id` and
`canonical_id`. The envelope copies only bounded canonical metadata, source
provenance, classification/lifecycle fields, and content hashes. The full
canonical source body is intentionally omitted. Card data is reduced to the
existing card fields; the envelope does not create a second memory object
model or persist anything.

Retrieval evidence is allowlisted to:

```text
rank, sources, channel_count, vector_score, fts_score, rrf_score,
final_score, token_coverage, exact_match, channel_agreement
```

Intent labels, history evidence, and semantic skip decisions are not copied
as retrieval authority.

## Admissibility

`evaluateAdmissibility(candidate)` returns exactly `ALLOW` or `DENY`.
Admissibility uses the canonical identity and projection shape, active
lifecycle state, scope compatibility, bounded risk flags, unsafe artifact
classification, and card policy. It never consults `task_intent`,
`recall_intent`, history regexes, or the none/non-none mapping.

Only active, card-eligible, non-risk-blocked projections can be admissible.
Archived, quarantined, review/stale/deleted states, cross-scope candidates,
raw-log/tool-output/dreaming/sensitive artifacts, and invalid card identity or
full-body leakage are denied.

## Disclosure Selection

`selectDisclosureCandidates(candidates)` preserves retrieval order and emits a
bounded decision record for every candidate. A `DISCLOSE_CARD` record carries
only the sanitized Memory Card. A `WITHHOLD` record carries identity and a
bounded reason, but not canonical content or card content. Insufficient
retrieval evidence is withheld; evidence is a readiness input for selection,
not canonical semantic authority.

There is no `DISCLOSE_RAW` or `AUTO_GET_FULL` outcome. Showing a card does not
trigger retrieval, injection, persistence, citation reinforcement, or any
other side effect.

## Runtime Boundary

No production module imports this controller in Phase A. Tests are the only
callers. Runtime hook integration, policy enablement, and any later
retrieval-first disclosure experiment require a separate owner-authorized
phase.
