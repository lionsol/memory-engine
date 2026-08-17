# Project Engineering Governance and Authorization Policy

> Status: `Accepted decision`
>
> This document defines project governance. It never grants execution authority by itself.

## Purpose

Keep memory-engine engineering governance proportional to real risk while preventing a diagnostic or verification agent from extending one owner-approved operation into a chain of self-authorized Stage Cards, commits, reproductions, or qualification machinery.

## Authority source

For controlled Level C execution, and any Level B operation that performs owner-authorized persistent runtime/data mutation, only Sol's original explicit authorization for the exact bound operation is authoritative execution provenance.

The following may record or summarize authorization, but cannot create it:

- Stage Cards;
- `docs/current-state.md`;
- `docs/devlog.md`;
- session handoffs;
- reports;
- agent memory;
- later Codex/GPT summaries.

If a controlled operation requires owner execution authorization and that original authorization cannot be verified, treat authority as `UNVERIFIED` and stop.

## Controlled execution binding

A bounded execution packet is required for **Level C high-risk execution** and for any **Level B controlled change that performs an explicitly owner-authorized persistent runtime/data mutation**. Ordinary Level A engineering and non-mutating Level B implementation/test work do not require an execution packet merely because commands or tests are executed.

When controlled execution binding is required, the packet contains at least:

~~~text
STAGE_ID
STAGE_CARD_PATH
STAGE_CARD_COMMIT
AUTHORIZED_REPOSITORY_HEAD
MAX_EXECUTIONS
~~~

Default:

~~~text
MAX_EXECUTIONS=1
~~~

The packet is invalid if any bound value changes before execution. A changed HEAD, edited/recommitted Stage Card, changed scope, or consumed execution count requires a new owner authorization.

Commit authorization and execution authorization are separate. Committing or freezing a Stage Card does not authorize running it.

## Executor boundary

When work is governed by a controlled execution packet, Codex may perform only the operation bound by that packet.

After the authorized execution it must:

1. report evidence and the stage result;
2. identify at most one smallest next decision;
3. stop.

Codex must not create, authorize, or execute a successor controlled Stage as part of the same execution authorization.

GPT reviews the result and may propose the next bounded decision when one is actually needed. Sol separately authorizes any later controlled runtime/data execution. Normal code/document commits follow the repository's ordinary commit policy and do not inherit runtime execution authority.

## Verification anti-drift limit

When a product question actually warrants bounded diagnostic/qualification stages, the diagnosis stage plus one corrective verification stage is the normal maximum.

A proposed third verification substage for that same product question triggers mandatory `STOPPED` drift review. Continuing requires Sol to reopen the work explicitly as a new product-level decision. A tooling or harness defect does not automatically justify another micro-stage.

## Evidence budget and risk levels

Each stage should freeze at most three decision-critical claims. Use one primary evidence source per claim, with at most one independent confirmation when the claim is high risk. Do not stack stdout markers, scheduler summaries, PIDs, parsers, snapshots, child-process markers, and reports when a stronger existing source already proves the decision.

Stop verification when the frozen decision is supported.

Classify work by the smallest risk level that fits the real operation:

- **Level A — Normal Engineering:** small, reversible work without persistent-data or runtime-activation risk. Use inspect → implement → focused tests → applicable review → commit. Do not create a Stage Card by default.
- **Level B — Controlled Change:** medium-risk work affecting a subsystem boundary, persistent-data behavior, or a significant runtime path without reaching high-risk qualification. Use a bounded plan or lightweight Stage Card only when it materially helps scope control, then targeted tests/review and only the runtime evidence needed for the changed behavior.
- **Level C — High-Risk Qualification:** migrations, destructive operations, persistent runtime activation/configuration, authority-boundary changes, difficult rollback, broad AutoRecall rollout, multi-agent visibility/ACL mutation, persistent reconciliation/write-semantics changes, or equivalent production-critical operations. Use an exact Stage Card, controlled execution binding, preflight where relevant, bounded mutation, rollback, owner authorization, and minimum sufficient runtime/data evidence.

Do not promote Level A/B work to Level C merely because a previous stage used Level C machinery. Risk classification follows the current operation, not historical process precedent.

## Failure classification and retry ceiling

Before any retry or successor qualification, classify the first loss:

- `PRODUCT_FAILURE`: product source/design/runtime behavior violated the frozen contract; a product repair may be justified.
- `EVIDENCE_FAILURE`: evidence was missing, truncated, ambiguous, or collected from the wrong source; prefer a stronger existing evidence source rather than product changes.
- `ENVIRONMENT_FAILURE`: host, WSL, provider, or unrelated runtime interruption prevented closure; do not convert it into product architecture.
- `OPERATOR_FAILURE`: command, packet, prompt, shell, or manual execution error prevented closure; fix execution mechanics rather than the product.

