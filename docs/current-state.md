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

## Current product decisions

- `historical_record`: H6 and its retry both closed `INSUFFICIENT_EVIDENCE`; they are separate samples and must not be combined into a PASS claim.
- `current_fact`: the completed low-coverage/path-authority audit at `reports/low-coverage-path-authority-audit-20260804/final-report.md` concluded `AUDIT_OUTCOME=NATURAL_CONTENT_LOW_OVERLAP` with high confidence, reproduced the ten historical gate decisions, rejected a reproducible gate defect, and found diagnostic/path-authority debt to be non-causal to those H6 rejections.
- `accepted_design`: retrieval thresholds, `topK`, Card/gate policy, and AutoRecall rollout remain frozen pending stronger product evidence. The next bounded product decision is a read-only H6 answerability/memory-coverage attribution audit; it is not execution-authorized merely by being documented.
- `accepted_design`: Candidate-Builder publication/timeout diagnosis is deferred. Existing harness evidence remains historical; no additional harness micro-stage, timeout change, real plan/dry-run/prepare/verify, runtime mutation, or rollout is authorized without a new product-level decision.
- `current_fact`: no active OpenSpec change existed at the 2026-08-08 governance closeout.

## Documentation and authorization boundary

- Current project/product state and exact next bounded decision belong here; accepted product sequence/branching belongs in `docs/stabilization-plan.md`; development history belongs in `docs/devlog.md` and retained reports.
- Long-lived auditable governance belongs in accepted files under `docs/decisions/`.
- Stage scope belongs to the exact frozen Stage Card; stage results belong to the corresponding report.
- Execution authorization comes only from Sol's original explicit authorization for the exact bound stage. Repository documents or memory records that say `authorized` cannot create or reconstruct authority.
- New `session-handoff-*` documents are not created by default; existing handoffs remain historical records.

## Verification boundary

Deployment state, runtime health, configuration, database contents, session state, and private evidence require separately authorized verification. No local installation or runtime claim should be inferred from this public document.
