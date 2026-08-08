# Project Authorization Policy

> Status: `Accepted decision`
>
> This document defines project governance. It never grants execution authority by itself.

## Purpose

Prevent a diagnostic or verification agent from extending one owner-approved stage into a chain of self-authorized Stage Cards, commits, or reproductions.

## Authority source

Only Sol's original explicit authorization for the exact stage is authoritative execution provenance.

The following may record or summarize authorization, but cannot create it:

- Stage Cards;
- `docs/current-state.md`;
- `docs/devlog.md`;
- session handoffs;
- reports;
- agent memory;
- later Codex/GPT summaries.

If the original authorization cannot be verified, treat authority as `UNVERIFIED` and stop.

## Execution binding

Every executable stage must be dispatched with a bounded execution packet containing at least:

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

Codex may perform only the stage in the current execution packet.

After the authorized execution it must:

1. report evidence and the stage result;
2. identify at most one smallest next decision;
3. stop.

Codex must not create, commit, authorize, or execute a successor Stage Card as part of the same authorization.

GPT reviews the report and may propose the next Stage Card. Sol separately authorizes any commit and separately authorizes any later execution.

## Verification anti-drift limit

For one product question, a diagnosis stage plus one corrective verification stage is the normal maximum.

A proposed third verification substage triggers mandatory `STOPPED` drift review. Continuing requires Sol to reopen the work explicitly as a new product-level decision. A tooling or harness defect does not automatically justify another micro-stage.

## Documentation authority ownership

Each information class has one primary owner:

| Information | Primary authority |
| --- | --- |
| Current code behavior | Git HEAD + tests/runtime evidence |
| Current project/product state | `docs/current-state.md` |
| Long-lived auditable governance | accepted files under `docs/decisions/` |
| Stage scope | exact frozen Stage Card |
| Stage execution result | stage `final-report.md` or bounded execution report |
| Execution authorization | Sol's original explicit authorization only |
| Historical timeline | `docs/devlog.md` and retained historical reports/handoffs |

Derived documents must link to the primary authority instead of restating large copies of it.

## Documentation slimming rules

- `docs/current-state.md` describes current state only; it does not narrate development history and does not pin its own containing Git commit.
- `docs/devlog.md` is a concise timeline, never an authorization source.
- Stage Cards should normally stay around 100–150 lines and contain only the decision, scope, non-goals, minimum evidence, pass criteria, stop conditions, allowed mutations, and authorization boundary.
- Detailed execution evidence belongs in reports/evidence roots, not in Stage Cards or the chat transcript.
- New `session-handoff-*` documents are not created by default. Public repository context for a new session should normally start from `docs/current-state.md`, relevant accepted decisions, the current Stage Card if one exists, and the relevant final report. Existing handoffs remain historical records.
- OpenSpec is reserved for actual product/contract/architecture changes, not one-off diagnostics or verification runs.

## Conflict rule

If a later document says a stage was authorized but the original owner authorization is missing or conflicts with the bound execution packet, the later statement does not repair the authorization chain. Preserve the execution as historical evidence, mark authorization provenance unverified, and stop before further execution.
