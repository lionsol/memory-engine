## Status

Phase D.1 evaluation contract closure only.

This change supplies canonical/admissibility context to a future offline
candidate-level disclosure evaluation. It is not a selector improvement,
production security fix, runtime change, or deployment authorization.

## Problem

The Phase C holdout contained retrieval evidence and disclosure labels but did
not contain the canonical lifecycle, scope, risk, artifact, and projection
inputs required to reproduce the existing admissibility policy. The first
evaluation therefore could not adjudicate selector quality.

## Proposal

Define Candidate Disclosure Evaluation Envelope v2. Each candidate carries a
bounded `canonical_context` in addition to retrieval evidence and labels. A
pure offline adapter maps that context to the existing Recall Candidate
Envelope without modifying production envelope, admissibility, or selector
code. Add a separate 48-row v2 fixture and static validation tests.

## Non-goals

- No disclosure selector, admissibility policy, retrieval, ranking, or
  candidate-envelope production changes.
- No v2 fixture evaluation in this phase.
- No AutoRecall, hook, Gateway, configuration, database, data, or runtime
  integration.
- No threshold tuning, policy changes, deployment, or runtime qualification.
