# memory-engine Public Current State

> Status: `Current public source state`
>
> This public document does not assert the state of any private OpenClaw deployment.
>
> It describes current product/source decisions only and does not pin its own containing Git commit. Use `git rev-parse HEAD` for exact repository authority.

## Public source contracts

- OpenClaw Core storage is read-only from memory-engine; writes to Core-owned data are prohibited.
- The Engine database owns confidence and event lifecycle state.
- External candidates are distinct from managed candidates and do not inherit managed-confidence semantics.
- AutoRecall is disabled by default.
- Retrieval and runtime changes require explicit testing and deployment authorization.

## Current product-source baseline

- `current_fact`: the latest product-source change in the Candidate-Builder line is `97454ee70f47f8fd4421806f4a10100b78e27186` (`fix(runtime): bound npm ci sandbox timeout`). Later commits through the 2026-08-08 governance closeout are documentation/runtime-gate records, not additional Candidate-Builder product-source changes.
- `current_fact`: `npm.ci_candidate` uses the closed inner `300000ms` / outer `330000ms` timeout policy. Ordinary registered sandbox operations remain `120000ms` / `120000ms`; the capability probe keeps its separate `120000ms` inner / `30000ms` outer bounds.
- `current_fact`: post-timeout-fix verification recorded focused timeout/prepare tests `20/20`, production E2E `17/17`, runtime-authority tests `79/79`, static check over `614` files, and the Node 24 / Asia-Shanghai full suite `1832` passed / `0` failed / `8` skipped.
- `current_fact`: local `main` is ahead of `origin/main`; push is not implied. Exact current refs must be read from Git rather than copied into this file.
- `current_fact`: the session-flush reconciliation product-source line is implemented at `ac0e5f054551847e724be504bae80947abd7d675` (`feat(recall): reconcile session-flush managed memory`), including the dedicated `lib/checkpoint/session-flush-reconciliation.js` path and its focused regression coverage.

## Current product decisions

