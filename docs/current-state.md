# memory-engine Public Current State

> This public document does not assert the state of any private OpenClaw deployment.

memory-engine is an experimental project. Git HEAD and release artifacts, not this document, identify a deployed build.

## Public source contracts

- OpenClaw Core storage is read-only from memory-engine; writes to Core-owned data are prohibited.
- The Engine database owns confidence and event lifecycle state.
- External candidates are distinct from managed candidates and do not inherit managed-confidence semantics.
- AutoRecall is disabled by default.
- Retrieval and runtime changes require explicit testing and deployment authorization.

## Offline authority-builder source status

- `current_fact`: commit `c4e74ba3f7014675fe198cb9af13c0a45b2cf117` implements the deterministic, single-entry, fail-closed Candidate-Builder Harness under `bin/prepare-runtime-authority.cjs` and `lib/runtime-authority/`.
- `current_fact`: the committed CLI exposes only `dry-run --plan`, `prepare --plan`, and `verify --authority`; it includes exact plan binding, path brokering, tool-chain identity, namespace isolation, deterministic candidate/R0 archives, one-shot claims, host before/after stability evidence, and self-binding verification.
- `current_fact`: synthetic production verification passed before the implementation commit: harness tests `71/71`, documentation tests `14/14`, static check `612` files, and full suite `1832` total / `1824` passed / `0` failed / `8` skipped.
- `accepted_design`: any real-plan use remains separately authorized. A read-only dry-run does not authorize `prepare`, candidate publication, runtime installation, configuration or service mutation, tag, push, or rollout.
- `historical_record`: the harness threat model incorporates prior stopped attempts involving path truncation, wrong npm cwd/prefix, prohibited exploratory reads, and non-reproducible custom sentinels. Those attempts are not current runtime state.

## Verification boundary

This document records public source contracts only. Deployment state, runtime health, configuration, database contents, session state, and evidence belong to separately authorized verification records. No local installation or runtime claim should be inferred from this document.
