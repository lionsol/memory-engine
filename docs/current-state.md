# memory-engine Public Current State

> This public document does not assert the state of any private OpenClaw deployment.

memory-engine is an experimental project. Git HEAD and release artifacts, not this document, identify a deployed build.

## Public source contracts

- OpenClaw Core storage is read-only from memory-engine; writes to Core-owned data are prohibited.
- The Engine database owns confidence and event lifecycle state.
- External candidates are distinct from managed candidates and do not inherit managed-confidence semantics.
- AutoRecall is disabled by default.
- Retrieval and runtime changes require explicit testing and deployment authorization.

## Verification boundary

This document records public source contracts only. Deployment state, runtime health, configuration, database contents, session state, and evidence belong to separately authorized verification records. No local installation or runtime claim should be inferred from this document.
