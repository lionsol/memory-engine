# Smoke Tests

This directory keeps manual smoke-test runbooks for workflows that are important to verify outside ordinary unit tests.

## Available Runbooks

| Runbook | Scope | Safety boundary |
|:---|:---|:---|
| [`console-annotation-report-handoff.md`](console-annotation-report-handoff.md) | Console `/reports` ↔ `/annotations` GUI handoff for annotation/review queue work | Read-only report fetches only; no label upload, DB write, memory mutation, apply, unarchive, category update, delete, quarantine, reinforce, or LLM call |
| [`openclaw-memory-tools.md`](openclaw-memory-tools.md) | OpenClaw memory tool contract and memory-core / memory-engine split | Tool exposure and routing verification only; no memory mutation |
| [`full-fail-closed-safety-smoke.md`](full-fail-closed-safety-smoke.md) | F1-D-B8-A5 Hybrid Search full fail-closed matrix across all production surfaces | Synthetic SQLite `:memory:` fixtures only; no real DB, plugin reload, config mutation, network call, report write, or legacy code removal |

## When to Use

Run or review the Console annotation/report handoff smoke whenever changing:

- `console/views/annotations.ejs`
- `console/views/reports.ejs`
- `console/public/charts.js`
- `console/services/reports-service.js`
- report allowlists
- annotation candidate/label report formats
- archived raw-log rescue queue or label report tooling

Run or review the OpenClaw memory tools smoke whenever changing:

- `openclaw.plugin.json`
- memory tool contracts
- memory-core / memory-engine tool boundaries
- agent-facing memory search/get behavior

Run the full fail-closed safety smoke whenever changing:

- KG or Recent fail-closed policy/runtime behavior;
- Hybrid fallback suppression or rollback behavior;
- Hybrid observation rollout markers;
- scoped-canary versus full-mode metrics;
- production search-surface wiring.

## Regression Guard

The runbooks are also covered by static tests so that key links, workflow steps, and safety boundaries remain discoverable:

```text
npm run smoke:console-annotation-handoff
npm run smoke:full-fail-closed
node --test test/agent-memory-tool-strategy.test.js
```
