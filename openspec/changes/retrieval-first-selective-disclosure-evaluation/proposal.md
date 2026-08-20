## Status

Phase B offline evaluation contract only.

This change defines a candidate-level schema validator and evaluator for
post-retrieval disclosure decisions. It is not production ready, runtime
enabled, or an AutoRecall replacement.

## Problem

Phase A establishes a pure candidate envelope, admissibility policy, and
disclosure selector. Those components need an offline contract that can
evaluate a retrieved candidate pool against bounded human labels without
reusing prompt intent or changing runtime retrieval behavior.

## Proposal

Add a versioned JSONL row contract containing the turn context, retrieved
candidates, retrieval evidence, and per-candidate disclosure labels. Validate
the contract before evaluating selector output, report preservation and
utility metrics, and fail the safety gates for unsafe cards or full-content
surfaces.

## Non-goals

- No AutoRecall, hook, Gateway, configuration, database, data, or runtime
  integration.
- No prompt-to-intent or should-recall evaluation.
- No retrieval execution, ranking, channel, topK, embedding, network, or LLM
  behavior.
- No raw disclosure, automatic full-content get, reinforcement, migration, or
  Memory Card runtime change.
- The synthetic fixture is not independent readiness evidence.