When qualification is actually warranted, the normal ceiling for one product question is the initial qualification plus one corrective qualification retry. Repeated evidence, environment, or operator failures require a drift review and should default to `simplify`, `split`, or `stop`, not another numbered retry.

**Retry is not diagnosis.** After a `PRODUCT_FAILURE`, first build the shortest useful feedback loop: reproduce when needed, minimize the failure, form testable hypotheses, instrument only where necessary, identify the first incorrect boundary, fix the root cause, and add regression coverage. `EVIDENCE_FAILURE` should improve or simplify evidence; `ENVIRONMENT_FAILURE` should restore the environment and rerun only if the decision still needs it; `OPERATOR_FAILURE` should fix execution mechanics. A retry that produces no new decision-relevant information is task thrashing.

## Governance-load stop condition

A mandatory drift review is required when any of the following occurs:

- verification work becomes larger than the product change;
- two consecutive qualification stages have no product-source change and only non-product first losses;
- a second rollback is caused by verification machinery rather than the product;
- a new harness mainly exists to prove an older harness;
- persistent product instrumentation is proposed only to make a one-off qualification observable;
- Stage Card/documentation work becomes materially larger than the implementation.

The review must decide `continue`, `simplify`, `split`, or `stop`. After repeated non-product failure, the default is `simplify` or `stop`.

## Stop discipline

Before adding an unrequested task, retry, audit, harness, verification stage, evidence channel, or hardening item, apply this stop ladder:

1. Did Sol ask for it?
2. Does the requested result need it?
3. What reachable evidence shows that need?
4. Would current acceptance fail without it?

Only work that survives this ladder enters current scope. Otherwise classify it as an adjacent defect or hypothetical hardening and defer it.

Use the S/H/I/T shorthand as a review aid, not as a runtime mechanism:

- **S — Scope creep:** work expands beyond the frozen decision.
- **H — Hypothetical hardening:** new hardening is driven by imagined failure rather than reachable evidence.
- **I — Intent violation:** the work no longer answers the user-approved decision.
- **T — Task thrashing:** repeated reread/retest/re-review/re-qualification continues after sufficient decision evidence exists.

Every proposed extra verification action must identify the product claim that remains unproved, the genuinely new information the action will produce, and how that information could change `PASS`, `STOPPED`, or rollback. If it cannot change the action, stop.

Hashes and digests are useful only when their result controls the next action or replaces a more expensive verification. Do not add ritual hashes that are followed by the same full verification regardless of result.

Before turning an incident into a durable prohibition or enforcement rule, require both a **Bad Case** that the rule should stop and a **Good Case** that must remain allowed. Prefer `observation → counterexample → reproduction → enforcement`, not `incident → permanent rule`.

Do not create a governance database, stage-fingerprint store, automatic task-thrashing detector, claim-completion state machine, or other persistent anti-governance runtime without separate evidence of product need. Governance should remain primarily in policy, Stage Cards, agent reasoning, and minimal static enforcement.

## Governance proportionality

A new governance mechanism, artifact, qualification step, watcher, snapshot, hash gate, retry protocol, or persistent instrumentation must protect at least one concrete need: a serious failure already observed, an irreversible operation, persistent data, production runtime, cross-session authority, or decision-critical evidence unavailable through existing mechanisms.

Use probability × consequence × detectability as a qualitative risk frame. A merely imaginable failure is not enough to justify permanent governance.

Transient incidents should default to observe → reproduce if needed → diagnose → fix the smallest cause → rerun only if the decision still needs it. Do not automatically convert a WSL exit, shell error, watcher failure, or provider interruption into a new long-lived governance object.

Governance proportionality is a stop principle, not a mandatory gate or report. Do not create a `governance-proportionality` artifact merely to prove that proportionality was considered.

## Thin orchestration and reusable disciplines

Orchestration describes **what this bounded round is trying to accomplish**. Reusable disciplines describe **how a recurring class of engineering work should be performed**.

Stage Cards and execution plans should reference durable rules instead of restating complete repo-authority, anti-drift, testing, review, runtime-evidence, rollback, handoff, or proportionality procedures. A Stage Card is not the center of project governance; it is an optional bounded execution artifact used when Level B/C risk actually benefits from one.

