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

- `current_fact`: commit `c4e74ba3f7014675fe198cb9af13c0a45b2cf117` is the base implementation of the deterministic, single-entry, fail-closed Candidate-Builder Harness under `bin/prepare-runtime-authority.cjs` and `lib/runtime-authority/`.
- `current_fact`: subsequent committed source fixes preserve prepare failure evidence and resolver-target handling (`24eca45cef3aba5669eade2207a6eaadfc520a2c`), bind candidate native builds to the already-bound Node headers under `/runtime` (`bd39f8d9ba3625f42d447f9edd70451533e3887a`), and apply a closed operation-specific sandbox timeout policy for `npm.ci_candidate` (`97454ee70f47f8fd4421806f4a10100b78e27186`).
- `current_fact`: as of 2026-08-08 the local `main` source authority is `901e7d196b81ee530ea489504a07390d352cf0c5`; commits after `97454ee...` in that lineage are documentation/runtime-gate records, not additional product source changes. `origin/main` remains behind the local authority; push is not implied.
- `current_fact`: the committed CLI exposes only `dry-run --plan`, `prepare --plan`, and `verify --authority`; it includes exact plan binding, path brokering, tool-chain identity, namespace isolation, deterministic candidate/R0 archives, one-shot claims, host before/after stability evidence, and self-binding verification.
- `current_fact`: the closed timeout policy at this source line gives only `npm.ci_candidate` an inner `300000ms` / outer `330000ms` budget; ordinary registered sandbox operations remain `120000ms` / `120000ms`, while the capability probe keeps its separate `120000ms` inner / `30000ms` outer bounds.
- `current_fact`: post-timeout-fix source verification recorded focused timeout/prepare tests `20/20`, production E2E `17/17`, runtime-authority tests `79/79`, static check `614` files, and the Node 24 / Asia-Shanghai full suite `1832` passed / `0` failed / `8` skipped.
- `accepted_design`: any real-plan use remains separately authorized. A read-only dry-run does not authorize `prepare`, candidate publication, runtime installation, configuration or service mutation, tag, push, or rollout.
- `historical_record`: the harness threat model incorporates prior stopped attempts involving path truncation, wrong npm cwd/prefix, prohibited exploratory reads, non-reproducible custom sentinels, native-header ownership failure, and earlier sandbox-timeout failures. Those records must not be promoted to current deployment state.

## Verification boundary

This document records public source contracts only. Deployment state, runtime health, configuration, database contents, session state, and evidence belong to separately authorized verification records. No local installation or runtime claim should be inferred from this document.