- `historical_record`: H6 and its retry both closed `INSUFFICIENT_EVIDENCE`; they are separate samples and must not be combined into a PASS claim.
- `current_fact`: the completed low-coverage/path-authority audit at `reports/low-coverage-path-authority-audit-20260804/final-report.md` concluded `AUDIT_OUTCOME=NATURAL_CONTENT_LOW_OVERLAP` with high confidence, reproduced the ten historical gate decisions, rejected a reproducible gate defect, and found diagnostic/path-authority debt to be non-causal to those H6 rejections.
- `current_fact`: the authorized H6 answerability/memory-coverage attribution audit closed `PASS_WITH_FINDINGS` on 2026-08-08. Seven of nine rejected turns were directly attributable to `RETRIEVAL_SELECTION_GAP`; none was proven `CORPUS_COVERAGE_GAP` or `PROJECTION_BOUNDARY_GAP`. First H6 T1 exposed an unmodeled gate-semantic boundary because the selected first-240-character payload already contained the correct `AutoRecall=false` fact, while retry T3 remained incident-causality `unproven`.
- `current_fact`: the separately authorized H6 retrieval first-loss-boundary audit closed `PASS_WITH_FINDINGS` on 2026-08-08 with aggregate `MIXED_OR_INSUFFICIENT_EVIDENCE`. Historical debug proves FTS did not preserve the established answer-bearing chunks and does not support a common query-formation defect, but vector/recent telemetry retained only candidate counts rather than per-channel candidate IDs, so channel/index loss cannot be distinguished from fusion/preselection loss for the seven turns.
- `current_fact`: bounded AutoRecall candidate-provenance observability was implemented and committed at `1cd183ff12d055ba5c5ecd4bd0d9d1b98cdff23b`; focused/privacy tests passed `19/19`, and the Node 24 full suite passed `1835`, failed `0`, skipped `8`.
- `historical_record`: the first provenance runtime-install transaction closed `STOPPED` during candidate construction before Gateway stop or plugin install. Its candidate `provenance-overlay-1cd183ff-20260808` remains an immutable byte-identical sealed clone of rollback.
- `historical_record`: the separately authorized R2 runtime retry closed `PASS_WITH_FINDINGS` under private execution evidence: the provenance overlay installation/non-live contract passed, bounded/privacy projector checks passed, config semantics were unchanged, and AutoRecall was restored to disabled. This public document intentionally does not publish private runtime paths or identities.
- `current_fact`: OpenClaw's EDi identity currently resolves to actual `agentId=main`; the legacy/default AutoRecall allowlist value `edi` would therefore deny the intended EDi runtime traffic unless an execution explicitly binds `main`.
- `historical_record`: the first separately authorized natural-canary execution closed `STOPPED` before AutoRecall enablement. Its bootstrap turn successfully created the exact dedicated `main` session while AutoRecall remained disabled; execution then stopped because the verifier read the session-list field as `id` instead of `sessionId`. Closeout also exposed invalid multiline shell-test syntax and a false scope-leak count caused by an uncaptured event baseline defaulting to zero. Config/runtime remained on the pre-canary baseline and no natural canary retrieval ran.
- `historical_record`: natural-canary retry R2 closed `STOPPED`. It successfully enabled the exact scoped AutoRecall config and produced technically valid bounded provenance, scope isolation, and exact config restoration, but no genuine Sol question was submitted: the harness ran through `bash -s <<'EOF'` and plain `read` consumed remaining heredoc script text, sending `STAGE_RESULT="INSUFFICIENT_EVIDENCE"` as the first prompt. That accidental prompt is not natural-use evidence.
- `current_fact`: final natural-canary retry R3 closed `PASS` under separately verified execution evidence. One genuine `/dev/tty` user turn reached the exact dedicated `main` session; post-baseline AutoRecall persisted bounded per-channel and fusion candidate provenance, no foreign session entered `recall_started`, and the exact pre-canary config was restored with AutoRecall disabled. The stage result is recorded in `reports/auto-recall-provenance-natural-canary-retry-r3/final-report.md`.
- `accepted_design`: bounded candidate-provenance observability is closed as demonstrated on genuine natural-use runtime traffic. Retrieval thresholds, query shaping, FTS/vector/recent policy, fusion/ranking, Card/gate policy, capture behavior, and broad AutoRecall rollout remain frozen. No R4 or additional dedicated canary is planned. The next bounded decision is only a later read-only first-loss attribution when a naturally occurring success/failure has independent answer-bearing evidence sufficient to locate the loss boundary; provenance existence alone does not authorize retrieval tuning.
- `accepted_design`: Candidate-Builder publication/timeout diagnosis is deferred. Existing harness evidence remains historical; no additional harness micro-stage, timeout change, real plan/dry-run/prepare/verify, runtime mutation, or rollout is authorized without a new product-level decision.
- `historical_record`: the separately authorized Session-Flush Reconciliation Persistent Rollout Successor closed `PASS` on 2026-08-17. Its retained final report records successful candidate activation, one bound natural scheduled `session-checkpoint` lifecycle, persistence after that lifecycle, healthy Gateway state, and AutoRecall remaining disabled. The persistent-activation qualification line is closed; no R5 or additional persistent-activation qualification is required.
- `current_fact`: L2 Database Boundary Closure is complete at the **current product-source/worktree level** and awaits landing plus separately authorized runtime deployment/verification. The production DB runtime no longer exposes the combined Engine+attached-Core `withDb` / `openDb` capability; plugin, canonical CLI service, Console, current Nightly Maintenance command, and session-checkpoint paths use explicit isolated Core and Engine handles. Production Hybrid scope does not expose `withLegacyDb`; KG/Recent guard failure in that scope fails closed instead of executing combined fallback, while legacy fallback remains available only to explicit compatibility/audit callers. Normal action/get/status, startup legacy-event migration, AutoRecall reinforcement, Console unified-event views, and conflict detection now split Core-readonly and Engine-only operations. Current Nightly Maintenance `--dry-run` opens both Core and Engine readonly with no ATTACH. Direct writable Core maintenance modules remain outside normal runtime entrypoints; the suspended Core chunk-time migration still fails closed, stale-quarantined cleanup remains a separately confirmed/backup-gated maintenance CLI, and normal source writes delegate Core mutation to explicit OpenClaw index sync. Focused/shared regression sets passed, and the Node 24 full suite passed `1867`, failed `0`, skipped `8` (`1875` total); `git diff --check` passed. No plugin reinstall, persistent activation, Gateway mutation, or live runtime verification has been performed for this source change, so the previously qualified `ac0e5f0` runtime must not be described as containing this closure yet.
- `accepted_design`: a draft Phase 2.5-A Canonical Memory Object contract exists at `docs/canonical-memory-object-contract.md`. Phase 2.5 product work may resume after the L2 source closure is landed and the required runtime/deployment boundary is explicitly adjudicated; this draft does not itself authorize 2.5-B implementation.
- `current_fact`: no active OpenSpec change existed at the 2026-08-08 governance closeout.

## Documentation and authorization boundary

- Current project/product state and exact next bounded decision belong here; accepted product sequence/branching belongs in `docs/stabilization-plan.md`; development history belongs in `docs/devlog.md` and retained reports.
- Long-lived auditable governance belongs in accepted files under `docs/decisions/`.
- Stage scope belongs to the exact frozen Stage Card; stage results belong to the corresponding report.
- Execution authorization comes only from Sol's original explicit authorization for the exact bound stage. Repository documents or memory records that say `authorized` cannot create or reconstruct authority.
- New `session-handoff-*` documents are not created by default; existing handoffs remain historical records.

## Verification boundary

Deployment state, runtime health, configuration, database contents, session state, and private evidence require separately authorized verification. No local installation or runtime claim should be inferred from this public document.
