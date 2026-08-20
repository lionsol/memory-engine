## Status

Phase A offline controller only.

This change defines and tests a pure post-retrieval disclosure boundary. It is
not production ready, runtime enabled, or an AutoRecall replacement.

## Why

Retrieval results and user-visible disclosure are different decisions. The
existing Memory Card projection provides a bounded presentation, but Phase A
needs an explicit offline boundary that evaluates candidate admissibility and
selects cards without coupling to retrieval execution, prompt intent, or the
AutoRecall hook.

## What Changes

- Add a read-only Recall Candidate Envelope built from a Canonical Memory
  Object, bounded retrieval evidence, and an existing card projection.
- Add deterministic admissibility checks for lifecycle, scope, risk, unsafe
  artifacts, and projection validity.
- Add a disclosure selector with only `WITHHOLD` and `DISCLOSE_CARD` outcomes.
- Add unit coverage and an OpenSpec contract for the offline-only boundary.

## Non-goals

- No AutoRecall, hook, Gateway, configuration, database, data, or runtime
  integration.
- No retrieval execution, ranking, channel, topK, embedding, network, or LLM
  behavior.
- No task/recall intent classifier, history regex, or semantic skip policy.
- No raw disclosure, automatic full-content get, reinforcement, migration, or
  Memory Card runtime change.
