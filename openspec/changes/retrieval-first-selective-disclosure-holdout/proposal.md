## Status

Frozen dataset contract only.

This change freezes a synthetic, candidate-level holdout for a future offline
disclosure evaluation. It is not production ready, runtime enabled, or a
validated selector-quality result.

## Purpose

Phase A and Phase B define the candidate envelope, admissibility policy,
disclosure selector, and offline evaluator. A separate holdout must be frozen
before any future evaluator execution so candidate-level disclosure labels are
not fitted to observed selector output.

## Contract

Add Candidate Disclosure Holdout Row v1 with a fixed dataset identity, turn
and family metadata, retrieved candidate evidence, and human disclosure
labels. The fixture contains 48 synthetic turns across twelve families, with
two answer-bearing and two non-answer-bearing turns per family.

The fixture is marked `future_independent_holdout`, but remains unevaluated in
this phase. It is not readiness evidence and grants no runtime authority.

## Non-goals

- No selector, admissibility, envelope, evaluator, or threshold changes.
- No evaluator or selector execution against the fresh fixture.
- No AutoRecall, hook, Gateway, configuration, database, data, or runtime
  integration.
- No retrieval, ranking, channel, topK, embedding, network, LLM, or Memory
  Card runtime behavior.