Treat reusable disciplines such as failure diagnosis, review, TDD, runtime evidence, rollback safety, and handoff as a conceptual composition model first. Extract a dedicated skill/framework only after repeated real use demonstrates material duplication and a clear maintenance benefit. Do not start a new skills-infrastructure project merely to implement this policy.

Deep design interrogation or "grilling" is conditional, not a default workflow. Reserve it for high-impact, hard-to-reverse decisions such as persistent data models, authority boundaries, irreversible migrations, or cross-subsystem protocols. Small reversible work should normally use inspect → implement → test.

## Independent review dimensions

Keep these review questions independent when they are applicable:

- **Spec correctness:** did the change implement the requested behavior without omission, contradiction, or scope creep?
- **Architecture quality:** is the resulting structure maintainable, appropriately bounded, and free of avoidable duplication or speculative generality?
- **Runtime qualification:** when real runtime behavior matters, is there minimum sufficient evidence that the intended runtime state or behavior actually holds?
- **Governance proportionality:** did the process cost and artifact load remain reasonable for the risk being controlled?

Do not collapse these into one ambiguous `PASS`. Equally, do not require a four-axis checklist for every change: evaluate only dimensions that can change the decision.

## Durable decisions and canonical terminology

Prefer one canonical term for one stable project concept. High-ambiguity terms such as `sync`, `activation`, `qualification`, `checkpoint`, `reconciliation`, `projection`, and `memory` should be mapped to stable project meanings before they are copied across multiple artifacts.

Canonical vocabulary records **already-stable semantics**; it must not pre-decide unresolved product architecture. In particular, this governance policy does not define the future Phase 2.5 Canonical Memory object model or projection ownership. A dedicated `CONTEXT.md` or `docs/domain-context.md` should be created only when repeated stable vocabulary justifies a separate durable authority, not because this policy mentions the idea.

Create a durable architectural decision record only when all three conditions hold:

1. the decision is meaningfully hard to reverse;
2. the choice would be surprising or difficult to understand later without its context;
3. there was a real trade-off among viable alternatives.

Keep such decisions under the existing `docs/decisions/` authority rather than creating a competing `docs/adr/` tree. Watcher exits, WSL interruptions, shell workarounds, retry packets, temporary instrumentation, and one-off harness defects belong in evidence/history unless they expose a genuinely durable architectural decision.

## Documentation authority ownership

Each information class has one primary owner:

| Information | Primary authority |
| --- | --- |
| Current code behavior | Git HEAD + tests/runtime evidence |
| Current project/product state | `docs/current-state.md` |
| Long-lived auditable governance | accepted files under `docs/decisions/` |
| Durable architectural trade-off | qualifying decision record under `docs/decisions/` |
| Canonical domain terminology | existing stable authority; dedicated domain-context file only when repeated stable vocabulary justifies it |
| Stage scope, when a Stage Card is warranted | exact frozen Stage Card |
| Runtime/test observation | corresponding evidence/report artifact |
| Stage execution result | stage `final-report.md` or bounded execution report |
| Execution authorization | Sol's original explicit authorization only |
| Historical timeline | `docs/devlog.md` and retained historical reports/handoffs |
| Exceptional session continuation state | minimal handoff referencing the primary authorities |

Derived documents must link to the primary authority instead of restating large copies of it.

## Documentation slimming rules

- `docs/current-state.md` describes current state only; it does not narrate development history and does not pin its own containing Git commit.
- `docs/devlog.md` is a concise timeline, never an authorization source.
- Stage Cards are not default artifacts. When Level B/C work actually needs one, keep it as short as the decision allows and include only the bounded intent, authority, scope/non-goals, minimum evidence, stop conditions, allowed mutations, and execution boundary. The former 100–150-line range is a ceiling signal, not a target.
- Detailed execution evidence belongs in reports/evidence roots, not in Stage Cards or the chat transcript. Evidence records what was observed; it does not own architecture or authorization decisions.
- New `session-handoff-*` documents are not created by default. Create one only when a forced session/environment transition leaves material continuation state that cannot be recovered cleanly from current-state + decisions + current Stage Card/report. Handoffs follow **reference, don't duplicate**: repository authority, current state, unresolved issue, immediate next action, constraints, and reference paths only. Existing handoffs remain historical records.
- OpenSpec is reserved for actual product/contract/architecture changes, not one-off diagnostics or verification runs.

## Conflict rule

If a later document says a stage was authorized but the original owner authorization is missing or conflicts with the bound execution packet, the later statement does not repair the authorization chain. Preserve the execution as historical evidence, mark authorization provenance unverified, and stop before further execution.
